// Applicability (适用性确认): an unchanged DCL policy set may serve another whole-vehicle software
// version. Each policy is checked against the software's manifest, the whole set is tested on
// vehicles running that software, and configuration release confirms. The confirmation appends a
// record; the set and its version stay as they are.

import { policyCompatibility } from '../domain/compatibility.ts';
import type { PolicyCompatibility } from '../domain/compatibility.ts';
import { conflict, notFound, rule } from '../domain/errors.ts';
import { newId } from '../domain/ids.ts';
import type { Ctx } from './engine.ts';
import { directTargetProblems, membersOf, pendingDeploymentOf, recordGroupBinding, softwareKey } from './fleet.ts';
import { latestRelease } from './config.ts';
import { appliesTo, getRelease, setInEffect } from './release.ts';
import { commitSnapshot, resolveFiles } from './snapshots.ts';
import type { ApplicabilityCheck, Release, Resource, State } from './types.ts';
import { assertSimulationFirst, blockersFor, testStatusFor } from './validation.ts';
import type { TargetStatus } from './validation.ts';

const OPEN_STATUSES: readonly ApplicabilityCheck['status'][] = ['OPEN', 'TESTING', 'VERIFIED'];

export function getCheck(s: State, id: string): ApplicabilityCheck {
  const c = s.applicabilityChecks[id];
  if (!c) throw notFound('applicability check', id);
  return c;
}

export function isOpenCheck(c: ApplicabilityCheck): boolean {
  return OPEN_STATUSES.includes(c.status);
}

/** The integration workspace whose testing vehicles verify a set: its candidate's, or the model's whole-vehicle one. */
export function testWorkspaceFor(s: State, release: Release): string | null {
  const candidate = release.candidateId ? s.candidates[release.candidateId] : undefined;
  if (candidate) return candidate.testWorkspaceId;
  return (
    Object.values(s.workspaces).find((w) => w.kind === 'INTEGRATION' && w.status === 'ACTIVE' && w.vehicleModelId === release.vehicleModelId && w.scopes.includes('Vehicle'))?.id ?? null
  );
}

/** Every policy of the set against the software version's manifest. */
export function compatibilityOf(s: State, releaseId: string, version: string): PolicyCompatibility[] {
  const release = getRelease(s, releaseId);
  const manifest = s.softwareVersions[softwareKey(release.vehicleModelId, version)]?.manifest ?? null;
  const results: PolicyCompatibility[] = [];
  for (const commitId of Object.values(release.groups)) {
    const config = commitSnapshot(s, commitId);
    const files = resolveFiles(s, config);
    for (const [policyId, policy] of Object.entries(config.policies)) results.push(policyCompatibility(policyId, policy, files, manifest));
  }
  return results.sort((a, b) => a.policyId.localeCompare(b.policyId));
}

/** The vehicles a check must pass on, with their latest results. */
export function checkTestStatus(s: State, check: ApplicabilityCheck): TargetStatus[] {
  return testStatusFor(s, check.id, check.id);
}

/** Why the set may not be confirmed for the version yet; empty when it may. */
export function confirmBlockers(s: State, check: ApplicabilityCheck): string[] {
  const blockers: string[] = [];
  const compatibility = compatibilityOf(s, check.releaseId, check.version);
  if (compatibility.some((c) => c.status === 'UNKNOWN')) blockers.push(`software ${check.version} has no manifest`);
  for (const c of compatibility.filter((x) => x.status === 'MISSING')) blockers.push(`${c.policyId}: missing ${[...c.missingSignals, ...c.missingSources].join(', ')}`);
  return [...blockers, ...blockersFor(s, checkTestStatus(s, check))];
}

function allowCheck(ctx: Ctx, action: 'applicability.dispatch' | 'applicability.verify' | 'applicability.confirm', check: Pick<ApplicabilityCheck, 'id' | 'testWorkspaceId'>): void {
  ctx.allow(action, { type: 'applicabilityCheck', id: check.id, workspaceId: check.testWorkspaceId, scope: 'Vehicle' });
}

/** Creates the check; the caller has authorized. */
function createCheck(ctx: Ctx, release: Release, version: string, testWorkspaceId: string, auto: boolean, openedBy: string): string {
  const id = newId('ac');
  ctx.s.applicabilityChecks[id] = {
    id,
    vehicleModelId: release.vehicleModelId,
    version,
    releaseId: release.id,
    testWorkspaceId,
    status: 'OPEN',
    auto,
    openedBy,
    openedAt: ctx.now,
    verifiedBy: null,
    verifiedAt: null,
    decidedBy: null,
    decidedAt: null,
    note: null,
  };
  return id;
}

/**
 * A software version no set applies to: if the model has sets, a check for the newest one is opened
 * as a to-do for configuration release. Part of recording the version; nothing else changes.
 */
export function openCheckForNewSoftware(ctx: Ctx, vehicleModelId: string, version: string): string | null {
  if (setInEffect(ctx.s, vehicleModelId, version)) return null;
  const latest = latestRelease(ctx.s, vehicleModelId);
  const testWs = latest ? testWorkspaceFor(ctx.s, latest) : null;
  if (!latest || !testWs) return null;
  return createCheck(ctx, latest, version, testWs, true, ctx.user().username);
}

/** Configuration release asks whether a set may serve another software version. */
export function openApplicabilityCheck(ctx: Ctx, input: { releaseId: string; version: string }): string {
  const release = getRelease(ctx.s, input.releaseId);
  const testWs = testWorkspaceFor(ctx.s, release);
  if (!testWs) throw rule('NO_INTEGRATION_WORKSPACE', 'no integration workspace tests this vehicle model');
  ctx.allow('applicability.confirm', { type: 'release', id: release.id, workspaceId: testWs, scope: 'Vehicle' });
  const version = input.version.trim();
  if (!ctx.s.softwareVersions[softwareKey(release.vehicleModelId, version)]) {
    throw rule('UNKNOWN_SOFTWARE_VERSION', `${release.vehicleModelId} ${version} is not a recorded software version`);
  }
  if (appliesTo(ctx.s, release, version)) throw rule('ALREADY_APPLIES', `policy set ${release.dclVersion} already applies to ${version}`);
  const current = setInEffect(ctx.s, release.vehicleModelId, version);
  if (current && current.sequence > release.sequence) {
    throw rule('APPLICABILITY_SHADOWED', `the newer policy set ${current.dclVersion} already applies to ${version}`);
  }
  const open = Object.values(ctx.s.applicabilityChecks).find((c) => c.releaseId === release.id && c.version === version && isOpenCheck(c));
  if (open) throw conflict('CHECK_OPEN', 'a check for this set and version is already open');
  return createCheck(ctx, release, version, testWs, false, ctx.user().username);
}

/** Why one vehicle cannot test the check now; empty if it can. */
export function checkVehicleProblems(s: State, check: ApplicabilityCheck, rid: string): string[] {
  const r: Resource = s.resources[rid]!;
  const problems: string[] = [];
  if (r.env !== 'testing') problems.push(`${rid}: not a testing vehicle`);
  if (r.status !== 'AVAILABLE') problems.push(`${rid}: ${r.status.toLowerCase()}`);
  if (r.vehicleModelId !== check.vehicleModelId) problems.push(`${rid}: another vehicle model`);
  if (!r.integrationVersion) problems.push(`${rid}: software version unknown`);
  else if (r.integrationVersion !== check.version) problems.push(`${rid}: runs software ${r.integrationVersion}; the check is for ${check.version}`);
  const pending = pendingDeploymentOf(s, rid);
  if (pending) problems.push(`${rid}: waiting for deployment ${pending}`);
  return problems;
}

/** Integration testing sends the unchanged set to testing vehicles that run the software in question. */
export function dispatchApplicability(ctx: Ctx, checkId: string, input: { vehicleGroupIds?: string[]; resourceIds?: string[] }): string {
  const check = getCheck(ctx.s, checkId);
  allowCheck(ctx, 'applicability.dispatch', check);
  if (!isOpenCheck(check)) throw rule('CHECK_CLOSED', 'the check is closed');
  const release = getRelease(ctx.s, check.releaseId);
  const vehicleGroupIds = input.vehicleGroupIds ?? [];
  const direct = input.resourceIds ?? [];
  if (vehicleGroupIds.length === 0 && direct.length === 0) throw rule('NO_VEHICLE_GROUPS', 'choose vehicle groups or ungrouped vehicles');
  const problems: string[] = directTargetProblems(ctx.s, check.testWorkspaceId, direct);
  const members: { resourceId: string; vehicleGroupId: string | null }[] = [];
  const checkVehicle = (rid: string, vehicleGroupId: string | null) => {
    if (members.some((m) => m.resourceId === rid)) return;
    problems.push(...checkVehicleProblems(ctx.s, check, rid));
    members.push({ resourceId: rid, vehicleGroupId });
  };
  for (const id of vehicleGroupIds) {
    const g = ctx.s.vehicleGroups[id];
    if (!g) {
      problems.push(`${id}: vehicle group does not exist`);
      continue;
    }
    if (g.status !== 'ACTIVE') problems.push(`${g.name}: archived`);
    if (g.workspaceId !== check.testWorkspaceId || g.purpose !== 'TEST' || g.env !== 'testing') problems.push(`${g.name}: testing vehicle groups of the integration workspace only`);
    const list = membersOf(ctx.s, id);
    if (list.length === 0) problems.push(`${g.name}: no vehicles`);
    for (const rid of list) checkVehicle(rid, id);
  }
  if (problems.length === 0) for (const rid of direct) checkVehicle(rid, null);
  if (problems.length) throw rule('DISPATCH_BLOCKED', 'the dispatch would not reach every vehicle safely', { issues: problems });

  const id = newId('dp');
  for (const vgId of vehicleGroupIds) recordGroupBinding(ctx, vgId, { kind: 'RELEASE', releaseId: release.id, configId: release.resolvedConfigId });
  for (const m of members) {
    const existing = ctx.s.testTargets.find((t) => t.subjectId === check.id && t.resourceId === m.resourceId);
    if (existing) existing.deploymentId = id;
    else ctx.s.testTargets.push({ subjectKind: 'APPLICABILITY', subjectId: check.id, versionId: check.id, resourceId: m.resourceId, deploymentId: id });
  }
  ctx.s.deployments[id] = {
    id,
    kind: 'APPLICABILITY',
    workspaceId: check.testWorkspaceId,
    groupId: null,
    subjectId: check.id,
    commitId: null,
    resolvedConfigId: release.resolvedConfigId,
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
      history: [],
    })),
    dispatchedBy: ctx.user().username,
    createdAt: ctx.now,
    updatedAt: ctx.now,
  };
  ctx.s.applicabilityChecks[check.id]!.status = 'TESTING';
  return id;
}

export function recordApplicabilityTest(
  ctx: Ctx,
  checkId: string,
  input: { resourceId: string; result: 'PASS' | 'FAIL'; summary: string; evidenceUri?: string },
): string {
  const check = getCheck(ctx.s, checkId);
  const r = ctx.s.resources[input.resourceId];
  if (!r) throw notFound('vehicle', input.resourceId);
  ctx.allow('applicability.recordTest', { type: 'applicabilityCheck', id: check.id, workspaceId: check.testWorkspaceId, scope: 'Vehicle', env: r.env });
  if (check.status !== 'TESTING') throw rule('NOT_TESTING', 'the check is not in testing');
  const target = checkTestStatus(ctx.s, check).find((t) => t.resourceId === r.id);
  if (!target) throw rule('NOT_A_TEST_TARGET', `vehicle ${r.id} was not sent this set for the check`);
  if (!target.applied) throw rule('NOT_APPLIED', `vehicle ${r.id} has not confirmed applying the set`);
  if (!input.summary.trim()) throw rule('SUMMARY_REQUIRED', 'describe what was tested');
  assertSimulationFirst(ctx.s, check.id, check.id, r.type, input.result);
  const id = newId('tr');
  ctx.s.testRuns.push({
    id,
    seq: ctx.seq(),
    subjectKind: 'APPLICABILITY',
    subjectId: check.id,
    versionId: check.id,
    resourceId: r.id,
    resourceType: r.type,
    integrationVersion: r.integrationVersion,
    env: r.env,
    resolvedConfigId: getRelease(ctx.s, check.releaseId).resolvedConfigId,
    result: input.result,
    summary: input.summary.trim(),
    evidenceUri: input.evidenceUri?.trim() || null,
    tester: ctx.user().username,
    createdAt: ctx.now,
  });
  return id;
}

/** Integration testing signs off: every vehicle passed, simulation and physical. */
export function verifyApplicability(ctx: Ctx, checkId: string): void {
  const check = getCheck(ctx.s, checkId);
  allowCheck(ctx, 'applicability.verify', check);
  if (check.status !== 'TESTING') throw rule('NOT_TESTING', 'the check is not in testing');
  const blockers = blockersFor(ctx.s, checkTestStatus(ctx.s, check));
  if (blockers.length) throw rule('VERIFY_BLOCKED', 'the check cannot be verified yet', { issues: blockers });
  const draft = ctx.s.applicabilityChecks[check.id]!;
  draft.status = 'VERIFIED';
  draft.verifiedBy = ctx.user().username;
  draft.verifiedAt = ctx.now;
}

/**
 * Configuration release confirms: every policy fits the software and the tests still hold. The set
 * now applies to the version by an appended record; its content and version are unchanged.
 */
export function confirmApplicability(ctx: Ctx, checkId: string, input: { note: string }): void {
  const check = getCheck(ctx.s, checkId);
  allowCheck(ctx, 'applicability.confirm', check);
  if (check.status !== 'VERIFIED') throw rule('CHECK_NOT_VERIFIED', 'integration testing has not verified the set on this software');
  const compatibility = compatibilityOf(ctx.s, check.releaseId, check.version);
  if (compatibility.some((c) => c.status === 'UNKNOWN')) throw rule('MANIFEST_MISSING', `software ${check.version} has no manifest; vehicle resources record it first`);
  const missing = compatibility.filter((c) => c.status === 'MISSING');
  if (missing.length) {
    throw rule('INCOMPATIBLE_POLICIES', 'some policies need signals or sources the software does not provide', {
      issues: missing.map((c) => `${c.policyId}: missing ${[...c.missingSignals, ...c.missingSources].join(', ')}`),
    });
  }
  const blockers = blockersFor(ctx.s, checkTestStatus(ctx.s, check));
  if (blockers.length) throw rule('VERIFY_BLOCKED', 'the check’s current tests no longer verify it', { issues: blockers });
  const release = getRelease(ctx.s, check.releaseId);
  const current = setInEffect(ctx.s, release.vehicleModelId, check.version);
  if (current && current.sequence > release.sequence) {
    throw rule('APPLICABILITY_SHADOWED', `the newer policy set ${current.dclVersion} already applies to ${check.version}`);
  }
  if (!input.note.trim()) throw rule('REASON_REQUIRED', 'give a reason');
  ctx.s.applicability.push({
    id: newId('ap'),
    seq: ctx.seq(),
    releaseId: release.id,
    vehicleModelId: release.vehicleModelId,
    version: check.version,
    action: 'ADD',
    checkId: check.id,
    reason: input.note.trim(),
    by: ctx.user().username,
    at: ctx.now,
  });
  const draft = ctx.s.applicabilityChecks[check.id]!;
  draft.status = 'CONFIRMED';
  draft.decidedBy = ctx.user().username;
  draft.decidedAt = ctx.now;
  draft.note = input.note.trim();
  for (const other of Object.values(ctx.s.applicabilityChecks)) {
    if (other.id !== check.id && other.vehicleModelId === check.vehicleModelId && other.version === check.version && isOpenCheck(other)) {
      other.status = 'SUPERSEDED';
      other.note = `policy set ${release.dclVersion} was confirmed for ${check.version}`;
    }
  }
}

/** Configuration release closes a check without a decision. Its pending test dispatches stop. */
export function cancelApplicabilityCheck(ctx: Ctx, checkId: string, reason: string): void {
  const check = getCheck(ctx.s, checkId);
  allowCheck(ctx, 'applicability.confirm', check);
  if (!isOpenCheck(check)) throw rule('CHECK_CLOSED', 'the check is closed');
  if (!reason.trim()) throw rule('REASON_REQUIRED', 'give a reason');
  for (const d of Object.values(ctx.s.deployments)) {
    if (d.kind !== 'APPLICABILITY' || d.subjectId !== check.id || d.status !== 'PENDING') continue;
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
  const draft = ctx.s.applicabilityChecks[check.id]!;
  draft.status = 'CANCELLED';
  draft.decidedBy = ctx.user().username;
  draft.decidedAt = ctx.now;
  draft.note = reason.trim();
}

/**
 * Configuration release withdraws a set from a software version by an appended record. Vehicles on
 * that version fall back to the next set that still applies, or are blocked.
 */
export function withdrawApplicability(ctx: Ctx, input: { releaseId: string; version: string; reason: string }): void {
  const release = getRelease(ctx.s, input.releaseId);
  const testWs = testWorkspaceFor(ctx.s, release);
  ctx.allow('applicability.confirm', { type: 'release', id: release.id, workspaceId: testWs ?? undefined, scope: 'Vehicle' });
  if (!appliesTo(ctx.s, release, input.version)) throw rule('NOT_APPLICABLE', `policy set ${release.dclVersion} does not apply to ${input.version}`);
  if (!input.reason.trim()) throw rule('REASON_REQUIRED', 'give a reason');
  ctx.s.applicability.push({
    id: newId('ap'),
    seq: ctx.seq(),
    releaseId: release.id,
    vehicleModelId: release.vehicleModelId,
    version: input.version,
    action: 'WITHDRAW',
    checkId: null,
    reason: input.reason.trim(),
    by: ctx.user().username,
    at: ctx.now,
  });
}

/** Applicability records of a set, oldest first. */
export function applicabilityHistory(s: State, releaseId: string) {
  return s.applicability.filter((a) => a.releaseId === releaseId).sort((a, b) => a.seq - b.seq);
}

/** Production vehicles of a model whose known software has no set: they run nothing new. */
export function blockedProductionVehicles(s: State, vehicleModelId: string): Resource[] {
  return Object.values(s.resources)
    .filter(
      (r) =>
        r.env === 'production' &&
        r.vehicleModelId === vehicleModelId &&
        r.status === 'AVAILABLE' &&
        r.softwareStatus === 'CONSISTENT' &&
        r.integrationVersion !== null &&
        !setInEffect(s, vehicleModelId, r.integrationVersion),
    )
    .sort((a, b) => a.id.localeCompare(b.id));
}
