import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { answerAll } from '../acceptance/helpers.ts';
import { World } from '../acceptance/world.ts';
import { configurationContents } from '../src/engine/client-report.ts';
import * as dir from '../src/engine/company-directory.ts';
import * as config from '../src/engine/config.ts';
import { captureEvent } from '../src/engine/events.ts';
import * as fleet from '../src/engine/fleet.ts';
import { updateAccount } from '../src/engine/identity.ts';
import { answerConfigRequest } from '../src/engine/ota.ts';
import * as ps from '../src/engine/personal-sim.ts';
import { demoState } from '../src/engine/seed.ts';
import * as v from '../src/engine/validation.ts';

const feature = (w: World, name: string) => Object.values(w.s.features).find((f) => f.name === name)!;
const set = (w: World, version: string) => Object.values(w.s.releases).find((r) => r.dclVersion === version)!;
const groupId = (w: World, name: string) => Object.values(w.s.vehicleGroups).find((g) => g.name === name)!.id;
const create = (w: World, who: string, imageId: string) => w.as(who, (c) => ps.createPersonalSim(c, { workspaceId: 'team-brake', groupId: 'brake', imageId }));
const configure = (w: World, who: string, id: string, input: Partial<Parameters<typeof ps.configurePersonalSim>[2]> = {}) =>
  w.as(who, (c) => ps.configurePersonalSim(c, id, { featureId: feature(w, 'brake_monitor').id, ...input }));
const applied = (w: World, id: string) => w.s.resolvedConfigs[w.s.resources[id]!.appliedConfigId!]!;

/** Changes the brake_monitor draft so it differs from its committed head. */
function editDraft(w: World, trigger = 'brake_pressure > 90 AND vehicle_deceleration > 6'): void {
  const f = feature(w, 'brake_monitor');
  const p = f.draft.policies['chassis.brake.monitor']!;
  w.as('business', (c) => config.putPolicy(c, f.id, 'chassis.brake.monitor', { ...p, trigger }));
}

describe('personal simulation', () => {
  test('the owner creates one from an image; it never joins the workspace, groups or team tests', () => {
    const w = new World(demoState());
    const id = create(w, 'business', 'x89-dev-sim');
    assert.equal(id, 'SIM-P001');
    const r = w.s.resources[id]!;
    assert.deepEqual([r.type, r.env, r.uvid, r.integrationVersion, r.personal], ['SIMULATION', 'development', id, null, { owner: 'business', groupId: 'brake' }]);
    assert.ok(!(w.s.workspaceResources['team-brake'] ?? []).includes(id));
    assert.ok(!fleet.assignableVehicles(w.s, 'team-brake').some((x) => x.id === id));
    w.fails('PERSONAL_SIMULATION', () => w.as('workspace_manager', (c) => fleet.addWorkspaceVehicle(c, 'team-brake', id)));
    w.fails('PERSONAL_SIMULATION', () => w.as('workspace_manager', (c) => fleet.addGroupMember(c, groupId(w, '制动研发车组'), id, 'try')));
    assert.deepEqual(fleet.directTargetProblems(w.s, 'team-brake', [id]), [`${id}: personal simulation of business; only its owner uses it`]);
    // Another member of the group: the grant holds, the ownership does not.
    w.fails('PERSONAL_SIM_OWNER', () => w.as('brake_tester', (c) => ps.releasePersonalSim(c, id)));
    w.fails('PERSONAL_SIM_OWNER', () => w.as('brake_tester', (c) => fleet.stopSimulation(c, id)));
    // The workspace admin has no personal-simulation grant at all.
    w.denied('workspace_manager', (c) => fleet.stopSimulation(c, id));
    w.fails('PERSONAL_DEVELOPMENT_ONLY', () => w.as('business', (c) => ps.createPersonalSim(c, { workspaceId: 'team-brake', groupId: 'brake', imageId: 'x89-dev-sim', env: 'production' })));
  });

  test('a draft runs on the base its software takes, only after a receipt, and its captures stay trials', () => {
    const w = new World(demoState());
    const unknown = create(w, 'business', 'x89-dev-sim');
    editDraft(w);
    const d = configure(w, 'business', unknown);
    assert.equal(answerConfigRequest(w.s, unknown).reason, 'PERSONAL');
    assert.equal(w.s.resources[unknown]!.appliedConfigId, null, 'nothing runs before the receipt');
    w.fails('PERSONAL_NOT_APPLIED', () => w.as('business', (c) => ps.recordPersonalTest(c, unknown, { result: 'PASS', note: 'x' })));
    answerAll(w, d);
    const c1 = applied(w, unknown);
    assert.equal(c1.kind, 'PERSONAL');
    assert.equal(c1.baseReleaseId, null, 'unknown software takes the initial configuration');
    assert.deepEqual(Object.keys(c1.groups), []);
    assert.equal(c1.draft!.snapshot.policies['chassis.brake.monitor']!.trigger, 'brake_pressure > 90 AND vehicle_deceleration > 6');

    // Software 1.0: the set in effect is the base, the draft replaces the brake group's commit.
    const known = create(w, 'business', 'x89-1.0-sim');
    const d2 = configure(w, 'business', known, { disabledPolicies: ['chassis.steering.angle_jump'] });
    answerAll(w, d2);
    const c2 = applied(w, known);
    assert.equal(c2.baseReleaseId, set(w, '1.0.0').id);
    assert.deepEqual(Object.keys(c2.groups), ['steering']);
    assert.deepEqual(c2.disabledPolicies, ['chassis.steering.angle_jump']);
    const contents = configurationContents(w.s, c2.id)!;
    assert.deepEqual(contents.policies.find((p) => p.id === 'chassis.steering.angle_jump')?.status, 'DISABLED');
    assert.deepEqual(contents.policies.find((p) => p.id === 'chassis.brake.monitor')?.version, 'draft');
    w.fails('POLICY_NOT_SWITCHABLE', () => configure(w, 'business', known, { disabledPolicies: ['chassis.brake.monitor'] }));
    w.fails('CONFIG_ALREADY_APPLIED', () => configure(w, 'business', known, { disabledPolicies: ['chassis.steering.angle_jump'] }));

    // A failed receipt keeps what it ran.
    editDraft(w, 'brake_pressure > 95');
    const d3 = configure(w, 'business', known);
    answerAll(w, d3, 'FAILED');
    assert.equal(w.s.resources[known]!.appliedConfigId, c2.id);

    // Trial captures: the draft's policies only, never collection events.
    const events = Object.keys(w.s.events).length;
    w.fails('PERSONAL_TRIAL_ONLY', () => w.sys((c) => captureEvent(c, { resourceId: unknown, policyId: 'chassis.brake.monitor' })));
    assert.deepEqual(ps.personalCapturablePolicies(w.s, unknown).map((p) => p.policyId), ['chassis.brake.failure_diag', 'chassis.brake.monitor']);
    w.fails('POLICY_NOT_ON_VEHICLE', () => w.sys((c) => ps.trialCapture(c, known, 'chassis.steering.angle_jump')));
    const cap = w.sys((c) => ps.trialCapture(c, unknown, 'chassis.brake.monitor'));
    assert.equal(Object.keys(w.s.events).length, events);
    assert.deepEqual(w.s.personalCaptures[cap]!.files.map((f) => f.name), ['制动监测日志']);

    // The self-test pins what ran and changes nothing of the Feature.
    const f = feature(w, 'brake_monitor');
    const before = { stage: f.stage, runs: w.s.testRuns.length, targets: w.s.testTargets.length };
    const t = w.as('business', (c) => ps.recordPersonalTest(c, unknown, { result: 'PASS', note: '急刹车场景触发' }));
    const test = w.s.personalTests[t]!;
    assert.deepEqual([test.captureIds, test.imageId, test.integrationVersion, test.baseReleaseId], [[cap], 'x89-dev-sim', null, null]);
    assert.deepEqual({ stage: feature(w, 'brake_monitor').stage, runs: w.s.testRuns.length, targets: w.s.testTargets.length }, before);
  });

  test('sensitive files need a DCL approval and the draft must be runnable', () => {
    const w = new World(demoState());
    const id = create(w, 'business', 'x89-dev-sim');
    const f = feature(w, 'brake_monitor');
    const video = w.as('business', (c) =>
      config.addFile(c, f.id, { source: { unit: 'ADC', directory: '/data/camera/brake', pattern: 'brake_*.mp4' }, name: '制动前视视频', purpose: '复现急刹车' }),
    );
    const p = f.draft.policies['chassis.brake.monitor']!;
    w.as('business', (c) => config.putPolicy(c, f.id, 'chassis.brake.monitor', { ...p, captures: [...p.captures, video].sort() }));
    const e = w.fails('SENSITIVE_NOT_REVIEWED', () => configure(w, 'business', id));
    assert.deepEqual((e.details as { issues: string[] }).issues, [video]);
  });

  test('self-tests are shown against the draft and commits, never required', () => {
    const w = new World(demoState());
    const id = create(w, 'business', 'x89-dev-sim');
    editDraft(w);
    answerAll(w, configure(w, 'business', id));
    w.as('business', (c) => ps.recordPersonalTest(c, id, { result: 'PASS', note: 'ok' }));
    const f = feature(w, 'brake_monitor');
    let [view] = ps.personalTestsOf(w.s, f.id);
    assert.deepEqual([view!.draftCurrent, view!.matchingCommitId], [true, null]);
    const commitId = w.as('business', (c) => config.submitFeature(c, f.id, { message: 'tighter trigger' })).commitId;
    [view] = ps.personalTestsOf(w.s, f.id);
    assert.deepEqual([view!.draftCurrent, view!.matchingCommitId], [true, commitId]);
    // The personal simulation is no test target of the commit; team testing goes through the groups.
    for (const dp of w.as('brake_tester', (c) => v.dispatchFeature(c, f.id, { commitId, vehicleGroupIds: [groupId(w, '制动研发车组')] }))) answerAll(w, dp);
    w.fails('NOT_A_TEST_TARGET', () => w.as('brake_tester', (c) => v.recordFeatureTest(c, f.id, { commitId, resourceId: id, result: 'PASS', summary: 'x' })));
    editDraft(w, 'brake_pressure > 99');
    [view] = ps.personalTestsOf(w.s, f.id);
    assert.deepEqual([view!.draftCurrent, view!.matchingCommitId], [false, commitId]);
  });

  test('quota, release and a leaver’s instances', () => {
    const w = new World(demoState());
    const ids = ['x89-dev-sim', 'x89-1.0-sim', 'x89-1.1-sim'].map((img) => create(w, 'business', img));
    w.fails('PERSONAL_QUOTA', () => create(w, 'business', 'x89-dev-sim'));
    editDraft(w);
    const d = configure(w, 'business', ids[0]!);
    w.fails('VEHICLE_BUSY', () => w.as('business', (c) => ps.releasePersonalSim(c, ids[0]!)));
    answerAll(w, d);
    w.as('business', (c) => ps.recordPersonalTest(c, ids[0]!, { result: 'FAIL', note: '漏触发' }));
    w.as('business', (c) => ps.releasePersonalSim(c, ids[0]!));
    assert.deepEqual([w.s.resources[ids[0]!]!.status, w.s.resources[ids[0]!]!.instance], ['RETIRED', 'STOPPED']);
    assert.equal(Object.values(w.s.personalTests).filter((t) => t.resourceId === ids[0]).length, 1, 'history stays');
    w.fails('PERSONAL_SIM_RELEASED', () => configure(w, 'business', ids[0]!));
    assert.equal(create(w, 'business', 'x89-dev-sim'), 'SIM-P004');

    // A tester has their own; a hire from the directory too, released when they leave.
    const mine = create(w, 'brake_tester', 'x89-dev-sim');
    assert.equal(w.s.resources[mine]!.personal!.owner, 'brake_tester');
    w.sys((c) => dir.hirePerson(c, { username: 'brake_new', displayName: '新同事', deptExtId: 'brake-team' }));
    w.sys((c) => dir.syncIfChanged(c));
    const hired = create(w, 'brake_new', 'x89-dev-sim');
    const pending = configure(w, 'brake_new', hired);
    const employee = w.s.accounts.brake_new!.employeeId!;
    w.sys((c) => dir.personLeaves(c, employee));
    w.sys((c) => dir.syncIfChanged(c));
    assert.equal(w.s.resources[hired]!.status, 'RETIRED');
    assert.equal(w.s.deployments[pending]!.status, 'CANCELLED');
    assert.equal(w.s.directorySync.log.find((e) => e.kind === 'PERSONAL_SIMS_RELEASED')?.detail, hired);

    // Ops disabling an account gives its instances back as well.
    w.as('admin', (c) => updateAccount(c, 'brake_tester', { status: 'DISABLED' }));
    assert.equal(w.s.resources[mine]!.status, 'RETIRED');
  });
});
