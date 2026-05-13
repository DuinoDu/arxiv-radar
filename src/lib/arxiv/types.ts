export const PAPER_TAGS = ["egocentric", "custom_hardware"] as const;

export type PaperTag = (typeof PAPER_TAGS)[number];

export type RunStatus = "running" | "completed" | "failed";

export interface ArxivArticle {
  id: string;
  title: string;
  authors: string[];
  abstract: string;
  categories: string[];
  publishedAt?: string;
  updatedAt?: string;
  arxivUrl: string;
  pdfUrl?: string;
}

export interface AnalyzedPaper extends ArxivArticle {
  summary: string;
  hypothesis: string;
  method: string;
  problem: string;
  conclusion: string;
  tags: PaperTag[];
  tagEvidence: Partial<Record<PaperTag, string>>;
  model: string;
  confidence?: number;
  analyzedAt: string;
  runId: string;
}

export interface PaperFailure {
  id: string;
  title?: string;
  error: string;
}

export interface AnalysisRun {
  id: string;
  sourceUrl: string;
  startedAt: string;
  finishedAt?: string;
  status: RunStatus;
  fetchedCount: number;
  skippedAlreadyProcessedCount: number;
  analyzedCount: number;
  failedCount: number;
  skippedIds: string[];
  failedPapers: PaperFailure[];
  message?: string;
}

export interface ArxivState {
  version: 1;
  updatedAt: string;
  processedArticleIds: string[];
  papers: AnalyzedPaper[];
  runs: AnalysisRun[];
}

export interface RunArxivAnalysisOptions {
  limit?: number;
  force?: boolean;
  sourceUrl?: string;
}

export interface RunArxivAnalysisResult {
  run: AnalysisRun;
  papers: AnalyzedPaper[];
}
