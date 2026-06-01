"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Loader2, Pause, Play, RefreshCw } from "lucide-react";
import type {
  AnalysisRun,
  AnalysisRunLogEntry,
  AnalysisRunLogLevel,
  RunStatus,
} from "@/lib/arxiv/types";

const RUNNING_POLL_MS = 3000;

const statusLabels: Record<RunStatus, string> = {
  running: "运行中",
  completed: "已完成",
  failed: "失败",
};

const statusStyles: Record<RunStatus, string> = {
  running:
    "bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-950/40 dark:text-sky-200 dark:ring-sky-900",
  completed:
    "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:ring-emerald-900",
  failed:
    "bg-red-50 text-red-700 ring-red-200 dark:bg-red-950/40 dark:text-red-200 dark:ring-red-900",
};

function logLevelStyle(level: AnalysisRunLogLevel) {
  switch (level) {
    case "error":
      return "text-red-600 dark:text-red-400";
    case "warn":
      return "text-amber-600 dark:text-amber-400";
    default:
      return "text-zinc-700 dark:text-zinc-300";
  }
}

function formatDateTime(value: string | undefined, timeZone: string) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone,
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(date);
}

function formatLogTimestamp(value: string, timeZone: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

interface LogsPayload {
  ok?: boolean;
  error?: string;
  logs?: AnalysisRunLogEntry[];
}

interface RunsLatestPayload {
  ok?: boolean;
  error?: string;
  run?: AnalysisRun;
}

export function RunLogsView({
  run: initialRun,
  initialLogs,
  timeZone,
}: {
  run: AnalysisRun;
  initialLogs: AnalysisRunLogEntry[];
  timeZone: string;
}) {
  const router = useRouter();
  const [run, setRun] = useState<AnalysisRun>(initialRun);
  const [logs, setLogs] = useState<AnalysisRunLogEntry[]>(initialLogs);
  const [autoFollow, setAutoFollow] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [isPolling, setIsPolling] = useState(initialRun.status === "running");
  const logContainerRef = useRef<HTMLDivElement | null>(null);

  const sortedLogs = useMemo(() => {
    // Logs come back in id order already; we still defensively sort by ts in
    // case server ordering drifts (e.g. mixed batches).
    return [...logs].sort((left, right) => {
      const a = new Date(left.ts).getTime();
      const b = new Date(right.ts).getTime();
      return a - b;
    });
  }, [logs]);

  const fetchOnce = useCallback(async () => {
    try {
      const [logsResponse, runResponse] = await Promise.all([
        fetch(`/api/runs/${encodeURIComponent(run.id)}/logs`, {
          cache: "no-store",
        }),
        fetch(`/api/runs/${encodeURIComponent(run.id)}`, {
          cache: "no-store",
        }),
      ]);
      const logsPayload = (await logsResponse.json()) as LogsPayload;
      if (!logsResponse.ok || !logsPayload.ok) {
        throw new Error(logsPayload.error || "加载日志失败");
      }
      setLogs(logsPayload.logs ?? []);

      if (runResponse.ok) {
        const runPayload = (await runResponse.json()) as RunsLatestPayload;
        if (runPayload.ok && runPayload.run) {
          setRun(runPayload.run);
          if (runPayload.run.status !== "running") {
            setIsPolling(false);
          }
        }
      }
      setFetchError(null);
    } catch (error) {
      setFetchError((error as Error).message);
    }
  }, [run.id]);

  useEffect(() => {
    if (!isPolling) return;
    const timer = setInterval(() => {
      void fetchOnce();
    }, RUNNING_POLL_MS);
    return () => clearInterval(timer);
  }, [fetchOnce, isPolling]);

  // Re-sync from server-rendered prop when navigating between runs.
  useEffect(() => {
    setRun(initialRun);
    setLogs(initialLogs);
    setIsPolling(initialRun.status === "running");
  }, [initialRun, initialLogs]);

  // Auto-scroll to bottom when new logs arrive, unless the user has scrolled
  // up to read older lines.
  useEffect(() => {
    if (!autoFollow) return;
    const container = logContainerRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
  }, [sortedLogs, autoFollow]);

  function handleScroll() {
    const container = logContainerRef.current;
    if (!container) return;
    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    setAutoFollow(distanceFromBottom < 40);
  }

  const isRunning = run.status === "running";

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="inline-flex h-9 items-center gap-1 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-900"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            返回
          </Link>
          <h1 className="text-base font-semibold">Run 日志</h1>
          <span
            className={`rounded-full px-2 py-0.5 text-xs ring-1 ${statusStyles[run.status]}`}
          >
            {statusLabels[run.status]}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              void fetchOnce();
              router.refresh();
            }}
            className="inline-flex h-9 items-center gap-1 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-900"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            手动刷新
          </button>
          <button
            type="button"
            onClick={() => setIsPolling((current) => !current)}
            className="inline-flex h-9 items-center gap-1 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-900"
            aria-pressed={isPolling}
          >
            {isPolling ? (
              <>
                <Pause className="h-4 w-4" aria-hidden="true" />
                暂停自动刷新
              </>
            ) : (
              <>
                <Play className="h-4 w-4" aria-hidden="true" />
                开启自动刷新
              </>
            )}
          </button>
        </div>
      </header>

      <section className="grid gap-3 rounded-lg border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-800 dark:bg-zinc-950 sm:grid-cols-2">
        <div>
          <div className="text-xs uppercase text-zinc-400">Run ID</div>
          <div className="break-all font-mono text-xs">{run.id}</div>
        </div>
        <div>
          <div className="text-xs uppercase text-zinc-400">来源 URL</div>
          <div className="break-all text-xs text-zinc-700 dark:text-zinc-300">
            {run.sourceUrl}
          </div>
        </div>
        <div>
          <div className="text-xs uppercase text-zinc-400">开始时间</div>
          <div className="text-xs">{formatDateTime(run.startedAt, timeZone)}</div>
        </div>
        <div>
          <div className="text-xs uppercase text-zinc-400">结束时间</div>
          <div className="text-xs">{formatDateTime(run.finishedAt, timeZone)}</div>
        </div>
        <div>
          <div className="text-xs uppercase text-zinc-400">抓取 / 跳过 / 新增 / 失败</div>
          <div className="text-xs">
            {run.fetchedCount} / {run.skippedAlreadyProcessedCount} / {run.analyzedCount} / {run.failedCount}
          </div>
        </div>
        {run.message ? (
          <div className="sm:col-span-2">
            <div className="text-xs uppercase text-zinc-400">备注</div>
            <div className="break-words text-xs text-zinc-700 dark:text-zinc-300">
              {run.message}
            </div>
          </div>
        ) : null}
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-800 dark:text-zinc-100">
            实时日志
            {isRunning && isPolling ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-500" aria-hidden="true" />
            ) : null}
            <span className="text-xs font-normal text-zinc-400">{sortedLogs.length} 条</span>
          </h2>
          <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
            {autoFollow ? "自动滚动到底" : "已暂停滚动（向下滚回底部恢复）"}
          </div>
        </div>
        {fetchError ? (
          <div className="mb-2 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-600 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
            刷新失败：{fetchError}
          </div>
        ) : null}
        <div
          ref={logContainerRef}
          onScroll={handleScroll}
          className="h-[60vh] overflow-auto rounded-md border border-zinc-200 bg-zinc-50 p-3 font-mono text-xs leading-5 dark:border-zinc-800 dark:bg-zinc-900"
        >
          {sortedLogs.length === 0 ? (
            <div className="text-zinc-500 dark:text-zinc-400">
              {isRunning ? "等待第一条日志…" : "暂无日志记录。"}
            </div>
          ) : (
            sortedLogs.map((entry, index) => (
              <div
                key={index}
                className={`whitespace-pre-wrap break-words ${logLevelStyle(entry.level)}`}
              >
                <span className="text-zinc-400 dark:text-zinc-500">
                  {formatLogTimestamp(entry.ts, timeZone)}
                </span>{" "}
                <span className="uppercase">[{entry.level}]</span>{" "}
                {entry.paperId ? (
                  <span className="text-zinc-500 dark:text-zinc-400">{entry.paperId} </span>
                ) : null}
                {entry.message}
              </div>
            ))
          )}
        </div>
      </section>

      {run.failedPapers.length > 0 ? (
        <section className="rounded-lg border border-red-200 bg-red-50/40 p-4 text-sm dark:border-red-900 dark:bg-red-950/30">
          <h2 className="mb-2 text-sm font-semibold text-red-700 dark:text-red-300">
            失败论文 ({run.failedPapers.length})
          </h2>
          <ul className="space-y-2">
            {run.failedPapers.map((failure) => (
              <li key={failure.id} className="text-xs text-red-700 dark:text-red-200">
                <span className="font-mono">{failure.id}</span>
                {failure.title ? ` · ${failure.title}` : null}
                <div className="text-zinc-500 dark:text-zinc-400">{failure.error}</div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
