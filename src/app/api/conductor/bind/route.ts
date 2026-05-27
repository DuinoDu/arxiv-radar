/**
 * POST /api/conductor/bind
 *
 * Body: `{ paperId: string }`
 * Returns: `{ taskId, projectId }`
 *
 * Idempotent. On first call for a given paper:
 *   1. ensures the Conductor project exists for this app (project bind),
 *   2. creates a Conductor task scoped to the paper, seeded with a short
 *      initial message pointing at the arXiv HTML so the AI's harness can
 *      fetch the paper text on demand,
 *   3. persists the resulting `{ userId → paperId → taskId }` mapping into our
 *      shared state file (and Vercel Blob, when configured).
 *
 * On subsequent calls the persisted mapping is returned directly — no
 * second task gets created.
 *
 * Concurrency: a single user can race the bind endpoint with itself by
 * opening two tabs on the same paper. Without coordination both tabs would
 * see the no-binding state, both would mint a task, and the loser's task
 * would orphan on Conductor. We dedupe in-flight create calls per paperId
 * via a module-level Map so the second tab awaits and gets the first
 * tab's taskId.
 *
 * Caveat: this dedup is **single-process**. On Vercel (or any autoscaled
 * serverless deploy) two concurrent requests can land on different Node
 * instances and both will pass the recheck; both will create a Conductor
 * task, and Blob's OCC retry will let the *later* `setUserPaperTaskBinding`
 * win (the updater blindly overwrites). The winner's task is then
 * orphaned on Conductor, since the persisted mapping points at the loser
 * (in temporal-write order). If it becomes material, replace this section
 * with: stamp a
 * `pending` sentinel via `setUserPaperTaskBinding` *before* `tasks.create`,
 * using ifAbsent / ifMatch semantics, so the second writer detects the
 * conflict, deletes its own just-created task, and refetches the winner's
 * taskId.
 */
import { NextResponse } from "next/server";
import { isConductorAppError } from "@love-moon/app-sdk";
import {
  bindArxivRadarProject,
  getConductorClient,
} from "@/lib/conductor/client";
import {
  getUserPaperTaskBinding,
  readAppSettings,
  readArxivState,
  setUserPaperTaskBinding,
} from "@/lib/arxiv/store";
import { getCurrentAuthSession, type AuthSession } from "@/lib/auth/session";
import type { AnalyzedPaper } from "@/lib/arxiv/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface BindRequestBody {
  paperId?: string;
}

interface BindResult {
  taskId: string;
  projectId: string;
}

// Module-scope in-flight map for the create path. Keyed by paperId. Cleared
// in `finally` so a failed bind doesn't poison subsequent requests. Lives
// for the lifetime of the Node process — that's fine because Next route
// handlers share the module instance per worker, which is exactly the
// concurrency surface we need to coordinate.
const inflightBinds = new Map<string, Promise<BindResult>>();

function authenticationRequired() {
  return NextResponse.json(
    { error: "请先使用 Conductor 登录", code: "authentication_required" },
    { status: 401 },
  );
}

export async function POST(request: Request) {
  const session = await getCurrentAuthSession();
  if (!session) {
    return authenticationRequired();
  }

  let body: BindRequestBody;
  try {
    body = (await request.json()) as BindRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const paperId = typeof body?.paperId === "string" ? body.paperId : "";
  if (!paperId) {
    return NextResponse.json(
      { error: "paperId is required" },
      { status: 400 },
    );
  }

  try {
    // Up-front existence check on the fast path too: never echo a stored
    // binding for a paperId that's no longer in our catalogue.
    const state = await readArxivState();
    const paper = state.papers.find((candidate) => candidate.id === paperId);
    if (!paper) {
      return NextResponse.json(
        { error: "Paper not found" },
        { status: 404 },
      );
    }

    const existing = state.paperTasksByUser?.[session.user.id]?.[paperId];
    if (existing) {
      return NextResponse.json({
        taskId: existing.taskId,
        projectId: existing.projectId,
      });
    }

    const result = await bindWithDedup(session, paperId, paper);
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}

async function bindWithDedup(
  session: AuthSession,
  paperId: string,
  paper: AnalyzedPaper,
): Promise<BindResult> {
  // Second-chance read: another in-flight bind may have committed between
  // the outer state read in `POST` and this point. Intentionally a fresh
  // `readArxivState()` round-trip via `getUserPaperTaskBinding`, not the
  // cached outer state — that's what makes this loop closeable on the
  // cooperating single-process path. Cheap; the second read covers the
  // read-then-create window without holding a lock across Conductor IO.
  const recheck = await getUserPaperTaskBinding(session.user.id, paperId);
  if (recheck) {
    return { taskId: recheck.taskId, projectId: recheck.projectId };
  }

  const inflightKey = `${session.user.id}\n${paperId}`;
  const ongoing = inflightBinds.get(inflightKey);
  if (ongoing) return ongoing;

  const promise = (async (): Promise<BindResult> => {
    const settings = await readAppSettings();
    const project = await bindArxivRadarProject(session);
    const client = await getConductorClient(session);
    // Backend selection: settings-configured backend type maps to a key in
    // the daemon's `allow_cli_list`. Empty / missing → let Conductor
    // pick the daemon default. Trimmed so accidental whitespace in .env
    // doesn't produce a bogus backend name like "  codex-fast " that the
    // daemon will reject.
    const backendType = settings.conductor.backendType || undefined;
    const task = await client.tasks.create({
      projectId: project.id,
      title: paper.title.slice(0, 200),
      initialMessage: buildInitialMessage(paper),
      ...(backendType ? { backendType } : {}),
    });

    await setUserPaperTaskBinding(session.user.id, paperId, {
      taskId: task.id,
      projectId: project.id,
      createdAt: new Date().toISOString(),
    });
    return { taskId: task.id, projectId: project.id };
  })();

  inflightBinds.set(inflightKey, promise);
  try {
    return await promise;
  } finally {
    if (inflightBinds.get(inflightKey) === promise) {
      inflightBinds.delete(inflightKey);
    }
  }
}

/**
 * Initial chat message. This becomes the first row in `tasks.history()` and
 * IS visible to the user as a chat bubble, so it's phrased as a natural
 * opener rather than a system-style preamble. Guardrails are at the end so
 * the opening line still reads like a request, not an instruction.
 */
function buildInitialMessage(paper: AnalyzedPaper): string {
  const lines: string[] = [];
  lines.push(`我想和你讨论这篇 arXiv 论文：《${paper.title}》。`);
  lines.push(`HTML 全文：https://arxiv.org/html/${paper.id}`);
  if (paper.pdfUrl) lines.push(`PDF：${paper.pdfUrl}`);
  if (paper.arxivUrl) lines.push(`arXiv 摘要页：${paper.arxivUrl}`);
  if (paper.authors?.length) {
    lines.push(`作者：${paper.authors.join(", ")}`);
  }
  lines.push("");
  lines.push("需要时请基于 HTML 全文回答，不确定就说不知道，不要编实验数值或结论。");
  return lines.join("\n");
}

// Intentionally single-arg (no taskId): a bind error implies we never had
// a taskId to evict. Stale-binding cleanup happens on the catch-all route
// when an existing taskId comes back as `task_not_found` from Conductor.
function errorResponse(err: unknown) {
  if (isConductorAppError(err)) {
    return NextResponse.json(
      { error: err.message, code: err.code },
      { status: err.status ?? 500 },
    );
  }
  return NextResponse.json(
    { error: (err as Error)?.message ?? "Internal error" },
    { status: 500 },
  );
}
