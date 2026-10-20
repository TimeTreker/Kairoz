import { loadConfig } from '../config.ts';
import { createPool } from './pool.ts';
import { migrate } from './migrate.ts';

const config = loadConfig();
const pool = createPool({ connectionString: config.databaseUrl });
try {
  const { applied } = await migrate(pool, (line) => console.log(line));
  console.log(applied.length ? `${applied.length} migration(s) applied` : 'database is up to date');
} finally {
  await pool.end();
}
