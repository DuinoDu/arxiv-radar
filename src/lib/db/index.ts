import type { PoolClient, QueryResult, QueryResultRow } from "pg";
import * as postgres from "./postgres";
import * as sqlite from "./sqlite";

/**
 * Pick the database backend from DATABASE_URL. Anything that is not an explicit
 * `postgres://` / `postgresql://` connection string is treated as SQLite
 * (`sqlite:...`, `file:...`, a bare path, or `:memory:`).
 */
export function isPostgresUrl(url: string | undefined): boolean {
  return /^postgres(ql)?:\/\//i.test((url ?? "").trim());
}

const usePostgres = isPostgresUrl(process.env.DATABASE_URL);

type QueryFn = <T extends QueryResultRow = QueryResultRow>(
  text: string,
  values?: unknown[],
) => Promise<QueryResult<T>>;

type TransactionFn = <T>(
  callback: (client: Pick<PoolClient, "query">) => Promise<T>,
) => Promise<T>;

export const query: QueryFn = (
  usePostgres ? postgres.query : sqlite.query
) as unknown as QueryFn;

export const transaction: TransactionFn = (
  usePostgres ? postgres.transaction : sqlite.transaction
) as unknown as TransactionFn;

export const databaseBackend: "postgres" | "sqlite" = usePostgres
  ? "postgres"
  : "sqlite";
