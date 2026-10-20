import { buildApp } from '../app.ts';
import { loadConfig } from '../config.ts';
import { migrate } from '../db/migrate.ts';
import { createPool } from '../db/pool.ts';
import { bootstrap } from '../modules/identity/service.ts';
import { seedDemo } from './seed.ts';

// Username login is enabled for this in-process app only; nothing listens on the network.
const config = { ...loadConfig(), authMode: 'dev-username' as const };
const pool = createPool({ connectionString: config.databaseUrl });
try {
  await migrate(pool);
  await bootstrap(pool);
  const app = buildApp({ pool, config, logger: false });
  await app.ready();
  try {
    for (const line of await seedDemo(app)) console.log(line);
  } finally {
    await app.close();
  }
} finally {
  await pool.end();
}
