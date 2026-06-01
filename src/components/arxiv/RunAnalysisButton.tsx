"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, Play } from "lucide-react";

type RunState = "idle" | "running" | "done" | "error";

interface RunAnalysisPayload {
  ok?: boolean;
  code?: string;
  error?: string;
  run?: {
    id?: string;
    analyzedCount?: number;
    skippedAlreadyProcessedCount?: number;
    failedCount?: number;
  };
}

const RUNNING_POLL_MS = 8000;

export function RunAnalysisButton({
  disabled = false,
  isRunning = false,
  runningRunId,
}: {
  disabled?: boolean;
  /**
   * When true, the button is rendered in the "running" state on mount — used
   * to hydrate from server-side state so a page refresh during a run doesn't
   * re-enable the button and let the user kick off a second run.
   */
  isRunning?: boolean;
  runningRunId?: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<RunState>(isRunning ? "running" : "idle");
  const [message, setMessage] = useState(
    isRunning && runningRunId ? `任务运行中（${runningRunId}）` : "",
  );
  // Tracks whether the *current* running state was started by an in-flight
  // POST from this component. If so, we await the POST instead of polling so
  // we can show the final result inline.
  const ownsRequestRef = useRef(false);

  // Hydration: if parent says a run is in progress (or stops being in
  // progress), reflect that immediately.
  useEffect(() => {
    if (isRunning) {
      setState((current) => (current === "running" ? current : "running"));
      if (runningRunId) {
        setMessage((current) => current || `任务运行中（${runningRunId}）`);
      }
    } else if (!ownsRequestRef.current) {
      // The server says no run is in progress and we did not start one
      // ourselves — drop back to idle so the button is usable again.
      setState((current) => (current === "running" ? "idle" : current));
    }
  }, [isRunning, runningRunId]);

  // While running, keep refreshing the server-side data so the parent's
  // `isRunning` prop can flip to false as soon as the run finishes.
  useEffect(() => {
    if (state !== "running") return;
    const timer = setInterval(() => {
      router.refresh();
    }, RUNNING_POLL_MS);
    return () => clearInterval(timer);
  }, [router, state]);

  const runAnalysis = useCallback(async () => {
    if (disabled || state === "running") {
      return;
    }

    setState("running");
    setMessage("");
    ownsRequestRef.current = true;

    try {
      const response = await fetch("/api/cron/arxiv", {
        method: "POST",
      });
      const payload = (await response.json()) as RunAnalysisPayload;

      if (response.status === 409 || payload.code === "already_running") {
        // Another trigger beat us to it — stay in running state and let the
        // periodic refresh pick up completion.
        setMessage(
          payload.run?.id
            ? `已有任务在跑（${payload.run.id}），等它完成`
            : "已有任务在跑，等它完成",
        );
        router.refresh();
        return;
      }

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Analysis failed");
      }

      const analyzedCount = payload.run?.analyzedCount ?? 0;
      const skippedCount = payload.run?.skippedAlreadyProcessedCount ?? 0;
      const failedCount = payload.run?.failedCount ?? 0;
      const resultParts = [`新增 ${analyzedCount} 篇`, `跳过 ${skippedCount} 篇`];
      if (failedCount > 0) {
        resultParts.push(`失败 ${failedCount} 篇`);
      }

      setState("done");
      setMessage(resultParts.join("，"));
      router.refresh();
    } catch (error) {
      setState("error");
      setMessage((error as Error).message);
    } finally {
      ownsRequestRef.current = false;
    }
  }, [disabled, router, state]);

  const icon =
    state === "running" ? (
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
    ) : state === "done" ? (
      <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
    ) : state === "error" ? (
      <AlertCircle className="h-4 w-4" aria-hidden="true" />
    ) : (
      <Play className="h-4 w-4" aria-hidden="true" />
    );

  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <button
        type="button"
        onClick={runAnalysis}
        disabled={disabled || state === "running"}
        className="inline-flex min-h-10 items-center gap-2 rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-70 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200"
      >
        {icon}
        {state === "running" ? "分析中" : "立即分析"}
      </button>
      {disabled ? <p className="max-w-72 text-left text-xs text-zinc-500 dark:text-zinc-400 sm:text-right">手动触发已关闭</p> : null}
      {message ? (
        <p
          className={`max-w-72 text-left text-xs sm:text-right ${
            state === "error" ? "text-red-600 dark:text-red-400" : "text-zinc-500 dark:text-zinc-400"
          }`}
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
