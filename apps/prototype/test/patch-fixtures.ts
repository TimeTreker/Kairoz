// Shared setup for patch tests: the mainline moves to 1.1.0 for software 1.1, and a steering fix
// started on 1.0.0 can be released as patch 1.0.1 for software 1.0.

import { answerAll, carRuns, tspCar, verifyFeatureOn } from '../acceptance/helpers.ts';
import type { World } from '../acceptance/world.ts';
import * as config from '../src/engine/config.ts';
import * as fleet from '../src/engine/fleet.ts';
import * as integ from '../src/engine/integration.ts';
import * as rel from '../src/engine/release.ts';
import * as v from '../src/engine/validation.ts';

export const ANGLE = 'chassis.steering.angle_jump';
export const groupId = (w: World, name: string) => Object.values(w.s.vehicleGroups).find((g) => g.name === name)!.id;
export const set = (w: World, version: string) => Object.values(w.s.releases).find((r) => r.dclVersion === version)!;
export const feature = (w: World, name: string) => Object.values(w.s.features).find((f) => f.name === name)!;
/** Software 1.0: the integration test group (SIM-101, VEH-031). Software 1.1: two vehicles outside any group. */
export const ON_10 = { group: 'X89 集成测试车组', vehicles: ['SIM-101', 'VEH-031'] };
export const ON_11 = { group: null, vehicles: ['SIM-111', 'VEH-033'] };

/** Testing vehicles on software 1.1 in the integration workspace. */
export function vehiclesOn11(w: World): void {
  w.as('integration_admin', (c) => fleet.createSimulation(c, { id: 'SIM-111', workspaceId: 'x89-integration', imageId: 'x89-1.1-sim', env: 'testing', pool: 'Vehicle', displayName: '整车 1.1 仿真' }));
  tspCar(w.engine, 'LSDEMX89000000033', 'X89');
  w.as('resource', (c) => fleet.registerPhysical(c, { id: 'VEH-033', vin: 'LSDEMX89000000033', vehicleModelId: 'X89', env: 'testing', pool: 'Vehicle', displayName: '整车 1.1 测试车' }));
  carRuns(w.engine, 'VEH-033', '1.1');
  w.as('integration_admin', (c) => fleet.addWorkspaceVehicle(c, 'x89-integration', 'VEH-033'));
}

export function preview(w: World, featureIds: string[], patchOf?: string): string {
  return w.as('integrator', (c) => integ.previewMerge(c, { workspaceId: 'x89-project', featureIds, patchOf }));
}

/** Reads the plan after the preview ran (the state object changes with every operation). */
export function planOf(w: World, id: string) {
  return w.s.mergePlans[id]!;
}

export function freeze(w: World, plan: string, label: string): string {
  w.as('dcl', (c) => integ.confirmProcessing(c, plan, { note: '处理集合确认' }));
  return w.as('integrator', (c) => integ.freezeCandidate(c, plan, { label }));
}

/** Integration testing passes the candidate on the vehicles (simulation first) and verifies it. */
export function testCandidate(w: World, candidateId: string, on: { group: string | null; vehicles: string[] }): void {
  const target = on.group ? { vehicleGroupIds: [groupId(w, on.group)] } : { resourceIds: on.vehicles };
  answerAll(w, w.as('integration_tester', (c) => v.dispatchCandidate(c, candidateId, target)));
  for (const r of on.vehicles) w.as('integration_tester', (c) => v.recordCandidateTest(c, candidateId, { resourceId: r, result: 'PASS', summary: '回归通过' }));
  w.as('integration_tester', (c) => v.verifyCandidate(c, candidateId));
}

export function promote(w: World, candidateId: string, dclVersion: string, versions: string[]): string {
  return w.as('release', (c) => rel.promoteCandidate(c, candidateId, { dclVersion, vehicleIntegrationVersions: versions }));
}

/** The mainline moves on: steering_return_rate becomes 1.1.0 for software 1.1; software 1.0 stays on 1.0.0. */
export function mainline110(w: World): void {
  vehiclesOn11(w);
  const cand = freeze(w, preview(w, [feature(w, 'steering_return_rate').id]), 'X89-C2');
  testCandidate(w, cand, ON_11);
  promote(w, cand, '1.1.0', ['1.1']);
}

/** A steering fix started on 1.0.0 (what software 1.0 runs), raising the angle-jump threshold, verified by the team. */
export function angleFix(w: World, name = 'angle_jump_fix', threshold = 350): string {
  const id = w.as('steering', (c) => config.createFeature(c, { workspaceId: 'team-steering', groupId: 'steering', name, baseReleaseId: set(w, '1.0.0').id }));
  const p = w.s.features[id]!.draft.policies[ANGLE]!;
  w.as('steering', (c) => config.putPolicy(c, id, ANGLE, { ...p, trigger: `steering_angle_rate > ${threshold} AND vehicle_speed > 20` }));
  w.as('steering', (c) => config.submitFeature(c, id, { message: '转角突变误触发，提高阈值' }));
  verifyFeatureOn(w, 'steering_tester', id, [groupId(w, '转向研发车组')]);
  return id;
}

/** The fix released as patch 1.0.1 of 1.0.0 for software 1.0. */
export function patch101(w: World, fixId: string): string {
  const cand = freeze(w, preview(w, [fixId], set(w, '1.0.0').id), 'X89-P1');
  testCandidate(w, cand, ON_10);
  return promote(w, cand, '1.0.1', ['1.0']);
}
