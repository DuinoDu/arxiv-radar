export interface TagConfig {
  id: string;
  label: string;
}

export const PAPER_TAGS = ["egocentric", "vla", "world_model", "so101", "vr", "teleop", "slam", "umi", "sim"] as const;

export type BuiltInPaperTag = (typeof PAPER_TAGS)[number];
export type PaperTag = string;

export type PaperTagSource = "title" | "abstract" | "full_text";
export type FullTextStatus = "available" | "unavailable" | "failed";

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
  tagConfidence?: Partial<Record<PaperTag, number>>;
  tagSource?: Partial<Record<PaperTag, PaperTagSource>>;
  fullTextStatus?: FullTextStatus;
  fullTextUrl?: string;
  fullTextError?: string;
  fullTextAnalyzedAt?: string;
  githubUrl?: string;
  xUrl?: string;
  model: string;
  confidence?: number;
  analyzedAt: string;
  runId: string;
  /**
   * When true, this paper is hidden from the frontend. We keep the row in
   * storage (rather than deleting it) so the next analysis run doesn't
   * silently re-add it via the processed-id dedupe path.
   */
  removed?: boolean;
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

export type AnalysisRunLogLevel = "info" | "warn" | "error";

export interface AnalysisRunLogEntry {
  ts: string;
  level: AnalysisRunLogLevel;
  message: string;
  paperId?: string;
}

export interface PaperTaskBinding {
  /** Conductor task id. The chat history lives inside this task. */
  taskId: string;
  /** Conductor project id. */
  projectId: string;
  /** ISO 8601, set at first bind. */
  createdAt: string;
}

export interface AppCronSettings {
  enabled: boolean;
  /** Local wall-clock time in HH:mm, interpreted in APP_TIME_ZONE. */
  localTime: string;
}

export interface AppConductorSettings {
  baseUrl: string;
  token: string;
  daemonHost: string;
  workspacePath: string;
  appName: string;
  backendType: string;
}

export interface AppSettings {
  arxivDailyUrl: string;
  cron: AppCronSettings;
  conductor: AppConductorSettings;
  tags: TagConfig[];
}

export interface ArxivState {
  version: 1;
  updatedAt: string;
  processedArticleIds: string[];
  favoriteIds: string[];
  papers: AnalyzedPaper[];
  runs: AnalysisRun[];
  settings: AppSettings;
  /**
   * Per-paper Conductor task binding. Created lazily by
   * `POST /api/conductor/bind` and reused for the lifetime of the paper.
   * Legacy configuration-token bindings remain here for existing data only.
   */
  paperTasks?: Record<string, PaperTaskBinding>;
  /**
   * SSO user-scoped task bindings. A task is created using that user's
   * Conductor token, so it must never be reused by another account.
   */
  paperTasksByUser?: Record<string, Record<string, PaperTaskBinding>>;
}

export interface RunArxivAnalysisOptions {
  limit?: number;
  force?: boolean;
  reanalyzeExisting?: boolean;
  sourceUrl?: string;
  /**
   * Human-readable origin (e.g. "cron", "manual", "reanalyze") used purely
   * for run-log breadcrumbs. Has no effect on analysis behavior.
   */
  trigger?: string;
}

export interface RunArxivAnalysisResult {
  run: AnalysisRun;
  papers: AnalyzedPaper[];
}
