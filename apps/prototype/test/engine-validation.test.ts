import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { DomainError } from '../src/domain/errors.ts';
import * as config from '../src/engine/config.ts';
import { Engine } from '../src/engine/engine.ts';
import * as fleet from '../src/engine/fleet.ts';
import { demoState } from '../src/engine/seed.ts';
import { sendReceipt, setAgent, tick } from '../src/engine/simulator.ts';
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

function setup() {
  const e = new Engine(demoState());
  const s = e.getState();
  const feature = Object.values(s.features).find((f) => f.name === 'guided_brake')!;
  const vg = Object.values(s.vehicleGroups).find((g) => g.name === '制动研发车组')!;
  return { e, feature, vg };
}

describe('dispatch, receipts and tests', () => {
  test('dispatch changes what vehicles should run; only receipts change what they run', () => {
    const { e, feature, vg } = setup();
    const before = e.getState();
    const d = e.run('brake_tester', (c) => v.dispatchFeature(c, feature.id, { commitId: feature.headCommitId!, vehicleGroupIds: [vg.id] }));
    const s = e.getState();
    assert.equal(s.features[feature.id]!.stage, 'TESTING');
    assert.deepEqual(
      s.deployments[d]!.targets.map((t) => [t.resourceId, t.status]),
      [
        ['SIM-021', 'PENDING'],
        ['VEH-001', 'PENDING'],
      ],
    );
    assert.equal(s.resources['SIM-021']!.appliedConfigId, before.resources['SIM-021']!.appliedConfigId, 'dispatching applies nothing');
    assert.equal(s.vehicleGroups[vg.id]!.bindingRevision, before.vehicleGroups[vg.id]!.bindingRevision + 1);
    fails(
      () => e.run('brake_tester', (c) => v.recordFeatureTest(c, feature.id, { commitId: feature.headCommitId!, resourceId: 'SIM-021', result: 'PASS', summary: 'x' })),
      'NOT_APPLIED',
    );
    // A second dispatch cannot reach busy vehicles.
    fails(() => e.run('brake_tester', (c) => v.dispatchFeature(c, feature.id, { commitId: feature.headCommitId!, vehicleGroupIds: [vg.id] })), 'DISPATCH_BLOCKED');

    assert.equal(e.run(null, (c) => sendReceipt(c, d, 'SIM-021', 'APPLIED')), 'ACCEPTED');
    assert.equal(e.run(null, (c) => sendReceipt(c, d, 'SIM-021', 'APPLIED')), 'REPLAYED');
    fails(() => e.run(null, (c) => sendReceipt(c, d, 'SIM-021', 'FAILED')), 'RECEIPT_CONFLICT');
    e.run(null, (c) => sendReceipt(c, d, 'VEH-001', 'FAILED', 'flash interrupted'));
    const after = e.getState();
    assert.equal(after.deployments[d]!.status, 'COMPLETED');
    assert.equal(after.resources['SIM-021']!.appliedConfigId, after.deployments[d]!.resolvedConfigId);
    assert.equal(after.resources['VEH-001']!.appliedConfigId, before.resources['VEH-001']!.appliedConfigId, 'a failed apply keeps the old configuration');
  });

  test('simulation first, dispatch-only cannot record, Verified needs every target', () => {
    const { e, feature, vg } = setup();
    const head = feature.headCommitId!;
    const d1 = e.run('dispatch_operator', (c) => v.dispatchFeature(c, feature.id, { commitId: head, vehicleGroupIds: [vg.id] }));
    e.run(null, (c) => sendReceipt(c, d1, 'SIM-021', 'APPLIED'));
    e.run(null, (c) => sendReceipt(c, d1, 'VEH-001', 'APPLIED'));
    const err = fails(
      () => e.run('dispatch_operator', (c) => v.recordFeatureTest(c, feature.id, { commitId: head, resourceId: 'SIM-021', result: 'PASS', summary: '仿真通过' })),
      'FORBIDDEN',
    );
    assert.equal((err.details as { reason: string }).reason, 'DISPATCH_ONLY_GRANT');
    fails(
      () => e.run('brake_tester', (c) => v.recordFeatureTest(c, feature.id, { commitId: head, resourceId: 'VEH-001', result: 'PASS', summary: '实车' })),
      'SIMULATION_FIRST',
    );
    e.run('brake_tester', (c) => v.recordFeatureTest(c, feature.id, { commitId: head, resourceId: 'SIM-021', result: 'PASS', summary: '仿真通过' }));
    fails(() => e.run('brake_tester', (c) => v.verifyFeature(c, feature.id)), 'VERIFY_BLOCKED');
    e.run('brake_tester', (c) => v.recordFeatureTest(c, feature.id, { commitId: head, resourceId: 'VEH-001', result: 'PASS', summary: '实车通过' }));
    e.run('brake_tester', (c) => v.verifyFeature(c, feature.id));
    assert.equal(e.getState().features[feature.id]!.stage, 'VERIFIED');

    // A content change needs new evidence; reverting it restores the verified state.
    const key = Object.keys(feature.draft.files)[0]!;
    e.run('business', (c) => config.updateFile(c, feature.id, key, { purpose: '临时修改' }));
    assert.equal(e.getState().features[feature.id]!.stage, 'DRAFT');
    e.run('business', (c) => config.updateFile(c, feature.id, key, { purpose: feature.draft.files[key]!.purpose }));
    assert.equal(e.run('business', (c) => config.submitFeature(c, feature.id)).stage, 'VERIFIED');
    e.run('business', (c) => config.updateFile(c, feature.id, key, { purpose: '新的用途' }));
    const r = e.run('business', (c) => config.submitFeature(c, feature.id));
    assert.equal(r.stage, 'DCL_READY');
    assert.deepEqual(v.featureTestStatus(e.getState(), e.getState().features[feature.id]!), [], 'old PASS does not verify new content');
  });

  test('a failed vehicle gets a new dispatch; the simulator answers in automatic mode', () => {
    const { e, feature, vg } = setup();
    const old = e.getState().resources['VEH-001']!.appliedConfigId;
    e.run(null, (c) => {
      setAgent(c, 'SIM-021', { autoAck: true });
      setAgent(c, 'VEH-001', { autoAck: true, failNext: true });
    });
    e.run('brake_tester', (c) => v.dispatchFeature(c, feature.id, { commitId: feature.headCommitId!, vehicleGroupIds: [vg.id] }));
    assert.equal(e.run(null, (c) => tick(c)), 2);
    const s = e.getState();
    assert.equal(s.resources['VEH-001']!.appliedConfigId, old);
    assert.equal(s.resources['VEH-001']!.agent.failNext, false);
    const d2 = e.run('brake_tester', (c) => v.dispatchFeature(c, feature.id, { commitId: feature.headCommitId!, vehicleGroupIds: [vg.id] }));
    e.run(null, (c) => tick(c));
    assert.equal(e.getState().deployments[d2]!.status, 'COMPLETED');
    assert.equal(v.featureTestStatus(e.getState(), e.getState().features[feature.id]!).every((t) => t.applied), true);
  });

  test('offline vehicles keep their targets pending; cancelling keeps the group binding', () => {
    const { e, feature, vg } = setup();
    e.run(null, (c) => setAgent(c, 'VEH-001', { online: false, autoAck: true }));
    const d = e.run('brake_tester', (c) => v.dispatchFeature(c, feature.id, { commitId: feature.headCommitId!, vehicleGroupIds: [vg.id] }));
    e.run(null, (c) => tick(c));
    assert.equal(e.getState().deployments[d]!.targets.find((t) => t.resourceId === 'VEH-001')!.status, 'PENDING');
    e.run('brake_tester', (c) => v.cancelDeployment(c, d, '车辆离线'));
    const s = e.getState();
    assert.equal(s.deployments[d]!.status, 'CANCELLED');
    assert.equal(s.vehicleGroups[vg.id]!.targetConfigId, s.deployments[d]!.resolvedConfigId);
  });
});

describe('vehicles and vehicle groups', () => {
  test('a simulation’s software comes from its image; physical software is confirmed from a source', () => {
    const { e } = setup();
    const s = e.getState();
    assert.equal(s.resources['SIM-021']!.integrationVersion, '1.0');
    assert.equal(s.resources['VEH-002']!.integrationVersion, null, 'unknown until confirmed');
    fails(() => e.run('resource', (c) => fleet.confirmIntegration(c, 'SIM-021', { version: '1.1', source: 'x' })), 'SIMULATION_SOFTWARE_FROM_IMAGE');
    fails(() => e.run('resource', (c) => fleet.confirmIntegration(c, 'VEH-002', { version: '9.9', source: 'x' })), 'UNKNOWN_SOFTWARE_VERSION');
  });

  test('one routing group per vehicle; membership changes need idle vehicles of the right environment', () => {
    const { e, feature, vg } = setup();
    const other = e.run('workspace_manager', (c) =>
      fleet.createVehicleGroup(c, { workspaceId: 'team-brake', groupId: 'brake', name: '制动测试车组', purpose: 'TEST', env: 'development' }),
    );
    fails(() => e.run('workspace_manager', (c) => fleet.addGroupMember(c, other, 'SIM-021', 'move')), 'VEHICLE_ALREADY_GROUPED');
    e.run('brake_tester', (c) => v.dispatchFeature(c, feature.id, { commitId: feature.headCommitId!, vehicleGroupIds: [vg.id] }));
    fails(() => e.run('workspace_manager', (c) => fleet.removeGroupMember(c, vg.id, 'SIM-021', 'move')), 'VEHICLE_BUSY');
    // Workspace admins never handle production vehicles; other vehicles must fit the workspace.
    const prod = fails(() => e.run('workspace_manager', (c) => fleet.addWorkspaceVehicle(c, 'team-brake', 'VEH-201')), 'FORBIDDEN');
    assert.equal((prod.details as { reason: string }).reason, 'ENV_NOT_GRANTED');
    fails(() => e.run('workspace_manager', (c) => fleet.addWorkspaceVehicle(c, 'team-brake', 'VEH-002')), 'VEHICLE_NOT_ASSIGNABLE');
    const err = fails(() => e.run('business', (c) => fleet.createVehicleGroup(c, { workspaceId: 'team-brake', groupId: 'brake', name: 'x', purpose: 'DEV', env: 'development' })), 'FORBIDDEN');
    assert.equal((err.details as { reason: string }).reason, 'ROLE_NOT_GRANTED');
  });
});
