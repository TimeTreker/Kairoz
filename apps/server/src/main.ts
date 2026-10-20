import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { migrate } from './db/migrate.ts';
import { createPool } from './db/pool.ts';
import { bootstrap } from './modules/identity/service.ts';

const config = loadConfig();
const pool = createPool({ connectionString: config.databaseUrl });
const app = buildApp({ pool, config });

await migrate(pool, (line) => app.log.info(line));
if (await bootstrap(pool)) app.log.info('clean installation: created platform administrator "admin"');
if (config.authMode === 'dev-username') {
  app.log.warn('KAIROZ_AUTH_MODE=dev-username: anyone can log in with a username only; never use this in production');
}

// Expired sessions and old idempotency records are housekeeping, not correctness.
const housekeeping = setInterval(() => {
  pool
    .query("DELETE FROM sessions WHERE expires_at <= now(); DELETE FROM idempotency_keys WHERE created_at < now() - interval '24 hours'")
    .catch((err: unknown) => app.log.error({ err }, 'housekeeping failed'));
}, 3600_000);
housekeeping.unref();

const shutdown = async () => {
  await app.close();
  await pool.end();
  process.exit(0);
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

await app.listen({ port: config.port, host: config.host });
