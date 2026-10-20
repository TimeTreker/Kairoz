// Request contexts handed to services. Writes run in one transaction together with their audit
// entries and idempotency record; a denial is audited separately because its transaction rolls back.

import type { FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import type { Db } from '../db/pool.ts';
import { many, one, withTransaction } from '../db/pool.ts';
import { authorize } from '../domain/authz.ts';
import type { Action, AuthzTarget, Grant } from '../domain/authz.ts';
import { digestOf } from '../domain/canonical.ts';
import { DomainError, ForbiddenError, rule, unauthenticated } from '../domain/errors.ts';
import type { Env, Role } from '../domain/vocabulary.ts';
import { writeAudit } from '../modules/audit/service.ts';
import type { AuditEntry } from '../modules/audit/service.ts';

export interface Session {
  username: string;
  authVersion: number;
  tokenHash: Buffer;
}

declare module 'fastify' {
  interface FastifyRequest {
    session: Session | null;
  }
}

export interface Actor {
  username: string;
  displayName: string;
  authVersion: number;
  grants: Grant[];
}

export interface ReadCtx {
  db: Db;
  actor: Actor;
}

export type AllowTarget = AuthzTarget & { type: string; id?: string };

export interface WriteCtx extends ReadCtx {
  requestId: string;
  /** Authorizes with the single-grant rule and records the decision. Throws ForbiddenError. */
  allow(action: Action, target: AllowTarget): Grant;
}

export async function loadActor(db: Db, session: Session, lock: boolean): Promise<Actor> {
  const account = await one<{ username: string; display_name: string; status: string; auth_version: number }>(
    db,
    `SELECT username, display_name, status, auth_version FROM accounts WHERE username = $1${lock ? ' FOR SHARE' : ''}`,
    [session.username],
  );
  if (!account || account.status !== 'ACTIVE' || account.auth_version !== session.authVersion) {
    throw unauthenticated('session is no longer valid; log in again');
  }
  const grants = await many<{ id: string; role: Role; workspaces: string[]; groups: string[]; scopes: string[]; envs: Env[] }>(
    db,
    'SELECT id, role, workspaces, groups, scopes, envs FROM grants WHERE username = $1 ORDER BY position',
    [session.username],
  );
  return { username: account.username, displayName: account.display_name, authVersion: account.auth_version, grants };
}

function requireSession(req: FastifyRequest): Session {
  if (!req.session) throw unauthenticated();
  return req.session;
}

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_.:-]{8,128}$/;

function idempotencyKey(req: FastifyRequest): string | undefined {
  const raw = req.headers['idempotency-key'];
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string' || !IDEMPOTENCY_KEY.test(raw)) {
    throw new DomainError(400, 'INVALID_IDEMPOTENCY_KEY', 'Idempotency-Key must be 8-128 characters of [A-Za-z0-9_.:-]');
  }
  return raw;
}

type Stored = { status: number; body: unknown };

/** Returns the stored response if this key was already used for the same request. */
async function claimKey(db: Db, username: string, key: string, fingerprint: string): Promise<Stored | undefined> {
  // A concurrent request with the same key blocks here until the first one commits or rolls back.
  const inserted = await one(
    db,
    `INSERT INTO idempotency_keys (username, key, fingerprint) VALUES ($1, $2, $3)
     ON CONFLICT (username, key) DO NOTHING RETURNING key`,
    [username, key, fingerprint],
  );
  if (inserted) return undefined;
  const prior = await one<{ fingerprint: string; status_code: number; response: unknown }>(
    db,
    'SELECT fingerprint, status_code, response FROM idempotency_keys WHERE username = $1 AND key = $2',
    [username, key],
  );
  if (!prior) throw new Error('idempotency key vanished');
  if (prior.fingerprint !== fingerprint) {
    throw rule('IDEMPOTENCY_KEY_REUSED', 'this Idempotency-Key was already used for a different request');
  }
  return { status: prior.status_code, body: prior.response };
}

export interface Deps {
  pool: pg.Pool;
}

type Handler = (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

export function reader(deps: Deps, fn: (ctx: ReadCtx, req: FastifyRequest) => Promise<unknown>): Handler {
  return async (req) => {
    const actor = await loadActor(deps.pool, requireSession(req), false);
    return fn({ db: deps.pool, actor }, req);
  };
}

export function writer(
  deps: Deps,
  fn: (ctx: WriteCtx, req: FastifyRequest) => Promise<unknown>,
  options: { status?: number } = {},
): Handler {
  const status = options.status ?? 200;
  return async (req, reply) => {
    const session = requireSession(req);
    const key = idempotencyKey(req);
    const fingerprint = digestOf({ method: req.method, url: req.url, body: req.body ?? null });
    try {
      const outcome = await withTransaction(deps.pool, async (tx): Promise<Stored & { replayed: boolean }> => {
        const actor = await loadActor(tx, session, true);
        if (key) {
          const prior = await claimKey(tx, actor.username, key, fingerprint);
          if (prior) return { ...prior, replayed: true };
        }
        const audit: AuditEntry[] = [];
        const ctx: WriteCtx = {
          db: tx,
          actor,
          requestId: req.id,
          allow(action, target) {
            const result = authorize(actor.grants, action, target);
            const { type, id, ...scope } = target;
            if (!result.ok) throw new ForbiddenError(action, result.reason, { type, id, ...scope });
            audit.push({
              action,
              outcome: 'ALLOWED',
              role: result.grant.role,
              grantId: result.grant.id,
              targetType: type,
              ...(id !== undefined ? { targetId: id } : {}),
              ...(target.workspaceId !== undefined ? { workspaceId: target.workspaceId } : {}),
            });
            return result.grant;
          },
        };
        const body = (await fn(ctx, req)) ?? null;
        await writeAudit(tx, actor.username, req.id, audit);
        if (key) {
          await tx.query('UPDATE idempotency_keys SET status_code = $3, response = $4 WHERE username = $1 AND key = $2', [
            actor.username,
            key,
            status,
            JSON.stringify(body),
          ]);
        }
        return { status, body, replayed: false };
      });
      if (outcome.replayed) reply.header('idempotent-replayed', 'true');
      reply.code(outcome.status);
      return outcome.body;
    } catch (e) {
      if (e instanceof ForbiddenError) {
        const target = e.target as { type?: string; id?: string; workspaceId?: string };
        await writeAudit(deps.pool, session.username, req.id, [
          {
            action: e.action,
            outcome: 'DENIED',
            reason: e.reason,
            ...(target.type !== undefined ? { targetType: target.type } : {}),
            ...(target.id !== undefined ? { targetId: target.id } : {}),
            ...(target.workspaceId !== undefined ? { workspaceId: target.workspaceId } : {}),
            details: e.target,
          },
        ]).catch((err) => req.log.error({ err }, 'failed to audit denial'));
      }
      throw e;
    }
  };
}
