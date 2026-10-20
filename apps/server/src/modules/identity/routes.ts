import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Config } from '../../config.ts';
import { DomainError, ForbiddenError, unauthenticated } from '../../domain/errors.ts';
import { ENVS, ROLES } from '../../domain/vocabulary.ts';
import { reader, writer } from '../../http/context.ts';
import type { Deps } from '../../http/context.ts';
import { name, parse, revision } from '../../http/validation.ts';
import { listAudit } from '../audit/service.ts';
import * as identity from './service.ts';

const grant = z.strictObject({
  role: z.enum(ROLES as [string, ...string[]]),
  workspaces: z.array(z.string().min(1)).max(200),
  groups: z.array(z.string().min(1)).max(200).default([]),
  scopes: z.array(z.string().min(1)).max(20).default([]),
  envs: z.array(z.enum(ENVS)).max(3),
});
const grants = z.array(grant).max(50);

export function identityRoutes(app: FastifyInstance, deps: Deps, config: Config): void {
  app.post('/api/v1/auth/dev-login', async (req) => {
    if (config.authMode !== 'dev-username') {
      throw new DomainError(403, 'LOGIN_MODE_DISABLED', 'username login is disabled on this server');
    }
    const body = parse(z.strictObject({ username: z.string().min(1).max(64) }), req.body);
    return identity.devLogin(deps.pool, body.username, config.sessionTtlMs);
  });

  app.post('/api/v1/auth/logout', async (req, reply) => {
    if (!req.session) throw unauthenticated();
    await identity.logout(deps.pool, req.session);
    reply.code(204);
  });

  app.get('/api/v1/me', reader(deps, (ctx) => identity.me(ctx)));

  app.get('/api/v1/accounts', reader(deps, (ctx) => identity.listAccounts(ctx)));

  app.post(
    '/api/v1/accounts',
    writer(
      deps,
      (ctx, req) =>
        identity.createAccount(
          ctx,
          parse(z.strictObject({ username: z.string().min(1).max(64), displayName: name, grants }), req.body),
        ),
      { status: 201 },
    ),
  );

  app.patch(
    '/api/v1/accounts/:username',
    writer(deps, (ctx, req) => {
      const { username } = parse(z.object({ username: z.string().min(1) }), req.params);
      const body = parse(
        z.strictObject({ expectedRevision: revision, displayName: name.optional(), status: z.enum(['ACTIVE', 'DISABLED']).optional() }),
        req.body,
      );
      return identity.updateAccount(ctx, username, body);
    }),
  );

  app.put(
    '/api/v1/accounts/:username/grants',
    writer(deps, (ctx, req) => {
      const { username } = parse(z.object({ username: z.string().min(1) }), req.params);
      return identity.replaceGrants(ctx, username, parse(z.strictObject({ expectedRevision: revision, grants }), req.body));
    }),
  );

  app.get(
    '/api/v1/audit',
    reader(deps, async (ctx, req) => {
      if (!ctx.actor.grants.some((g) => g.role === 'PLATFORM_OPS')) {
        throw new ForbiddenError('audit.read', 'ROLE_NOT_GRANTED', { type: 'audit' });
      }
      const q = parse(
        z.object({
          username: z.string().optional(),
          action: z.string().optional(),
          targetType: z.string().optional(),
          targetId: z.string().optional(),
          beforeId: z.string().regex(/^\d{1,18}$/).optional(),
          limit: z.coerce.number().int().min(1).max(500).default(100),
        }),
        req.query,
      );
      return listAudit(ctx.db, q);
    }),
  );
}
