import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { sha256Hex } from '../domain/canonical.ts';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations/', import.meta.url));
const LOCK_KEY = 0x6b61_6972; // "kair"

export interface MigrationResult {
  applied: string[];
}

/**
 * Applies pending `migrations/*.sql` files in name order, each in its own transaction.
 * Refuses to run if an already-applied file was edited.
 */
export async function migrate(pool: pg.Pool, log: (line: string) => void = () => undefined): Promise<MigrationResult> {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const done = new Map(
      (await client.query<{ version: string; checksum: string }>('SELECT version, checksum FROM schema_migrations')).rows.map(
        (r) => [r.version, r.checksum],
      ),
    );
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
    const applied: string[] = [];
    for (const file of files) {
      const sql = await readFile(MIGRATIONS_DIR + file, 'utf8');
      const checksum = sha256Hex(sql);
      const known = done.get(file);
      if (known !== undefined) {
        if (known !== checksum) throw new Error(`migration ${file} was modified after it was applied`);
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query('SET LOCAL statement_timeout = 0');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)', [file, checksum]);
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw new Error(`migration ${file} failed: ${(e as Error).message}`, { cause: e });
      }
      applied.push(file);
      log(`applied ${file}`);
    }
    return { applied };
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => undefined);
    client.release();
  }
}
