"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  ChatProvider,
  MessageInput,
  RuntimeStatusBar,
  useChat,
  type ChatAdapter,
  type ChatViewLabels,
  type RenderMessageContent,
  type Message,
} from "@love-moon/app-sdk/react";
import { ChevronDown, Copy, Check } from "lucide-react";

interface EnhancedChatViewProps {
  taskId: string;
  adapter: ChatAdapter;
  labels: ChatViewLabels;
  onError?: (error: unknown) => void;
  renderMessageContent?: RenderMessageContent;
  className?: string;
  readOnly?: boolean;
}

/**
 * Drop-in replacement for the SDK's ChatView that adds:
 *  1. Double-click → bottom action sheet (copy)
 *  2. "N 条新消息" anchor when scrolled up and new messages arrive
 *  3. Scroll-to-bottom button when scrolled away from the latest messages
 */
export function EnhancedChatView(props: EnhancedChatViewProps) {
  const className = ["conductor-chat-view", props.className]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={className} data-task-id={props.taskId} data-layout="auto">
      <ChatProvider
        taskId={props.taskId}
        adapter={props.adapter}
        onError={props.onError}
      >
        <RuntimeStatusBar labels={props.labels} />
        <EnhancedMessageArea
          labels={props.labels}
          renderMessageContent={props.renderMessageContent}
        />
        <MessageInput labels={props.labels} disabled={props.readOnly} />
      </ChatProvider>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Enhanced message area                                              */
/* ------------------------------------------------------------------ */

function EnhancedMessageArea({
  labels,
  renderMessageContent,
}: {
  labels: ChatViewLabels;
  renderMessageContent?: RenderMessageContent;
}) {
  const { state, loadEarlier } = useChat();
  const containerRef = useRef<HTMLDivElement>(null);
  const lastMessageCountRef = useRef(state.messages.length);

  const [isScrolledUp, setIsScrolledUp] = useState(false);
  const [newMessageCount, setNewMessageCount] = useState(0);
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);
  const [copied, setCopied] = useState(false);

  // Auto-scroll to bottom when new messages arrive and user is near bottom
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const grew = state.messages.length > lastMessageCountRef.current;
    const diff = state.messages.length - lastMessageCountRef.current;
    lastMessageCountRef.current = state.messages.length;
    if (!grew) return;

    const distanceFromBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceFromBottom < 120) {
      el.scrollTop = el.scrollHeight;
    } else {
      setNewMessageCount((prev) => prev + diff);
    }
  }, [state.messages.length]);

  // Initial scroll to bottom
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, []);

  // Track scroll position
  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const distanceFromBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight;
    const scrolledUp = distanceFromBottom > 200;
    setIsScrolledUp(scrolledUp);
    if (!scrolledUp) {
      setNewMessageCount(0);
    }
  }, []);

  const scrollToBottom = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    setNewMessageCount(0);
  }, []);

  // Double-click on a bubble → open action sheet
  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement;
      const bubble = target.closest(".conductor-bubble");
      if (!bubble) return;
      const messageEl = bubble.closest("[data-message-id]");
      if (!messageEl) return;
      const messageId = messageEl.getAttribute("data-message-id");
      const message = state.messages.find((m) => m.id === messageId);
      if (message) {
        e.preventDefault();
        setSelectedMessage(message);
        setCopied(false);
      }
    },
    [state.messages],
  );

  const handleCopy = useCallback(async () => {
    if (!selectedMessage) return;
    try {
      await navigator.clipboard.writeText(selectedMessage.content);
      setCopied(true);
      setTimeout(() => {
        setSelectedMessage(null);
        setCopied(false);
      }, 600);
    } catch {
      setSelectedMessage(null);
    }
  }, [selectedMessage]);

  return (
    <div className="relative min-h-0">
      {/* ---------- Message list (mirrors SDK MessageList DOM) ---------- */}
      <div
        ref={containerRef}
        className="conductor-message-list absolute inset-0"
        role="log"
        aria-live="polite"
        onScroll={handleScroll}
        onDoubleClick={handleDoubleClick}
      >
        {state.hasMoreBefore && (
          <div className="conductor-load-earlier">
            <button
              type="button"
              onClick={() => void loadEarlier()}
              disabled={state.loadingHistory}
            >
              {state.loadingHistory ? "…" : labels.loadEarlier}
            </button>
          </div>
        )}

        {state.messages.length === 0 && !state.loadingHistory && (
          <div className="conductor-empty" />
        )}

        {state.messages.map((m) => {
          const isUser = m.role === "user" || m.role === "sdk";
          const isPending = m.id.startsWith("pending:");
          const content = renderMessageContent
            ? renderMessageContent(m)
            : m.content;
          return (
            <div
              key={m.id}
              className={
                "conductor-message " +
                (isUser
                  ? "conductor-message--user"
                  : "conductor-message--assistant") +
                (isPending ? " conductor-message--pending" : "")
              }
              data-role={m.role}
              data-message-id={m.id}
            >
              <div className="conductor-bubble">{content}</div>
            </div>
          );
        })}
      </div>

      {/* ---------- New-messages anchor ---------- */}
      {isScrolledUp && newMessageCount > 0 && (
        <button
          type="button"
          onClick={scrollToBottom}
          className="absolute bottom-14 left-1/2 z-10 -translate-x-1/2 rounded-full bg-zinc-900 px-3 py-1 text-xs font-medium text-white shadow-lg transition-opacity hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          {newMessageCount} 条新消息 ↓
        </button>
      )}

      {/* ---------- Scroll-to-bottom button ---------- */}
      {isScrolledUp && (
        <button
          type="button"
          onClick={scrollToBottom}
          aria-label="滚动到底部"
          className="absolute bottom-4 right-4 z-10 flex h-8 w-8 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-600 shadow-md transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
        >
          <ChevronDown className="h-4 w-4" />
        </button>
      )}

      {/* ---------- Bottom action sheet (double-click popup) ---------- */}
      {selectedMessage && (
        <>
          <div
            className="fixed inset-0 z-50 bg-black/30 dark:bg-black/50"
            onClick={() => setSelectedMessage(null)}
          />
          <div className="conductor-action-sheet fixed inset-x-0 bottom-0 z-50 rounded-t-2xl border-t border-zinc-200 bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] dark:border-zinc-700 dark:bg-zinc-900">
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-zinc-300 dark:bg-zinc-600" />
            <button
              type="button"
              onClick={handleCopy}
              className="flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              {copied ? (
                <Check className="h-4 w-4 text-green-600 dark:text-green-400" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
              {copied ? "已复制" : "复制"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
