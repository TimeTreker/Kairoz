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

/** Schema 15: vehicles play a lasting fault instead of failing the next apply; devices keep unsent receipts. */
function to15(s: Saved): void {
  for (const r of Object.values((s.resources ?? {}) as Rows)) {
    const agent = r.agent as Record<string, unknown> | undefined;
    if (!agent) continue;
    agent.fault ??= agent.failNext ? 'APPLY_INTERRUPTED' : 'NONE';
    delete agent.failNext;
  }
  for (const d of Object.values((s.devices ?? {}) as Rows)) {
    d.config ??= null;
    d.unsent ??= [];
  }
  s.schema = 15;
}

/** Schema 16: same-software configuration patches; everything saved so far is on the mainline. */
function to16(s: Saved): void {
  for (const r of Object.values((s.releases ?? {}) as Rows)) r.patchOf ??= null;
  for (const p of Object.values((s.mergePlans ?? {}) as Rows)) p.patch ??= null;
  for (const c of Object.values((s.candidates ?? {}) as Rows)) c.patch ??= null;
  s.schema = 16;
}

/**
 * Schema 17: collection budgets and pauses. Earlier events keep no cost (they count for nothing
 * in a budget window), were stored and uploaded when they fired, and take their policy's priority.
 */
function to17(s: Saved): void {
  s.collectionBudgets ??= { models: {}, vehicles: {} };
  s.collectionHolds ??= {};
  const versions = (s.policyVersions ?? {}) as Rows;
  for (const e of Object.values((s.events ?? {}) as Rows)) {
    const policy = versions[e.policyVersionId as string]?.content as Record<string, unknown> | undefined;
    e.priority ??= policy?.priority ?? 'NORMAL';
    e.cost ??= null;
    e.writtenAt ??= e.occurredAt ?? null;
    e.uploadAt ??= e.occurredAt ?? null;
    e.budgetNote ??= null;
  }
  s.schema = 17;
}

/** Schema 18: simulation run quotas per workspace; none set means no limit, as before. */
function to18(s: Saved): void {
  s.simulationQuotas ??= {};
  s.schema = 18;
}

/** Schema 19: capture sources and after-sales requests; every earlier capture came from a trigger. */
function to19(s: Saved): void {
  s.captureRequests ??= {};
  for (const e of Object.values((s.events ?? {}) as Rows)) {
    e.source ??= 'TRIGGER';
    e.requestId ??= null;
  }
  s.schema = 19;
}

/** Schema 20: after-sales requests keep their policy's group and who (or why) cancelled them. */
function to20(s: Saved): void {
  const owners = (s.policyOwners ?? {}) as Record<string, string>;
  for (const q of Object.values((s.captureRequests ?? {}) as Rows)) {
    q.groupId ??= owners[q.policyId as string] ?? '';
    q.cancelledBy ??= null;
    q.note ??= null;
  }
  s.schema = 20;
}

/**
 * Schema 21: integration calls, planned software versions, and OTA rollouts that keep a log of
 * their steps and each vehicle's software when it was sent. Every earlier version was recorded
 * from outside; earlier merges and candidates belong to no call; earlier rollouts get what their
 * records still show: the start and how they ended.
 */
function to21(s: Saved): void {
  s.integrationCalls ??= {};
  for (const v of Object.values((s.softwareVersions ?? {}) as Rows)) {
    v.status ??= 'RECORDED';
    v.callId ??= null;
    v.dclModule ??= null;
  }
  for (const p of Object.values((s.mergePlans ?? {}) as Rows)) p.callId ??= null;
  for (const c of Object.values((s.candidates ?? {}) as Rows)) c.callId ??= null;
  const resources = (s.resources ?? {}) as Rows;
  const changes = Object.values((s.softwareChanges ?? {}) as Rows)
    .filter((c) => c.status === 'APPLIED')
    .sort((a, b) => String(a.at).localeCompare(String(b.at)));
  // The software a vehicle ran at a moment, from its recorded changes; its current one when none tells.
  const softwareAt = (rid: string, at: string): unknown => {
    const own = changes.filter((c) => c.resourceId === rid);
    const before = own.filter((c) => String(c.at) <= at).at(-1);
    if (before) return before.toVersion;
    const after = own.find((c) => String(c.at) > at);
    return after ? after.fromVersion : (resources[rid]?.integrationVersion ?? null);
  };
  for (const d of Object.values((s.deployments ?? {}) as Rows)) {
    if (d.kind !== 'OTA') continue;
    const targets = (d.targets ?? []) as Record<string, unknown>[];
    for (const t of targets) t.software ??= softwareAt(t.resourceId as string, String(t.updatedAt ?? d.createdAt));
    if (d.log) continue;
    const log: Record<string, unknown>[] = [{ kind: 'STARTED', by: d.dispatchedBy, at: d.createdAt, reason: null, resourceIds: targets.filter((t) => t.status !== 'QUEUED').map((t) => t.resourceId) }];
    const end = { by: null, at: d.updatedAt, resourceIds: [] };
    if (d.status === 'COMPLETED') log.push({ kind: 'COMPLETED', reason: null, ...end });
    if (d.status === 'CANCELLED') log.push({ kind: 'CANCELLED', reason: targets.find((t) => t.status === 'CANCELLED')?.error ?? null, ...end });
    if (d.status === 'ROLLED_BACK') log.push({ kind: 'ROLLED_BACK', reason: d.pauseReason ?? null, ...end });
    if (d.status === 'PAUSED') log.push({ kind: d.pauseReason ? 'PAUSED' : 'AUTO_PAUSED', reason: d.pauseReason ?? null, ...end });
    d.log = log;
  }
  s.schema = 21;
}

/**
 * Schema 22: a software version keeps every module exported for it and when it was planned. Earlier
 * saves only kept the last module, and a released call's version only its release time.
 */
function to22(s: Saved): void {
  for (const v of Object.values((s.softwareVersions ?? {}) as Rows)) {
    v.moduleLog ??= v.dclModule ? [{ ...(v.dclModule as Record<string, unknown>) }] : [];
    const planned = v.status === 'PLANNED';
    v.plannedBy ??= planned ? v.recordedBy : null;
    v.plannedAt ??= planned ? v.createdAt : null;
  }
  s.schema = 22;
}

/**
 * Schema 23: whole-vehicle versions come from PLM and cars from TSP. Every version an earlier save
 * recorded is taken as published by PLM (the simulated PLM gets the same list, so nothing is synced
 * again); a planned one is a working name not linked yet. Every physical car is taken as known to
 * TSP, which expects the version the platform recorded; its simulated device runs that version (it
 * used to echo the platform's record). Applicability records and checks may now be the platform's own.
 */
function to23(s: Saved): void {
  const cars: Record<string, unknown>[] = [];
  for (const r of Object.values((s.resources ?? {}) as Rows)) {
    if (r.type !== 'PHYSICAL' || typeof r.vin !== 'string') {
      r.tsp ??= null;
      continue;
    }
    const vin = r.vin;
    r.uvid ??= `UV-${vin.slice(-10)}`;
    const car = { vin, uvid: r.uvid, tboxId: `TBOX-${vin.slice(-10)}`, vehicleModelId: r.vehicleModelId, licensePlate: r.licensePlate ?? null, hardware: [], expectedVersion: r.integrationVersion ?? null };
    cars.push(car);
    r.tsp ??= { tboxId: car.tboxId, hardware: [], expectedVersion: car.expectedVersion, syncedAt: r.updatedAt ?? null };
  }
  for (const [id, d] of Object.entries((s.devices ?? {}) as Rows)) {
    const r = ((s.resources ?? {}) as Rows)[id];
    if (r?.type === 'PHYSICAL' && d.software == null) d.software = r.integrationVersion ?? null;
    // A car a partial update left inconsistent keeps reporting its controllers that way.
    d.controllers ??= r?.type === 'PHYSICAL' && r.softwareStatus === 'PARTIAL_FAILURE' ? JSON.parse(JSON.stringify(r.controllers ?? [])) : [];
  }
  const tspRevision = cars.length ? 1 : 0;
  s.tsp ??= { revision: tspRevision, vehicles: cars };
  s.tspSync ??= { revision: tspRevision, syncedAt: null };
  const versions: Record<string, unknown>[] = [];
  const releases = (s.releases ?? {}) as Rows;
  for (const v of Object.values((s.softwareVersions ?? {}) as Rows)) {
    // A module exported for a recorded version was in its OTA package: it is the version's DCL part
    // (the DCL client those saves simulated was 2.3.0).
    const m = v.status === 'RECORDED' ? (v.dclModule as Record<string, unknown> | null) : null;
    const part = m ? { clientVersion: '2.3.0', setVersion: String(releases[m.releaseId as string]?.dclVersion ?? ''), digest: m.digest } : null;
    v.dclPart ??= part ? { ...part, deliveredBy: m!.exportedBy ?? null, deliveredAt: m!.exportedAt ?? null } : null;
    v.workingName ??= v.status === 'RECORDED' && v.callId ? v.version : null;
    v.linkedTo ??= null;
    if (v.status === 'RECORDED') versions.push({ vehicleModelId: v.vehicleModelId, version: v.version, modules: [], dclPart: part, publishedAt: v.createdAt });
  }
  const revision = versions.length ? 1 : 0;
  s.plm ??= { revision, versions };
  s.plmSync ??= { revision, syncedAt: null, conflicts: [] };
  s.schema = 23;
}

const STEPS: Record<number, (s: Saved) => void> = { 6: to7, 7: to8, 8: to9, 9: to10, 10: to11, 11: to12, 12: to13, 13: to14, 14: to15, 15: to16, 16: to17, 17: to18, 18: to19, 19: to20, 20: to21, 21: to22, 22: to23 };

/** Why `migrate` cannot read a save: not a platform state, older than the oldest readable schema, or from a newer version. */
export function unreadableReason(raw: unknown): 'NOT_STATE' | 'TOO_OLD' | 'NEWER' | null {
  const schema = raw && typeof raw === 'object' ? (raw as Saved).schema : undefined;
  if (typeof schema !== 'number') return 'NOT_STATE';
  if (schema < OLDEST_MIGRATABLE) return 'TOO_OLD';
  if (schema > STATE_SCHEMA) return 'NEWER';
  return null;
}

/** The state at the current schema, or null when it cannot be read or is too old. Mutates `raw`. */
export function migrate(raw: unknown): State | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Saved;
  if (typeof s.schema !== 'number' || s.schema < OLDEST_MIGRATABLE || s.schema > STATE_SCHEMA) return null;
  while (s.schema < STATE_SCHEMA) STEPS[s.schema as number]!(s);
  return s as unknown as State;
}
