// Delivery (下发与推送). A dispatch only sets what vehicles should run: their cloud configuration.
// The cloud pushes it when the vehicle is on and connected, and only an APPLIED receipt changes
// what the vehicle runs. A vehicle that joins a development or testing group follows what was
// already dispatched to the group: on its next report the cloud pushes it, if it fits the
// vehicle's software. When it does not fit, the team chooses: adapt the policies (and confirm and
// dispatch to the vehicle), or update the vehicle's software and leave the policies as they are.

import { authorize } from '../domain/authz.ts';
import { rule } from '../domain/errors.ts';
import { newId } from '../domain/ids.ts';
import type { Actor, Ctx } from './engine.ts';
import { getResource, livePublication, membersOf, publicationDispatches, supersedeBaseline } from './fleet.ts';
import { getGroup } from './org.ts';
import { answerConfigRequest } from './ota.ts';
import type { ConfigAnswer } from './ota.ts';
import { assessPublicationOn, emptyCheck } from './software-change.ts';
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

/**
 * The base the group runs its Feature publication on: the base most of its other members run it on,
 * else that of its latest standing dispatch, else the group's explicit base.
 */
export function groupPublicationBase(s: State, g: VehicleGroup, except?: string): string | null {
  const p = livePublication(s, g);
  if (!p) return g.baseReleaseId;
  const feature = s.features[p.featureId]!;
  const counts = new Map<string | null, number>();
  for (const rid of membersOf(s, g.id)) {
    const c = rid === except ? undefined : s.resolvedConfigs[s.resources[rid]?.appliedConfigId ?? ''];
    if (c?.kind === 'FEATURE' && c.sourceId === p.featureId && c.groups[feature.groupId] === p.commitId) counts.set(c.baseReleaseId, (counts.get(c.baseReleaseId) ?? 0) + 1);
  }
  const most = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (most) return most[0];
  const latest = publicationDispatches(s, g)[0];
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
  /**
   * FITS: pushed on the vehicle's next report. BLOCKED: it fits, but something must clear first
   * (a pending task, an overdue loan, a group that takes approved team tests). MISMATCH: it does
   * not fit the vehicle's software; the team decides. NOTHING: nothing stands published to follow.
   */
  state: 'FITS' | 'BLOCKED' | 'MISMATCH' | 'NOTHING';
  fits: boolean;
}

/** The vehicle group's workspace or business group was archived: nothing is followed there any more. */
const closedGroup = (s: State, g: VehicleGroup) => s.workspaces[g.workspaceId]?.status !== 'ACTIVE' || (g.groupId !== null && s.groups[g.groupId]?.status !== 'ACTIVE');

/** How a vehicle waiting to follow its group fits what the group published (null when it does not wait). */
export function fitOf(s: State, resourceId: string): GroupFit | null {
  const follow = s.groupFollows[resourceId];
  const r = s.resources[resourceId];
  const g = follow ? s.vehicleGroups[follow.vehicleGroupId] : undefined;
  if (!follow || !r || !g || s.groupMembers[resourceId] !== g.id) return null;
  const answer = answerConfigRequest(s, resourceId);
  const p = closedGroup(s, g) ? null : livePublication(s, g);
  if (!p || s.features[p.featureId]!.stage === 'ARCHIVED') return { resourceId, follow, vehicleGroupId: g.id, check: { ...emptyCheck('NOT_PUBLISHED'), vehicleGroupId: g.id }, answer, problems: [], state: 'NOTHING', fits: false };
  const feature = s.features[p.featureId]!;
  const check = assessPublicationOn(s, r, g, r.integrationVersion, groupPublicationBase(s, g, r.id));
  // The base problem is the check's own outcome; list only the other reasons.
  const own = featureTarget(s, feature, p.commitId, g, r, p.disabledPolicies).problem;
  const problems = vehicleDispatchProblems(s, feature, p.commitId, g, r, p.disabledPolicies).filter((x) => x !== own);
  // An approval covers the members it was asked for; a new one comes through a team test request.
  if (g.requiresApproval) problems.push('the vehicle group takes approved team test requests');
  const fitsSoftware = (check.outcome === 'NONE' || check.outcome === 'REPUBLISH') && answer.reason === 'GROUP_TARGET';
  const state = !fitsSoftware ? 'MISMATCH' : problems.length ? 'BLOCKED' : 'FITS';
  return { resourceId, follow, vehicleGroupId: g.id, check, answer, problems, state, fits: state === 'FITS' };
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
  const p = g ? livePublication(ctx.s, g) : null;
  // An archived Feature's publication keeps running where it was applied, but no new vehicle follows
  // it; nor one of an archived business group or workspace.
  if (!g || ctx.s.groupMembers[resourceId] !== g.id || g.status !== 'ACTIVE' || closedGroup(ctx.s, g) || !p || ctx.s.features[p.featureId]!.stage === 'ARCHIVED') {
    delete ctx.s.groupFollows[resourceId];
    return null;
  }
  const fit = fitOf(ctx.s, resourceId)!;
  if (!fit.fits) return null;
  const r = ctx.s.resources[resourceId]!;
  const feature = ctx.s.features[p.featureId]!;
  delete ctx.s.groupFollows[resourceId];
  if (fit.answer.configId === r.appliedConfigId) return null;
  // The vehicle just reported, so it is connected: the push happens now. It follows the dispatch
  // that stands, so the push is credited to whoever made it.
  const target = newTarget(ctx, r, g.id);
  target.pushedAt = ctx.now;
  const by = publicationDispatches(ctx.s, g)[0]?.dispatchedBy ?? feature.createdBy;
  return createFeatureDeployment(ctx, feature, p.commitId, fit.answer.configId!, g.env, [g.id], [target], 'GROUP_FOLLOW', by);
}

/**
 * After an accepted report (system context): a vehicle of a test group with nothing under test runs
 * the set mapped to its software (默认基线, e.g. the set a PLM test version references). When it
 * runs anything else and nothing else is on its way to it, the cloud pushes that set now, credited
 * to whoever last confirmed the mapping (else to whoever published the set).
 */
export function followBaseline(ctx: Ctx, resourceId: string): string | null {
  const r = ctx.s.resources[resourceId];
  const g = r && ctx.s.groupMembers[r.id] ? ctx.s.vehicleGroups[ctx.s.groupMembers[r.id]!] : undefined;
  if (!r || !g || g.purpose !== 'TEST' || g.status !== 'ACTIVE' || closedGroup(ctx.s, g) || r.env !== 'testing') return null;
  const answer = answerConfigRequest(ctx.s, r.id);
  if (answer.reason !== 'LATEST_RELEASE' || !answer.configId || answer.configId === r.appliedConfigId) return null;
  const waiting = Object.values(ctx.s.deployments).filter((d) => d.status === 'PENDING' && d.targets.some((t) => t.resourceId === r.id && t.status === 'PENDING'));
  // Something else is on its way, or this very set already is.
  if (waiting.some((d) => d.kind !== 'BASELINE' || d.resolvedConfigId === answer.configId)) return null;
  // An earlier mapping's push the vehicle never confirmed: its software moved on since.
  supersedeBaseline(ctx, r.id, 'the vehicle’s software maps to another set now');
  const release = ctx.s.releases[ctx.s.resolvedConfigs[answer.configId]!.sourceId]!;
  const confirmed = ctx.s.applicability.filter((a) => a.releaseId === release.id && a.version === r.integrationVersion && a.action === 'ADD' && a.by).sort((a, b) => b.seq - a.seq)[0];
  const target = newTarget(ctx, r, g.id);
  target.pushedAt = ctx.now;
  const id = newId('dp');
  ctx.s.deployments[id] = {
    id,
    kind: 'BASELINE',
    workspaceId: g.workspaceId,
    groupId: null,
    subjectId: release.id,
    commitId: null,
    resolvedConfigId: answer.configId,
    env: g.env,
    status: 'PENDING',
    vehicleGroupIds: [g.id],
    targets: [target],
    trigger: 'GROUP_FOLLOW',
    dispatchedBy: confirmed?.by ?? release.publishedBy,
    createdAt: ctx.now,
    updatedAt: ctx.now,
  };
  return id;
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
  const p = livePublication(ctx.s, g);
  const feature = p ? ctx.s.features[p.featureId] : undefined;
  if (!p || !feature || feature.stage === 'ARCHIVED') throw rule('NO_FEATURE_PUBLICATION', `nothing of a Feature stands dispatched to ${g.name}; dispatch to the group`);
  const group = getGroup(ctx.s, feature.groupId);
  ctx.allow('feature.dispatch', { type: 'vehicle', id: r.id, workspaceId: g.workspaceId, groupId: group.id, scope: group.domain, env: g.env });
  if (group.status !== 'ACTIVE') throw rule('GROUP_ARCHIVED', `group ${group.id} is archived`);
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
      if (!f || f.state !== 'MISMATCH') return false;
      const g = s.vehicleGroups[f.vehicleGroupId]!;
      const group = g.groupId ? s.groups[g.groupId] : undefined;
      return g.workspaceId === workspaceId && !!group && authorize(actor.grants, 'feature.dispatch', { workspaceId, groupId: group.id, scope: group.domain, env: g.env }).ok;
    })
    .sort((a, b) => b.follow.since.localeCompare(a.follow.since));
}
