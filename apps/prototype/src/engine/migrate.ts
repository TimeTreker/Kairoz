// Upgrades a saved platform to the current schema, one version at a time, so a new version of
// the prototype keeps what people built. A save older than the first migration is not upgraded.

import { STATE_SCHEMA } from './types.ts';
import type { State } from './types.ts';

type Saved = Record<string, unknown> & { schema?: unknown };
type Rows = Record<string, Record<string, unknown>>;

const OLDEST_MIGRATABLE = 6;

/** Schema 7: integration scope and subsystem releases; device keys and client reports. */
function to7(s: Saved): void {
  for (const plan of Object.values((s.mergePlans ?? {}) as Rows)) {
    plan.scope ??= 'Vehicle';
    plan.subsystems ??= [];
    for (const c of (plan.conflicts ?? []) as Record<string, unknown>[]) c.subsystemReleaseIds ??= [];
  }
  for (const c of Object.values((s.candidates ?? {}) as Rows)) {
    c.scope ??= 'Vehicle';
    c.subsystems ??= [];
  }
  for (const r of Object.values((s.resources ?? {}) as Rows)) r.deviceKey ??= null;
  s.subsystemReleases ??= {};
  s.clientReports ??= {};
  s.devices ??= {};
  s.schema = 7;
}

/**
 * Schema 8: policy sets apply to software versions by appended records; vehicle groups keep what
 * was published to them; accounts and team units can come from the company directory.
 */
function to8(s: Saved): void {
  const configs = (s.resolvedConfigs ?? {}) as Rows;
  const features = (s.features ?? {}) as Rows;
  for (const c of Object.values(configs)) c.disabledPolicies ??= [];
  for (const r of Object.values((s.releases ?? {}) as Rows)) r.emergency ??= null;
  for (const v of Object.values((s.softwareVersions ?? {}) as Rows)) v.manifest ??= null;
  for (const g of Object.values((s.vehicleGroups ?? {}) as Rows)) {
    if (!('publication' in g)) {
      const config = typeof g.targetConfigId === 'string' ? configs[g.targetConfigId] : undefined;
      const groups = (config?.groups ?? {}) as Record<string, string>;
      const feature = config?.kind === 'FEATURE' ? features[config.sourceId as string] : undefined;
      g.publication =
        !config ? null
        : config.kind === 'FEATURE' ? { kind: 'FEATURE', featureId: config.sourceId, commitId: groups[feature?.groupId as string] ?? null, disabledPolicies: [] }
        : config.kind === 'CANDIDATE' ? { kind: 'CANDIDATE', candidateId: config.sourceId, configId: config.id }
        : { kind: 'RELEASE', releaseId: config.sourceId, configId: config.id };
    }
    delete g.targetConfigId;
    g.baseReleaseId ??= null;
  }
  for (const r of Object.values((s.testRequests ?? {}) as Rows)) {
    r.disabledPolicies ??= [];
    if (!('deploymentIds' in r)) r.deploymentIds = typeof r.deploymentId === 'string' ? [r.deploymentId] : [];
    delete r.deploymentId;
  }
  for (const a of Object.values((s.accounts ?? {}) as Rows)) {
    a.orgUnitId ??= null;
    a.employeeId ??= null;
    a.grantReview ??= null;
  }
  for (const u of Object.values((s.orgUnits ?? {}) as Rows)) {
    u.source ??= 'PLATFORM';
    u.externalId ??= null;
  }
  s.applicability ??= [];
  s.applicabilityChecks ??= {};
  s.emergencyStops ??= {};
  s.grantRules ??= {};
  s.directory ??= null;
  s.directorySync ??= { revision: 0, syncedAt: null, log: [] };
  s.schema = 8;
}

/** Schema 9: personal simulation instances, their draft configurations, trial captures and self-tests. */
function to9(s: Saved): void {
  for (const r of Object.values((s.resources ?? {}) as Rows)) r.personal ??= null;
  for (const c of Object.values((s.resolvedConfigs ?? {}) as Rows)) c.draft ??= null;
  s.personalCaptures ??= {};
  s.personalTests ??= {};
  s.schema = 9;
}

/** Schema 10: simulation images change by builds, deployments and rollbacks; tests pin the image. */
function to10(s: Saved): void {
  const resources = (s.resources ?? {}) as Rows;
  for (const i of Object.values((s.images ?? {}) as Rows)) i.derived ??= null;
  // No image ever changed before, so each result ran on the vehicle's current image.
  for (const t of (s.testRuns ?? []) as Record<string, unknown>[]) if (!('imageId' in t)) t.imageId = resources[t.resourceId as string]?.imageId ?? null;
  s.softwareBuilds ??= {};
  s.imageChanges ??= {};
  s.schema = 10;
}

/** Schema 11: physical vehicles' software changes, with what each simulated device really runs. */
function to11(s: Saved): void {
  for (const d of Object.values((s.devices ?? {}) as Rows)) d.software ??= null;
  s.softwareChanges ??= {};
  s.schema = 11;
}

/** Schema 12: what each account marked read in its notification center, per workspace. */
function to12(s: Saved): void {
  s.notificationReads ??= {};
  s.schema = 12;
}

/**
 * Schema 13: a dispatch and its push are separate states (a finished target counts as pushed);
 * vehicles following their group, software update requests, loans and simulated time.
 */
function to13(s: Saved): void {
  for (const d of Object.values((s.deployments ?? {}) as Rows)) {
    d.trigger ??= 'DISPATCH';
    for (const t of (d.targets ?? []) as Record<string, unknown>[]) t.pushedAt ??= t.status === 'APPLIED' || t.status === 'FAILED' ? t.updatedAt : null;
  }
  for (const c of Object.values((s.softwareChanges ?? {}) as Rows)) c.requestId ??= null;
  s.groupFollows ??= {};
  s.vehicleSoftwareRequests ??= {};
  s.loans ??= {};
  s.clockOffsetMs ??= 0;
  s.schema = 13;
}

/** Schema 14: vehicle environment moves and the archive / restore history of org objects. */
function to14(s: Saved): void {
  s.environmentChanges ??= [];
  s.lifecycleEvents ??= [];
  s.schema = 14;
}

const STEPS: Record<number, (s: Saved) => void> = { 6: to7, 7: to8, 8: to9, 9: to10, 10: to11, 11: to12, 12: to13, 13: to14 };

/** The state at the current schema, or null when it cannot be read or is too old. Mutates `raw`. */
export function migrate(raw: unknown): State | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Saved;
  if (typeof s.schema !== 'number' || s.schema < OLDEST_MIGRATABLE || s.schema > STATE_SCHEMA) return null;
  while (s.schema < STATE_SCHEMA) STEPS[s.schema as number]!(s);
  return s as unknown as State;
}
