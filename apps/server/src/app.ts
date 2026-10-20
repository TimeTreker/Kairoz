import Fastify from 'fastify';
import type { FastifyError, FastifyInstance } from 'fastify';
import type pg from 'pg';
import type { Config } from './config.ts';
import { pgCode } from './db/pool.ts';
import { DomainError } from './domain/errors.ts';
import type { Deps } from './http/context.ts';
import { configRoutes } from './modules/config/routes.ts';
import { findSession } from './modules/identity/service.ts';
import { identityRoutes } from './modules/identity/routes.ts';
import { orgRoutes } from './modules/org/routes.ts';
import { processingRoutes } from './modules/processing/routes.ts';

export interface AppOptions {
  pool: pg.Pool;
  config: Config;
  logger?: boolean;
}

export function buildApp(options: AppOptions): FastifyInstance {
  const app = Fastify({
    logger: options.logger === false ? false : { level: options.config.logLevel },
    requestIdHeader: 'x-request-id',
    bodyLimit: 1024 * 1024,
  });
  const deps: Deps = { pool: options.pool };

  app.decorateRequest('session', null);
  app.addHook('onRequest', async (req) => {
    const header = req.headers.authorization;
    req.session = header?.startsWith('Bearer ') ? await findSession(options.pool, header.slice(7).trim()) : null;
  });

  app.setErrorHandler((err: FastifyError | DomainError | Error, req, reply) => {
    if (err instanceof DomainError) {
      return reply.code(err.status).send({ error: { code: err.code, message: err.message, details: err.details ?? null } });
    }
    const code = pgCode(err);
    if (code === '23505') {
      return reply.code(409).send({ error: { code: 'ALREADY_EXISTS', message: 'a conflicting record already exists', details: null } });
    }
    if (code?.startsWith('22')) {
      // Data exceptions, e.g. NUL characters in text or out-of-range numbers.
      return reply.code(400).send({ error: { code: 'INVALID_INPUT', message: 'the request contains invalid values', details: null } });
    }
    if (code === '57014' || code === '55P03') {
      // Statement timeout or lock not available: the server is busy, not the request wrong.
      return reply.code(503).send({ error: { code: 'BUSY', message: 'the request timed out waiting; retry later', details: null } });
    }
    if (code === '40001' || code === '40P01') {
      return reply.code(409).send({ error: { code: 'RETRY', message: 'concurrent update; retry the request', details: null } });
    }
    const status = 'statusCode' in err && typeof err.statusCode === 'number' ? err.statusCode : 500;
    if (status < 500) {
      const fastifyCode = 'code' in err && typeof err.code === 'string' ? err.code : 'BAD_REQUEST';
      return reply.code(status).send({ error: { code: fastifyCode, message: err.message, details: null } });
    }
    req.log.error({ err }, 'unhandled error');
    return reply.code(500).send({ error: { code: 'INTERNAL', message: 'internal error', details: null } });
  });

  app.setNotFoundHandler((req, reply) =>
    reply.code(404).send({ error: { code: 'ROUTE_NOT_FOUND', message: `no route ${req.method} ${req.url}`, details: null } }),
  );

  app.get('/health', async () => {
    await options.pool.query('SELECT 1');
    return { status: 'ok' };
  });

  identityRoutes(app, deps, options.config);
  orgRoutes(app, deps);
  processingRoutes(app, deps);
  configRoutes(app, deps);
  return app;
}
