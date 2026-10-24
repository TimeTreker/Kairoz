import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { DomainError } from '../src/domain/errors.ts';
import * as ap from '../src/engine/applicability.ts';
import { Engine } from '../src/engine/engine.ts';
import * as fleet from '../src/engine/fleet.ts';
import * as integ from '../src/engine/integration.ts';
import * as rel from '../src/engine/release.ts';
import { demoState } from '../src/engine/seed.ts';
import { sendReceipt } from '../src/engine/simulator.ts';
import * as v from '../src/engine/validation.ts';

function fails(fn: () => unknown, code: string): DomainError {
  try {
    fn();
  } catch (e) {
    if (e instanceof DomainError && e.code === code) return e;
    throw new Error(`expected ${code}, got ${e instanceof DomainError ? `${e.code} ${JSON.stringify(e.details)}` : e}`);
  }
  throw new Error(`expected ${code}, but it succeeded`);
}

const MANIFEST_12 = {
  signals: ['brake_pressure', 'steering_angle_rate', 'steering_return_rate', 'vehicle_deceleration', 'vehicle_speed'],
  sources: [{ unit: 'CHASSIS', directory: '/var/log' }, { unit: 'ADC', directory: '/var/log' }],
};
/** Software 1.3 renamed steering_angle_rate. */
const MANIFEST_13 = { ...MANIFEST_12, signals: MANIFEST_12.signals.map((s) => (s === 'steering_angle_rate' ? 'steering_wheel_rate' : s)) };

function record(e: Engine, version: string, manifest: typeof MANIFEST_12 | null) {
  e.run('resource', (c) => fleet.recordSoftwareVersion(c, { vehicleModelId: 'X89', version, source: `整车 OTA 发布记录 X89-${version}`, manifest }));
}

/** A simulation and a physical testing vehicle on `version`, in the integration workspace, routing through no group. */
function testVehiclesOn(e: Engine, version: string, n: number): string[] {
  const image = `x89-${version}-sim`;
  e.run('dcl', (c) => fleet.registerImage(c, { id: image, vehicleModelId: 'X89', integrationVersion: version, build: `x89-${version}.0`, digest: `sha256:mock-x89-${version.replace('.', '-')}`, simulator: 'SimOne 3' }));
  const sim = `SIM-1${n}`;
  const veh = `VEH-0${n}`;
  e.run('integration_admin', (c) => fleet.createSimulation(c, { id: sim, workspaceId: 'x89-integration', imageId: image, env: 'testing', pool: 'Vehicle' }));
  e.run('resource', (c) => fleet.registerPhysical(c, { id: veh, vin: `LSDEMX89000000${n}0`.slice(0, 17), vehicleModelId: 'X89', env: 'testing', pool: 'Vehicle' }));
  e.run('resource', (c) => fleet.confirmIntegration(c, veh, { version, source: 'DIP 上报' }));
  e.run('integration_admin', (c) => fleet.addWorkspaceVehicle(c, 'x89-integration', veh));
  return [sim, veh];
}

/** Integration testing passes the check on both vehicles and verifies it. */
function verifyCheck(e: Engine, checkId: string, vehicles: string[]): void {
  const d = e.run('integration_tester', (c) => ap.dispatchApplicability(c, checkId, { resourceIds: vehicles }));
  for (const r of vehicles) e.run(null, (c) => sendReceipt(c, d, r, 'APPLIED'));
  for (const r of vehicles) e.run('integration_tester', (c) => ap.recordApplicabilityTest(c, checkId, { resourceId: r, result: 'PASS', summary: '采集回归通过' }));
  e.run('integration_tester', (c) => ap.verifyApplicability(c, checkId));
}

const checksFor = (e: Engine, version: string) => Object.values(e.getState().applicabilityChecks).filter((c) => c.version === version);

describe('policy sets and software versions', () => {
  test('recording a software version no set applies to opens a check for the newest set', () => {
    const e = new Engine(demoState());
    record(e, '1.2', MANIFEST_12);
    const [check] = checksFor(e, '1.2');
    const s = e.getState();
    assert.equal(check!.status, 'OPEN');
    assert.equal(check!.auto, true);
    assert.equal(s.releases[check!.releaseId]!.dclVersion, '1.0.0');
    assert.equal(check!.testWorkspaceId, 'x89-integration');
    // Software that a set already applies to opens nothing.
    assert.equal(checksFor(e, '1.0').length, 0);
  });

  test('each policy is checked against the software manifest', () => {
    const e = new Engine(demoState());
    record(e, '1.2', MANIFEST_12);
    record(e, '1.3', MANIFEST_13);
    record(e, '1.4', null);
    const s = e.getState();
    const release = rel.releasesOf(s, 'X89')[0]!;
    assert.deepEqual(ap.compatibilityOf(s, release.id, '1.2').map((c) => [c.policyId, c.status]), [['chassis.steering.angle_jump', 'OK']]);
    assert.deepEqual(ap.compatibilityOf(s, release.id, '1.3')[0], { policyId: 'chassis.steering.angle_jump', status: 'MISSING', missingSignals: ['steering_angle_rate'], missingSources: [] });
    assert.equal(ap.compatibilityOf(s, release.id, '1.4')[0]!.status, 'UNKNOWN');
  });

  test('confirming appends a record; the set keeps its content and version; blocked production vehicles resolve', () => {
    const e = new Engine(demoState());
    record(e, '1.2', MANIFEST_12);
    e.run('resource', (c) => fleet.confirmIntegration(c, 'VEH-202', { version: '1.2', source: '整车 OTA 回执' }));
    let s = e.getState();
    const release = rel.releasesOf(s, 'X89')[0]!;
    assert.deepEqual(ap.blockedProductionVehicles(s, 'X89').map((r) => r.id), ['VEH-202']);
    assert.match(rel.releaseFor(s, s.resources['VEH-202']!).problem!, /no policy set applies to X89 1.2/);

    const [check] = checksFor(e, '1.2');
    fails(() => e.run('release', (c) => ap.confirmApplicability(c, check!.id, { note: '回归通过' })), 'CHECK_NOT_VERIFIED');
    fails(() => e.run('release', (c) => ap.dispatchApplicability(c, check!.id, { resourceIds: ['VEH-031'] })), 'FORBIDDEN');
    const vehicles = testVehiclesOn(e, '1.2', 12);
    // Vehicles on other software can't test the check.
    const group = Object.values(s.vehicleGroups).find((g) => g.name === 'X89 集成测试车组')!.id;
    const wrong = fails(() => e.run('integration_tester', (c) => ap.dispatchApplicability(c, check!.id, { vehicleGroupIds: [group] })), 'DISPATCH_BLOCKED');
    assert.match((wrong.details as { issues: string[] }).issues.join(), /SIM-101: runs software 1.0; the check is for 1.2/);
    verifyCheck(e, check!.id, vehicles);
    fails(() => e.run('integration_tester', (c) => ap.confirmApplicability(c, check!.id, { note: '回归通过' })), 'FORBIDDEN');
    e.run('release', (c) => ap.confirmApplicability(c, check!.id, { note: '1.2 采集回归通过' }));

    s = e.getState();
    const after = s.releases[release.id]!;
    assert.equal(after.dclVersion, '1.0.0');
    assert.deepEqual(after.vehicleIntegrationVersions, ['1.0']);
    assert.deepEqual(rel.applicableVersions(s, after), ['1.0', '1.2']);
    assert.equal(s.applicabilityChecks[check!.id]!.status, 'CONFIRMED');
    assert.deepEqual(s.applicability.map((a) => [a.action, a.version, a.checkId]), [['ADD', '1.2', check!.id]]);
    assert.equal(rel.releaseFor(s, s.resources['VEH-202']!).release?.id, release.id);
    assert.deepEqual(ap.blockedProductionVehicles(s, 'X89'), []);
    fails(() => e.run('release', (c) => ap.openApplicabilityCheck(c, { releaseId: release.id, version: '1.2' })), 'ALREADY_APPLIES');

    // Withdrawing appends another record; with no older set, the vehicle is blocked again.
    e.run('release', (c) => ap.withdrawApplicability(c, { releaseId: release.id, version: '1.2', reason: '1.2 现场问题' }));
    s = e.getState();
    assert.deepEqual(s.applicability.map((a) => a.action), ['ADD', 'WITHDRAW']);
    assert.equal(rel.appliesTo(s, s.releases[release.id]!, '1.2'), false);
    assert.deepEqual(ap.blockedProductionVehicles(s, 'X89').map((r) => r.id), ['VEH-202']);
    fails(() => e.run('release', (c) => ap.withdrawApplicability(c, { releaseId: release.id, version: '1.2', reason: 'again' })), 'NOT_APPLICABLE');
  });

  test('a policy the software cannot run, or a missing manifest, refuses confirmation', () => {
    const e = new Engine(demoState());
    record(e, '1.3', MANIFEST_13);
    const [check] = checksFor(e, '1.3');
    verifyCheck(e, check!.id, testVehiclesOn(e, '1.3', 13));
    const err = fails(() => e.run('release', (c) => ap.confirmApplicability(c, check!.id, { note: 'try' })), 'INCOMPATIBLE_POLICIES');
    assert.deepEqual((err.details as { issues: string[] }).issues, ['chassis.steering.angle_jump: missing steering_angle_rate']);

    record(e, '1.4', null);
    const [unknown] = checksFor(e, '1.4');
    verifyCheck(e, unknown!.id, testVehiclesOn(e, '1.4', 14));
    fails(() => e.run('release', (c) => ap.confirmApplicability(c, unknown!.id, { note: 'try' })), 'MANIFEST_MISSING');
    e.run('resource', (c) => fleet.setSoftwareManifest(c, { vehicleModelId: 'X89', version: '1.4', manifest: MANIFEST_12 }));
    fails(() => e.run('resource', (c) => fleet.setSoftwareManifest(c, { vehicleModelId: 'X89', version: '1.4', manifest: MANIFEST_12 })), 'MANIFEST_RECORDED');
    e.run('release', (c) => ap.confirmApplicability(c, unknown!.id, { note: '清单补录后确认' }));
  });

  test('a newer set listing the version supersedes the check; an older set cannot shadow a newer one; diffs go policy by policy', () => {
    const e = new Engine(demoState());
    record(e, '1.2', MANIFEST_12);
    const [check] = checksFor(e, '1.2');
    // VEH-031 runs 1.2 when the next candidate is tested, so the new set may list 1.2.
    e.run('resource', (c) => fleet.confirmIntegration(c, 'VEH-031', { version: '1.2', source: 'DIP 上报' }));
    let s = e.getState();
    const steering = Object.values(s.features).find((f) => f.name === 'steering_return_rate')!;
    const plan = e.run('integrator', (c) => integ.previewMerge(c, { workspaceId: 'x89-project', featureIds: [steering.id] }));
    e.run('dcl', (c) => integ.confirmProcessing(c, plan, { note: '' }));
    const cand = e.run('integrator', (c) => integ.freezeCandidate(c, plan, { label: 'X89-C2' }));
    const vg = Object.values(s.vehicleGroups).find((g) => g.name === 'X89 集成测试车组')!.id;
    const d = e.run('integration_tester', (c) => v.dispatchCandidate(c, cand, { vehicleGroupIds: [vg] }));
    for (const r of ['SIM-101', 'VEH-031']) e.run(null, (c) => sendReceipt(c, d, r, 'APPLIED'));
    for (const r of ['SIM-101', 'VEH-031']) e.run('integration_tester', (c) => v.recordCandidateTest(c, cand, { resourceId: r, result: 'PASS', summary: 'ok' }));
    e.run('integration_tester', (c) => v.verifyCandidate(c, cand));
    const newer = e.run('release', (c) => rel.promoteCandidate(c, cand, { dclVersion: '1.0.1', vehicleIntegrationVersions: ['1.0', '1.2'] }));

    s = e.getState();
    assert.equal(s.applicabilityChecks[check!.id]!.status, 'SUPERSEDED');
    const older = rel.releasesOf(s, 'X89').find((r) => r.dclVersion === '1.0.0')!;
    assert.equal(rel.setInEffect(s, 'X89', '1.0')!.id, newer);
    assert.deepEqual(rel.versionsInEffect(s, older), []);
    fails(() => e.run('release', (c) => ap.openApplicabilityCheck(c, { releaseId: older.id, version: '1.2' })), 'APPLICABILITY_SHADOWED');

    const diff = rel.releaseDiff(s, older.id, newer);
    assert.deepEqual(diff.groups.map((g) => [s.groups[g.groupId]!.code, g.status]), [['chassis.steering', 'CHANGED']]);
    assert.deepEqual(diff.policies.map((p) => [p.policyId, p.from, p.to]), [
      ['chassis.steering.angle_jump', 1, 2],
      ['chassis.steering.return_rate', null, 1],
    ]);
    assert.equal(rel.previousRelease(s, s.releases[newer]!)!.id, older.id);
  });
});
