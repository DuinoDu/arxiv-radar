/**
 * POST /api/conductor/bind
 *
 * Body: `{ paperId: string }`
 * Returns: `{ taskId, projectId }`
 *
 * Idempotent. On first call for a given paper:
 *   1. ensures the Conductor project exists for this app (project bind),
 *   2. creates a Conductor task scoped to the paper, seeded with a short
 *      initial message pointing at the paper source (arXiv HTML or direct
 *      external PDF) so the AI's harness can fetch the paper text on demand,
 *   3. persists the resulting `{ userId → paperId → taskId }` mapping into
 *      the user-scoped database tables.
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
 * Caveat: this dedup is **single-process**. On an autoscaled serverless
 * deploy, two concurrent requests can land on different Node
 * instances and both will pass the recheck; both can create a Conductor task,
 * and the later database upsert can replace the earlier task mapping. If it
 * becomes material, replace this section with a real per-user-paper advisory
 * lock or pending row.
 */
import { NextResponse } from "next/server";
import { isConductorAppError } from "@love-moon/app-sdk";
import {
  bindArxivRadarProject,
  getConductorClient,
} from "@/lib/conductor/client";
import { buildPaperInitialChatMessage } from "@/lib/arxiv/chat";
import {
  getUserPaperTaskBinding,
  readAppSettings,
  readArxivState,
  setUserPaperTaskBinding,
} from "@/lib/arxiv/store";
import { getCurrentAuthSession, type AuthSession } from "@/lib/auth/session";
import { readChatRuntimeOptions } from "@/lib/conductor/chat-runtime";
import type { AnalyzedPaper } from "@/lib/arxiv/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface BindRequestBody {
  paperId?: string;
  initialMessage?: string;
  daemonHost?: string;
  backendType?: string;
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

function optionalString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

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
    const state = await readArxivState(session.user.id);
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

    const result = await bindWithDedup(session, paperId, paper, {
      initialMessage: optionalString(body.initialMessage),
      daemonHost: optionalString(body.daemonHost),
      backendType: optionalString(body.backendType),
    });
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}

async function bindWithDedup(
  session: AuthSession,
  paperId: string,
  paper: AnalyzedPaper,
  options: {
    initialMessage?: string;
    daemonHost?: string;
    backendType?: string;
  },
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
    const settings = await readAppSettings(session.user.id);
    const runtimeOptions = await readChatRuntimeOptions(session, settings, {
      preferredDaemonHost: options.daemonHost,
      preferredBackendType: options.backendType,
    });
    const daemonHost = runtimeOptions.selectedDaemonHost;
    if (!daemonHost) {
      throw new Error("请选择在线 Conductor daemon 后再创建 chat");
    }
    if (!runtimeOptions.workspacePath) {
      throw new Error(
        "无法获取 chat workspace。请确认所选 daemon 在线，并已在 Conductor daemon 配置 workspace。",
      );
    }

    const selectedDaemon = runtimeOptions.daemons.find((daemon) => daemon.host === daemonHost);
    if (
      options.backendType &&
      selectedDaemon?.supportedBackends.length &&
      !selectedDaemon.supportedBackends.includes(options.backendType)
    ) {
      throw new Error(`${daemonHost} 不支持 backend ${options.backendType}`);
    }

    const project = await bindArxivRadarProject(session, {
      daemonHost,
      workspacePath: runtimeOptions.workspacePath,
    });
    const client = await getConductorClient(session);
    const backendType = runtimeOptions.selectedBackendType || undefined;
    const initialMessage = options.initialMessage || buildPaperInitialChatMessage(paper);
    const task = await client.tasks.create({
      projectId: project.id,
      title: paper.title.slice(0, 200),
      initialMessage,
      ...(backendType ? { backendType } : {}),
      metadata: {
        arxivRadar: {
          paperId,
          daemonHost,
          workspacePath: runtimeOptions.workspacePath,
        },
      },
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
