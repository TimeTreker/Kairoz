// Closed vocabularies shared by the domain. Labels are the Chinese product terms.

export const ENVS = ['development', 'testing', 'production'] as const;
export type Env = (typeof ENVS)[number];

export const DOMAINS = ['Common', 'Chassis', 'Battery', 'Powertrain', 'HMI', 'ADC', 'CDC', 'Other'] as const;
export type Domain = (typeof DOMAINS)[number];

/** `Vehicle` is the whole-vehicle scope; it is a scope of its own, not a superset of domains. */
export const SCOPES = ['Vehicle', ...DOMAINS] as const;
export type Scope = (typeof SCOPES)[number];

/**
 * Which grant dimension narrows a role: `groups` (business groups), `scopes` (Vehicle / domain),
 * or `none` (workspace and environment only).
 */
export type RoleDimension = 'groups' | 'scopes' | 'none';

export const ROLE_INFO = {
  BUSINESS_DEV: { label: '业务研发', dimension: 'groups' },
  BUSINESS_TEST: { label: '业务测试', dimension: 'groups' },
  INTEGRATION_TEST: { label: '集成测试', dimension: 'scopes' },
  DCL_ENGINEER: { label: 'DCL 工程', dimension: 'groups' },
  CONFIG_INTEGRATOR: { label: '配置集成', dimension: 'scopes' },
  CONFIG_RELEASE: { label: '配置发布', dimension: 'scopes' },
  VEHICLE_RESOURCE: { label: '车辆资源', dimension: 'scopes' },
  WORKSPACE_ADMIN: { label: '工作区管理员', dimension: 'none' },
  PLATFORM_OPS: { label: '平台运维', dimension: 'none' },
} as const satisfies Record<string, { label: string; dimension: RoleDimension }>;

export type Role = keyof typeof ROLE_INFO;
export const ROLES = Object.keys(ROLE_INFO) as Role[];

export const WORKSPACE_KINDS = ['TEAM', 'PROJECT', 'INTEGRATION'] as const;
export type WorkspaceKind = (typeof WORKSPACE_KINDS)[number];

export const GROUP_PURPOSES = ['DEV', 'TEST'] as const;
export type GroupPurpose = (typeof GROUP_PURPOSES)[number];

export const WILDCARD = '*';
