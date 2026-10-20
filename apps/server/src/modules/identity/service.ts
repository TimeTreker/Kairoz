import { createHash, randomBytes } from 'node:crypto';
import type pg from 'pg';
import type { Db } from '../../db/pool.ts';
import { many, one, withTransaction } from '../../db/pool.ts';
import { grantIssues, isFullPlatformOps } from '../../domain/authz.ts';
import type { Grant, GrantInput } from '../../domain/authz.ts';
import { conflict, ForbiddenError, notFound, revisionConflict, rule } from '../../domain/errors.ts';
import { USERNAME } from '../../domain/ids.ts';
import { WILDCARD } from '../../domain/vocabulary.ts';
import type { Env, Role } from '../../domain/vocabulary.ts';
import type { ReadCtx, Session, WriteCtx } from '../../http/context.ts';
import { writeAudit } from '../audit/service.ts';

export const BOOTSTRAP_ADMIN = 'admin';

interface AccountRow {
  username: string;
  display_name: string;
  status: 'ACTIVE' | 'DISABLED';
  auth_version: number;
  revision: number;
  created_at: Date;
  updated_at: Date;
}

interface GrantRow {
  id: string;
  username: string;
  role: Role;
  workspaces: string[];
  groups: string[];
  scopes: string[];
  envs: Env[];
}

export interface AccountView {
  username: string;
  displayName: string;
  status: 'ACTIVE' | 'DISABLED';
  revision: number;
  grants: Grant[];
  createdAt: string;
  updatedAt: string;
}

function toGrant(r: GrantRow): Grant {
  return { id: r.id, role: r.role, workspaces: r.workspaces, groups: r.groups, scopes: r.scopes, envs: r.envs };
}

function toView(a: AccountRow, grants: GrantRow[]): AccountView {
  return {
    username: a.username,
    displayName: a.display_name,
    status: a.status,
    revision: a.revision,
    grants: grants.filter((g) => g.username === a.username).map(toGrant),
    createdAt: a.created_at.toISOString(),
    updatedAt: a.updated_at.toISOString(),
  };
}

async function accountView(db: Db, username: string): Promise<AccountView> {
  const account = await one<AccountRow>(db, 'SELECT * FROM accounts WHERE username = $1', [username]);
  if (!account) throw notFound('account', username);
  const grants = await many<GrantRow>(db, 'SELECT * FROM grants WHERE username = $1 ORDER BY position', [username]);
  return toView(account, grants);
}

// ---------------------------------------------------------------------------
// Bootstrap and sessions
// ---------------------------------------------------------------------------

/** A clean installation gets exactly one platform administrator, `admin`. */
export async function bootstrap(pool: pg.Pool): Promise<boolean> {
  return withTransaction(pool, async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtext('kairoz.accounts'))");
    const existing = await one(tx, 'SELECT 1 FROM accounts LIMIT 1');
    if (existing) return false;
    await tx.query("INSERT INTO accounts (username, display_name, created_by) VALUES ($1, '平台管理员', 'system')", [
      BOOTSTRAP_ADMIN,
    ]);
    await tx.query(
      `INSERT INTO grants (username, position, role, workspaces, envs)
       VALUES ($1, 0, 'PLATFORM_OPS', ARRAY['*'], ARRAY['development', 'testing', 'production'])`,
      [BOOTSTRAP_ADMIN],
    );
    await writeAudit(tx, null, 'bootstrap', [
      { action: 'system.bootstrap', outcome: 'ALLOWED', targetType: 'account', targetId: BOOTSTRAP_ADMIN },
    ]);
    return true;
  });
}

function hashToken(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}

export async function findSession(db: Db, token: string): Promise<Session | null> {
  const tokenHash = hashToken(token);
  const row = await one<{ username: string; auth_version: number }>(
    db,
    'SELECT username, auth_version FROM sessions WHERE token_hash = $1 AND expires_at > now()',
    [tokenHash],
  );
  return row ? { username: row.username, authVersion: row.auth_version, tokenHash } : null;
}

/** Username-only login. Only enabled in `dev-username` auth mode. */
export async function devLogin(pool: pg.Pool, username: string, ttlMs: number) {
  const account = await one<AccountRow>(pool, 'SELECT * FROM accounts WHERE username = $1', [username]);
  if (!account || account.status !== 'ACTIVE') {
    await writeAudit(pool, username, 'login', [{ action: 'session.login', outcome: 'DENIED', reason: 'UNKNOWN_OR_DISABLED' }]);
    throw rule('LOGIN_REJECTED', 'unknown or disabled account');
  }
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + ttlMs);
  await pool.query('INSERT INTO sessions (token_hash, username, auth_version, expires_at) VALUES ($1, $2, $3, $4)', [
    hashToken(token),
    username,
    account.auth_version,
    expiresAt,
  ]);
  await pool.query('DELETE FROM sessions WHERE username = $1 AND expires_at <= now()', [username]);
  await writeAudit(pool, username, 'login', [{ action: 'session.login', outcome: 'ALLOWED' }]);
  return { token, expiresAt: expiresAt.toISOString(), account: await accountView(pool, username) };
}

export async function logout(db: Db, session: Session): Promise<void> {
  await db.query('DELETE FROM sessions WHERE token_hash = $1', [session.tokenHash]);
}

// ---------------------------------------------------------------------------
// Current account
// ---------------------------------------------------------------------------

export interface WorkspaceAccess {
  workspaceId: string;
  name: string;
  kind: string;
  roles: Role[];
}

/** The caller's account plus every active workspace a grant covers, with the roles usable there. */
export async function me(ctx: ReadCtx) {
  const account = await accountView(ctx.db, ctx.actor.username);
  const workspaces = await many<{ id: string; name: string; kind: string }>(
    ctx.db,
    "SELECT id, name, kind FROM workspaces WHERE status = 'ACTIVE' ORDER BY kind, id",
  );
  const access: WorkspaceAccess[] = [];
  for (const w of workspaces) {
    const roles = [
      ...new Set(
        ctx.actor.grants
          .filter((g) => g.workspaces.includes(WILDCARD) || g.workspaces.includes(w.id))
          .map((g) => g.role),
      ),
    ];
    if (roles.length > 0) access.push({ workspaceId: w.id, name: w.name, kind: w.kind, roles });
  }
  return { account, workspaces: access };
}

// ---------------------------------------------------------------------------
// Account administration (平台运维)
// ---------------------------------------------------------------------------

export async function listAccounts(ctx: ReadCtx): Promise<AccountView[]> {
  if (!ctx.actor.grants.some((g) => g.role === 'PLATFORM_OPS')) {
    throw new ForbiddenError('account.list', 'ROLE_NOT_GRANTED', { type: 'account' });
  }
  const accounts = await many<AccountRow>(ctx.db, 'SELECT * FROM accounts ORDER BY username');
  const grants = await many<GrantRow>(ctx.db, 'SELECT * FROM grants ORDER BY username, position');
  return accounts.map((a) => toView(a, grants));
}

async function lockAccounts(db: Db): Promise<void> {
  // Serializes account mutations so the "one full administrator remains" check cannot race.
  await db.query("SELECT pg_advisory_xact_lock(hashtext('kairoz.accounts'))");
}

/** Validates structure and that every referenced workspace and group exists. */
async function checkGrants(db: Db, grants: GrantInput[]): Promise<void> {
  const issues: { index: number; issues: string[] }[] = [];
  grants.forEach((g, index) => {
    const found = grantIssues(g);
    if (found.length) issues.push({ index, issues: found });
  });
  if (issues.length) throw rule('INVALID_GRANTS', 'one or more grants are invalid', { grants: issues });

  const workspaceIds = [...new Set(grants.flatMap((g) => g.workspaces).filter((w) => w !== WILDCARD))];
  const groupIds = [...new Set(grants.flatMap((g) => g.groups).filter((g) => g !== WILDCARD))];
  const knownWorkspaces = new Set(
    (await many<{ id: string }>(db, 'SELECT id FROM workspaces WHERE id = ANY($1)', [workspaceIds])).map((r) => r.id),
  );
  const knownGroups = new Set(
    (await many<{ id: string }>(db, 'SELECT id FROM business_groups WHERE id = ANY($1)', [groupIds])).map((r) => r.id),
  );
  const missing = {
    workspaces: workspaceIds.filter((w) => !knownWorkspaces.has(w)),
    groups: groupIds.filter((g) => !knownGroups.has(g)),
  };
  if (missing.workspaces.length || missing.groups.length) {
    throw rule('UNKNOWN_GRANT_REFERENCE', 'grants reference unknown workspaces or groups', missing);
  }
}

async function insertGrants(db: Db, username: string, grants: GrantInput[]): Promise<void> {
  let position = 0;
  for (const g of grants) {
    await db.query(
      `INSERT INTO grants (username, position, role, workspaces, groups, scopes, envs)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [username, position++, g.role, g.workspaces, g.groups, g.scopes, g.envs],
    );
  }
}

async function assertFullAdministratorRemains(db: Db): Promise<void> {
  const rows = await many<{ role: Role; envs: Env[] }>(
    db,
    `SELECT g.role, g.envs FROM grants g JOIN accounts a ON a.username = g.username
     WHERE a.status = 'ACTIVE' AND g.role = 'PLATFORM_OPS'`,
  );
  if (!rows.some(isFullPlatformOps)) {
    throw rule('LAST_ADMINISTRATOR', 'at least one active account must keep PLATFORM_OPS in every environment');
  }
}

export interface CreateAccountInput {
  username: string;
  displayName: string;
  grants: GrantInput[];
}

export async function createAccount(ctx: WriteCtx, input: CreateAccountInput): Promise<AccountView> {
  ctx.allow('account.manage', { type: 'account', id: input.username });
  if (!USERNAME.test(input.username)) throw rule('INVALID_USERNAME', 'username must match ^[a-z][a-z0-9_]{2,31}$');
  await lockAccounts(ctx.db);
  if (await one(ctx.db, 'SELECT 1 FROM accounts WHERE username = $1', [input.username])) {
    throw conflict('ACCOUNT_EXISTS', `account ${input.username} already exists`);
  }
  await checkGrants(ctx.db, input.grants);
  await ctx.db.query('INSERT INTO accounts (username, display_name, created_by) VALUES ($1, $2, $3)', [
    input.username,
    input.displayName,
    ctx.actor.username,
  ]);
  await insertGrants(ctx.db, input.username, input.grants);
  return accountView(ctx.db, input.username);
}

async function lockAccount(db: Db, username: string, expectedRevision: number): Promise<AccountRow> {
  const account = await one<AccountRow>(db, 'SELECT * FROM accounts WHERE username = $1 FOR UPDATE', [username]);
  if (!account) throw notFound('account', username);
  if (account.revision !== expectedRevision) throw revisionConflict('account', username, account.revision);
  return account;
}

export interface UpdateAccountInput {
  expectedRevision: number;
  displayName?: string;
  status?: 'ACTIVE' | 'DISABLED';
}

export async function updateAccount(ctx: WriteCtx, username: string, input: UpdateAccountInput): Promise<AccountView> {
  ctx.allow('account.manage', { type: 'account', id: username });
  await lockAccounts(ctx.db);
  const account = await lockAccount(ctx.db, username, input.expectedRevision);
  const status = input.status ?? account.status;
  const statusChanged = status !== account.status;
  await ctx.db.query(
    `UPDATE accounts SET display_name = $2, status = $3, revision = revision + 1, updated_at = now(),
       auth_version = auth_version + $4
     WHERE username = $1`,
    [username, input.displayName ?? account.display_name, status, statusChanged ? 1 : 0],
  );
  if (statusChanged) {
    await ctx.db.query('DELETE FROM sessions WHERE username = $1', [username]);
    await assertFullAdministratorRemains(ctx.db);
  }
  return accountView(ctx.db, username);
}

/** Replaces the full grant set. Existing sessions of the account become invalid. */
export async function replaceGrants(
  ctx: WriteCtx,
  username: string,
  input: { expectedRevision: number; grants: GrantInput[] },
): Promise<AccountView> {
  ctx.allow('account.manage', { type: 'account', id: username });
  await lockAccounts(ctx.db);
  await lockAccount(ctx.db, username, input.expectedRevision);
  await checkGrants(ctx.db, input.grants);
  await ctx.db.query('DELETE FROM grants WHERE username = $1', [username]);
  await insertGrants(ctx.db, username, input.grants);
  await ctx.db.query(
    `UPDATE accounts SET revision = revision + 1, auth_version = auth_version + 1, updated_at = now()
     WHERE username = $1`,
    [username],
  );
  await ctx.db.query('DELETE FROM sessions WHERE username = $1', [username]);
  await assertFullAdministratorRemains(ctx.db);
  return accountView(ctx.db, username);
}
