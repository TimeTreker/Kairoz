// Accounts and grants (平台运维). Username-only sign-in is a prototype convenience; the grant
// model and the single-grant authorization rule are the real design.

import type { Draft } from 'immer';
import { grantIssues, isFullPlatformOps } from '../domain/authz.ts';
import type { Grant, GrantInput } from '../domain/authz.ts';
import { conflict, notFound, rule } from '../domain/errors.ts';
import { newId, USERNAME } from '../domain/ids.ts';
import { ENVS, WILDCARD } from '../domain/vocabulary.ts';
import type { Env, Role } from '../domain/vocabulary.ts';
import type { Actor, Ctx } from './engine.ts';
import type { State } from './types.ts';

export const BOOTSTRAP_ADMIN = 'admin';

/** A clean installation has exactly one platform administrator. */
export function installAdmin(s: Draft<State>, now: string): void {
  s.accounts[BOOTSTRAP_ADMIN] = {
    username: BOOTSTRAP_ADMIN,
    displayName: '平台管理员',
    status: 'ACTIVE',
    grants: [
      {
        id: newId('gr'),
        role: 'PLATFORM_OPS',
        workspaces: [WILDCARD],
        groups: [],
        scopes: [],
        envs: [...ENVS],
        dispatchOnly: false,
      },
    ],
    createdBy: 'system',
    createdAt: now,
  };
}

function toGrants(inputs: GrantInput[]): Grant[] {
  return inputs.map((g) => ({
    id: newId('gr'),
    role: g.role as Role,
    workspaces: [...g.workspaces],
    groups: [...g.groups],
    scopes: [...g.scopes],
    envs: [...g.envs] as Env[],
    dispatchOnly: g.dispatchOnly ?? false,
  }));
}

/** Structure and references of a grant set. */
function checkGrants(s: Draft<State>, grants: GrantInput[]): void {
  const issues = grants.flatMap((g, index) => {
    const found = grantIssues(g);
    return found.length ? [{ index, issues: found }] : [];
  });
  if (issues.length) throw rule('INVALID_GRANTS', 'one or more grants are invalid', { grants: issues });
  const missing = {
    workspaces: [...new Set(grants.flatMap((g) => g.workspaces))].filter((w) => w !== WILDCARD && !s.workspaces[w]),
    groups: [...new Set(grants.flatMap((g) => g.groups))].filter((g) => g !== WILDCARD && !s.groups[g]),
  };
  if (missing.workspaces.length || missing.groups.length) {
    throw rule('UNKNOWN_GRANT_REFERENCE', 'grants reference unknown workspaces or groups', missing);
  }
}

function assertFullAdministratorRemains(s: Draft<State>): void {
  const ok = Object.values(s.accounts).some((a) => a.status === 'ACTIVE' && a.grants.some((g) => isFullPlatformOps(g)));
  if (!ok) throw rule('LAST_ADMINISTRATOR', 'at least one active account must keep PLATFORM_OPS in every environment');
}

export interface AccountInput {
  username: string;
  displayName: string;
  grants: GrantInput[];
}

export function createAccount(ctx: Ctx, input: AccountInput): string {
  ctx.allow('account.manage', { type: 'account', id: input.username });
  if (!USERNAME.test(input.username)) throw rule('INVALID_USERNAME', 'username must match ^[a-z][a-z0-9_]{2,31}$');
  if (ctx.s.accounts[input.username]) throw conflict('ACCOUNT_EXISTS', `account ${input.username} already exists`);
  if (!input.displayName.trim()) throw rule('NAME_REQUIRED', 'display name is required');
  checkGrants(ctx.s, input.grants);
  ctx.s.accounts[input.username] = {
    username: input.username,
    displayName: input.displayName.trim(),
    status: 'ACTIVE',
    grants: toGrants(input.grants),
    createdBy: ctx.user().username,
    createdAt: ctx.now,
  };
  return input.username;
}

export function updateAccount(ctx: Ctx, username: string, input: { displayName?: string; status?: 'ACTIVE' | 'DISABLED' }): void {
  ctx.allow('account.manage', { type: 'account', id: username });
  const account = ctx.s.accounts[username];
  if (!account) throw notFound('account', username);
  if (input.displayName !== undefined) {
    if (!input.displayName.trim()) throw rule('NAME_REQUIRED', 'display name is required');
    account.displayName = input.displayName.trim();
  }
  if (input.status !== undefined) account.status = input.status;
  assertFullAdministratorRemains(ctx.s);
}

/** Replaces the full grant set of an account. */
export function replaceGrants(ctx: Ctx, username: string, grants: GrantInput[]): void {
  ctx.allow('account.manage', { type: 'account', id: username });
  const account = ctx.s.accounts[username];
  if (!account) throw notFound('account', username);
  checkGrants(ctx.s, grants);
  account.grants = toGrants(grants);
  assertFullAdministratorRemains(ctx.s);
}

export interface WorkspaceAccess {
  workspaceId: string;
  roles: Role[];
}

/** Active workspaces the actor's grants cover, with the roles usable there. */
export function workspaceAccess(state: State, actor: Actor): WorkspaceAccess[] {
  return Object.values(state.workspaces)
    .filter((w) => w.status === 'ACTIVE')
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id))
    .flatMap((w) => {
      const roles = [
        ...new Set(actor.grants.filter((g) => g.workspaces.includes(WILDCARD) || g.workspaces.includes(w.id)).map((g) => g.role)),
      ];
      return roles.length ? [{ workspaceId: w.id, roles }] : [];
    });
}

export function hasRole(actor: Actor, role: Role): boolean {
  return actor.grants.some((g) => g.role === role);
}
