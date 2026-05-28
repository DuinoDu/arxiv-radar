import type { PoolClient, QueryResult, QueryResultRow } from "pg";
import { createEnvAppSettings, normalizeAppSettings } from "@/lib/app-settings";
import type { AuthUser } from "@/lib/auth/session";
import { query, transaction } from "@/lib/db/postgres";
import {
  type AnalysisRun,
  type AnalyzedPaper,
  type AppSettings,
  type ArxivArticle,
  type ArxivState,
  type FullTextStatus,
  type PaperTag,
  type PaperTagSource,
  type PaperTaskBinding,
  type TagConfig,
} from "./types";

const STATE_VERSION = 1;
const MAX_RUNS = 60;
const configuredMaxStoredPapers = Number(process.env.MAX_STORED_PAPERS ?? 800);
const MAX_STORED_PAPERS = Number.isFinite(configuredMaxStoredPapers)
  ? Math.max(1, Math.floor(configuredMaxStoredPapers))
  : 800;

type Queryable = Pick<PoolClient, "query">;

type UserOptions = {
  user?: AuthUser;
  conductorBaseUrl?: string;
};

type SettingsRow = QueryResultRow & {
  arxiv_daily_url: string;
  cron_enabled: boolean;
  cron_local_time: string;
  conductor_base_url: string;
  conductor_token: string;
  conductor_daemon_host: string;
  conductor_workspace_path: string;
  conductor_app_name: string;
  conductor_backend_type: string;
  tags: unknown;
};

type PaperRow = QueryResultRow & {
  id: string;
  title: string;
  authors: unknown;
  abstract: string;
  categories: unknown;
  published_at: string | null;
  article_updated_at: string | null;
  arxiv_url: string;
  pdf_url: string | null;
  full_text_status: string | null;
  full_text_url: string | null;
  full_text_error: string | null;
  full_text_analyzed_at: string | null;
  github_url: string | null;
  summary: string;
  hypothesis: string;
  method: string;
  problem: string;
  conclusion: string;
  model: string;
  confidence: number | null;
  analyzed_at: string;
  run_id: string;
  removed: boolean;
};

type TagRow = QueryResultRow & {
  paper_id: string;
  tag: string;
  evidence: string;
  confidence: number | null;
  source: string;
};

type RunRow = QueryResultRow & {
  id: string;
  source_url: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  fetched_count: number;
  skipped_already_processed_count: number;
  analyzed_count: number;
  failed_count: number;
  skipped_ids: unknown;
  message: string | null;
};

type FailureRow = QueryResultRow & {
  run_id: string;
  paper_id: string;
  title: string | null;
  error: string;
};

type BindingRow = QueryResultRow & {
  paper_id: string;
  task_id: string;
  project_id: string;
  created_at: string;
};

export interface CronUser {
  userId: string;
  settings: AppSettings;
}

function normalizedUserId(userId: string) {
  const id = userId.trim();
  if (!id) {
    throw new Error("Missing user id for arXiv store access");
  }
  return id;
}

function dbQuery<T extends QueryResultRow>(
  client: Queryable | undefined,
  text: string,
  values: unknown[] = [],
): Promise<QueryResult<T>> {
  return client ? client.query<T>(text, values) : query<T>(text, values);
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function numberOrNull(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function fullTextStatus(value: string | null): FullTextStatus | undefined {
  if (value === "available" || value === "unavailable" || value === "failed") {
    return value;
  }
  return undefined;
}

function paperTag(value: string): PaperTag | null {
  const tag = value.trim();
  return tag ? tag : null;
}

function paperTagSource(value: string | undefined | null): PaperTagSource {
  if (value === "title" || value === "full_text" || value === "abstract") {
    return value;
  }
  return "abstract";
}

function normalizeTagList(tags: readonly PaperTag[], allowedTags?: ReadonlySet<string>) {
  const seen = new Set<string>();
  const result: PaperTag[] = [];

  for (const rawTag of tags) {
    const tag = paperTag(rawTag);
    if (!tag || seen.has(tag)) continue;
    if (allowedTags && !allowedTags.has(tag)) continue;
    seen.add(tag);
    result.push(tag);
  }

  return result;
}

function settingsWithInitialConductorBaseUrl(options: UserOptions = {}) {
  const defaults = createEnvAppSettings();
  const baseUrl = options.conductorBaseUrl?.trim().replace(/\/+$/, "");
  if (baseUrl) {
    defaults.conductor.baseUrl = baseUrl;
  }
  return normalizeAppSettings(defaults);
}

function parseTagConfigs(value: unknown): TagConfig[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result: TagConfig[] = [];
  for (const item of value) {
    if (item && typeof item === "object" && typeof item.id === "string" && typeof item.label === "string") {
      result.push({ id: item.id, label: item.label });
    }
  }
  return result.length > 0 ? result : undefined;
}

function settingsFromRow(row: SettingsRow): AppSettings {
  return normalizeAppSettings({
    arxivDailyUrl: row.arxiv_daily_url,
    cron: {
      enabled: row.cron_enabled,
      localTime: row.cron_local_time,
    },
    conductor: {
      baseUrl: row.conductor_base_url,
      token: row.conductor_token,
      daemonHost: row.conductor_daemon_host,
      workspacePath: row.conductor_workspace_path,
      appName: row.conductor_app_name,
      backendType: row.conductor_backend_type,
    },
    tags: parseTagConfigs(row.tags),
  });
}

async function ensureUserWithClient(
  client: Queryable,
  userId: string,
  options: UserOptions = {},
) {
  const id = normalizedUserId(userId);
  const user = options.user;

  if (user) {
    await client.query(
      `
        INSERT INTO users(id, email, phone, name)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (id) DO UPDATE SET
          email = EXCLUDED.email,
          phone = EXCLUDED.phone,
          name = EXCLUDED.name,
          updated_at = now()
      `,
      [id, user.email, user.phone, user.name ?? null],
    );
  } else {
    await client.query(
      `
        INSERT INTO users(id)
        VALUES ($1)
        ON CONFLICT (id) DO NOTHING
      `,
      [id],
    );
  }

  const settings = settingsWithInitialConductorBaseUrl(options);
  await client.query(
    `
      INSERT INTO user_settings(
        user_id,
        arxiv_daily_url,
        cron_enabled,
        cron_local_time,
        conductor_base_url,
        conductor_token,
        conductor_daemon_host,
        conductor_workspace_path,
        conductor_app_name,
        conductor_backend_type
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (user_id) DO NOTHING
    `,
    [
      id,
      settings.arxivDailyUrl,
      settings.cron.enabled,
      settings.cron.localTime,
      settings.conductor.baseUrl,
      settings.conductor.token,
      settings.conductor.daemonHost,
      settings.conductor.workspacePath,
      settings.conductor.appName,
      settings.conductor.backendType,
    ],
  );
}

async function ensureUser(userId: string, options: UserOptions = {}, client?: Queryable) {
  if (client) {
    await ensureUserWithClient(client, userId, options);
    return;
  }

  await transaction((tx) => ensureUserWithClient(tx, userId, options));
}

async function readSettingsForUser(userId: string, client?: Queryable) {
  const result = await dbQuery<SettingsRow>(
    client,
    `
      SELECT
        arxiv_daily_url,
        cron_enabled,
        cron_local_time,
        conductor_base_url,
        conductor_token,
        conductor_daemon_host,
        conductor_workspace_path,
        conductor_app_name,
        conductor_backend_type,
        tags
      FROM user_settings
      WHERE user_id = $1
    `,
    [normalizedUserId(userId)],
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error(`Missing settings for user ${userId}`);
  }
  return settingsFromRow(row);
}

async function readProcessedIdsForUser(userId: string) {
  const result = await query<{ paper_id: string }>(
    `
      SELECT paper_id
      FROM user_papers
      WHERE user_id = $1
      ORDER BY created_at ASC
    `,
    [normalizedUserId(userId)],
  );
  return result.rows.map((row) => row.paper_id);
}

async function readTagsForPapers(userId: string, paperIds: string[]) {
  if (paperIds.length === 0) {
    return new Map<string, TagRow[]>();
  }

  const result = await query<TagRow>(
    `
      SELECT paper_id, tag, evidence, confidence, source
      FROM user_paper_tags
      WHERE user_id = $1 AND paper_id = ANY($2::text[])
      ORDER BY paper_id ASC, tag ASC
    `,
    [normalizedUserId(userId), paperIds],
  );

  const tagsByPaper = new Map<string, TagRow[]>();
  for (const row of result.rows) {
    const rows = tagsByPaper.get(row.paper_id) ?? [];
    rows.push(row);
    tagsByPaper.set(row.paper_id, rows);
  }
  return tagsByPaper;
}

function paperFromRow(row: PaperRow, tagRows: TagRow[] = []): AnalyzedPaper {
  const tagEvidence: Partial<Record<PaperTag, string>> = {};
  const tagConfidence: Partial<Record<PaperTag, number>> = {};
  const tagSource: Partial<Record<PaperTag, PaperTagSource>> = {};
  const tagSet = new Set<PaperTag>();
  const tags: PaperTag[] = [];

  for (const tagRow of tagRows) {
    const tag = paperTag(tagRow.tag);
    if (!tag) continue;

    if (!tagSet.has(tag)) {
      tagSet.add(tag);
      tags.push(tag);
    }
    if (tagRow.evidence) tagEvidence[tag] = tagRow.evidence;
    if (typeof tagRow.confidence === "number") tagConfidence[tag] = tagRow.confidence;
    tagSource[tag] = paperTagSource(tagRow.source);
  }

  return {
    id: row.id,
    title: row.title,
    authors: stringArray(row.authors),
    abstract: row.abstract,
    categories: stringArray(row.categories),
    publishedAt: row.published_at ?? undefined,
    updatedAt: row.article_updated_at ?? undefined,
    arxivUrl: row.arxiv_url,
    pdfUrl: row.pdf_url ?? undefined,
    summary: row.summary,
    hypothesis: row.hypothesis,
    method: row.method,
    problem: row.problem,
    conclusion: row.conclusion,
    tags,
    tagEvidence,
    tagConfidence,
    tagSource,
    fullTextStatus: fullTextStatus(row.full_text_status),
    fullTextUrl: row.full_text_url ?? undefined,
    fullTextError: row.full_text_error ?? undefined,
    fullTextAnalyzedAt: row.full_text_analyzed_at ?? undefined,
    githubUrl: row.github_url ?? undefined,
    model: row.model,
    confidence: row.confidence ?? undefined,
    analyzedAt: row.analyzed_at,
    runId: row.run_id,
    removed: row.removed,
  };
}

async function readPapersForUser(userId: string) {
  const result = await query<PaperRow>(
    `
      SELECT
        p.id,
        p.title,
        p.authors,
        p.abstract,
        p.categories,
        p.published_at,
        p.article_updated_at,
        p.arxiv_url,
        p.pdf_url,
        p.full_text_status,
        p.full_text_url,
        p.full_text_error,
        p.full_text_analyzed_at,
        p.github_url,
        up.summary,
        up.hypothesis,
        up.method,
        up.problem,
        up.conclusion,
        up.model,
        up.confidence,
        up.analyzed_at,
        up.run_id,
        up.removed
      FROM user_papers up
      INNER JOIN papers p ON p.id = up.paper_id
      WHERE up.user_id = $1
      ORDER BY up.updated_at DESC
      LIMIT $2
    `,
    [normalizedUserId(userId), MAX_STORED_PAPERS],
  );

  const paperIds = result.rows.map((row) => row.id);
  const tagsByPaper = await readTagsForPapers(userId, paperIds);
  return result.rows.map((row) => paperFromRow(row, tagsByPaper.get(row.id)));
}

async function readFavoriteIdsForUser(userId: string) {
  const result = await query<{ paper_id: string }>(
    `
      SELECT paper_id
      FROM user_favorites
      WHERE user_id = $1
      ORDER BY created_at ASC
    `,
    [normalizedUserId(userId)],
  );
  return result.rows.map((row) => row.paper_id);
}

function runFromRow(row: RunRow, failures: FailureRow[] = []): AnalysisRun {
  return {
    id: row.id,
    sourceUrl: row.source_url,
    startedAt: row.started_at,
    finishedAt: row.finished_at ?? undefined,
    status:
      row.status === "running" || row.status === "completed" || row.status === "failed"
        ? row.status
        : "failed",
    fetchedCount: row.fetched_count,
    skippedAlreadyProcessedCount: row.skipped_already_processed_count,
    analyzedCount: row.analyzed_count,
    failedCount: row.failed_count,
    skippedIds: stringArray(row.skipped_ids),
    failedPapers: failures.map((failure) => ({
      id: failure.paper_id,
      title: failure.title ?? undefined,
      error: failure.error,
    })),
    message: row.message ?? undefined,
  };
}

async function readRunsForUser(userId: string) {
  const result = await query<RunRow>(
    `
      SELECT
        id,
        source_url,
        started_at,
        finished_at,
        status,
        fetched_count,
        skipped_already_processed_count,
        analyzed_count,
        failed_count,
        skipped_ids,
        message
      FROM user_analysis_runs
      WHERE user_id = $1
      ORDER BY started_at DESC
      LIMIT $2
    `,
    [normalizedUserId(userId), MAX_RUNS],
  );

  const runIds = result.rows.map((row) => row.id);
  if (runIds.length === 0) return [];

  const failuresResult = await query<FailureRow>(
    `
      SELECT run_id, paper_id, title, error
      FROM user_analysis_failures
      WHERE user_id = $1 AND run_id = ANY($2::text[])
      ORDER BY id ASC
    `,
    [normalizedUserId(userId), runIds],
  );

  const failuresByRun = new Map<string, FailureRow[]>();
  for (const failure of failuresResult.rows) {
    const rows = failuresByRun.get(failure.run_id) ?? [];
    rows.push(failure);
    failuresByRun.set(failure.run_id, rows);
  }

  return result.rows.map((row) => runFromRow(row, failuresByRun.get(row.id)));
}

async function readTaskBindingsForUser(userId: string) {
  const result = await query<BindingRow>(
    `
      SELECT paper_id, task_id, project_id, created_at
      FROM user_conductor_task_bindings
      WHERE user_id = $1
      ORDER BY updated_at DESC
    `,
    [normalizedUserId(userId)],
  );

  return Object.fromEntries(
    result.rows.map((row) => [
      row.paper_id,
      {
        taskId: row.task_id,
        projectId: row.project_id,
        createdAt: row.created_at,
      } satisfies PaperTaskBinding,
    ]),
  );
}

async function saveSettings(
  client: Queryable,
  userId: string,
  settings: AppSettings,
) {
  const normalized = normalizeAppSettings(settings);
  await client.query(
    `
      INSERT INTO user_settings(
        user_id,
        arxiv_daily_url,
        cron_enabled,
        cron_local_time,
        conductor_base_url,
        conductor_token,
        conductor_daemon_host,
        conductor_workspace_path,
        conductor_app_name,
        conductor_backend_type,
        tags
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
      ON CONFLICT (user_id) DO UPDATE SET
        arxiv_daily_url = EXCLUDED.arxiv_daily_url,
        cron_enabled = EXCLUDED.cron_enabled,
        cron_local_time = EXCLUDED.cron_local_time,
        conductor_base_url = EXCLUDED.conductor_base_url,
        conductor_token = EXCLUDED.conductor_token,
        conductor_daemon_host = EXCLUDED.conductor_daemon_host,
        conductor_workspace_path = EXCLUDED.conductor_workspace_path,
        conductor_app_name = EXCLUDED.conductor_app_name,
        conductor_backend_type = EXCLUDED.conductor_backend_type,
        tags = EXCLUDED.tags,
        updated_at = now()
    `,
    [
      normalizedUserId(userId),
      normalized.arxivDailyUrl,
      normalized.cron.enabled,
      normalized.cron.localTime,
      normalized.conductor.baseUrl,
      normalized.conductor.token,
      normalized.conductor.daemonHost,
      normalized.conductor.workspacePath,
      normalized.conductor.appName,
      normalized.conductor.backendType,
      JSON.stringify(normalized.tags),
    ],
  );
}

async function saveCanonicalPaper(client: Queryable, paper: ArxivArticle) {
  await client.query(
    `
      INSERT INTO papers(
        id,
        title,
        authors,
        abstract,
        categories,
        published_at,
        article_updated_at,
        arxiv_url,
        pdf_url,
        full_text_status,
        full_text_url,
        full_text_error,
        full_text_analyzed_at,
        github_url
      )
      VALUES ($1, $2, $3::jsonb, $4, $5::jsonb, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title,
        authors = EXCLUDED.authors,
        abstract = EXCLUDED.abstract,
        categories = EXCLUDED.categories,
        published_at = COALESCE(EXCLUDED.published_at, papers.published_at),
        article_updated_at = COALESCE(EXCLUDED.article_updated_at, papers.article_updated_at),
        arxiv_url = EXCLUDED.arxiv_url,
        pdf_url = COALESCE(EXCLUDED.pdf_url, papers.pdf_url),
        full_text_status = COALESCE(EXCLUDED.full_text_status, papers.full_text_status),
        full_text_url = COALESCE(EXCLUDED.full_text_url, papers.full_text_url),
        full_text_error = COALESCE(EXCLUDED.full_text_error, papers.full_text_error),
        full_text_analyzed_at = COALESCE(EXCLUDED.full_text_analyzed_at, papers.full_text_analyzed_at),
        github_url = COALESCE(EXCLUDED.github_url, papers.github_url),
        updated_at = now()
    `,
    [
      paper.id,
      paper.title,
      JSON.stringify(paper.authors ?? []),
      paper.abstract,
      JSON.stringify(paper.categories ?? []),
      paper.publishedAt ?? null,
      paper.updatedAt ?? null,
      paper.arxivUrl,
      paper.pdfUrl ?? null,
      "fullTextStatus" in paper ? (paper as AnalyzedPaper).fullTextStatus ?? null : null,
      "fullTextUrl" in paper ? (paper as AnalyzedPaper).fullTextUrl ?? null : null,
      "fullTextError" in paper ? (paper as AnalyzedPaper).fullTextError ?? null : null,
      "fullTextAnalyzedAt" in paper ? (paper as AnalyzedPaper).fullTextAnalyzedAt ?? null : null,
      "githubUrl" in paper ? (paper as AnalyzedPaper).githubUrl ?? null : null,
    ],
  );
}

async function replacePaperTags(
  client: Queryable,
  userId: string,
  paperId: string,
  paper: Pick<AnalyzedPaper, "tags" | "tagEvidence" | "tagConfidence" | "tagSource">,
) {
  await client.query(
    `
      DELETE FROM user_paper_tags
      WHERE user_id = $1 AND paper_id = $2
    `,
    [normalizedUserId(userId), paperId],
  );

  for (const tag of normalizeTagList(paper.tags)) {
    await client.query(
      `
        INSERT INTO user_paper_tags(
          user_id,
          paper_id,
          tag,
          evidence,
          confidence,
          source
        )
        VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [
        normalizedUserId(userId),
        paperId,
        tag,
        paper.tagEvidence[tag] ?? "",
        numberOrNull(paper.tagConfidence?.[tag]),
        paperTagSource(paper.tagSource?.[tag]),
      ],
    );
  }
}

async function saveUserPaper(
  client: Queryable,
  userId: string,
  paper: AnalyzedPaper,
  options: { source: "analysis" | "manual" | "import"; removed?: boolean },
) {
  await saveCanonicalPaper(client, paper);
  await client.query(
    `
      INSERT INTO user_papers(
        user_id,
        paper_id,
        summary,
        hypothesis,
        method,
        problem,
        conclusion,
        model,
        confidence,
        analyzed_at,
        run_id,
        removed,
        source
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      ON CONFLICT (user_id, paper_id) DO UPDATE SET
        summary = EXCLUDED.summary,
        hypothesis = EXCLUDED.hypothesis,
        method = EXCLUDED.method,
        problem = EXCLUDED.problem,
        conclusion = EXCLUDED.conclusion,
        model = EXCLUDED.model,
        confidence = EXCLUDED.confidence,
        analyzed_at = EXCLUDED.analyzed_at,
        run_id = EXCLUDED.run_id,
        removed = EXCLUDED.removed,
        source = EXCLUDED.source,
        updated_at = now()
    `,
    [
      normalizedUserId(userId),
      paper.id,
      paper.summary,
      paper.hypothesis,
      paper.method,
      paper.problem,
      paper.conclusion,
      paper.model,
      numberOrNull(paper.confidence),
      paper.analyzedAt,
      paper.runId,
      options.removed ?? Boolean(paper.removed),
      options.source,
    ],
  );
  await replacePaperTags(client, userId, paper.id, paper);
}

async function saveRun(client: Queryable, userId: string, run: AnalysisRun) {
  await client.query(
    `
      INSERT INTO user_analysis_runs(
        user_id,
        id,
        source_url,
        started_at,
        finished_at,
        status,
        fetched_count,
        skipped_already_processed_count,
        analyzed_count,
        failed_count,
        skipped_ids,
        message
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12)
      ON CONFLICT (user_id, id) DO UPDATE SET
        source_url = EXCLUDED.source_url,
        started_at = EXCLUDED.started_at,
        finished_at = EXCLUDED.finished_at,
        status = EXCLUDED.status,
        fetched_count = EXCLUDED.fetched_count,
        skipped_already_processed_count = EXCLUDED.skipped_already_processed_count,
        analyzed_count = EXCLUDED.analyzed_count,
        failed_count = EXCLUDED.failed_count,
        skipped_ids = EXCLUDED.skipped_ids,
        message = EXCLUDED.message,
        updated_at = now()
    `,
    [
      normalizedUserId(userId),
      run.id,
      run.sourceUrl,
      run.startedAt,
      run.finishedAt ?? null,
      run.status,
      run.fetchedCount,
      run.skippedAlreadyProcessedCount,
      run.analyzedCount,
      run.failedCount,
      JSON.stringify(run.skippedIds),
      run.message ?? null,
    ],
  );

  await client.query(
    `
      DELETE FROM user_analysis_failures
      WHERE user_id = $1 AND run_id = $2
    `,
    [normalizedUserId(userId), run.id],
  );

  for (const failure of run.failedPapers) {
    await client.query(
      `
        INSERT INTO user_analysis_failures(user_id, run_id, paper_id, title, error)
        VALUES ($1, $2, $3, $4, $5)
      `,
      [
        normalizedUserId(userId),
        run.id,
        failure.id,
        failure.title ?? null,
        failure.error,
      ],
    );
  }
}

export async function upsertAuthUser(
  user: AuthUser,
  options: { conductorBaseUrl?: string } = {},
) {
  await ensureUser(user.id, { user, conductorBaseUrl: options.conductorBaseUrl });
}

export async function listCronUsers(): Promise<CronUser[]> {
  const result = await query<SettingsRow & { user_id: string }>(
    `
      SELECT
        user_id,
        arxiv_daily_url,
        cron_enabled,
        cron_local_time,
        conductor_base_url,
        conductor_token,
        conductor_daemon_host,
        conductor_workspace_path,
        conductor_app_name,
        conductor_backend_type,
        tags
      FROM user_settings
      WHERE cron_enabled = true
      ORDER BY user_id ASC
    `,
  );

  return result.rows.map((row) => ({
    userId: row.user_id,
    settings: settingsFromRow(row),
  }));
}

export async function readArxivState(userId: string): Promise<ArxivState> {
  const id = normalizedUserId(userId);
  await ensureUser(id);

  const [
    settings,
    processedArticleIds,
    favoriteIds,
    papers,
    runs,
    paperTasks,
  ] = await Promise.all([
    readSettingsForUser(id),
    readProcessedIdsForUser(id),
    readFavoriteIdsForUser(id),
    readPapersForUser(id),
    readRunsForUser(id),
    readTaskBindingsForUser(id),
  ]);

  return {
    version: STATE_VERSION,
    updatedAt: new Date().toISOString(),
    processedArticleIds,
    favoriteIds,
    papers,
    runs,
    settings,
    paperTasks: {},
    paperTasksByUser: {
      [id]: paperTasks,
    },
  };
}

export async function readAppSettings(userId: string): Promise<AppSettings> {
  const id = normalizedUserId(userId);
  await ensureUser(id);
  return readSettingsForUser(id);
}

export async function writeArxivState(userId: string, state: ArxivState) {
  const id = normalizedUserId(userId);
  await transaction(async (client) => {
    await ensureUser(id, {}, client);
    await saveSettings(client, id, state.settings);
    await client.query("DELETE FROM user_conductor_task_bindings WHERE user_id = $1", [id]);
    await client.query("DELETE FROM user_favorites WHERE user_id = $1", [id]);
    await client.query("DELETE FROM user_papers WHERE user_id = $1", [id]);
    await client.query("DELETE FROM user_analysis_runs WHERE user_id = $1", [id]);

    for (const run of state.runs) {
      await saveRun(client, id, run);
    }
    for (const paper of state.papers) {
      await saveUserPaper(client, id, paper, {
        source: "import",
        removed: Boolean(paper.removed),
      });
    }
    for (const favoriteId of state.favoriteIds) {
      await client.query(
        `
          INSERT INTO user_favorites(user_id, paper_id)
          SELECT $1, $2
          WHERE EXISTS (
            SELECT 1 FROM user_papers WHERE user_id = $1 AND paper_id = $2
          )
          ON CONFLICT (user_id, paper_id) DO NOTHING
        `,
        [id, favoriteId],
      );
    }

    const bindings = {
      ...(state.paperTasks ?? {}),
      ...(state.paperTasksByUser?.[id] ?? {}),
    };
    for (const [paperId, binding] of Object.entries(bindings)) {
      await client.query(
        `
          INSERT INTO user_conductor_task_bindings(
            user_id,
            paper_id,
            task_id,
            project_id,
            created_at
          )
          SELECT $1, $2, $3, $4, $5
          WHERE EXISTS (
            SELECT 1 FROM user_papers WHERE user_id = $1 AND paper_id = $2
          )
          ON CONFLICT (user_id, paper_id) DO UPDATE SET
            task_id = EXCLUDED.task_id,
            project_id = EXCLUDED.project_id,
            created_at = EXCLUDED.created_at,
            updated_at = now()
        `,
        [id, paperId, binding.taskId, binding.projectId, binding.createdAt],
      );
    }
  });
}

export async function updateAppSettings(
  userId: string,
  settings: AppSettings,
  options: { resetPaperTasks?: boolean } = {},
) {
  const id = normalizedUserId(userId);
  await transaction(async (client) => {
    await ensureUser(id, {}, client);
    await saveSettings(client, id, settings);
    if (options.resetPaperTasks) {
      await client.query("DELETE FROM user_conductor_task_bindings WHERE user_id = $1", [id]);
    }
  });
}

export async function upsertRun(userId: string, run: AnalysisRun) {
  const id = normalizedUserId(userId);
  await transaction(async (client) => {
    await ensureUser(id, {}, client);
    await saveRun(client, id, run);
  });
}

export async function readFavoriteIds(userId: string): Promise<string[]> {
  const id = normalizedUserId(userId);
  await ensureUser(id);
  return readFavoriteIdsForUser(id);
}

export async function addFavoriteId(userId: string, paperId: string) {
  const id = normalizedUserId(userId);
  await transaction(async (client) => {
    await ensureUser(id, {}, client);
    await client.query(
      `
        INSERT INTO user_favorites(user_id, paper_id)
        SELECT $1, $2
        WHERE EXISTS (
          SELECT 1 FROM user_papers WHERE user_id = $1 AND paper_id = $2
        )
        ON CONFLICT (user_id, paper_id) DO NOTHING
      `,
      [id, paperId],
    );
  });
}

export async function removeFavoriteId(userId: string, paperId: string) {
  const id = normalizedUserId(userId);
  await query(
    `
      DELETE FROM user_favorites
      WHERE user_id = $1 AND paper_id = $2
    `,
    [id, paperId],
  );
}

export async function updatePaperTags(
  userId: string,
  paperId: string,
  tags: PaperTag[],
  allowedTags?: ReadonlySet<string>,
): Promise<PaperTag[] | null> {
  const id = normalizedUserId(userId);
  let savedTags: PaperTag[] | null = null;
  await transaction(async (client) => {
    await ensureUser(id, {}, client);
    const existing = await client.query<TagRow>(
      `
        SELECT paper_id, tag, evidence, confidence, source
        FROM user_paper_tags
        WHERE user_id = $1 AND paper_id = $2
      `,
      [id, paperId],
    );
    const exists = await client.query(
      `
        SELECT 1
        FROM user_papers
        WHERE user_id = $1 AND paper_id = $2
      `,
      [id, paperId],
    );
    if (exists.rowCount === 0) return;

    const existingByTag = new Map<PaperTag, TagRow>();
    for (const row of existing.rows) {
      const tag = paperTag(row.tag);
      if (tag) existingByTag.set(tag, row);
    }

    const nextTags = normalizeTagList(tags, allowedTags);
    await replacePaperTags(client, id, paperId, {
      tags: nextTags,
      tagEvidence: Object.fromEntries(
        nextTags.map((tag) => [
          tag,
          existingByTag.get(tag)?.evidence || "用户手动添加",
        ]),
      ),
      tagConfidence: Object.fromEntries(
        nextTags.map((tag) => [
          tag,
          existingByTag.get(tag)?.confidence ?? 1,
        ]),
      ),
      tagSource: Object.fromEntries(
        nextTags.map((tag) => [
          tag,
          paperTagSource(existingByTag.get(tag)?.source),
        ]),
      ),
    });
    savedTags = nextTags;
  });
  return savedTags;
}

export async function markPaperRemoved(userId: string, paperId: string): Promise<boolean> {
  const id = normalizedUserId(userId);
  const result = await query(
    `
      UPDATE user_papers
      SET removed = true, updated_at = now()
      WHERE user_id = $1 AND paper_id = $2 AND removed = false
    `,
    [id, paperId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function addManualPaper(userId: string, paper: AnalyzedPaper) {
  const id = normalizedUserId(userId);
  await transaction(async (client) => {
    await ensureUser(id, {}, client);
    await saveUserPaper(client, id, paper, {
      source: "manual",
      removed: Boolean(paper.removed),
    });
  });
}

export async function getUserPaperTaskBinding(
  userId: string,
  paperId: string,
): Promise<PaperTaskBinding | undefined> {
  const id = normalizedUserId(userId);
  const result = await query<BindingRow>(
    `
      SELECT paper_id, task_id, project_id, created_at
      FROM user_conductor_task_bindings
      WHERE user_id = $1 AND paper_id = $2
    `,
    [id, paperId],
  );
  const row = result.rows[0];
  if (!row) return undefined;

  return {
    taskId: row.task_id,
    projectId: row.project_id,
    createdAt: row.created_at,
  };
}

export async function setUserPaperTaskBinding(
  userId: string,
  paperId: string,
  binding: PaperTaskBinding,
) {
  const id = normalizedUserId(userId);
  await transaction(async (client) => {
    await ensureUser(id, {}, client);
    await client.query(
      `
        INSERT INTO user_conductor_task_bindings(
          user_id,
          paper_id,
          task_id,
          project_id,
          created_at
        )
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (user_id, paper_id) DO UPDATE SET
          task_id = EXCLUDED.task_id,
          project_id = EXCLUDED.project_id,
          created_at = EXCLUDED.created_at,
          updated_at = now()
      `,
      [id, paperId, binding.taskId, binding.projectId, binding.createdAt],
    );
  });
}

export async function clearUserPaperTaskBindingByTaskId(userId: string, taskId: string) {
  const id = normalizedUserId(userId);
  await query(
    `
      DELETE FROM user_conductor_task_bindings
      WHERE user_id = $1 AND task_id = $2
    `,
    [id, taskId],
  );
}

export async function clearPaperTaskBindingByTaskId(taskId: string) {
  await query(
    `
      DELETE FROM user_conductor_task_bindings
      WHERE task_id = $1
    `,
    [taskId],
  );
}

export async function finishRun(
  userId: string,
  run: AnalysisRun,
  papers: AnalyzedPaper[],
) {
  const id = normalizedUserId(userId);
  await transaction(async (client) => {
    await ensureUser(id, {}, client);

    const paperIds = papers.map((paper) => paper.id);
    const removedResult = paperIds.length
      ? await client.query<{ paper_id: string }>(
          `
            SELECT paper_id
            FROM user_papers
            WHERE user_id = $1
              AND paper_id = ANY($2::text[])
              AND removed = true
          `,
          [id, paperIds],
        )
      : { rows: [] };
    const removedIds = new Set(removedResult.rows.map((row) => row.paper_id));

    for (const paper of papers) {
      await saveUserPaper(client, id, paper, {
        source: "analysis",
        removed: removedIds.has(paper.id) || Boolean(paper.removed),
      });
    }

    await saveRun(client, id, run);
  });
}
