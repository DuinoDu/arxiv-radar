/**
 * BFF pass-through for the @love-moon/app-sdk React widget's default REST
 * adapter. Mirrors the example route at modules/app-sdk/examples/02_bff.
 *
 * Routes (relative to /api/conductor):
 *
 *   GET  /tasks/:taskId/messages?pagination=1&limit&before_id
 *        → forwarded to client.tasks.history()
 *   POST /tasks/:taskId/messages
 *        → forwarded to client.tasks.sendMessage()
 *   POST /tasks/:taskId/interrupt
 *        → forwarded to client.tasks.interrupt()
 *   GET  /tasks/:taskId/events
 *        → SSE stream from client.tasks.subscribe()
 *
 * The widget's Conductor token NEVER leaves this Node process — the browser
 * talks to /api/conductor/* and we forward with the server-held token.
 */
import { NextRequest, NextResponse } from "next/server";
import { ConductorAppError, isConductorAppError } from "@love-moon/app-sdk";
import { getConductorClient } from "@/lib/conductor/client";
import {
  isConductorRawError,
  killConductorTask,
  restartConductorTask,
} from "@/lib/conductor/raw-fetch";
import { clearPaperTaskBindingByTaskId } from "@/lib/arxiv/store";

export const runtime = "nodejs";
// SSE streams are long-lived; tell Next not to time them out.
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ path: string[] }>;
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  const segments = (await ctx.params).path ?? [];
  if (segments[0] !== "tasks" || !segments[1]) return notFound();
  const taskId = decodeURIComponent(segments[1]);
  const op = segments[2];

  try {
    const client = await getConductorClient();
    // GET /tasks/:id → task object (used by our task status badge).
    // The catch-all already handles /tasks/:id/messages and /tasks/:id/events
    // below; this branch covers the "no third segment" case.
    if (op === undefined) {
      const task = await client.tasks.get(taskId);
      return NextResponse.json(task);
    }
    if (op === "messages") {
      const url = new URL(req.url);
      const beforeId = url.searchParams.get("before_id") ?? undefined;
      const limitParam = url.searchParams.get("limit");
      const limit = limitParam ? Number.parseInt(limitParam, 10) : undefined;
      const page = await client.tasks.history(taskId, { beforeId, limit });
      return NextResponse.json({
        messages: page.messages,
        pagination: {
          has_more_before: page.hasMoreBefore,
          oldest_message_id: page.oldestMessageId,
        },
      });
    }

    if (op === "events") {
      return startEventStream(req, taskId);
    }

    return notFound();
  } catch (err) {
    return await errorResponse(err, taskId);
  }
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const segments = (await ctx.params).path ?? [];
  if (segments[0] !== "tasks" || !segments[1]) return notFound();
  const taskId = decodeURIComponent(segments[1]);
  const op = segments[2];

  try {
    const client = await getConductorClient();
    const body = await req.json().catch(() => ({}));

    if (op === "messages") {
      const content = String(body?.content ?? "");
      if (!content) {
        return NextResponse.json(
          { error: "content required" },
          { status: 400 },
        );
      }
      // Threat model: the browser cannot be trusted to author messages as
      // `system`/`assistant`, nor to stamp `audit.actor='app'`. Hard-code
      // role='user' and strip metadata.audit before forwarding; the SDK
      // server-side stamps its own audit fields.
      const incomingMetadata =
        body?.metadata &&
        typeof body.metadata === "object" &&
        !Array.isArray(body.metadata)
          ? { ...(body.metadata as Record<string, unknown>) }
          : undefined;
      if (incomingMetadata) delete incomingMetadata.audit;
      const msg = await client.tasks.sendMessage(taskId, {
        content,
        clientRequestId:
          typeof body?.clientRequestId === "string"
            ? body.clientRequestId
            : undefined,
        role: "user",
        ...(incomingMetadata ? { metadata: incomingMetadata } : {}),
      });
      return NextResponse.json(msg);
    }

    if (op === "interrupt") {
      const targetReplyTo = String(
        body?.target_reply_to ?? body?.targetReplyTo ?? "",
      );
      if (!targetReplyTo) {
        return NextResponse.json(
          { error: "target_reply_to required" },
          { status: 400 },
        );
      }
      await client.tasks.interrupt(taskId, { targetReplyTo });
      return NextResponse.json({ ok: true });
    }

    // Task lifecycle ops — bypass the SDK (which doesn't wrap these) and
    // call Conductor REST directly. Used by the chat top bar's task-card-
    // style controls (running → kill?, killed → restart?).
    if (op === "kill") {
      const task = await killConductorTask(taskId);
      return NextResponse.json(task);
    }
    if (op === "restart") {
      const strategy =
        body?.strategy === "fresh" || body?.strategy === "inplace"
          ? body.strategy
          : "inplace";
      const result = await restartConductorTask(taskId, { strategy });
      return NextResponse.json(result);
    }

    return notFound();
  } catch (err) {
    return await errorResponse(err, taskId);
  }
}

/**
 * Bridge the SDK's `subscribe(taskId)` AsyncIterable to a Server-Sent Events
 * response. The widget connects via `new EventSource(...)` and renders each
 * `data: <JSON>` line as a ChatEvent.
 */
async function startEventStream(
  req: NextRequest,
  taskId: string,
): Promise<Response> {
  const client = await getConductorClient();
  const encoder = new TextEncoder();
  const abortController = new AbortController();
  const onRequestAbort = (): void => abortController.abort();
  let removeReqAbortListener: (() => void) | null = null;
  if (req.signal.aborted) {
    abortController.abort();
  } else {
    req.signal.addEventListener("abort", onRequestAbort, { once: true });
    removeReqAbortListener = () => {
      req.signal.removeEventListener("abort", onRequestAbort);
    };
  }

  let keepAliveTimer: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const safeEnqueue = (chunk: Uint8Array): boolean => {
        if (closed) return false;
        try {
          controller.enqueue(chunk);
          return true;
        } catch {
          closed = true;
          return false;
        }
      };

      if (!safeEnqueue(encoder.encode(":ok\n\n"))) return;

      keepAliveTimer = setInterval(() => {
        if (
          typeof controller.desiredSize === "number" &&
          controller.desiredSize < 0
        ) {
          return;
        }
        if (!safeEnqueue(encoder.encode(": keepalive\n\n"))) {
          if (keepAliveTimer) {
            clearInterval(keepAliveTimer);
            keepAliveTimer = null;
          }
        }
      }, 15_000);

      try {
        for await (const event of client.tasks.subscribe(taskId, {
          signal: abortController.signal,
        })) {
          if (closed || req.signal.aborted) break;
          const ok = safeEnqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
          );
          if (!ok) break;
        }
      } catch (err) {
        const code =
          err instanceof ConductorAppError ? err.code : "subscribe_failed";
        if (code === "task_not_found") {
          // Await: the next REST round-trip from the widget (history or
          // sendMessage) may race the eviction. We must commit the eviction
          // before letting the client move on.
          try {
            await clearPaperTaskBindingByTaskId(taskId);
          } catch (cleanupErr) {
            console.error(
              "[conductor] failed to clear stale paper-task binding (sse)",
              { taskId, cleanupErr },
            );
          }
        }
        const payload = {
          type: "task_failed",
          taskId,
          error: {
            code,
            message: (err as Error)?.message ?? "subscribe stream ended",
          },
        };
        safeEnqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      } finally {
        cleanup();
        if (!closed) {
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        }
      }
    },
    cancel() {
      abortController.abort();
      cleanup();
    },
  });

  function cleanup() {
    closed = true;
    if (keepAliveTimer) {
      clearInterval(keepAliveTimer);
      keepAliveTimer = null;
    }
    if (removeReqAbortListener) {
      removeReqAbortListener();
      removeReqAbortListener = null;
    }
  }

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

function notFound() {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

/**
 * Build the JSON error envelope the SDK's REST adapter expects. When the
 * upstream Conductor error is `task_not_found`, also evict the local
 * `paperTasks` binding for this taskId so the next bind round creates a
 * fresh task instead of looping on the dead one.
 *
 * Eviction is **awaited**, not fire-and-forget: the browser's chat widget
 * sees this error, bumps a counter, and immediately re-POSTs `/bind`. If
 * the eviction is still in flight when the rebind reads state, the rebind
 * sees the (still-dead) binding and returns the same dead taskId — infinite
 * loop. ~10-50ms on an already-failing request is the right tradeoff.
 *
 * Cleanup failures are logged but don't poison the response — we still
 * want the original Conductor error to reach the client.
 */
async function errorResponse(err: unknown, taskId?: string) {
  if (isConductorAppError(err)) {
    if (taskId && err.code === "task_not_found") {
      try {
        await clearPaperTaskBindingByTaskId(taskId);
      } catch (cleanupErr) {
        console.error(
          "[conductor] failed to clear stale paper-task binding",
          { taskId, cleanupErr },
        );
      }
    }
    return NextResponse.json(
      { error: err.message, code: err.code },
      { status: err.status ?? 500 },
    );
  }
  // Raw Conductor REST errors (from kill/restart bypass paths).
  if (isConductorRawError(err)) {
    if (taskId && err.status === 404) {
      try {
        await clearPaperTaskBindingByTaskId(taskId);
      } catch (cleanupErr) {
        console.error(
          "[conductor] failed to clear stale paper-task binding (raw)",
          { taskId, cleanupErr },
        );
      }
    }
    return NextResponse.json(
      { error: err.message, code: err.code },
      { status: err.status },
    );
  }
  return NextResponse.json(
    { error: (err as Error)?.message ?? "Internal error" },
    { status: 500 },
  );
}
