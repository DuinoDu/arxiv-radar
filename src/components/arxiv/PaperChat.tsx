"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, FileText, Globe2, LogIn, MessageSquare } from "lucide-react";
import {
  ChatView,
  createRestAdapter,
  type ChatViewLabels,
} from "@love-moon/app-sdk/react";
import { isConductorAppError } from "@love-moon/app-sdk";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import type { AnalyzedPaper } from "@/lib/arxiv/types";
import {
  TaskStatusBadge,
  type ChatTaskStatus,
} from "@/components/arxiv/chat/TaskStatusBadge";

type WorkspaceView = "pdf" | "html" | "chat";

function chatPath(paper: AnalyzedPaper, view: WorkspaceView) {
  return `/papers/${encodeURIComponent(paper.id)}/chat?view=${view}`;
}

// Single adapter shared across all PaperChat instances. baseUrl points at
// our BFF (/api/conductor/*), never directly at Conductor — the token lives
// server-side only.
const adapter = createRestAdapter({ baseUrl: "/api/conductor" });

const CHAT_LABELS: ChatViewLabels = {
  inputPlaceholder: "输入问题",
  send: "发送",
  interrupt: "停止",
  statusThinking: "思考中…",
  statusToolCall: "调用工具…",
  statusAwaitingUser: "等待输入",
  statusDone: "完成",
  restart: "重启",
  loadEarlier: "加载更早消息",
};

type BindResponse = {
  taskId?: string;
  projectId?: string;
  error?: string;
};

type ConductorTask = {
  id?: string;
  status?: string;
  metadata?: { killingStartedAt?: string | null } | null;
  updatedAt?: string | null;
};

// Cap auto-rebind attempts so a sticky upstream `task_not_found` (Conductor
// outage, token rotation, project deletion) can't spin the counter forever.
// Past this, surface a manual retry button that resets the counter.
const MAX_AUTO_REBINDS = 3;

// Poll cadence for the task status badge. Light enough that 100 tabs open
// don't DDoS our BFF; tight enough that kill / restart transitions land in
// the UI within ~5 seconds.
const TASK_STATUS_POLL_MS = 5_000;

export function PaperChat({ paper, authenticated }: { paper: AnalyzedPaper; authenticated: boolean }) {
  const [taskId, setTaskId] = useState<string | null>(null);
  const [bindError, setBindError] = useState<string | null>(null);
  // Monotonic counter that the bind effect keys on. Bumped by both auto
  // and manual retry — never reset — so that even a manual retry from
  // attempt=0 (initial bind failure) actually changes the dep and re-runs
  // the effect.
  const [bindAttempt, setBindAttempt] = useState(0);
  // Auto-rebind attempts since the last manual retry. This is what the
  // MAX_AUTO_REBINDS cap checks; resetting it on manual retry gives the
  // user a fresh budget of self-heal attempts after they intervene.
  const [autoRebinds, setAutoRebinds] = useState(0);

  // Task lifecycle state for the top-bar status badge.
  const [taskStatus, setTaskStatus] = useState<ChatTaskStatus>("unknown");
  const [killingStartedAt, setKillingStartedAt] = useState<string | null>(null);
  const [killing, setKilling] = useState(false);
  const [restarting, setRestarting] = useState(false);

  useEffect(() => {
    if (!authenticated) {
      return;
    }

    const controller = new AbortController();

    async function bind() {
      setTaskId(null);
      setBindError(null);
      setTaskStatus("unknown");

      try {
        const response = await fetch("/api/conductor/bind", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paperId: paper.id }),
          signal: controller.signal,
        });
        const payload = (await response.json()) as BindResponse;
        if (!response.ok || !payload.taskId) {
          throw new Error(payload.error || "Failed to bind chat task");
        }
        if (!controller.signal.aborted) {
          setTaskId(payload.taskId);
        }
      } catch (error) {
        if ((error as Error).name === "AbortError") return;
        if (!controller.signal.aborted) {
          setBindError((error as Error).message);
        }
      }
    }

    void bind();

    return () => controller.abort();
  }, [authenticated, paper.id, bindAttempt]);

  // Fetch + poll the task lifecycle status from our BFF. The SDK's
  // subscribe stream gives us per-reply runtime events but not the
  // task-lifecycle status (init / running / killed / completed). We poll
  // here so the badge transitions cleanly through kill / restart.
  const fetchTaskStatus = useCallback(
    async (currentTaskId: string, signal: AbortSignal): Promise<void> => {
      try {
        const res = await fetch(
          `/api/conductor/tasks/${encodeURIComponent(currentTaskId)}`,
          { signal },
        );
        if (signal.aborted || !res.ok) return;
        const task = (await res.json()) as ConductorTask;
        if (signal.aborted) return;
        if (typeof task?.status === "string") {
          setTaskStatus(task.status);
        }
        const killStartedAt =
          (task?.metadata && task.metadata.killingStartedAt) ||
          task?.updatedAt ||
          null;
        setKillingStartedAt(killStartedAt);
      } catch {
        /* swallow — keep last known status until the next tick succeeds */
      }
    },
    [],
  );

  useEffect(() => {
    if (!authenticated || !taskId) return;
    const controller = new AbortController();
    const initialTimeoutId = window.setTimeout(() => {
      void fetchTaskStatus(taskId, controller.signal);
    }, 0);
    const intervalId = window.setInterval(() => {
      void fetchTaskStatus(taskId, controller.signal);
    }, TASK_STATUS_POLL_MS);
    return () => {
      controller.abort();
      window.clearTimeout(initialTimeoutId);
      window.clearInterval(intervalId);
    };
  }, [authenticated, taskId, bindAttempt, fetchTaskStatus]);

  const handleKillTask = useCallback(async () => {
    if (!taskId || killing) return;
    setKilling(true);
    setKillingStartedAt(new Date().toISOString());
    try {
      const res = await fetch(
        `/api/conductor/tasks/${encodeURIComponent(taskId)}/kill`,
        { method: "POST" },
      );
      const payload = (await res.json().catch(() => ({}))) as ConductorTask & {
        error?: string;
      };
      if (!res.ok) throw new Error(payload?.error || "Failed to kill task");
      if (typeof payload.status === "string") {
        setTaskStatus(payload.status);
      }
    } catch (err) {
      console.error("[paper-chat] kill", err);
    } finally {
      setKilling(false);
    }
  }, [taskId, killing]);

  const handleRestartTask = useCallback(async () => {
    if (!taskId || restarting) return;
    setRestarting(true);
    try {
      const res = await fetch(
        `/api/conductor/tasks/${encodeURIComponent(taskId)}/restart`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ strategy: "inplace" }),
        },
      );
      const payload = (await res.json().catch(() => ({}))) as {
        task?: ConductorTask;
        error?: string;
      } & ConductorTask;
      if (!res.ok) throw new Error(payload?.error || "Failed to restart task");
      // Restart returns either `{ task: {...} }` (main app shape) or just the
      // task object (raw conductor REST). Tolerate both.
      const task: ConductorTask =
        payload.task && typeof payload.task === "object"
          ? payload.task
          : (payload as ConductorTask);
      if (typeof task.status === "string") setTaskStatus(task.status);
      // strategy='inplace' should return the same task id; tolerate a new id
      // (strategy='fresh' or upstream policy change) by rebinding to it.
      if (typeof task.id === "string" && task.id !== taskId) {
        setTaskId(task.id);
      }
    } catch (err) {
      console.error("[paper-chat] restart", err);
    } finally {
      setRestarting(false);
    }
  }, [taskId, restarting]);

  function handleChatError(error: unknown) {
    console.error("[paper-chat]", error);
    // Auto-rebind path. If Conductor lost track of our task (deleted
    // server-side, project rotated, etc.) the BFF has already awaited the
    // local binding eviction in its `errorResponse` handler before
    // returning, so by the time we bump the counter the next `/bind` POST
    // is guaranteed to see no mapping and mint a fresh task.
    //
    // Coverage gap (documented, not fixed): this hook only fires for the
    // REST paths (fetchHistory / sendMessage / interrupt / loadEarlier) —
    // the SDK's chat-store dispatches SSE `task_failed` events directly
    // into widget state without calling `onError`. If Conductor deletes
    // the task while the user is mid-session, the user sees an error
    // bubble inside ChatView; a tab reload triggers fetchHistory which
    // then hits this auto-rebind. Same gap applies to non-`task_not_found`
    // terminal codes (project_not_found, unauthorized, …) — they only
    // log; the user has to use the in-bubble error UI or reload.
    if (!isConductorAppError(error) || error.code !== "task_not_found") {
      return;
    }
    if (autoRebinds < MAX_AUTO_REBINDS) {
      setAutoRebinds((n) => n + 1);
      setBindAttempt((n) => n + 1);
      return;
    }
    setBindError("聊天会话失效，无法自动恢复。请点击重试或刷新页面。");
    setTaskId(null);
  }

  function retryBindManually() {
    setBindError(null);
    setAutoRebinds(0);
    setBindAttempt((n) => n + 1);
  }

  const isStopped =
    taskStatus === "killed" ||
    taskStatus === "completed" ||
    taskStatus === "failed" ||
    taskStatus === "cancelled" ||
    taskStatus === "unknown";

  return (
    <section className="flex h-[100dvh] flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950 lg:h-full lg:min-h-0">
      <div className="flex h-11 items-center justify-between gap-2 border-b border-zinc-200 px-2 dark:border-zinc-800 lg:px-3">
        <div className="flex shrink-0 items-center gap-2 lg:hidden">
          {/* Intentional hard navigation: ensure clicking back lands on a
              fresh `/` instead of restoring the previous router/scroll state. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a
            href="/"
            title="论文列表"
            aria-label="论文列表"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-zinc-200 text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-900"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          </a>
          <ThemeToggle className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-zinc-200 bg-white text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-900" />
        </div>

        <div className="hidden items-center gap-2 lg:flex">
          <h2 className="text-sm font-medium tracking-normal text-zinc-950 dark:text-white">
            chat
          </h2>
          {taskId ? (
            <TaskStatusBadge
              status={taskStatus}
              killing={killing}
              restarting={restarting}
              killingStartedAt={killingStartedAt}
              onKill={handleKillTask}
              onRestart={handleRestartTask}
            />
          ) : null}
        </div>

        <div className="inline-flex items-center gap-2 lg:hidden">
          {taskId ? (
            <TaskStatusBadge
              status={taskStatus}
              killing={killing}
              restarting={restarting}
              killingStartedAt={killingStartedAt}
              onKill={handleKillTask}
              onRestart={handleRestartTask}
            />
          ) : null}
          {/* Mobile-only tab group. Icon-only to save horizontal real estate
              alongside the status badge. Accessible name comes from aria-label
              / title since the visual label is dropped. */}
          <div className="inline-flex h-8 shrink-0 overflow-hidden rounded-md border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
            <Link
              href={chatPath(paper, "pdf")}
              scroll={false}
              aria-pressed={false}
              aria-label="PDF"
              title="PDF"
              className="inline-flex w-9 items-center justify-center text-zinc-600 transition hover:bg-white dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              <FileText className="h-4 w-4" aria-hidden="true" />
            </Link>
            <Link
              href={chatPath(paper, "html")}
              scroll={false}
              aria-pressed={false}
              aria-label="HTML"
              title="HTML"
              className="inline-flex w-9 items-center justify-center border-l border-zinc-200 text-zinc-600 transition hover:bg-white dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              <Globe2 className="h-4 w-4" aria-hidden="true" />
            </Link>
            <Link
              href={chatPath(paper, "chat")}
              scroll={false}
              aria-pressed
              aria-label="Chat"
              title="Chat"
              className="inline-flex w-9 items-center justify-center border-l border-zinc-200 bg-zinc-950 text-white dark:border-zinc-800 dark:bg-white dark:text-zinc-950"
            >
              <MessageSquare className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        {!authenticated ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center">
            <p className="text-sm text-zinc-600 dark:text-zinc-300">
              登录后开始论文对话
            </p>
            <a
              href="/api/auth/login"
              className="inline-flex h-10 items-center gap-2 rounded-md bg-zinc-950 px-4 text-sm font-medium text-white transition hover:bg-zinc-800 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200"
            >
              <LogIn className="h-4 w-4" aria-hidden="true" />
              使用 Conductor 登录
            </a>
          </div>
        ) : bindError ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
            <p className="text-sm text-red-700 dark:text-red-300">
              聊天初始化失败
            </p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {bindError}
            </p>
            <button
              type="button"
              onClick={retryBindManually}
              className="inline-flex h-8 items-center rounded-md border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-900"
            >
              重试
            </button>
          </div>
        ) : !taskId ? (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-zinc-500 dark:text-zinc-400">
            加载中…
          </div>
        ) : (
          // SDK 0.4.x renders messages itself (no more MessageBubble export);
          // we let ChatView handle layout & per-message toolbar. Restart is
          // exposed externally via the TaskStatusBadge below for now until the
          // chat-migration worktree lands its replacement UI.
          <ChatView
            taskId={taskId}
            adapter={adapter}
            onError={handleChatError}
            labels={CHAT_LABELS}
            className="absolute inset-0"
          />
        )}
      </div>
    </section>
  );
}
