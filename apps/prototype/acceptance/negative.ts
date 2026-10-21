// Negative acceptance cases T-N01–T-N24: what each role must not be able to do. Each case runs
// on its own copy of the demo installation (T-N24 on a clean one).

import * as config from '../src/engine/config.ts';
import * as ev from '../src/engine/events.ts';
import * as fleet from '../src/engine/fleet.ts';
import { replaceGrants } from '../src/engine/identity.ts';
import { reviewFile } from '../src/engine/intake.ts';
import * as integ from '../src/engine/integration.ts';
import * as ota from '../src/engine/ota.ts';
import { createPipeline, createTemplate, currentTemplate } from '../src/engine/processing.ts';
import { decideReference } from '../src/engine/references.ts';
import * as rel from '../src/engine/release.ts';
import { cleanState, demoState } from '../src/engine/seed.ts';
import { sendReceipt } from '../src/engine/simulator.ts';
import { commitSnapshot } from '../src/engine/snapshots.ts';
import type { State } from '../src/engine/types.ts';
import * as v from '../src/engine/validation.ts';
import { answerAll, CONTROLS } from './helpers.ts';
import { sha, World } from './world.ts';
import type { SceneSpec } from './world.ts';

let demo: State | undefined;
export const start = (): State => (demo ??= demoState());

const feature = (w: World, name: string) => Object.values(w.s.features).find((f) => f.name === name)!;
const group = (w: World, name: string) => Object.values(w.s.vehicleGroups).find((g) => g.name === name)!.id;

/** DCL 1.0.1 from the demo's verified steering change, rolled out to `wave` first. */
function nextRelease(w: World, wave?: string[]): { release: string; ota: string } {
  const steering = feature(w, 'steering_return_rate');
  const plan = w.as('integrator', (c) => integ.previewMerge(c, { workspaceId: 'x89-project', featureIds: [steering.id] }));
  w.as('dcl', (c) => integ.confirmProcessing(c, plan, { note: '' }));
  const cand = w.as('integrator', (c) => integ.freezeCandidate(c, plan, { label: 'X89-C2' }));
  const d = w.as('integration_tester', (c) => v.dispatchCandidate(c, cand, { vehicleGroupIds: [group(w, 'X89 集成测试车组')] }));
  answerAll(w, d);
  for (const r of ['SIM-101', 'VEH-031']) w.as('integration_tester', (c) => v.recordCandidateTest(c, cand, { resourceId: r, result: 'PASS', summary: 'ok' }));
  w.as('integration_tester', (c) => v.verifyCandidate(c, cand));
  const release = w.as('release', (c) => rel.promoteCandidate(c, cand, { dclVersion: '1.0.1', vehicleIntegrationVersions: ['1.0'] }));
  if (wave) return { release, ota: '' };
  const id = w.as('release', (c) => ota.createOta(c, { releaseId: release, vehicleGroupIds: [group(w, 'X89 量产车组')], firstWave: ['VEH-201'] }));
  return { release, ota: id };
}

export const cases: Record<string, SceneSpec> = {
  'T-N01': {
    run: (w) => {
      w.denied('business', (c) => fleet.createSimulation(c, { id: 'SIM-X', workspaceId: 'team-brake', imageId: 'x89-1.0-sim', env: 'development', pool: 'Chassis' }));
    },
  },
  'T-N02': {
    run: (w) => {
      w.fails('POOL_OUTSIDE_WORKSPACE', () => w.as('workspace_manager', (c) => fleet.createSimulation(c, { id: 'SIM-B', workspaceId: 'team-brake', imageId: 'x89-1.0-sim', env: 'development', pool: 'Battery' })));
      w.as('dcl', (c) => fleet.registerImage(c, { id: 'x90-dev', vehicleModelId: 'X90', integrationVersion: null, build: 'x90', digest: sha('x90'), simulator: 'SimOne 3' }));
      w.fails('IMAGE_MODEL_MISMATCH', () => w.as('workspace_manager', (c) => fleet.createSimulation(c, { id: 'SIM-90', workspaceId: 'team-brake', imageId: 'x90-dev', env: 'development', pool: 'Chassis' })));
      w.denied('workspace_manager', (c) => fleet.createSimulation(c, { id: 'SIM-P', workspaceId: 'team-brake', imageId: 'x89-1.0-sim', env: 'production', pool: 'Chassis' }));
      w.denied('workspace_manager', (c) => fleet.addWorkspaceVehicle(c, 'team-brake', 'VEH-201'));
    },
  },
  'T-N03': {
    adaptation: '浏览器原型中操作逐个在事务中执行，没有并发写入；以先后两次登记同 VIN / 同 ID 验证只保留一项、失败无部分写入。',
    run: (w) => {
      w.fails('VIN_TAKEN', () => w.as('resource', (c) => fleet.registerPhysical(c, { id: 'VEH-777', vin: 'LSDEM0X8900000001', vehicleModelId: 'X89', env: 'development', pool: 'Chassis' })));
      w.fails('ID_TAKEN', () => w.as('resource', (c) => fleet.registerPhysical(c, { id: 'VEH-001', vin: 'LSDEMX89000000777', vehicleModelId: 'X89', env: 'development', pool: 'Chassis' })));
    },
  },
  'T-N04': {
    run: (w) => {
      w.as('dcl', (c) => fleet.registerImage(c, { id: 'x90-dev', vehicleModelId: 'X90', integrationVersion: null, build: 'x90', digest: sha('x90'), simulator: 'SimOne 3' }));
      w.fails('IMAGE_MODEL_MISMATCH', () => w.as('workspace_manager', (c) => fleet.createSimulation(c, { id: 'SIM-90', workspaceId: 'team-brake', imageId: 'x90-dev', env: 'development', pool: 'Chassis' })));
      w.fails('SIMULATION_SOFTWARE_FROM_IMAGE', () => w.as('resource', (c) => fleet.confirmIntegration(c, 'SIM-021', { version: '1.1', source: '伪造' })));
    },
  },
  'T-N05': {
    adaptation: '原型没有网络请求与 requestId；以重复提交同一文件创建来验证：被拒绝且返回已有的 data_key，只有一个身份与一份双侧绑定。',
    run: (w) => {
      const f = w.as('business', (c) => config.createFeature(c, { workspaceId: 'team-brake', groupId: 'brake', name: 'replay_check' }));
      const src = { unit: 'ADC', directory: '/var/log/brake', pattern: 'replay.log' };
      const a = w.as('business', (c) => config.addFile(c, f, { source: src, name: '重放', purpose: '幂等' }));
      const err = w.fails('FILE_ALREADY_IN_DRAFT', () => w.as('business', (c) => config.addFile(c, f, { source: src, name: '重放', purpose: '幂等' })));
      w.eq((err.details as { dataKey: string }).dataKey, a, 'the replay names the same identity');
      w.eq(Object.values(w.s.dataItems).filter((d) => d.dataKey === a).length, 1, 'one data item');
      w.eq(Object.keys(w.s.features[f]!.draft.files), [a], 'one file with one pair of bindings');
    },
  },
  'T-N06': {
    run: (w) => {
      const f = feature(w, 'guided_brake').id;
      const before = Object.keys(w.s.dataItems).length;
      try {
        w.as('business', (c) => {
          config.addFile(c, f, { source: { unit: 'ADC', directory: '/var/log/brake', pattern: 'inject.log' }, name: '注入', purpose: '失败注入' });
          throw new Error('injected failure after the file was created');
        });
      } catch {
        // expected
      }
      w.eq(Object.keys(w.s.dataItems).length, before, 'no orphan data item');
      w.check(!Object.values(w.s.features[f]!.draft.files).some((x) => x.name === '注入'), 'no orphan file or one-sided binding');
    },
  },
  'T-N07': {
    run: (w) => {
      const req = Object.values(w.s.referenceRequests).find((r) => r.status === 'PENDING')!;
      w.as('business', (c) => decideReference(c, req.id, { decision: 'APPROVED', reason: '只读用于转向分析' }));
      const f = w.as('steering', (c) => config.createFeature(c, { workspaceId: 'team-steering', groupId: 'steering', name: 'reads_brake' }));
      w.as('steering', (c) => config.putReference(c, f, req.dataKey));
      const pinned = w.s.features[f]!.draft.references[req.dataKey]!;
      w.fails('NOT_FOUND', () => w.as('steering', (c) => config.updateFile(c, f, req.dataKey, { purpose: '改写' })));
      w.denied('steering', (c) => config.updateFile(c, feature(w, 'guided_brake').id, req.dataKey, { purpose: '改写' }));
      w.eq(w.s.features[f]!.draft.references[req.dataKey], pinned, 'the pinned version is unchanged');
    },
  },
  'T-N08': {
    run: (w) => {
      const f = w.as('business', (c) => config.createFeature(c, { workspaceId: 'team-brake', groupId: 'brake', name: 'unreviewed_camera' }));
      const key = w.as('business', (c) => config.addFile(c, f, { source: { unit: 'ADC', directory: '/data/camera', pattern: 'front_*.jpg' }, name: '前视', purpose: '测试' }));
      w.as('business', (c) => config.putPolicy(c, f, 'chassis.brake.front', { name: '前视', trigger: 'brake_pressure > 90', captures: [key], preSeconds: 2, postSeconds: 2 }));
      w.eq(w.as('business', (c) => config.submitFeature(c, f, {})).stage, 'SUBMITTED', 'waiting for review');
      w.fails('NOT_DCL_READY', () => w.as('brake_tester', (c) => v.dispatchFeature(c, f, { commitId: w.s.features[f]!.headCommitId!, vehicleGroupIds: [group(w, '制动研发车组')] })));
    },
  },
  'T-N09': {
    run: (w) => {
      const f = w.as('adc_parking', (c) => config.createFeature(c, { workspaceId: 'team-adc-parking', groupId: 'adc-parking', name: 'disguised' }));
      w.fails('SENSITIVE_TYPE_DOWNGRADE', () =>
        w.as('adc_parking', (c) => config.addFile(c, f, { source: { unit: 'ADC', directory: '/data/camera/rear', pattern: 'rear_*.mp4' }, name: '伪装', purpose: '测试', fileType: 'text_log' })),
      );
      const key = w.as('adc_parking', (c) => config.addFile(c, f, { source: { unit: 'ADC', directory: '/data/camera/rear', pattern: 'rear_*.mp4' }, name: '后视', purpose: '测试', privacy: 'P3' }));
      w.check(w.s.features[f]!.draft.files[key]!.requiresReview, 'a lower privacy level still requires review');
    },
  },
  'T-N10': {
    run: (w) => {
      const parking = feature(w, 'parking_camera');
      const key = Object.keys(parking.draft.files)[0]!;
      w.as('dcl', (c) => reviewFile(c, parking.id, { commitId: parking.headCommitId!, dataKey: key, decision: 'APPROVED', reason: '符合', controls: CONTROLS }));
      w.eq(w.s.features[parking.id]!.stage, 'DCL_READY', 'approved');
      w.as('adc_parking', (c) => config.updateFile(c, parking.id, key, { retentionDays: 90 }));
      w.eq(w.as('adc_parking', (c) => config.submitFeature(c, parking.id, {})).stage, 'SUBMITTED', 'the approval does not cover the change');
    },
  },
  'T-N11': {
    run: (w) => {
      const brake = feature(w, 'guided_brake');
      const old = Object.values(commitSnapshot(w.s, brake.headCommitId!).files)[0]!;
      const t = currentTemplate(w.s, 'bin_log')!;
      const cloud = w.as('dcl', (c) => createPipeline(c, { code: 'default-cloud-bin-log', side: 'CLOUD', name: 'v2', formats: ['binary'], steps: ['Receive', 'Parse'] }));
      w.as('dcl', (c) => createTemplate(c, { fileType: 'bin_log', format: t.format, schema: t.schema, edgePipelineId: t.edgePipelineId, cloudPipelineId: cloud, defaultRetentionDays: 30 }));
      w.eq(Object.values(commitSnapshot(w.s, brake.headCommitId!).files)[0]!.cloudPipelineId, old.cloudPipelineId, 'old commits keep their template version');
      const e = Object.values(w.s.events)[0]!;
      w.check(w.s.pipelines[e.files[0]!.cloudPipelineId]!.version === 1, 'old events keep theirs');
    },
  },
  'T-N12': {
    adaptation: 'Kairoz 的 DCL 版本只来自正式发布，不随软件 Build 产生；“仅改 Build 不出新版本”自然成立。',
    run: (w) => {
      const brake = feature(w, 'guided_brake');
      const r = w.as('business', (c) => config.submitFeature(c, brake.id, {}));
      w.eq([r.reused, r.commitId], [true, brake.headCommitId], 'no change, no new commit');
    },
  },
  'T-N13': {
    run: (w) => {
      const brake = feature(w, 'guided_brake');
      const d = w.as('dispatch_operator', (c) => v.dispatchFeature(c, brake.id, { commitId: brake.headCommitId!, vehicleGroupIds: [group(w, '制动研发车组')] }));
      answerAll(w, d);
      w.denied('dispatch_operator', (c) => v.recordFeatureTest(c, brake.id, { commitId: brake.headCommitId!, resourceId: 'SIM-021', result: 'PASS', summary: 'x' }));
      const { release } = nextRelease(w);
      const cand = w.s.releases[release]!.candidateId!;
      w.denied('brake_tester', (c) => v.recordCandidateTest(c, cand, { resourceId: 'SIM-101', result: 'PASS', summary: 'x' }));
    },
  },
  'T-N14': {
    run: (w) => {
      const brake = feature(w, 'guided_brake');
      w.as('brake_tester', (c) => v.dispatchFeature(c, brake.id, { commitId: brake.headCommitId!, vehicleGroupIds: [group(w, '制动研发车组')] }));
      w.fails('NOT_APPLIED', () => w.as('brake_tester', (c) => v.recordFeatureTest(c, brake.id, { commitId: brake.headCommitId!, resourceId: 'SIM-021', result: 'PASS', summary: 'x' })));
    },
  },
  'T-N15': {
    run: (w) => {
      const steering = feature(w, 'steering_return_rate');
      w.denied('steering_tester', (c) => v.dispatchFeature(c, steering.id, { commitId: steering.headCommitId!, vehicleGroupIds: [group(w, 'X89 量产车组')] }));
      const plan = w.as('integrator', (c) => integ.previewMerge(c, { workspaceId: 'x89-project', featureIds: [steering.id] }));
      w.as('dcl', (c) => integ.confirmProcessing(c, plan, { note: '' }));
      const cand = w.as('integrator', (c) => integ.freezeCandidate(c, plan, { label: 'X89-C2' }));
      w.fails('DISPATCH_BLOCKED', () => w.as('integration_tester', (c) => v.dispatchCandidate(c, cand, { vehicleGroupIds: [group(w, '制动研发车组')] })));
      w.fails('DISPATCH_BLOCKED', () => w.as('integration_tester', (c) => v.dispatchCandidate(c, cand, { vehicleGroupIds: [group(w, 'X89 量产车组')] })));
      w.as('resource', (c) => fleet.confirmIntegration(c, 'VEH-202', { version: '1.1', source: 'DIP' }));
      const r100 = rel.releasesOf(w.s, 'X89')[0]!.id;
      w.fails('OTA_BLOCKED', () => w.as('release', (c) => ota.createOta(c, { releaseId: r100, vehicleGroupIds: [group(w, 'X89 量产车组')], firstWave: 'ALL' })));
    },
  },
  'T-N16': {
    run: (w) => {
      const steering = feature(w, 'steering_return_rate');
      w.denied('integrator', (c) => config.putPolicy(c, steering.id, 'chassis.steering.return_rate', { name: 'x', trigger: 'steering_return_rate < 1', captures: [], preSeconds: 1, postSeconds: 1 }));
      // A conflicting pair: two steering Features adding the same new policy differently.
      const make = (name: string, post: number) => {
        const f = w.as('steering', (c) => config.createFeature(c, { workspaceId: 'team-steering', groupId: 'steering', name }));
        const key = Object.keys(w.s.features[f]!.draft.files)[0]!;
        w.as('steering', (c) => config.putPolicy(c, f, 'chassis.steering.lane_drift', { name: '跑偏', trigger: 'lane_offset > 0.5', captures: [key], preSeconds: 5, postSeconds: post }));
        w.as('steering', (c) => config.submitFeature(c, f, {}));
        const d = w.as('steering_tester', (c) => v.dispatchFeature(c, f, { commitId: w.s.features[f]!.headCommitId!, vehicleGroupIds: [group(w, '转向研发车组')] }));
        answerAll(w, d);
        for (const r of ['SIM-022', 'VEH-003']) w.as('steering_tester', (c) => v.recordFeatureTest(c, f, { commitId: w.s.features[f]!.headCommitId!, resourceId: r, result: 'PASS', summary: 'ok' }));
        w.as('steering_tester', (c) => v.verifyFeature(c, f));
        return f;
      };
      const a = make('drift_a', 10);
      const b = make('drift_b', 20);
      const plan = w.as('integrator', (c) => integ.previewMerge(c, { workspaceId: 'x89-project', featureIds: [a, b] }));
      w.fails('PLAN_NOT_READY', () => w.as('integrator', (c) => integ.freezeCandidate(c, plan, { label: 'x' })));
    },
  },
  'T-N17': {
    run: (w) => {
      const steering = feature(w, 'steering_return_rate');
      const plan = w.as('integrator', (c) => integ.previewMerge(c, { workspaceId: 'x89-project', featureIds: [steering.id] }));
      w.fails('PROCESSING_NOT_CONFIRMED', () => w.as('integrator', (c) => integ.freezeCandidate(c, plan, { label: 'x' })));
      w.eq(Object.values(w.s.candidates).filter((c) => c.status !== 'RELEASED').length, 0, 'no candidate exists to bind test vehicles to');
    },
  },
  'T-N18': {
    run: (w) => {
      const steering = feature(w, 'steering_return_rate');
      const plan = w.as('integrator', (c) => integ.previewMerge(c, { workspaceId: 'x89-project', featureIds: [steering.id] }));
      w.as('dcl', (c) => integ.confirmProcessing(c, plan, { note: '' }));
      const cand = w.as('integrator', (c) => integ.freezeCandidate(c, plan, { label: 'X89-C2' }));
      w.fails('CANDIDATE_NOT_VERIFIED', () => w.as('release', (c) => rel.promoteCandidate(c, cand, { dclVersion: '1.0.1', vehicleIntegrationVersions: ['1.0'] })));
    },
  },
  'T-N19': {
    run: (w) => {
      const { ota: id } = nextRelease(w);
      w.sys((c) => sendReceipt(c, id, 'VEH-201', 'FAILED', 'timeout'));
      w.as('release', (c) => ota.resumeOta(c, id));
      w.sys((c) => sendReceipt(c, id, 'VEH-201', 'APPLIED'));
      const t = w.s.deployments[id]!.targets.find((x) => x.resourceId === 'VEH-201')!;
      w.eq([t.status, t.attempt, t.history[0]?.status], ['APPLIED', 1, 'FAILED'], 'the new attempt counts, the old failure stays');
      w.fails('RECEIPT_CONFLICT', () => w.sys((c) => v.acceptReceipt(c, { deploymentId: id, resourceId: 'VEH-201', attempt: 1, result: 'FAILED' })));
      w.eq(w.sys((c) => v.acceptReceipt(c, { deploymentId: id, resourceId: 'VEH-201', attempt: 0, result: 'FAILED' })), 'REPLAYED', 'a late identical receipt is a replay');
    },
  },
  'T-N20': {
    run: (w) => {
      const e = Object.values(w.s.events).find((x) => x.status === 'DONE')!;
      const f = e.files[0]!;
      w.eq(w.sys((c) => ev.receiveChunk(c, e.id, f.dataKey, 0, f.chunks[0]!.sha256)), 'REPLAYED', 'a resent chunk is idempotent');
      w.fails('CHECKSUM_MISMATCH', () => w.sys((c) => ev.receiveChunk(c, e.id, f.dataKey, 0, 'sha256:0000')));
      w.eq(w.sys((c) => ev.deliverCallback(c, e.id)), 'DUPLICATE', 'the product callback is not repeated');
      w.eq([w.s.events[e.id]!.callbacks.length, w.s.events[e.id]!.files[0]!.artifactUri], [1, f.artifactUri], 'one product, one callback');
    },
  },
  'T-N21': {
    run: (w) => {
      w.as('admin', (c) => replaceGrants(c, 'business', []));
      w.denied('business', (c) => config.submitFeature(c, feature(w, 'guided_brake').id, {}));
      w.check(Object.values(w.s.commits).some((c) => c.author === 'business'), 'history is kept');
    },
  },
  'T-N22': {
    run: (w) => {
      w.as('resource', (c) => fleet.reportControllers(c, 'VEH-202', { target: '1.0', source: 'DIP', controllers: [{ name: 'ADC', version: '1.0', status: 'PASS' }, { name: 'BMS', version: '1.1', status: 'FAIL' }] }));
      w.eq([w.s.resources['VEH-202']!.softwareStatus, w.s.resources['VEH-202']!.integrationVersion], ['PARTIAL_FAILURE', null], 'the real controller state is recorded; no whole-vehicle success');
      const { release } = nextRelease(w, ['VEH-201']);
      const err = w.fails('OTA_BLOCKED', () => w.as('release', (c) => ota.createOta(c, { releaseId: release, vehicleGroupIds: [group(w, 'X89 量产车组')], firstWave: 'ALL' })));
      w.check((err.details as { issues: string[] }).issues.some((i) => i.startsWith('VEH-202') && i.includes('partial software update')), 'the production target is not released');
    },
  },
  'T-N23': {
    run: (w) => {
      const brake = feature(w, 'guided_brake');
      w.as('brake_tester', (c) => v.dispatchFeature(c, brake.id, { commitId: brake.headCommitId!, vehicleGroupIds: [group(w, '制动研发车组')] }));
      w.fails('VEHICLE_BUSY', () => w.as('workspace_manager', (c) => fleet.removeGroupMember(c, group(w, '制动研发车组'), 'SIM-021', '回收')));
      // An idle but running simulation, and a reserved vehicle, cannot move out either.
      w.fails('SIMULATION_RUNNING', () => w.as('workspace_manager', (c) => fleet.removeGroupMember(c, group(w, '转向研发车组'), 'SIM-022', '回收')));
      w.as('workspace_manager', (c) => fleet.reserveVehicle(c, 'team-steering', 'VEH-003', '路面激励测试'));
      w.fails('VEHICLE_RESERVED', () => w.as('workspace_manager', (c) => fleet.removeGroupMember(c, group(w, '转向研发车组'), 'VEH-003', '回收')));
    },
  },
  'T-N24': {
    run: () => {
      const clean = new World(cleanState());
      clean.eq(Object.keys(clean.s.accounts), ['admin'], 'only the administrator');
      for (const key of ['workspaces', 'groups', 'resources', 'features', 'events'] as const) clean.eq(Object.keys(clean.s[key]).length, 0, `no demo ${key}`);
    },
  },
};
