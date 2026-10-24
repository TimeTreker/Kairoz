// 仿真车软件 (SW01–SW08, N01) on the demo installation: module builds into derived images, deploy,
// switch and roll back, on a personal and a shared simulation. The simulator plays the mock CI
// and the simulation provider.

import * as config from '../src/engine/config.ts';
import * as fleet from '../src/engine/fleet.ts';
import { answerConfigRequest } from '../src/engine/ota.ts';
import * as ps from '../src/engine/personal-sim.ts';
import { demoState } from '../src/engine/seed.ts';
import * as sw from '../src/engine/sim-software.ts';
import type { State } from '../src/engine/types.ts';
import * as v from '../src/engine/validation.ts';
import { answerAll } from './helpers.ts';
import type { SceneSpec, World } from './world.ts';

export const start = (): State => demoState();

const BRAKE = { module: 'brake', repository: 'https://github.com/example/brake', ref: 'main' };
const monitor = (w: World) => Object.values(w.s.features).find((f) => f.name === 'brake_monitor')!;
const groupId = (w: World, name: string) => Object.values(w.s.vehicleGroups).find((g) => g.name === name)!.id;
const sendDraft = (w: World, id: string) => answerAll(w, w.as('business', (c) => ps.configurePersonalSim(c, id, { featureId: monitor(w).id })));
const apply = (w: World, changeId: string, result: 'APPLIED' | 'FAILED' = 'APPLIED') => w.sys((c) => sw.answerImageChange(c, changeId, result));

export const scenes: Record<string, SceneSpec> = {
  SW01: {
    run: (w) => {
      const id = w.as('business', (c) => ps.createPersonalSim(c, { workspaceId: 'team-brake', groupId: 'brake', imageId: 'x89-1.0-sim', displayName: '制动模块调试' }));
      w.eq(w.s.resources[id]!.integrationVersion, '1.0', 'software 1.0 from the image');
      sendDraft(w, id);
      w.as('business', (c) => ps.recordPersonalTest(c, id, { result: 'PASS', note: '原镜像上急刹车触发正确' }));
      w.ref.sim = id;
    },
  },
  SW02: {
    needs: ['SW01'],
    run: (w) => {
      const id = w.ref.sim!;
      const applied = w.s.resources[id]!.appliedConfigId;
      const b = w.as('business', (c) => sw.requestBuild(c, id, BRAKE));
      w.eq(w.s.softwareBuilds[b]!.status, 'REQUESTED', 'waiting for the build provider');
      const image = w.sys((c) => sw.completeBuild(c, b, 'PASS'))!;
      w.eq([w.s.softwareBuilds[b]!.resolvedCommit, image], [`mock-commit:${b}`, 'dev-x89-1.0-sim-brake-1'], 'a mock commit and a derived image');
      w.eq([w.s.resources[id]!.imageId, w.s.resources[id]!.appliedConfigId], ['x89-1.0-sim', applied], 'the running image and configuration are unchanged');
      w.ref.build = b;
    },
  },
  SW03: {
    needs: ['SW02'],
    run: (w) => {
      const id = w.ref.sim!;
      const b = w.ref.build!;
      w.fails('SIMULATION_RUNNING', () => w.as('business', (c) => sw.deployBuild(c, id, b)));
      w.as('business', (c) => fleet.stopSimulation(c, id));
      const applied = w.s.resources[id]!.appliedConfigId;
      apply(w, w.as('business', (c) => sw.deployBuild(c, id, b)), 'FAILED');
      w.eq([w.s.resources[id]!.imageId, w.s.resources[id]!.appliedConfigId], ['x89-1.0-sim', applied], 'a failed deployment keeps image and configuration');
      apply(w, w.as('business', (c) => sw.deployBuild(c, id, b)));
      const r = w.s.resources[id]!;
      w.eq([r.imageId, r.integrationVersion, r.appliedConfigId], ['dev-x89-1.0-sim-brake-1', '1.0', null], 'the derived image runs; source version 1.0; configuration cleared');
      w.eq(ps.personalTestsOf(w.s, monitor(w).id)[0]!.imageCurrent, false, 'the earlier self-test belongs to the old image');
    },
  },
  SW04: {
    needs: ['SW03'],
    run: (w) => {
      const id = w.ref.sim!;
      w.as('business', (c) => fleet.startSimulation(c, id));
      sendDraft(w, id);
      w.as('business', (c) => ps.recordPersonalTest(c, id, { result: 'PASS', note: '新制动模块上急刹车触发正确' }));
      const [t] = ps.personalTestsOf(w.s, monitor(w).id);
      w.eq([t!.imageId, t!.imageCurrent], ['dev-x89-1.0-sim-brake-1', true], 'the new self-test is on the derived image');
    },
  },
  SW05: {
    needs: ['SW04'],
    run: (w) => {
      const id = w.ref.sim!;
      w.as('business', (c) => fleet.stopSimulation(c, id));
      apply(w, w.as('business', (c) => sw.rollbackImage(c, id)));
      w.eq([w.s.resources[id]!.imageId, w.s.resources[id]!.appliedConfigId], ['x89-1.0-sim', null], 'the previous image is back; configuration cleared');
      w.fails('NOTHING_TO_ROLL_BACK', () => w.as('business', (c) => sw.rollbackImage(c, id)));
    },
  },
  SW06: {
    needs: ['SW05'],
    run: (w) => {
      const id = w.ref.sim!;
      w.fails('INVALID_REPOSITORY', () => w.as('business', (c) => sw.requestBuild(c, id, { ...BRAKE, repository: 'file:///etc/passwd' })));
      w.fails('INVALID_REPOSITORY', () => w.as('business', (c) => sw.requestBuild(c, id, { ...BRAKE, repository: 'https://evil.test/repo' })));
      w.fails('INVALID_REPOSITORY', () => w.as('business', (c) => sw.requestBuild(c, id, { ...BRAKE, repository: 'https://github.com/example/repo?token=x' })));
      w.fails('UNKNOWN_MODULE', () => w.as('business', (c) => sw.requestBuild(c, id, { ...BRAKE, module: 'shell' })));
      const b = w.as('business', (c) => sw.requestBuild(c, id, BRAKE));
      w.fails('BUILD_OPEN', () => w.as('business', (c) => sw.requestBuild(c, id, BRAKE)));
      w.as('business', (c) => sw.cancelBuild(c, id, b));
      w.eq(w.s.softwareBuilds[b]!.status, 'CANCELLED', 'cancelled');
      w.fails('PERSONAL_SIM_OWNER', () => w.as('brake_tester', (c) => sw.requestBuild(c, id, BRAKE)));
    },
  },
  SW07: {
    needs: ['SW06'],
    run: (w) => {
      w.denied('business', (c) => sw.switchImage(c, 'SIM-021', 'x89-1.1-sim'));
      w.as('workspace_manager', (c) => fleet.stopSimulation(c, 'SIM-021'));
      apply(w, w.as('workspace_manager', (c) => sw.switchImage(c, 'SIM-021', 'x89-1.1-sim')));
      w.eq([w.s.resources['SIM-021']!.integrationVersion, w.s.resources['SIM-021']!.appliedConfigId], ['1.1', null], 'software 1.1, configuration cleared');
      w.eq(answerConfigRequest(w.s, 'SIM-021').reason, 'NO_BASE', 'no policy set applies to 1.1: the group needs a base before publishing');
      w.eq(monitor(w).stage, 'VERIFIED', 'brake_monitor stays verified');
      apply(w, w.as('workspace_manager', (c) => sw.rollbackImage(c, 'SIM-021')));
      w.eq(answerConfigRequest(w.s, 'SIM-021').reason, 'GROUP_TARGET', 'back on 1.0; the group publication applies again once sent');
      w.as('workspace_manager', (c) => fleet.startSimulation(c, 'SIM-021'));
    },
  },
  SW08: {
    needs: ['SW07'],
    run: (w) => {
      const f = monitor(w);
      w.as('business', (c) => config.putPolicy(c, f.id, 'chassis.brake.monitor', { ...f.draft.policies['chassis.brake.monitor']!, trigger: 'brake_pressure > 85 AND vehicle_deceleration > 6' }));
      const commitId = w.as('business', (c) => config.submitFeature(c, f.id, { message: '急刹车阈值 85' })).commitId;
      const dispatch = () => {
        for (const d of w.as('brake_tester', (c) => v.dispatchFeature(c, f.id, { commitId, vehicleGroupIds: [groupId(w, '制动研发车组')] }))) answerAll(w, d);
      };
      dispatch();
      w.as('brake_tester', (c) => v.recordFeatureTest(c, f.id, { commitId, resourceId: 'SIM-021', result: 'PASS', summary: '仿真回放通过' }));
      const b = w.as('workspace_manager', (c) => sw.requestBuild(c, 'SIM-021', { module: 'perception', repository: 'https://github.com/example/perception', ref: 'release-2' }));
      w.sys((c) => sw.completeBuild(c, b, 'PASS'));
      w.as('workspace_manager', (c) => fleet.stopSimulation(c, 'SIM-021'));
      apply(w, w.as('workspace_manager', (c) => sw.deployBuild(c, 'SIM-021', b)));
      w.as('workspace_manager', (c) => fleet.startSimulation(c, 'SIM-021'));
      w.check(v.verifyBlockers(w.s, monitor(w)).includes('SIM-021 runs another image since its test; test it again'), 'the earlier PASS no longer counts');
      w.fails('SIMULATION_FIRST', () => w.as('brake_tester', (c) => v.recordFeatureTest(c, f.id, { commitId, resourceId: 'VEH-001', result: 'PASS', summary: '实车' })));
      dispatch();
      w.as('brake_tester', (c) => v.recordFeatureTest(c, f.id, { commitId, resourceId: 'SIM-021', result: 'PASS', summary: '新感知模块上仿真通过' }));
      w.as('brake_tester', (c) => v.recordFeatureTest(c, f.id, { commitId, resourceId: 'VEH-001', result: 'PASS', summary: '实车通过' }));
      w.as('brake_tester', (c) => v.verifyFeature(c, f.id));
      w.eq(monitor(w).stage, 'VERIFIED', 'verified with results on the current image');
    },
  },
  N01: {
    run: (w) => {
      w.fails('DERIVED_DEVELOPMENT_ONLY', () => w.as('integration_admin', (c) => sw.requestBuild(c, 'SIM-101', BRAKE)));
      w.denied('integration_tester', (c) => sw.switchImage(c, 'SIM-101', 'x89-1.1-sim'));
      const id = w.as('business', (c) => ps.createPersonalSim(c, { workspaceId: 'team-brake', groupId: 'brake', imageId: 'x89-1.0-sim' }));
      const b = w.as('business', (c) => sw.requestBuild(c, id, BRAKE));
      const image = w.sys((c) => sw.completeBuild(c, b, 'PASS'))!;
      w.fails('IMAGE_NOT_IN_CATALOG', () => w.as('workspace_manager', (c) => fleet.createSimulation(c, { id: 'SIM-029', workspaceId: 'team-brake', imageId: image, env: 'development', pool: 'Chassis' })));
      w.fails('IMAGE_NOT_IN_CATALOG', () => w.as('integration_admin', (c) => sw.switchImage(c, 'SIM-101', image)));
    },
  },
};
