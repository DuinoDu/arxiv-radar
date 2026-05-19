"use client";

/**
 * MessageBubble for the paper chat.
 *
 * Ported from Conductor's main app `web/src/features/chat/components/
 * MessageBubble.tsx`, adapted to arxiv-radar's zinc palette + lucide icons.
 *
 * Trigger surface (matches main app):
 *   - Desktop  : double-click on the bubble body
 *   - Touch    : double-tap (≤320ms gap)
 *   - Keyboard : Enter / Space on focused bubble; Esc closes
 *
 * The toolbar is a bottom-sheet covering the viewport (z-50), exactly like
 * the main app. On the desktop split layout this covers PDF too — accepted
 * UX trade-off for visual parity with the main app.
 *
 * Actions are wired by the parent; this component is presentation +
 * input handling only.
 */

import { useEffect, useRef, useState } from "react";
import { Check, Copy, RotateCcw, Square, RefreshCw } from "lucide-react";
import type { Message } from "@love-moon/app-sdk";

export interface MessageBubbleProps {
  message: Message;
  /** Resend the user message content. Only meaningful for user/sdk bubbles. */
  onResend?: (content: string) => void;
  /** Restart the underlying task. Bubble shows the button when handler is provided. */
  onRestart?: () => void;
  restartEnabled?: boolean;
  restartPending?: boolean;
  /** Interrupt the in-flight reply. Bubble shows the button when handler is provided. */
  onInterrupt?: () => void;
  interruptEnabled?: boolean;
  interruptPending?: boolean;
}

const TOUCH_DOUBLE_TAP_MS = 320;

function isInteractiveTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    Boolean(target.closest("a, button, audio, video, summary"))
  );
}

export function MessageBubble({
  message,
  onResend,
  onRestart,
  restartEnabled = false,
  restartPending = false,
  onInterrupt,
  interruptEnabled = false,
  interruptPending = false,
}: MessageBubbleProps) {
  const isUser = message.role === "user" || message.role === "sdk";
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");
  const [isToolbarOpen, setIsToolbarOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const lastTouchEndAtRef = useRef(0);

  // Outside-click + Esc to dismiss the toolbar.
  useEffect(() => {
    if (!isToolbarOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (
        target &&
        (rootRef.current?.contains(target) ||
          toolbarRef.current?.contains(target))
      ) {
        return;
      }
      setIsToolbarOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsToolbarOpen(false);
    };

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isToolbarOpen]);

  async function copyMessage() {
    try {
      let copied = false;
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(message.content);
        copied = true;
      }
      if (!copied) {
        // Fallback for non-secure contexts (HTTP, file://, etc.).
        const textarea = document.createElement("textarea");
        textarea.value = message.content;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "fixed";
        textarea.style.top = "-1000px";
        textarea.style.left = "-1000px";
        document.body.appendChild(textarea);
        textarea.select();
        copied = document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      if (copied) {
        setCopyState("copied");
        setIsToolbarOpen(false);
        window.setTimeout(() => setCopyState("idle"), 1500);
      }
    } catch {
      setCopyState("idle");
    }
  }

  function resendMessage() {
    if (!message.content.trim()) return;
    onResend?.(message.content);
    setIsToolbarOpen(false);
  }

  function restartTask() {
    if (!restartEnabled || restartPending) return;
    onRestart?.();
    setIsToolbarOpen(false);
  }

  function interruptTurn() {
    if (!interruptEnabled || interruptPending) return;
    onInterrupt?.();
    setIsToolbarOpen(false);
  }

  const actionBtn =
    "inline-flex h-11 w-11 items-center justify-center rounded-xl text-zinc-700 transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent dark:text-zinc-200 dark:hover:bg-zinc-800";

  return (
    <>
      <div className="conductor-message" data-role={message.role}>
        <div
          ref={rootRef}
          className={`conductor-bubble cursor-pointer select-text ${
            isUser ? "conductor-bubble--user" : "conductor-bubble--assistant"
          }`}
          role="button"
          tabIndex={0}
          aria-expanded={isToolbarOpen}
          onDoubleClick={(event) => {
            if (isInteractiveTarget(event.target)) return;
            setIsToolbarOpen(true);
          }}
          onTouchEnd={(event) => {
            if (isInteractiveTarget(event.target)) {
              lastTouchEndAtRef.current = 0;
              return;
            }
            const now = Date.now();
            if (now - lastTouchEndAtRef.current <= TOUCH_DOUBLE_TAP_MS) {
              lastTouchEndAtRef.current = 0;
              event.preventDefault();
              setIsToolbarOpen(true);
              return;
            }
            lastTouchEndAtRef.current = now;
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              setIsToolbarOpen(true);
            }
            if (event.key === "Escape") setIsToolbarOpen(false);
          }}
        >
          {message.content}
        </div>
      </div>

      {isToolbarOpen ? (
        <div
          className="fixed inset-0 z-50"
          onClick={() => setIsToolbarOpen(false)}
        >
          <div className="absolute inset-0 bg-black/30" />
          <div
            ref={toolbarRef}
            className="absolute inset-x-0 bottom-0 rounded-t-3xl border border-zinc-200 bg-white p-4 shadow-2xl dark:border-zinc-800 dark:bg-zinc-950"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-zinc-200 dark:bg-zinc-700" />
            <div className="flex items-center justify-center gap-2">
              {onResend ? (
                <button
                  type="button"
                  aria-label="重发消息"
                  title="重发消息"
                  disabled={!message.content.trim()}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    resendMessage();
                  }}
                  className={actionBtn}
                >
                  <RotateCcw className="h-5 w-5" aria-hidden="true" />
                </button>
              ) : null}

              <button
                type="button"
                aria-label={copyState === "copied" ? "已复制" : "复制消息"}
                title={copyState === "copied" ? "已复制" : "复制消息"}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  void copyMessage();
                }}
                className={actionBtn}
              >
                {copyState === "copied" ? (
                  <Check className="h-5 w-5" aria-hidden="true" />
                ) : (
                  <Copy className="h-5 w-5" aria-hidden="true" />
                )}
              </button>

              {onRestart ? (
                <button
                  type="button"
                  data-testid="message-bubble-restart-button"
                  aria-label={restartPending ? "重启进行中" : "重启 AI 任务"}
                  title={restartPending ? "重启进行中" : "重启 AI 任务"}
                  disabled={!restartEnabled || restartPending}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    restartTask();
                  }}
                  className={actionBtn}
                >
                  <RefreshCw className="h-5 w-5" aria-hidden="true" />
                </button>
              ) : null}

              {onInterrupt ? (
                <button
                  type="button"
                  data-testid="message-bubble-interrupt-button"
                  aria-label={
                    interruptPending ? "停止中" : "停止当前回复"
                  }
                  title={interruptPending ? "停止中" : "停止当前回复"}
                  disabled={!interruptEnabled || interruptPending}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    interruptTurn();
                  }}
                  className={actionBtn}
                >
                  <Square className="h-5 w-5" aria-hidden="true" />
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
