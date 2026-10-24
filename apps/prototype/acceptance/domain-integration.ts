// 子系统集成 · ADC/CDC 联合演练 (S01–S08, N01–N04) on the demo installation: domain teams develop
// and test, each domain integrates and publishes a subsystem release, and the whole vehicle
// merges the subsystem releases with chassis changes, tests, releases and rolls out.

import * as config from '../src/engine/config.ts';
import * as fleet from '../src/engine/fleet.ts';
import * as integ from '../src/engine/integration.ts';
import * as ota from '../src/engine/ota.ts';
import * as rel from '../src/engine/release.ts';
import { demoState } from '../src/engine/seed.ts';
import { sendReceipt } from '../src/engine/simulator.ts';
import type { State } from '../src/engine/types.ts';
import * as v from '../src/engine/validation.ts';
import { answerAll, recordPasses, simpleFeature, verifyFeatureOn } from './helpers.ts';
import type { SceneSpec, World } from './world.ts';

export const start = (): State => demoState();

const groupId = (w: World, name: string) => Object.values(w.s.vehicleGroups).find((g) => g.name === name)!.id;

const TEAMS = {
  'adc-parking': { dev: 'adc_parking', tester: 'adc_parking_tester', code: 'adc.parking', unit: 'ADC', vg: '泊车研发车组' },
  'adc-system': { dev: 'adc_system', tester: 'adc_system_tester', code: 'adc.system', unit: 'ADC', vg: '系统应用研发车组' },
  'cdc-hmi': { dev: 'cdc_hmi', tester: 'cdc_hmi_tester', code: 'cdc.hmi', unit: 'CDC', vg: 'HMI 研发车组' },
  'cdc-app': { dev: 'cdc_app', tester: 'cdc_app_tester', code: 'cdc.app', unit: 'CDC', vg: '座舱应用研发车组' },
} as const;

function teamFeature(w: World, team: keyof typeof TEAMS, name: string, policy: string, trigger = 'vehicle_speed > 10'): string {
  const t = TEAMS[team];
  return simpleFeature(w, t.dev, {
    workspaceId: `team-${team}`,
    groupId: team,
    name,
    unit: t.unit,
    directory: `/data/${team}`,
    pattern: `${name}.log`,
    fileName: `${name} 日志`,
    policyId: `${t.code}.${policy}`,
    policyName: name,
    trigger,
  }).featureId;
}

/** The domain integrator tests a frozen subsystem candidate in its domain workspace (simulation first). */
function testCandidate(w: World, tester: string, cand: string, vehicleGroup: string): void {
  const d = w.as(tester, (c) => v.dispatchCandidate(c, cand, { vehicleGroupIds: [vehicleGroup] }));
  answerAll(w, d);
  const vehicles = w.s.deployments[d]!.targets.map((t) => t.resourceId).sort((a, b) => Number(w.s.resources[b]!.type === 'SIMULATION') - Number(w.s.resources[a]!.type === 'SIMULATION'));
  for (const r of vehicles) w.as(tester, (c) => v.recordCandidateTest(c, cand, { resourceId: r, result: 'PASS', summary: '子系统集成回归' }));
  w.as(tester, (c) => v.verifyCandidate(c, cand));
}

export const scenes: Record<string, SceneSpec> = {
  S01: {
    run: (w) => {
      const f = teamFeature(w, 'adc-parking', 'parking_slot_log', 'slot_miss', 'apa.active AND slot_confidence < 0.3');
      w.eq(w.s.features[f]!.stage, 'DCL_READY', 'a fixed commit, DCL Ready');
      w.ref.parking = f;
    },
  },
  S02: {
    needs: ['S01'],
    run: (w) => {
      w.ref.system = teamFeature(w, 'adc-system', 'adc_health_log', 'node_fault', 'adc.node_fault_count > 0');
      w.denied('adc_system', (c) => config.putPolicy(c, w.ref.parking!, 'adc.parking.slot_miss', { name: 'x', trigger: 'vehicle_speed > 1', captures: [], preSeconds: 1, postSeconds: 1 }));
      w.ref.hmi = teamFeature(w, 'cdc-hmi', 'hmi_freeze_log', 'ui_freeze', 'hmi.frame_gap_ms > 500');
      w.ref.app = teamFeature(w, 'cdc-app', 'cabin_app_log', 'app_crash', 'cabin.app_crash_count > 0');
      for (const id of [w.ref.system, w.ref.hmi, w.ref.app]) w.eq(w.s.features[id!]!.stage, 'DCL_READY', 'each group has a fixed commit');
    },
  },
  S03: {
    needs: ['S01'],
    run: (w) => {
      const vg = groupId(w, '泊车研发车组');
      w.as('adc_integrator', (c) => fleet.setGroupApproval(c, vg, true));
      const f = w.ref.parking!;
      const head = w.s.features[f]!.headCommitId!;
      w.fails('APPROVAL_REQUIRED', () => w.as('adc_parking_tester', (c) => v.dispatchFeature(c, f, { commitId: head, vehicleGroupIds: [vg] })));
      const req = w.as('adc_parking_tester', (c) => v.requestTeamTest(c, f, { commitId: head, vehicleGroupIds: [vg], goal: '泊车车位丢失场景验证' }));
      w.as('adc_integrator', (c) => v.decideTestRequest(c, req, { decision: 'APPROVED', note: '同意团队测试' }));
      // SIM-041 runs software 1.0 and VEH-002's is unknown: two bases, so two dispatches.
      const ds = w.as('adc_parking_tester', (c) => v.executeTestRequest(c, req));
      w.fails('REQUEST_USED', () => w.as('adc_parking_tester', (c) => v.executeTestRequest(c, req)));
      for (const d of ds) answerAll(w, d);
      w.ref.parkingDispatch = ds[0]!;
    },
  },
  S04: {
    needs: ['S02', 'S03'],
    run: (w) => {
      const vg = groupId(w, '泊车研发车组');
      recordPasses(w, 'adc_parking_tester', w.ref.parking!, fleet.membersOf(w.s, vg).sort((a) => (w.s.resources[a]!.type === 'SIMULATION' ? -1 : 1)));
      w.as('adc_parking_tester', (c) => v.verifyFeature(c, w.ref.parking!));
      verifyFeatureOn(w, 'adc_system_tester', w.ref.system!, [groupId(w, '系统应用研发车组')]);
      verifyFeatureOn(w, 'cdc_hmi_tester', w.ref.hmi!, [groupId(w, 'HMI 研发车组')]);
      verifyFeatureOn(w, 'cdc_app_tester', w.ref.app!, [groupId(w, '座舱应用研发车组')]);
      for (const id of [w.ref.parking, w.ref.system, w.ref.hmi, w.ref.app]) w.eq(w.s.features[id!]!.stage, 'VERIFIED', 'Verified');
    },
  },
  S05: {
    needs: ['S04'],
    run: (w) => {
      const adcSources = integ.verifiedSources(w.s, 'x89-adc-integration').map((f) => f.id).sort();
      w.eq(adcSources, [w.ref.parking!, w.ref.system!].sort(), 'ADC collects only ADC Features');
      w.eq(integ.verifiedSources(w.s, 'x89-cdc-integration').map((f) => f.id).sort(), [w.ref.hmi!, w.ref.app!].sort(), 'CDC collects only CDC Features');
      const plan = w.as('adc_integrator', (c) => integ.previewMerge(c, { workspaceId: 'x89-adc-integration', featureIds: [w.ref.parking!, w.ref.system!] }));
      w.eq([w.s.mergePlans[plan]!.status, w.s.mergePlans[plan]!.scope], ['READY', 'ADC'], 'an ADC subsystem preview');
      const cdc = w.as('cdc_integrator', (c) => integ.previewMerge(c, { workspaceId: 'x89-cdc-integration', featureIds: [w.ref.hmi!, w.ref.app!] }));
      w.eq(w.s.mergePlans[cdc]!.status, 'READY', 'a CDC subsystem preview');
      w.ref.cdcPlan = cdc;
    },
  },
  S06: {
    needs: ['S05'],
    run: (w) => {
      // Two parking branches change the same policy's trigger differently.
      // Both branches collect the same file (the same source keeps its data_key) with the same policy.
      const branch = (name: string, trigger: string) =>
        simpleFeature(w, 'adc_parking', {
          workspaceId: 'team-adc-parking',
          groupId: 'adc-parking',
          name,
          unit: 'ADC',
          directory: '/data/adc-parking',
          pattern: 'scrape_alert.log',
          fileName: '擦碰预警日志',
          policyId: 'adc.parking.scrape_alert',
          policyName: '擦碰预警',
          trigger,
        }).featureId;
      const a = branch('parking_branch_a', 'min_obstacle_distance < 0.20');
      const b = branch('parking_branch_b', 'min_obstacle_distance < 0.30');
      const vg = groupId(w, '泊车研发车组');
      w.as('adc_integrator', (c) => fleet.setGroupApproval(c, vg, false));
      for (const f of [a, b]) verifyFeatureOn(w, 'adc_parking_tester', f, [vg]);
      const all = [w.ref.parking!, w.ref.system!, a, b];
      const conflicted = w.as('adc_integrator', (c) => integ.previewMerge(c, { workspaceId: 'x89-adc-integration', featureIds: all }));
      w.eq(w.s.mergePlans[conflicted]!.status, 'CONFLICT', 'the same field changed differently is a conflict');
      // Both branches add the policy, so it conflicts as a whole item; the owning group fixes it.
      w.eq(w.s.mergePlans[conflicted]!.conflicts.map((c) => [c.key, c.field, c.owner]), [['adc.parking.scrape_alert', '*', 'BUSINESS']], 'one conflict on the policy, fixed by the owning group');
      w.fails('PLAN_NOT_READY', () => w.as('adc_integrator', (c) => integ.freezeCandidate(c, conflicted, { label: 'X89-ADC-C1' })));
      w.denied('adc_integrator', (c) => config.putPolicy(c, b, 'adc.parking.scrape_alert', { ...config.getFeature(w.s, b).draft.policies['adc.parking.scrape_alert']!, trigger: 'min_obstacle_distance < 0.20' }));
      // The owner aligns branch b with branch a, submits, and it is verified again.
      const spec = config.getFeature(w.s, b).draft.policies['adc.parking.scrape_alert']!;
      w.as('adc_parking', (c) => config.putPolicy(c, b, 'adc.parking.scrape_alert', { ...spec, trigger: 'min_obstacle_distance < 0.20' }));
      w.as('adc_parking', (c) => config.submitFeature(c, b, { message: '与分支 A 统一触发条件' }));
      verifyFeatureOn(w, 'adc_parking_tester', b, [vg]);
      const plan = w.as('adc_integrator', (c) => integ.previewMerge(c, { workspaceId: 'x89-adc-integration', featureIds: all }));
      w.eq(w.s.mergePlans[plan]!.status, 'READY', 'the fixed branches merge');
      w.ref.adcPlan = plan;
    },
  },
  S07: {
    needs: ['S06'],
    run: (w) => {
      const releasesBefore = Object.keys(w.s.releases).length;
      for (const [domain, plan] of [
        ['ADC', w.ref.adcPlan!],
        ['CDC', w.ref.cdcPlan!],
      ] as const) {
        const integrator = `${domain.toLowerCase()}_integrator`;
        w.as('dcl', (c) => integ.confirmProcessing(c, plan, { note: `${domain} 子系统处理集合确认` }));
        const cand = w.as(integrator, (c) => integ.freezeCandidate(c, plan, { label: `X89-${domain}-C1` }));
        w.eq(w.s.candidates[cand]!.testWorkspaceId, `x89-${domain.toLowerCase()}-integration`, 'tested in its domain workspace');
        testCandidate(w, integrator, cand, groupId(w, `${domain} 域集成测试车组`));
        const ss = w.as(integrator, (c) => integ.publishSubsystem(c, cand, { notes: `${domain} 子系统首版` }));
        w.eq(w.s.subsystemReleases[ss]!.label, `${domain}-S1`, 'a subsystem release');
        w.ref[`${domain.toLowerCase()}Subsystem`] = ss;
      }
      w.eq(Object.keys(w.s.releases).length, releasesBefore, 'no DCL release was made');
    },
  },
  S08: {
    needs: ['S07'],
    run: (w) => {
      w.eq(integ.collectibleSubsystems(w.s, 'x89-project').map((r) => r.label), ['ADC-S1', 'CDC-S1'], 'the whole vehicle collects both subsystem releases');
      // A chassis change alongside them.
      const steering = Object.values(w.s.features).find((f) => f.name === 'steering_return_rate')!.id;
      const plan = w.as('integrator', (c) => integ.previewMerge(c, { workspaceId: 'x89-project', featureIds: [steering], subsystemReleaseIds: [w.ref.adcSubsystem!, w.ref.cdcSubsystem!] }));
      w.eq(w.s.mergePlans[plan]!.status, 'READY', 'the whole-vehicle merge is ready');
      w.as('dcl', (c) => integ.confirmProcessing(c, plan, { note: '整车处理集合确认' }));
      const cand = w.as('integrator', (c) => integ.freezeCandidate(c, plan, { label: 'X89-C2' }));
      testCandidate(w, 'integration_tester', cand, groupId(w, 'X89 集成测试车组'));
      const release = w.as('release', (c) => rel.promoteCandidate(c, cand, { dclVersion: '1.1.0', vehicleIntegrationVersions: ['1.0'], notes: 'ADC/CDC 子系统与转向变更' }));
      w.eq([w.ref.adcSubsystem, w.ref.cdcSubsystem].map((id) => w.s.subsystemReleases[id!]!.status), ['INTEGRATED', 'INTEGRATED'], 'both subsystem releases are now in a formal release');
      w.check([w.ref.parking, w.ref.system, w.ref.hmi, w.ref.app].every((id) => w.s.features[id!]!.stage === 'ARCHIVED'), 'their Features are archived');
      const rollout = w.as('release', (c) => ota.createOta(c, { releaseId: release, vehicleGroupIds: [groupId(w, 'X89 量产车组')], firstWave: ['VEH-201'] }));
      for (const t of w.s.deployments[rollout]!.targets) if (t.status === 'PENDING') w.sys((c) => sendReceipt(c, rollout, t.resourceId, 'APPLIED'));
      w.eq(w.s.resources['VEH-201']!.appliedConfigId, w.s.releases[release]!.resolvedConfigId, 'the first wave runs DCL 1.1.0');
      w.ref.release = release;
      w.ref.candidate = cand;
    },
  },
  N01: {
    run: (w) => {
      const hmi = teamFeature(w, 'cdc-hmi', 'hmi_cross_log', 'cross', 'hmi.frame_gap_ms > 800');
      verifyFeatureOn(w, 'cdc_hmi_tester', hmi, [groupId(w, 'HMI 研发车组')]);
      w.check(!integ.verifiedSources(w.s, 'x89-adc-integration').some((f) => f.id === hmi), 'a CDC Feature is not an ADC source');
      w.fails('SOURCE_NOT_ALLOWED', () => w.as('adc_integrator', (c) => integ.previewMerge(c, { workspaceId: 'x89-adc-integration', featureIds: [hmi] })));
    },
  },
  N02: {
    needs: ['S08'],
    run: (w) => {
      w.denied('adc_integrator', (c) => rel.promoteCandidate(c, w.ref.candidate!, { dclVersion: '1.2.0', vehicleIntegrationVersions: ['1.0'] }));
      w.denied('adc_integrator', (c) => ota.createOta(c, { releaseId: w.ref.release!, vehicleGroupIds: [groupId(w, 'X89 量产车组')], firstWave: 'ALL' }));
      w.fails('NOT_A_SUBSYSTEM_CANDIDATE', () => w.as('adc_integrator', (c) => integ.publishSubsystem(c, w.ref.candidate!)));
    },
  },
  N03: {
    needs: ['S07'],
    forkAfter: 'S07',
    run: (w) => {
      // Right after the subsystem releases were published, before the whole vehicle released them.
      const latest = rel.releasesOf(w.s, 'X89')[0]!;
      w.eq(latest.dclVersion, '1.0.0', 'the newest formal release is unchanged');
      w.eq(rel.nextDclVersion(w.s, 'X89'), '1.0.1', 'the next DCL version suggestion is unchanged');
      w.eq(rel.releaseFor(w.s, w.s.resources['VEH-201']!).release?.id, latest.id, 'production still resolves to DCL 1.0.0');
      const f = w.as('adc_parking', (c) => config.createFeature(c, { workspaceId: 'team-adc-parking', groupId: 'adc-parking', name: 'parking_next' }));
      w.eq(w.s.features[f]!.baseReleaseId, latest.id, 'new work still builds on the formal release');
      const cand = w.s.subsystemReleases[w.ref.adcSubsystem!]!.candidateId;
      w.fails('SUBSYSTEM_CANDIDATE', () => w.as('release', (c) => rel.promoteCandidate(c, cand, { dclVersion: '1.1.0', vehicleIntegrationVersions: ['1.0'] })));
    },
  },
  N04: {
    needs: ['S07'],
    forkAfter: 'S07',
    run: (w) => {
      const s1 = w.ref.adcSubsystem!;
      const f = teamFeature(w, 'adc-system', 'adc_trace_log', 'trace', 'adc.cpu_load > 90');
      verifyFeatureOn(w, 'adc_system_tester', f, [groupId(w, '系统应用研发车组')]);
      const plan = w.as('adc_integrator', (c) => integ.previewMerge(c, { workspaceId: 'x89-adc-integration', featureIds: [f] }));
      w.eq(w.s.mergePlans[plan]!.subsystems.map((x) => x.subsystemReleaseId), [s1], 'the domain merge builds on ADC-S1 by itself');
      w.as('dcl', (c) => integ.confirmProcessing(c, plan, { note: 'ADC 第二版' }));
      const cand = w.as('adc_integrator', (c) => integ.freezeCandidate(c, plan, { label: 'X89-ADC-C2' }));
      testCandidate(w, 'adc_integrator', cand, groupId(w, 'ADC 域集成测试车组'));
      const s2 = w.as('adc_integrator', (c) => integ.publishSubsystem(c, cand, { notes: 'ADC 第二版' }));
      const r2 = w.s.subsystemReleases[s2]!;
      w.eq([r2.label, w.s.subsystemReleases[s1]!.status], ['ADC-S2', 'SUPERSEDED'], 'S2 replaces S1');
      w.check(w.s.subsystemReleases[s1]!.features.every((x) => r2.features.some((y) => y.featureId === x.featureId)), 'S2 contains every Feature of S1');
    },
  },
};
