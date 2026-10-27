import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { DomainError } from '../src/domain/errors.ts';
import * as calls from '../src/engine/calls.ts';
import * as em from '../src/engine/emergency.ts';
import { Engine } from '../src/engine/engine.ts';
import { captureEvent, visibleEvents } from '../src/engine/events.ts';
import * as fleet from '../src/engine/fleet.ts';
import * as integ from '../src/engine/integration.ts';
import { notificationsFor } from '../src/engine/notifications.ts';
import * as ota from '../src/engine/ota.ts';
import * as rel from '../src/engine/release.ts';
import { demoState } from '../src/engine/seed.ts';
import { applyNow, reportNow, sendReceipt, setAgent, simulateSoftwareOta } from '../src/engine/simulator.ts';
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

const featureId = (e: Engine, name: string) => Object.values(e.getState().features).find((f) => f.name === name)!.id;
const productionGroup = (e: Engine) => Object.values(e.getState().vehicleGroups).find((g) => g.purpose === 'PRODUCTION')!.id;
const runs = (e: Engine, id: string) => {
  const s = e.getState();
  return s.resolvedConfigs[s.resources[id]!.appliedConfigId!]!.label;
};

/** The demo after an approved emergency stop of DCL 1.0.0's angle-jump policy: DCL 1.0.1 for software 1.0. */
function emergencySet(e: Engine): string {
  const r100 = rel.releasesOf(e.getState(), 'X89').find((r) => r.dclVersion === '1.0.0')!;
  const stop = e.run('dcl', (c) => em.requestEmergencyStop(c, { releaseId: r100.id, policyId: 'chassis.steering.angle_jump', reason: '带宽洪峰' }));
  return e.run('release', (c) => em.decideEmergencyStop(c, stop, { decision: 'APPROVED', note: '同意' }))!;
}

/** X89 1.2 released through an integration call as DCL 1.1.0, its module in the 1.2 OTA package. */
function released12(): Engine {
  const e = new Engine(demoState());
  const callId = e.run('integration_admin', (c) => calls.openCall(c, { workspaceId: 'x89-project', targetVersion: '1.2', dueDate: null }));
  e.run('steering', (c) => calls.submitGroup(c, callId, 'steering', { featureId: featureId(e, 'steering_return_rate') }));
  e.run('business', (c) => calls.submitGroup(c, callId, 'brake', { featureId: featureId(e, 'brake_monitor') }));
  e.run('adc_integrator', (c) => calls.submitDomain(c, callId, 'ADC', {}));
  e.run('cdc_integrator', (c) => calls.submitDomain(c, callId, 'CDC', {}));
  e.run('dcl', (c) => fleet.registerImage(c, { id: 'x89-1.2-sim', vehicleModelId: 'X89', integrationVersion: '1.2', build: 'x89-1.2.0-rc1', digest: 'sha256:mock-x89-1-2-rc1', simulator: 'SimOne 3' }));
  e.run('integration_admin', (c) => fleet.createSimulation(c, { id: 'SIM-112', workspaceId: 'x89-integration', imageId: 'x89-1.2-sim', env: 'testing', pool: 'Vehicle' }));
  e.run('resource', (c) => fleet.registerPhysical(c, { id: 'VEH-032', vin: 'LSDEMX89000003200', vehicleModelId: 'X89', env: 'testing', pool: 'Vehicle' }));
  e.run('resource', (c) => fleet.confirmIntegration(c, 'VEH-032', { version: '1.2', source: '1.2 预发布刷写记录' }));
  e.run('integration_admin', (c) => fleet.addWorkspaceVehicle(c, 'x89-integration', 'VEH-032'));
  const plan = e.run('integrator', (c) => calls.previewCall(c, callId));
  e.run('dcl', (c) => integ.confirmProcessing(c, plan, { note: '' }));
  const cand = e.run('integrator', (c) => integ.freezeCandidate(c, plan, { label: '' }));
  const d = e.run('integration_tester', (c) => v.dispatchCandidate(c, cand, { resourceIds: ['SIM-112', 'VEH-032'] }));
  for (const r of ['SIM-112', 'VEH-032']) e.run(null, (c) => sendReceipt(c, d, r, 'APPLIED'));
  for (const r of ['SIM-112', 'VEH-032']) e.run('integration_tester', (c) => v.recordCandidateTest(c, cand, { resourceId: r, result: 'PASS', summary: '通过' }));
  e.run('integration_tester', (c) => v.verifyCandidate(c, cand));
  e.run('release', (c) => rel.promoteCandidate(c, cand, { dclVersion: '1.1.0', vehicleIntegrationVersions: ['1.2'] }));
  return e;
}

describe('the DCL module in the OTA package', () => {
  test('confirming the software a vehicle already runs leaves its configuration alone', () => {
    const e = new Engine(demoState());
    e.run('release', (c) => calls.exportDclModule(c, { vehicleModelId: 'X89', version: '1.0' }));
    const set101 = emergencySet(e);
    const d = e.run('release', (c) => ota.createOta(c, { releaseId: set101, vehicleGroupIds: [productionGroup(e)], firstWave: 'ALL' }));
    for (const r of ['VEH-201', 'VEH-202']) e.run(null, (c) => sendReceipt(c, d, r, 'APPLIED'));
    e.run('resource', (c) => fleet.confirmIntegration(c, 'VEH-201', { version: '1.0', source: 'DIP 例行上报' }));
    e.run('resource', (c) => fleet.reportControllers(c, 'VEH-201', { target: '1.0', source: 'DIP', controllers: [{ name: 'ADC', version: '1.0', status: 'PASS' }] }));
    assert.equal(runs(e, 'VEH-201'), 'DCL 1.0.1');
  });

  test('a vehicle flashed with an outdated module runs it, and release is told to bring it up to date', () => {
    const e = new Engine(demoState());
    e.run('resource', (c) => fleet.confirmIntegration(c, 'VEH-202', { version: '1.1', source: '整车 OTA 回执' }));
    e.run('release', (c) => calls.exportDclModule(c, { vehicleModelId: 'X89', version: '1.0' }));
    emergencySet(e);
    const notes = () => e.read('release', (s, a) => notificationsFor(s, a, 'x89-project')).filter((n) => n.kind === 'MODULE_OUTDATED');
    assert.deepEqual(notes().map((n) => [n.subject, n.detail]), [['X89 1.0', '1.0.0 · 1.0.1']]);
    // The package carries what was exported: the vehicle runs 1.0.0 until a configuration OTA reaches it.
    e.run('resource', (c) => fleet.confirmIntegration(c, 'VEH-202', { version: '1.0', source: '整车 OTA 回执' }));
    assert.equal(runs(e, 'VEH-202'), 'DCL 1.0.0');
    e.run('release', (c) => calls.exportDclModule(c, { vehicleModelId: 'X89', version: '1.0' }));
    assert.deepEqual(notes(), [], 'updating the module clears the warning');
  });

  test('events of a vehicle running its module belong to the workspace of its vehicle group', () => {
    const e = released12();
    e.run('resource', (c) => fleet.confirmIntegration(c, 'VEH-201', { version: '1.2', source: '整车 OTA 回执' }));
    assert.equal(runs(e, 'VEH-201'), 'DCL 1.1.0');
    const id = e.run(null, (c) => captureEvent(c, { resourceId: 'VEH-201', policyId: 'chassis.steering.return_rate' }));
    assert.equal(e.getState().events[id]!.workspaceId, 'x89-project');
    assert.ok(e.read('release', (s, a) => visibleEvents(s, a, 'x89-project').some((x) => x.id === id)));
  });

  test('a software change takes the vehicle out of rollouts whose set no longer fits it; the late receipt is refused', () => {
    const e = released12();
    const set101 = emergencySet(e);
    const d = e.run('release', (c) => ota.createOta(c, { releaseId: set101, vehicleGroupIds: [productionGroup(e)], firstWave: ['VEH-201'] }));
    e.run('resource', (c) => fleet.confirmIntegration(c, 'VEH-201', { version: '1.2', source: '整车 OTA 回执' }));
    const rollout = e.getState().deployments[d]!;
    assert.deepEqual(rollout.targets.map((t) => [t.resourceId, t.status]), [['VEH-201', 'CANCELLED'], ['VEH-202', 'QUEUED']]);
    assert.deepEqual(rollout.log!.at(-1), { kind: 'DROPPED', by: null, at: rollout.updatedAt, reason: '1.2', resourceIds: ['VEH-201'] });
    fails(() => e.run(null, (c) => v.acceptReceipt(c, { deploymentId: d, resourceId: 'VEH-201', attempt: 0, result: 'APPLIED' })), 'TARGET_NOT_PENDING');
    assert.equal(runs(e, 'VEH-201'), 'DCL 1.1.0', 'the module of 1.2 stays');
  });

  test('a production vehicle reporting a planned version waits until it is released and confirmed', () => {
    const e = new Engine(demoState());
    e.run('integration_admin', (c) => calls.openCall(c, { workspaceId: 'x89-project', targetVersion: '1.2', dueDate: null }));
    e.run(null, (c) => simulateSoftwareOta(c, 'VEH-201', '1.2'));
    e.run(null, (c) => reportNow(c, 'VEH-201'));
    const s = e.getState();
    assert.equal(s.resources['VEH-201']!.integrationVersion, '1.0');
    assert.deepEqual(
      Object.values(s.softwareChanges).filter((c) => c.resourceId === 'VEH-201').map((c) => [c.toVersion, c.status]),
      [['1.2', 'UNRECORDED']],
    );
  });
});

describe('gray rollout and rollback', () => {
  test('a rollout expands only after every vehicle sent so far applied it', () => {
    const e = new Engine(demoState());
    const set101 = emergencySet(e);
    const d = e.run('release', (c) => ota.createOta(c, { releaseId: set101, vehicleGroupIds: [productionGroup(e)], firstWave: ['VEH-201'] }));
    const err = fails(() => e.run('release', (c) => ota.expandOta(c, d, 'ALL')), 'OTA_WAVE_PENDING');
    assert.match(err.message, /VEH-201/);
    e.run(null, (c) => sendReceipt(c, d, 'VEH-201', 'APPLIED'));
    e.run('release', (c) => ota.expandOta(c, d, 'ALL'));
    assert.deepEqual(e.getState().deployments[d]!.targets.map((t) => t.status), ['APPLIED', 'PENDING']);
  });

  test('a rollback paused by a failed vehicle resumes and finishes', () => {
    const e = new Engine(demoState());
    const set101 = emergencySet(e);
    const d = e.run('release', (c) => ota.createOta(c, { releaseId: set101, vehicleGroupIds: [productionGroup(e)], firstWave: 'ALL' }));
    for (const r of ['VEH-201', 'VEH-202']) e.run(null, (c) => sendReceipt(c, d, r, 'APPLIED'));
    const [back] = e.run('release', (c) => ota.rollbackOta(c, d, '1.0.1 丢数据'));
    e.run(null, (c) => setAgent(c, 'VEH-202', { fault: 'CHECKSUM' }));
    e.run(null, (c) => applyNow(c, back!, 'VEH-202'));
    e.run(null, (c) => setAgent(c, 'VEH-202', { fault: 'NONE' }));
    assert.equal(e.getState().deployments[back!]!.status, 'PAUSED');
    e.run('release', (c) => ota.resumeOta(c, back!));
    for (const r of ['VEH-201', 'VEH-202']) e.run(null, (c) => sendReceipt(c, back!, r, 'APPLIED'));
    assert.equal(e.getState().deployments[back!]!.status, 'COMPLETED');
    assert.deepEqual([runs(e, 'VEH-201'), runs(e, 'VEH-202')], ['DCL 1.0.0', 'DCL 1.0.0']);
  });
});
