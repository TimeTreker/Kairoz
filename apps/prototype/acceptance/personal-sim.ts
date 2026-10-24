// 个人研发仿真 (PS01–PS09, N01) on the demo installation: a developer's own simulation runs a
// Feature draft, trial captures and self-tests stay theirs, team testing is unchanged.

import { configurationContents } from '../src/engine/client-report.ts';
import * as dir from '../src/engine/company-directory.ts';
import * as config from '../src/engine/config.ts';
import { captureEvent } from '../src/engine/events.ts';
import * as fleet from '../src/engine/fleet.ts';
import * as ps from '../src/engine/personal-sim.ts';
import { demoState } from '../src/engine/seed.ts';
import type { State } from '../src/engine/types.ts';
import * as v from '../src/engine/validation.ts';
import { answerAll } from './helpers.ts';
import type { SceneSpec, World } from './world.ts';

export const start = (): State => demoState();

const monitor = (w: World) => Object.values(w.s.features).find((f) => f.name === 'brake_monitor')!;
const groupId = (w: World, name: string) => Object.values(w.s.vehicleGroups).find((g) => g.name === name)!.id;
const create = (w: World, who: string, imageId: string, displayName?: string) =>
  w.as(who, (c) => ps.createPersonalSim(c, { workspaceId: 'team-brake', groupId: 'brake', imageId, displayName }));
const send = (w: World, who: string, id: string, input: { disabledPolicies?: string[]; baseReleaseId?: string | null } = {}) =>
  w.as(who, (c) => ps.configurePersonalSim(c, id, { featureId: monitor(w).id, ...input }));
const applied = (w: World, id: string) => w.s.resolvedConfigs[w.s.resources[id]!.appliedConfigId!]!;
const setTrigger = (w: World, trigger: string) => {
  const f = monitor(w);
  w.as('business', (c) => config.putPolicy(c, f.id, 'chassis.brake.monitor', { ...f.draft.policies['chassis.brake.monitor']!, trigger }));
};

export const scenes: Record<string, SceneSpec> = {
  PS01: {
    run: (w) => {
      const id = create(w, 'business', 'x89-dev-sim', '急刹车调试');
      w.eq(id, 'SIM-P001', 'the platform names the instance; the id is its UVID');
      const r = w.s.resources[id]!;
      w.eq([r.env, r.uvid, r.integrationVersion, r.personal?.owner], ['development', id, null, 'business'], 'a development simulation with unknown software, owned by business');
      w.eq(ps.activePersonalCount(w.s, 'business', 'team-brake'), 1, 'quota 1/3');
      w.check(!fleet.workspaceVehicles(w.s, 'team-brake').some((x) => x.id === id), 'not among the workspace vehicles');
      w.eq(ps.personalSimsOf(w.s, 'brake_tester', 'team-brake'), [], 'another member of the group has none and sees none');
      w.ref.sim = id;
    },
  },
  PS02: {
    needs: ['PS01'],
    run: (w) => {
      const id = w.ref.sim!;
      const stage = monitor(w).stage;
      setTrigger(w, 'brake_pressure > 90 AND vehicle_deceleration > 6');
      const d = send(w, 'business', id);
      w.eq(w.s.resources[id]!.appliedConfigId, null, 'nothing runs before the receipt');
      answerAll(w, d);
      const c = applied(w, id);
      w.eq([c.kind, c.baseReleaseId, c.draft!.snapshot.policies['chassis.brake.monitor']!.trigger], ['PERSONAL', null, 'brake_pressure > 90 AND vehicle_deceleration > 6'], 'the draft runs on the initial configuration');
      const events = Object.keys(w.s.events).length;
      const cap = w.sys((x) => ps.trialCapture(x, id, 'chassis.brake.monitor'));
      w.eq(w.s.personalCaptures[cap]!.files.map((f) => f.name), ['制动监测日志'], 'the trial lists the files the policy captures');
      w.eq(Object.keys(w.s.events).length, events, 'no collection event');
      const runs = w.s.testRuns.length;
      w.as('business', (x) => ps.recordPersonalTest(x, id, { result: 'PASS', note: '急刹车场景回放，触发正确' }));
      const [t] = ps.personalTestsOf(w.s, monitor(w).id);
      w.eq([t!.result, t!.draftCurrent, t!.captureIds], ['PASS', true, [cap]], 'the self-test pins the draft and the trial');
      w.eq([w.s.testRuns.length, monitor(w).stage], [runs, 'DRAFT'], 'no team test run; the Feature is a draft because of the edit');
      w.check(stage === 'VERIFIED', 'brake_monitor started verified');
    },
  },
  PS03: {
    needs: ['PS02'],
    run: (w) => {
      const id = w.ref.sim!;
      w.fails('PERSONAL_SIM_OWNER', () => w.as('brake_tester', (c) => fleet.stopSimulation(c, id)));
      w.fails('PERSONAL_SIM_OWNER', () => w.as('brake_tester', (c) => ps.releasePersonalSim(c, id)));
      w.denied('workspace_manager', (c) => fleet.stopSimulation(c, id));
      w.fails('PERSONAL_SIMULATION', () => w.as('workspace_manager', (c) => fleet.addGroupMember(c, groupId(w, '制动研发车组'), id, '归组')));
      w.fails('PERSONAL_SIMULATION', () => w.as('workspace_manager', (c) => fleet.addWorkspaceVehicle(c, 'team-brake', id)));
      w.fails('PERSONAL_TRIAL_ONLY', () => w.sys((c) => captureEvent(c, { resourceId: id, policyId: 'chassis.brake.monitor' })));
    },
  },
  PS04: {
    needs: ['PS03'],
    run: (w) => {
      const id = w.ref.sim!;
      const f = monitor(w);
      const before = f.draft.policies['chassis.brake.monitor']!;
      const video = w.as('business', (c) =>
        config.addFile(c, f.id, { source: { unit: 'ADC', directory: '/data/camera/brake', pattern: 'brake_*.mp4' }, name: '制动前视视频', purpose: '复现急刹车' }),
      );
      w.as('business', (c) => config.putPolicy(c, f.id, 'chassis.brake.monitor', { ...before, captures: [...before.captures, video].sort() }));
      const e = w.fails('SENSITIVE_NOT_REVIEWED', () => send(w, 'business', id));
      w.eq((e.details as { issues: string[] }).issues, ['制动前视视频'], 'names the unreviewed file');
      w.as('business', (c) => config.putPolicy(c, f.id, 'chassis.brake.monitor', before));
      w.as('business', (c) => config.removeFile(c, f.id, video));
      w.eq(ps.personalTestsOf(w.s, f.id)[0]!.draftCurrent, true, 'the draft is back to what was self-tested');
    },
  },
  PS05: {
    needs: ['PS04'],
    run: (w) => {
      const id = create(w, 'business', 'x89-1.0-sim', '1.0 回归');
      const set = Object.values(w.s.releases).find((r) => r.dclVersion === '1.0.0')!;
      w.eq(v.vehicleBase(w.s, null, w.s.resources[id]!).release?.id, set.id, 'software 1.0 follows policy set 1.0.0');
      w.fails('POLICY_NOT_SWITCHABLE', () => send(w, 'business', id, { disabledPolicies: ['chassis.brake.failure_diag'] }));
      answerAll(w, send(w, 'business', id, { disabledPolicies: ['chassis.steering.angle_jump'] }));
      const c = applied(w, id);
      w.eq([c.baseReleaseId, Object.keys(c.groups)], [set.id, ['steering']], 'the draft replaces the brake commit; steering stays from the set');
      const contents = configurationContents(w.s, c.id)!;
      w.eq(contents.policies.find((p) => p.id === 'chassis.steering.angle_jump')?.status, 'DISABLED', 'the switched-off policy is off');
      w.eq(contents.policies.find((p) => p.id === 'chassis.brake.monitor')?.version, 'draft', 'the brake policy is the draft');
      w.ref.sim10 = id;
    },
  },
  PS06: {
    needs: ['PS05'],
    run: (w) => {
      const f = monitor(w);
      const commitId = w.as('business', (c) => config.submitFeature(c, f.id, { message: '收紧急刹车阈值' })).commitId;
      const [t] = ps.personalTestsOf(w.s, f.id);
      w.eq([t!.result, t!.matchingCommitId], ['PASS', commitId], 'the PASS self-test matches the new commit');
      w.eq(w.s.commits[commitId]!.sequence, 2, 'commit r002');
      for (const d of w.as('brake_tester', (c) => v.dispatchFeature(c, f.id, { commitId, vehicleGroupIds: [groupId(w, '制动研发车组')] }))) answerAll(w, d);
      w.eq(v.featureTestStatus(w.s, monitor(w)).map((x) => x.resourceId), ['SIM-021', 'VEH-001'], 'the targets are the group’s vehicles only');
      w.fails('NOT_A_TEST_TARGET', () => w.as('brake_tester', (c) => v.recordFeatureTest(c, f.id, { commitId, resourceId: w.ref.sim!, result: 'PASS', summary: '个人自测' })));
      setTrigger(w, 'brake_pressure > 85 AND vehicle_deceleration > 6');
      w.eq(ps.personalTestsOf(w.s, f.id)[0]!.draftCurrent, false, 'an edit marks the self-test as for an earlier draft');
    },
  },
  PS07: {
    needs: ['PS06'],
    run: (w) => {
      create(w, 'business', 'x89-1.1-sim');
      w.eq(ps.activePersonalCount(w.s, 'business', 'team-brake'), 3, 'quota 3/3');
      w.fails('PERSONAL_QUOTA', () => create(w, 'business', 'x89-dev-sim'));
      const id = w.ref.sim!;
      send(w, 'business', id);
      w.fails('VEHICLE_BUSY', () => w.as('business', (c) => ps.releasePersonalSim(c, id)));
      w.as('business', (c) => ps.cancelPersonalConfig(c, id));
      w.as('business', (c) => ps.releasePersonalSim(c, id));
      w.eq(w.s.resources[id]!.status, 'RETIRED', 'released');
      w.eq(Object.values(w.s.personalTests).filter((t) => t.resourceId === id).length, 1, 'its self-test stays');
      w.eq(ps.personalCapturesOf(w.s, id).length, 1, 'its trial capture stays');
      w.eq(ps.activePersonalCount(w.s, 'business', 'team-brake'), 2, 'quota 2/3');
    },
  },
  PS08: {
    needs: ['PS07'],
    run: (w) => {
      const id = create(w, 'brake_tester', 'x89-dev-sim', '测试自查');
      w.denied('brake_tester', (c) => config.putPolicy(c, monitor(w).id, 'chassis.brake.monitor', { ...monitor(w).draft.policies['chassis.brake.monitor']!, trigger: 'vehicle_speed > 1' }));
      answerAll(w, send(w, 'brake_tester', id));
      w.as('brake_tester', (c) => ps.recordPersonalTest(c, id, { result: 'FAIL', note: '低速急刹未触发' }));
      w.eq(ps.personalTestsOf(w.s, monitor(w).id)[0]!.owner, 'brake_tester', 'listed with the Feature’s self-tests');
      w.eq(v.featureTestStatus(w.s, monitor(w)).some((t) => t.resourceId === id), false, 'never a team test target');
    },
  },
  PS09: {
    needs: ['PS08'],
    run: (w) => {
      w.sys((c) => dir.hirePerson(c, { username: 'brake_dev2', displayName: '何晓', deptExtId: 'brake-team' }));
      w.sys((c) => dir.syncIfChanged(c));
      const id = create(w, 'brake_dev2', 'x89-dev-sim');
      const d = send(w, 'brake_dev2', id);
      const employee = w.s.accounts['brake_dev2']!.employeeId!;
      w.sys((c) => dir.personLeaves(c, employee));
      w.sys((c) => dir.syncIfChanged(c));
      w.eq([w.s.accounts['brake_dev2']!.status, w.s.resources[id]!.status, w.s.deployments[d]!.status], ['DISABLED', 'RETIRED', 'CANCELLED'], 'disabled, released, the pending draft withdrawn');
      w.eq(w.s.directorySync.log.find((e) => e.kind === 'PERSONAL_SIMS_RELEASED')?.detail, id, 'the sync log names the instance');
    },
  },
  N01: {
    run: (w) => {
      w.fails('PERSONAL_DEVELOPMENT_ONLY', () => w.as('business', (c) => ps.createPersonalSim(c, { workspaceId: 'team-brake', groupId: 'brake', imageId: 'x89-dev-sim', env: 'production' })));
      w.as('dcl', (c) => fleet.registerImage(c, { id: 'x90-dev-sim', vehicleModelId: 'X90', integrationVersion: null, build: 'x90-dev', digest: 'sha256:mock-x90-dev', simulator: 'SimOne 3' }));
      w.fails('IMAGE_MODEL_MISMATCH', () => create(w, 'business', 'x90-dev-sim'));
      w.denied('workspace_manager', (c) => ps.createPersonalSim(c, { workspaceId: 'team-brake', groupId: 'brake', imageId: 'x89-dev-sim' }));
    },
  },
};
