// One-time data migration: copy every row from the PostgreSQL database into a
// SQLite file. Safe to re-run — each table is cleared before it is reloaded.
//
// Usage:
//   node scripts/pg-to-sqlite.mjs [--from <pg-url>] [--to <sqlite-url|path>]
//
// Defaults:
//   --from  $PG_SOURCE_URL, else current $DATABASE_URL if it is Postgres,
//           else postgresql://duino@localhost:5432/arxiv_radar
//   --to    $SQLITE_TARGET_URL, else current $DATABASE_URL if it is SQLite,
//           else sqlite:.runtime/arxiv-radar.sqlite

import { readFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import Database from "better-sqlite3";

const { Pool } = pg;
const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function loadEnvFromFile(filePath) {
  let raw;
  try {
    raw = readFileSync(filePath, "utf8");
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

loadEnvFromFile(path.join(rootDir, ".env.local"));
loadEnvFromFile(path.join(rootDir, ".env"));

function argValue(flag) {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

const isPostgres = (url) => /^postgres(ql)?:\/\//i.test((url ?? "").trim());

const sourceUrl =
  argValue("--from") ||
  process.env.PG_SOURCE_URL ||
  (isPostgres(process.env.DATABASE_URL)
    ? process.env.DATABASE_URL
    : "postgresql://duino@localhost:5432/arxiv_radar");

const targetUrlRaw =
  argValue("--to") ||
  process.env.SQLITE_TARGET_URL ||
  (!isPostgres(process.env.DATABASE_URL) && process.env.DATABASE_URL
    ? process.env.DATABASE_URL
    : "sqlite:.runtime/arxiv-radar.sqlite");

function sqliteFilePath(url) {
  let raw = url.trim();
  for (const prefix of ["sqlite://", "sqlite:", "file://", "file:"]) {
    if (raw.startsWith(prefix)) {
      raw = raw.slice(prefix.length);
      break;
    }
  }
  if (!raw || raw === ":memory:") return ":memory:";
  return path.isAbsolute(raw) ? raw : path.join(rootDir, raw);
}

// Parent-before-child so foreign keys stay satisfied during load.
const TABLES = [
  "users",
  "papers",
  "user_settings",
  "user_analysis_runs",
  "user_papers",
  "user_analysis_failures",
  "user_analysis_run_logs",
  "user_paper_tags",
  "user_favorites",
  "user_conductor_task_bindings",
];

function toSqliteValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "object") return JSON.stringify(value);
  return value;
}

async function main() {
  const sqliteFile = sqliteFilePath(targetUrlRaw);
  if (sqliteFile !== ":memory:") mkdirSync(path.dirname(sqliteFile), { recursive: true });

  console.log(`source (pg):    ${sourceUrl.replace(/:\/\/([^@/]*@)?/, "://***@")}`);
  console.log(`target (sqlite): ${sqliteFile}`);

  const db = new Database(sqliteFile);
  db.pragma("journal_mode = WAL");
  // Ensure schema exists (idempotent).
  db.exec(readFileSync(path.join(rootDir, "db", "sqlite", "0001_schema.sql"), "utf8"));

  const pool = new Pool({ connectionString: sourceUrl });
  let total = 0;

  try {
    db.pragma("foreign_keys = OFF");

    // Clear existing data child-first so re-runs start clean.
    const clear = db.transaction(() => {
      for (const table of [...TABLES].reverse()) {
        db.prepare(`DELETE FROM ${table}`).run();
      }
    });
    clear();

    for (const table of TABLES) {
      const { rows, fields } = await pool.query(`SELECT * FROM ${table}`);
      if (rows.length === 0) {
        console.log(`  ${table}: 0 rows`);
        continue;
      }
      const columns = fields.map((f) => f.name);
      const placeholders = columns.map(() => "?").join(", ");
      const insert = db.prepare(
        `INSERT INTO ${table} (${columns.map((c) => `"${c}"`).join(", ")}) VALUES (${placeholders})`,
      );
      const insertAll = db.transaction((records) => {
        for (const record of records) {
          insert.run(columns.map((c) => toSqliteValue(record[c])));
        }
      });
      insertAll(rows);
      total += rows.length;
      console.log(`  ${table}: ${rows.length} rows`);
    }

    db.pragma("foreign_keys = ON");
    const violations = db.pragma("foreign_key_check");
    if (Array.isArray(violations) && violations.length > 0) {
      console.error("foreign key violations after load:", violations);
      process.exitCode = 1;
    }
  } finally {
    await pool.end();
    db.close();
  }

  console.log(`Done. Copied ${total} rows into ${sqliteFile}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
