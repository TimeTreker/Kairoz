// Regressions from the third independent review (after iterations 1–9): domain call rounds and the
// whole-vehicle test lock, earlier-commit dispatches, rollouts losing vehicles, released vehicles,
// subsystem sources, planned versions on production vehicles and sign-in.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { simpleFeature, verifyFeatureOn } from '../acceptance/helpers.ts';
import { World } from '../acceptance/world.ts';
import * as calls from '../src/engine/calls.ts';
import * as config from '../src/engine/config.ts';
import * as em from '../src/engine/emergency.ts';
import * as fleet from '../src/engine/fleet.ts';
import * as intake from '../src/engine/intake.ts';
import * as integ from '../src/engine/integration.ts';
import { landingWorkspace, notificationsFor } from '../src/engine/notifications.ts';
import * as org from '../src/engine/org.ts';
import * as ota from '../src/engine/ota.ts';
import * as refs from '../src/engine/references.ts';
import * as rel from '../src/engine/release.ts';
import { demoState } from '../src/engine/seed.ts';
import { reportNow, sendReceipt, simulateSoftwareOta } from '../src/engine/simulator.ts';
import * as v from '../src/engine/validation.ts';

const vg = (w: World, name: string) => Object.values(w.s.vehicleGroups).find((g) => g.name === name)!.id;
const fid = (w: World, name: string) => Object.values(w.s.features).find((f) => f.name === name)!.id;

/** A Verified ADC parking Feature. */
function adcFeature(w: World, name: string): string {
  const { featureId } = simpleFeature(w, 'adc_parking', { workspaceId: 'team-adc-parking', groupId: 'adc-parking', name, unit: 'ADC', directory: '/data/adc-parking', pattern: `${name}.log`, fileName: `${name} 日志`, policyId: `adc.parking.${name}`, policyName: name, trigger: 'vehicle_speed > 10' });
  verifyFeatureOn(w, 'adc_parking_tester', featureId, [vg(w, '泊车研发车组')]);
  return featureId;
}

/** Runs a domain call's round to a Verified candidate. */
function verifiedChildRound(w: World, child: string, featureId: string): string {
  w.as('adc_parking', (c) => calls.submitGroup(c, child, 'adc-parking', { featureId }));
  w.as('adc_system', (c) => calls.submitGroup(c, child, 'adc-system', {}));
  const plan = w.as('adc_integrator', (c) => calls.previewCall(c, child));
  w.as('dcl', (c) => integ.confirmProcessing(c, plan, { note: '' }));
  const cand = w.as('adc_integrator', (c) => integ.freezeCandidate(c, plan, { label: '' }));
  const d = w.as('adc_integrator', (c) => v.dispatchCandidate(c, cand, { vehicleGroupIds: [vg(w, 'ADC 域集成测试车组')] }));
  const vehicles = w.s.deployments[d]!.targets.map((t) => t.resourceId);
  for (const r of vehicles) w.sys((c) => sendReceipt(c, d, r, 'APPLIED'));
  for (const r of vehicles) w.as('adc_integrator', (c) => v.recordCandidateTest(c, cand, { resourceId: r, result: 'PASS', summary: '子系统回归' }));
  w.as('adc_integrator', (c) => v.verifyCandidate(c, cand));
  return cand;
}

/** The whole-vehicle call for 1.2 with every module answered and its first round frozen. */
function parentInTest(w: World): string {
  const parent = w.as('integration_admin', (c) => calls.openCall(c, { workspaceId: 'x89-project', targetVersion: '1.2', dueDate: null }));
  w.as('adc_integrator', (c) => calls.submitDomain(c, parent, 'ADC', {}));
  w.as('steering', (c) => calls.submitGroup(c, parent, 'steering', { featureId: fid(w, 'steering_return_rate') }));
  w.as('business', (c) => calls.submitGroup(c, parent, 'brake', {}));
  w.as('cdc_integrator', (c) => calls.submitDomain(c, parent, 'CDC', {}));
  const plan = w.as('integrator', (c) => calls.previewCall(c, parent));
  w.as('dcl', (c) => integ.confirmProcessing(c, plan, { note: '' }));
  w.as('integrator', (c) => integ.freezeCandidate(c, plan, { label: '' }));
  return parent;
}

/** Set 1.1.0 released for 1.2 through the call, and 1.0.1 for 1.0 by an emergency stop. */
function twoSets(w: World): string {
  const callId = w.as('integration_admin', (c) => calls.openCall(c, { workspaceId: 'x89-project', targetVersion: '1.2', dueDate: null }));
  w.as('steering', (c) => calls.submitGroup(c, callId, 'steering', { featureId: fid(w, 'steering_return_rate') }));
  w.as('business', (c) => calls.submitGroup(c, callId, 'brake', { featureId: fid(w, 'brake_monitor') }));
  w.as('adc_integrator', (c) => calls.submitDomain(c, callId, 'ADC', {}));
  w.as('cdc_integrator', (c) => calls.submitDomain(c, callId, 'CDC', {}));
  w.as('dcl', (c) => fleet.registerImage(c, { id: 'x89-1.2-sim', vehicleModelId: 'X89', integrationVersion: '1.2', build: 'x89-1.2.0-rc1', digest: 'sha256:mock-x89-1-2-rc1', simulator: 'SimOne 3' }));
  w.as('integration_admin', (c) => fleet.createSimulation(c, { id: 'SIM-112', workspaceId: 'x89-integration', imageId: 'x89-1.2-sim', env: 'testing', pool: 'Vehicle' }));
  w.as('resource', (c) => fleet.registerPhysical(c, { id: 'VEH-032', vin: 'LSDEMX89000003200', vehicleModelId: 'X89', env: 'testing', pool: 'Vehicle' }));
  w.as('resource', (c) => fleet.confirmIntegration(c, 'VEH-032', { version: '1.2', source: '1.2 预发布刷写记录' }));
  w.as('integration_admin', (c) => fleet.addWorkspaceVehicle(c, 'x89-integration', 'VEH-032'));
  const plan = w.as('integrator', (c) => calls.previewCall(c, callId));
  w.as('dcl', (c) => integ.confirmProcessing(c, plan, { note: '' }));
  const cand = w.as('integrator', (c) => integ.freezeCandidate(c, plan, { label: '' }));
  const d = w.as('integration_tester', (c) => v.dispatchCandidate(c, cand, { resourceIds: ['SIM-112', 'VEH-032'] }));
  for (const r of ['SIM-112', 'VEH-032']) w.sys((c) => sendReceipt(c, d, r, 'APPLIED'));
  for (const r of ['SIM-112', 'VEH-032']) w.as('integration_tester', (c) => v.recordCandidateTest(c, cand, { resourceId: r, result: 'PASS', summary: '通过' }));
  w.as('integration_tester', (c) => v.verifyCandidate(c, cand));
  w.as('release', (c) => rel.promoteCandidate(c, cand, { dclVersion: '1.1.0', vehicleIntegrationVersions: ['1.2'] }));
  const r100 = rel.releasesOf(w.s, 'X89').find((r) => r.dclVersion === '1.0.0')!;
  const stop = w.as('dcl', (c) => em.requestEmergencyStop(c, { releaseId: r100.id, policyId: 'chassis.steering.angle_jump', reason: '带宽洪峰' }));
  return w.as('release', (c) => em.decideEmergencyStop(c, stop, { decision: 'APPROVED', note: '同意' }))!;
}

const productionGroup = (w: World) => Object.values(w.s.vehicleGroups).find((g) => g.purpose === 'PRODUCTION')!.id;

describe('domain integration calls', () => {
  test('a returned domain answers with a second round built on its own subsystem release', () => {
    const w = new World(demoState());
    const parent = w.as('integration_admin', (c) => calls.openCall(c, { workspaceId: 'x89-project', targetVersion: '1.2', dueDate: null }));
    const child1 = w.as('adc_integrator', (c) => calls.openCall(c, { workspaceId: 'x89-adc-integration', scope: 'ADC', parentCallId: parent }));
    const cand1 = verifiedChildRound(w, child1, adcFeature(w, 'park_one'));
    w.as('adc_integrator', (c) => integ.publishSubsystem(c, cand1, { notes: 'ADC' }));
    w.as('integration_admin', (c) => calls.returnModules(c, parent, ['domain:ADC'], 'ADC 需修正'));
    const child2 = w.as('adc_integrator', (c) => calls.openCall(c, { workspaceId: 'x89-adc-integration', scope: 'ADC', parentCallId: parent }));
    // The second preview builds on ADC-S1 by itself; that is not a changed submission.
    const cand2 = verifiedChildRound(w, child2, adcFeature(w, 'park_two'));
    const s2 = w.as('adc_integrator', (c) => integ.publishSubsystem(c, cand2, { notes: 'ADC 修正' }));
    const m = w.s.integrationCalls[parent]!.modules.find((x) => x.key === 'domain:ADC')!;
    assert.equal(m.status, 'SUBMITTED');
    assert.equal(m.subsystemReleaseId, s2);
  });

  test('a domain call publishes while the whole-vehicle round is tested; its result waits', () => {
    const w = new World(demoState());
    const parent = parentInTest(w);
    const child = w.as('adc_integrator', (c) => calls.openCall(c, { workspaceId: 'x89-adc-integration', scope: 'ADC', parentCallId: parent }));
    const cand = verifiedChildRound(w, child, adcFeature(w, 'park_one'));
    const s1 = w.as('adc_integrator', (c) => integ.publishSubsystem(c, cand, { notes: 'ADC' }));
    assert.equal(w.s.subsystemReleases[s1]!.status, 'ACTIVE');
    assert.equal(w.s.integrationCalls[child]!.status, 'RELEASED');
    assert.equal(w.s.integrationCalls[child]!.note, calls.PARENT_IN_TEST);
    // The tested round is untouched: the module keeps what was frozen.
    const m = w.s.integrationCalls[parent]!.modules.find((x) => x.key === 'domain:ADC')!;
    assert.equal(m.status, 'NO_CHANGE');
    assert.equal(calls.callPhase(w.s, w.s.integrationCalls[parent]!), 'TESTING');
    // Sent back, the domain submits its release.
    w.as('integration_admin', (c) => calls.returnModules(c, parent, ['domain:ADC'], '带上 ADC-S1'));
    w.as('adc_integrator', (c) => calls.submitDomain(c, parent, 'ADC', { subsystemReleaseId: s1 }));
    assert.equal(w.s.integrationCalls[parent]!.modules.find((x) => x.key === 'domain:ADC')!.subsystemReleaseId, s1);
  });

  test('a domain call closed with its parent keeps its frozen candidate', () => {
    const w = new World(demoState());
    const parent = w.as('integration_admin', (c) => calls.openCall(c, { workspaceId: 'x89-project', targetVersion: '1.2', dueDate: null }));
    const child = w.as('adc_integrator', (c) => calls.openCall(c, { workspaceId: 'x89-adc-integration', scope: 'ADC', parentCallId: parent }));
    const cand = verifiedChildRound(w, child, adcFeature(w, 'park_one'));
    w.as('integration_admin', (c) => calls.excludeModule(c, parent, 'domain:ADC', 'ADC 本次不参加'));
    assert.equal(w.s.integrationCalls[child]!.status, 'CANCELLED');
    assert.equal(w.s.integrationCalls[child]!.rounds.at(-1)!.outcome, 'CANCELLED');
    assert.equal(w.s.candidates[cand]!.status, 'VERIFIED');
    assert.equal(w.s.candidates[cand]!.callId, null);
    // It is the domain's own candidate now, published as an ordinary subsystem release.
    const s1 = w.as('adc_integrator', (c) => integ.publishSubsystem(c, cand, { notes: 'ADC' }));
    assert.equal(w.s.subsystemReleases[s1]!.status, 'ACTIVE');
  });
});

describe('dispatching an earlier commit', () => {
  test('a commit sent back by DCL cannot be dispatched', () => {
    const w = new World(demoState());
    const f = fid(w, 'brake_monitor');
    const policy = Object.keys(w.s.features[f]!.draft.policies)[0]!;
    const p = () => w.s.features[f]!.draft.policies[policy]!;
    w.as('business', (c) => config.putPolicy(c, f, policy, { ...p(), postSeconds: p().postSeconds + 7 }));
    const r2 = w.as('business', (c) => config.submitFeature(c, f, { message: '超长录制' })).commitId;
    w.as('dcl', (c) => intake.returnFeature(c, f, { reason: '录制过长，处理模板不支持' }));
    w.as('business', (c) => config.putPolicy(c, f, policy, { ...p(), postSeconds: p().postSeconds - 4 }));
    w.as('business', (c) => config.submitFeature(c, f, { message: '修正' }));
    assert.match(v.historyCommitProblem(w.s, w.s.features[f]!, r2)!, /changes were requested/);
    w.fails('STALE_COMMIT', () => w.as('brake_tester', (c) => v.dispatchFeature(c, f, { commitId: r2, vehicleGroupIds: [vg(w, '制动研发车组')] })));
  });

  test('a commit reading data whose reference was revoked cannot be dispatched', () => {
    const w = new World(demoState());
    const brakeKey = Object.values(w.s.dataItems).find((d) => d.source.pattern === 'brake_debug.pb')!.dataKey;
    const reqId = Object.keys(w.s.referenceRequests)[0]!;
    w.as('business', (c) => refs.decideReference(c, reqId, { decision: 'APPROVED', reason: '同意' }));
    const f = w.as('steering', (c) => config.createFeature(c, { workspaceId: 'team-steering', groupId: 'steering', name: 'steer' }));
    w.as('steering', (c) => config.putReference(c, f, brakeKey));
    w.as('steering', (c) => config.putPolicy(c, f, 'chassis.steering.sharp_turn', { name: '急转', trigger: 'steering_rate > 300', captures: [brakeKey], preSeconds: 5, postSeconds: 5 }));
    const c1 = w.as('steering', (c) => config.submitFeature(c, f)).commitId;
    w.as('business', (c) => refs.revokeReference(c, reqId, { reason: '口径调整' }));
    w.as('steering', (c) => config.removePolicy(c, f, 'chassis.steering.sharp_turn'));
    w.as('steering', (c) => config.removeReference(c, f, brakeKey));
    w.as('steering', (c) => config.submitFeature(c, f));
    assert.ok(v.historyCommitProblem(w.s, w.s.features[f]!, c1));
    w.fails('STALE_COMMIT', () => w.as('steering_tester', (c) => v.dispatchFeature(c, f, { commitId: c1, vehicleGroupIds: [vg(w, '转向研发车组')] })));
  });
});

describe('rollouts losing vehicles', () => {
  test('a failed vehicle whose software changed leaves the paused rollout, which then resumes', () => {
    const w = new World(demoState());
    const set101 = twoSets(w);
    const d = w.as('release', (c) => ota.createOta(c, { releaseId: set101, vehicleGroupIds: [productionGroup(w)], firstWave: ['VEH-201'] }));
    w.sys((c) => sendReceipt(c, d, 'VEH-201', 'FAILED'));
    assert.equal(w.s.deployments[d]!.status, 'PAUSED');
    w.as('resource', (c) => fleet.confirmIntegration(c, 'VEH-201', { version: '1.2', source: '整车 OTA 回执' }));
    const t = w.s.deployments[d]!.targets.find((x) => x.resourceId === 'VEH-201')!;
    assert.equal(t.status, 'CANCELLED');
    assert.equal(t.history.at(-1)!.status, 'FAILED');
    assert.equal(fleet.openOtaOf(w.s, 'VEH-201'), undefined);
    w.as('release', (c) => ota.resumeOta(c, d));
    w.as('release', (c) => ota.expandOta(c, d, 'ALL'));
    assert.equal(w.s.deployments[d]!.targets.find((x) => x.resourceId === 'VEH-202')!.status, 'PENDING');
  });

  test('a rollout every vehicle left is cancelled, not completed', () => {
    const w = new World(demoState());
    const set101 = twoSets(w);
    const d = w.as('release', (c) => ota.createOta(c, { releaseId: set101, vehicleGroupIds: [productionGroup(w)], firstWave: 'ALL' }));
    for (const r of ['VEH-201', 'VEH-202']) w.as('resource', (c) => fleet.confirmIntegration(c, r, { version: '1.2', source: '整车 OTA 回执' }));
    assert.equal(w.s.deployments[d]!.status, 'CANCELLED');
    assert.deepEqual(w.s.deployments[d]!.log!.map((l) => l.kind), ['STARTED', 'DROPPED', 'DROPPED', 'CANCELLED']);
  });
});

describe('vehicles released from a dispatch', () => {
  test('a released vehicle no longer has to pass the commit', () => {
    const w = new World(demoState());
    const f = Object.values(w.s.features).find((x) => x.name === 'guided_brake')!;
    const group = vg(w, '制动研发车组');
    const [d] = w.as('brake_tester', (c) => v.dispatchFeature(c, f.id, { commitId: f.headCommitId!, vehicleGroupIds: [group] }));
    w.as('resource', (c) => v.releaseVehicle(c, 'VEH-001', '转测试环境'));
    w.as('workspace_manager', (c) => fleet.removeGroupMember(c, group, 'VEH-001', '转测试环境'));
    assert.ok(!v.featureTestStatus(w.s, w.s.features[f.id]!).some((t) => t.resourceId === 'VEH-001'));
    // A replacement car joins and passes with the simulator.
    w.as('resource', (c) => fleet.registerPhysical(c, { id: 'VEH-009', vin: 'LSDEMX89000000900', vehicleModelId: 'X89', env: 'development', pool: 'Chassis' }));
    w.as('resource', (c) => fleet.confirmIntegration(c, 'VEH-009', { version: w.s.resources['VEH-001']!.integrationVersion!, source: 'DIP' }));
    w.as('workspace_manager', (c) => fleet.addWorkspaceVehicle(c, 'team-brake', 'VEH-009'));
    w.as('workspace_manager', (c) => fleet.addGroupMember(c, group, 'VEH-009', '替换 VEH-001'));
    w.sys((c) => sendReceipt(c, d!, 'SIM-021', 'APPLIED'));
    const ds = w.as('brake_tester', (c) => v.dispatchFeature(c, f.id, { commitId: f.headCommitId!, vehicleGroupIds: [group] }));
    for (const id of ds) for (const t of w.s.deployments[id]!.targets) if (t.status === 'PENDING') w.sys((c) => sendReceipt(c, id, t.resourceId, 'APPLIED'));
    for (const r of ['SIM-021', 'VEH-009']) w.as('brake_tester', (c) => v.recordFeatureTest(c, f.id, { commitId: f.headCommitId!, resourceId: r, result: 'PASS', summary: 'ok' }));
    assert.deepEqual(v.verifyBlockers(w.s, w.s.features[f.id]!), []);
    w.as('brake_tester', (c) => v.verifyFeature(c, f.id));
    assert.equal(w.s.features[f.id]!.stage, 'VERIFIED');
  });

  test('a group left with no vehicle on a dispatch returns to what still stands there', () => {
    const w = new World(demoState());
    const f = Object.values(w.s.features).find((x) => x.name === 'guided_brake')!;
    const g1 = vg(w, '制动研发车组');
    w.as('resource', (c) => fleet.registerPhysical(c, { id: 'VEH-009', vin: 'LSDEMX89000000900', vehicleModelId: 'X89', env: 'development', pool: 'Chassis' }));
    w.as('resource', (c) => fleet.confirmIntegration(c, 'VEH-009', { version: w.s.resources['VEH-001']!.integrationVersion!, source: 'DIP' }));
    w.as('workspace_manager', (c) => fleet.addWorkspaceVehicle(c, 'team-brake', 'VEH-009'));
    const g2 = w.as('workspace_manager', (c) => fleet.createVehicleGroup(c, { workspaceId: 'team-brake', groupId: 'brake', name: '制动第二车组', purpose: 'DEV', env: 'development' }));
    w.as('workspace_manager', (c) => fleet.addGroupMember(c, g2, 'VEH-009', '第二车组'));
    const [d0] = w.as('brake_tester', (c) => v.dispatchFeature(c, f.id, { commitId: f.headCommitId!, vehicleGroupIds: [g2] }));
    w.sys((c) => sendReceipt(c, d0!, 'VEH-009', 'APPLIED'));
    const policy = Object.keys(w.s.features[f.id]!.draft.policies)[0]!;
    const p = w.s.features[f.id]!.draft.policies[policy]!;
    w.as('business', (c) => config.putPolicy(c, f.id, policy, { ...p, postSeconds: p.postSeconds + 2 }));
    const c2 = w.as('business', (c) => config.submitFeature(c, f.id, {})).commitId;
    w.as('brake_tester', (c) => v.dispatchFeature(c, f.id, { commitId: c2, vehicleGroupIds: [g1, g2] }));
    w.as('resource', (c) => v.releaseVehicle(c, 'VEH-009', '转测试环境'));
    const g = w.s.vehicleGroups[g2]!;
    assert.equal(g.publication?.kind === 'FEATURE' && g.publication.commitId, f.headCommitId);
    assert.ok(fleet.livePublication(w.s, g));
  });
});

describe('subsystem releases as sources', () => {
  test('a source holding a subsystem release in a preview cannot be dropped', () => {
    const w = new World(demoState());
    const featureId = adcFeature(w, 'park_one');
    const plan = w.as('adc_integrator', (c) => integ.previewMerge(c, { workspaceId: 'x89-adc-integration', featureIds: [featureId] }));
    w.as('dcl', (c) => integ.confirmProcessing(c, plan, { note: '' }));
    const cand = w.as('adc_integrator', (c) => integ.freezeCandidate(c, plan, { label: 'ADC-C1' }));
    const d = w.as('adc_integrator', (c) => v.dispatchCandidate(c, cand, { vehicleGroupIds: [vg(w, 'ADC 域集成测试车组')] }));
    const vehicles = w.s.deployments[d]!.targets.map((t) => t.resourceId);
    for (const r of vehicles) w.sys((c) => sendReceipt(c, d, r, 'APPLIED'));
    for (const r of vehicles) w.as('adc_integrator', (c) => v.recordCandidateTest(c, cand, { resourceId: r, result: 'PASS', summary: 'ok' }));
    w.as('adc_integrator', (c) => v.verifyCandidate(c, cand));
    const s1 = w.as('adc_integrator', (c) => integ.publishSubsystem(c, cand, { notes: 'ADC' }));
    w.as('integrator', (c) => integ.previewMerge(c, { workspaceId: 'x89-project', featureIds: [], subsystemReleaseIds: [s1] }));
    const sources = w.s.workspaces['x89-project']!.sourceWorkspaceIds;
    w.fails('SOURCE_IN_USE', () => w.as('admin', (c) => org.updateWorkspace(c, 'x89-project', { sourceWorkspaceIds: sources.filter((x) => x !== 'x89-adc-integration') })));
  });
});

describe('planned versions and sign-in', () => {
  test('a production vehicle reporting a planned version is not a task to record it', () => {
    const w = new World(demoState());
    w.as('integration_admin', (c) => calls.openCall(c, { workspaceId: 'x89-project', targetVersion: '1.2', dueDate: null }));
    w.sys((c) => simulateSoftwareOta(c, 'VEH-201', '1.2'));
    w.sys((c) => reportNow(c, 'VEH-201'));
    for (const ws of Object.keys(w.s.workspaces)) {
      assert.ok(!w.engine.read('resource', (s, a) => notificationsFor(s, a, ws)).some((n) => n.kind === 'UNRECORDED_SOFTWARE'), ws);
    }
  });

  test('a domain integrator starts in its integration workspace', () => {
    const w = new World(demoState());
    assert.equal(w.engine.read('adc_integrator', (s, a) => landingWorkspace(s, a)), 'x89-adc-integration');
  });
});
