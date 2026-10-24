import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { answerAll, simpleFeature } from '../acceptance/helpers.ts';
import { World } from '../acceptance/world.ts';
import { configurationContents } from '../src/engine/client-report.ts';
import { capturablePolicies, captureEvent } from '../src/engine/events.ts';
import * as fleet from '../src/engine/fleet.ts';
import * as integ from '../src/engine/integration.ts';
import { answerConfigRequest } from '../src/engine/ota.ts';
import * as rel from '../src/engine/release.ts';
import { demoState } from '../src/engine/seed.ts';
import * as v from '../src/engine/validation.ts';

const groupId = (w: World, name: string) => Object.values(w.s.vehicleGroups).find((g) => g.name === name)!.id;
const feature = (w: World, name: string) => Object.values(w.s.features).find((f) => f.name === name)!;
const set = (w: World, version: string) => Object.values(w.s.releases).find((r) => r.dclVersion === version)!;
const configOf = (w: World, deploymentId: string) => w.s.resolvedConfigs[w.s.deployments[deploymentId]!.resolvedConfigId]!;

/** The demo's next formal set: steering_return_rate integrated as policy set 1.0.1 for software 1.0. */
function promoteNext(w: World): string {
  const steering = feature(w, 'steering_return_rate');
  const plan = w.as('integrator', (c) => integ.previewMerge(c, { workspaceId: 'x89-project', featureIds: [steering.id] }));
  w.as('dcl', (c) => integ.confirmProcessing(c, plan, { note: '' }));
  const cand = w.as('integrator', (c) => integ.freezeCandidate(c, plan, { label: 'X89-C2' }));
  const d = w.as('integration_tester', (c) => v.dispatchCandidate(c, cand, { vehicleGroupIds: [groupId(w, 'X89 集成测试车组')] }));
  answerAll(w, d);
  for (const r of ['SIM-101', 'VEH-031']) w.as('integration_tester', (c) => v.recordCandidateTest(c, cand, { resourceId: r, result: 'PASS', summary: 'ok' }));
  w.as('integration_tester', (c) => v.verifyCandidate(c, cand));
  return w.as('release', (c) => rel.promoteCandidate(c, cand, { dclVersion: '1.0.1', vehicleIntegrationVersions: ['1.0'] }));
}

function dispatchBrake(w: World, disabledPolicies?: string[]): string[] {
  const brake = feature(w, 'brake_monitor');
  const ds = w.as('brake_tester', (c) => v.dispatchFeature(c, brake.id, { commitId: brake.headCommitId!, vehicleGroupIds: [groupId(w, '制动研发车组')], disabledPolicies }));
  for (const d of ds) answerAll(w, d);
  return ds;
}

describe('development vehicle groups', () => {
  test('a Feature publication runs on each vehicle’s base and follows the software’s set only when published again', () => {
    const w = new World(demoState());
    const [d1] = dispatchBrake(w);
    const first = configOf(w, d1!);
    assert.equal(first.baseReleaseId, set(w, '1.0.0').id);
    assert.deepEqual(Object.keys(first.groups).sort(), ['brake', 'steering']);
    assert.deepEqual(answerConfigRequest(w.s, 'SIM-021'), { configId: first.id, reason: 'GROUP_TARGET', detail: '制动研发车组' });

    // A newer set for software 1.0: the group's vehicles should run it, but nothing is sent by itself.
    promoteNext(w);
    const held = answerConfigRequest(w.s, 'SIM-021');
    assert.equal(held.reason, 'REPUBLISH');
    assert.equal(held.configId, first.id, 'the vehicle keeps what it applied');

    const [d2] = dispatchBrake(w);
    const second = configOf(w, d2!);
    assert.equal(second.baseReleaseId, set(w, '1.0.1').id);
    assert.match(second.label, /@1\.0\.1$/);
    assert.equal(answerConfigRequest(w.s, 'SIM-021').configId, second.id);
    // Test evidence follows the latest dispatch: the vehicles applied the new combination.
    const status = v.featureTestStatus(w.s, feature(w, 'brake_monitor'));
    assert.deepEqual(status.map((t) => [t.resourceId, t.deploymentId, t.applied]), [
      ['SIM-021', d2, true],
      ['VEH-001', d2, true],
    ]);
  });

  test('software no set applies to needs an explicit base; vehicles on different bases get separate dispatches', () => {
    const w = new World(demoState());
    const vg = groupId(w, '制动研发车组');
    w.as('resource', (c) => fleet.recordSoftwareVersion(c, { vehicleModelId: 'X89', version: '1.2', source: '整车 OTA 发布记录 X89-1.2' }));
    w.as('resource', (c) => fleet.confirmIntegration(c, 'VEH-001', { version: '1.2', source: 'DIP 上报' }));
    assert.equal(answerConfigRequest(w.s, 'VEH-001').reason, 'NO_BASE');
    const blocked = w.fails('DISPATCH_BLOCKED', () => dispatchBrake(w));
    assert.deepEqual((blocked.details as { issues: string[] }).issues, ['VEH-001: no policy set applies to software 1.2; choose an explicit base']);

    w.fails('FORBIDDEN', () => w.as('brake_tester', (c) => fleet.setGroupBase(c, vg, set(w, '1.0.0').id)));
    w.fails('PRODUCTION_GROUP_BASE', () => w.as('release', (c) => fleet.setGroupBase(c, groupId(w, 'X89 量产车组'), set(w, '1.0.0').id)));
    w.as('workspace_manager', (c) => fleet.setGroupBase(c, vg, set(w, '1.0.0').id));
    const [explicit] = dispatchBrake(w);
    assert.equal(configOf(w, explicit!).baseReleaseId, set(w, '1.0.0').id);
    assert.equal(w.s.deployments[explicit!]!.targets.length, 2, 'one base, one dispatch');

    // Back to following the software: VEH-001's software is now unknown, so it takes the initial configuration.
    w.as('workspace_manager', (c) => fleet.setGroupBase(c, vg, null));
    w.as('resource', (c) => fleet.confirmIntegration(c, 'VEH-001', { version: null, source: '刷写中断，待复核' }));
    const ds = dispatchBrake(w);
    assert.equal(ds.length, 2);
    const byVehicle = Object.fromEntries(ds.map((d) => [w.s.deployments[d]!.targets[0]!.resourceId, configOf(w, d)]));
    assert.equal(byVehicle['SIM-021']!.baseReleaseId, set(w, '1.0.0').id);
    assert.equal(byVehicle['VEH-001']!.baseReleaseId, null);
    assert.deepEqual(Object.keys(byVehicle['VEH-001']!.groups), ['brake']);
    assert.match(byVehicle['VEH-001']!.label, /@initial$/);
  });

  test('a base that changed the Feature’s own group is a conflict: the vehicle keeps its configuration', () => {
    const w = new World(demoState());
    const { featureId } = simpleFeature(w, 'steering', {
      workspaceId: 'team-steering',
      groupId: 'steering',
      name: 'lane_drift',
      unit: 'CHASSIS',
      directory: '/var/log/lane',
      pattern: 'lane.bin',
      fileName: '跑偏日志',
      policyId: 'chassis.steering.lane_drift',
      policyName: '跑偏',
      trigger: 'lane_offset > 0.5',
    });
    const head = w.s.features[featureId]!.headCommitId!;
    const vg = groupId(w, '转向研发车组');
    for (const d of w.as('steering_tester', (c) => v.dispatchFeature(c, featureId, { commitId: head, vehicleGroupIds: [vg] }))) answerAll(w, d);
    const applied = w.s.resources['SIM-022']!.appliedConfigId;

    promoteNext(w); // 1.0.1 changes chassis.steering after lane_drift started on 1.0.0
    const answer = answerConfigRequest(w.s, 'SIM-022');
    assert.deepEqual([answer.reason, answer.configId], ['BASE_CONFLICT', applied]);
    const err = w.fails('DISPATCH_BLOCKED', () => w.as('steering_tester', (c) => v.dispatchFeature(c, featureId, { commitId: head, vehicleGroupIds: [vg] })));
    assert.match((err.details as { issues: string[] }).issues[0]!, /policy set 1\.0\.1 changed chassis\.steering after the Feature started/);
  });

  test('switches turn off other groups’ base policies on the vehicle, never the group’s own', () => {
    const w = new World(demoState());
    w.fails('POLICY_NOT_SWITCHABLE', () => dispatchBrake(w, ['chassis.brake.monitor']));
    w.fails('POLICY_NOT_SWITCHABLE', () => dispatchBrake(w, ['chassis.nothing.here']));
    const [d] = dispatchBrake(w, ['chassis.steering.angle_jump']);
    const config = configOf(w, d!);
    assert.deepEqual(config.disabledPolicies, ['chassis.steering.angle_jump']);
    assert.match(config.label, / −1$/);
    assert.deepEqual(w.s.vehicleGroups[groupId(w, '制动研发车组')]!.publication, {
      kind: 'FEATURE',
      featureId: feature(w, 'brake_monitor').id,
      commitId: feature(w, 'brake_monitor').headCommitId,
      disabledPolicies: ['chassis.steering.angle_jump'],
    });
    assert.equal(answerConfigRequest(w.s, 'SIM-021').configId, config.id);
    assert.deepEqual(capturablePolicies(w.s, 'SIM-021').map((p) => p.policyId).sort(), ['chassis.brake.failure_diag', 'chassis.brake.monitor']);
    w.fails('POLICY_NOT_ON_VEHICLE', () => w.sys((c) => captureEvent(c, { resourceId: 'SIM-021', policyId: 'chassis.steering.angle_jump' })));
    const contents = configurationContents(w.s, config.id)!;
    assert.equal(contents.policies.find((p) => p.id === 'chassis.steering.angle_jump')!.status, 'DISABLED');
    // The same commit without switches is another configuration.
    const [plain] = dispatchBrake(w);
    assert.notEqual(configOf(w, plain!).id, config.id);
  });
});
