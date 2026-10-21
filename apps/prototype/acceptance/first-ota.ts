// 首次 OTA · 集成与发布 (E01–E18, branches X01–X03) on a clean installation. The integration
// workspace takes the team workspace as its source directly; there is no project workspace.

import { ENVS } from '../src/domain/vocabulary.ts';
import * as config from '../src/engine/config.ts';
import * as ev from '../src/engine/events.ts';
import * as fleet from '../src/engine/fleet.ts';
import { createAccount } from '../src/engine/identity.ts';
import { reviewFile } from '../src/engine/intake.ts';
import * as integ from '../src/engine/integration.ts';
import * as org from '../src/engine/org.ts';
import * as ota from '../src/engine/ota.ts';
import { createPipeline, createTemplate, currentTemplate } from '../src/engine/processing.ts';
import * as rel from '../src/engine/release.ts';
import { cleanState } from '../src/engine/seed.ts';
import { sendReceipt } from '../src/engine/simulator.ts';
import type { State } from '../src/engine/types.ts';
import * as v from '../src/engine/validation.ts';
import { answerAll, CONTROLS, recordPasses, verifyFeatureOn } from './helpers.ts';
import { World } from './world.ts';
import type { SceneSpec } from './world.ts';

export const start = (): State => cleanState();

const ALL = [...ENVS];

const firstWorkspaceSetup = (w: World) => {
  w.as('admin', (c) => org.createOrgUnit(c, { id: 'org-company', name: '公司' }));
  w.as('admin', (c) => org.createOrgUnit(c, { id: 'org-center', name: '整车研发中心', parentId: 'org-company' }));
  w.as('admin', (c) => org.createOrgUnit(c, { id: 'org-chassis', name: '底盘部门', parentId: 'org-center' }));
  w.as('admin', (c) => org.createOrgUnit(c, { id: 'org-brake', name: '制动团队', parentId: 'org-chassis' }));
  w.as('admin', (c) => org.createOrgUnit(c, { id: 'org-hmi', name: 'HMI 团队', parentId: 'org-center' }));
  w.as('admin', (c) => org.createVehicleModel(c, { id: 'X89', name: 'X89' }));
  w.as('admin', (c) => org.createGroup(c, { id: 'brake', code: 'chassis.brake', name: '制动组', domain: 'Chassis', purpose: 'DEV', orgUnitId: 'org-brake' }));
  w.as('admin', (c) => org.createGroup(c, { id: 'hmi', code: 'hmi.display', name: 'HMI 组', domain: 'HMI', purpose: 'DEV', orgUnitId: 'org-hmi' }));
  w.as('admin', (c) => org.createWorkspace(c, { id: 'team-brake', name: '制动团队工作区', kind: 'TEAM', orgUnitId: 'org-brake', vehicleModelId: 'X89', groupIds: ['brake'], scopes: ['Chassis'], sourceWorkspaceIds: [] }));
  w.as('admin', (c) => org.createProject(c, { id: 'proj-x89', name: 'X89 项目', vehicleModelId: 'X89' }));
  w.as('admin', (c) => org.createOrgUnit(c, { id: 'proj-x89-chassis', name: '底盘', parentId: 'proj-x89' }));
  w.as('admin', (c) => org.createOrgUnit(c, { id: 'proj-x89-hmi', name: 'HMI', parentId: 'proj-x89' }));
};

export const scenes: Record<string, SceneSpec> = {
  E01: {
    adaptation: '原型没有服务端：以“干净安装”代替空平台部署；runId 记在验收结果里。',
    run: (w) => {
      w.eq(Object.keys(w.s.accounts), ['admin'], 'an empty platform with only admin');
      w.notApplicable('启动服务、健康检查与运行目录属于服务端部署，浏览器原型不适用');
    },
  },
  E02: {
    run: (w) => {
      firstWorkspaceSetup(w);
      w.as('admin', (c) =>
        org.createWorkspace(c, { id: 'x89-integration', name: 'X89 集成', kind: 'INTEGRATION', orgUnitId: 'proj-x89', vehicleModelId: 'X89', groupIds: ['brake', 'hmi'], scopes: ['Vehicle'], sourceWorkspaceIds: ['team-brake'] }),
      );
      w.eq(w.s.workspaces['x89-integration']!.sourceWorkspaceIds, ['team-brake'], 'the integration workspace takes the team as its source');
      w.eq(config.latestRelease(w.s, 'X89'), undefined, 'no release yet; the initial configuration is managed internally');
    },
  },
  E03: {
    adaptation: 'Kairoz 要求修改共享处理目录的 DCL 授权覆盖全部工作区与分组（`*`）；本安装中“相关组及两个工作区”即全部，故授予 `*`。',
    run: (w) => {
      const g = (role: string, workspaces: string[], groups: string[], scopes: string[], envs: string[]) => ({ role, workspaces, groups, scopes, envs, dispatchOnly: false });
      for (const [username, displayName, grants] of [
        ['business', '陈明', [g('BUSINESS_DEV', ['team-brake'], ['brake'], [], ['development', 'testing'])]],
        ['brake_tester', '王嘉宁', [g('BUSINESS_TEST', ['team-brake'], ['brake'], [], ['development', 'testing'])]],
        ['workspace_manager', '周子墨', [g('WORKSPACE_ADMIN', ['team-brake'], [], [], ['development', 'testing'])]],
        ['dcl', '林书涵', [g('DCL_ENGINEER', ['*'], ['*'], [], ALL)]],
        ['resource', '刘子衡', [g('VEHICLE_RESOURCE', ['team-brake', 'x89-integration'], [], ['Chassis', 'Vehicle'], ALL)]],
        ['integrator', '赵一鸣', [g('CONFIG_INTEGRATOR', ['x89-integration'], [], ['Vehicle'], ['development', 'testing'])]],
        ['integration_tester', '钱思源', [g('INTEGRATION_TEST', ['x89-integration'], [], ['Vehicle'], ['testing'])]],
        ['release', '孙立', [g('CONFIG_RELEASE', ['x89-integration'], [], ['Vehicle'], ALL)]],
      ] as const) {
        w.as('admin', (c) => createAccount(c, { username, displayName, grants: grants.map((x) => ({ ...x, envs: [...x.envs] })) }));
      }
      w.check(Object.keys(w.s.accounts).length === 9, 'every duty has a person');
      w.denied('business', (c) => fleet.recordSoftwareVersion(c, { vehicleModelId: 'X89', version: '9.9', source: 'x' }));
    },
  },
  E04: {
    run: (w) => {
      const edge = w.as('dcl', (c) => createPipeline(c, { code: 'startup-edge', side: 'EDGE', name: 'startup-edge', formats: ['text'], schemas: ['*'], steps: ['Locate', 'Snapshot', 'Compress', 'Encrypt', 'Upload'] }));
      const cloud = w.as('dcl', (c) => createPipeline(c, { code: 'startup-cloud', side: 'CLOUD', name: 'startup-cloud', formats: ['text'], schemas: ['*'], steps: ['Receive', 'Checksum', 'Decrypt', 'RawStore', 'Index'] }));
      w.as('dcl', (c) => createTemplate(c, { fileType: 'text_log', format: 'text', schema: 'opaque-text_log@1', edgePipelineId: edge, cloudPipelineId: cloud, defaultRetentionDays: 30, defaultPrivacy: 'P1' }));
      w.eq([w.s.pipelines[edge]!.code, w.s.pipelines[edge]!.version], ['startup-edge', 1], 'the platform numbers processing versions');
      w.check(currentTemplate(w.s, 'text_log')?.edgePipelineId === edge, 'new text_log files bind both sides automatically');
    },
  },
  E05: {
    adaptation: '剧本中的模拟 VIN “LSDEMOX89000000901” 是 18 位且含字母 O，不是合法 VIN；平台拒绝后改用合法的 17 位模拟 VIN。车辆组设为“需审批”，对应 E06/E07 的团队测试申请流程。',
    run: (w) => {
      w.as('dcl', (c) => fleet.registerImage(c, { id: 'x89-dev-first', vehicleModelId: 'X89', integrationVersion: null, build: 'dev-first', digest: 'sha256:mock-dev-first', simulator: 'SimOne 3' }));
      w.as('resource', (c) => fleet.createSimulation(c, { id: 'SIM-901', workspaceId: 'team-brake', imageId: 'x89-dev-first', env: 'development', pool: 'Chassis' }));
      w.fails('INVALID_VIN', () => w.as('resource', (c) => fleet.registerPhysical(c, { id: 'VEH-901', vin: 'LSDEMOX89000000901', vehicleModelId: 'X89', env: 'development', pool: 'Chassis' })));
      w.as('resource', (c) => fleet.registerPhysical(c, { id: 'VEH-901', vin: 'LSDEMX89000000901', licensePlate: '沪A·M0901', vehicleModelId: 'X89', env: 'development', pool: 'Chassis', displayName: 'Mock 实车 901' }));
      w.as('resource', (c) => fleet.addWorkspaceVehicle(c, 'team-brake', 'VEH-901'));
      w.eq(fleet.workspaceVehicles(w.s, 'team-brake').map((r) => r.id), ['SIM-901', 'VEH-901'], 'both vehicles are in team-brake');
      w.ref.group = w.as('workspace_manager', (c) => fleet.createVehicleGroup(c, { workspaceId: 'team-brake', groupId: 'brake', name: '制动首版验证组', purpose: 'DEV', env: 'development', requiresApproval: true }));
      for (const r of ['SIM-901', 'VEH-901']) w.as('workspace_manager', (c) => fleet.addGroupMember(c, w.ref.group!, r, '首版验证'));
      w.eq(fleet.workspaceVehicles(w.s, 'team-brake').map((r) => [r.id, r.integrationVersion, r.appliedConfigId, w.s.groupMembers[r.id]]), [['SIM-901', null, null, w.ref.group], ['VEH-901', null, null, w.ref.group]], 'empty software and configuration, one group per vehicle');
    },
  },
  E06: {
    run: (w) => {
      const f = w.as('business', (c) => config.createFeature(c, { workspaceId: 'team-brake', groupId: 'brake', name: 'first-brake', description: '首版制动诊断' }));
      w.ref.feature = f;
      const key = w.as('business', (c) => config.addFile(c, f, { source: { unit: 'ADC', directory: '/data/brake', pattern: 'debug.log' }, name: '制动诊断日志', purpose: '首版制动诊断', privacy: 'P1' }));
      w.ref.key = key;
      const spec = w.s.features[f]!.draft.files[key]!;
      w.eq([w.s.pipelines[spec.edgePipelineId]!.code, w.s.pipelines[spec.cloudPipelineId]!.code], ['startup-edge', 'startup-cloud'], 'both sides bound automatically');
      w.as('business', (c) => config.putPolicy(c, f, 'chassis.brake.brake_debug', { name: 'BrakeDebug', trigger: 'brake_pressure > 80 AND vehicle_speed > 30', captures: [key], preSeconds: 10, postSeconds: 20 }));
      const r = w.as('business', (c) => config.submitFeature(c, f, { message: '首版制动诊断' }));
      w.eq(r.stage, 'DCL_READY', 'a fixed commit, DCL Ready');
      w.ref.r1 = r.commitId;
      w.ref.request = w.as('business', (c) => v.requestTeamTest(c, f, { commitId: r.commitId, vehicleGroupIds: [w.ref.group!], goal: '首版制动诊断封闭验证' }));
      const req = w.s.testRequests[w.ref.request]!;
      w.eq([req.status, req.commitId, req.members], ['PENDING', r.commitId, ['SIM-901', 'VEH-901']], 'a request binding the commit and the vehicle list');
    },
  },
  E07: {
    needs: ['E06'],
    run: (w) => {
      w.denied('business', (c) => v.decideTestRequest(c, w.ref.request!, { decision: 'APPROVED', note: '自批' }));
      w.fails('APPROVAL_REQUIRED', () => w.as('brake_tester', (c) => v.dispatchFeature(c, w.ref.feature!, { commitId: w.ref.r1!, vehicleGroupIds: [w.ref.group!] })));
      w.as('workspace_manager', (c) => v.decideTestRequest(c, w.ref.request!, { decision: 'APPROVED', note: '首版封闭Mock验证' }));
      const d = w.as('brake_tester', (c) => v.executeTestRequest(c, w.ref.request!));
      w.fails('REQUEST_USED', () => w.as('brake_tester', (c) => v.executeTestRequest(c, w.ref.request!)));
      w.eq(w.s.resources['SIM-901']!.appliedConfigId, null, 'the target is set; nothing applied yet');
      for (const r of ['SIM-901', 'VEH-901']) w.sys((c) => sendReceipt(c, d, r, 'APPLIED'));
      w.eq([w.s.deployments[d]!.status, w.s.deployments[d]!.targets.map((t) => t.resourceId)], ['COMPLETED', ['SIM-901', 'VEH-901']], 'both vehicles confirmed; the task keeps its member snapshot');
    },
  },
  E08: {
    needs: ['E07'],
    run: (w) => {
      const f = w.ref.feature!;
      w.fails('SIMULATION_FIRST', () => w.as('brake_tester', (c) => v.recordFeatureTest(c, f, { commitId: w.ref.r1!, resourceId: 'VEH-901', result: 'PASS', summary: 'x' })));
      recordPasses(w, 'brake_tester', f, ['SIM-901', 'VEH-901']);
      w.as('brake_tester', (c) => v.verifyFeature(c, f));
      w.eq(w.s.features[f]!.stage, 'VERIFIED', 'first-brake is Verified');
      // The author starts editing again: the verified commit stays collectible.
      w.as('business', (c) => config.updateFile(c, f, w.ref.key!, { purpose: '首版制动诊断（草稿修改）' }));
      w.check(integ.verifiedSources(w.s, 'x89-integration').some((x) => x.id === f), 'integration still collects the verified fixed commit');
      w.as('business', (c) => config.updateFile(c, f, w.ref.key!, { purpose: '首版制动诊断' }));
      w.as('business', (c) => config.submitFeature(c, f, {}));
      w.eq(w.s.features[f]!.stage, 'VERIFIED', 'reverting the draft restores Verified');
    },
  },
  E09: {
    needs: ['E08'],
    run: (w) => {
      const plan = w.as('integrator', (c) => integ.previewMerge(c, { workspaceId: 'x89-integration', featureIds: [w.ref.feature!] }));
      w.ref.plan = plan;
      w.eq(w.s.mergePlans[plan]!.status, 'READY', 'no conflict, no compatibility block');
      w.eq(Object.keys(w.s.mergePlans[plan]!.merged), ['brake'], 'only brake changes');
      const groups = integ.planGroups(w.s, w.s.mergePlans[plan]!);
      w.eq(groups.map((g) => [g.groupId, g.change]), [['brake', 'ADDED'], ['hmi', 'EMPTY']], 'brake is added; HMI is empty and inherited, no extra version');
      w.eq(groups[0]!.diff.policies.added, ['chassis.brake.brake_debug'], 'the added items are listed');
    },
  },
  E10: {
    needs: ['E09'],
    run: (w) => {
      w.as('dcl', (c) => integ.confirmProcessing(c, w.ref.plan!, { note: '首版最终处理集合' }));
      w.ref.candidate = w.as('integrator', (c) => integ.freezeCandidate(c, w.ref.plan!, { label: 'Candidate 1.0' }));
      const cand = w.s.candidates[w.ref.candidate]!;
      w.eq([cand.testWorkspaceId, cand.targetReleaseId, v.candidateTestStatus(w.s, cand).length], ['x89-integration', null, 0], 'an initial candidate, tested from zero in the integration workspace');
    },
  },
  E11: {
    needs: ['E10'],
    run: (w) => {
      w.as('resource', (c) => fleet.createSimulation(c, { id: 'SIM-902', workspaceId: 'x89-integration', imageId: 'x89-dev-first', env: 'testing', pool: 'Vehicle' }));
      w.as('resource', (c) => fleet.registerPhysical(c, { id: 'VEH-902', vin: 'LSDEMX89000000902', vehicleModelId: 'X89', env: 'testing', pool: 'Vehicle' }));
      w.as('resource', (c) => fleet.addWorkspaceVehicle(c, 'x89-integration', 'VEH-902'));
      w.denied('brake_tester', (c) => v.recordCandidateTest(c, w.ref.candidate!, { resourceId: 'SIM-902', result: 'PASS', summary: 'x' }));
      const d = w.as('integration_tester', (c) => v.dispatchCandidate(c, w.ref.candidate!, { resourceIds: ['SIM-902', 'VEH-902'] }));
      answerAll(w, d);
      for (const r of ['SIM-902', 'VEH-902']) w.as('integration_tester', (c) => v.recordCandidateTest(c, w.ref.candidate!, { resourceId: r, result: 'PASS', summary: '首版候选独立验证' }));
      w.as('integration_tester', (c) => v.verifyCandidate(c, w.ref.candidate!));
      const cand = w.s.candidates[w.ref.candidate!]!;
      w.check(cand.status === 'VERIFIED' && w.s.testRuns.filter((t) => t.subjectId === cand.id).every((t) => t.resolvedConfigId === cand.resolvedConfigId), 'every result names the same candidate configuration');
      w.eq([w.s.resources['SIM-902']!.integrationVersion, w.s.resources['VEH-902']!.integrationVersion], [null, null], 'DCL testing does not change vehicle software');
    },
  },
  E12: {
    needs: ['E11'],
    run: (w) => {
      w.fails('UNKNOWN_SOFTWARE_VERSION', () => w.as('release', (c) => rel.promoteCandidate(c, w.ref.candidate!, { dclVersion: '1.0.0', vehicleIntegrationVersions: ['1.0'] })));
      w.as('resource', (c) => fleet.recordSoftwareVersion(c, { vehicleModelId: 'X89', version: '1.0', source: 'MOCK 外部软件发布记录' }));
      w.ref.release = w.as('release', (c) => rel.promoteCandidate(c, w.ref.candidate!, { dclVersion: '1.0.0', vehicleIntegrationVersions: ['1.0'] }));
      w.eq(w.s.features[w.ref.feature!]!.stage, 'ARCHIVED', 'participating Features are closed as Archived');
      w.eq(w.s.resources['VEH-902']!.integrationVersion, null, 'actual software is not rewritten');
    },
  },
  E13: {
    needs: ['E12'],
    adaptation: '签名配置包（ZIP、Ed25519 服务端签名）需要服务端；剧本规定离线页不伪造服务端签名，原型提供“导出配置集合”JSON。',
    run: (w) => {
      const doc = rel.releaseConfiguration(w.s, w.ref.release!);
      w.eq([doc.dclVersion, doc.vehicleModelId, doc.vehicleIntegrationVersions, doc.prototype, doc.productionInstallable], ['1.0.0', 'X89', ['1.0'], true, false], 'version, model, software and prototype markings');
      const brake = doc.groups.find((g) => g.group === 'chassis.brake')!;
      w.eq([brake.files[0]!.edge, brake.files[0]!.cloud, brake.policies[0]!.policyId], ['startup-edge@1', 'startup-cloud@1', 'chassis.brake.brake_debug'], 'fixed files, policies and processing references');
      w.check(doc.digest === w.s.resolvedConfigs[w.s.releases[w.ref.release!]!.resolvedConfigId]!.digest, 'the digest of the released set');
    },
  },
  E14: {
    run: (w) => {
      for (const [id, vin] of [
        ['VEH-903', 'LSDEMX89000000903'],
        ['VEH-904', 'LSDEMX89000000904'],
      ] as const) {
        w.as('resource', (c) => fleet.registerPhysical(c, { id, vin, vehicleModelId: 'X89', env: 'production', pool: 'Vehicle' }));
        w.as('resource', (c) => fleet.addWorkspaceVehicle(c, 'x89-integration', id));
        w.as('resource', (c) =>
          fleet.reportControllers(c, id, { target: '1.0', source: 'MOCK DIP', controllers: [{ name: 'ADC', version: '1.0', status: 'PASS' }, { name: 'BMS', version: '1.0', status: 'PASS' }] }),
        );
        const r = w.s.resources[id]!;
        w.eq([r.softwareStatus, r.integrationVersion, r.appliedConfigId, w.s.groupMembers[id]], ['CONSISTENT', '1.0', null, undefined], `${id}: production, idle, consistent, not grouped`);
      }
    },
  },
  E15: {
    needs: ['E12', 'E14'],
    run: (w) => {
      const id = w.as('release', (c) => ota.createOta(c, { releaseId: w.ref.release!, workspaceId: 'x89-integration', resourceIds: ['VEH-903', 'VEH-904'], firstWave: ['VEH-903'] }));
      w.ref.ota = id;
      const d = w.s.deployments[id]!;
      w.eq([d.targets.map((t) => [t.resourceId, t.status]), d.resolvedConfigId], [[['VEH-903', 'PENDING'], ['VEH-904', 'QUEUED']], w.s.releases[w.ref.release!]!.resolvedConfigId], 'a fixed target list and configuration digest');
      w.eq(w.s.resources['VEH-903']!.appliedConfigId, null, 'expected is not applied');
      w.sys((c) => sendReceipt(c, id, 'VEH-903', 'APPLIED'));
      w.eq([w.s.resources['VEH-903']!.appliedConfigId, w.s.resources['VEH-903']!.integrationVersion], [d.resolvedConfigId, '1.0'], 'DCL 1.0.0 applied; software still 1.0');
      w.eq(w.s.deployments[id]!.status, 'PENDING', 'ready to expand');
    },
  },
  E16: {
    needs: ['E15'],
    run: (w) => {
      const id = w.ref.ota!;
      w.as('release', (c) => ota.expandOta(c, id, ['VEH-904']));
      w.sys((c) => sendReceipt(c, id, 'VEH-904', 'FAILED', 'Mock 应用失败'));
      w.eq([w.s.deployments[id]!.status, w.s.resources['VEH-904']!.appliedConfigId], ['PAUSED', null], 'paused; VEH-904 keeps what it had');
      w.as('release', (c) => ota.resumeOta(c, id));
      const t = () => w.s.deployments[id]!.targets.find((x) => x.resourceId === 'VEH-904')!;
      w.eq([t().attempt, t().history.map((h) => h.status)], [1, ['FAILED']], 'attempt 0 → 1; the old FAIL stays');
      w.sys((c) => sendReceipt(c, id, 'VEH-904', 'APPLIED'));
      w.eq(w.s.deployments[id]!.status, 'COMPLETED', 'both latest receipts PASS');
      w.eq(w.sys((c) => v.acceptReceipt(c, { deploymentId: id, resourceId: 'VEH-904', attempt: 1, result: 'APPLIED' })), 'REPLAYED', 'the same receipt again is idempotent');
      w.fails('RECEIPT_CONFLICT', () => w.sys((c) => v.acceptReceipt(c, { deploymentId: id, resourceId: 'VEH-904', attempt: 1, result: 'FAILED' })));
    },
  },
  E17: {
    needs: ['E16'],
    adaptation: '业务节点、Parser 与业务需求人的数据确认未接入；以模拟器的合成事件验证配置快照、分片上传、产物与回调，真实环节记为未执行。',
    run: (w) => {
      const id = w.sys((c) => ev.captureEvent(c, { resourceId: 'VEH-903', policyId: 'chassis.brake.brake_debug' }));
      const e0 = w.s.events[id]!;
      w.eq([e0.resourceId, e0.vin, e0.integrationVersion, e0.releaseId, e0.commitId], ['VEH-903', 'LSDEMX89000000903', '1.0', w.ref.release, w.s.releases[w.ref.release!]!.groups.brake], 'vehicle, software, DCL and commit in the snapshot');
      w.check(e0.files[0]!.fileSpecVersionId && e0.policyVersionId, 'file and policy versions pinned');
      w.sys((c) => ev.processEvent(c, id));
      const f = w.s.events[id]!.files[0]!;
      w.eq(w.sys((c) => ev.receiveChunk(c, id, f.dataKey, 0, f.chunks[0]!.sha256)), 'REPLAYED', 'a retransmitted chunk produces nothing new');
      w.eq(w.sys((c) => ev.deliverCallback(c, id)), 'DUPLICATE', 'the callback is delivered once');
      w.eq(w.s.events[id]!.callbacks.length, 1, 'one callback');
    },
  },
  E18: {
    needs: ['E16'],
    adaptation: 'SQLite 备份与恢复对应原型的“导出 / 导入完整状态 JSON”。',
    run: (w) => {
      const r = w.s.releases[w.ref.release!]!;
      w.eq([r.dclVersion, r.vehicleIntegrationVersions], ['1.0.0', ['1.0']], 'DCL 1.0.0 for software 1.0');
      for (const id of ['VEH-903', 'VEH-904']) {
        const v0 = w.s.resources[id]!;
        w.eq([v0.integrationVersion, v0.appliedConfigId], ['1.0', r.resolvedConfigId], `${id}: software 1.0, DCL 1.0.0 applied`);
      }
      w.check(w.s.deployments[w.ref.ota!]!.targets.find((t) => t.resourceId === 'VEH-904')!.history.length === 1, 'the failure and retry are traceable');
      const restored = new World(JSON.parse(JSON.stringify(w.s)) as State);
      w.eq(JSON.stringify(restored.s.releases), JSON.stringify(w.s.releases), 'the export / import round trip keeps the release');
      const next = w.as('business', (c) => config.createFeature(c, { workspaceId: 'team-brake', groupId: 'brake', name: 'next-brake' }));
      w.eq(w.s.features[next]!.baseReleaseId, w.ref.release, 'the next change starts on DCL 1.0.0');
    },
  },
  X01: {
    forkAfter: 'E06',
    adaptation: '首次 OTA 只发布了 text_log 模板；支线开始前由 DCL 发布相机图像的敏感处理模板。',
    run: (w) => {
      const edge = w.as('dcl', (c) => createPipeline(c, { code: 'camera-edge', side: 'EDGE', name: 'camera-edge', formats: ['image'], steps: ['Locate', 'Crop', 'Encrypt', 'Upload'] }));
      const cloud = w.as('dcl', (c) => createPipeline(c, { code: 'camera-cloud', side: 'CLOUD', name: 'camera-cloud', formats: ['image'], steps: ['Receive', 'Checksum', 'Decrypt', 'Desensitize', 'RawStore'] }));
      w.as('dcl', (c) => createTemplate(c, { fileType: 'camera_image', format: 'image', schema: 'opaque-camera@1', edgePipelineId: edge, cloudPipelineId: cloud, defaultRetentionDays: 14, requiresReview: true }));
      const f = w.as('business', (c) => config.createFeature(c, { workspaceId: 'team-brake', groupId: 'brake', name: 'brake-camera', description: '敏感支线' }));
      const key = w.as('business', (c) => config.addFile(c, f, { source: { unit: 'ADC', directory: '/data/camera', pattern: 'front_*.jpg' }, name: '前视图像', purpose: '急刹前方复核' }));
      w.as('business', (c) => config.putPolicy(c, f, 'chassis.brake.front_view', { name: '急刹前视', trigger: 'brake_pressure > 90', captures: [key], preSeconds: 3, postSeconds: 3 }));
      const r1 = w.as('business', (c) => config.submitFeature(c, f, { message: '前视图像' }));
      w.eq(r1.stage, 'SUBMITTED', 'the sensitive file stops at Submitted');
      w.as('dcl', (c) => reviewFile(c, f, { commitId: r1.commitId, dataKey: key, decision: 'REJECTED', reason: '必要性不足：请限制为单帧并缩短保留' }));
      w.as('business', (c) => config.updateFile(c, f, key, { purpose: '急刹瞬间单帧复核', retentionDays: 7 }));
      const r2 = w.as('business', (c) => config.submitFeature(c, f, { message: '缩小范围' }));
      w.eq(r2.stage, 'SUBMITTED', 'the old review never covers new content');
      w.as('dcl', (c) => reviewFile(c, f, { commitId: r2.commitId, dataKey: key, decision: 'APPROVED', reason: '单帧、7 天可接受', controls: CONTROLS }));
      verifyFeatureOn(w, 'brake_tester', f, [w.ref.group!]);
      w.eq(w.s.features[f]!.stage, 'VERIFIED', 'approved and re-verified');
    },
  },
  X02: {
    forkAfter: 'E08',
    run: (w) => {
      const alt = w.as('business', (c) => config.createFeature(c, { workspaceId: 'team-brake', groupId: 'brake', name: 'first-alt', description: '同组分支' }));
      const key = w.as('business', (c) => config.addFile(c, alt, { source: { unit: 'ADC', directory: '/data/brake', pattern: 'debug.log' }, name: '制动诊断日志', purpose: '首版制动诊断', privacy: 'P1' }));
      w.eq(key, w.ref.key, 'the same source is the same logical data item');
      w.as('business', (c) => config.putPolicy(c, alt, 'chassis.brake.brake_debug', { name: 'BrakeDebug', trigger: 'brake_pressure > 80 AND vehicle_speed > 30', captures: [key], preSeconds: 10, postSeconds: 25 }));
      w.as('business', (c) => config.submitFeature(c, alt, { message: 'post 25' }));
      verifyFeatureOn(w, 'brake_tester', alt, [w.ref.group!]);
      const plan = w.as('integrator', (c) => integ.previewMerge(c, { workspaceId: 'x89-integration', featureIds: [w.ref.feature!, alt] }));
      w.eq(w.s.mergePlans[plan]!.status, 'CONFLICT', 'the same policy changed two ways conflicts');
      w.fails('PLAN_NOT_READY', () => w.as('integrator', (c) => integ.freezeCandidate(c, plan, { label: 'x' })));
      w.as('business', (c) => config.putPolicy(c, alt, 'chassis.brake.brake_debug', { name: 'BrakeDebug', trigger: 'brake_pressure > 80 AND vehicle_speed > 30', captures: [key], preSeconds: 10, postSeconds: 20 }));
      w.as('business', (c) => config.submitFeature(c, alt, { message: '统一为 post 20' }));
      w.check(!integ.verifiedSources(w.s, 'x89-integration').some((x) => x.id === alt), 'the fix is not inherited as verified');
      verifyFeatureOn(w, 'brake_tester', alt, [w.ref.group!]);
      const again = w.as('integrator', (c) => integ.previewMerge(c, { workspaceId: 'x89-integration', featureIds: [w.ref.feature!, alt] }));
      w.eq(w.s.mergePlans[again]!.status, 'READY', 'the maintainer’s fix merges');
    },
  },
  X03: {
    forkAfter: 'E15',
    needs: ['E15'],
    run: (w) => {
      const id = w.ref.ota!;
      w.as('release', (c) => ota.pauseOta(c, id, '灰度异常'));
      w.eq(ota.answerConfigRequest(w.s, 'VEH-903').reason, 'HELD', 'affected vehicles keep their confirmed configuration');
      const err = w.fails('ROLLBACK_BLOCKED', () => w.as('release', (c) => ota.rollbackOta(c, id, '首版无上一正式配置')));
      w.check((err.details as { issues: string[] }).issues[0]!.includes('no earlier formal configuration'), 'no invented rollback version');
      w.as('release', (c) => ota.cancelOta(c, id, '停止首版扩量'));
      w.eq(w.s.deployments[id]!.targets.map((t) => t.status), ['APPLIED', 'CANCELLED'], 'each vehicle’s actual state is recorded');
      w.check(w.s.receipts.some((r) => r.deploymentId === id), 'history and receipts stay');
    },
  },
};

void answerAll;
