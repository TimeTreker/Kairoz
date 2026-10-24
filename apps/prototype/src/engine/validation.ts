// Validation (测试验证): dispatching a fixed configuration to vehicle groups, receipts from the
// vehicles, test evidence and Verified. Creating a dispatch only changes what vehicles should
// run; only an APPLIED receipt changes what they actually run.

import type { Draft } from 'immer';
import { digestOf } from '../domain/canonical.ts';
import { policyCompatibility } from '../domain/compatibility.ts';
import { notFound, rule } from '../domain/errors.ts';
import { newId } from '../domain/ids.ts';
import type { Env } from '../domain/vocabulary.ts';
import { authorizeFeature, displayName, latestRelease } from './config.ts';
import type { Ctx } from './engine.ts';
import { authorizePersonal, directTargetProblems, getResource, membersOf, pendingDeploymentOf, pendingImageChangeOf, pendingSoftwareUpdateOf, recordGroupBinding, softwareKey } from './fleet.ts';
import { getGroup } from './org.ts';
import { commitSnapshot, resolveFiles } from './snapshots.ts';
import { setInEffect } from './release.ts';
import type { Candidate, Deployment, DeploymentTarget, Feature, PersonalDraft, Release, ResolvedConfig, Resource, State, TestRequest, TestRun, VehicleGroup } from './types.ts';

/** Finds or creates the resolved configuration for a base plus group commits. */
export function resolveConfig(
  ctx: Ctx,
  input: {
    vehicleModelId: string;
    kind: ResolvedConfig['kind'];
    sourceId: string;
    baseReleaseId: string | null;
    groups: Record<string, string>;
    disabledPolicies?: string[];
    draft?: PersonalDraft | null;
    label: string;
  },
): string {
  const disabledPolicies = [...new Set(input.disabledPolicies ?? [])].sort();
  const draft = input.draft ?? null;
  const digest = configDigest(ctx.s, { ...input, disabledPolicies, draft });
  const existing = Object.values(ctx.s.resolvedConfigs).find((c) => c.digest === digest);
  if (existing) return existing.id;
  const id = newId('rc');
  ctx.s.resolvedConfigs[id] = { id, ...input, groups: { ...input.groups }, disabledPolicies, draft, digest, createdAt: ctx.now };
  return id;
}

/** The identity of a configuration; computed without creating it. */
export function configDigest(
  s: State,
  input: {
    vehicleModelId: string;
    kind: ResolvedConfig['kind'];
    sourceId: string;
    baseReleaseId: string | null;
    groups: Record<string, string>;
    disabledPolicies: string[];
    draft?: Pick<PersonalDraft, 'groupId' | 'digest'> | null;
  },
): string {
  const pairs = Object.keys(input.groups)
    .sort()
    .map((g) => [g, s.commits[input.groups[g]!]!.digest]);
  // Switched-off policies and drafts change the identity only when present, so earlier configurations keep theirs.
  const disabled = input.disabledPolicies.length ? { disabledPolicies: [...input.disabledPolicies].sort() } : {};
  const draft = input.draft ? { draft: [input.draft.groupId, input.draft.digest] } : {};
  return digestOf({ vehicleModelId: input.vehicleModelId, baseReleaseId: input.baseReleaseId, kind: input.kind, sourceId: input.sourceId, groups: pairs, ...disabled, ...draft });
}

/**
 * The base a vehicle of a development or testing group builds on: the group's explicit base, or
 * the policy set in effect for the vehicle's software. Unknown software, or a model with no set
 * yet, takes the initial development configuration (no base). Known software no set applies to
 * has none: the group names an explicit base rather than silently dropping the formal policies.
 */
export function vehicleBase(s: State, explicitBaseId: string | null, r: Resource): { release: Release | null; problem: string | null } {
  if (explicitBaseId) return { release: s.releases[explicitBaseId] ?? null, problem: null };
  if (!r.integrationVersion || !latestRelease(s, r.vehicleModelId)) return { release: null, problem: null };
  const set = setInEffect(s, r.vehicleModelId, r.integrationVersion);
  return set ? { release: set, problem: null } : { release: null, problem: `no policy set applies to software ${r.integrationVersion}; choose an explicit base` };
}

export interface FeatureTarget {
  baseReleaseId: string | null;
  groups: Record<string, string>;
  disabledPolicies: string[];
  /** The base already changed the Feature's own business group. */
  conflict: boolean;
  problem: string | null;
}

/**
 * What one vehicle runs for a Feature commit published to its group: its base, the commit in place
 * of the Feature's business group, and the base policies of other groups switched off.
 */
export function featureTarget(s: State, feature: Feature, commitId: string, group: VehicleGroup, r: Resource, disabledPolicies: string[]): FeatureTarget {
  const t = baseTarget(s, feature, group.baseReleaseId, r, disabledPolicies);
  return t.problem ? t : { ...t, groups: { ...t.groups, [feature.groupId]: commitId } };
}

/**
 * The vehicle's base for a Feature without the Feature's own group: what a commit or a draft of
 * that group runs on top of, with the base policies of other groups switched off.
 */
export function baseTarget(s: State, feature: Feature, explicitBaseId: string | null, r: Resource, disabledPolicies: string[]): FeatureTarget {
  const none = { baseReleaseId: null, groups: {}, disabledPolicies: [] };
  const base = vehicleBase(s, explicitBaseId, r);
  if (base.problem) return { ...none, conflict: false, problem: base.problem };
  const baseGroups = base.release?.groups ?? {};
  // A Feature changes only its own group, so the base must still hold what the Feature started from.
  const started = feature.baseReleaseId ? s.releases[feature.baseReleaseId]?.groups[feature.groupId] : undefined;
  if (base.release && baseGroups[feature.groupId] !== started) {
    return { ...none, conflict: true, problem: `policy set ${base.release.dclVersion} changed ${s.groups[feature.groupId]?.code ?? feature.groupId} after the Feature started; start a Feature on it` };
  }
  const others = Object.fromEntries(Object.entries(baseGroups).filter(([g]) => g !== feature.groupId));
  const present = new Set(Object.values(others).flatMap((c) => Object.keys(s.commits[c]!.policies)));
  return { baseReleaseId: base.release?.id ?? null, groups: others, disabledPolicies: disabledPolicies.filter((p) => present.has(p)).sort(), conflict: false, problem: null };
}

/** The commit's name, plus the base when it differs from the Feature's and how many policies are off. */
function featureLabel(s: State, feature: Feature, commitId: string, t: FeatureTarget): string {
  const base = t.baseReleaseId !== feature.baseReleaseId ? ` @${t.baseReleaseId ? s.releases[t.baseReleaseId]!.dclVersion : 'initial'}` : '';
  const off = t.disabledPolicies.length ? ` −${t.disabledPolicies.length}` : '';
  return `${displayName(s, commitId)}${base}${off}`;
}

/** The identity of the configuration a Feature target resolves to (nothing is created). */
export function featureTargetDigest(s: State, feature: Feature, t: FeatureTarget): string {
  return configDigest(s, { vehicleModelId: feature.vehicleModelId, kind: 'FEATURE', sourceId: feature.id, baseReleaseId: t.baseReleaseId, groups: t.groups, disabledPolicies: t.disabledPolicies });
}

export interface DispatchProblem {
  resourceId: string | null;
  vehicleGroupId: string | null;
  problem: string;
}

/**
 * Checks every member of the chosen vehicle groups before anything changes; any problem rejects
 * the whole dispatch.
 */
function dispatchProblems(s: State, feature: Feature, input: { commitId: string; vehicleGroupIds: string[]; disabledPolicies: string[] }, env: Env): DispatchProblem[] {
  const vehicleGroupIds = input.vehicleGroupIds;
  const problems: DispatchProblem[] = [];
  const seen = new Set<string>();
  for (const id of vehicleGroupIds) {
    const g = s.vehicleGroups[id];
    if (!g) {
      problems.push({ resourceId: null, vehicleGroupId: id, problem: 'vehicle group does not exist' });
      continue;
    }
    if (g.status !== 'ACTIVE') problems.push({ resourceId: null, vehicleGroupId: id, problem: 'vehicle group is archived' });
    if (g.workspaceId !== feature.workspaceId) problems.push({ resourceId: null, vehicleGroupId: id, problem: 'vehicle group belongs to another workspace' });
    if (g.groupId !== feature.groupId) problems.push({ resourceId: null, vehicleGroupId: id, problem: 'vehicle group serves another business group' });
    if (g.purpose === 'PRODUCTION' || g.env === 'production') problems.push({ resourceId: null, vehicleGroupId: id, problem: 'Features never go to production vehicles' });
    if (g.env !== env) problems.push({ resourceId: null, vehicleGroupId: id, problem: 'all vehicle groups of one dispatch share an environment' });
    const members = membersOf(s, id);
    if (members.length === 0) problems.push({ resourceId: null, vehicleGroupId: id, problem: 'vehicle group has no vehicles' });
    for (const rid of members) {
      if (seen.has(rid)) continue;
      seen.add(rid);
      for (const problem of vehicleDispatchProblems(s, feature, input.commitId, g, s.resources[rid]!, input.disabledPolicies)) {
        problems.push({ resourceId: rid, vehicleGroupId: id, problem });
      }
    }
  }
  return problems;
}

/** Why one member of a vehicle group cannot take a Feature commit now (empty when it can). */
export function vehicleDispatchProblems(s: State, feature: Feature, commitId: string, g: VehicleGroup, r: Resource, disabledPolicies: string[]): string[] {
  const problems: string[] = [];
  if (r.env !== g.env) problems.push(`vehicle environment ${r.env} differs from the group`);
  if (r.env === 'production') problems.push('production vehicle');
  if (r.status !== 'AVAILABLE') problems.push(`vehicle is ${r.status.toLowerCase()}`);
  if (r.vehicleModelId !== feature.vehicleModelId) problems.push(`vehicle model ${r.vehicleModelId} differs from the Feature`);
  if (!(s.workspaceResources[feature.workspaceId] ?? []).includes(r.id)) problems.push('vehicle is not assigned to the workspace');
  const pending = pendingDeploymentOf(s, r.id);
  if (pending) problems.push(`vehicle is waiting for deployment ${pending}`);
  if (pendingImageChangeOf(s, r.id)) problems.push('waiting for an image change');
  if (pendingSoftwareUpdateOf(s, r.id)) problems.push('waiting for a software update');
  const target = featureTarget(s, feature, commitId, g, r, disabledPolicies);
  if (target.problem) problems.push(target.problem);
  return problems;
}

type DispatchInput = { commitId: string; vehicleGroupIds: string[]; disabledPolicies?: string[] };

/**
 * Business development or testing publishes the Feature's head commit to vehicle groups. Each
 * vehicle runs its own base plus the commit; vehicles on different bases get separate dispatches.
 */
export function dispatchFeature(ctx: Ctx, featureId: string, input: DispatchInput): string[] {
  return dispatchChecked(ctx, featureId, input, 'feature.dispatch', null);
}

/** Authorization, stage and per-vehicle checks shared by dispatches and team test requests. */
function checkDispatch(ctx: Ctx, featureId: string, input: DispatchInput, action: 'feature.dispatch' | 'feature.requestTest'): Feature {
  const groups = input.vehicleGroupIds.map((id) => ctx.s.vehicleGroups[id]).filter(Boolean);
  if (groups.length === 0) throw rule('NO_VEHICLE_GROUPS', 'choose at least one vehicle group');
  const env = groups[0]!.env;
  const feature = ctx.s.features[featureId];
  if (!feature) throw notFound('feature', featureId);
  const group = getGroup(ctx.s, feature.groupId);
  ctx.allow(action, { type: 'feature', id: featureId, workspaceId: feature.workspaceId, groupId: group.id, scope: group.domain, env });
  if (!['DCL_READY', 'TESTING', 'VERIFIED'].includes(feature.stage)) throw rule('NOT_DCL_READY', 'only DCL Ready Features can be dispatched');
  if (input.commitId !== feature.headCommitId) throw rule('STALE_COMMIT', 'the Feature has a newer commit; dispatch that one', { headCommitId: feature.headCommitId });
  // Switches turn off other business groups' policies; a group's own policies change only by commit.
  const notSwitchable = (input.disabledPolicies ?? []).filter((p) => !ctx.s.policyOwners[p] || ctx.s.policyOwners[p] === feature.groupId);
  if (notSwitchable.length) throw rule('POLICY_NOT_SWITCHABLE', 'only policies of other business groups can be switched off', { issues: notSwitchable });
  const problems = dispatchProblems(ctx.s, feature, { ...input, disabledPolicies: input.disabledPolicies ?? [] }, env);
  if (problems.length) throw rule('DISPATCH_BLOCKED', 'the dispatch would not reach every vehicle safely', { issues: problems.map((p) => `${p.resourceId ?? p.vehicleGroupId}: ${p.problem}`) });
  return feature;
}

function dispatchChecked(ctx: Ctx, featureId: string, input: DispatchInput, action: 'feature.dispatch', approvedRequest: string | null): string[] {
  const feature = checkDispatch(ctx, featureId, input, action);
  if (!approvedRequest) {
    const gated = input.vehicleGroupIds.map((id) => ctx.s.vehicleGroups[id]!).filter((g) => g.requiresApproval);
    if (gated.length) throw rule('APPROVAL_REQUIRED', 'these vehicle groups take approved team test requests', { issues: gated.map((g) => g.name) });
  }
  const disabled = [...new Set(input.disabledPolicies ?? [])].sort();

  // Each vehicle's configuration: its base plus the commit. One dispatch per distinct configuration.
  const byConfig = new Map<string, { vehicleGroupIds: Set<string>; targets: DeploymentTarget[] }>();
  const seen = new Set<string>();
  for (const vgId of input.vehicleGroupIds) {
    const group = ctx.s.vehicleGroups[vgId]!;
    recordGroupBinding(ctx, vgId, { kind: 'FEATURE', featureId: feature.id, commitId: input.commitId, disabledPolicies: disabled });
    for (const rid of membersOf(ctx.s, vgId)) {
      if (seen.has(rid)) continue;
      seen.add(rid);
      const r = ctx.s.resources[rid]!;
      // An explicit dispatch covers the vehicle: it no longer waits to follow the group.
      delete ctx.s.groupFollows[rid];
      const configId = resolveFeatureConfig(ctx, feature, input.commitId, group, r, disabled);
      const entry = byConfig.get(configId) ?? { vehicleGroupIds: new Set<string>(), targets: [] };
      entry.vehicleGroupIds.add(vgId);
      entry.targets.push(newTarget(ctx, r, vgId));
      byConfig.set(configId, entry);
    }
  }
  const ids: string[] = [];
  const env = ctx.s.vehicleGroups[input.vehicleGroupIds[0]!]!.env;
  for (const [configId, entry] of byConfig) {
    ids.push(createFeatureDeployment(ctx, feature, input.commitId, configId, env, [...entry.vehicleGroupIds], entry.targets, 'DISPATCH', ctx.user().username));
  }
  const f = ctx.s.features[featureId]!;
  if (f.stage === 'DCL_READY' || f.stage === 'VERIFIED') {
    f.stage = 'TESTING';
    f.updatedAt = ctx.now;
  }
  return ids;
}

/** A pending target: dispatched (下发), not yet pushed to the vehicle. */
export function newTarget(ctx: Ctx, r: Resource, vehicleGroupId: string | null): DeploymentTarget {
  return { resourceId: r.id, vehicleGroupId, attempt: 0, status: 'PENDING', previousConfigId: r.appliedConfigId, error: null, updatedAt: ctx.now, pushedAt: null, history: [] };
}

/** The configuration one vehicle runs for a Feature commit published to its group (created if new). */
export function resolveFeatureConfig(ctx: Ctx, feature: Feature, commitId: string, group: VehicleGroup, r: Resource, disabled: string[]): string {
  const target = featureTarget(ctx.s, feature, commitId, group, r, disabled);
  return resolveConfig(ctx, {
    vehicleModelId: feature.vehicleModelId,
    kind: 'FEATURE',
    sourceId: feature.id,
    baseReleaseId: target.baseReleaseId,
    groups: target.groups,
    disabledPolicies: target.disabledPolicies,
    label: featureLabel(ctx.s, feature, commitId, target),
  });
}

/**
 * Records one Feature deployment of a configuration. Every target joins the vehicles this commit
 * must be verified on, through its latest deployment.
 */
export function createFeatureDeployment(
  ctx: Ctx,
  feature: Feature,
  commitId: string,
  configId: string,
  env: Env,
  vehicleGroupIds: string[],
  targets: DeploymentTarget[],
  trigger: Deployment['trigger'],
  dispatchedBy: string,
): string {
  const id = newId('dp');
  for (const t of targets) {
    const existing = ctx.s.testTargets.find((x) => x.subjectId === feature.id && x.versionId === commitId && x.resourceId === t.resourceId);
    if (existing) existing.deploymentId = id;
    else ctx.s.testTargets.push({ subjectKind: 'FEATURE', subjectId: feature.id, versionId: commitId, resourceId: t.resourceId, deploymentId: id });
  }
  ctx.s.deployments[id] = {
    id,
    kind: 'FEATURE',
    workspaceId: feature.workspaceId,
    groupId: feature.groupId,
    subjectId: feature.id,
    commitId,
    resolvedConfigId: configId,
    env,
    status: 'PENDING',
    vehicleGroupIds,
    targets,
    trigger,
    dispatchedBy,
    createdAt: ctx.now,
    updatedAt: ctx.now,
  };
  return id;
}

function settle(d: Draft<Deployment>, now: string): void {
  // A failed vehicle pauses a rollout; nothing further is sent until it is resumed.
  if (d.kind === 'OTA' && d.status === 'PENDING' && d.targets.some((t) => t.status === 'FAILED')) {
    d.status = 'PAUSED';
    d.pauseReason = null; // paused by the failure itself, not by a person
  }
  if (d.status === 'PENDING' && d.targets.every((t) => t.status !== 'PENDING' && t.status !== 'QUEUED')) {
    d.status = 'COMPLETED';
  }
  d.updatedAt = now;
}

/** Cancels the pending targets of a Feature dispatch. Vehicle group bindings stay. */
// ---------------------------------------------------------------------------
// Team test requests (团队测试申请): fixed commit + vehicle list, approved by the workspace admin
// ---------------------------------------------------------------------------

export function requestTeamTest(ctx: Ctx, featureId: string, input: DispatchInput & { goal: string }): string {
  const feature = checkDispatch(ctx, featureId, input, 'feature.requestTest');
  if (!input.goal.trim()) throw rule('GOAL_REQUIRED', 'say what the team test should show');
  const id = newId('tq');
  ctx.s.testRequests[id] = {
    id,
    workspaceId: feature.workspaceId,
    featureId: feature.id,
    commitId: input.commitId,
    vehicleGroupIds: [...input.vehicleGroupIds],
    members: requestMembers(ctx.s, input.vehicleGroupIds),
    disabledPolicies: [...new Set(input.disabledPolicies ?? [])].sort(),
    goal: input.goal.trim(),
    status: 'PENDING',
    requestedBy: ctx.user().username,
    requestedAt: ctx.now,
    decidedBy: null,
    decidedAt: null,
    decisionNote: null,
    deploymentIds: [],
  };
  return id;
}

function requestMembers(s: State, vehicleGroupIds: string[]): string[] {
  return [...new Set(vehicleGroupIds.flatMap((g) => membersOf(s, g)))].sort();
}

function getRequest(s: State, id: string): TestRequest {
  const r = s.testRequests[id];
  if (!r) throw notFound('test request', id);
  return r;
}

/** The workspace admin approves or rejects; never their own request. */
export function decideTestRequest(ctx: Ctx, requestId: string, input: { decision: 'APPROVED' | 'REJECTED'; note: string }): void {
  const req = getRequest(ctx.s, requestId);
  const env = ctx.s.vehicleGroups[req.vehicleGroupIds[0]!]?.env ?? 'development';
  ctx.allow('testRequest.decide', { type: 'testRequest', id: req.id, workspaceId: req.workspaceId, env });
  if (req.status !== 'PENDING') throw rule('REQUEST_DECIDED', 'the request is already decided');
  if (req.requestedBy === ctx.user().username) throw rule('SELF_APPROVAL', 'nobody decides their own request');
  if (input.decision === 'APPROVED' && requestMembers(ctx.s, req.vehicleGroupIds).join() !== req.members.join()) {
    throw rule('MEMBERS_CHANGED', 'the vehicle list changed since the request; ask for a new request');
  }
  if (!input.note.trim()) throw rule('REASON_REQUIRED', 'give a reason');
  const draft = ctx.s.testRequests[req.id]!;
  draft.status = input.decision;
  draft.decidedBy = ctx.user().username;
  draft.decidedAt = ctx.now;
  draft.decisionNote = input.note.trim();
}

/** Carries out an approved request once; version, members, environment and occupancy are checked again. */
export function executeTestRequest(ctx: Ctx, requestId: string): string[] {
  const req = getRequest(ctx.s, requestId);
  if (req.status === 'EXECUTED') throw rule('REQUEST_USED', 'an approval is used once; ask again for another test');
  if (req.status !== 'APPROVED') throw rule('REQUEST_NOT_APPROVED', 'the request is not approved');
  if (requestMembers(ctx.s, req.vehicleGroupIds).join() !== req.members.join()) {
    throw rule('MEMBERS_CHANGED', 'the vehicle list changed since the approval; ask for a new request');
  }
  const deploymentIds = dispatchChecked(ctx, req.featureId, { commitId: req.commitId, vehicleGroupIds: req.vehicleGroupIds, disabledPolicies: req.disabledPolicies }, 'feature.dispatch', req.id);
  const draft = ctx.s.testRequests[req.id]!;
  draft.status = 'EXECUTED';
  draft.deploymentIds = deploymentIds;
  return deploymentIds;
}

export function withdrawTestRequest(ctx: Ctx, requestId: string): void {
  const req = getRequest(ctx.s, requestId);
  if (req.requestedBy !== ctx.user().username) throw rule('NOT_YOUR_REQUEST', 'only the requester withdraws a request');
  if (req.status !== 'PENDING' && req.status !== 'APPROVED') throw rule('REQUEST_DECIDED', 'the request is closed');
  ctx.s.testRequests[req.id]!.status = 'WITHDRAWN';
}

export function testRequestsOf(s: State, workspaceId: string): TestRequest[] {
  return Object.values(s.testRequests)
    .filter((r) => r.workspaceId === workspaceId)
    .sort((a, b) => b.id.localeCompare(a.id));
}

export function cancelDeployment(ctx: Ctx, deploymentId: string, reason: string): void {
  const d = ctx.s.deployments[deploymentId];
  if (!d) throw notFound('deployment', deploymentId);
  if (d.kind === 'OTA') throw rule('USE_ROLLOUT_CONTROLS', 'use the rollout controls for this deployment');
  if (d.kind === 'FEATURE') {
    const group = getGroup(ctx.s, d.groupId!);
    ctx.allow('feature.dispatch', { type: 'deployment', id: d.id, workspaceId: d.workspaceId, groupId: group.id, scope: group.domain, env: d.env });
  } else if (d.kind === 'APPLICABILITY') {
    ctx.allow('applicability.dispatch', { type: 'deployment', id: d.id, workspaceId: d.workspaceId, scope: 'Vehicle' });
  } else if (d.kind === 'PERSONAL') {
    authorizePersonal(ctx, getResource(ctx.s, d.subjectId));
  } else {
    ctx.allow('candidate.dispatch', { type: 'deployment', id: d.id, workspaceId: d.workspaceId, scope: ctx.s.candidates[d.subjectId]?.scope ?? 'Vehicle' });
  }
  if (!reason.trim()) throw rule('REASON_REQUIRED', 'give a reason');
  if (d.status !== 'PENDING') throw rule('NOT_PENDING', 'the deployment is not pending');
  for (const t of d.targets) {
    if (t.status === 'PENDING') {
      t.status = 'CANCELLED';
      t.error = reason.trim();
      t.updatedAt = ctx.now;
    }
  }
  d.status = 'CANCELLED';
  d.updatedAt = ctx.now;
}

/**
 * A receipt from a vehicle (system context). The real system verifies a device signature over
 * the payload; the prototype's simulator is the only sender. An identical replay is accepted
 * without effect; a contradicting or stale receipt is rejected.
 */
export function acceptReceipt(
  ctx: Ctx,
  input: { deploymentId: string; resourceId: string; attempt: number; result: 'APPLIED' | 'FAILED'; error?: string },
): 'ACCEPTED' | 'REPLAYED' {
  const d = ctx.s.deployments[input.deploymentId];
  if (!d) throw notFound('deployment', input.deploymentId);
  const t = d.targets.find((x) => x.resourceId === input.resourceId);
  if (!t) throw notFound('deployment target', input.resourceId);
  const prior = ctx.s.receipts.find((r) => r.deploymentId === d.id && r.resourceId === t.resourceId && r.attempt === input.attempt);
  if (prior) {
    if (prior.result === input.result) return 'REPLAYED';
    throw rule('RECEIPT_CONFLICT', 'a different receipt was already recorded for this attempt');
  }
  const vehicle = ctx.s.resources[t.resourceId]!;
  if (vehicle.instance === 'STOPPED') throw rule('SIMULATION_STOPPED', `${vehicle.id} is stopped and cannot apply configurations`);
  if (input.attempt !== t.attempt) throw rule('STALE_ATTEMPT', `receipt for attempt ${input.attempt}; the current attempt is ${t.attempt}`);
  if (t.status !== 'PENDING') throw rule('TARGET_NOT_PENDING', 'the target is not waiting for a receipt');
  // A pause holds every vehicle at its confirmed configuration until an explicit resume. A vehicle
  // that had already started keeps its receipt and sends it again after the resume.
  if (d.status === 'PAUSED') throw rule('OTA_PAUSED', 'the rollout is paused; the vehicle reports again after it is resumed');
  ctx.s.receipts.push({ id: newId('rx'), deploymentId: d.id, resourceId: t.resourceId, attempt: t.attempt, result: input.result, error: input.error ?? null, receivedAt: ctx.now });
  // A receipt shows the vehicle had the configuration, pushed or not.
  t.pushedAt ??= ctx.now;
  t.status = input.result;
  t.error = input.result === 'FAILED' ? (input.error ?? 'apply failed') : null;
  t.updatedAt = ctx.now;
  const r = ctx.s.resources[t.resourceId]!;
  if (input.result === 'APPLIED') {
    r.appliedConfigId = d.resolvedConfigId;
    r.updatedAt = ctx.now;
  }
  settle(d, ctx.now);
  return 'ACCEPTED';
}

// ---------------------------------------------------------------------------
// Tests and Verified
// ---------------------------------------------------------------------------

export interface TargetStatus {
  resourceId: string;
  deploymentId: string;
  /** The vehicle is actually running this commit's configuration. */
  applied: boolean;
  /** The newest result on the vehicle's current image: the one that counts. */
  latest: TestRun | null;
  /** A newer result from an earlier image, kept as history; it no longer counts. */
  stale: TestRun | null;
}

/**
 * Whether a result still speaks for the vehicle's current software. A simulation's result counts
 * on the image it ran on. A physical vehicle's Feature result from an earlier software version
 * counts when the vehicle keeps the base it ran on and every policy of the commit can run on the
 * new software; candidate and applicability results name their software and never carry over.
 */
export function stillCounts(s: State, x: TestRun, r: Resource): boolean {
  if (x.imageId !== r.imageId) return false;
  if (x.integrationVersion === r.integrationVersion) return true;
  if (x.subjectKind !== 'FEATURE' || r.type !== 'PHYSICAL' || !r.integrationVersion) return false;
  const ran = s.resolvedConfigs[x.resolvedConfigId];
  const g = s.groupMembers[r.id] ? s.vehicleGroups[s.groupMembers[r.id]!] : undefined;
  const base = vehicleBase(s, g?.baseReleaseId ?? null, r);
  if (!ran || base.problem || (base.release?.id ?? null) !== ran.baseReleaseId) return false;
  const manifest = s.softwareVersions[softwareKey(r.vehicleModelId, r.integrationVersion)]?.manifest ?? null;
  if (!manifest) return false;
  const snapshot = commitSnapshot(s, x.versionId);
  const files = resolveFiles(s, snapshot);
  return Object.entries(snapshot.policies).every(([id, p]) => policyCompatibility(id, p, files, manifest).status === 'OK');
}

/** Results of a subject on a vehicle that count: those on the software it runs now. */
function currentRuns(s: State, subjectId: string, versionId: string, resourceId: string): { current: TestRun[]; earlier: TestRun[] } {
  const r = s.resources[resourceId]!;
  const runs = s.testRuns.filter((x) => x.subjectId === subjectId && x.versionId === versionId && x.resourceId === resourceId).sort((a, b) => b.seq - a.seq);
  return { current: runs.filter((x) => stillCounts(s, x, r)), earlier: runs.filter((x) => !stillCounts(s, x, r)) };
}

export function testStatusFor(s: State, subjectId: string, versionId: string): TargetStatus[] {
  return s.testTargets
    .filter((t) => t.subjectId === subjectId && t.versionId === versionId)
    .map((t) => {
      const d = s.deployments[t.deploymentId]!;
      const r = s.resources[t.resourceId]!;
      const applied = r.appliedConfigId === d.resolvedConfigId;
      const { current, earlier } = currentRuns(s, subjectId, versionId, t.resourceId);
      const latest = current[0] ?? null;
      const stale = earlier[0] && (!latest || earlier[0].seq > latest.seq) ? earlier[0] : null;
      return { resourceId: t.resourceId, deploymentId: t.deploymentId, applied, latest, stale };
    });
}

/** Vehicles the Feature's head commit must be verified on, with their latest results. */
export function featureTestStatus(s: State, feature: Feature): TargetStatus[] {
  return feature.headCommitId ? testStatusFor(s, feature.id, feature.headCommitId) : [];
}

/** Why the head commit cannot be verified yet; empty when it can. */
export function verifyBlockers(s: State, feature: Feature): string[] {
  return blockersFor(s, featureTestStatus(s, feature));
}

export function blockersFor(s: State, status: TargetStatus[]): string[] {
  const blockers: string[] = [];
  if (status.length === 0) blockers.push('no vehicles were dispatched for this commit');
  for (const t of status) {
    if (t.latest?.result === 'PASS') continue;
    const r = s.resources[t.resourceId]!;
    const reason = r.type === 'SIMULATION' ? 'runs another image since its test' : 'runs other software since its test';
    blockers.push(t.stale ? `${t.resourceId} ${reason}; test it again` : `${t.resourceId} has no passing test`);
  }
  const types = new Set(status.filter((t) => t.latest?.result === 'PASS').map((t) => s.resources[t.resourceId]!.type));
  if (!types.has('SIMULATION')) blockers.push('a simulation test must pass');
  if (!types.has('PHYSICAL')) blockers.push('a physical vehicle test must pass');
  return blockers;
}

export function assertSimulationFirst(s: State, subjectId: string, versionId: string, resourceType: string, result: string): void {
  if (resourceType !== 'PHYSICAL' || result !== 'PASS') return;
  // A simulation result counts only on the image the simulation still runs.
  const simPass = s.testRuns.some(
    (x) => x.subjectId === subjectId && x.versionId === versionId && x.resourceType === 'SIMULATION' && x.result === 'PASS' && x.imageId === s.resources[x.resourceId]?.imageId,
  );
  if (!simPass) throw rule('SIMULATION_FIRST', 'a simulation test must pass before a physical one');
}

/** Business testing records a result for the head commit on a vehicle that actually applied it. */
export function recordFeatureTest(
  ctx: Ctx,
  featureId: string,
  input: { commitId: string; resourceId: string; result: 'PASS' | 'FAIL'; summary: string; evidenceUri?: string },
): string {
  const feature = ctx.s.features[featureId];
  if (!feature) throw notFound('feature', featureId);
  const r = getResource(ctx.s, input.resourceId);
  const group = getGroup(ctx.s, feature.groupId);
  ctx.allow('feature.recordTest', { type: 'feature', id: featureId, workspaceId: feature.workspaceId, groupId: group.id, scope: group.domain, env: r.env });
  if (feature.stage !== 'TESTING') throw rule('NOT_TESTING', 'the Feature is not in testing');
  if (input.commitId !== feature.headCommitId) throw rule('STALE_COMMIT', 'results can only be recorded for the head commit');
  const target = featureTestStatus(ctx.s, feature).find((t) => t.resourceId === r.id);
  if (!target) throw rule('NOT_A_TEST_TARGET', `vehicle ${r.id} was not dispatched this commit`);
  if (!target.applied) throw rule('NOT_APPLIED', `vehicle ${r.id} has not confirmed applying this configuration`);
  if (!input.summary.trim()) throw rule('SUMMARY_REQUIRED', 'describe what was tested');
  assertSimulationFirst(ctx.s, featureId, input.commitId, r.type, input.result);
  const id = newId('tr');
  ctx.s.testRuns.push({
    id,
    seq: ctx.seq(),
    subjectKind: 'FEATURE',
    subjectId: featureId,
    versionId: input.commitId,
    resourceId: r.id,
    resourceType: r.type,
    integrationVersion: r.integrationVersion,
    imageId: r.imageId,
    env: r.env,
    resolvedConfigId: r.appliedConfigId!,
    result: input.result,
    summary: input.summary.trim(),
    evidenceUri: input.evidenceUri?.trim() || null,
    tester: ctx.user().username,
    createdAt: ctx.now,
  });
  return id;
}

/** Business testing confirms Verified: every target passed, simulation and physical. */
export function verifyFeature(ctx: Ctx, featureId: string): void {
  const { feature } = authorizeFeature(ctx, 'feature.verify', featureId);
  if (feature.stage !== 'TESTING') throw rule('NOT_TESTING', 'the Feature is not in testing');
  const blockers = verifyBlockers(ctx.s, feature);
  if (blockers.length) throw rule('VERIFY_BLOCKED', 'the commit cannot be verified yet', { issues: blockers });
  feature.stage = 'VERIFIED';
  feature.verifiedCommitId = feature.headCommitId;
  feature.updatedAt = ctx.now;
}

export function deploymentsOf(s: State, subjectId: string): Deployment[] {
  return Object.values(s.deployments)
    .filter((d) => d.subjectId === subjectId)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

// ---------------------------------------------------------------------------
// Integration candidates
// ---------------------------------------------------------------------------

export function getCandidate(s: State, id: string): Candidate {
  const c = s.candidates[id];
  if (!c) throw notFound('candidate', id);
  return c;
}

export function candidateTestStatus(s: State, c: Candidate): TargetStatus[] {
  return testStatusFor(s, c.id, c.id);
}

export function candidateVerifyBlockers(s: State, c: Candidate): string[] {
  return blockersFor(s, candidateTestStatus(s, c));
}

/** Why one vehicle cannot take a candidate's integration test now; empty if it can. */
export function candidateVehicleProblems(s: State, c: Candidate, rid: string): string[] {
  const r = s.resources[rid]!;
  const problems: string[] = [];
  if (r.env !== 'testing') problems.push(`${rid}: not a testing vehicle`);
  if (r.status !== 'AVAILABLE') problems.push(`${rid}: ${r.status.toLowerCase()}`);
  if (r.vehicleModelId !== c.vehicleModelId) problems.push(`${rid}: another vehicle model`);
  // A candidate on a formal baseline is tested on vehicles whose software is known.
  if (c.targetReleaseId !== null && !r.integrationVersion) problems.push(`${rid}: software version unknown`);
  const pending = pendingDeploymentOf(s, rid);
  if (pending) problems.push(`${rid}: waiting for deployment ${pending}`);
  if (pendingImageChangeOf(s, rid)) problems.push(`${rid}: waiting for an image change`);
  // Integration tests name real software versions; a derived development image is not one.
  if (r.imageId && s.images[r.imageId]?.derived) problems.push(`${rid}: runs a derived development image`);
  return problems;
}

/**
 * Integration testing dispatches a frozen candidate to testing vehicle groups of the integration
 * workspace, or to its testing vehicles that route through no group.
 */
export function dispatchCandidate(ctx: Ctx, candidateId: string, input: { vehicleGroupIds?: string[]; resourceIds?: string[] }): string {
  const c = getCandidate(ctx.s, candidateId);
  ctx.allow('candidate.dispatch', { type: 'candidate', id: c.id, workspaceId: c.testWorkspaceId, scope: c.scope });
  if (!['CANDIDATE', 'TESTING', 'VERIFIED'].includes(c.status)) throw rule('CANDIDATE_CLOSED', 'the candidate is closed');
  const vehicleGroupIds = input.vehicleGroupIds ?? [];
  const direct = input.resourceIds ?? [];
  if (vehicleGroupIds.length === 0 && direct.length === 0) throw rule('NO_VEHICLE_GROUPS', 'choose vehicle groups or ungrouped vehicles');
  const problems: string[] = directTargetProblems(ctx.s, c.testWorkspaceId, direct);
  const members: { resourceId: string; vehicleGroupId: string | null }[] = [];
  const checkVehicle = (rid: string, vehicleGroupId: string | null) => {
    if (members.some((m) => m.resourceId === rid)) return;
    problems.push(...candidateVehicleProblems(ctx.s, c, rid));
    members.push({ resourceId: rid, vehicleGroupId });
  };
  for (const id of vehicleGroupIds) {
    const g = ctx.s.vehicleGroups[id];
    if (!g) {
      problems.push(`${id}: vehicle group does not exist`);
      continue;
    }
    if (g.status !== 'ACTIVE') problems.push(`${g.name}: archived`);
    if (g.workspaceId !== c.testWorkspaceId) problems.push(`${g.name}: not in the integration workspace`);
    // Candidates only go to the testing pool.
    if (g.purpose !== 'TEST' || g.env !== 'testing') problems.push(`${g.name}: candidates only go to testing vehicle groups`);
    const list = membersOf(ctx.s, id);
    if (list.length === 0) problems.push(`${g.name}: no vehicles`);
    for (const rid of list) checkVehicle(rid, id);
  }
  if (problems.length === 0) for (const rid of direct) checkVehicle(rid, null);
  if (problems.length) throw rule('DISPATCH_BLOCKED', 'the dispatch would not reach every vehicle safely', { issues: problems });
  const id = newId('dp');
  for (const vgId of vehicleGroupIds) recordGroupBinding(ctx, vgId, { kind: 'CANDIDATE', candidateId: c.id, configId: c.resolvedConfigId });
  for (const m of members) {
    delete ctx.s.groupFollows[m.resourceId];
    if (!ctx.s.testTargets.some((t) => t.subjectId === c.id && t.resourceId === m.resourceId)) {
      ctx.s.testTargets.push({ subjectKind: 'CANDIDATE', subjectId: c.id, versionId: c.id, resourceId: m.resourceId, deploymentId: id });
    }
  }
  ctx.s.deployments[id] = {
    id,
    kind: 'CANDIDATE',
    workspaceId: c.testWorkspaceId,
    groupId: null,
    subjectId: c.id,
    commitId: null,
    resolvedConfigId: c.resolvedConfigId,
    env: 'testing',
    status: 'PENDING',
    vehicleGroupIds: [...vehicleGroupIds],
    targets: members.map((m) => ({
      resourceId: m.resourceId,
      vehicleGroupId: m.vehicleGroupId,
      attempt: 0,
      status: 'PENDING' as const,
      previousConfigId: ctx.s.resources[m.resourceId]!.appliedConfigId,
      error: null,
      updatedAt: ctx.now,
      pushedAt: null,
      history: [],
    })),
    trigger: 'DISPATCH',
    dispatchedBy: ctx.user().username,
    createdAt: ctx.now,
    updatedAt: ctx.now,
  };
  ctx.s.candidates[c.id]!.status = 'TESTING';
  return id;
}

export function recordCandidateTest(
  ctx: Ctx,
  candidateId: string,
  input: { resourceId: string; result: 'PASS' | 'FAIL'; summary: string; evidenceUri?: string },
): string {
  const c = getCandidate(ctx.s, candidateId);
  const r = getResource(ctx.s, input.resourceId);
  ctx.allow('candidate.recordTest', { type: 'candidate', id: c.id, workspaceId: c.testWorkspaceId, scope: c.scope, env: r.env });
  if (c.status !== 'TESTING') throw rule('NOT_TESTING', 'the candidate is not in testing');
  const target = candidateTestStatus(ctx.s, c).find((t) => t.resourceId === r.id);
  if (!target) throw rule('NOT_A_TEST_TARGET', `vehicle ${r.id} was not dispatched this candidate`);
  if (!target.applied) throw rule('NOT_APPLIED', `vehicle ${r.id} has not confirmed applying this candidate`);
  if (!input.summary.trim()) throw rule('SUMMARY_REQUIRED', 'describe what was tested');
  assertSimulationFirst(ctx.s, c.id, c.id, r.type, input.result);
  const id = newId('tr');
  ctx.s.testRuns.push({
    id,
    seq: ctx.seq(),
    subjectKind: 'CANDIDATE',
    subjectId: c.id,
    versionId: c.id,
    resourceId: r.id,
    resourceType: r.type,
    integrationVersion: r.integrationVersion,
    imageId: r.imageId,
    env: r.env,
    resolvedConfigId: c.resolvedConfigId,
    result: input.result,
    summary: input.summary.trim(),
    evidenceUri: input.evidenceUri?.trim() || null,
    tester: ctx.user().username,
    createdAt: ctx.now,
  });
  return id;
}

/** Independent integration testing confirms the candidate: every target passed. */
export function verifyCandidate(ctx: Ctx, candidateId: string): void {
  const c = getCandidate(ctx.s, candidateId);
  ctx.allow('candidate.verify', { type: 'candidate', id: c.id, workspaceId: c.testWorkspaceId, scope: c.scope });
  if (c.status !== 'TESTING') throw rule('NOT_TESTING', 'the candidate is not in testing');
  const blockers = candidateVerifyBlockers(ctx.s, c);
  if (blockers.length) throw rule('VERIFY_BLOCKED', 'the candidate cannot be verified yet', { issues: blockers });
  const draft = ctx.s.candidates[c.id]!;
  draft.status = 'VERIFIED';
  draft.verifiedBy = ctx.user().username;
  draft.verifiedAt = ctx.now;
}
