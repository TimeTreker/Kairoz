import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { produce } from 'immer';
import { answerAll, plmPublish } from '../acceptance/helpers.ts';
import { World } from '../acceptance/world.ts';
import * as config from '../src/engine/config.ts';
import { decideEmergencyStop, requestEmergencyStop } from '../src/engine/emergency.ts';
import * as fleet from '../src/engine/fleet.ts';
import { demoState } from '../src/engine/seed.ts';
import { reportNow, simulateSoftwareOta } from '../src/engine/simulator.ts';
import * as sc from '../src/engine/software-change.ts';
import * as v from '../src/engine/validation.ts';

const feature = (w: World, name: string) => Object.values(w.s.features).find((f) => f.name === name)!;
const set = (w: World, version: string) => Object.values(w.s.releases).find((r) => r.dclVersion === version)!;
const groupId = (w: World, name: string) => Object.values(w.s.vehicleGroups).find((g) => g.name === name)!.id;
const changesOf = (w: World, rid: string) => Object.values(w.s.softwareChanges).filter((c) => c.resourceId === rid).sort((a, b) => a.seq - b.seq);
const latest = (w: World, rid: string) => changesOf(w, rid).at(-1)!;

/** The demo, with policy set 1.0.0 also applying to software 1.1 (as an applicability check would add). */
function demoWith11(): World {
  return new World(
    produce(demoState(), (s) => {
      const release = Object.values(s.releases).find((r) => r.dclVersion === '1.0.0')!;
      s.applicability.push({ id: 'ap_test', seq: ++s.seq, releaseId: release.id, vehicleModelId: 'X89', version: '1.1', action: 'ADD', checkId: null, reason: 'test', by: 'release', at: '2026-10-24T00:00:00.000Z' });
    }),
  );
}

/** The vehicle's software changes on the car; its next signed report tells the platform. */
function ota(w: World, rid: string, version: string): void {
  w.sys((c) => simulateSoftwareOta(c, rid, version));
  w.sys((c) => reportNow(c, rid));
}

const MANIFEST_13 = {
  signals: ['apa.active', 'brake_fault_code', 'brake_pressure', 'steering_angle_rate', 'steering_return_rate', 'vehicle_deceleration', 'vehicle_speed'],
  sources: [
    { unit: 'ADC', directory: '/data' },
    { unit: 'ADC', directory: '/var/log/chassis' },
    { unit: 'CHASSIS', directory: '/var/log' },
  ],
};

describe('vehicle software changes', () => {
  test('a signed report of a known version changes the vehicle; an unknown one waits for vehicle resources', () => {
    const w = demoWith11();
    ota(w, 'VEH-001', '1.1');
    const c = latest(w, 'VEH-001');
    assert.deepEqual([w.s.resources['VEH-001']!.integrationVersion, c.fromVersion, c.toVersion, c.source, c.status], ['1.1', '1.0', '1.1', 'CLIENT_REPORT', 'APPLIED']);
    ota(w, 'VEH-001', '1.3');
    const u = latest(w, 'VEH-001');
    assert.deepEqual([w.s.resources['VEH-001']!.integrationVersion, u.toVersion, u.status], ['1.1', '1.3', 'UNRECORDED']);
    assert.deepEqual(sc.unrecordedReports(w.s, w.actor('resource')).map((x) => x.id), [u.id]);
    plmPublish(w.engine, 'X89', '1.3', { manifest: MANIFEST_13 });
    w.as('resource', (c) => fleet.confirmIntegration(c, 'VEH-001', { version: '1.3', source: '客户端上报' }));
    assert.equal(w.s.softwareChanges[u.id]!.status, 'RESOLVED');
    assert.deepEqual([latest(w, 'VEH-001').fromVersion, latest(w, 'VEH-001').toVersion, latest(w, 'VEH-001').source], ['1.1', '1.3', 'CONFIRMED']);
  });

  test('same set, everything runnable: confirm only; the earlier result still counts', () => {
    const w = demoWith11();
    ota(w, 'VEH-001', '1.1');
    const a = sc.assessSoftwareChange(w.s, latest(w, 'VEH-001').id);
    assert.deepEqual([a.outcome, a.runningBaseId, a.newBaseId, a.baseChanged], ['NONE', set(w, '1.0.0').id, set(w, '1.0.0').id, false]);
    assert.ok(a.files.every((f) => f.status === 'OK') && a.policies.every((p) => p.status === 'OK'));
    const vehicle = v.featureTestStatus(w.s, feature(w, 'brake_monitor')).find((t) => t.resourceId === 'VEH-001')!;
    assert.equal(vehicle.latest?.integrationVersion, '1.0', 'tested on 1.0 and still counts');
    // Only the vehicle's team confirms, once.
    assert.deepEqual(sc.softwareChangesFor(w.s, w.actor('business'), 'team-brake').map((c) => c.id), [a.change.id]);
    w.denied('steering', (c) => sc.acknowledgeSoftwareChange(c, a.change.id));
    w.as('brake_tester', (c) => sc.acknowledgeSoftwareChange(c, a.change.id));
    w.fails('ALREADY_ACKNOWLEDGED', () => w.as('business', (c) => sc.acknowledgeSoftwareChange(c, a.change.id)));
    assert.deepEqual(sc.softwareChangesFor(w.s, w.actor('business'), 'team-brake'), []);
  });

  test('a missing source flags the file and the policies that capture it; no set gives NO_BASE, an explicit base FIX', () => {
    const w = demoWith11();
    plmPublish(w.engine, 'X89', '1.3', { manifest: MANIFEST_13 });
    ota(w, 'VEH-001', '1.3');
    let a = sc.assessSoftwareChange(w.s, latest(w, 'VEH-001').id);
    assert.equal(a.outcome, 'NO_BASE');
    assert.deepEqual(a.files.map((f) => [f.name, f.status]), [['制动监测日志', 'SOURCE_MISSING']]);
    assert.deepEqual(a.policies.map((p) => [p.policyId, p.status, p.problemFiles]), [
      ['chassis.brake.failure_diag', 'MISSING', ['制动监测日志']],
      ['chassis.brake.monitor', 'MISSING', ['制动监测日志']],
    ]);
    w.as('workspace_manager', (c) => fleet.setGroupBase(c, groupId(w, '制动研发车组'), set(w, '1.0.0').id));
    a = sc.assessSoftwareChange(w.s, a.change.id);
    assert.equal(a.outcome, 'FIX');
    // The team moves the file to a directory 1.3 provides and points the policies at it.
    const f = feature(w, 'brake_monitor');
    const moved = w.as('business', (c) =>
      config.addFile(c, f.id, { source: { unit: 'ADC', directory: '/var/log/chassis/brake', pattern: 'monitor.log' }, name: '制动监测日志（新路径）', purpose: '急刹车与故障诊断' }),
    );
    const old = Object.keys(f.draft.files)[0]!;
    for (const [id, p] of Object.entries(f.draft.policies)) w.as('business', (c) => config.putPolicy(c, f.id, id, { ...p, captures: [moved] }));
    w.as('business', (c) => config.removeFile(c, f.id, old));
    const commitId = w.as('business', (c) => config.submitFeature(c, f.id, {})).commitId;
    for (const d of w.as('brake_tester', (c) => v.dispatchFeature(c, f.id, { commitId, vehicleGroupIds: [groupId(w, '制动研发车组')] }))) answerAll(w, d);
    assert.equal(sc.assessSoftwareChange(w.s, a.change.id).outcome, 'NONE');
  });

  test('a new base without the group publishes again; a base that changed the group needs a new Feature', () => {
    const w = demoWith11();
    // 1.0.1: set 1.0.0 without a steering policy, for 1.0 and 1.1.
    const stop = w.as('dcl', (c) => requestEmergencyStop(c, { releaseId: set(w, '1.0.0').id, policyId: 'chassis.steering.angle_jump', reason: '误触发' }));
    w.as('release', (c) => decideEmergencyStop(c, stop, { decision: 'APPROVED', note: 'ok' }));
    const next = set(w, '1.0.1');
    ota(w, 'VEH-001', '1.1');
    const brake = sc.assessSoftwareChange(w.s, latest(w, 'VEH-001').id);
    assert.deepEqual([brake.outcome, brake.runningBaseId, brake.newBaseId, brake.changedGroups], ['REPUBLISH', set(w, '1.0.0').id, next.id, ['chassis.steering']]);
    // The vehicle no longer runs what the result was recorded on, so it stops counting.
    const vehicle = v.featureTestStatus(w.s, feature(w, 'brake_monitor')).find((t) => t.resourceId === 'VEH-001')!;
    assert.deepEqual([vehicle.latest, vehicle.stale?.integrationVersion], [null, '1.0']);
    assert.equal(feature(w, 'brake_monitor').stage, 'VERIFIED', 'verified stays verified');

    ota(w, 'VEH-003', '1.1');
    const steering = sc.assessSoftwareChange(w.s, latest(w, 'VEH-003').id);
    assert.deepEqual([steering.outcome, steering.conflict, steering.newBaseId], ['NEW_FEATURE', true, next.id]);
    const f2 = w.as('steering', (c) => config.createFeature(c, { workspaceId: 'team-steering', groupId: 'steering', name: 'steering_return_rate_v2', baseReleaseId: next.id }));
    assert.equal(w.s.features[f2]!.baseReleaseId, next.id);
    assert.ok(!('chassis.steering.angle_jump' in w.s.features[f2]!.draft.policies), 'the new Feature starts from the new base');
  });

  test('without a manifest the check cannot be made; production and simulations raise no team notice', () => {
    const w = demoWith11();
    plmPublish(w.engine, 'X89', '1.4');
    w.as('workspace_manager', (c) => fleet.setGroupBase(c, groupId(w, '制动研发车组'), set(w, '1.0.0').id));
    ota(w, 'VEH-001', '1.4');
    assert.equal(sc.assessSoftwareChange(w.s, latest(w, 'VEH-001').id).outcome, 'CANNOT_CHECK');
    ota(w, 'VEH-201', '1.1');
    assert.equal(sc.assessSoftwareChange(w.s, latest(w, 'VEH-201').id).outcome, 'PRODUCTION');
    w.fails('NOT_A_TEAM_CHANGE', () => w.as('release', (c) => sc.acknowledgeSoftwareChange(c, latest(w, 'VEH-201').id)));
    w.fails('SIMULATION_SOFTWARE_FROM_IMAGE', () => w.sys((c) => simulateSoftwareOta(c, 'SIM-021', '1.1')));
  });
});
