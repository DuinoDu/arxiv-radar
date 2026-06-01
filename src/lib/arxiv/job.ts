import { analyzeArticles } from "./analyzer";
import { ARXIV_RECENT_URL, fetchArticleMetadata, fetchRecentArticleIds } from "./fetcher";
import { finishRun, readAppSettings, readArxivState, upsertRun } from "./store";
import type {
  AnalysisRun,
  ArxivArticle,
  RunArxivAnalysisOptions,
  RunArxivAnalysisResult,
} from "./types";

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
  const settings = await readAppSettings(userId);
  const limit = toLimit(options.limit);
  const sourceUrl = options.reanalyzeExisting
    ? EXISTING_PAPERS_SOURCE
    : options.sourceUrl || settings.arxivDailyUrl || ARXIV_RECENT_URL;
  let run = createInitialRun(sourceUrl);

  await upsertRun(userId, run);

  try {
    const state = await readArxivState(userId);
    const processedIds = new Set(state.processedArticleIds);
    const articles = options.reanalyzeExisting
      ? state.papers
      : await fetchArticleMetadata(await fetchRecentArticleIds(sourceUrl, limit));
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

    const { papers, failures } = await analyzeArticles(articlesToAnalyze, run.id);
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

    if (allAttemptedPapersFailed) {
      throw new Error(failureMessage);
    }

    return {
      run,
      papers,
    };
  } catch (error) {
    run = {
      ...run,
      status: "failed",
      finishedAt: new Date().toISOString(),
      failedCount: run.failedCount || 1,
      message: (error as Error).message,
    };
    await upsertRun(userId, run);
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
