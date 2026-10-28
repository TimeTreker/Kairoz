import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { World } from '../acceptance/world.ts';
import * as dl from '../src/engine/delivery.ts';
import * as fleet from '../src/engine/fleet.ts';
import { demoState } from '../src/engine/seed.ts';
import { reportNow, sendReceipt, setAgent, simulateSoftwareOta, tick } from '../src/engine/simulator.ts';
import * as v from '../src/engine/validation.ts';
import { plmPublish } from '../acceptance/helpers.ts';

const feature = (w: World, name: string) => Object.values(w.s.features).find((f) => f.name === name)!;
const groupId = (w: World, name: string) => Object.values(w.s.vehicleGroups).find((g) => g.name === name)!.id;
const follows = (w: World, rid: string) => Object.values(w.s.deployments).filter((d) => d.trigger === 'GROUP_FOLLOW' && d.targets.some((t) => t.resourceId === rid));

const MANIFEST_13 = {
  signals: ['apa.active', 'brake_fault_code', 'brake_pressure', 'steering_angle_rate', 'steering_return_rate', 'vehicle_deceleration', 'vehicle_speed'],
  sources: [
    { unit: 'ADC', directory: '/data' },
    { unit: 'ADC', directory: '/var/log/chassis' },
    { unit: 'CHASSIS', directory: '/var/log' },
  ],
};

/** The workspace admin moves VEH-003 from the steering group into the brake workspace and group. */
function moveToBrake(w: World, rid = 'VEH-003'): void {
  w.as('workspace_manager', (c) => fleet.removeGroupMember(c, groupId(w, '转向研发车组'), rid, '调到制动'));
  w.as('workspace_manager', (c) => fleet.addWorkspaceVehicle(c, 'team-brake', rid));
  w.as('workspace_manager', (c) => fleet.addGroupMember(c, groupId(w, '制动研发车组'), rid, '制动验证'));
}

describe('dispatch and push', () => {
  test('a dispatch is pushed only when the vehicle is on and connected', () => {
    const w = new World(demoState());
    const f = feature(w, 'guided_brake');
    w.sys((c) => setAgent(c, 'VEH-001', { online: false }));
    const [d] = w.as('brake_tester', (c) => v.dispatchFeature(c, f.id, { commitId: f.headCommitId!, vehicleGroupIds: [groupId(w, '制动研发车组')] }));
    const state = (rid: string) => dl.deliveryState(w.s.deployments[d!]!.targets.find((t) => t.resourceId === rid)!);
    assert.deepEqual([state('SIM-021'), state('VEH-001')], ['NOT_PUSHED', 'NOT_PUSHED'], 'dispatched: only the cloud configuration changed');
    w.sys((c) => tick(c));
    assert.deepEqual([state('SIM-021'), state('VEH-001')], ['PUSHED', 'NOT_PUSHED'], 'the offline car has not received it');
    w.sys((c) => setAgent(c, 'VEH-001', { online: true }));
    w.sys((c) => tick(c));
    assert.equal(state('VEH-001'), 'PUSHED');
    w.sys((c) => sendReceipt(c, d!, 'VEH-001', 'APPLIED'));
    assert.equal(state('VEH-001'), 'APPLIED');
  });

  test('a vehicle that joins a group is pushed what the group runs on its next report, once', () => {
    const w = new World(demoState());
    const monitor = feature(w, 'brake_monitor');
    moveToBrake(w);
    assert.equal(w.s.groupFollows['VEH-003']?.reason, 'JOINED');
    const fit = dl.fitOf(w.s, 'VEH-003')!;
    assert.deepEqual([fit.fits, fit.check.outcome, fit.answer.reason], [true, 'NONE', 'GROUP_TARGET']);
    w.sys((c) => reportNow(c, 'VEH-003'));
    const [d] = follows(w, 'VEH-003');
    assert.ok(d, 'pushed');
    assert.deepEqual([d.subjectId, d.dispatchedBy, dl.deliveryState(d.targets[0]!)], [monitor.id, 'brake_tester', 'PUSHED']);
    assert.equal(d.resolvedConfigId, w.s.resources['VEH-001']!.appliedConfigId, 'the configuration the group already runs');
    assert.equal(w.s.groupFollows['VEH-003'], undefined);
    assert.ok(w.s.testTargets.some((t) => t.subjectId === monitor.id && t.resourceId === 'VEH-003'), 'it can be tested there');
    assert.equal(feature(w, 'brake_monitor').stage, 'VERIFIED', 'the stage does not change');
    w.sys((c) => sendReceipt(c, d.id, 'VEH-003', 'APPLIED'));
    w.sys((c) => reportNow(c, 'VEH-003'));
    assert.equal(follows(w, 'VEH-003').length, 1, 'pushed once');
    assert.equal(w.s.resources['VEH-003']!.appliedConfigId, d.resolvedConfigId);
  });

  test('a vehicle that does not fit waits for its team; leaving the group ends the wait', () => {
    const w = new World(demoState());
    // VEH-003 runs 1.1 now, which no policy set applies to.
    w.sys((c) => simulateSoftwareOta(c, 'VEH-003', '1.1'));
    w.sys((c) => reportNow(c, 'VEH-003'));
    moveToBrake(w);
    w.sys((c) => reportNow(c, 'VEH-003'));
    assert.equal(follows(w, 'VEH-003').length, 0, 'nothing pushed');
    const fit = dl.fitOf(w.s, 'VEH-003')!;
    assert.deepEqual([fit.fits, fit.check.outcome], [false, 'NO_BASE']);
    assert.deepEqual(dl.mismatchesFor(w.s, w.actor('business'), 'team-brake').map((f) => f.resourceId), ['VEH-003']);
    assert.deepEqual(dl.mismatchesFor(w.s, w.actor('steering'), 'team-steering'), [], 'only the group’s team');
    w.fails('DISPATCH_BLOCKED', () => w.as('business', (c) => dl.dispatchToVehicle(c, 'VEH-003')));
    w.as('workspace_manager', (c) => fleet.removeGroupMember(c, groupId(w, '制动研发车组'), 'VEH-003', '不用了'));
    assert.equal(w.s.groupFollows['VEH-003'], undefined);
  });

  test('confirm and dispatch sends the group’s publication to one vehicle on its own base', () => {
    const w = new World(demoState());
    const vg = groupId(w, '制动研发车组');
    const base = Object.values(w.s.releases).find((r) => r.dclVersion === '1.0.0')!;
    plmPublish(w.engine, 'X89', '1.3', { manifest: MANIFEST_13 });
    w.as('workspace_manager', (c) => fleet.setGroupBase(c, vg, base.id));
    w.sys((c) => simulateSoftwareOta(c, 'VEH-003', '1.3'));
    w.sys((c) => reportNow(c, 'VEH-003'));
    moveToBrake(w);
    w.sys((c) => reportNow(c, 'VEH-003'));
    const fit = dl.fitOf(w.s, 'VEH-003')!;
    assert.deepEqual([fit.fits, fit.check.outcome], [false, 'FIX'], 'a brake file’s source is missing on 1.3');
    w.denied('steering', (c) => dl.dispatchToVehicle(c, 'VEH-003'));
    w.as('workspace_manager', (c) => fleet.setGroupApproval(c, vg, true));
    w.fails('APPROVAL_REQUIRED', () => w.as('business', (c) => dl.dispatchToVehicle(c, 'VEH-003')));
    w.as('workspace_manager', (c) => fleet.setGroupApproval(c, vg, false));
    const id = w.as('business', (c) => dl.dispatchToVehicle(c, 'VEH-003'));
    const d = w.s.deployments[id]!;
    assert.deepEqual([d.trigger, d.dispatchedBy, d.targets.map((t) => t.resourceId), w.s.resolvedConfigs[d.resolvedConfigId]!.baseReleaseId], ['DISPATCH', 'business', ['VEH-003'], base.id]);
    assert.equal(w.s.groupFollows['VEH-003'], undefined, 'covered');
    assert.equal(feature(w, 'brake_monitor').stage, 'VERIFIED');
  });

  test('after a cancelled dispatch the group runs what still stands; a joining car follows that', () => {
    const w = new World(demoState());
    const vg = groupId(w, '制动研发车组');
    const guided = feature(w, 'guided_brake');
    const monitor = feature(w, 'brake_monitor');
    const [d] = w.as('brake_tester', (c) => v.dispatchFeature(c, guided.id, { commitId: guided.headCommitId!, vehicleGroupIds: [vg] }));
    w.as('brake_tester', (c) => v.cancelDeployment(c, d!, '换个时间'));
    const p = w.s.vehicleGroups[vg]!.publication;
    assert.equal(p?.kind === 'FEATURE' && p.featureId, monitor.id, 'back to brake_monitor, which the cars still run');
    moveToBrake(w);
    w.sys((c) => reportNow(c, 'VEH-003'));
    const [push] = follows(w, 'VEH-003');
    assert.equal(push?.subjectId, monitor.id, 'never the cancelled guided_brake');
  });

  test('a group that takes approved team tests does not push to a joining car', () => {
    const w = new World(demoState());
    w.as('workspace_manager', (c) => fleet.setGroupApproval(c, groupId(w, '制动研发车组'), true));
    moveToBrake(w);
    w.sys((c) => reportNow(c, 'VEH-003'));
    const fit = dl.fitOf(w.s, 'VEH-003')!;
    assert.deepEqual([fit.state, fit.problems], ['BLOCKED', ['the vehicle group takes approved team test requests']]);
    assert.equal(follows(w, 'VEH-003').length, 0);
    assert.deepEqual(dl.mismatchesFor(w.s, w.actor('business'), 'team-brake'), [], 'blocked is not a mismatch');
    w.fails('APPROVAL_REQUIRED', () => w.as('business', (c) => dl.dispatchToVehicle(c, 'VEH-003')));
  });

  test('a cancelled dispatch is not pushed again by a later report', () => {
    const w = new World(demoState());
    const f = feature(w, 'guided_brake');
    const [d] = w.as('brake_tester', (c) => v.dispatchFeature(c, f.id, { commitId: f.headCommitId!, vehicleGroupIds: [groupId(w, '制动研发车组')] }));
    w.as('brake_tester', (c) => v.cancelDeployment(c, d!, '换个时间'));
    w.sys((c) => reportNow(c, 'VEH-001'));
    assert.equal(follows(w, 'VEH-001').length, 0);
    assert.deepEqual(w.s.deployments[d!]!.targets.map((t) => [t.status, t.pushedAt]), [
      ['CANCELLED', null],
      ['CANCELLED', null],
    ]);
  });
});
