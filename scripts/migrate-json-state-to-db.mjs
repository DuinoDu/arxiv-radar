#!/usr/bin/env node
import { promises as fs } from "node:fs";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, "..");

function loadEnvFromFile(path) {
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return;
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (process.env[key] !== undefined) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function boolValue(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

function settingsFromState(state) {
  const settings = state?.settings || {};
  const cron = settings.cron || {};
  const conductor = settings.conductor || {};
  return {
    arxivDailyUrl:
      settings.arxivDailyUrl ||
      process.env.ARXIV_DAILY_URL ||
      "https://arxiv.org/list/cs.RO/recent?skip=0&show=100",
    cron: {
      enabled: boolValue(
        cron.enabled,
        process.env.ARXIV_AUTO_FETCH_ENABLED !== "0",
      ),
      localTime:
        typeof cron.localTime === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(cron.localTime)
          ? cron.localTime
          : `${String(Math.min(Math.max(0, Number(process.env.ARXIV_RUN_HOUR || 2)), 23)).padStart(2, "0")}:${String(Math.min(Math.max(0, Number(process.env.ARXIV_RUN_MINUTE || 0)), 59)).padStart(2, "0")}`,
    },
    conductor: {
      baseUrl: conductor.baseUrl || process.env.CONDUCTOR_BASE_URL || "",
      token: conductor.token || process.env.CONDUCTOR_TOKEN || "",
      daemonHost: conductor.daemonHost || process.env.CONDUCTOR_DAEMON_HOST || "",
      workspacePath: conductor.workspacePath || process.env.CONDUCTOR_WORKSPACE_PATH || "",
      appName: conductor.appName || process.env.CONDUCTOR_APP_NAME || "arxiv-radar",
      backendType: conductor.backendType || process.env.CONDUCTOR_BACKEND_TYPE || "",
    },
  };
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function numberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

async function ensureUser(client, userId) {
  await client.query(
    `
      INSERT INTO users(id)
      VALUES ($1)
      ON CONFLICT (id) DO NOTHING
    `,
    [userId],
  );
}

async function saveSettings(client, userId, settings) {
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
        updated_at = now()
    `,
    [
      userId,
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

async function saveRun(client, userId, run) {
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
      userId,
      run.id,
      run.sourceUrl || "",
      run.startedAt || new Date().toISOString(),
      run.finishedAt || null,
      ["running", "completed", "failed"].includes(run.status) ? run.status : "completed",
      Number(run.fetchedCount || 0),
      Number(run.skippedAlreadyProcessedCount || 0),
      Number(run.analyzedCount || 0),
      Number(run.failedCount || 0),
      JSON.stringify(asArray(run.skippedIds)),
      run.message || null,
    ],
  );

  await client.query(
    "DELETE FROM user_analysis_failures WHERE user_id = $1 AND run_id = $2",
    [userId, run.id],
  );
  for (const failure of asArray(run.failedPapers)) {
    await client.query(
      `
        INSERT INTO user_analysis_failures(user_id, run_id, paper_id, title, error)
        VALUES ($1, $2, $3, $4, $5)
      `,
      [userId, run.id, failure.id || "unknown", failure.title || null, failure.error || ""],
    );
  }
}

async function savePaper(client, userId, paper) {
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
      paper.title || paper.id,
      JSON.stringify(asArray(paper.authors)),
      paper.abstract || "",
      JSON.stringify(asArray(paper.categories)),
      paper.publishedAt || null,
      paper.updatedAt || null,
      paper.arxivUrl || `https://arxiv.org/abs/${paper.id}`,
      paper.pdfUrl || null,
      paper.fullTextStatus || null,
      paper.fullTextUrl || null,
      paper.fullTextError || null,
      paper.fullTextAnalyzedAt || null,
      paper.githubUrl || null,
    ],
  );

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
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'import')
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
      userId,
      paper.id,
      paper.summary || "",
      paper.hypothesis || "",
      paper.method || "",
      paper.problem || "",
      paper.conclusion || "",
      paper.model || "",
      numberOrNull(paper.confidence),
      paper.analyzedAt || new Date().toISOString(),
      paper.runId || "",
      Boolean(paper.removed),
    ],
  );

  await client.query("DELETE FROM user_paper_tags WHERE user_id = $1 AND paper_id = $2", [
    userId,
    paper.id,
  ]);
  for (const tag of asArray(paper.tags)) {
    await client.query(
      `
        INSERT INTO user_paper_tags(user_id, paper_id, tag, evidence, confidence, source)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (user_id, paper_id, tag) DO UPDATE SET
          evidence = EXCLUDED.evidence,
          confidence = EXCLUDED.confidence,
          source = EXCLUDED.source,
          updated_at = now()
      `,
      [
        userId,
        paper.id,
        tag,
        paper.tagEvidence?.[tag] || "",
        numberOrNull(paper.tagConfidence?.[tag]),
        paper.tagSource?.[tag] || "abstract",
      ],
    );
  }
}

async function main() {
  loadEnvFromFile(resolve(projectRoot, ".env"));

  const userId = argValue("--user-id") || process.env.ARXIV_USER_ID;
  const statePath =
    argValue("--state") ||
    process.env.ARXIV_LEGACY_STATE_FILE ||
    resolve(projectRoot, "data", process.env.ARXIV_DATA_FILE_NAME || "arxiv-state.json");

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not configured");
  }
  if (!userId) {
    throw new Error("Pass --user-id <conductor-user-id> or set ARXIV_USER_ID");
  }

  const state = JSON.parse(await fs.readFile(statePath, "utf8"));
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await ensureUser(client, userId);
    await saveSettings(client, userId, settingsFromState(state));

    for (const run of asArray(state.runs)) {
      await saveRun(client, userId, run);
    }
    for (const paper of asArray(state.papers)) {
      if (!paper?.id) continue;
      await savePaper(client, userId, paper);
    }
    for (const paperId of asArray(state.favoriteIds)) {
      await client.query(
        `
          INSERT INTO user_favorites(user_id, paper_id)
          SELECT $1, $2
          WHERE EXISTS (
            SELECT 1 FROM user_papers WHERE user_id = $1 AND paper_id = $2
          )
          ON CONFLICT (user_id, paper_id) DO NOTHING
        `,
        [userId, paperId],
      );
    }

    const bindings = {
      ...(state.paperTasks || {}),
      ...(state.paperTasksByUser?.[userId] || {}),
    };
    for (const [paperId, binding] of Object.entries(bindings)) {
      if (!binding?.taskId || !binding?.projectId || !binding?.createdAt) continue;
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
        [userId, paperId, binding.taskId, binding.projectId, binding.createdAt],
      );
    }

    await client.query("COMMIT");
    console.log(
      `imported ${asArray(state.papers).length} paper(s), ${asArray(state.runs).length} run(s) for user ${userId}`,
    );
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
