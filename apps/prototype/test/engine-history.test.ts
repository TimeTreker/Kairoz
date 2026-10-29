import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import * as ap from '../src/engine/applicability.ts';
import { Engine } from '../src/engine/engine.ts';
import * as fleet from '../src/engine/fleet.ts';
import * as h from '../src/engine/history.ts';
import * as integ from '../src/engine/integration.ts';
import * as ota from '../src/engine/ota.ts';
import * as rel from '../src/engine/release.ts';
import { demoState } from '../src/engine/seed.ts';
import { sendReceipt } from '../src/engine/simulator.ts';
import * as v from '../src/engine/validation.ts';
import { carRuns, plmPublish, tspCar } from '../acceptance/helpers.ts';

const MANIFEST = {
  signals: ['brake_pressure', 'steering_angle_rate', 'steering_return_rate', 'vehicle_deceleration', 'vehicle_speed'],
  sources: [{ unit: 'CHASSIS', directory: '/var/log' }, { unit: 'ADC', directory: '/var/log' }],
};

/** The demo with steering_return_rate integrated, verified and published as DCL 1.0.1 for 1.0. */
function secondSet() {
  const e = new Engine(demoState());
  const s = e.getState();
  const steering = Object.values(s.features).find((f) => f.name === 'steering_return_rate')!;
  const plan = e.run('integrator', (c) => integ.previewMerge(c, { workspaceId: 'x89-project', featureIds: [steering.id] }));
  e.run('dcl', (c) => integ.confirmProcessing(c, plan, { note: '' }));
  const cand = e.run('integrator', (c) => integ.freezeCandidate(c, plan, { label: 'X89-C2' }));
  const vg = Object.values(s.vehicleGroups).find((g) => g.name === 'X89 集成测试车组')!.id;
  const d = e.run('integration_tester', (c) => v.dispatchCandidate(c, cand, { vehicleGroupIds: [vg] }));
  for (const r of ['SIM-101', 'VEH-031']) e.run(null, (c) => sendReceipt(c, d, r, 'APPLIED'));
  for (const r of ['SIM-101', 'VEH-031']) e.run('integration_tester', (c) => v.recordCandidateTest(c, cand, { resourceId: r, result: 'PASS', summary: 'ok' }));
  e.run('integration_tester', (c) => v.verifyCandidate(c, cand));
  const r101 = e.run('release', (c) => rel.promoteCandidate(c, cand, { dclVersion: '1.0.1', vehicleIntegrationVersions: ['1.0'], notes: '回正采集' }));
  const r100 = rel.releasesOf(e.getState(), 'X89').find((r) => r.dclVersion === '1.0.0')!.id;
  const production = Object.values(s.vehicleGroups).find((g) => g.name === 'X89 量产车组')!.id;
  return { e, r100, r101, production };
}

const kinds = (entries: h.HistoryEntry[]) => entries.map((x) => x.kind);

describe('release history', () => {
  test('the demo: software 1.0 took DCL 1.0.0 and its rollout completed; 1.1 has no set yet', () => {
    const s = demoState();
    const r100 = rel.releasesOf(s, 'X89')[0]!;
    const history = h.versionHistory(s, 'X89', '1.0');
    assert.deepEqual(kinds(history), ['PLM_PUBLISHED', 'PUBLISHED', 'OTA_STARTED', 'OTA_COMPLETED']);
    assert.equal(history[0]!.by, null, 'PLM published it; the platform synced it');
    assert.deepEqual([history[1]!.by, history[1]!.releaseId, history[1]!.changed, history[1]!.inEffect], ['release', r100.id, true, r100.id]);
    assert.deepEqual(history[2]!.resourceIds, ['VEH-201', 'VEH-202']);
    assert.equal(history[3]!.by, null, 'the last receipt completes a rollout');
    assert.deepEqual(h.setsOverTime(history), [r100.id]);

    const later = h.versionHistory(s, 'X89', '1.1');
    assert.deepEqual(kinds(later), ['PLM_PUBLISHED']);
    assert.equal(later[0]!.inEffect, null);
    assert.deepEqual(h.softwareVersionsOf(s, 'X89').map((x) => x.version), ['1.1', '1.0']);
    // The production cars by rollout; the test groups' vehicles by the set mapped to their software.
    assert.deepEqual(h.vehiclesRunning(s, r100).map((x) => x.id).sort(), ['SIM-101', 'SIM-141', 'SIM-151', 'VEH-031', 'VEH-141', 'VEH-151', 'VEH-201', 'VEH-202']);
  });

  test('a rollout logs every step; a newer set supersedes the older one for the version; a rollback returns to it', () => {
    const { e, r100, r101, production } = secondSet();
    const id = e.run('release', (c) => ota.createOta(c, { releaseId: r101, vehicleGroupIds: [production], firstWave: ['VEH-201'] }));
    e.run(null, (c) => sendReceipt(c, id, 'VEH-201', 'FAILED', 'flash timeout'));
    e.run('release', (c) => ota.resumeOta(c, id));
    e.run(null, (c) => sendReceipt(c, id, 'VEH-201', 'APPLIED'));
    e.run('release', (c) => ota.pauseOta(c, id, '观察首批数据'));
    e.run('release', (c) => ota.resumeOta(c, id));
    e.run('release', (c) => ota.expandOta(c, id, 'ALL'));
    e.run(null, (c) => sendReceipt(c, id, 'VEH-202', 'APPLIED'));
    const [back] = e.run('release', (c) => ota.rollbackOta(c, id, '售后反馈回正误触发'));
    const s = e.getState();

    const log = s.deployments[id]!.log!;
    assert.deepEqual(
      log.map((x) => [x.kind, x.by, x.resourceIds]),
      [
        ['STARTED', 'release', ['VEH-201']],
        ['AUTO_PAUSED', null, ['VEH-201']],
        ['RESUMED', 'release', ['VEH-201']],
        ['PAUSED', 'release', []],
        ['RESUMED', 'release', []],
        ['EXPANDED', 'release', ['VEH-202']],
        ['COMPLETED', null, []],
        ['ROLLED_BACK', 'release', ['VEH-201', 'VEH-202']],
      ],
    );
    assert.equal(log[3]!.reason, '观察首批数据');
    assert.deepEqual(s.deployments[id]!.targets.map((t) => t.software), ['1.0', '1.0']);
    assert.deepEqual(s.deployments[back!]!.log!.map((x) => [x.kind, x.reason]), [['STARTED', '售后反馈回正误触发']]);

    const set = h.releaseHistory(s, r101);
    assert.deepEqual(kinds(set).slice(0, 2), ['PUBLISHED', 'IN_EFFECT']);
    assert.equal(set[1]!.version, '1.0');
    assert.deepEqual(kinds(set).filter((k) => k.startsWith('OTA_')), ['OTA_STARTED', 'OTA_AUTO_PAUSED', 'OTA_RESUMED', 'OTA_PAUSED', 'OTA_RESUMED', 'OTA_EXPANDED', 'OTA_COMPLETED', 'OTA_ROLLED_BACK']);

    // The older set: superseded for 1.0 by 1.0.1, and the rollback rollout returns vehicles to it.
    const older = h.releaseHistory(s, r100);
    const superseded = older.find((x) => x.kind === 'SUPERSEDED')!;
    assert.deepEqual([superseded.version, superseded.releaseId, superseded.by], ['1.0', r101, 'release']);
    const rollback = older.filter((x) => x.deploymentId === back);
    assert.deepEqual(kinds(rollback), ['OTA_STARTED']);

    const version = h.versionHistory(s, 'X89', '1.0');
    assert.deepEqual(h.setsOverTime(version), [r100, r101]);
    assert.equal(version.at(-1)!.inEffect, rel.setInEffect(s, 'X89', '1.0')!.id);
    assert.ok(version.every((x, i) => i === 0 || version[i - 1]!.at <= x.at), 'oldest first');
  });

  test('applicability checks and records, and vehicles moving software, show on the version', () => {
    const e = new Engine(demoState());
    const r100 = rel.releasesOf(e.getState(), 'X89')[0]!.id;
    plmPublish(e, 'X89', '1.2', { manifest: MANIFEST });
    carRuns(e, 'VEH-202', '1.2');
    const check = Object.values(e.getState().applicabilityChecks).find((c) => c.version === '1.2')!;
    e.run('dcl', (c) => fleet.registerImage(c, { id: 'x89-1.2-sim', vehicleModelId: 'X89', integrationVersion: '1.2', build: 'x89-1.2.0', digest: 'sha256:mock-x89-1-2', simulator: 'SimOne 3' }));
    e.run('integration_admin', (c) => fleet.createSimulation(c, { id: 'SIM-112', workspaceId: 'x89-integration', imageId: 'x89-1.2-sim', env: 'testing', pool: 'Vehicle' }));
    tspCar(e, 'LSDEMX89000001200', 'X89');
    e.run('resource', (c) => fleet.registerPhysical(c, { id: 'VEH-012', vin: 'LSDEMX89000001200', vehicleModelId: 'X89', env: 'testing', pool: 'Vehicle' }));
    carRuns(e, 'VEH-012', '1.2');
    e.run('integration_admin', (c) => fleet.addWorkspaceVehicle(c, 'x89-integration', 'VEH-012'));
    const vehicles = ['SIM-112', 'VEH-012'];
    const d = e.run('integration_tester', (c) => ap.dispatchApplicability(c, check.id, { resourceIds: vehicles }));
    for (const r of vehicles) e.run(null, (c) => sendReceipt(c, d, r, 'APPLIED'));
    for (const r of vehicles) e.run('integration_tester', (c) => ap.recordApplicabilityTest(c, check.id, { resourceId: r, result: 'PASS', summary: '采集回归通过' }));
    e.run('integration_tester', (c) => ap.verifyApplicability(c, check.id));
    e.run('release', (c) => ap.confirmApplicability(c, check.id, { note: '1.2 采集回归通过' }));
    e.run('release', (c) => ap.withdrawApplicability(c, { releaseId: r100, version: '1.2', reason: '1.2 现场问题' }));
    const s = e.getState();

    const version = h.versionHistory(s, 'X89', '1.2');
    assert.deepEqual(
      kinds(version).filter((k) => k !== 'VEHICLE_ARRIVED'),
      ['PLM_PUBLISHED', 'CHECK_OPENED', 'CHECK_VERIFIED', 'CHECK_CONFIRMED', 'APPLICABILITY_ADDED', 'APPLICABILITY_WITHDRAWN'],
    );
    assert.equal(version.find((x) => x.kind === 'CHECK_OPENED')!.by, null, 'opened by recording the software');
    const added = version.find((x) => x.kind === 'APPLICABILITY_ADDED')!;
    const withdrawn = version.find((x) => x.kind === 'APPLICABILITY_WITHDRAWN')!;
    assert.deepEqual([added.changed, added.inEffect], [true, r100]);
    assert.deepEqual([withdrawn.changed, withdrawn.inEffect, withdrawn.reason], [true, null, '1.2 现场问题']);
    assert.deepEqual(h.setsOverTime(version), [r100, null]);
    // A vehicle's first known version is no change (VEH-012); moving from 1.0 is (VEH-202).
    assert.deepEqual(version.filter((x) => x.kind === 'VEHICLE_ARRIVED').flatMap((x) => x.resourceIds), ['VEH-202']);
    const left = h.versionHistory(s, 'X89', '1.0').find((x) => x.kind === 'VEHICLE_LEFT')!;
    assert.deepEqual([left.resourceIds, left.reason], [['VEH-202'], '1.2']);

    const set = h.releaseHistory(s, r100);
    assert.deepEqual(
      set.filter((x) => x.version === '1.2').map((x) => x.kind),
      ['CHECK_OPENED', 'CHECK_VERIFIED', 'CHECK_CONFIRMED', 'APPLICABILITY_ADDED', 'IN_EFFECT', 'APPLICABILITY_WITHDRAWN', 'SUPERSEDED'],
    );
    assert.equal(set.find((x) => x.kind === 'SUPERSEDED' && x.version === '1.2')!.releaseId, null, 'no set took over');
  });

  test('software versions belong to one vehicle model', () => {
    const e = new Engine(demoState());
    plmPublish(e, 'X90', '1.0', { manifest: MANIFEST });
    const s = e.getState();
    assert.deepEqual(kinds(h.versionHistory(s, 'X90', '1.0')), ['PLM_PUBLISHED']);
    assert.deepEqual(kinds(h.versionHistory(s, 'X89', '1.0')), ['PLM_PUBLISHED', 'PUBLISHED', 'OTA_STARTED', 'OTA_COMPLETED']);
    assert.equal(h.versionHistory(s, 'X90', '1.0')[0]!.inEffect, null);
  });
});
