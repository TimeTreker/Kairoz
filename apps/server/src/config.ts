import { z } from 'zod';

const Env = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().int().min(1).max(65535).default(8081),
  HOST: z.string().default('127.0.0.1'),
  /**
   * `dev-username`: log in with a username only. For local development and the prototype phase;
   * production must use the organization identity provider (not yet integrated).
   */
  KAIROZ_AUTH_MODE: z.enum(['dev-username', 'disabled']).default('disabled'),
  SESSION_TTL_HOURS: z.coerce.number().positive().max(24 * 30).default(8),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export interface Config {
  databaseUrl: string;
  port: number;
  host: string;
  authMode: 'dev-username' | 'disabled';
  sessionTtlMs: number;
  logLevel: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`invalid environment: ${problems}`);
  }
  const e = parsed.data;
  return {
    databaseUrl: e.DATABASE_URL,
    port: e.PORT,
    host: e.HOST,
    authMode: e.KAIROZ_AUTH_MODE,
    sessionTtlMs: e.SESSION_TTL_HOURS * 3600_000,
    logLevel: e.LOG_LEVEL,
  };
}
