// Release history (发布历史): the read-only story of each whole-vehicle software version and each
// DCL policy set of a vehicle model, assembled from the records the platform already keeps
// (integration calls and their rounds, publications, applicability records and checks, emergency
// stops, OTA rollout logs, vehicle software changes). Software versions belong to one vehicle
// model: X90 1.0 is not X89 1.0.

import { softwareKey } from './fleet.ts';
import { compareVersions, releasesOf } from './release.ts';
import type { Release, Resource, RolloutEvent, SoftwareVersion, State } from './types.ts';

export type HistoryKind =
  | 'CALL_OPENED'
  | 'SOFTWARE_PLANNED'
  | 'MODULE_SUBMITTED'
  | 'MODULE_NO_CHANGE'
  | 'MODULE_RETURNED'
  | 'MODULE_EXCLUDED'
  | 'ROUND_FROZEN'
  | 'ROUND_PASSED'
  | 'ROUND_CANCELLED'
  | 'CALL_CANCELLED'
  | 'CALL_NO_CHANGE'
  | 'SOFTWARE_RECORDED'
  | 'MODULE_EXPORTED'
  | 'PUBLISHED'
  | 'PATCHED'
  | 'CHECK_OPENED'
  | 'CHECK_VERIFIED'
  | 'CHECK_CONFIRMED'
  | 'CHECK_CANCELLED'
  | 'CHECK_SUPERSEDED'
  | 'APPLICABILITY_ADDED'
  | 'APPLICABILITY_WITHDRAWN'
  | 'IN_EFFECT'
  | 'SUPERSEDED'
  | 'EMERGENCY_REQUESTED'
  | 'EMERGENCY_APPROVED'
  | 'EMERGENCY_REJECTED'
  | `OTA_${RolloutEvent['kind']}`
  | 'VEHICLE_ARRIVED'
  | 'VEHICLE_LEFT';

export interface HistoryEntry {
  key: string;
  at: string;
  kind: HistoryKind;
  /** null: the platform itself or a vehicle. */
  by: string | null;
  /** The policy set the entry is about (for SUPERSEDED: the set that took over, or null). */
  releaseId: string | null;
  version: string | null;
  deploymentId: string | null;
  checkId: string | null;
  /** The integration call, its module (group id or domain:…) and round candidate, when the entry is about one. */
  callId: string | null;
  module: string | null;
  candidateId: string | null;
  /** What a module submitted. */
  featureId: string | null;
  subsystemReleaseId: string | null;
  resourceIds: string[];
  reason: string | null;
  /** Version history only: the set in effect for the version after this entry. */
  inEffect?: string | null;
  /** Version history only: whether this entry changed the set in effect. */
  changed?: boolean;
}

// Same-moment entries read in cause-and-effect order: a set is published before records about it,
// a check is confirmed before the applicability record it writes, rollouts come last.
const RANK: Record<string, number> = {
  CALL_OPENED: -1,
  SOFTWARE_PLANNED: 0,
  SOFTWARE_RECORDED: 0,
  MODULE_SUBMITTED: 1,
  MODULE_NO_CHANGE: 1,
  MODULE_RETURNED: 1,
  MODULE_EXCLUDED: 1,
  ROUND_FROZEN: 3,
  ROUND_PASSED: 4,
  ROUND_CANCELLED: 9,
  CALL_CANCELLED: 9,
  CALL_NO_CHANGE: 9,
  VEHICLE_ARRIVED: 1,
  VEHICLE_LEFT: 1,
  CHECK_OPENED: 2,
  CHECK_VERIFIED: 3,
  EMERGENCY_REQUESTED: 4,
  PUBLISHED: 5,
  PATCHED: 5,
  EMERGENCY_APPROVED: 6,
  MODULE_EXPORTED: 7,
  EMERGENCY_REJECTED: 6,
  CHECK_CONFIRMED: 7,
  APPLICABILITY_ADDED: 8,
  APPLICABILITY_WITHDRAWN: 8,
  CHECK_CANCELLED: 9,
  CHECK_SUPERSEDED: 9,
  IN_EFFECT: 10,
  SUPERSEDED: 10,
};

type Optional = 'releaseId' | 'version' | 'deploymentId' | 'checkId' | 'callId' | 'module' | 'candidateId' | 'featureId' | 'subsystemReleaseId' | 'resourceIds' | 'reason' | 'by';
type Draft = Omit<HistoryEntry, 'key' | Optional> & Partial<Pick<HistoryEntry, Optional>> & { order: number };

function finish(drafts: Draft[]): HistoryEntry[] {
  return drafts
    .filter((d) => d.at)
    .sort((a, b) => a.at.localeCompare(b.at) || (RANK[a.kind] ?? 11) - (RANK[b.kind] ?? 11) || a.order - b.order)
    .map(({ order, ...d }, i) => ({ key: `${i}-${d.kind}`, by: null, releaseId: null, version: null, deploymentId: null, checkId: null, callId: null, module: null, candidateId: null, featureId: null, subsystemReleaseId: null, resourceIds: [], reason: null, ...d }));
}

/** Every software version a set was ever listed for or added to. */
function versionsEverOf(s: State, release: Release): string[] {
  const versions = new Set(release.vehicleIntegrationVersions);
  for (const a of s.applicability) if (a.releaseId === release.id && a.action === 'ADD') versions.add(a.version);
  return [...versions].sort(compareVersions);
}

function checkDrafts(s: State, keep: (c: State['applicabilityChecks'][string]) => boolean): Draft[] {
  const out: Draft[] = [];
  for (const c of Object.values(s.applicabilityChecks).filter(keep)) {
    const base = { releaseId: c.releaseId, version: c.version, checkId: c.id, order: 0 };
    out.push({ ...base, at: c.openedAt, kind: 'CHECK_OPENED', by: c.auto ? null : c.openedBy });
    if (c.verifiedAt) out.push({ ...base, at: c.verifiedAt, kind: 'CHECK_VERIFIED', by: c.verifiedBy });
    const closed = { CONFIRMED: 'CHECK_CONFIRMED', CANCELLED: 'CHECK_CANCELLED', SUPERSEDED: 'CHECK_SUPERSEDED' } as const;
    if (c.decidedAt && c.status in closed) out.push({ ...base, at: c.decidedAt, kind: closed[c.status as keyof typeof closed], by: c.decidedBy, reason: c.note });
  }
  return out;
}

function stopDrafts(s: State, releaseIds: Set<string>): Draft[] {
  const out: Draft[] = [];
  for (const e of Object.values(s.emergencyStops).filter((x) => releaseIds.has(x.releaseId))) {
    out.push({ at: e.requestedAt, kind: 'EMERGENCY_REQUESTED', by: e.requestedBy, releaseId: e.releaseId, reason: `${e.policyId}: ${e.reason}`, order: 0 });
    if (e.decidedAt && e.status !== 'REQUESTED') {
      out.push({ at: e.decidedAt, kind: e.status === 'APPROVED' ? 'EMERGENCY_APPROVED' : 'EMERGENCY_REJECTED', by: e.decidedBy, releaseId: e.newReleaseId ?? e.releaseId, reason: e.decisionNote, order: 0 });
    }
  }
  return out;
}

/** OTA rollout steps. `only` narrows each step's vehicles (steps left with none are dropped, except the start and the end). */
function rolloutDrafts(s: State, keep: (releaseId: string) => boolean, only?: (rid: string, software: string | null | undefined) => boolean): Draft[] {
  const out: Draft[] = [];
  for (const d of Object.values(s.deployments)) {
    if (d.kind !== 'OTA' || !keep(d.subjectId)) continue;
    const softwareOf = new Map(d.targets.map((t) => [t.resourceId, t.software ?? s.resources[t.resourceId]?.integrationVersion ?? null]));
    if (only && !d.targets.some((t) => only(t.resourceId, softwareOf.get(t.resourceId)))) continue;
    (d.log ?? []).forEach((e, i) => {
      const ids = only ? e.resourceIds.filter((rid) => only(rid, softwareOf.get(rid))) : e.resourceIds;
      if (only && ids.length === 0 && (e.kind === 'EXPANDED' || e.kind === 'RESUMED')) return;
      out.push({ at: e.at, kind: `OTA_${e.kind}`, by: e.by, releaseId: d.subjectId, deploymentId: d.id, resourceIds: ids, reason: e.reason, order: 20 + i });
    });
  }
  return out;
}

/** A whole-vehicle call's story: opened, what each module submitted or was sent back for, each round, how it closed. */
function callDrafts(s: State, vehicleModelId: string, version: string): Draft[] {
  const out: Draft[] = [];
  const MODULE_KIND = { SUBMITTED: 'MODULE_SUBMITTED', NO_CHANGE: 'MODULE_NO_CHANGE', RETURNED: 'MODULE_RETURNED', EXCLUDED: 'MODULE_EXCLUDED' } as const;
  for (const call of Object.values(s.integrationCalls)) {
    if (call.vehicleModelId !== vehicleModelId || call.scope !== 'Vehicle' || call.targetVersion !== version) continue;
    const base = { callId: call.id, version };
    out.push({ ...base, at: call.createdAt, kind: 'CALL_OPENED', by: call.createdBy, reason: call.title, order: 0 });
    for (const m of call.modules) {
      m.history.forEach((e, i) => {
        if (e.kind === 'REMINDED') return;
        out.push({ ...base, at: e.at, kind: MODULE_KIND[e.kind], by: e.by, module: m.key, featureId: e.featureId, subsystemReleaseId: e.subsystemReleaseId, reason: e.note, order: i });
      });
    }
    call.rounds.forEach((r, i) => {
      const c = r.candidateId ? s.candidates[r.candidateId] : undefined;
      if (!c) return;
      out.push({ ...base, at: c.createdAt, kind: 'ROUND_FROZEN', by: c.createdBy, candidateId: c.id, reason: c.label, order: i });
      if (c.verifiedAt) out.push({ ...base, at: c.verifiedAt, kind: 'ROUND_PASSED', by: c.verifiedBy, candidateId: c.id, reason: c.label, order: i });
      if (r.outcome === 'CANCELLED' && r.closedAt) out.push({ ...base, at: r.closedAt, kind: 'ROUND_CANCELLED', by: r.closedBy, candidateId: c.id, reason: r.reason, order: i });
    });
    if (call.closedAt && (call.status === 'CANCELLED' || call.status === 'NO_CHANGE')) {
      out.push({ ...base, at: call.closedAt, kind: call.status === 'CANCELLED' ? 'CALL_CANCELLED' : 'CALL_NO_CHANGE', by: call.closedBy, reason: call.note, order: 99 });
    }
  }
  return out;
}

/**
 * The history of one software version of a model, oldest first: its integration calls, when it
 * was planned or recorded, every set
 * published for it or added to or withdrawn from it, applicability checks, emergency stops of
 * those sets, OTA rollouts that reached vehicles running it, and vehicles moving onto or off it.
 * Each entry carries the set in effect for the version after it.
 */
export function versionHistory(s: State, vehicleModelId: string, version: string): HistoryEntry[] {
  const drafts: Draft[] = [];
  const sv = s.softwareVersions[softwareKey(vehicleModelId, version)];
  if (sv?.plannedAt) drafts.push({ at: sv.plannedAt, kind: 'SOFTWARE_PLANNED', by: sv.plannedBy, version, callId: sv.callId, reason: null, order: 0 });
  if (sv?.status === 'RECORDED') drafts.push({ at: sv.createdAt, kind: 'SOFTWARE_RECORDED', by: sv.recordedBy, version, callId: sv.callId, reason: sv.source || null, order: 0 });
  drafts.push(...callDrafts(s, vehicleModelId, version));
  for (const m of sv?.moduleLog ?? []) drafts.push({ at: m.exportedAt, kind: 'MODULE_EXPORTED', by: m.exportedBy, version, releaseId: m.releaseId, order: 0 });
  const releases = releasesOf(s, vehicleModelId);
  for (const r of releases) {
    if (r.vehicleIntegrationVersions.includes(version)) drafts.push({ at: r.publishedAt, kind: 'PUBLISHED', by: r.publishedBy, releaseId: r.id, version, reason: r.notes || null, order: r.sequence });
  }
  drafts.push(...checkDrafts(s, (c) => c.vehicleModelId === vehicleModelId && c.version === version));
  for (const a of s.applicability) {
    if (a.vehicleModelId !== vehicleModelId || a.version !== version) continue;
    drafts.push({ at: a.at, kind: a.action === 'ADD' ? 'APPLICABILITY_ADDED' : 'APPLICABILITY_WITHDRAWN', by: a.by, releaseId: a.releaseId, version, checkId: a.checkId, reason: a.reason, order: a.seq });
  }
  const touched = new Set(releases.filter((r) => versionsEverOf(s, r).includes(version)).map((r) => r.id));
  drafts.push(...stopDrafts(s, touched));
  drafts.push(...rolloutDrafts(s, (id) => s.releases[id]?.vehicleModelId === vehicleModelId, (_rid, software) => software === version));
  for (const c of Object.values(s.softwareChanges)) {
    if (c.status === 'UNRECORDED' || s.resources[c.resourceId]?.vehicleModelId !== vehicleModelId) continue;
    // A vehicle flashed with a bundled DCL module started on its set with the software.
    const bundled = c.configId ? s.resolvedConfigs[c.configId] : undefined;
    const releaseId = bundled?.kind === 'RELEASE' ? bundled.sourceId : null;
    const by = c.by ?? null;
    if (c.toVersion === version) drafts.push({ at: c.at, kind: 'VEHICLE_ARRIVED', by, resourceIds: [c.resourceId], version, releaseId, reason: c.fromVersion, order: c.seq });
    else if (c.fromVersion === version) drafts.push({ at: c.at, kind: 'VEHICLE_LEFT', by, resourceIds: [c.resourceId], version, reason: c.toVersion, order: c.seq });
  }

  // Replay applicability: the set in effect is the newest one that applies (as `setInEffect`).
  const applies = new Map<string, boolean>();
  const sequence = (id: string) => s.releases[id]?.sequence ?? -1;
  let current: string | null = null;
  return finish(drafts).map((e) => {
    if (e.releaseId && (e.kind === 'PUBLISHED' || e.kind === 'APPLICABILITY_ADDED')) applies.set(e.releaseId, true);
    if (e.releaseId && e.kind === 'APPLICABILITY_WITHDRAWN') applies.set(e.releaseId, false);
    const next = [...applies].filter(([, on]) => on).map(([id]) => id).sort((a, b) => sequence(b) - sequence(a))[0] ?? null;
    const changed = next !== current;
    current = next;
    return { ...e, inEffect: next, changed };
  });
}

/** The sets that have been in effect for a version, in order (null: a stretch with none). */
export function setsOverTime(entries: HistoryEntry[]): (string | null)[] {
  const out: (string | null)[] = [];
  for (const e of entries) if (e.changed) out.push(e.inEffect ?? null);
  return out;
}

/**
 * The history of one policy set, oldest first: its publication, patches of it, applicability
 * checks and records, when it became or stopped being the set in effect for each software version,
 * emergency stops, and its OTA rollouts (rollbacks to it included).
 */
export function releaseHistory(s: State, releaseId: string): HistoryEntry[] {
  const r = s.releases[releaseId];
  if (!r) return [];
  const drafts: Draft[] = [{ at: r.publishedAt, kind: 'PUBLISHED', by: r.publishedBy, releaseId: r.id, reason: r.notes || null, order: r.sequence }];
  for (const p of Object.values(s.releases)) {
    if (p.patchOf === r.id) drafts.push({ at: p.publishedAt, kind: 'PATCHED', by: p.publishedBy, releaseId: p.id, reason: p.notes || null, order: p.sequence });
  }
  drafts.push(...checkDrafts(s, (c) => c.releaseId === r.id));
  for (const a of s.applicability) {
    if (a.releaseId !== r.id) continue;
    drafts.push({ at: a.at, kind: a.action === 'ADD' ? 'APPLICABILITY_ADDED' : 'APPLICABILITY_WITHDRAWN', by: a.by, releaseId: r.id, version: a.version, checkId: a.checkId, reason: a.reason, order: a.seq });
  }
  for (const version of versionsEverOf(s, r)) {
    let previous: string | null = null;
    for (const e of versionHistory(s, r.vehicleModelId, version)) {
      if (!e.changed) continue;
      if (e.inEffect === r.id) drafts.push({ at: e.at, kind: 'IN_EFFECT', by: e.by, releaseId: r.id, version, order: 0 });
      else if (previous === r.id) drafts.push({ at: e.at, kind: 'SUPERSEDED', by: e.by, releaseId: e.inEffect ?? null, version, order: 0 });
      previous = e.inEffect ?? null;
    }
  }
  drafts.push(...stopDrafts(s, new Set([r.id])));
  drafts.push(...rolloutDrafts(s, (id) => id === r.id));
  return finish(drafts);
}

/** Vehicles whose actual software is the version, by environment. */
export function vehiclesOnVersion(s: State, vehicleModelId: string, version: string): Resource[] {
  return Object.values(s.resources).filter((x) => x.vehicleModelId === vehicleModelId && x.integrationVersion === version && x.status !== 'RETIRED');
}

/** Vehicles whose confirmed configuration is the set. */
export function vehiclesRunning(s: State, release: Release): Resource[] {
  return Object.values(s.resources).filter((x) => x.appliedConfigId === release.resolvedConfigId);
}

/** The model's recorded software versions, newest first. */
export function softwareVersionsOf(s: State, vehicleModelId: string): SoftwareVersion[] {
  return Object.values(s.softwareVersions)
    .filter((v) => v.vehicleModelId === vehicleModelId)
    .sort((a, b) => compareVersions(b.version, a.version));
}

export interface DistributionRow {
  /** null: the vehicle's software is unknown (or a partial update left it inconsistent). */
  version: string | null;
  vehicles: number;
  /** What the vehicles run: a policy set's version, or null for anything else (none, a test configuration). */
  sets: { dclVersion: string | null; vehicles: number }[];
}

/**
 * How a model's production vehicles are spread over software versions and the sets they run (量产版本
 * 分布): counts only, no VIN, plate or vehicle id; unknown software is a row of its own.
 */
export function productionDistribution(s: State, vehicleModelId: string): DistributionRow[] {
  const rows = new Map<string | null, Map<string | null, number>>();
  for (const r of Object.values(s.resources)) {
    if (r.vehicleModelId !== vehicleModelId || r.env !== 'production' || r.status === 'RETIRED') continue;
    const version = r.softwareStatus === 'CONSISTENT' ? r.integrationVersion : null;
    const config = r.appliedConfigId ? s.resolvedConfigs[r.appliedConfigId] : undefined;
    const set = config?.kind === 'RELEASE' ? (s.releases[config.sourceId]?.dclVersion ?? null) : null;
    const sets = rows.get(version) ?? new Map<string | null, number>();
    sets.set(set, (sets.get(set) ?? 0) + 1);
    rows.set(version, sets);
  }
  return [...rows.entries()]
    .map(([version, sets]) => ({
      version,
      vehicles: [...sets.values()].reduce((a, b) => a + b, 0),
      sets: [...sets.entries()].map(([dclVersion, vehicles]) => ({ dclVersion, vehicles })).sort((a, b) => b.vehicles - a.vehicles),
    }))
    .sort((a, b) => (a.version === null ? 1 : b.version === null ? -1 : compareVersions(a.version, b.version)));
}
