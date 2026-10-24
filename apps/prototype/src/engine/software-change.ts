// Vehicle software changes (整车软件版本变化). A physical vehicle's signed report, a vehicle
// resources confirmation or controller reports can change its whole-vehicle software. The team
// whose vehicle group it serves is told, and what the group published is checked on two levels:
// files (are their sources still provided; did a referenced file change in the new base) and the
// policies that depend on them. A branch follows the policy set, not the software version, so a
// change that keeps the base and breaks nothing needs only a confirmation.

import type { Draft } from 'immer';
import { authorize } from '../domain/authz.ts';
import { covered, policyCompatibility } from '../domain/compatibility.ts';
import { conflict, notFound, rule } from '../domain/errors.ts';
import { newId } from '../domain/ids.ts';
import type { Actor, Ctx } from './engine.ts';
import { recordSoftwareChange, softwareKey } from './fleet.ts';
import { releaseDiff } from './release.ts';
import { commitSnapshot, resolveFiles } from './snapshots.ts';
import type { Resource, SoftwareChange, State, VehicleGroup } from './types.ts';
import { baseTarget, vehicleBase } from './validation.ts';

/**
 * What a vehicle's own report says it runs (system context, after the report was accepted). A
 * version the platform knows changes the vehicle's record; an unknown one waits for vehicle
 * resources to record it, and the record stays as it was.
 */
export function noteReportedSoftware(ctx: Ctx, resourceId: string, reported: string | null): void {
  const r = ctx.s.resources[resourceId] as Draft<Resource> | undefined;
  if (!r || r.type !== 'PHYSICAL' || !reported || reported === r.integrationVersion) return;
  if (ctx.s.softwareVersions[softwareKey(r.vehicleModelId, reported)]) {
    recordSoftwareChange(ctx, r, reported, 'CLIENT_REPORT');
    r.integrationVersion = reported;
    r.integrationSource = 'DCL client report (signed)';
    r.softwareStatus = 'CONSISTENT';
    r.controllers = [];
    r.updatedAt = ctx.now;
    return;
  }
  if (Object.values(ctx.s.softwareChanges).some((c) => c.resourceId === r.id && c.status === 'UNRECORDED' && c.toVersion === reported)) return;
  const id = newId('sc');
  ctx.s.softwareChanges[id] = {
    id,
    seq: ctx.seq(),
    resourceId: r.id,
    fromVersion: r.integrationVersion,
    toVersion: reported,
    source: 'CLIENT_REPORT',
    status: 'UNRECORDED',
    at: ctx.now,
    acknowledgedBy: null,
    acknowledgedAt: null,
  };
}

export type ChangeOutcome = 'NONE' | 'FIX' | 'REPUBLISH' | 'NEW_FEATURE' | 'NO_BASE' | 'CANNOT_CHECK' | 'PRODUCTION' | 'NOT_PUBLISHED' | 'UNRECORDED';

export interface FileCheck {
  dataKey: string;
  name: string;
  owned: boolean;
  source: string;
  status: 'OK' | 'SOURCE_MISSING' | 'REFERENCE_CHANGED' | 'REFERENCE_REMOVED';
}

export interface PolicyCheck {
  policyId: string;
  name: string;
  status: 'OK' | 'MISSING' | 'UNKNOWN';
  missingSignals: string[];
  /** Names of captured files with a level-1 problem or a source the software lacks. */
  problemFiles: string[];
}

export interface SoftwareAssessment {
  change: SoftwareChange;
  outcome: ChangeOutcome;
  vehicleGroupId: string | null;
  featureId: string | null;
  commitId: string | null;
  /** The base of the configuration the vehicle runs (or would run on its old software). */
  runningBaseId: string | null;
  /** The base for the new software: the set in effect for it, or the group's explicit base. */
  newBaseId: string | null;
  baseChanged: boolean;
  baseProblem: string | null;
  /** The new base changed the Feature's own business group. */
  conflict: boolean;
  /** Codes of business groups that differ between the two bases. */
  changedGroups: string[];
  manifestKnown: boolean;
  files: FileCheck[];
  policies: PolicyCheck[];
  /** The Feature was already integrated: its content is part of a later set. */
  integrated: boolean;
}

export function getSoftwareChange(s: State, id: string): SoftwareChange {
  const c = s.softwareChanges[id];
  if (!c) throw notFound('software change', id);
  return c;
}

function groupOf(s: State, resourceId: string): VehicleGroup | undefined {
  const id = s.groupMembers[resourceId];
  return id ? s.vehicleGroups[id] : undefined;
}

/** The version of a data item the owning group has in a set, if the set has it. */
function versionInSet(s: State, releaseId: string | null, groupId: string, dataKey: string): string | null {
  const commitId = releaseId ? s.releases[releaseId]?.groups[groupId] : undefined;
  if (!commitId) return null;
  return s.manifestVersions[s.commits[commitId]!.manifestVersionId]!.entries.find((e) => e.dataKey === dataKey)?.fileSpecVersionId ?? null;
}

const empty = (change: SoftwareChange, outcome: ChangeOutcome): SoftwareAssessment => ({
  change,
  outcome,
  vehicleGroupId: null,
  featureId: null,
  commitId: null,
  runningBaseId: null,
  newBaseId: null,
  baseChanged: false,
  baseProblem: null,
  conflict: false,
  changedGroups: [],
  manifestKnown: false,
  files: [],
  policies: [],
  integrated: false,
});

/**
 * Checks what the vehicle's group published against the new software, recomputed from the
 * current state: the base, then files, then the policies that depend on them.
 */
export function assessSoftwareChange(s: State, changeId: string): SoftwareAssessment {
  const change = getSoftwareChange(s, changeId);
  if (change.status === 'UNRECORDED') return empty(change, 'UNRECORDED');
  const r = s.resources[change.resourceId]!;
  if (r.env === 'production') return empty(change, 'PRODUCTION');
  const g = groupOf(s, r.id);
  const p = g?.publication;
  const feature = p?.kind === 'FEATURE' ? s.features[p.featureId] : undefined;
  if (!g || p?.kind !== 'FEATURE' || !feature) return { ...empty(change, 'NOT_PUBLISHED'), vehicleGroupId: g?.id ?? null };

  const onNew: Resource = { ...r, integrationVersion: change.toVersion };
  const applied = r.appliedConfigId ? s.resolvedConfigs[r.appliedConfigId] : undefined;
  const runningBaseId = applied ? applied.baseReleaseId : (vehicleBase(s, g.baseReleaseId, { ...r, integrationVersion: change.fromVersion }).release?.id ?? null);
  const target = baseTarget(s, feature, g.baseReleaseId, onNew, p.disabledPolicies);
  const conflictBase = target.conflict ? (vehicleBase(s, g.baseReleaseId, onNew).release?.id ?? null) : null;
  const newBaseId = target.problem ? conflictBase : target.baseReleaseId;
  const baseProblem = target.problem && !target.conflict ? target.problem : null;
  const baseChanged = !baseProblem && newBaseId !== runningBaseId;
  const changedGroups =
    baseChanged && newBaseId
      ? releaseDiff(s, runningBaseId, newBaseId)
          .groups.filter((x) => x.status !== 'SAME')
          .map((x) => s.groups[x.groupId]?.code ?? x.groupId)
      : [];

  const manifest = s.softwareVersions[softwareKey(r.vehicleModelId, change.toVersion)]?.manifest ?? null;
  const snapshot = commitSnapshot(s, p.commitId);
  const files = resolveFiles(s, snapshot);
  const fileChecks: FileCheck[] = Object.keys(files)
    .sort()
    .map((dataKey) => {
      const f = files[dataKey]!;
      const owned = dataKey in snapshot.files;
      let status: FileCheck['status'] = 'OK';
      if (manifest && !covered(manifest, f.source.unit, f.source.directory)) status = 'SOURCE_MISSING';
      else if (!owned && !baseProblem) {
        // A file another group owns may have changed between the base the car runs and the new one.
        const owner = s.dataItems[dataKey]?.ownerGroupId;
        const before = owner ? versionInSet(s, runningBaseId, owner, dataKey) : null;
        const after = owner ? versionInSet(s, newBaseId, owner, dataKey) : null;
        if (before && !after) status = 'REFERENCE_REMOVED';
        else if (before && after && before !== after) status = 'REFERENCE_CHANGED';
      }
      return { dataKey, name: f.name, owned, source: `${f.source.unit}:${f.source.directory}/${f.source.pattern}`, status };
    });
  const byKey = new Map(fileChecks.map((f) => [f.dataKey, f]));
  const policies: PolicyCheck[] = Object.keys(snapshot.policies)
    .sort()
    .map((policyId) => {
      const policy = snapshot.policies[policyId]!;
      const c = policyCompatibility(policyId, policy, files, manifest);
      const problemFiles = [...new Set([...c.missingSources, ...policy.captures.filter((k) => byKey.get(k)?.status !== 'OK')])].map((k) => byKey.get(k)?.name ?? k);
      const status: PolicyCheck['status'] = c.status === 'UNKNOWN' ? 'UNKNOWN' : c.missingSignals.length || problemFiles.length ? 'MISSING' : 'OK';
      return { policyId, name: policy.name, status, missingSignals: c.missingSignals, problemFiles };
    });
  const problems = fileChecks.some((f) => f.status !== 'OK') || policies.some((x) => x.status === 'MISSING');
  const outcome: ChangeOutcome = baseProblem
    ? 'NO_BASE'
    : target.conflict
      ? 'NEW_FEATURE'
      : !manifest
        ? 'CANNOT_CHECK'
        : problems
          ? 'FIX'
          : baseChanged
            ? 'REPUBLISH'
            : 'NONE';
  return {
    change,
    outcome,
    vehicleGroupId: g.id,
    featureId: feature.id,
    commitId: p.commitId,
    runningBaseId,
    newBaseId,
    baseChanged,
    baseProblem,
    conflict: target.conflict,
    changedGroups,
    manifestKnown: !!manifest,
    files: fileChecks,
    policies,
    integrated: feature.stage === 'INTEGRATED',
  };
}

/** Those who publish to the vehicle's group are the ones told about its software. */
export function softwareChangeTarget(s: State, change: SoftwareChange) {
  const r = s.resources[change.resourceId]!;
  const g = groupOf(s, r.id);
  const group = g?.groupId ? s.groups[g.groupId] : undefined;
  if (!g || !group || r.env === 'production') return null;
  return { type: 'softwareChange', id: change.id, workspaceId: g.workspaceId, groupId: group.id, scope: group.domain, env: r.env };
}

/** The vehicle's team has seen the change and its check (确认); recorded once. */
export function acknowledgeSoftwareChange(ctx: Ctx, changeId: string): void {
  const change = getSoftwareChange(ctx.s, changeId) as Draft<SoftwareChange>;
  const target = softwareChangeTarget(ctx.s, change);
  if (change.status !== 'APPLIED' || !target) throw rule('NOT_A_TEAM_CHANGE', 'this change has no vehicle group team to confirm it');
  ctx.allow('feature.dispatch', target);
  if (change.acknowledgedBy) throw conflict('ALREADY_ACKNOWLEDGED', `already confirmed by ${change.acknowledgedBy}`);
  change.acknowledgedBy = ctx.user().username;
  change.acknowledgedAt = ctx.now;
}

/** Unconfirmed changes of vehicles in groups the actor publishes to, in a workspace (newest first). */
export function softwareChangesFor(s: State, actor: Actor, workspaceId: string): SoftwareChange[] {
  return Object.values(s.softwareChanges)
    .filter((c) => {
      if (c.status !== 'APPLIED' || c.acknowledgedBy) return false;
      const t = softwareChangeTarget(s, c);
      return !!t && t.workspaceId === workspaceId && authorize(actor.grants, 'feature.dispatch', t).ok;
    })
    .sort((a, b) => b.seq - a.seq);
}

/** The latest unconfirmed change of one vehicle, for its row in the group card. */
export function openChangeOf(s: State, resourceId: string): SoftwareChange | undefined {
  return Object.values(s.softwareChanges)
    .filter((c) => c.resourceId === resourceId && c.status === 'APPLIED' && !c.acknowledgedBy)
    .sort((a, b) => b.seq - a.seq)[0];
}

/** Vehicles that reported a software version the platform has not recorded yet. */
export function unrecordedReports(s: State, actor: Actor): SoftwareChange[] {
  return Object.values(s.softwareChanges)
    .filter((c) => {
      if (c.status !== 'UNRECORDED') return false;
      const r = s.resources[c.resourceId]!;
      return authorize(actor.grants, 'resource.manage', { scope: r.pool, env: r.env }).ok;
    })
    .sort((a, b) => b.seq - a.seq);
}
