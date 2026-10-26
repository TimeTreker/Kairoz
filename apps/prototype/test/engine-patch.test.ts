import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { answerAll, verifyFeatureOn } from '../acceptance/helpers.ts';
import { World } from '../acceptance/world.ts';
import * as config from '../src/engine/config.ts';
import { decideEmergencyStop, requestEmergencyStop } from '../src/engine/emergency.ts';
import * as fleet from '../src/engine/fleet.ts';
import * as integ from '../src/engine/integration.ts';
import * as rel from '../src/engine/release.ts';
import { demoState } from '../src/engine/seed.ts';
import { commitSnapshot } from '../src/engine/snapshots.ts';
import * as v from '../src/engine/validation.ts';

const ANGLE = 'chassis.steering.angle_jump';
const groupId = (w: World, name: string) => Object.values(w.s.vehicleGroups).find((g) => g.name === name)!.id;
const set = (w: World, version: string) => Object.values(w.s.releases).find((r) => r.dclVersion === version)!;
const feature = (w: World, name: string) => Object.values(w.s.features).find((f) => f.name === name)!;
/** Software 1.0: the integration test group (SIM-101, VEH-031). Software 1.1: two vehicles outside any group. */
const ON_10 = { group: 'X89 集成测试车组', vehicles: ['SIM-101', 'VEH-031'] };
const ON_11 = { group: null, vehicles: ['SIM-111', 'VEH-033'] };

/** Testing vehicles on software 1.1 in the integration workspace. */
function vehiclesOn11(w: World): void {
  w.as('integration_admin', (c) => fleet.createSimulation(c, { id: 'SIM-111', workspaceId: 'x89-integration', imageId: 'x89-1.1-sim', env: 'testing', pool: 'Vehicle', displayName: '整车 1.1 仿真' }));
  w.as('resource', (c) => fleet.registerPhysical(c, { id: 'VEH-033', vin: 'LSDEMX89000000033', vehicleModelId: 'X89', env: 'testing', pool: 'Vehicle', displayName: '整车 1.1 测试车' }));
  w.as('resource', (c) => fleet.confirmIntegration(c, 'VEH-033', { version: '1.1', source: 'DIP 上报' }));
  w.as('integration_admin', (c) => fleet.addWorkspaceVehicle(c, 'x89-integration', 'VEH-033'));
}

function preview(w: World, featureIds: string[], patchOf?: string): string {
  return w.as('integrator', (c) => integ.previewMerge(c, { workspaceId: 'x89-project', featureIds, patchOf }));
}

/** Reads the plan after the preview ran (the state object changes with every operation). */
function planOf(w: World, id: string) {
  return w.s.mergePlans[id]!;
}

function freeze(w: World, plan: string, label: string): string {
  w.as('dcl', (c) => integ.confirmProcessing(c, plan, { note: '处理集合确认' }));
  return w.as('integrator', (c) => integ.freezeCandidate(c, plan, { label }));
}

/** Integration testing passes the candidate on the vehicles (simulation first) and verifies it. */
function testCandidate(w: World, candidateId: string, on: { group: string | null; vehicles: string[] }): void {
  const target = on.group ? { vehicleGroupIds: [groupId(w, on.group)] } : { resourceIds: on.vehicles };
  answerAll(w, w.as('integration_tester', (c) => v.dispatchCandidate(c, candidateId, target)));
  for (const r of on.vehicles) w.as('integration_tester', (c) => v.recordCandidateTest(c, candidateId, { resourceId: r, result: 'PASS', summary: '回归通过' }));
  w.as('integration_tester', (c) => v.verifyCandidate(c, candidateId));
}

function promote(w: World, candidateId: string, dclVersion: string, versions: string[]): string {
  return w.as('release', (c) => rel.promoteCandidate(c, candidateId, { dclVersion, vehicleIntegrationVersions: versions }));
}

/** The mainline moves on: steering_return_rate becomes 1.1.0 for software 1.1; software 1.0 stays on 1.0.0. */
function mainline110(w: World): void {
  vehiclesOn11(w);
  const cand = freeze(w, preview(w, [feature(w, 'steering_return_rate').id]), 'X89-C2');
  testCandidate(w, cand, ON_11);
  promote(w, cand, '1.1.0', ['1.1']);
}

/** A steering fix started on 1.0.0 (what software 1.0 runs), raising the angle-jump threshold, verified by the team. */
function angleFix(w: World, name = 'angle_jump_fix', threshold = 350): string {
  const id = w.as('steering', (c) => config.createFeature(c, { workspaceId: 'team-steering', groupId: 'steering', name, baseReleaseId: set(w, '1.0.0').id }));
  const p = w.s.features[id]!.draft.policies[ANGLE]!;
  w.as('steering', (c) => config.putPolicy(c, id, ANGLE, { ...p, trigger: `steering_angle_rate > ${threshold} AND vehicle_speed > 20` }));
  w.as('steering', (c) => config.submitFeature(c, id, { message: '转角突变误触发，提高阈值' }));
  verifyFeatureOn(w, 'steering_tester', id, [groupId(w, '转向研发车组')]);
  return id;
}

/** The fix released as patch 1.0.1 of 1.0.0 for software 1.0. */
function patch101(w: World, fixId: string): string {
  const cand = freeze(w, preview(w, [fixId], set(w, '1.0.0').id), 'X89-P1');
  testCandidate(w, cand, ON_10);
  return promote(w, cand, '1.0.1', ['1.0']);
}

describe('same-software patches', () => {
  test('a patch targets an older set still in effect and keeps that set’s other content', () => {
    const w = new World(demoState());
    w.eq(rel.patchTargets(w.s, 'X89'), [], 'with one set there is only the mainline');
    mainline110(w);
    w.eq(config.mainlineRelease(w.s, 'X89')?.dclVersion, '1.1.0', 'the mainline moved to 1.1.0');
    w.eq(rel.patchTargets(w.s, 'X89').map((r) => r.dclVersion), ['1.0.0'], '1.0.0 still serves software 1.0');
    const fix = angleFix(w);

    w.fails('NOT_A_PATCH_TARGET', () => preview(w, [fix], set(w, '1.1.0').id));
    w.fails('PATCH_FEATURES_ONLY', () => w.as('integrator', (c) => integ.previewMerge(c, { workspaceId: 'x89-project', featureIds: [fix], subsystemReleaseIds: ['ss_x'], patchOf: set(w, '1.0.0').id })));

    const plan = planOf(w, preview(w, [fix], set(w, '1.0.0').id));
    w.eq([plan.status, plan.targetReleaseId, plan.patch], ['READY', set(w, '1.0.0').id, { versions: ['1.0'] }], 'a ready patch of 1.0.0 for software 1.0');
    const steering = plan.merged.steering!;
    w.eq(Object.keys(steering.policies), [ANGLE], 'the mainline’s return_rate is not brought into the patch');
    w.eq([steering.policies[ANGLE]!.trigger, steering.policies[ANGLE]!.postSeconds], ['steering_angle_rate > 350 AND vehicle_speed > 20', 10], 'the fix on top of 1.0.0, not 1.1.0');
  });

  test('a patch release serves only its target’s software, is numbered in its line, and leaves the mainline', () => {
    const w = new World(demoState());
    mainline110(w);
    const fix = angleFix(w);
    const cand = freeze(w, preview(w, [fix], set(w, '1.0.0').id), 'X89-P1');
    testCandidate(w, cand, ON_10);
    w.eq(rel.nextDclVersion(w.s, 'X89', set(w, '1.0.0').id), '1.0.1', 'the next number in the 1.0 line');
    w.fails('PATCH_VERSION_LINE', () => promote(w, cand, '1.1.1', ['1.0']));
    w.fails('PATCH_VERSION_LINE', () => promote(w, cand, '1.2.0', ['1.0']));
    const outside = w.fails('PATCH_VERSION_OUTSIDE_TARGET', () => promote(w, cand, '1.0.1', ['1.0', '1.1']));
    w.eq((outside.details as { issues: string[] }).issues, ['X89 1.1'], 'names the software the target does not serve');

    const id = promote(w, cand, '1.0.1', ['1.0']);
    w.eq(w.s.releases[id]!.patchOf, set(w, '1.0.0').id, '1.0.1 patches 1.0.0');
    w.eq([rel.setInEffect(w.s, 'X89', '1.0')?.dclVersion, rel.setInEffect(w.s, 'X89', '1.1')?.dclVersion], ['1.0.1', '1.1.0'], 'software 1.0 takes the patch; 1.1 keeps the mainline');
    w.eq(config.mainlineRelease(w.s, 'X89')?.dclVersion, '1.1.0', 'the patch does not move the mainline');
    w.eq(rel.nextDclVersion(w.s, 'X89'), '1.1.1', 'the next mainline number');
    w.eq(rel.patchTargets(w.s, 'X89').map((r) => r.dclVersion), ['1.0.1'], 'the next patch builds on 1.0.1');
    w.eq(rel.releaseDiff(w.s, set(w, '1.0.0').id, id).policies.map((p) => p.policyId), [ANGLE], 'only the fixed policy changed');

    // The fix waits for the mainline: Verified again, out of the 1.0 line’s sources.
    const f = w.s.features[fix]!;
    w.eq([f.stage, rel.patchesOf(w.s, f).map((r) => r.dclVersion)], ['VERIFIED', ['1.0.1']], 'the fix is open for the mainline');
    w.check(integ.verifiedSources(w.s, 'x89-project', 'Vehicle').some((x) => x.id === fix), 'a mainline merge offers it');
    w.check(!integ.verifiedSources(w.s, 'x89-project', 'Vehicle', id).some((x) => x.id === fix), 'a patch of 1.0.1 does not');
    w.fails('SOURCE_NOT_ALLOWED', () => preview(w, [fix], id));
  });

  test('the fix merges into the mainline by three-way merge and closes there', () => {
    const w = new World(demoState());
    mainline110(w);
    const fix = angleFix(w);
    patch101(w, fix);
    const plan = planOf(w, preview(w, [fix]));
    w.eq([plan.status, plan.targetReleaseId, plan.patch], ['READY', set(w, '1.1.0').id, null], 'a mainline merge onto 1.1.0');
    const steering = plan.merged.steering!;
    w.eq(Object.keys(steering.policies).sort(), [ANGLE, 'chassis.steering.return_rate'], 'the mainline keeps return_rate');
    w.eq([steering.policies[ANGLE]!.trigger, steering.policies[ANGLE]!.postSeconds], ['steering_angle_rate > 350 AND vehicle_speed > 20', 15], 'the fix lands beside the mainline’s own change');
    const cand = freeze(w, plan.id, 'X89-C3');
    testCandidate(w, cand, ON_11);
    promote(w, cand, '1.1.1', ['1.1']);
    w.eq(w.s.features[fix]!.stage, 'ARCHIVED', 'in the mainline, the fix is done');
    w.eq([config.mainlineRelease(w.s, 'X89')?.dclVersion, rel.setInEffect(w.s, 'X89', '1.0')?.dclVersion], ['1.1.1', '1.0.1'], 'each software keeps its own line');
  });

  test('a patch candidate runs beside a mainline candidate; each line has its own preview and gate', () => {
    const w = new World(demoState());
    mainline110(w);
    const fix = angleFix(w);
    const second = angleFix(w, 'angle_jump_fix_2', 400);
    const mainPlan = preview(w, [feature(w, 'brake_monitor').id]);
    const patchPlan = preview(w, [fix], set(w, '1.0.0').id);
    w.eq([w.s.mergePlans[mainPlan]!.status, w.s.mergePlans[patchPlan]!.status], ['READY', 'READY'], 'a patch preview leaves the mainline preview live');
    const mainCand = freeze(w, mainPlan, 'X89-C3');
    const patchCand = freeze(w, patchPlan, 'X89-P1');
    // One open candidate per line.
    const other = preview(w, [second], set(w, '1.0.0').id);
    w.as('dcl', (c) => integ.confirmProcessing(c, other, { note: '' }));
    w.fails('CANDIDATE_OPEN', () => w.as('integrator', (c) => integ.freezeCandidate(c, other, { label: 'X89-P2' })));
    testCandidate(w, patchCand, ON_10);
    promote(w, patchCand, '1.0.1', ['1.0']);
    w.check(!rel.targetMoved(w.s, w.s.candidates[mainCand]!), 'the patch did not move the mainline candidate’s target');

    // A preview of the new patch line survives the next mainline release.
    const nextPatch = planOf(w, preview(w, [second], set(w, '1.0.1').id));
    w.eq(nextPatch.status, 'CONFLICT', 'the second fix changes the trigger 1.0.1 already changed');
    testCandidate(w, mainCand, ON_11);
    promote(w, mainCand, '1.1.1', ['1.1']);
    w.eq(w.s.mergePlans[nextPatch.id]!.status, 'CONFLICT', 'a mainline release leaves a patch preview of 1.0.1 alone');
  });

  test('a patch candidate is refused once its target was replaced for its software', () => {
    const w = new World(demoState());
    mainline110(w);
    const fix = angleFix(w);
    const second = angleFix(w, 'angle_jump_fix_2', 400);
    const plan = preview(w, [second], set(w, '1.0.0').id);
    w.as('dcl', (c) => integ.confirmProcessing(c, plan, { note: '' }));
    patch101(w, fix);
    w.eq(w.s.mergePlans[plan]!.status, 'SUPERSEDED', 'publishing 1.0.1 superseded the other preview of 1.0.0');
    w.fails('PLAN_NOT_READY', () => w.as('integrator', (c) => integ.freezeCandidate(c, plan, { label: 'X89-P2' })));
  });

  test('an emergency stop of an older set is a patch of it; of the mainline head it stays on the mainline', () => {
    const w = new World(demoState());
    mainline110(w);
    const fix = angleFix(w);
    const patchPlan = preview(w, [fix], set(w, '1.0.0').id);
    const mainPlan = preview(w, [feature(w, 'brake_monitor').id]);
    const stopOld = w.as('dcl', (c) => requestEmergencyStop(c, { releaseId: set(w, '1.0.0').id, policyId: ANGLE, reason: '转角突变误触发' }));
    const oldId = w.as('release', (c) => decideEmergencyStop(c, stopOld, { decision: 'APPROVED', note: '值班批准' }))!;
    const old = w.s.releases[oldId]!;
    w.eq([old.dclVersion, old.patchOf, old.vehicleIntegrationVersions], ['1.0.1', set(w, '1.0.0').id, ['1.0']], 'a patch of 1.0.0 in its line');
    w.eq(config.mainlineRelease(w.s, 'X89')?.dclVersion, '1.1.0', 'the mainline stays');
    w.eq([w.s.mergePlans[patchPlan]!.status, w.s.mergePlans[mainPlan]!.status], ['SUPERSEDED', 'READY'], 'only the preview of 1.0.0 is stale');

    const stopHead = w.as('dcl', (c) => requestEmergencyStop(c, { releaseId: set(w, '1.1.0').id, policyId: 'chassis.steering.return_rate', reason: '回正误触发' }));
    const headId = w.as('release', (c) => decideEmergencyStop(c, stopHead, { decision: 'APPROVED', note: '值班批准' }))!;
    const head = w.s.releases[headId]!;
    w.eq([head.dclVersion, head.patchOf], ['1.1.1', null], 'a stop of the head is the next mainline set');
    w.eq(config.mainlineRelease(w.s, 'X89')?.id, head.id, 'merges now build on it');
    w.eq(w.s.mergePlans[mainPlan]!.status, 'SUPERSEDED', 'the mainline preview is stale now');
  });

  test('integration closes a patched fix for the mainline, with a reason', () => {
    const w = new World(demoState());
    mainline110(w);
    const fix = angleFix(w);
    patch101(w, fix);
    w.denied('steering', (c) => integ.closeForMainline(c, fix, { reason: '主线已重写该策略' }));
    w.fails('REASON_REQUIRED', () => w.as('integrator', (c) => integ.closeForMainline(c, fix, { reason: ' ' })));
    w.fails('NOT_PATCHED', () => w.as('integrator', (c) => integ.closeForMainline(c, feature(w, 'brake_monitor').id, { reason: 'x' })));
    w.as('integrator', (c) => integ.closeForMainline(c, fix, { reason: '主线已重写该策略' }));
    w.eq(w.s.features[fix]!.stage, 'ARCHIVED', 'closed');
    w.eq(w.s.feedback.filter((f) => f.featureId === fix).map((f) => [f.kind, f.reason]), [['MAINLINE_DECLINED', '主线已重写该策略']], 'the reason stays with the Feature');
    w.fails('NOT_PATCHED', () => w.as('integrator', (c) => integ.closeForMainline(c, fix, { reason: 'again' })));
  });

  test('new Features and new software build on the mainline, not on a newer patch', () => {
    const w = new World(demoState());
    mainline110(w);
    patch101(w, angleFix(w));
    const id = w.as('steering', (c) => config.createFeature(c, { workspaceId: 'team-steering', groupId: 'steering', name: 'steering_next' }));
    w.eq(w.s.features[id]!.baseReleaseId, set(w, '1.1.0').id, 'the default base is the mainline head');
    w.eq(commitSnapshot(w.s, set(w, '1.1.0').groups.steering!), w.s.features[id]!.draft, 'and the draft starts from it');
    const manifest = w.s.softwareVersions['X89::1.0']!.manifest!;
    w.as('resource', (c) => fleet.recordSoftwareVersion(c, { vehicleModelId: 'X89', version: '1.2', source: '整车 OTA 发布记录 X89-1.2', manifest }));
    const check = Object.values(w.s.applicabilityChecks).find((c) => c.version === '1.2')!;
    assert.equal(w.s.releases[check.releaseId]!.dclVersion, '1.1.0', 'new software is checked against the mainline');
  });
});
