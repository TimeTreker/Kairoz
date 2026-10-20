import pg from 'pg';
import type { PoolClient, QueryResultRow } from 'pg';

/** Anything that can run a query: the pool or a client inside a transaction. */
export interface Db {
  query<R extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<pg.QueryResult<R>>;
}

export interface PoolOptions {
  connectionString: string;
  /** Postgres schema to use; tests isolate themselves this way. */
  schema?: string;
  max?: number;
  /** Upper bound for any single statement; a runaway query must not hold a connection forever. */
  statementTimeoutMs?: number;
}

export function createPool(options: PoolOptions): pg.Pool {
  const settings = [`-c statement_timeout=${options.statementTimeoutMs ?? 15_000}`];
  if (options.schema) settings.push(`-c search_path=${options.schema}`);
  const pool = new pg.Pool({
    connectionString: options.connectionString,
    max: options.max ?? 10,
    options: settings.join(' '),
  });
  // An idle client error must not crash the process; the pool replaces the client.
  pool.on('error', (err) => {
    console.error('postgres pool error', err);
  });
  return pool;
}

export async function one<R extends QueryResultRow>(db: Db, text: string, values: unknown[] = []): Promise<R | undefined> {
  const result = await db.query<R>(text, values);
  return result.rows[0];
}

export async function many<R extends QueryResultRow>(db: Db, text: string, values: unknown[] = []): Promise<R[]> {
  return (await db.query<R>(text, values)).rows;
}

export async function withTransaction<T>(pool: pg.Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

/** Postgres error code helper, e.g. 23505 unique_violation. */
export function pgCode(e: unknown): string | undefined {
  return typeof e === 'object' && e !== null && 'code' in e && typeof e.code === 'string' ? e.code : undefined;
}
