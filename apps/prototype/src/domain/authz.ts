// Authorization. The rule that matters most: an action is allowed only if ONE grant satisfies
// every condition (role, workspace, group or scope, environment). Grants are never combined.

import { ENVS, ROLE_INFO, ROLES, SCOPES, WILDCARD } from './vocabulary.ts';
import type { Domain, Env, Role, Scope } from './vocabulary.ts';

export interface Grant {
  id: string;
  role: Role;
  workspaces: string[];
  groups: string[];
  scopes: string[];
  envs: Env[];
  /** A tester grant that may dispatch configurations but not record results (仅下发). */
  dispatchOnly: boolean;
}

/** Roles whose grants may be limited to dispatching. */
export const DISPATCH_ONLY_ROLES: readonly Role[] = ['BUSINESS_TEST', 'INTEGRATION_TEST'];

interface ActionSpec {
  roles: readonly Role[];
  /**
   * The environment a grant must include. `all`: platform-wide effect, every environment.
   * `target`: the environment of the object acted on (a vehicle, vehicle group, rollout).
   */
  env: Env | 'all' | 'target';
  /** Dispatch-only tester grants never satisfy this action. */
  excludeDispatchOnly?: boolean;
}

export const ACTIONS = {
  // Platform administration (平台运维)
  'account.manage': { roles: ['PLATFORM_OPS'], env: 'all' },
  'org.manage': { roles: ['PLATFORM_OPS'], env: 'all' },
  'workspace.manage': { roles: ['PLATFORM_OPS'], env: 'all' },
  'group.create': { roles: ['PLATFORM_OPS', 'WORKSPACE_ADMIN'], env: 'development' },
  'reference.administer': { roles: ['PLATFORM_OPS'], env: 'all' },
  'audit.read': { roles: ['PLATFORM_OPS'], env: 'all' },
  // Processing catalog and intake (DCL 工程)
  'processing.manage': { roles: ['DCL_ENGINEER'], env: 'all' },
  'image.register': { roles: ['DCL_ENGINEER', 'VEHICLE_RESOURCE', 'PLATFORM_OPS'], env: 'all' },
  'dataItem.reviewOverlap': { roles: ['DCL_ENGINEER'], env: 'development' },
  'feature.review': { roles: ['DCL_ENGINEER'], env: 'development' },
  'feature.return': { roles: ['DCL_ENGINEER'], env: 'development' },
  'feature.editBinding': { roles: ['DCL_ENGINEER'], env: 'development' },
  'merge.confirmProcessing': { roles: ['DCL_ENGINEER'], env: 'testing' },
  // Business development (业务研发)
  'feature.create': { roles: ['BUSINESS_DEV'], env: 'development' },
  'feature.edit': { roles: ['BUSINESS_DEV'], env: 'development' },
  'feature.submit': { roles: ['BUSINESS_DEV'], env: 'development' },
  'reference.request': { roles: ['BUSINESS_DEV'], env: 'development' },
  'reference.decide': { roles: ['BUSINESS_DEV'], env: 'development' },
  // Validation (业务测试 / 集成测试)
  'feature.dispatch': { roles: ['BUSINESS_DEV', 'BUSINESS_TEST'], env: 'target' },
  'feature.requestTest': { roles: ['BUSINESS_DEV', 'BUSINESS_TEST'], env: 'target' },
  'testRequest.decide': { roles: ['WORKSPACE_ADMIN'], env: 'target' },
  'feature.recordTest': { roles: ['BUSINESS_TEST'], env: 'target', excludeDispatchOnly: true },
  'feature.verify': { roles: ['BUSINESS_TEST'], env: 'development', excludeDispatchOnly: true },
  'candidate.dispatch': { roles: ['INTEGRATION_TEST', 'CONFIG_INTEGRATOR'], env: 'testing' },
  'candidate.recordTest': { roles: ['INTEGRATION_TEST'], env: 'testing', excludeDispatchOnly: true },
  'candidate.verify': { roles: ['INTEGRATION_TEST'], env: 'testing', excludeDispatchOnly: true },
  // Vehicles (车辆资源 / 工作区管理员)
  'softwareVersion.record': { roles: ['VEHICLE_RESOURCE'], env: 'all' },
  'resource.manage': { roles: ['VEHICLE_RESOURCE'], env: 'target' },
  'simulation.manage': { roles: ['WORKSPACE_ADMIN', 'VEHICLE_RESOURCE'], env: 'target' },
  'workspace.resources': { roles: ['WORKSPACE_ADMIN', 'VEHICLE_RESOURCE'], env: 'target' },
  'vehicleGroup.manage': { roles: ['WORKSPACE_ADMIN', 'CONFIG_RELEASE'], env: 'target' },
  /** What a vehicle's client reports it runs: for those who work with the vehicle in a workspace. */
  'clientReport.read': {
    roles: ['VEHICLE_RESOURCE', 'WORKSPACE_ADMIN', 'BUSINESS_DEV', 'BUSINESS_TEST', 'INTEGRATION_TEST', 'CONFIG_RELEASE', 'DCL_ENGINEER'],
    env: 'target',
    excludeDispatchOnly: true,
  },
  // Integration (配置集成) and release (配置发布)
  'merge.manage': { roles: ['CONFIG_INTEGRATOR'], env: 'testing' },
  'release.promote': { roles: ['CONFIG_RELEASE'], env: 'production' },
  'ota.manage': { roles: ['CONFIG_RELEASE'], env: 'production' },
  // Data use (数据查询): roles that work with the data, within their grants; never platform ops.
  'event.query': {
    roles: ['BUSINESS_DEV', 'BUSINESS_TEST', 'DCL_ENGINEER', 'CONFIG_INTEGRATOR', 'INTEGRATION_TEST', 'CONFIG_RELEASE'],
    env: 'target',
    excludeDispatchOnly: true,
  },
  'event.reprocess': { roles: ['DCL_ENGINEER'], env: 'target' },
} as const satisfies Record<string, ActionSpec>;

export type Action = keyof typeof ACTIONS;

/**
 * What the action touches. Omitted fields are not checked. A value of `*` demands a wildcard
 * grant, e.g. `groupId: '*'` for an action that affects every group.
 */
export interface AuthzTarget {
  workspaceId?: string;
  groupId?: string;
  scope?: Scope | typeof WILDCARD;
  /** An environment required in addition to the action's own. */
  env?: Env;
}

export type DenyReason =
  | 'ROLE_NOT_GRANTED'
  | 'WORKSPACE_NOT_GRANTED'
  | 'GROUP_NOT_GRANTED'
  | 'SCOPE_NOT_GRANTED'
  | 'ENV_NOT_GRANTED'
  /** The only grants with the role are limited to dispatching. */
  | 'DISPATCH_ONLY_GRANT'
  /** Each condition is met by some grant, but no single grant meets all of them. */
  | 'NO_SINGLE_GRANT';

export type AuthzResult = { ok: true; grant: Grant } | { ok: false; reason: DenyReason };

type Dimension = 'workspace' | 'group' | 'scope' | 'env';
const DIMENSION_REASON: Record<Dimension, DenyReason> = {
  workspace: 'WORKSPACE_NOT_GRANTED',
  group: 'GROUP_NOT_GRANTED',
  scope: 'SCOPE_NOT_GRANTED',
  env: 'ENV_NOT_GRANTED',
};

function covers(list: readonly string[], value: string): boolean {
  return list.includes(WILDCARD) || list.includes(value);
}

/** The dimensions of `target` that `grant` fails, in a fixed order. */
function failedDimensions(grant: Grant, target: AuthzTarget, envs: readonly Env[]): Dimension[] {
  const failed: Dimension[] = [];
  if (target.workspaceId !== undefined && !covers(grant.workspaces, target.workspaceId)) failed.push('workspace');
  const dimension = ROLE_INFO[grant.role].dimension;
  if (dimension === 'groups' && target.groupId !== undefined && !covers(grant.groups, target.groupId)) {
    failed.push('group');
  }
  if (dimension === 'scopes' && target.scope !== undefined && !covers(grant.scopes, target.scope)) {
    failed.push('scope');
  }
  if (!envs.every((e) => grant.envs.includes(e))) failed.push('env');
  return failed;
}

export function authorize(grants: readonly Grant[], action: Action, target: AuthzTarget): AuthzResult {
  const spec: ActionSpec = ACTIONS[action];
  const withRole = grants.filter((g) => spec.roles.includes(g.role));
  if (withRole.length === 0) return { ok: false, reason: 'ROLE_NOT_GRANTED' };
  const candidates = spec.excludeDispatchOnly ? withRole.filter((g) => !g.dispatchOnly) : withRole;
  if (candidates.length === 0) return { ok: false, reason: 'DISPATCH_ONLY_GRANT' };

  if (spec.env === 'target' && target.env === undefined) throw new Error(`${action} needs the target environment`);
  const envs: Env[] = spec.env === 'all' ? [...ENVS] : spec.env === 'target' ? [] : [spec.env];
  if (target.env !== undefined && !envs.includes(target.env)) envs.push(target.env);
  const failures = candidates.map((g) => ({ grant: g, failed: failedDimensions(g, target, envs) }));
  const match = failures.find((f) => f.failed.length === 0);
  if (match) return { ok: true, grant: match.grant };

  // Report a dimension no grant satisfies; if every dimension is satisfied somewhere,
  // the request only works by combining grants, which is exactly what is forbidden.
  const order: Dimension[] = ['workspace', 'group', 'scope', 'env'];
  for (const dimension of order) {
    if (failures.every((f) => f.failed.includes(dimension))) return { ok: false, reason: DIMENSION_REASON[dimension] };
  }
  return { ok: false, reason: 'NO_SINGLE_GRANT' };
}

/** Roles that may read a business group's configuration content (files, policies, features). */
const CONFIG_READ_ROLES: readonly Role[] = ROLES.filter((r) => r !== 'PLATFORM_OPS' && r !== 'WORKSPACE_ADMIN');

/**
 * Read access to a group's configuration. Grouped roles need the group; scoped roles need the
 * group's domain or the whole-vehicle scope. Platform operations and workspace administration
 * never imply reading business configuration.
 */
export function canReadGroupConfig(
  grants: readonly Grant[],
  target: { groupId: string; domain: Domain; workspaceId?: string },
): boolean {
  return grants.some((g) => {
    if (!CONFIG_READ_ROLES.includes(g.role)) return false;
    if (target.workspaceId !== undefined && !covers(g.workspaces, target.workspaceId)) return false;
    const dimension = ROLE_INFO[g.role].dimension;
    if (dimension === 'groups') return covers(g.groups, target.groupId);
    if (dimension === 'scopes') return covers(g.scopes, target.domain) || covers(g.scopes, 'Vehicle');
    return false;
  });
}

type PageAccess = { roles: readonly Role[] } | { actions: readonly Action[] };

/**
 * Who may open each page: menus follow roles, and a link to a page the actor cannot open shows
 * "no access". A workspace page needs one grant with a listed role covering the current
 * workspace; a platform page needs one grant allowing one of its actions. Opening a page allows
 * no change: every write is still authorized as its own action. Pages not listed (workbench,
 * guide, prototype tools) are open to every signed-in account.
 */
export const PAGE_ACCESS: Readonly<Record<string, PageAccess>> = {
  features: { roles: ['BUSINESS_DEV', 'BUSINESS_TEST', 'DCL_ENGINEER', 'CONFIG_INTEGRATOR', 'INTEGRATION_TEST', 'CONFIG_RELEASE'] },
  data: { roles: ['BUSINESS_DEV', 'BUSINESS_TEST', 'DCL_ENGINEER'] },
  intake: { roles: ['DCL_ENGINEER'] },
  processing: { roles: ['DCL_ENGINEER', 'BUSINESS_DEV'] },
  fleet: { roles: ['VEHICLE_RESOURCE', 'WORKSPACE_ADMIN', 'BUSINESS_DEV', 'BUSINESS_TEST', 'INTEGRATION_TEST', 'CONFIG_RELEASE', 'DCL_ENGINEER'] },
  integration: { roles: ['CONFIG_INTEGRATOR', 'INTEGRATION_TEST', 'DCL_ENGINEER', 'CONFIG_RELEASE'] },
  release: { roles: ['CONFIG_RELEASE'] },
  query: { roles: ['BUSINESS_DEV', 'BUSINESS_TEST', 'DCL_ENGINEER', 'CONFIG_INTEGRATOR', 'INTEGRATION_TEST', 'CONFIG_RELEASE'] },
  org: { actions: ['org.manage', 'workspace.manage'] },
  accounts: { actions: ['account.manage'] },
  audit: { actions: ['audit.read'] },
};

/** Whether the grants open `page` in the given workspace (null: no workspace chosen). */
export function canOpenPage(grants: readonly Grant[], page: string, workspaceId: string | null): boolean {
  const access = PAGE_ACCESS[page];
  if (!access) return true;
  if ('actions' in access) return access.actions.some((action) => authorize(grants, action, {}).ok);
  return workspaceId !== null && grants.some((g) => access.roles.includes(g.role) && covers(g.workspaces, workspaceId));
}

export interface GrantInput {
  role: string;
  workspaces: string[];
  groups: string[];
  scopes: string[];
  envs: string[];
  dispatchOnly?: boolean;
}

/** Structural validation of one grant; existence of referenced objects is checked by the caller. */
export function grantIssues(input: GrantInput): string[] {
  const issues: string[] = [];
  if (!(ROLES as string[]).includes(input.role)) return [`unknown role ${input.role}`];
  const role = input.role as Role;
  const dimension = ROLE_INFO[role].dimension;
  const unique = (xs: string[]) => new Set(xs).size === xs.length;

  if (input.envs.length === 0) issues.push('envs must not be empty');
  for (const env of input.envs) if (!(ENVS as readonly string[]).includes(env)) issues.push(`unknown env ${env}`);
  if (!unique(input.envs)) issues.push('envs must be unique');

  if (input.workspaces.length === 0) issues.push('workspaces must not be empty');
  if (!unique(input.workspaces)) issues.push('workspaces must be unique');
  if (input.workspaces.includes(WILDCARD) && input.workspaces.length > 1) issues.push('"*" must be the only workspace');
  if (role === 'PLATFORM_OPS' && !(input.workspaces.length === 1 && input.workspaces[0] === WILDCARD)) {
    issues.push('PLATFORM_OPS is platform-wide: workspaces must be ["*"]');
  }

  if (dimension === 'groups') {
    if (input.groups.length === 0) issues.push(`${role} requires at least one group`);
    if (input.groups.includes(WILDCARD) && input.groups.length > 1) issues.push('"*" must be the only group');
  } else if (input.groups.length > 0) {
    issues.push(`${role} does not take groups`);
  }
  if (!unique(input.groups)) issues.push('groups must be unique');

  if (dimension === 'scopes') {
    if (input.scopes.length === 0) issues.push(`${role} requires at least one scope`);
    for (const scope of input.scopes) {
      if (scope !== WILDCARD && !(SCOPES as readonly string[]).includes(scope)) issues.push(`unknown scope ${scope}`);
    }
    if (input.scopes.includes(WILDCARD) && input.scopes.length > 1) issues.push('"*" must be the only scope');
  } else if (input.scopes.length > 0) {
    issues.push(`${role} does not take scopes`);
  }
  if (!unique(input.scopes)) issues.push('scopes must be unique');
  if (input.dispatchOnly && !DISPATCH_ONLY_ROLES.includes(role)) issues.push(`${role} cannot be dispatch-only`);
  return issues;
}

/** A grant that can administer the platform in every environment. At least one must stay active. */
export function isFullPlatformOps(grant: Pick<Grant, 'role' | 'envs'>): boolean {
  return grant.role === 'PLATFORM_OPS' && ENVS.every((e) => grant.envs.includes(e));
}
