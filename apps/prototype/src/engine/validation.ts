// Validation (测试验证): dispatching a fixed configuration to vehicle groups, receipts from the
// vehicles, test evidence and Verified. Creating a dispatch only changes what vehicles should
// run; only an APPLIED receipt changes what they actually run.

import type { Draft } from 'immer';
import { digestOf } from '../domain/canonical.ts';
import { notFound, rule } from '../domain/errors.ts';
import { newId } from '../domain/ids.ts';
import type { Env } from '../domain/vocabulary.ts';
import { authorizeFeature, displayName } from './config.ts';
import type { Ctx } from './engine.ts';
import { getResource, membersOf, pendingDeploymentOf, recordGroupBinding } from './fleet.ts';
import { getGroup } from './org.ts';
import type { Candidate, Deployment, DeploymentTarget, Feature, ResolvedConfig, State, TestRun } from './types.ts';

/** Finds or creates the resolved configuration for a base plus group commits. */
export function resolveConfig(
  ctx: Ctx,
  input: { vehicleModelId: string; kind: ResolvedConfig['kind']; sourceId: string; baseReleaseId: string | null; groups: Record<string, string>; label: string },
): string {
  const pairs = Object.keys(input.groups)
    .sort()
    .map((g) => [g, ctx.s.commits[input.groups[g]!]!.digest]);
  const digest = digestOf({ vehicleModelId: input.vehicleModelId, baseReleaseId: input.baseReleaseId, kind: input.kind, sourceId: input.sourceId, groups: pairs });
  const existing = Object.values(ctx.s.resolvedConfigs).find((c) => c.digest === digest);
  if (existing) return existing.id;
  const id = newId('rc');
  ctx.s.resolvedConfigs[id] = { id, ...input, groups: { ...input.groups }, digest, createdAt: ctx.now };
  return id;
}

/** The Feature's head commit on top of its base: what a test vehicle runs. */
export function featureConfig(ctx: Ctx, feature: Feature): string {
  const base = feature.baseReleaseId ? ctx.s.releases[feature.baseReleaseId]!.groups : {};
  return resolveConfig(ctx, {
    vehicleModelId: feature.vehicleModelId,
    kind: 'FEATURE',
    sourceId: feature.id,
    baseReleaseId: feature.baseReleaseId,
    groups: { ...base, [feature.groupId]: feature.headCommitId! },
    label: displayName(ctx.s, feature.headCommitId!),
  });
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
function dispatchProblems(s: State, feature: Feature, vehicleGroupIds: string[], env: Env): DispatchProblem[] {
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
      const r = s.resources[rid]!;
      const fail = (problem: string) => problems.push({ resourceId: rid, vehicleGroupId: id, problem });
      if (r.env !== g.env) fail(`vehicle environment ${r.env} differs from the group`);
      if (r.env === 'production') fail('production vehicle');
      if (r.status !== 'AVAILABLE') fail(`vehicle is ${r.status.toLowerCase()}`);
      if (r.vehicleModelId !== feature.vehicleModelId) fail(`vehicle model ${r.vehicleModelId} differs from the Feature`);
      if (!(s.workspaceResources[feature.workspaceId] ?? []).includes(rid)) fail('vehicle is not assigned to the workspace');
      const pending = pendingDeploymentOf(s, rid);
      if (pending) fail(`vehicle is waiting for deployment ${pending}`);
      if (feature.baseReleaseId) {
        const release = s.releases[feature.baseReleaseId]!;
        if (r.integrationVersion !== null && !release.vehicleIntegrationVersions.includes(r.integrationVersion)) {
          fail(`vehicle software ${r.integrationVersion} is not compatible with base ${release.dclVersion}`);
        }
      }
    }
  }
  return problems;
}

/** Business development or testing dispatches the Feature's head commit to vehicle groups. */
export function dispatchFeature(ctx: Ctx, featureId: string, input: { commitId: string; vehicleGroupIds: string[] }): string {
  const groups = input.vehicleGroupIds.map((id) => ctx.s.vehicleGroups[id]).filter(Boolean);
  if (groups.length === 0) throw rule('NO_VEHICLE_GROUPS', 'choose at least one vehicle group');
  const env = groups[0]!.env;
  const feature = ctx.s.features[featureId];
  if (!feature) throw notFound('feature', featureId);
  const group = getGroup(ctx.s, feature.groupId);
  ctx.allow('feature.dispatch', { type: 'feature', id: featureId, workspaceId: feature.workspaceId, groupId: group.id, scope: group.domain, env });
  if (!['DCL_READY', 'TESTING', 'VERIFIED'].includes(feature.stage)) throw rule('NOT_DCL_READY', 'only DCL Ready Features can be dispatched');
  if (input.commitId !== feature.headCommitId) throw rule('STALE_COMMIT', 'the Feature has a newer commit; dispatch that one', { headCommitId: feature.headCommitId });
  const problems = dispatchProblems(ctx.s, feature, input.vehicleGroupIds, env);
  if (problems.length) throw rule('DISPATCH_BLOCKED', 'the dispatch would not reach every vehicle safely', { issues: problems.map((p) => `${p.resourceId ?? p.vehicleGroupId}: ${p.problem}`) });

  const configId = featureConfig(ctx, feature);
  const id = newId('dp');
  const targets: DeploymentTarget[] = [];
  for (const vgId of input.vehicleGroupIds) {
    recordGroupBinding(ctx, vgId, configId);
    for (const rid of membersOf(ctx.s, vgId)) {
      if (targets.some((t) => t.resourceId === rid)) continue;
      targets.push({ resourceId: rid, vehicleGroupId: vgId, attempt: 0, status: 'PENDING', previousConfigId: ctx.s.resources[rid]!.appliedConfigId, error: null, updatedAt: ctx.now, history: [] });
      // Every dispatched member joins the vehicles this commit must be verified on.
      if (!ctx.s.testTargets.some((t) => t.subjectId === feature.id && t.versionId === input.commitId && t.resourceId === rid)) {
        ctx.s.testTargets.push({ subjectKind: 'FEATURE', subjectId: feature.id, versionId: input.commitId, resourceId: rid, deploymentId: id });
      }
    }
  }
  ctx.s.deployments[id] = {
    id,
    kind: 'FEATURE',
    workspaceId: feature.workspaceId,
    groupId: feature.groupId,
    subjectId: feature.id,
    commitId: input.commitId,
    resolvedConfigId: configId,
    env,
    status: 'PENDING',
    vehicleGroupIds: [...input.vehicleGroupIds],
    targets,
    dispatchedBy: ctx.user().username,
    createdAt: ctx.now,
    updatedAt: ctx.now,
  };
  const f = ctx.s.features[featureId]!;
  if (f.stage === 'DCL_READY' || f.stage === 'VERIFIED') {
    f.stage = 'TESTING';
    f.updatedAt = ctx.now;
  }
  return id;
}

function settle(d: Draft<Deployment>, now: string): void {
  if (d.targets.every((t) => t.status !== 'PENDING') && d.status === 'PENDING') {
    d.status = 'COMPLETED';
  }
  d.updatedAt = now;
}

/** Cancels the pending targets of a Feature dispatch. Vehicle group bindings stay. */
export function cancelDeployment(ctx: Ctx, deploymentId: string, reason: string): void {
  const d = ctx.s.deployments[deploymentId];
  if (!d) throw notFound('deployment', deploymentId);
  if (d.kind === 'OTA') throw rule('USE_ROLLOUT_CONTROLS', 'use the rollout controls for this deployment');
  if (d.kind === 'FEATURE') {
    const group = getGroup(ctx.s, d.groupId!);
    ctx.allow('feature.dispatch', { type: 'deployment', id: d.id, workspaceId: d.workspaceId, groupId: group.id, scope: group.domain, env: d.env });
  } else {
    ctx.allow('candidate.dispatch', { type: 'deployment', id: d.id, workspaceId: d.workspaceId, scope: 'Vehicle' });
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
  if (input.attempt !== t.attempt) throw rule('STALE_ATTEMPT', `receipt for attempt ${input.attempt}; the current attempt is ${t.attempt}`);
  if (t.status !== 'PENDING') throw rule('TARGET_NOT_PENDING', 'the target is not waiting for a receipt');
  ctx.s.receipts.push({ id: newId('rx'), deploymentId: d.id, resourceId: t.resourceId, attempt: t.attempt, result: input.result, error: input.error ?? null, receivedAt: ctx.now });
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
  latest: TestRun | null;
}

function testStatusFor(s: State, subjectId: string, versionId: string): TargetStatus[] {
  return s.testTargets
    .filter((t) => t.subjectId === subjectId && t.versionId === versionId)
    .map((t) => {
      const d = s.deployments[t.deploymentId]!;
      const r = s.resources[t.resourceId]!;
      const applied = r.appliedConfigId === d.resolvedConfigId;
      const runs = s.testRuns.filter((x) => x.subjectId === subjectId && x.versionId === versionId && x.resourceId === t.resourceId);
      return { resourceId: t.resourceId, deploymentId: t.deploymentId, applied, latest: runs.sort((a, b) => b.seq - a.seq)[0] ?? null };
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

function blockersFor(s: State, status: TargetStatus[]): string[] {
  const blockers: string[] = [];
  if (status.length === 0) blockers.push('no vehicles were dispatched for this commit');
  for (const t of status) if (t.latest?.result !== 'PASS') blockers.push(`${t.resourceId} has no passing test`);
  const types = new Set(status.filter((t) => t.latest?.result === 'PASS').map((t) => s.resources[t.resourceId]!.type));
  if (!types.has('SIMULATION')) blockers.push('a simulation test must pass');
  if (!types.has('PHYSICAL')) blockers.push('a physical vehicle test must pass');
  return blockers;
}

function assertSimulationFirst(s: State, subjectId: string, versionId: string, resourceType: string, result: string): void {
  if (resourceType !== 'PHYSICAL' || result !== 'PASS') return;
  const simPass = s.testRuns.some((x) => x.subjectId === subjectId && x.versionId === versionId && x.resourceType === 'SIMULATION' && x.result === 'PASS');
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

/** Integration testing dispatches a frozen candidate to testing vehicle groups of the integration workspace. */
export function dispatchCandidate(ctx: Ctx, candidateId: string, input: { vehicleGroupIds: string[] }): string {
  const c = getCandidate(ctx.s, candidateId);
  ctx.allow('candidate.dispatch', { type: 'candidate', id: c.id, workspaceId: c.testWorkspaceId, scope: 'Vehicle' });
  if (!['CANDIDATE', 'TESTING', 'VERIFIED'].includes(c.status)) throw rule('CANDIDATE_CLOSED', 'the candidate is closed');
  if (input.vehicleGroupIds.length === 0) throw rule('NO_VEHICLE_GROUPS', 'choose at least one vehicle group');
  const problems: string[] = [];
  const members: { resourceId: string; vehicleGroupId: string }[] = [];
  for (const id of input.vehicleGroupIds) {
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
    for (const rid of list) {
      if (members.some((m) => m.resourceId === rid)) continue;
      const r = ctx.s.resources[rid]!;
      if (r.env !== 'testing') problems.push(`${rid}: not a testing vehicle`);
      if (r.status !== 'AVAILABLE') problems.push(`${rid}: ${r.status.toLowerCase()}`);
      if (r.vehicleModelId !== c.vehicleModelId) problems.push(`${rid}: another vehicle model`);
      const pending = pendingDeploymentOf(ctx.s, rid);
      if (pending) problems.push(`${rid}: waiting for deployment ${pending}`);
      members.push({ resourceId: rid, vehicleGroupId: id });
    }
  }
  if (problems.length) throw rule('DISPATCH_BLOCKED', 'the dispatch would not reach every vehicle safely', { issues: problems });
  const id = newId('dp');
  for (const vgId of input.vehicleGroupIds) recordGroupBinding(ctx, vgId, c.resolvedConfigId);
  for (const m of members) {
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
    vehicleGroupIds: [...input.vehicleGroupIds],
    targets: members.map((m) => ({
      resourceId: m.resourceId,
      vehicleGroupId: m.vehicleGroupId,
      attempt: 0,
      status: 'PENDING' as const,
      previousConfigId: ctx.s.resources[m.resourceId]!.appliedConfigId,
      error: null,
      updatedAt: ctx.now,
      history: [],
    })),
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
  ctx.allow('candidate.recordTest', { type: 'candidate', id: c.id, workspaceId: c.testWorkspaceId, scope: 'Vehicle', env: r.env });
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
  ctx.allow('candidate.verify', { type: 'candidate', id: c.id, workspaceId: c.testWorkspaceId, scope: 'Vehicle' });
  if (c.status !== 'TESTING') throw rule('NOT_TESTING', 'the candidate is not in testing');
  const blockers = candidateVerifyBlockers(ctx.s, c);
  if (blockers.length) throw rule('VERIFY_BLOCKED', 'the candidate cannot be verified yet', { issues: blockers });
  const draft = ctx.s.candidates[c.id]!;
  draft.status = 'VERIFIED';
  draft.verifiedBy = ctx.user().username;
  draft.verifiedAt = ctx.now;
}
