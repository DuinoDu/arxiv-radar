"use client";

/**
 * Custom MessageList for the paper chat.
 *
 * Replaces `@love-moon/app-sdk`'s default `<MessageList>` so each bubble
 * can host the double-click popup toolbar (Resend / Copy / Restart /
 * Interrupt). Talks to the same `useChat()` provider — auto-scroll +
 * load-earlier behaviour are reimplemented here mirror-image-equivalent
 * to the SDK version.
 *
 * The SDK's CSS rules at `.conductor-message-list`, `.conductor-message`,
 * `.conductor-bubble`, `.conductor-load-earlier` still apply; our wrapper
 * class names match so globals.css overrides (zinc theming) cover this
 * component too.
 */

import { useEffect, useLayoutEffect, useRef } from "react";
import { useChat } from "@love-moon/app-sdk/react";
import type { ChatViewLabels } from "@love-moon/app-sdk/react";
import { MessageBubble } from "./MessageBubble";

export interface MessageListProps {
  labels: ChatViewLabels;
  /** Forwarded to bubble's resend action. Called with the message content. */
  onResend?: (content: string) => void;
  /** Forwarded to bubble's restart action. Provided when the task can restart. */
  onRestart?: () => void;
  restartEnabled?: boolean;
  restartPending?: boolean;
  /** Forwarded to bubble's interrupt action. */
  onInterrupt?: () => void;
  interruptPending?: boolean;
}

export function MessageList({
  labels,
  onResend,
  onRestart,
  restartEnabled = false,
  restartPending = false,
  onInterrupt,
  interruptPending = false,
}: MessageListProps) {
  const { state, loadEarlier } = useChat();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const lastMessageCountRef = useRef(state.messages.length);

  // Auto-scroll to bottom when new messages arrive, unless the user has
  // scrolled up to read history (then leave their position alone).
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const grew = state.messages.length > lastMessageCountRef.current;
    lastMessageCountRef.current = state.messages.length;
    if (!grew) return;
    const distanceFromBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceFromBottom < 120) {
      el.scrollTop = el.scrollHeight;
    }
  }, [state.messages.length]);

  // On first paint, snap to bottom.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, []);

  // Interrupt is meaningful only while a reply is in progress + we know
  // which reply to target. Compute here so the same flag drives every
  // bubble's action button enabled-state.
  const replyInProgress = state.runtime?.replyInProgress === true;
  const interruptEnabled = replyInProgress && Boolean(state.latestReplyId);

  return (
    <div
      ref={containerRef}
      className="conductor-message-list"
      role="log"
      aria-live="polite"
    >
      {state.hasMoreBefore && (
        <div className="conductor-load-earlier">
          <button
            type="button"
            onClick={() => {
              void loadEarlier();
            }}
            disabled={state.loadingHistory}
          >
            {state.loadingHistory ? "…" : labels.loadEarlier}
          </button>
        </div>
      )}
      {state.messages.length === 0 && !state.loadingHistory ? (
        <div className="conductor-empty" />
      ) : null}
      {state.messages.map((m) => {
        const isUser = m.role === "user" || m.role === "sdk";
        return (
          <MessageBubble
            key={m.id}
            message={m}
            // Resend is only for user-side bubbles.
            onResend={isUser && onResend ? onResend : undefined}
            onRestart={onRestart}
            restartEnabled={restartEnabled}
            restartPending={restartPending}
            onInterrupt={onInterrupt}
            interruptEnabled={interruptEnabled}
            interruptPending={interruptPending}
          />
        );
      })}
    </div>
  );
}
