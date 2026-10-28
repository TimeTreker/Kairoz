// DCL 策略集与整车软件版本 (P01–P09, N01) on the demo installation: applicability of unchanged sets
// to new software, development groups that follow each vehicle's software, switches, and the
// emergency stop of one policy.

import * as ap from '../src/engine/applicability.ts';
import { decideEmergencyStop, requestEmergencyStop } from '../src/engine/emergency.ts';
import { capturablePolicies, captureEvent } from '../src/engine/events.ts';
import * as fleet from '../src/engine/fleet.ts';
import * as integ from '../src/engine/integration.ts';
import * as ota from '../src/engine/ota.ts';
import * as rel from '../src/engine/release.ts';
import { demoState } from '../src/engine/seed.ts';
import type { State } from '../src/engine/types.ts';
import * as v from '../src/engine/validation.ts';
import { answerAll, carRuns, plmPublish, simpleFeature, tspCar } from './helpers.ts';
import type { SceneSpec, World } from './world.ts';

export const start = (): State => demoState();

const group = (w: World, name: string) => Object.values(w.s.vehicleGroups).find((g) => g.name === name)!.id;
const set = (w: World, version: string) => Object.values(w.s.releases).find((r) => r.dclVersion === version)!;
const feature = (w: World, name: string) => Object.values(w.s.features).find((f) => f.name === name)!;
const checkFor = (w: World, version: string) => Object.values(w.s.applicabilityChecks).find((c) => c.version === version)!;
const configOf = (w: World, deploymentId: string) => w.s.resolvedConfigs[w.s.deployments[deploymentId]!.resolvedConfigId]!;

function dispatchBrake(w: World, disabledPolicies?: string[]): string[] {
  const brake = feature(w, 'brake_monitor');
  const ds = w.as('brake_tester', (c) => v.dispatchFeature(c, brake.id, { commitId: brake.headCommitId!, vehicleGroupIds: [group(w, '制动研发车组')], disabledPolicies }));
  for (const d of ds) answerAll(w, d);
  return ds;
}

export const scenes: Record<string, SceneSpec> = {
  P01: {
    run: (w) => {
      const manifest = w.s.softwareVersions['X89::1.0']!.manifest!;
      plmPublish(w.engine, 'X89', '1.2', { manifest });
      const check = checkFor(w, '1.2');
      w.eq([check.status, check.auto, w.s.releases[check.releaseId]!.dclVersion], ['OPEN', true, '1.0.0'], 'recording 1.2 opened a check for the newest set');
      carRuns(w.engine, 'VEH-202', '1.2');
      w.eq(ap.blockedProductionVehicles(w.s, 'X89').map((r) => r.id), ['VEH-202'], 'VEH-202 runs software no set applies to');
      w.check(ap.compatibilityOf(w.s, check.releaseId, '1.2').every((c) => c.status === 'OK'), 'every policy of 1.0.0 fits 1.2');
      w.ref.check12 = check.id;
    },
  },
  P02: {
    needs: ['P01'],
    run: (w) => {
      w.as('dcl', (c) => fleet.registerImage(c, { id: 'x89-1.2-sim', vehicleModelId: 'X89', integrationVersion: '1.2', build: 'x89-1.2.0', digest: 'sha256:mock-x89-1-2', simulator: 'SimOne 3' }));
      w.as('integration_admin', (c) => fleet.createSimulation(c, { id: 'SIM-112', workspaceId: 'x89-integration', imageId: 'x89-1.2-sim', env: 'testing', pool: 'Vehicle', displayName: '整车 1.2 仿真' }));
      tspCar(w.engine, 'LSDEMX89000000032', 'X89');
      w.as('resource', (c) => fleet.registerPhysical(c, { id: 'VEH-032', vin: 'LSDEMX89000000032', vehicleModelId: 'X89', env: 'testing', pool: 'Vehicle', displayName: '整车集成测试车 2' }));
      carRuns(w.engine, 'VEH-032', '1.2');
      w.as('integration_admin', (c) => fleet.addWorkspaceVehicle(c, 'x89-integration', 'VEH-032'));
      const check = w.ref.check12!;
      const wrong = w.fails('DISPATCH_BLOCKED', () => w.as('integration_tester', (c) => ap.dispatchApplicability(c, check, { vehicleGroupIds: [group(w, 'X89 集成测试车组')] })));
      w.check((wrong.details as { issues: string[] }).issues.includes('SIM-101: runs software 1.0; the check is for 1.2'), 'vehicles on other software cannot test it');
      answerAll(w, w.as('integration_tester', (c) => ap.dispatchApplicability(c, check, { resourceIds: ['SIM-112', 'VEH-032'] })));
      w.fails('SIMULATION_FIRST', () => w.as('integration_tester', (c) => ap.recordApplicabilityTest(c, check, { resourceId: 'VEH-032', result: 'PASS', summary: '实车' })));
      for (const r of ['SIM-112', 'VEH-032']) w.as('integration_tester', (c) => ap.recordApplicabilityTest(c, check, { resourceId: r, result: 'PASS', summary: '1.2 采集回归通过' }));
      w.as('integration_tester', (c) => ap.verifyApplicability(c, check));
      w.eq(w.s.applicabilityChecks[check]!.status, 'VERIFIED', 'integration testing verified the set on 1.2');
    },
  },
  P03: {
    needs: ['P02'],
    run: (w) => {
      w.denied('integration_tester', (c) => ap.confirmApplicability(c, w.ref.check12!, { note: '越权' }));
      w.as('release', (c) => ap.confirmApplicability(c, w.ref.check12!, { note: '1.2 仿真与实车采集回归通过' }));
      const s100 = set(w, '1.0.0');
      w.eq([s100.dclVersion, s100.vehicleIntegrationVersions, rel.applicableVersions(w.s, s100)], ['1.0.0', ['1.0'], ['1.0', '1.2']], 'the set keeps its version and publish list; 1.2 is appended');
      w.eq(rel.releaseFor(w.s, w.s.resources['VEH-202']!).release?.id, s100.id, 'VEH-202 resolves to 1.0.0');
      w.eq(ap.blockedProductionVehicles(w.s, 'X89'), [], 'nothing is blocked any more');
      w.fails('NOTHING_TO_ROLL_OUT', () => w.as('release', (c) => ota.createOta(c, { releaseId: s100.id, vehicleGroupIds: [group(w, 'X89 量产车组')], firstWave: 'ALL' })));
    },
  },
  P04: {
    needs: ['P03'],
    run: (w) => {
      const base = w.s.softwareVersions['X89::1.0']!.manifest!;
      const manifest = { ...base, signals: base.signals.map((x) => (x === 'steering_angle_rate' ? 'steering_wheel_rate' : x)) };
      plmPublish(w.engine, 'X89', '1.3', { manifest });
      const check = checkFor(w, '1.3');
      const angle = ap.compatibilityOf(w.s, check.releaseId, '1.3').find((c) => c.policyId === 'chassis.steering.angle_jump')!;
      w.eq([angle.status, angle.missingSignals], ['MISSING', ['steering_angle_rate']], 'the policy needs a signal 1.3 renamed');
      w.check(ap.confirmBlockers(w.s, check).includes('chassis.steering.angle_jump: missing steering_angle_rate'), 'confirmation names the policy');
      w.fails('CHECK_NOT_VERIFIED', () => w.as('release', (c) => ap.confirmApplicability(c, check.id, { note: '例外' })));
    },
  },
  P05: {
    needs: ['P04'],
    run: (w) => {
      // A steering Feature started on 1.0.0, before the next set changes the steering group.
      w.ref.lane = simpleFeature(w, 'steering', {
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
      }).featureId;
      const steering = feature(w, 'steering_return_rate');
      const plan = w.as('integrator', (c) => integ.previewMerge(c, { workspaceId: 'x89-project', featureIds: [steering.id] }));
      w.as('dcl', (c) => integ.confirmProcessing(c, plan, { note: '回正策略的处理集合' }));
      const cand = w.as('integrator', (c) => integ.freezeCandidate(c, plan, { label: 'X89-C2' }));
      answerAll(w, w.as('integration_tester', (c) => v.dispatchCandidate(c, cand, { vehicleGroupIds: [group(w, 'X89 集成测试车组')] })));
      for (const r of ['SIM-101', 'VEH-031']) w.as('integration_tester', (c) => v.recordCandidateTest(c, cand, { resourceId: r, result: 'PASS', summary: '整车回归通过' }));
      w.as('integration_tester', (c) => v.verifyCandidate(c, cand));
      w.as('release', (c) => rel.promoteCandidate(c, cand, { dclVersion: '1.0.1', vehicleIntegrationVersions: ['1.0'] }));
      const diff = rel.releaseDiff(w.s, set(w, '1.0.0').id, set(w, '1.0.1').id);
      w.eq(diff.policies.map((p) => [p.policyId, p.from, p.to]), [['chassis.steering.angle_jump', 1, 2], ['chassis.steering.return_rate', null, 1]], 'the comparison goes policy by policy');
      w.eq([rel.setInEffect(w.s, 'X89', '1.0')?.dclVersion, rel.setInEffect(w.s, 'X89', '1.2')?.dclVersion], ['1.0.1', '1.0.0'], 'software 1.0 moves to 1.0.1; 1.2 stays on 1.0.0');
    },
  },
  P06: {
    needs: ['P05'],
    run: (w) => {
      w.eq(ota.answerConfigRequest(w.s, 'SIM-021').reason, 'REPUBLISH', 'SIM-021’s set changed: publish again');
      carRuns(w.engine, 'VEH-001', '1.2');
      const veh = ota.answerConfigRequest(w.s, 'VEH-001');
      w.eq([veh.reason, veh.configId === w.s.resources['VEH-001']!.appliedConfigId], ['GROUP_TARGET', true], 'on 1.2 VEH-001 keeps base 1.0.0, as applied');
      const ds = dispatchBrake(w);
      const byVehicle = Object.fromEntries(ds.map((d) => [w.s.deployments[d]!.targets[0]!.resourceId, configOf(w, d)]));
      w.eq(ds.length, 2, 'two bases, two dispatches');
      w.eq([byVehicle['SIM-021']!.baseReleaseId, byVehicle['VEH-001']!.baseReleaseId], [set(w, '1.0.1').id, set(w, '1.0.0').id], 'each vehicle runs its own base');
    },
  },
  P07: {
    needs: ['P06'],
    run: (w) => {
      w.fails('POLICY_NOT_SWITCHABLE', () => dispatchBrake(w, ['chassis.brake.monitor']));
      dispatchBrake(w, ['chassis.steering.angle_jump']);
      w.eq(capturablePolicies(w.s, 'SIM-021').map((p) => p.policyId).sort(), ['chassis.brake.failure_diag', 'chassis.brake.monitor', 'chassis.steering.return_rate'], 'the switched-off policy does not run');
      w.fails('POLICY_NOT_ON_VEHICLE', () => w.sys((c) => captureEvent(c, { resourceId: 'SIM-021', policyId: 'chassis.steering.angle_jump' })));
      w.eq(w.s.vehicleGroups[group(w, '制动研发车组')]!.publication, { kind: 'FEATURE', featureId: feature(w, 'brake_monitor').id, commitId: feature(w, 'brake_monitor').headCommitId!, disabledPolicies: ['chassis.steering.angle_jump'] }, 'the switch is recorded with the publication');
    },
  },
  P08: {
    needs: ['P07'],
    run: (w) => {
      const lane = w.ref.lane!;
      const vg = group(w, '转向研发车组');
      const head = w.s.features[lane]!.headCommitId!;
      const err = w.fails('DISPATCH_BLOCKED', () => w.as('steering_tester', (c) => v.dispatchFeature(c, lane, { commitId: head, vehicleGroupIds: [vg] })));
      w.check((err.details as { issues: string[] }).issues.some((i) => i.includes('policy set 1.0.1 changed chassis.steering after the Feature started')), 'the new base changed the Feature’s own group');
      carRuns(w.engine, 'VEH-003', '1.3');
      w.eq(ota.answerConfigRequest(w.s, 'VEH-003').reason, 'NO_BASE', 'no set applies to 1.3 and the group names no base');
      w.denied('steering_tester', (c) => fleet.setGroupBase(c, vg, set(w, '1.0.0').id));
      w.as('workspace_manager', (c) => fleet.setGroupBase(c, vg, set(w, '1.0.0').id));
      const ds = w.as('steering_tester', (c) => v.dispatchFeature(c, lane, { commitId: head, vehicleGroupIds: [vg] }));
      for (const d of ds) answerAll(w, d);
      w.eq(ds.map((d) => configOf(w, d).baseReleaseId), [set(w, '1.0.0').id], 'both vehicles build on the explicit base');
    },
  },
  P09: {
    needs: ['P08'],
    run: (w) => {
      const source = set(w, '1.0.1');
      const stop = w.as('dcl', (c) => requestEmergencyStop(c, { releaseId: source.id, policyId: 'chassis.steering.return_rate', reason: '回正策略误触发，占满上传带宽' }));
      w.denied('dcl', (c) => decideEmergencyStop(c, stop, { decision: 'APPROVED', note: '自批' }));
      const id = w.as('release', (c) => decideEmergencyStop(c, stop, { decision: 'APPROVED', note: '值班批准' }))!;
      const next = w.s.releases[id]!;
      w.eq([next.dclVersion, next.vehicleIntegrationVersions, next.emergency?.policyId], ['1.0.2', ['1.0'], 'chassis.steering.return_rate'], 'the emergency set serves exactly where 1.0.1 was in effect');
      const rollout = w.as('release', (c) => ota.createOta(c, { releaseId: id, vehicleGroupIds: [group(w, 'X89 量产车组')], firstWave: 'ALL' }));
      w.eq(w.s.deployments[rollout]!.targets.map((t) => t.resourceId), ['VEH-201'], 'VEH-202 on 1.2 is not in this rollout');
      answerAll(w, rollout);
      w.eq(w.s.resources['VEH-201']!.appliedConfigId, next.resolvedConfigId, 'VEH-201 runs 1.0.2');
      w.eq(capturablePolicies(w.s, 'VEH-201').map((p) => p.policyId), ['chassis.steering.angle_jump'], 'the stopped policy is gone from the vehicle');
      w.eq(w.s.resources['VEH-202']!.appliedConfigId, set(w, '1.0.0').resolvedConfigId, 'VEH-202 keeps 1.0.0');
    },
  },
  N01: {
    needs: ['P09'],
    run: (w) => {
      w.as('release', (c) => ap.withdrawApplicability(c, { releaseId: set(w, '1.0.0').id, version: '1.2', reason: '1.2 现场问题，暂停采集' }));
      w.eq(ap.blockedProductionVehicles(w.s, 'X89').map((r) => r.id), ['VEH-202'], 'no other set applies to 1.2: VEH-202 is blocked');
      w.eq(w.s.applicability.map((a) => [a.action, a.version]), [['ADD', '1.2'], ['WITHDRAW', '1.2']], 'the history keeps both records');
    },
  },
};
