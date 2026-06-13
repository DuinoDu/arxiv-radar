import { promises as fs } from "node:fs";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const migrationsDir = path.join(rootDir, "db", "migrations");
const sqliteMigrationsDir = path.join(rootDir, "db", "sqlite");

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

const databaseUrl = process.env.DATABASE_URL?.trim();

if (!databaseUrl) {
  console.error("Missing DATABASE_URL");
  process.exit(1);
}

const isPostgres = /^postgres(ql)?:\/\//i.test(databaseUrl);

function sqliteFilePath(url) {
  let raw = url;
  for (const prefix of ["sqlite://", "sqlite:", "file://", "file:"]) {
    if (raw.startsWith(prefix)) {
      raw = raw.slice(prefix.length);
      break;
    }
  }
  if (!raw || raw === ":memory:") return ":memory:";
  return path.isAbsolute(raw) ? raw : path.join(rootDir, raw);
}

async function migrateSqlite() {
  const { default: Database } = await import("better-sqlite3");
  const { mkdirSync } = await import("node:fs");
  const file = sqliteFilePath(databaseUrl);
  if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       version text PRIMARY KEY,
       applied_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
     )`,
  );
  const applied = new Set(
    db.prepare("SELECT version FROM schema_migrations").all().map((r) => r.version),
  );
  const files = (await fs.readdir(sqliteMigrationsDir))
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const fileName of files) {
    const version = fileName.replace(/\.sql$/, "");
    if (applied.has(version)) {
      console.log(`skip ${version}`);
      continue;
    }
    const sql = await fs.readFile(path.join(sqliteMigrationsDir, fileName), "utf8");
    const tx = db.transaction(() => {
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations(version) VALUES (?)").run(version);
    });
    tx();
    console.log(`applied ${version}`);
  }
  db.close();
  console.log(`SQLite schema ready at ${file}`);
}

const { Pool } = isPostgres ? await import("pg").then((m) => m.default) : {};

const pool = isPostgres
  ? new Pool({
      connectionString: databaseUrl,
    })
  : null;

async function ensureSchemaMigrations(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function appliedVersions(client) {
  const result = await client.query("SELECT version FROM schema_migrations");
  return new Set(result.rows.map((row) => row.version));
}

async function main() {
  const files = (await fs.readdir(migrationsDir))
    .filter((file) => file.endsWith(".sql"))
    .sort();

  const client = await pool.connect();
  try {
    await ensureSchemaMigrations(client);
    const applied = await appliedVersions(client);

    for (const file of files) {
      const version = file.replace(/\.sql$/, "");
      if (applied.has(version)) {
        console.log(`skip ${version}`);
        continue;
      }

      const sql = await fs.readFile(path.join(migrationsDir, file), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO schema_migrations(version) VALUES ($1)",
          [version],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
      console.log(`applied ${version}`);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

const entry = isPostgres ? main() : migrateSqlite();

entry.catch((error) => {
  console.error(error);
  process.exit(1);
});
