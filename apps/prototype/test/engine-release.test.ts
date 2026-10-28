import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { DomainError } from '../src/domain/errors.ts';
import * as config from '../src/engine/config.ts';
import { Engine } from '../src/engine/engine.ts';
import * as fleet from '../src/engine/fleet.ts';
import * as integ from '../src/engine/integration.ts';
import * as ota from '../src/engine/ota.ts';
import * as rel from '../src/engine/release.ts';
import { demoState } from '../src/engine/seed.ts';
import { sendReceipt, setAgent, tick } from '../src/engine/simulator.ts';
import * as v from '../src/engine/validation.ts';
import { carRuns } from '../acceptance/helpers.ts';

function fails(fn: () => unknown, code: string): DomainError {
  try {
    fn();
  } catch (e) {
    if (e instanceof DomainError && e.code === code) return e;
    throw new Error(`expected ${code}, got ${e instanceof DomainError ? `${e.code} ${JSON.stringify(e.details)}` : e}`);
  }
  throw new Error(`expected ${code}, but it succeeded`);
}

/** The demo with steering_return_rate integrated and its candidate verified. */
function verifiedCandidate() {
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
  const production = Object.values(s.vehicleGroups).find((g) => g.name === 'X89 量产车组')!.id;
  return { e, cand, production };
}

const appliedLabel = (e: Engine, id: string) => {
  const s = e.getState();
  const applied = s.resources[id]!.appliedConfigId;
  return applied ? s.resolvedConfigs[applied]!.label : null;
};

describe('formal release', () => {
  test('the demo runs DCL 1.0.0 on production vehicles; vehicles resolve to the newest matching release', () => {
    const e = new Engine(demoState());
    const s = e.getState();
    assert.deepEqual(rel.releasesOf(s, 'X89').map((r) => r.dclVersion), ['1.0.0']);
    assert.equal(appliedLabel(e, 'VEH-201'), 'DCL 1.0.0');
    assert.equal(rel.releaseFor(s, s.resources['VEH-201']!).release?.dclVersion, '1.0.0');
    assert.match(rel.releaseFor(s, s.resources['VEH-002']!).problem!, /unknown/);
  });

  test('promotion checks the version, the listed software and its test evidence; it changes no vehicle', () => {
    const { e, cand } = verifiedCandidate();
    const promote = (user: string, dclVersion: string, versions: string[]) => () => e.run(user, (c) => rel.promoteCandidate(c, cand, { dclVersion, vehicleIntegrationVersions: versions }));
    fails(promote('integrator', '1.0.1', ['1.0']), 'FORBIDDEN');
    fails(promote('release', '1.0', ['1.0']), 'INVALID_DCL_VERSION');
    fails(promote('release', '1.0.0', ['1.0']), 'DCL_VERSION_TAKEN');
    fails(promote('release', '0.9.9', ['1.0']), 'DCL_VERSION_NOT_NEWER');
    fails(promote('release', '1.0.1', []), 'NO_VEHICLE_VERSIONS');
    fails(promote('release', '1.0.1', ['9.9']), 'UNKNOWN_SOFTWARE_VERSION');
    const err = fails(promote('release', '1.0.1', ['1.0', '1.1']), 'VERSION_NOT_TESTED');
    assert.deepEqual((err.details as { issues: string[] }).issues, ['X89 1.1']);

    const id = e.run('release', (c) => rel.promoteCandidate(c, cand, { dclVersion: '1.0.1', vehicleIntegrationVersions: ['1.0'] }));
    const s = e.getState();
    assert.equal(s.releases[id]!.sequence, 2);
    assert.equal(s.candidates[cand]!.status, 'RELEASED');
    assert.equal(appliedLabel(e, 'VEH-201'), 'DCL 1.0.0', 'publishing changes no vehicle');
    assert.equal(rel.releaseFor(s, s.resources['VEH-201']!).release?.id, id);
    const next = e.run('business', (c) => config.createFeature(c, { workspaceId: 'team-brake', groupId: 'brake', name: 'brake_after_101' }));
    assert.equal(e.getState().features[next]!.baseReleaseId, id, 'new work builds on the newest release');
  });
});

describe('configuration OTA', () => {
  test('gray rollout: a failure pauses, resume retries with a new attempt, then expand and complete', () => {
    const { e, cand, production } = verifiedCandidate();
    const r101 = e.run('release', (c) => rel.promoteCandidate(c, cand, { dclVersion: '1.0.1', vehicleIntegrationVersions: ['1.0'] }));
    fails(() => e.run('integrator', (c) => ota.createOta(c, { releaseId: r101, vehicleGroupIds: [production], firstWave: ['VEH-201'] })), 'FORBIDDEN');
    const id = e.run('release', (c) => ota.createOta(c, { releaseId: r101, vehicleGroupIds: [production], firstWave: ['VEH-201'] }));
    const status = () => e.getState().deployments[id]!.targets.map((t) => [t.resourceId, t.status, t.attempt]);
    assert.deepEqual(status(), [
      ['VEH-201', 'PENDING', 0],
      ['VEH-202', 'QUEUED', 0],
    ]);
    // A queued vehicle stays where it is until the rollout is done.
    fails(() => e.run('release', (c) => fleet.removeGroupMember(c, production, 'VEH-202', 'x')), 'VEHICLE_BUSY');

    e.run(null, (c) => sendReceipt(c, id, 'VEH-201', 'FAILED', 'flash timeout'));
    assert.equal(e.getState().deployments[id]!.status, 'PAUSED');
    assert.equal(appliedLabel(e, 'VEH-201'), 'DCL 1.0.0', 'a failed apply keeps the confirmed configuration');
    fails(() => e.run('release', (c) => ota.expandOta(c, id, 'ALL')), 'OTA_PAUSED');

    e.run('release', (c) => ota.resumeOta(c, id));
    assert.deepEqual(status()[0], ['VEH-201', 'PENDING', 1]);
    assert.deepEqual(e.getState().deployments[id]!.targets[0]!.history.map((h) => [h.attempt, h.status]), [[0, 'FAILED']]);
    // The old failure stays evidence: a different answer for attempt 0 is refused, a replay is harmless.
    fails(() => e.run(null, (c) => v.acceptReceipt(c, { deploymentId: id, resourceId: 'VEH-201', attempt: 0, result: 'APPLIED' })), 'RECEIPT_CONFLICT');
    assert.equal(e.run(null, (c) => v.acceptReceipt(c, { deploymentId: id, resourceId: 'VEH-201', attempt: 0, result: 'FAILED' })), 'REPLAYED');
    e.run(null, (c) => sendReceipt(c, id, 'VEH-201', 'APPLIED'));
    assert.equal(appliedLabel(e, 'VEH-201'), 'DCL 1.0.1');
    assert.equal(e.getState().deployments[id]!.status, 'PENDING', 'VEH-202 is still queued');

    e.run('release', (c) => ota.expandOta(c, id, 'ALL'));
    e.run(null, (c) => sendReceipt(c, id, 'VEH-202', 'APPLIED'));
    assert.equal(e.getState().deployments[id]!.status, 'COMPLETED');

    // Rolling back returns both vehicles to DCL 1.0.0, which still fits their software.
    const [back] = e.run('release', (c) => ota.rollbackOta(c, id, '售后反馈回正误触发'));
    assert.equal(e.getState().deployments[id]!.status, 'ROLLED_BACK');
    assert.equal(e.getState().deployments[back!]!.rollbackOf, id);
    for (const r of ['VEH-201', 'VEH-202']) e.run(null, (c) => sendReceipt(c, back!, r, 'APPLIED'));
    assert.equal(appliedLabel(e, 'VEH-202'), 'DCL 1.0.0');
  });

  test('a pause holds every vehicle until an explicit resume; the simulator delivers nothing meanwhile', () => {
    const { e, cand, production } = verifiedCandidate();
    const r101 = e.run('release', (c) => rel.promoteCandidate(c, cand, { dclVersion: '1.0.1', vehicleIntegrationVersions: ['1.0'] }));
    const id = e.run('release', (c) => ota.createOta(c, { releaseId: r101, vehicleGroupIds: [production], firstWave: 'ALL' }));
    e.run(null, (c) => ['VEH-201', 'VEH-202'].forEach((r) => setAgent(c, r, { autoAck: true })));
    const status = () => e.getState().deployments[id]!.targets.map((t) => [t.resourceId, t.status, t.attempt]);

    e.run('release', (c) => ota.pauseOta(c, id, '观察首批数据'));
    assert.equal(e.run(null, (c) => tick(c)), 0, 'automatic vehicles do not answer a paused rollout');
    assert.deepEqual(status(), [
      ['VEH-201', 'PENDING', 0],
      ['VEH-202', 'PENDING', 0],
    ]);
    assert.equal(ota.answerConfigRequest(e.getState(), 'VEH-201').reason, 'HELD');
    // A vehicle that had already started keeps its receipt until the resume; nothing changes meanwhile.
    fails(() => e.run(null, (c) => sendReceipt(c, id, 'VEH-201', 'APPLIED')), 'OTA_PAUSED');
    assert.equal(appliedLabel(e, 'VEH-201'), 'DCL 1.0.0');

    e.run('release', (c) => ota.resumeOta(c, id));
    assert.equal(ota.answerConfigRequest(e.getState(), 'VEH-201').reason, 'TASK');
    e.run(null, (c) => sendReceipt(c, id, 'VEH-201', 'APPLIED'));
    e.run(null, (c) => tick(c));
    assert.equal(e.getState().deployments[id]!.status, 'COMPLETED');
    assert.equal(appliedLabel(e, 'VEH-202'), 'DCL 1.0.1');
  });

  test('a failure in an automatic step pauses the rollout before the next vehicle answers', () => {
    const { e, cand, production } = verifiedCandidate();
    const r101 = e.run('release', (c) => rel.promoteCandidate(c, cand, { dclVersion: '1.0.1', vehicleIntegrationVersions: ['1.0'] }));
    const id = e.run('release', (c) => ota.createOta(c, { releaseId: r101, vehicleGroupIds: [production], firstWave: 'ALL' }));
    e.run(null, (c) => {
      setAgent(c, 'VEH-201', { autoAck: true, fault: 'APPLY_INTERRUPTED' });
      setAgent(c, 'VEH-202', { autoAck: true });
    });
    assert.equal(e.run(null, (c) => tick(c)), 1);
    const d = e.getState().deployments[id]!;
    assert.equal(d.status, 'PAUSED');
    assert.deepEqual(d.targets.map((t) => t.status), ['FAILED', 'PENDING']);
    assert.equal(appliedLabel(e, 'VEH-202'), 'DCL 1.0.0');

    e.run('release', (c) => ota.cancelOta(c, id, '停止本次 OTA'));
    assert.equal(e.run(null, (c) => tick(c)), 0, 'a cancelled rollout is not delivered either');
    fails(() => e.run(null, (c) => sendReceipt(c, id, 'VEH-202', 'APPLIED')), 'TARGET_NOT_PENDING');
  });

  test('a receipt lost while the rollout pauses is resent after the resume and confirmed once', () => {
    const { e, cand, production } = verifiedCandidate();
    const r101 = e.run('release', (c) => rel.promoteCandidate(c, cand, { dclVersion: '1.0.1', vehicleIntegrationVersions: ['1.0'] }));
    const id = e.run('release', (c) => ota.createOta(c, { releaseId: r101, vehicleGroupIds: [production], firstWave: 'ALL' }));
    e.run(null, (c) => {
      setAgent(c, 'VEH-201', { autoAck: true, fault: 'DROP_RECEIPT' });
      setAgent(c, 'VEH-202', { autoAck: true, fault: 'CHECKSUM' });
    });
    e.run(null, (c) => tick(c));
    assert.equal(e.getState().deployments[id]!.status, 'PAUSED', 'the checksum failure pauses the rollout');
    assert.equal(appliedLabel(e, 'VEH-201'), 'DCL 1.0.0', 'VEH-201 applied 1.0.1, but no receipt confirmed it');
    e.run(null, (c) => setAgent(c, 'VEH-201', { fault: 'NONE' }));
    e.run(null, (c) => tick(c));
    assert.deepEqual(e.getState().devices['VEH-201']!.unsent.map((u) => u.lastError), ['OTA_PAUSED'], 'held by the pause');
    e.run(null, (c) => setAgent(c, 'VEH-202', { fault: 'NONE' }));
    e.run('release', (c) => ota.resumeOta(c, id));
    e.run(null, (c) => tick(c));
    assert.equal(e.getState().deployments[id]!.status, 'COMPLETED');
    assert.deepEqual([appliedLabel(e, 'VEH-201'), appliedLabel(e, 'VEH-202')], ['DCL 1.0.1', 'DCL 1.0.1']);
    assert.equal(e.getState().receipts.filter((r) => r.deploymentId === id && r.resourceId === 'VEH-201').length, 1);
  });

  test('every vehicle is checked against the release: software, newest match, rollback target', () => {
    const { e, cand, production } = verifiedCandidate();
    const first = Object.values(e.getState().deployments).find((d) => d.kind === 'OTA')!;
    const err = fails(() => e.run('release', (c) => ota.rollbackOta(c, first.id, 'x')), 'ROLLBACK_BLOCKED');
    assert.match((err.details as { issues: string[] }).issues[0]!, /no earlier formal configuration/);

    const r101 = e.run('release', (c) => rel.promoteCandidate(c, cand, { dclVersion: '1.0.1', vehicleIntegrationVersions: ['1.0'] }));
    const r100 = rel.releasesOf(e.getState(), 'X89').find((r) => r.dclVersion === '1.0.0')!.id;
    const older = fails(() => e.run('release', (c) => ota.createOta(c, { releaseId: r100, vehicleGroupIds: [production], firstWave: 'ALL' })), 'OTA_BLOCKED');
    assert.match((older.details as { issues: string[] }).issues[0]!, /resolves to the newer policy set 1.0.1/);
    // A partial software upgrade leaves the whole-vehicle version unknown: production targets block.
    carRuns(e, 'VEH-202', null);
    const blocked = fails(() => e.run('release', (c) => ota.createOta(c, { releaseId: r101, vehicleGroupIds: [production], firstWave: 'ALL' })), 'OTA_BLOCKED');
    assert.deepEqual((blocked.details as { issues: string[] }).issues, ['VEH-202: the whole-vehicle software version is unknown']);
    const testGroup = Object.values(e.getState().vehicleGroups).find((g) => g.name === 'X89 集成测试车组')!.id;
    const purpose = fails(() => e.run('release', (c) => ota.createOta(c, { releaseId: r101, vehicleGroupIds: [testGroup], firstWave: 'ALL' })), 'OTA_BLOCKED');
    assert.ok((purpose.details as { issues: string[] }).issues.some((i) => i.includes('production vehicle groups')));
  });
});
