import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { Database as SqliteDatabase } from "better-sqlite3";

type GlobalWithSqlite = typeof globalThis & {
  arxivRadarSqliteDb?: SqliteDatabase;
};

const globalWithSqlite = globalThis as GlobalWithSqlite;

/**
 * Resolve the on-disk SQLite file from DATABASE_URL. Accepts the forms
 * `sqlite:relative/path`, `sqlite:///absolute/path`, `file:...`, a bare path,
 * or `:memory:`. Relative paths resolve against the project working directory.
 */
export function sqliteFilePath(): string {
  let raw = (process.env.DATABASE_URL ?? "").trim();
  for (const prefix of ["sqlite://", "sqlite:", "file://", "file:"]) {
    if (raw.startsWith(prefix)) {
      raw = raw.slice(prefix.length);
      break;
    }
  }
  if (!raw || raw === ":memory:") return ":memory:";
  return path.isAbsolute(raw) ? raw : path.join(process.cwd(), raw);
}

export function getSqliteDb(): SqliteDatabase {
  if (!globalWithSqlite.arxivRadarSqliteDb) {
    const file = sqliteFilePath();
    if (file !== ":memory:") {
      fs.mkdirSync(path.dirname(file), { recursive: true });
    }
    const db = new Database(file);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.pragma("busy_timeout = 5000");
    globalWithSqlite.arxivRadarSqliteDb = db;
  }
  return globalWithSqlite.arxivRadarSqliteDb;
}

type SqliteResult<T> = { rows: T[]; rowCount: number };

function coerceBindValue(value: unknown): unknown {
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (value !== null && typeof value === "object" && !Buffer.isBuffer(value)) {
    // store.ts always pre-serializes JSON columns, so any object reaching here
    // is unexpected — serialize defensively rather than letting the driver throw.
    return JSON.stringify(value);
  }
  return value;
}

// Matches, in priority order:
//   1. `= ANY($n::type[])`  -> expanded to `IN (?, ?, ...)`
//   2. `$n` (with optional `::cast`) -> positional `?`
//   3. `now()` -> CURRENT_TIMESTAMP
const TRANSLATE_RE =
  /=\s*ANY\(\s*\$(\d+)(?:::[A-Za-z0-9_[\]]+)?\s*\)|\$(\d+)(?:::[A-Za-z0-9_[\]]+)?|\bnow\s*\(\s*\)/gi;

/**
 * Translate a PostgreSQL-flavored statement into the SQLite dialect understood
 * by better-sqlite3, rebuilding the bind-parameter array in placeholder order
 * (so reused/out-of-order `$n` and `= ANY($n)` arrays bind correctly).
 */
export function translateSql(
  sql: string,
  values: readonly unknown[],
): { text: string; params: unknown[] } {
  const params: unknown[] = [];
  const text = sql.replace(TRANSLATE_RE, (_full, anyNum, plainNum) => {
    if (anyNum !== undefined) {
      const raw = values[Number(anyNum) - 1];
      const arr = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
      if (arr.length === 0) return "IN (SELECT 1 WHERE 0)";
      for (const element of arr) params.push(coerceBindValue(element));
      return `IN (${arr.map(() => "?").join(", ")})`;
    }
    if (plainNum !== undefined) {
      params.push(coerceBindValue(values[Number(plainNum) - 1]));
      return "?";
    }
    return "CURRENT_TIMESTAMP";
  });
  return { text, params };
}

function execute<T>(
  db: SqliteDatabase,
  sql: string,
  values: readonly unknown[],
): SqliteResult<T> {
  const { text, params } = translateSql(sql, values);
  const stmt = db.prepare(text);
  if (stmt.reader) {
    const rows = stmt.all(...(params as never[])) as T[];
    return { rows, rowCount: rows.length };
  }
  const info = stmt.run(...(params as never[]));
  return { rows: [], rowCount: info.changes };
}

// better-sqlite3 is synchronous and our transactions span multiple awaited
// statements, so serialize every operation to keep transactions from
// interleaving across concurrent requests.
let lock: Promise<unknown> = Promise.resolve();

function withLock<T>(fn: () => Promise<T> | T): Promise<T> {
  const result = lock.then(() => fn());
  lock = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export async function query<T = Record<string, unknown>>(
  text: string,
  values: readonly unknown[] = [],
): Promise<SqliteResult<T>> {
  return withLock(() => execute<T>(getSqliteDb(), text, values));
}

export type SqliteClient = {
  query<T = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<SqliteResult<T>>;
};

export async function transaction<T>(
  callback: (client: SqliteClient) => Promise<T>,
): Promise<T> {
  return withLock(async () => {
    const db = getSqliteDb();
    const client: SqliteClient = {
      query: async (text, values = []) => execute(db, text, values),
    };
    db.exec("BEGIN");
    try {
      const result = await callback(client);
      db.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // ignore rollback failure; surface the original error
      }
      throw error;
    }
  });
}
