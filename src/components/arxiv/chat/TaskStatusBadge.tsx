"use client";

/**
 * TaskStatusBadge — a click-to-confirm status pill for the chat top bar.
 *
 * Mirrors Conductor's main-app `TaskStatusBadge` + `TaskItem` interaction
 * model, distilled for the paper-chat case:
 *
 *   running → click → "killing?" (red) → click → "killing…" (during the
 *   PATCH) → backend transitions through "killing" (with countdown) to
 *   "killed".
 *
 *   killed / completed / failed / unknown → click → "restart?" (amber) →
 *   click → "restarting…" → fresh task starts; status flips back to
 *   "running".
 *
 * Confirm state is dismissed by clicking anywhere outside the badge.
 *
 * The component is purely presentational + click-state. Network calls
 * (kill / restart / refetch) and status polling live in the parent
 * (`useTaskLifecycle` inside PaperChat).
 */

import { useEffect, useMemo, useRef, useState } from "react";

export type ChatTaskStatus =
  | "init"
  | "pending"
  | "running"
  | "killing"
  | "killed"
  | "completed"
  | "failed"
  | "cancelled"
  | "unknown"
  | string;

interface TaskStatusBadgeProps {
  status: ChatTaskStatus;
  /** When set, the badge becomes a button. Otherwise it's a static span. */
  onKill?: () => void;
  onRestart?: () => void;
  /** Show "killing…" during the in-flight PATCH call. */
  killing?: boolean;
  /** Show "restarting…" during the in-flight restart call. */
  restarting?: boolean;
  /** ISO timestamp the killing transition started, for the elapsed counter. */
  killingStartedAt?: string | null;
}

const DEFAULT_KILLING_TIMEOUT_MS = 60_000;

interface StatusStyle {
  label: string;
  className: string;
  pulse: boolean;
}

function describe(status: ChatTaskStatus): StatusStyle {
  switch (status) {
    case "running":
      return {
        label: "running",
        className:
          "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
        pulse: true,
      };
    case "killing":
      return {
        label: "killing",
        className:
          "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
        pulse: true,
      };
    case "killed":
    case "cancelled":
      return {
        label: status,
        className:
          "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
        pulse: false,
      };
    case "completed":
      return {
        label: "completed",
        className:
          "bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400",
        pulse: false,
      };
    case "failed":
      return {
        label: "failed",
        className:
          "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
        pulse: false,
      };
    case "init":
    case "pending":
      return {
        label: status,
        className:
          "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300",
        pulse: false,
      };
    default:
      return {
        label: String(status || "unknown"),
        className:
          "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
        pulse: false,
      };
  }
}

function isRunningish(status: ChatTaskStatus): boolean {
  return status === "running" || status === "init" || status === "pending";
}

function isStoppedish(status: ChatTaskStatus): boolean {
  return (
    status === "killed" ||
    status === "completed" ||
    status === "failed" ||
    status === "cancelled" ||
    status === "unknown"
  );
}

export function TaskStatusBadge({
  status,
  onKill,
  onRestart,
  killing = false,
  restarting = false,
  killingStartedAt,
}: TaskStatusBadgeProps) {
  const [confirm, setConfirm] = useState<"none" | "kill" | "restart">("none");
  const badgeRef = useRef<HTMLDivElement | null>(null);
  const style = describe(status);

  // Derived: the confirm state we actually *show*. If the server's status
  // changed underneath us such that the pending confirm action no longer
  // applies (e.g. user clicked "kill?" then status flipped to killed), we
  // treat confirm as cleared without touching state. The next user click
  // calls setConfirm to refresh the underlying state.
  const displayConfirm: "none" | "kill" | "restart" =
    confirm === "kill" && isRunningish(status)
      ? "kill"
      : confirm === "restart" && isStoppedish(status)
        ? "restart"
        : "none";

  // Dismiss confirm on any outside pointerdown.
  useEffect(() => {
    if (displayConfirm === "none") return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (!target || !badgeRef.current?.contains(target)) {
        setConfirm("none");
      }
    }
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [displayConfirm]);

  // Killing-state elapsed seconds counter (ticking once a second). We
  // intentionally *don't* synchronously reset nowMs on transitions —
  // `Math.max(0, ...)` below clamps the first frame after killingStartedAt
  // jumps forward, and the interval catches up within 1s.
  const killingStartedAtMs = useMemo(() => {
    if (status !== "killing" || !killingStartedAt) return null;
    const parsed = Date.parse(killingStartedAt);
    return Number.isFinite(parsed) ? parsed : null;
  }, [status, killingStartedAt]);
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (status !== "killing") return;
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [status]);

  const elapsedSeconds =
    status === "killing"
      ? Math.max(0, Math.floor((nowMs - (killingStartedAtMs ?? nowMs)) / 1000))
      : 0;
  const killingTimedOut =
    status === "killing" &&
    elapsedSeconds * 1000 >= DEFAULT_KILLING_TIMEOUT_MS;

  // Resolved label + tone after factoring in pending + confirm states.
  let label = style.label;
  let className = style.className;
  let title: string | undefined;

  if (killing) {
    label = "killing…";
    className =
      "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400";
  } else if (restarting) {
    label = "restarting…";
    className =
      "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300";
  } else if (displayConfirm === "kill") {
    label = "killing?";
    className =
      "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400";
    title = "再次点击以终止当前任务";
  } else if (displayConfirm === "restart") {
    label = "restart?";
    className =
      "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300";
    title = "再次点击以重启当前任务";
  } else if (status === "killing") {
    const cap = Math.ceil(DEFAULT_KILLING_TIMEOUT_MS / 1000);
    const display = Math.min(elapsedSeconds, cap);
    label = killingTimedOut
      ? `killing ${display}s timeout`
      : `killing ${display}s`;
    title = killingTimedOut
      ? `Killing 超时（>${cap}s）`
      : `已 killing ${display} 秒`;
    if (killingTimedOut) {
      className =
        "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400";
    }
  }

  const interactive =
    !killing &&
    !restarting &&
    ((onKill && isRunningish(status)) || (onRestart && isStoppedish(status)));
  const shouldPulse =
    (status === "running" || status === "killing") && !killing && !restarting;
  const baseClass =
    "inline-flex items-center rounded-md px-2.5 py-1 text-xs font-medium";
  const fullClass = `${baseClass} ${className}`;

  function handleClick() {
    if (killing || restarting) return;
    if (isRunningish(status) && onKill) {
      if (displayConfirm !== "kill") {
        setConfirm("kill");
        return;
      }
      setConfirm("none");
      onKill();
      return;
    }
    if (isStoppedish(status) && onRestart) {
      if (displayConfirm !== "restart") {
        setConfirm("restart");
        return;
      }
      setConfirm("none");
      onRestart();
      return;
    }
  }

  return (
    <div ref={badgeRef} className="inline-flex">
      {interactive ? (
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            handleClick();
          }}
          title={title ?? label}
          aria-label={label}
          className={`${fullClass} transition-colors hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-70`}
        >
          {shouldPulse ? (
            <span className="mr-1.5 h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
          ) : null}
          {label}
        </button>
      ) : (
        <span className={fullClass} title={title ?? label}>
          {shouldPulse ? (
            <span className="mr-1.5 h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
          ) : null}
          {label}
        </span>
      )}
    </div>
  );
}
