// Configuration OTA (配置 OTA): staged rollout of a formal release to production vehicle groups.
// Each vehicle is checked against the release (model, actual software, newest match); a failure
// pauses the rollout, a resume retries failed vehicles with a new attempt, and a rollback returns
// applied vehicles to their previous, still compatible formal configuration.

import type { Draft } from 'immer';
import { notFound, rule } from '../domain/errors.ts';
import { newId } from '../domain/ids.ts';
import type { Ctx } from './engine.ts';
import { membersOf, openOtaOf, pendingDeploymentOf, recordGroupBinding } from './fleet.ts';

export { openOtaOf };
import { getRelease, releaseFor } from './release.ts';
import type { Deployment, DeploymentTarget, Release, Resource, State } from './types.ts';

/** Why a vehicle cannot take a release now; empty when it can. */
export function otaProblems(s: State, r: Resource, release: Release, except?: string): string[] {
  const problems: string[] = [];
  if (r.env !== 'production') problems.push(`${r.id}: not a production vehicle`);
  if (r.status !== 'AVAILABLE') problems.push(`${r.id}: ${r.status.toLowerCase()}`);
  if (r.vehicleModelId !== release.vehicleModelId) problems.push(`${r.id}: another vehicle model`);
  const resolved = releaseFor(s, r);
  if (!resolved.release) problems.push(`${r.id}: ${resolved.problem}`);
  else if (!release.vehicleIntegrationVersions.includes(r.integrationVersion!)) problems.push(`${r.id}: DCL ${release.dclVersion} does not apply to software ${r.integrationVersion}`);
  else if (resolved.release.id !== release.id) problems.push(`${r.id}: resolves to the newer DCL ${resolved.release.dclVersion}`);
  const pending = pendingDeploymentOf(s, r.id);
  if (pending && pending !== except) problems.push(`${r.id}: waiting for deployment ${pending}`);
  const open = openOtaOf(s, r.id, except);
  if (open) problems.push(`${r.id}: part of unfinished rollout ${open}`);
  return problems;
}

function getOta(s: State, id: string): Deployment {
  const d = s.deployments[id];
  if (!d || d.kind !== 'OTA') throw notFound('OTA rollout', id);
  return d;
}

function allowOta(ctx: Ctx, d: Pick<Deployment, 'id' | 'workspaceId'>): void {
  ctx.allow('ota.manage', { type: 'deployment', id: d.id, workspaceId: d.workspaceId, scope: 'Vehicle' });
}

function target(ctx: Ctx, resourceId: string, vehicleGroupId: string, status: DeploymentTarget['status']): DeploymentTarget {
  return {
    resourceId,
    vehicleGroupId,
    attempt: 0,
    status,
    previousConfigId: ctx.s.resources[resourceId]!.appliedConfigId,
    error: null,
    updatedAt: ctx.now,
    history: [],
  };
}

/**
 * Starts a rollout of a release to production vehicle groups. `firstWave` lists the vehicles sent
 * at once (gray release); the others wait until the rollout is expanded.
 */
export function createOta(ctx: Ctx, input: { releaseId: string; vehicleGroupIds: string[]; firstWave: string[] | 'ALL' }): string {
  const release = getRelease(ctx.s, input.releaseId);
  if (input.vehicleGroupIds.length === 0) throw rule('NO_VEHICLE_GROUPS', 'choose at least one vehicle group');
  const groups = input.vehicleGroupIds.map((id) => {
    const g = ctx.s.vehicleGroups[id];
    if (!g) throw notFound('vehicle group', id);
    ctx.allow('ota.manage', { type: 'vehicleGroup', id: g.id, workspaceId: g.workspaceId, scope: 'Vehicle' });
    return g;
  });
  const workspaceId = groups[0]!.workspaceId;
  const problems: string[] = [];
  const members: { resourceId: string; vehicleGroupId: string }[] = [];
  for (const g of groups) {
    if (g.status !== 'ACTIVE') problems.push(`${g.name}: archived`);
    if (g.purpose !== 'PRODUCTION') problems.push(`${g.name}: formal releases roll out to production vehicle groups`);
    if (g.workspaceId !== workspaceId) problems.push(`${g.name}: in another workspace`);
    if (ctx.s.workspaces[g.workspaceId]?.vehicleModelId !== release.vehicleModelId) problems.push(`${g.name}: another vehicle model`);
    const list = membersOf(ctx.s, g.id);
    if (list.length === 0) problems.push(`${g.name}: no vehicles`);
    for (const rid of list) {
      const r = ctx.s.resources[rid]!;
      // Vehicles already running the release need nothing.
      if (r.appliedConfigId === release.resolvedConfigId) continue;
      problems.push(...otaProblems(ctx.s, r, release));
      members.push({ resourceId: rid, vehicleGroupId: g.id });
    }
  }
  if (!problems.length && members.length === 0) throw rule('NOTHING_TO_ROLL_OUT', `every vehicle already runs DCL ${release.dclVersion}`);
  const wave = input.firstWave === 'ALL' ? members.map((m) => m.resourceId) : input.firstWave;
  if (wave.length === 0) problems.push('choose the vehicles of the first wave');
  for (const rid of wave) if (!members.some((m) => m.resourceId === rid)) problems.push(`${rid}: not a vehicle of this rollout`);
  if (problems.length) throw rule('OTA_BLOCKED', 'the rollout would not reach every vehicle safely', { issues: problems });

  for (const g of groups) recordGroupBinding(ctx, g.id, release.resolvedConfigId);
  const id = newId('ota');
  ctx.s.deployments[id] = {
    id,
    kind: 'OTA',
    workspaceId,
    groupId: null,
    subjectId: release.id,
    commitId: null,
    resolvedConfigId: release.resolvedConfigId,
    env: 'production',
    status: 'PENDING',
    vehicleGroupIds: groups.map((g) => g.id),
    targets: members.map((m) => target(ctx, m.resourceId, m.vehicleGroupId, wave.includes(m.resourceId) ? 'PENDING' : 'QUEUED')),
    rollbackOf: null,
    pauseReason: null,
    dispatchedBy: ctx.user().username,
    createdAt: ctx.now,
    updatedAt: ctx.now,
  };
  return id;
}

/** Sends the rollout to more of its queued vehicles. Each one is checked again first. */
export function expandOta(ctx: Ctx, deploymentId: string, resourceIds: string[] | 'ALL'): void {
  const d = getOta(ctx.s, deploymentId);
  allowOta(ctx, d);
  if (d.status === 'PAUSED') throw rule('OTA_PAUSED', 'the rollout is paused; resume it first');
  if (d.status !== 'PENDING') throw rule('OTA_CLOSED', 'the rollout is finished');
  const queued = d.targets.filter((t) => t.status === 'QUEUED');
  const chosen = resourceIds === 'ALL' ? queued : queued.filter((t) => resourceIds.includes(t.resourceId));
  if (chosen.length === 0) throw rule('NOTHING_QUEUED', 'choose queued vehicles to send to');
  const release = getRelease(ctx.s, d.subjectId);
  const problems = chosen.flatMap((t) => {
    const p = otaProblems(ctx.s, ctx.s.resources[t.resourceId]!, release, d.id);
    if (t.vehicleGroupId && ctx.s.groupMembers[t.resourceId] !== t.vehicleGroupId) p.push(`${t.resourceId}: left its vehicle group`);
    return p;
  });
  if (problems.length) throw rule('OTA_BLOCKED', 'some vehicles can no longer take this release', { issues: problems });
  const draft = ctx.s.deployments[d.id]!;
  for (const t of draft.targets) {
    if (chosen.some((c) => c.resourceId === t.resourceId)) {
      t.status = 'PENDING';
      t.previousConfigId = ctx.s.resources[t.resourceId]!.appliedConfigId;
      t.updatedAt = ctx.now;
    }
  }
  draft.updatedAt = ctx.now;
}

export function pauseOta(ctx: Ctx, deploymentId: string, reason: string): void {
  const d = getOta(ctx.s, deploymentId);
  allowOta(ctx, d);
  if (d.status !== 'PENDING') throw rule('OTA_NOT_RUNNING', 'only a running rollout can be paused');
  if (!reason.trim()) throw rule('REASON_REQUIRED', 'give a reason');
  const draft = ctx.s.deployments[d.id]!;
  draft.status = 'PAUSED';
  draft.pauseReason = reason.trim();
  draft.updatedAt = ctx.now;
}

/** Resumes a paused rollout. Failed vehicles are retried with a new attempt; old results stay. */
export function resumeOta(ctx: Ctx, deploymentId: string): void {
  const d = getOta(ctx.s, deploymentId);
  allowOta(ctx, d);
  if (d.status !== 'PAUSED') throw rule('OTA_NOT_PAUSED', 'the rollout is not paused');
  const release = getRelease(ctx.s, d.subjectId);
  const failed = d.targets.filter((t) => t.status === 'FAILED');
  const problems = failed.flatMap((t) => otaProblems(ctx.s, ctx.s.resources[t.resourceId]!, release, d.id));
  if (problems.length) throw rule('OTA_BLOCKED', 'some failed vehicles can no longer take this release', { issues: problems });
  const draft = ctx.s.deployments[d.id] as Draft<Deployment>;
  for (const t of draft.targets) {
    if (t.status !== 'FAILED') continue;
    t.history.push({ attempt: t.attempt, status: t.status, error: t.error, at: t.updatedAt });
    t.attempt += 1;
    t.status = 'PENDING';
    t.error = null;
    t.updatedAt = ctx.now;
  }
  draft.status = 'PENDING';
  draft.pauseReason = null;
  if (draft.targets.every((t) => t.status !== 'PENDING' && t.status !== 'QUEUED')) draft.status = 'COMPLETED';
  draft.updatedAt = ctx.now;
}

/** Stops a rollout: vehicles not yet confirmed are no longer asked to apply it. */
export function cancelOta(ctx: Ctx, deploymentId: string, reason: string): void {
  const d = getOta(ctx.s, deploymentId);
  allowOta(ctx, d);
  if (d.status !== 'PENDING' && d.status !== 'PAUSED') throw rule('OTA_CLOSED', 'the rollout is finished');
  if (!reason.trim()) throw rule('REASON_REQUIRED', 'give a reason');
  const draft = ctx.s.deployments[d.id]!;
  for (const t of draft.targets) {
    if (t.status === 'PENDING' || t.status === 'QUEUED') {
      t.status = 'CANCELLED';
      t.error = reason.trim();
      t.updatedAt = ctx.now;
    }
  }
  draft.status = 'CANCELLED';
  draft.updatedAt = ctx.now;
}

/** Why applied vehicles of a rollout cannot be rolled back; empty when they can. */
export function rollbackProblems(s: State, d: Deployment): string[] {
  const applied = d.targets.filter((t) => t.status === 'APPLIED' && s.resources[t.resourceId]!.appliedConfigId === d.resolvedConfigId);
  if (applied.length === 0) return ['no vehicle runs this rollout’s configuration'];
  return applied.flatMap((t) => {
    const r = s.resources[t.resourceId]!;
    const previous = t.previousConfigId ? s.resolvedConfigs[t.previousConfigId] : undefined;
    // Only a previous formal configuration that still fits the vehicle's software qualifies.
    if (!previous || previous.kind !== 'RELEASE') return [`${r.id}: no earlier formal configuration to return to`];
    const release = s.releases[previous.sourceId];
    if (!release || !r.integrationVersion || !release.vehicleIntegrationVersions.includes(r.integrationVersion)) {
      return [`${r.id}: ${previous.label} does not apply to software ${r.integrationVersion ?? 'unknown'}`];
    }
    const problems: string[] = [];
    if (r.status !== 'AVAILABLE') problems.push(`${r.id}: ${r.status.toLowerCase()}`);
    const pending = pendingDeploymentOf(s, r.id);
    if (pending && pending !== d.id) problems.push(`${r.id}: waiting for deployment ${pending}`);
    const open = openOtaOf(s, r.id, d.id);
    if (open) problems.push(`${r.id}: part of unfinished rollout ${open}`);
    return problems;
  });
}

/** Rolls applied vehicles back to their previous formal configuration, as new rollouts. */
export function rollbackOta(ctx: Ctx, deploymentId: string, reason: string): string[] {
  const d = getOta(ctx.s, deploymentId);
  allowOta(ctx, d);
  if (d.status === 'CANCELLED' || d.status === 'ROLLED_BACK') throw rule('OTA_CLOSED', 'the rollout is already closed');
  if (!reason.trim()) throw rule('REASON_REQUIRED', 'give a reason');
  const problems = rollbackProblems(ctx.s, d);
  if (problems.length) throw rule('ROLLBACK_BLOCKED', 'the rollback would not return every vehicle safely', { issues: problems });
  const applied = d.targets.filter((t) => t.status === 'APPLIED' && ctx.s.resources[t.resourceId]!.appliedConfigId === d.resolvedConfigId);
  const draft = ctx.s.deployments[d.id]!;
  for (const t of draft.targets) {
    if (t.status === 'PENDING' || t.status === 'QUEUED') {
      t.status = 'CANCELLED';
      t.error = `rolled back: ${reason.trim()}`;
      t.updatedAt = ctx.now;
    }
  }
  draft.status = 'ROLLED_BACK';
  draft.pauseReason = reason.trim();
  draft.updatedAt = ctx.now;

  const byConfig = new Map<string, DeploymentTarget[]>();
  for (const t of applied) byConfig.set(t.previousConfigId!, [...(byConfig.get(t.previousConfigId!) ?? []), t]);
  const ids: string[] = [];
  for (const [configId, targets] of byConfig) {
    const previous = ctx.s.resolvedConfigs[configId]!;
    const vehicleGroupIds = [...new Set(targets.map((t) => t.vehicleGroupId!).filter(Boolean))];
    for (const vg of vehicleGroupIds) recordGroupBinding(ctx, vg, configId);
    const id = newId('ota');
    ctx.s.deployments[id] = {
      id,
      kind: 'OTA',
      workspaceId: d.workspaceId,
      groupId: null,
      subjectId: previous.sourceId,
      commitId: null,
      resolvedConfigId: configId,
      env: 'production',
      status: 'PENDING',
      vehicleGroupIds,
      targets: targets.map((t) => target(ctx, t.resourceId, t.vehicleGroupId!, 'PENDING')),
      rollbackOf: d.id,
      pauseReason: null,
      dispatchedBy: ctx.user().username,
      createdAt: ctx.now,
      updatedAt: ctx.now,
    };
    ids.push(id);
  }
  return ids;
}

export function otaRollouts(s: State, workspaceId?: string): Deployment[] {
  return Object.values(s.deployments)
    .filter((d) => d.kind === 'OTA' && (!workspaceId || d.workspaceId === workspaceId))
    .sort((a, b) => b.id.localeCompare(a.id)); // ids sort by creation time
}
