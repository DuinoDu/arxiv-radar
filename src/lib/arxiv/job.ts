import { analyzeArticles } from "./analyzer";
import { ARXIV_RECENT_URL, fetchArticleMetadata, fetchRecentArticleIds } from "./fetcher";
import { finishRun, readArxivState, upsertRun } from "./store";
import type {
  AnalysisRun,
  ArxivArticle,
  RunArxivAnalysisOptions,
  RunArxivAnalysisResult,
} from "./types";

const DEFAULT_LIMIT = 100;

let activeRun: Promise<RunArxivAnalysisResult> | undefined;

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

async function runArxivAnalysisInternal(
  options: RunArxivAnalysisOptions = {},
): Promise<RunArxivAnalysisResult> {
  const limit = toLimit(options.limit);
  const sourceUrl = options.sourceUrl || ARXIV_RECENT_URL;
  let run = createInitialRun(sourceUrl);

  await upsertRun(run);

  try {
    const state = await readArxivState();
    const processedIds = new Set(state.processedArticleIds);
    const recentIds = await fetchRecentArticleIds(sourceUrl, limit);
    const articles = await fetchArticleMetadata(recentIds);
    const { articlesToAnalyze, skippedIds } = selectNewArticles(
      articles,
      processedIds,
      Boolean(options.force),
    );

    const { papers, failures } = await analyzeArticles(articlesToAnalyze, run.id);

    run = {
      ...run,
      status: "completed",
      finishedAt: new Date().toISOString(),
      fetchedCount: articles.length,
      skippedAlreadyProcessedCount: skippedIds.length,
      analyzedCount: papers.length,
      failedCount: failures.length,
      skippedIds,
      failedPapers: failures,
      message:
        failures.length > 0
          ? `Completed with ${failures.length} paper analysis failure(s).`
          : undefined,
    };

    await finishRun(run, papers);

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
    await upsertRun(run);
    throw error;
  }
}

export function runArxivAnalysis(options: RunArxivAnalysisOptions = {}) {
  if (!activeRun) {
    activeRun = runArxivAnalysisInternal(options).finally(() => {
      activeRun = undefined;
    });
  }

  return activeRun;
}
