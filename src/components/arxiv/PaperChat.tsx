"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, FileText, Globe2, MessageSquare } from "lucide-react";
import {
  ChatProvider,
  MessageInput,
  MessageList,
  RuntimeStatusBar,
  createRestAdapter,
  type ChatViewLabels,
} from "@love-moon/app-sdk/react";
import { isConductorAppError } from "@love-moon/app-sdk";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import type { AnalyzedPaper } from "@/lib/arxiv/types";

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

// Cap auto-rebind attempts so a sticky upstream `task_not_found` (Conductor
// outage, token rotation, project deletion) can't spin the counter forever.
// Past this, surface a manual retry button that resets the counter.
const MAX_AUTO_REBINDS = 3;

export function PaperChat({ paper }: { paper: AnalyzedPaper }) {
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

  useEffect(() => {
    const controller = new AbortController();

    async function bind() {
      setTaskId(null);
      setBindError(null);

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
  }, [paper.id, bindAttempt]);

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
    // Cap exhausted. Surface a bindError so the error pane (with the
    // retry button) replaces the now-dead ChatView and the user has a
    // way back. Without this the user just stares at the SDK's internal
    // error bubble with no escape short of a tab reload.
    setBindError("聊天会话失效，无法自动恢复。请点击重试或刷新页面。");
    setTaskId(null);
  }

  function retryBindManually() {
    setBindError(null);
    setAutoRebinds(0);
    setBindAttempt((n) => n + 1);
  }

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

        <h2 className="hidden text-sm font-medium tracking-normal text-zinc-950 dark:text-white lg:block">
          chat
        </h2>

        <div className="inline-flex h-8 shrink-0 overflow-hidden rounded-md border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 lg:hidden">
          <Link
            href={chatPath(paper, "pdf")}
            scroll={false}
            aria-pressed={false}
            className="inline-flex items-center gap-1.5 px-2.5 text-xs font-medium text-zinc-600 transition hover:bg-white dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            <FileText className="h-4 w-4" aria-hidden="true" />
            PDF
          </Link>
          <Link
            href={chatPath(paper, "html")}
            scroll={false}
            aria-pressed={false}
            className="inline-flex items-center gap-1.5 border-l border-zinc-200 px-2.5 text-xs font-medium text-zinc-600 transition hover:bg-white dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            <Globe2 className="h-4 w-4" aria-hidden="true" />
            HTML
          </Link>
          <Link
            href={chatPath(paper, "chat")}
            scroll={false}
            aria-pressed
            className="inline-flex items-center gap-1.5 border-l border-zinc-200 bg-zinc-950 px-2.5 text-xs font-medium text-white dark:border-zinc-800 dark:bg-white dark:text-zinc-950"
          >
            <MessageSquare className="h-4 w-4" aria-hidden="true" />
            Chat
          </Link>
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        {bindError ? (
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
          // Manual composition (instead of `<ChatView>`) so we can put the
          // runtime status bar above the input (the SDK's <ChatView> hard-codes
          // it at the top of the panel). `conductor-chat-view` is kept as the
          // wrapper class so the SDK's component CSS applies, and globals.css
          // overrides the SDK's `display: grid` to a flex column to drive the
          // ordering from DOM order.
          <div
            className="conductor-chat-view absolute inset-0"
            data-task-id={taskId}
            data-layout="auto"
          >
            <ChatProvider
              taskId={taskId}
              adapter={adapter}
              onError={handleChatError}
            >
              <MessageList labels={CHAT_LABELS} />
              <RuntimeStatusBar labels={CHAT_LABELS} />
              <MessageInput labels={CHAT_LABELS} />
            </ChatProvider>
          </div>
        )}
      </div>
    </section>
  );
}
