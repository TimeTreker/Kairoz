// 同软件版本配置补丁 (PT01–PT07, N01) on the demo installation: the mainline moves on to 1.1.0 for
// software 1.1, a steering fix for software 1.0 is released as patch 1.0.1 of 1.0.0, then merged
// into the mainline; patch lines keep their own gate.

import * as config from '../src/engine/config.ts';
import { decideEmergencyStop, requestEmergencyStop } from '../src/engine/emergency.ts';
import * as fleet from '../src/engine/fleet.ts';
import * as integ from '../src/engine/integration.ts';
import * as ota from '../src/engine/ota.ts';
import * as rel from '../src/engine/release.ts';
import { demoState } from '../src/engine/seed.ts';
import type { State } from '../src/engine/types.ts';
import * as v from '../src/engine/validation.ts';
import { answerAll, verifyFeatureOn } from './helpers.ts';
import type { SceneSpec, World } from './world.ts';

export const start = (): State => demoState();

const ANGLE = 'chassis.steering.angle_jump';
const group = (w: World, name: string) => Object.values(w.s.vehicleGroups).find((g) => g.name === name)!.id;
const set = (w: World, version: string) => Object.values(w.s.releases).find((r) => r.dclVersion === version)!;
const feature = (w: World, name: string) => Object.values(w.s.features).find((f) => f.name === name)!;
const policy = (w: World, featureId: string) => w.s.features[featureId]!.draft.policies[ANGLE]!;

function preview(w: World, featureIds: string[], patchOf?: string): string {
  return w.as('integrator', (c) => integ.previewMerge(c, { workspaceId: 'x89-project', featureIds, patchOf }));
}

function freeze(w: World, plan: string, label: string): string {
  w.as('dcl', (c) => integ.confirmProcessing(c, plan, { note: '处理集合确认' }));
  return w.as('integrator', (c) => integ.freezeCandidate(c, plan, { label }));
}

/** Integration testing on the vehicles of a test group, or on vehicles outside any group; simulation first. */
function testCandidate(w: World, candidateId: string, target: { vehicleGroupIds: string[] } | { resourceIds: string[] }, vehicles: string[]): void {
  answerAll(w, w.as('integration_tester', (c) => v.dispatchCandidate(c, candidateId, target)));
  for (const r of vehicles) w.as('integration_tester', (c) => v.recordCandidateTest(c, candidateId, { resourceId: r, result: 'PASS', summary: '回归通过' }));
  w.as('integration_tester', (c) => v.verifyCandidate(c, candidateId));
}

const on10 = (w: World, candidateId: string) => testCandidate(w, candidateId, { vehicleGroupIds: [group(w, 'X89 集成测试车组')] }, ['SIM-101', 'VEH-031']);
const on11 = (w: World, candidateId: string) => testCandidate(w, candidateId, { resourceIds: ['SIM-111', 'VEH-033'] }, ['SIM-111', 'VEH-033']);

/** A steering Feature on `base` whose angle-jump policy is changed, then verified by the team. */
function steeringFix(w: World, name: string, base: string, change: (p: ReturnType<typeof policy>) => Partial<ReturnType<typeof policy>>): string {
  const id = w.as('steering', (c) => config.createFeature(c, { workspaceId: 'team-steering', groupId: 'steering', name, baseReleaseId: set(w, base).id }));
  const p = policy(w, id);
  w.as('steering', (c) => config.putPolicy(c, id, ANGLE, { ...p, ...change(p) }));
  w.as('steering', (c) => config.submitFeature(c, id, { message: name }));
  verifyFeatureOn(w, 'steering_tester', id, [group(w, '转向研发车组')]);
  return id;
}

export const scenes: Record<string, SceneSpec> = {
  PT01: {
    run: (w) => {
      w.as('integration_admin', (c) => fleet.createSimulation(c, { id: 'SIM-111', workspaceId: 'x89-integration', imageId: 'x89-1.1-sim', env: 'testing', pool: 'Vehicle', displayName: '整车 1.1 仿真' }));
      w.as('resource', (c) => fleet.registerPhysical(c, { id: 'VEH-033', vin: 'LSDEMX89000000033', vehicleModelId: 'X89', env: 'testing', pool: 'Vehicle', displayName: '整车 1.1 测试车' }));
      w.as('resource', (c) => fleet.confirmIntegration(c, 'VEH-033', { version: '1.1', source: 'DIP 上报' }));
      w.as('integration_admin', (c) => fleet.addWorkspaceVehicle(c, 'x89-integration', 'VEH-033'));
      const plan = preview(w, [feature(w, 'steering_return_rate').id]);
      w.eq([w.s.mergePlans[plan]!.targetReleaseId, w.s.mergePlans[plan]!.patch], [set(w, '1.0.0').id, null], 'an ordinary merge goes onto the mainline');
      const cand = freeze(w, plan, 'X89-C2');
      on11(w, cand);
      w.as('release', (c) => rel.promoteCandidate(c, cand, { dclVersion: '1.1.0', vehicleIntegrationVersions: ['1.1'] }));
      w.as('resource', (c) => fleet.confirmIntegration(c, 'VEH-202', { version: '1.1', source: '整车 OTA 回执 X89-1.1' }));
      w.eq(config.mainlineRelease(w.s, 'X89')?.dclVersion, '1.1.0', 'the mainline is 1.1.0');
      w.eq([rel.setInEffect(w.s, 'X89', '1.0')?.dclVersion, rel.releaseFor(w.s, w.s.resources['VEH-202']!).release?.dclVersion], ['1.0.0', '1.1.0'], 'software 1.0 keeps 1.0.0; VEH-202 on 1.1 resolves to 1.1.0');
      w.eq(rel.patchTargets(w.s, 'X89').map((r) => r.dclVersion), ['1.0.0'], '1.0.0 can be patched');
    },
  },
  PT02: {
    needs: ['PT01'],
    run: (w) => {
      const fix = steeringFix(w, 'angle_jump_fix', '1.0.0', () => ({ trigger: 'steering_angle_rate > 350 AND vehicle_speed > 20' }));
      const f = w.s.features[fix]!;
      w.eq([f.baseReleaseId, f.stage], [set(w, '1.0.0').id, 'VERIFIED'], 'the fix starts on 1.0.0 and is verified');
      w.eq(Object.keys(f.draft.policies), [ANGLE], 'without the mainline’s return-rate policy');
      w.ref.fix = fix;
    },
  },
  PT03: {
    needs: ['PT02'],
    run: (w) => {
      const fix = w.ref.fix!;
      const mainline = preview(w, [feature(w, 'brake_monitor').id]);
      w.fails('NOT_A_PATCH_TARGET', () => preview(w, [fix], set(w, '1.1.0').id));
      w.fails('PATCH_FEATURES_ONLY', () => w.as('integrator', (c) => integ.previewMerge(c, { workspaceId: 'x89-project', featureIds: [fix], subsystemReleaseIds: ['ss_any'], patchOf: set(w, '1.0.0').id })));
      const id = preview(w, [fix], set(w, '1.0.0').id);
      const plan = w.s.mergePlans[id]!;
      w.eq([plan.status, plan.patch], ['READY', { versions: ['1.0'] }], 'a ready patch of 1.0.0 for software 1.0');
      const steering = plan.merged.steering!;
      w.eq(Object.keys(steering.policies), [ANGLE], '1.1.0’s return-rate policy stays out');
      w.eq([steering.policies[ANGLE]!.trigger, steering.policies[ANGLE]!.postSeconds], ['steering_angle_rate > 350 AND vehicle_speed > 20', 10], 'the fix on top of 1.0.0');
      w.ref.patchCandidate = freeze(w, id, 'X89-P1');
      w.eq(w.s.mergePlans[mainline]!.status, 'READY', 'the mainline preview is still live');
    },
  },
  PT04: {
    needs: ['PT03'],
    run: (w) => {
      on10(w, w.ref.patchCandidate!);
      w.eq(w.s.candidates[w.ref.patchCandidate!]!.status, 'VERIFIED', 'the patch passed on software 1.0');
    },
  },
  PT05: {
    needs: ['PT04'],
    run: (w) => {
      const cand = w.ref.patchCandidate!;
      w.eq(rel.nextDclVersion(w.s, 'X89', set(w, '1.0.0').id), '1.0.1', 'the form suggests 1.0.1');
      w.fails('PATCH_VERSION_LINE', () => w.as('release', (c) => rel.promoteCandidate(c, cand, { dclVersion: '1.1.1', vehicleIntegrationVersions: ['1.0'] })));
      w.fails('PATCH_VERSION_OUTSIDE_TARGET', () => w.as('release', (c) => rel.promoteCandidate(c, cand, { dclVersion: '1.0.1', vehicleIntegrationVersions: ['1.0', '1.1'] })));
      const id = w.as('release', (c) => rel.promoteCandidate(c, cand, { dclVersion: '1.0.1', vehicleIntegrationVersions: ['1.0'], notes: '转角突变误触发修复' }));
      w.eq(w.s.releases[id]!.patchOf, set(w, '1.0.0').id, '1.0.1 is a patch of 1.0.0');
      w.eq([rel.setInEffect(w.s, 'X89', '1.0')?.dclVersion, rel.setInEffect(w.s, 'X89', '1.1')?.dclVersion, config.mainlineRelease(w.s, 'X89')?.dclVersion], ['1.0.1', '1.1.0', '1.1.0'], '1.0 takes the patch; 1.1 and the mainline stay');
      w.eq(rel.previousRelease(w.s, w.s.releases[id]!)?.dclVersion, '1.0.0', 'it compares with the set it patches');
      w.eq(rel.releaseDiff(w.s, set(w, '1.0.0').id, id).policies.map((p) => p.policyId), [ANGLE], 'only the angle-jump policy changed');
      const rollout = w.as('release', (c) => ota.createOta(c, { releaseId: id, vehicleGroupIds: [group(w, 'X89 量产车组')], firstWave: 'ALL' }));
      w.eq(w.s.deployments[rollout]!.targets.map((t) => t.resourceId), ['VEH-201'], 'only the vehicle on 1.0 is in the rollout');
      answerAll(w, rollout);
      w.eq(w.s.resources['VEH-201']!.appliedConfigId, w.s.releases[id]!.resolvedConfigId, 'VEH-201 runs 1.0.1');
    },
  },
  PT06: {
    needs: ['PT05'],
    run: (w) => {
      const fix = w.ref.fix!;
      w.eq([w.s.features[fix]!.stage, rel.patchesOf(w.s, w.s.features[fix]!).map((r) => r.dclVersion)], ['VERIFIED', ['1.0.1']], 'the fix waits for the mainline');
      w.check(!integ.verifiedSources(w.s, 'x89-project', 'Vehicle', set(w, '1.0.1').id).some((f) => f.id === fix), 'a patch of 1.0.1 does not offer it again');
      const id = preview(w, [fix]);
      const steering = w.s.mergePlans[id]!.merged.steering!;
      w.eq(Object.keys(steering.policies).sort(), [ANGLE, 'chassis.steering.return_rate'], 'the mainline keeps return_rate');
      w.eq([steering.policies[ANGLE]!.trigger, steering.policies[ANGLE]!.postSeconds], ['steering_angle_rate > 350 AND vehicle_speed > 20', 15], 'the fix lands beside the mainline’s 15 s');
      const cand = freeze(w, id, 'X89-C3');
      on11(w, cand);
      w.as('release', (c) => rel.promoteCandidate(c, cand, { dclVersion: '1.1.1', vehicleIntegrationVersions: ['1.1'] }));
      w.eq(w.s.features[fix]!.stage, 'ARCHIVED', 'in the mainline the fix is done');
      w.eq([config.mainlineRelease(w.s, 'X89')?.dclVersion, rel.setInEffect(w.s, 'X89', '1.0')?.dclVersion], ['1.1.1', '1.0.1'], 'each software keeps its line');
    },
  },
  PT07: {
    needs: ['PT06'],
    run: (w) => {
      const windowFix = steeringFix(w, 'angle_window_fix', '1.0.1', () => ({ preSeconds: 8 }));
      const cand = freeze(w, preview(w, [windowFix], set(w, '1.0.1').id), 'X89-P2');
      on10(w, cand);
      const stop = w.as('dcl', (c) => requestEmergencyStop(c, { releaseId: set(w, '1.0.1').id, policyId: ANGLE, reason: '转角突变仍误触发，占满上传带宽' }));
      const id = w.as('release', (c) => decideEmergencyStop(c, stop, { decision: 'APPROVED', note: '值班批准' }))!;
      const stopped = w.s.releases[id]!;
      w.eq([stopped.dclVersion, stopped.patchOf, stopped.vehicleIntegrationVersions], ['1.0.2', set(w, '1.0.1').id, ['1.0']], 'the stop is patch 1.0.2 of 1.0.1');
      w.eq(config.mainlineRelease(w.s, 'X89')?.dclVersion, '1.1.1', 'the mainline stays 1.1.1');
      w.fails('TARGET_CHANGED', () => w.as('release', (c) => rel.promoteCandidate(c, cand, { dclVersion: '1.0.3', vehicleIntegrationVersions: ['1.0'] })));
    },
  },
  N01: {
    needs: ['PT05'],
    forkAfter: 'PT05',
    run: (w) => {
      const fix = w.ref.fix!;
      w.denied('integration_tester', (c) => integ.previewMerge(c, { workspaceId: 'x89-project', featureIds: [fix], patchOf: set(w, '1.0.1').id }));
      w.denied('steering', (c) => integ.closeForMainline(c, fix, { reason: '主线已重写转角突变策略' }));
      w.fails('REASON_REQUIRED', () => w.as('integrator', (c) => integ.closeForMainline(c, fix, { reason: '' })));
      w.as('integrator', (c) => integ.closeForMainline(c, fix, { reason: '主线已重写转角突变策略' }));
      w.eq(w.s.features[fix]!.stage, 'ARCHIVED', 'closed for the mainline');
      w.eq(w.s.feedback.filter((f) => f.featureId === fix).map((f) => [f.kind, f.reason]), [['MAINLINE_DECLINED', '主线已重写转角突变策略']], 'the reason stays with the Feature');
      w.fails('NOT_PATCHED', () => w.as('integrator', (c) => integ.closeForMainline(c, fix, { reason: '再次' })));
    },
  },
};
