import { Pool, type PoolClient, type QueryResultRow } from "pg";

type GlobalWithPgPool = typeof globalThis & {
  arxivRadarPgPool?: Pool;
};

const globalWithPgPool = globalThis as GlobalWithPgPool;

function databaseUrl() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error("Missing DATABASE_URL. Run `npm run db:migrate` after configuring PostgreSQL.");
  }
  return url;
}

function createPool() {
  return new Pool({
    connectionString: databaseUrl(),
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
  });
}

export function getPostgresPool() {
  if (!globalWithPgPool.arxivRadarPgPool) {
    globalWithPgPool.arxivRadarPgPool = createPool();
  }
  return globalWithPgPool.arxivRadarPgPool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values: unknown[] = [],
) {
  return getPostgresPool().query<T>(text, values);
}

export async function transaction<T>(
  callback: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPostgresPool().connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
