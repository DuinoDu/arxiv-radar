/**
 * DELETE /api/papers/:id/chat
 *
 * Tears down the chat session bound to a paper:
 *   1. deletes the underlying Conductor task (falls back to `kill` when the
 *      daemon build doesn't expose task deletion), and
 *   2. drops the local `{ userId → paperId → taskId }` binding so the next
 *      chat click on this paper mints a fresh task.
 *
 * Idempotent: when no binding exists the call still returns ok (deleted:false).
 */
import { NextRequest, NextResponse } from "next/server";
import {
  clearUserPaperTaskBindingByTaskId,
  getUserPaperTaskBinding,
} from "@/lib/arxiv/store";
import { requireAuthSession } from "@/lib/auth/guard";
import { deleteConductorTask, killConductorTask } from "@/lib/conductor/raw-fetch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function decodeRouteId(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  const auth = await requireAuthSession();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const paperId = decodeRouteId(id);

  if (!paperId) {
    return NextResponse.json({ ok: false, error: "missing id" }, { status: 400 });
  }

  const userId = auth.session.user.id;

  try {
    const binding = await getUserPaperTaskBinding(userId, paperId);
    if (!binding) {
      return NextResponse.json({ ok: true, id: paperId, deleted: false });
    }

    // Best-effort remote teardown. Prefer a hard delete; if the daemon rejects
    // DELETE (e.g. 405 on an older build) fall back to `kill` so the task at
    // least stops running. We never let a remote failure block the local
    // binding cleanup below — otherwise a wedged task would make the chat
    // button un-resettable.
    try {
      await deleteConductorTask(binding.taskId, auth.session);
    } catch (deleteErr) {
      console.warn(
        "[paper-chat-delete] delete failed, falling back to kill",
        { taskId: binding.taskId, deleteErr },
      );
      try {
        await killConductorTask(binding.taskId, auth.session);
      } catch (killErr) {
        console.warn("[paper-chat-delete] kill fallback failed", {
          taskId: binding.taskId,
          killErr,
        });
      }
    }

    await clearUserPaperTaskBindingByTaskId(userId, binding.taskId);

    return NextResponse.json({ ok: true, id: paperId, deleted: true });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: (error as Error).message },
      { status: 500 },
    );
  }
}
