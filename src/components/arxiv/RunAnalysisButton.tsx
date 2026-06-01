"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, Play } from "lucide-react";

type RunState = "idle" | "running" | "done" | "error";

interface RunAnalysisPayload {
  ok?: boolean;
  error?: string;
  run?: {
    analyzedCount?: number;
    skippedAlreadyProcessedCount?: number;
    failedCount?: number;
  };
}

export function RunAnalysisButton({ disabled = false }: { disabled?: boolean }) {
  const router = useRouter();
  const [state, setState] = useState<RunState>("idle");
  const [message, setMessage] = useState("");

  async function runAnalysis() {
    if (disabled) {
      return;
    }

    setState("running");
    setMessage("");

    try {
      const response = await fetch("/api/cron/arxiv", {
        method: "POST",
      });
      const payload = (await response.json()) as RunAnalysisPayload;

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
    }
  }

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
