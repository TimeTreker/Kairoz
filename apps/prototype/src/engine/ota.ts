// Configuration OTA (配置 OTA): staged rollout of a formal release to production vehicle groups.
// Each vehicle is checked against the release (model, actual software, newest match); a failure
// pauses the rollout, a resume retries failed vehicles with a new attempt, and a rollback returns
// applied vehicles to their previous, still compatible formal configuration.

import type { Draft } from 'immer';
import { notFound, rule } from '../domain/errors.ts';
import { newId } from '../domain/ids.ts';
import type { Ctx } from './engine.ts';
import { directTargetProblems, membersOf, openOtaOf, pendingDeploymentOf, recordGroupBinding } from './fleet.ts';

export { openOtaOf };
import { appliesTo, getRelease, releaseFor } from './release.ts';
import type { Deployment, DeploymentTarget, Release, Resource, State } from './types.ts';
import { featureTarget, featureTargetDigest } from './validation.ts';

/**
 * A vehicle another set is in effect for, whose software this set does not apply to: not a target
 * of this rollout at all (a group may mix software versions served by different sets).
 */
export function outsideRollout(s: State, r: Resource, release: Release): boolean {
  return releaseFor(s, r).release !== null && r.integrationVersion !== null && !appliesTo(s, release, r.integrationVersion);
}

/** Why a vehicle cannot take a release now; empty when it can. */
export function otaProblems(s: State, r: Resource, release: Release, except?: string): string[] {
  const problems: string[] = [];
  if (r.env !== 'production') problems.push(`${r.id}: not a production vehicle`);
  if (r.status !== 'AVAILABLE') problems.push(`${r.id}: ${r.status.toLowerCase()}`);
  if (r.vehicleModelId !== release.vehicleModelId) problems.push(`${r.id}: another vehicle model`);
  const resolved = releaseFor(s, r);
  if (!resolved.release) problems.push(`${r.id}: ${resolved.problem}`);
  else if (!appliesTo(s, release, r.integrationVersion!)) problems.push(`${r.id}: policy set ${release.dclVersion} does not apply to software ${r.integrationVersion}`);
  else if (resolved.release.id !== release.id) problems.push(`${r.id}: resolves to the newer policy set ${resolved.release.dclVersion}`);
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

function target(ctx: Ctx, resourceId: string, vehicleGroupId: string | null, status: DeploymentTarget['status']): DeploymentTarget {
  return {
    resourceId,
    vehicleGroupId,
    attempt: 0,
    status,
    previousConfigId: ctx.s.resources[resourceId]!.appliedConfigId,
    error: null,
    updatedAt: ctx.now,
    pushedAt: null,
    history: [],
  };
}

/**
 * Starts a rollout of a release to production vehicle groups, or to production vehicles of the
 * workspace that route through no group. `firstWave` lists the vehicles sent at once (gray
 * release); the others wait until the rollout is expanded.
 */
export function createOta(
  ctx: Ctx,
  input: { releaseId: string; workspaceId?: string; vehicleGroupIds?: string[]; resourceIds?: string[]; firstWave: string[] | 'ALL' },
): string {
  const release = getRelease(ctx.s, input.releaseId);
  const direct = input.resourceIds ?? [];
  if ((input.vehicleGroupIds ?? []).length === 0 && direct.length === 0) throw rule('NO_VEHICLE_GROUPS', 'choose vehicle groups or ungrouped vehicles');
  const groups = (input.vehicleGroupIds ?? []).map((id) => {
    const g = ctx.s.vehicleGroups[id];
    if (!g) throw notFound('vehicle group', id);
    ctx.allow('ota.manage', { type: 'vehicleGroup', id: g.id, workspaceId: g.workspaceId, scope: 'Vehicle' });
    return g;
  });
  const workspaceId = groups[0]?.workspaceId ?? input.workspaceId;
  if (!workspaceId) throw rule('WORKSPACE_REQUIRED', 'name the workspace of the vehicles');
  ctx.allow('ota.manage', { type: 'workspace', id: workspaceId, workspaceId, scope: 'Vehicle' });
  if (ctx.s.workspaces[workspaceId]?.vehicleModelId !== release.vehicleModelId) throw rule('MODEL_MISMATCH', 'the workspace is for another vehicle model');
  const problems: string[] = directTargetProblems(ctx.s, workspaceId, direct);
  const members: { resourceId: string; vehicleGroupId: string | null }[] = [];
  for (const g of groups) {
    if (g.status !== 'ACTIVE') problems.push(`${g.name}: archived`);
    if (g.purpose !== 'PRODUCTION') problems.push(`${g.name}: formal releases roll out to production vehicle groups`);
    if (g.workspaceId !== workspaceId) problems.push(`${g.name}: in another workspace`);
    if (ctx.s.workspaces[g.workspaceId]?.vehicleModelId !== release.vehicleModelId) problems.push(`${g.name}: another vehicle model`);
    const list = membersOf(ctx.s, g.id);
    if (list.length === 0) problems.push(`${g.name}: no vehicles`);
    for (const rid of list) {
      const r = ctx.s.resources[rid]!;
      if (outsideRollout(ctx.s, r, release)) continue;
      const issues = otaProblems(ctx.s, r, release);
      // Vehicles already running the release, and still fitting it, need nothing.
      if (r.appliedConfigId === release.resolvedConfigId && issues.length === 0) continue;
      problems.push(...issues);
      members.push({ resourceId: rid, vehicleGroupId: g.id });
    }
  }
  if (problems.length === 0) {
    for (const rid of direct) {
      const r = ctx.s.resources[rid]!;
      const issues = otaProblems(ctx.s, r, release);
      if (r.appliedConfigId === release.resolvedConfigId && issues.length === 0) continue;
      problems.push(...issues);
      members.push({ resourceId: rid, vehicleGroupId: null });
    }
  }
  if (!problems.length && members.length === 0) throw rule('NOTHING_TO_ROLL_OUT', `every vehicle already runs policy set ${release.dclVersion}`);
  const wave = input.firstWave === 'ALL' ? members.map((m) => m.resourceId) : input.firstWave;
  if (wave.length === 0) problems.push('choose the vehicles of the first wave');
  for (const rid of wave) if (!members.some((m) => m.resourceId === rid)) problems.push(`${rid}: not a vehicle of this rollout`);
  if (problems.length) throw rule('OTA_BLOCKED', 'the rollout would not reach every vehicle safely', { issues: problems });

  for (const g of groups) recordGroupBinding(ctx, g.id, { kind: 'RELEASE', releaseId: release.id, configId: release.resolvedConfigId });
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
    trigger: 'DISPATCH',
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
      t.pushedAt = null;
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
    t.pushedAt = null;
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
    if (!release || !r.integrationVersion || !appliesTo(s, release, r.integrationVersion)) {
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
    for (const vg of vehicleGroupIds) recordGroupBinding(ctx, vg, { kind: 'RELEASE', releaseId: previous.sourceId, configId });
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
      trigger: 'DISPATCH',
      dispatchedBy: ctx.user().username,
      createdAt: ctx.now,
      updatedAt: ctx.now,
    };
    ids.push(id);
  }
  return ids;
}

export interface ConfigAnswer {
  configId: string | null;
  /**
   * HELD: a paused, cancelled or rolled-back rollout stops chasing newer configurations; the
   * vehicle keeps what it confirmed. TASK: a running rollout's fixed target. LATEST_RELEASE: the
   * policy set in effect for the vehicle's software. GROUP_TARGET: what was published to a development
   * or testing group, on the vehicle's own base. REPUBLISH: the vehicle's software or its set changed
   * since; BASE_CONFLICT: the new base changed the Feature's own group; NO_BASE: no set applies to the
   * software and the group names no base. These three keep the applied configuration until someone
   * publishes again. PERSONAL: the draft a personal simulation's owner just sent it. APPLIED /
   * INITIAL: nothing newer is assigned. BLOCKED: no configuration may run.
   */
  reason: 'HELD' | 'TASK' | 'LATEST_RELEASE' | 'GROUP_TARGET' | 'REPUBLISH' | 'BASE_CONFLICT' | 'NO_BASE' | 'PERSONAL' | 'APPLIED' | 'INITIAL' | 'BLOCKED';
  detail: string | null;
}

/** What the platform answers when a vehicle asks which configuration to run. */
export function answerConfigRequest(s: State, resourceId: string): ConfigAnswer {
  const r = s.resources[resourceId];
  if (!r) return { configId: null, reason: 'BLOCKED', detail: 'unknown vehicle' };
  if (r.status !== 'AVAILABLE') return { configId: null, reason: 'BLOCKED', detail: `the vehicle is ${r.status.toLowerCase()}` };
  if (r.personal) {
    // A personal simulation runs only what its owner sent it.
    const pending = Object.values(s.deployments).find((d) => d.kind === 'PERSONAL' && d.subjectId === r.id && d.status === 'PENDING');
    if (pending) return { configId: pending.resolvedConfigId, reason: 'PERSONAL', detail: r.personal.owner };
    return r.appliedConfigId ? { configId: r.appliedConfigId, reason: 'APPLIED', detail: null } : { configId: null, reason: 'INITIAL', detail: null };
  }
  const rollout = otaRollouts(s).find((d) => d.targets.some((t) => t.resourceId === r.id));
  const target = rollout?.targets.find((t) => t.resourceId === r.id);
  if (rollout && target) {
    if (['PAUSED', 'CANCELLED', 'ROLLED_BACK'].includes(rollout.status) || rollout.rollbackOf) {
      return { configId: r.appliedConfigId, reason: 'HELD', detail: `rollout ${rollout.id} is ${rollout.rollbackOf ? 'a rollback' : rollout.status.toLowerCase()}; start a new rollout to resume` };
    }
    if (rollout.status === 'PENDING' && target.status === 'PENDING') return { configId: rollout.resolvedConfigId, reason: 'TASK', detail: rollout.id };
  }
  if (r.env === 'production') {
    const resolved = releaseFor(s, r);
    return resolved.release ? { configId: resolved.release.resolvedConfigId, reason: 'LATEST_RELEASE', detail: `policy set ${resolved.release.dclVersion}` } : { configId: null, reason: 'BLOCKED', detail: resolved.problem };
  }
  const group = s.groupMembers[r.id] ? s.vehicleGroups[s.groupMembers[r.id]!] : undefined;
  const p = group?.publication;
  if (group && p) {
    if (p.kind !== 'FEATURE') return { configId: p.configId, reason: 'GROUP_TARGET', detail: group.name };
    const feature = s.features[p.featureId];
    if (feature) {
      // A Feature publication is resolved on the vehicle's own base; nothing is created by asking.
      const t = featureTarget(s, feature, p.commitId, group, r, p.disabledPolicies);
      if (t.problem) return { configId: r.appliedConfigId, reason: t.conflict ? 'BASE_CONFLICT' : 'NO_BASE', detail: t.problem };
      const digest = featureTargetDigest(s, feature, t);
      const config = Object.values(s.resolvedConfigs).find((c) => c.digest === digest);
      if (config) return { configId: config.id, reason: 'GROUP_TARGET', detail: group.name };
      return { configId: r.appliedConfigId, reason: 'REPUBLISH', detail: 'the software or its policy set changed; publish to the group again' };
    }
  }
  return r.appliedConfigId ? { configId: r.appliedConfigId, reason: 'APPLIED', detail: null } : { configId: null, reason: 'INITIAL', detail: null };
}

export function otaRollouts(s: State, workspaceId?: string): Deployment[] {
  return Object.values(s.deployments)
    .filter((d) => d.kind === 'OTA' && (!workspaceId || d.workspaceId === workspaceId))
    .sort((a, b) => b.id.localeCompare(a.id)); // ids sort by creation time
}
