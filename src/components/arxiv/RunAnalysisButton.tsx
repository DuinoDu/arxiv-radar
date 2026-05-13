"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, Play } from "lucide-react";

type RunState = "idle" | "running" | "done" | "error";

export function RunAnalysisButton() {
  const router = useRouter();
  const [state, setState] = useState<RunState>("idle");
  const [message, setMessage] = useState("");

  async function runAnalysis() {
    setState("running");
    setMessage("");

    try {
      const response = await fetch("/api/cron/arxiv", {
        method: "POST",
      });
      const payload = await response.json();

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Analysis failed");
      }

      setState("done");
      setMessage(`新增 ${payload.run.analyzedCount} 篇，跳过 ${payload.run.skippedAlreadyProcessedCount} 篇`);
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
        disabled={state === "running"}
        className="inline-flex min-h-10 items-center gap-2 rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-70 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200"
      >
        {icon}
        {state === "running" ? "分析中" : "立即分析"}
      </button>
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
