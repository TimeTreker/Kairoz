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
import { getUnit, unitWithin } from './org.ts';
import { releasePersonalSimsOf } from './personal-sim.ts';
import type { Account, GrantRule, State } from './types.ts';

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
    orgUnitId: null,
    employeeId: null,
    grantReview: null,
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
    orgUnitId: null,
    employeeId: null,
    grantReview: null,
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
  if (input.status === 'DISABLED') releasePersonalSimsOf(ctx, username);
}

/** Replaces the full grant set of an account. Reviewing them after a move is done with it. */
export function replaceGrants(ctx: Ctx, username: string, grants: GrantInput[]): void {
  ctx.allow('account.manage', { type: 'account', id: username });
  const account = ctx.s.accounts[username];
  if (!account) throw notFound('account', username);
  checkGrants(ctx.s, grants);
  account.grants = toGrants(grants);
  account.grantReview = null;
  assertFullAdministratorRemains(ctx.s);
}

/** Platform ops keeps an account's explicit grants unchanged after the person moved units. */
export function confirmGrantReview(ctx: Ctx, username: string): void {
  ctx.allow('account.manage', { type: 'account', id: username });
  const account = ctx.s.accounts[username];
  if (!account) throw notFound('account', username);
  if (!account.grantReview) throw rule('NO_REVIEW_PENDING', 'the account has no grants waiting for review');
  account.grantReview = null;
}

// ---------------------------------------------------------------------------
// Base rights from org membership (按组织授予的基础权限)
// ---------------------------------------------------------------------------

/** What an org grant rule may give: developing in the team's own groups, in development only. */
export const BASE_RULE_ROLES: readonly Role[] = ['BUSINESS_DEV'];
export const BASE_RULE_ENVS: readonly Env[] = ['development'];

/** Whether a rule covers members of a unit: its own unit, or below it when it includes subunits. */
export function ruleCovers(s: State, r: GrantRule, unitId: string): boolean {
  return r.orgUnitId === unitId || (r.includeSubunits && unitWithin(s, unitId, r.orgUnitId));
}

/**
 * The grants an account acts with: its explicit grants, plus one complete grant per active rule
 * covering the active unit the directory places it in. Each is still matched alone.
 */
export function grantsOf(s: State, account: Pick<Account, 'grants' | 'orgUnitId'>): Grant[] {
  const unit = account.orgUnitId ? s.orgUnits[account.orgUnitId] : undefined;
  if (!unit || unit.status !== 'ACTIVE') return account.grants;
  const derived: Grant[] = Object.values(s.grantRules)
    .filter((r) => r.status === 'ACTIVE' && s.orgUnits[r.orgUnitId]?.status === 'ACTIVE' && ruleCovers(s, r, unit.id))
    .map((r) => ({ id: `rule:${r.id}`, role: r.role, workspaces: [...r.workspaces], groups: [...r.groups], scopes: [...r.scopes], envs: [...r.envs], dispatchOnly: false, ruleId: r.id }));
  return derived.length ? [...account.grants, ...derived] : account.grants;
}

export interface GrantRuleInput {
  orgUnitId: string;
  includeSubunits: boolean;
  role: string;
  workspaces: string[];
  groups: string[];
  scopes: string[];
  envs: string[];
}

/** Platform ops gives the members of a team unit base rights. Special rights stay explicit. */
export function createGrantRule(ctx: Ctx, input: GrantRuleInput): string {
  ctx.allow('account.manage', { type: 'grantRule', id: input.orgUnitId });
  const unit = getUnit(ctx.s, input.orgUnitId);
  if (unit.kind !== 'TEAM') throw rule('UNIT_NOT_TEAM', 'base rights follow the team organization; choose a team unit');
  if (unit.status !== 'ACTIVE') throw rule('UNIT_ARCHIVED', `organization unit ${unit.id} is archived`);
  if (!(BASE_RULE_ROLES as string[]).includes(input.role) || input.envs.some((e) => !(BASE_RULE_ENVS as string[]).includes(e))) {
    throw rule('GRANT_NOT_BASE_ELIGIBLE', 'org rules only give business development in the development environment; other rights are granted to people explicitly');
  }
  checkGrants(ctx.s, [{ ...input, dispatchOnly: false }]);
  const id = newId('gk');
  ctx.s.grantRules[id] = {
    id,
    orgUnitId: unit.id,
    includeSubunits: input.includeSubunits,
    role: input.role as Role,
    workspaces: [...input.workspaces],
    groups: [...input.groups],
    scopes: [...input.scopes],
    envs: [...input.envs] as Env[],
    status: 'ACTIVE',
    createdBy: ctx.user().username,
    createdAt: ctx.now,
  };
  return id;
}

/** Stops a rule; its members lose the grants it gave at once. */
export function archiveGrantRule(ctx: Ctx, ruleId: string): void {
  ctx.allow('account.manage', { type: 'grantRule', id: ruleId });
  const r = ctx.s.grantRules[ruleId];
  if (!r) throw notFound('grant rule', ruleId);
  if (r.status !== 'ACTIVE') throw rule('RULE_ARCHIVED', 'the rule is already archived');
  r.status = 'ARCHIVED';
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
