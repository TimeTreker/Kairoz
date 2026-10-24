// Delivery (下发与推送). A dispatch only sets what vehicles should run: their cloud configuration.
// The cloud pushes it when the vehicle is on and connected, and only an APPLIED receipt changes
// what the vehicle runs. A vehicle that joins a development or testing group follows what was
// already dispatched to the group: on its next report the cloud pushes it, if it fits the
// vehicle's software. When it does not fit, the team chooses: adapt the policies (and confirm and
// dispatch to the vehicle), or update the vehicle's software and leave the policies as they are.

import { authorize } from '../domain/authz.ts';
import { notFound, rule } from '../domain/errors.ts';
import type { Actor, Ctx } from './engine.ts';
import { getResource } from './fleet.ts';
import { getGroup } from './org.ts';
import { answerConfigRequest } from './ota.ts';
import type { ConfigAnswer } from './ota.ts';
import { assessPublicationOn } from './software-change.ts';
import type { PublicationCheck } from './software-change.ts';
import type { DeploymentTarget, GroupFollow, State, VehicleGroup } from './types.ts';
import { createFeatureDeployment, featureTarget, newTarget, resolveFeatureConfig, vehicleDispatchProblems } from './validation.ts';

/** NOT_PUSHED: dispatched, the vehicle has not been on since. PUSHED: delivered, no receipt yet. */
export type DeliveryState = 'QUEUED' | 'NOT_PUSHED' | 'PUSHED' | 'APPLIED' | 'FAILED' | 'CANCELLED';

export function deliveryState(t: Pick<DeploymentTarget, 'status' | 'pushedAt'>): DeliveryState {
  if (t.status === 'PENDING') return t.pushedAt ? 'PUSHED' : 'NOT_PUSHED';
  return t.status;
}

/**
 * The vehicle is on and connected: the cloud pushes every configuration dispatched to it that it
 * has not received (system context). Targets of a paused or staged rollout are held.
 */
export function pushPending(ctx: Ctx, resourceId: string): number {
  let pushed = 0;
  for (const d of Object.values(ctx.s.deployments)) {
    if (d.status !== 'PENDING') continue;
    for (const t of d.targets) {
      if (t.resourceId !== resourceId || t.status !== 'PENDING' || t.pushedAt) continue;
      t.pushedAt = ctx.now;
      pushed += 1;
    }
  }
  return pushed;
}

/** The base the group's Feature publication was delivered on: its latest dispatch, else the group's explicit base. */
export function groupPublicationBase(s: State, g: VehicleGroup): string | null {
  const p = g.publication;
  if (p?.kind !== 'FEATURE') return g.baseReleaseId;
  const latest = Object.values(s.deployments)
    .filter((d) => d.kind === 'FEATURE' && d.trigger === 'DISPATCH' && d.subjectId === p.featureId && d.commitId === p.commitId && d.vehicleGroupIds.includes(g.id))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))[0];
  return latest ? (s.resolvedConfigs[latest.resolvedConfigId]?.baseReleaseId ?? null) : g.baseReleaseId;
}

export interface GroupFit {
  resourceId: string;
  follow: GroupFollow;
  vehicleGroupId: string;
  /** The group's Feature publication checked on the vehicle's software. */
  check: PublicationCheck;
  /** What the vehicle would be told to run. */
  answer: ConfigAnswer;
  /** Why the vehicle cannot take the publication now, apart from the check. */
  problems: string[];
  /** The publication fits: the cloud pushes it on the vehicle's next report. */
  fits: boolean;
}

/** How a vehicle waiting to follow its group fits what the group published (null when it does not wait). */
export function fitOf(s: State, resourceId: string): GroupFit | null {
  const follow = s.groupFollows[resourceId];
  const r = s.resources[resourceId];
  const g = follow ? s.vehicleGroups[follow.vehicleGroupId] : undefined;
  if (!follow || !r || !g || s.groupMembers[resourceId] !== g.id) return null;
  const check = assessPublicationOn(s, r, g, r.integrationVersion, groupPublicationBase(s, g));
  const answer = answerConfigRequest(s, resourceId);
  const p = g.publication;
  const feature = p?.kind === 'FEATURE' ? s.features[p.featureId] : undefined;
  let problems: string[] = [];
  if (p?.kind === 'FEATURE' && feature) {
    // The base problem is the check's own outcome; list only the other reasons.
    const own = featureTarget(s, feature, p.commitId, g, r, p.disabledPolicies).problem;
    problems = vehicleDispatchProblems(s, feature, p.commitId, g, r, p.disabledPolicies).filter((x) => x !== own);
  }
  const fits = (check.outcome === 'NONE' || check.outcome === 'REPUBLISH') && answer.reason === 'GROUP_TARGET' && problems.length === 0;
  return { resourceId, follow, vehicleGroupId: g.id, check, answer, problems, fits };
}

/**
 * After an accepted report (system context): a vehicle waiting to follow its group is pushed the
 * group's Feature publication when it fits. Nothing is pushed for a group without one; the next
 * dispatch to the group covers the vehicle. A vehicle that does not fit keeps waiting for its team.
 */
export function followGroup(ctx: Ctx, resourceId: string): string | null {
  const follow = ctx.s.groupFollows[resourceId];
  if (!follow) return null;
  const g = ctx.s.vehicleGroups[follow.vehicleGroupId];
  const p = g?.publication;
  const feature = p?.kind === 'FEATURE' ? ctx.s.features[p.featureId] : undefined;
  if (!g || ctx.s.groupMembers[resourceId] !== g.id || g.status !== 'ACTIVE' || p?.kind !== 'FEATURE' || !feature || feature.stage === 'ARCHIVED') {
    delete ctx.s.groupFollows[resourceId];
    return null;
  }
  const fit = fitOf(ctx.s, resourceId)!;
  if (!fit.fits) return null;
  const r = ctx.s.resources[resourceId]!;
  delete ctx.s.groupFollows[resourceId];
  if (fit.answer.configId === r.appliedConfigId) return null;
  // The vehicle just reported, so it is connected: the push happens now.
  const target = newTarget(ctx, r, g.id);
  target.pushedAt = ctx.now;
  return createFeatureDeployment(ctx, feature, p.commitId, fit.answer.configId!, g.env, [g.id], [target], 'GROUP_FOLLOW', lastDispatcher(ctx.s, g) ?? feature.createdBy);
}

function lastDispatcher(s: State, g: VehicleGroup): string | undefined {
  return Object.values(s.deployments)
    .filter((d) => d.trigger === 'DISPATCH' && d.vehicleGroupIds.includes(g.id))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))[0]?.dispatchedBy;
}

/**
 * 确认并下发: dispatches what was published to the vehicle's group to this one vehicle, on its own
 * base. It covers the vehicle (it stops waiting to follow) and confirms its open software change.
 * The Feature's stage does not change: the group's publication is not a new one.
 */
export function dispatchToVehicle(ctx: Ctx, resourceId: string): string {
  const r = getResource(ctx.s, resourceId);
  const vgId = ctx.s.groupMembers[r.id];
  const g = vgId ? ctx.s.vehicleGroups[vgId] : undefined;
  if (!g) throw rule('NOT_IN_VEHICLE_GROUP', `${r.id} routes through no vehicle group`);
  const p = g.publication;
  const feature = p?.kind === 'FEATURE' ? ctx.s.features[p.featureId] : undefined;
  if (p?.kind !== 'FEATURE' || !feature) throw rule('NO_FEATURE_PUBLICATION', `nothing of a Feature was dispatched to ${g.name} yet; dispatch to the group`);
  const group = getGroup(ctx.s, feature.groupId);
  ctx.allow('feature.dispatch', { type: 'vehicle', id: r.id, workspaceId: g.workspaceId, groupId: group.id, scope: group.domain, env: g.env });
  if (feature.stage === 'ARCHIVED') throw notFound('feature', feature.id);
  if (g.requiresApproval) throw rule('APPROVAL_REQUIRED', 'this vehicle group takes approved team test requests', { issues: [g.name] });
  const problems = vehicleDispatchProblems(ctx.s, feature, p.commitId, g, r, p.disabledPolicies);
  if (problems.length) throw rule('DISPATCH_BLOCKED', 'the dispatch would not reach the vehicle safely', { issues: problems.map((x) => `${r.id}: ${x}`) });
  const configId = resolveFeatureConfig(ctx, feature, p.commitId, g, r, p.disabledPolicies);
  delete ctx.s.groupFollows[r.id];
  for (const c of Object.values(ctx.s.softwareChanges)) {
    if (c.resourceId === r.id && c.status === 'APPLIED' && !c.acknowledgedBy) {
      c.acknowledgedBy = ctx.user().username;
      c.acknowledgedAt = ctx.now;
    }
  }
  return createFeatureDeployment(ctx, feature, p.commitId, configId, g.env, [g.id], [newTarget(ctx, r, g.id)], 'DISPATCH', ctx.user().username);
}

/** Vehicles of the workspace's groups that do not fit what was dispatched to their group, for those who publish to it. */
export function mismatchesFor(s: State, actor: Actor, workspaceId: string): GroupFit[] {
  return Object.keys(s.groupFollows)
    .map((rid) => fitOf(s, rid))
    .filter((f): f is GroupFit => {
      if (!f || f.fits || f.check.outcome === 'NOT_PUBLISHED') return false;
      const g = s.vehicleGroups[f.vehicleGroupId]!;
      const group = g.groupId ? s.groups[g.groupId] : undefined;
      return g.workspaceId === workspaceId && !!group && authorize(actor.grants, 'feature.dispatch', { workspaceId, groupId: group.id, scope: group.domain, env: g.env }).ok;
    })
    .sort((a, b) => b.follow.since.localeCompare(a.follow.since));
}
