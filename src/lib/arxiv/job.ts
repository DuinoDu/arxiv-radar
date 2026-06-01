import { analyzeArticles } from "./analyzer";
import { ARXIV_RECENT_URL, fetchArticleMetadata, fetchRecentArticleIds } from "./fetcher";
import { createRunLogger } from "./run-logger";
import {
  findActiveRunForUser,
  finishRun,
  readAppSettings,
  readArxivState,
  upsertRun,
} from "./store";
import type {
  AnalysisRun,
  ArxivArticle,
  RunArxivAnalysisOptions,
  RunArxivAnalysisResult,
} from "./types";

/**
 * Thrown when a trigger arrives while another run for the same user is still
 * in progress. Carries the existing run so the caller can surface its id.
 */
export class AnalysisAlreadyRunningError extends Error {
  readonly code = "already_running" as const;
  readonly run: AnalysisRun;

  constructor(run: AnalysisRun) {
    super(`Analysis already running (run ${run.id})`);
    this.name = "AnalysisAlreadyRunningError";
    this.run = run;
  }
}

const DEFAULT_LIMIT = 100;
const EXISTING_PAPERS_SOURCE = "local:existing-papers";

const activeRuns = new Map<string, Promise<RunArxivAnalysisResult>>();

function createRunId() {
  return `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function toLimit(value?: number) {
  if (!Number.isFinite(value)) {
    return DEFAULT_LIMIT;
  }

  return Math.min(Math.max(1, Math.floor(value ?? DEFAULT_LIMIT)), 100);
}

function createInitialRun(sourceUrl: string): AnalysisRun {
  return {
    id: createRunId(),
    sourceUrl,
    startedAt: new Date().toISOString(),
    status: "running",
    fetchedCount: 0,
    skippedAlreadyProcessedCount: 0,
    analyzedCount: 0,
    failedCount: 0,
    skippedIds: [],
    failedPapers: [],
  };
}

function selectNewArticles(
  articles: ArxivArticle[],
  processedIds: Set<string>,
  force: boolean,
) {
  if (force) {
    return {
      articlesToAnalyze: articles,
      skippedIds: [],
    };
  }

  const articlesToAnalyze = articles.filter((article) => !processedIds.has(article.id));
  const skippedIds = articles
    .filter((article) => processedIds.has(article.id))
    .map((article) => article.id);

  return {
    articlesToAnalyze,
    skippedIds,
  };
}

function allAnalysisFailedMessage(failures: { id: string; title: string; error: string }[]) {
  const firstFailure = failures[0];
  const firstFailureLabel = firstFailure
    ? ` First failure (${firstFailure.id}): ${firstFailure.error}`
    : "";

  return `Analysis failed for all ${failures.length} new paper(s).${firstFailureLabel}`;
}

async function runArxivAnalysisInternal(
  userId: string,
  options: RunArxivAnalysisOptions = {},
): Promise<RunArxivAnalysisResult> {
  // Cross-instance / cross-tab guard: even if the in-process activeRuns map
  // misses (different serverless instance, page refresh between clicks, …),
  // the DB still has an authoritative `running` row that we can detect and
  // bail on, so successive clicks never stack into parallel runs.
  const inflight = await findActiveRunForUser(userId);
  if (inflight) {
    throw new AnalysisAlreadyRunningError(inflight);
  }

  const settings = await readAppSettings(userId);
  const limit = toLimit(options.limit);
  const sourceUrl = options.reanalyzeExisting
    ? EXISTING_PAPERS_SOURCE
    : options.sourceUrl || settings.arxivDailyUrl || ARXIV_RECENT_URL;
  let run = createInitialRun(sourceUrl);

  await upsertRun(userId, run);
  const logger = createRunLogger(userId, run.id);
  logger.info(
    `run start trigger=${options.trigger ?? "manual"} sourceUrl=${sourceUrl} limit=${limit}`,
  );

  try {
    const state = await readArxivState(userId);
    const processedIds = new Set(state.processedArticleIds);
    let articles: ArxivArticle[];
    if (options.reanalyzeExisting) {
      logger.info(`reanalyzing ${state.papers.length} existing papers`);
      articles = state.papers;
    } else {
      logger.info(`fetching article id list from ${sourceUrl}`);
      const ids = await fetchRecentArticleIds(sourceUrl, limit);
      logger.info(`fetched ${ids.length} article ids; loading metadata`);
      articles = await fetchArticleMetadata(ids);
      logger.info(`metadata ready for ${articles.length} articles`);
    }
    const { articlesToAnalyze, skippedIds } = options.reanalyzeExisting
      ? {
          articlesToAnalyze: articles,
          skippedIds: [],
        }
      : selectNewArticles(
          articles,
          processedIds,
          Boolean(options.force),
        );

    if (!options.reanalyzeExisting) {
      logger.info(
        `pipeline plan: total=${articles.length} new=${articlesToAnalyze.length} alreadyInDb=${skippedIds.length}`,
      );
      if (skippedIds.length > 0) {
        const preview = skippedIds.slice(0, 10).join(", ");
        const suffix = skippedIds.length > 10 ? ", …" : "";
        logger.info(`already-in-db ids skipped: ${preview}${suffix}`);
      }
    }

    if (articlesToAnalyze.length === 0) {
      logger.info("nothing to analyze; finishing run");
    } else {
      logger.info(`starting per-paper analysis for ${articlesToAnalyze.length} paper(s)`);
    }

    const { papers, failures } = await analyzeArticles(
      articlesToAnalyze,
      run.id,
      undefined,
      logger,
    );
    const allAttemptedPapersFailed =
      articlesToAnalyze.length > 0 &&
      papers.length === 0 &&
      failures.length === articlesToAnalyze.length;
    const failureMessage = allAttemptedPapersFailed
      ? allAnalysisFailedMessage(failures)
      : failures.length > 0
        ? `Completed with ${failures.length} paper analysis failure(s).`
        : undefined;

    run = {
      ...run,
      status: allAttemptedPapersFailed ? "failed" : "completed",
      finishedAt: new Date().toISOString(),
      fetchedCount: articles.length,
      skippedAlreadyProcessedCount: skippedIds.length,
      analyzedCount: papers.length,
      failedCount: failures.length,
      skippedIds,
      failedPapers: failures,
      message: failureMessage,
    };

    await finishRun(userId, run, papers);
    logger.info(
      `run finished status=${run.status} analyzed=${run.analyzedCount} failed=${run.failedCount} skipped=${run.skippedAlreadyProcessedCount}`,
    );
    await logger.flush();

    if (allAttemptedPapersFailed) {
      throw new Error(failureMessage);
    }

    return {
      run,
      papers,
    };
  } catch (error) {
    const message = (error as Error).message;
    logger.error(`run failed: ${message}`);
    run = {
      ...run,
      status: "failed",
      finishedAt: new Date().toISOString(),
      failedCount: run.failedCount || 1,
      message,
    };
    await upsertRun(userId, run);
    await logger.flush();
    throw error;
  }
}

export function runArxivAnalysis(userId: string, options: RunArxivAnalysisOptions = {}) {
  const activeRun = activeRuns.get(userId);
  if (activeRun) return activeRun;

  const nextRun = runArxivAnalysisInternal(userId, options).finally(() => {
    if (activeRuns.get(userId) === nextRun) {
      activeRuns.delete(userId);
    }
  });
  activeRuns.set(userId, nextRun);
  return nextRun;
}
