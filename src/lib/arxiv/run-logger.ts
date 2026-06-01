import { appendRunLogs } from "./store";
import type { AnalysisRunLogEntry, AnalysisRunLogLevel } from "./types";

const FLUSH_INTERVAL_MS = 1500;
const FLUSH_BATCH_SIZE = 25;

export interface RunLogger {
  info(message: string, paperId?: string): void;
  warn(message: string, paperId?: string): void;
  error(message: string, paperId?: string): void;
  flush(): Promise<void>;
}

export function createRunLogger(userId: string, runId: string): RunLogger {
  const buffer: AnalysisRunLogEntry[] = [];
  let flushTimer: NodeJS.Timeout | null = null;
  let pendingFlush: Promise<void> | null = null;

  async function flushBuffer() {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    if (buffer.length === 0) return;

    const entries = buffer.splice(0, buffer.length);
    try {
      await appendRunLogs(userId, runId, entries);
    } catch (error) {
      console.error("[run-logger] failed to persist log entries", error);
    }
  }

  function scheduleFlush() {
    if (buffer.length >= FLUSH_BATCH_SIZE) {
      pendingFlush = flushBuffer();
      return;
    }
    if (!flushTimer) {
      flushTimer = setTimeout(() => {
        pendingFlush = flushBuffer();
      }, FLUSH_INTERVAL_MS);
    }
  }

  function append(level: AnalysisRunLogLevel, message: string, paperId?: string) {
    buffer.push({
      ts: new Date().toISOString(),
      level,
      message,
      paperId,
    });
    scheduleFlush();
  }

  return {
    info(message, paperId) {
      append("info", message, paperId);
    },
    warn(message, paperId) {
      append("warn", message, paperId);
    },
    error(message, paperId) {
      append("error", message, paperId);
    },
    async flush() {
      if (pendingFlush) {
        await pendingFlush.catch(() => undefined);
      }
      await flushBuffer();
    },
  };
}
