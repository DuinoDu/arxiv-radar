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
import { clearUserPaperTaskBindingByTaskId, readAppSettings } from "@/lib/arxiv/store";
import { getCurrentAuthSession, type AuthSession } from "@/lib/auth/session";

export const runtime = "nodejs";
// SSE streams are long-lived; tell Next not to time them out.
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ path: string[] }>;
}

function authenticationRequired() {
  return NextResponse.json(
    { error: "请先使用 Conductor 登录", code: "authentication_required" },
    { status: 401 },
  );
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  const session = await getCurrentAuthSession();
  if (!session) return authenticationRequired();

  const segments = (await ctx.params).path ?? [];
  if (segments[0] !== "tasks" || !segments[1]) return notFound();
  const taskId = decodeURIComponent(segments[1]);
  const op = segments[2];

  try {
    const client = await getConductorClient(session);
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
        messages: page.messages.map(normalizeMessageForWidget),
        pagination: {
          has_more_before: page.hasMoreBefore,
          oldest_message_id: page.oldestMessageId,
        },
      });
    }

    if (op === "events") {
      return startEventStream(req, taskId, session);
    }

    return notFound();
  } catch (err) {
    return await errorResponse(err, taskId, session.user.id);
  }
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const session = await getCurrentAuthSession();
  if (!session) return authenticationRequired();

  const segments = (await ctx.params).path ?? [];
  if (segments[0] !== "tasks" || !segments[1]) return notFound();
  const taskId = decodeURIComponent(segments[1]);
  const op = segments[2];

  try {
    const client = await getConductorClient(session);
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
      const task = await killConductorTask(taskId, session);
      return NextResponse.json(task);
    }
    if (op === "restart") {
      const strategy =
        body?.strategy === "fresh" || body?.strategy === "inplace"
          ? body.strategy
          : "inplace";
      // Respect a per-restart override from the body, falling back to the
      // settings-configured default. Without this fallback, restarting a task
      // would silently revert to whatever backend the task was originally
      // created with, even if the user changed the popup setting.
      const explicitBackend =
        typeof body?.backend_type === "string" && body.backend_type.trim()
          ? body.backend_type.trim()
          : typeof body?.backendType === "string" && body.backendType.trim()
            ? body.backendType.trim()
            : null;
      const settings = await readAppSettings(session.user.id);
      const configuredBackend = settings.conductor.backendType || null;
      const backendType = explicitBackend ?? configuredBackend ?? undefined;
      const result = await restartConductorTask(taskId, {
        strategy,
        ...(backendType ? { backendType } : {}),
      }, session);
      return NextResponse.json(result);
    }

    return notFound();
  } catch (err) {
    return await errorResponse(err, taskId, session.user.id);
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
  session: AuthSession,
): Promise<Response> {
  const client = await getConductorClient(session);
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
          const normalizedEvent = normalizeEventForWidget(event);
          const ok = safeEnqueue(
            encoder.encode(`data: ${JSON.stringify(normalizedEvent)}\n\n`),
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
            await clearUserPaperTaskBindingByTaskId(session.user.id, taskId);
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

type ChatMessageForWidget = {
  role?: string;
  metadata?: Record<string, unknown> | null;
};

function normalizeEventForWidget<T>(event: T): T {
  if (!isRecord(event) || event.type !== "message_appended") return event;
  const message = event.message;
  if (!isRecord(message)) return event;

  const normalizedMessage = normalizeMessageForWidget(message);
  if (normalizedMessage === message) return event;
  return { ...event, message: normalizedMessage } as T;
}

function normalizeMessageForWidget<T extends ChatMessageForWidget>(message: T): T {
  // Conductor can emit AI replies as `task_sdk_message`; the SDK then
  // normalizes missing/ambiguous roles to `sdk`, and its React view renders
  // `sdk` as a user-side bubble. Only app-origin SDK messages should keep
  // that treatment. Non-app SDK messages are assistant replies for this app.
  if (
    message.role !== "sdk" ||
    isAppOriginMessage(message.metadata) ||
    isSyntheticMessage(message.metadata)
  ) {
    return message;
  }

  return { ...message, role: "assistant" };
}

function isAppOriginMessage(
  metadata: Record<string, unknown> | null | undefined,
): boolean {
  const audit = metadata?.audit;
  return isRecord(audit) && audit.actor === "app";
}

function isSyntheticMessage(
  metadata: Record<string, unknown> | null | undefined,
): boolean {
  return metadata?.synthetic === true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function notFound() {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

/**
 * Build the JSON error envelope the SDK's REST adapter expects. When the
 * upstream Conductor error is `task_not_found`, also evict the local
 * current user's `paperTasksByUser` binding for this taskId so the next bind round creates a
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
async function errorResponse(err: unknown, taskId?: string, userId?: string) {
  if (isConductorAppError(err)) {
    if (taskId && userId && err.code === "task_not_found") {
      try {
        await clearUserPaperTaskBindingByTaskId(userId, taskId);
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
    if (taskId && userId && err.status === 404) {
      try {
        await clearUserPaperTaskBindingByTaskId(userId, taskId);
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
