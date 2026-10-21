// 从零启动 · 角色协作 (A01–F07) on a clean installation.

import { authorize } from '../src/domain/authz.ts';
import { ENVS, ROLES } from '../src/domain/vocabulary.ts';
import { reviewItems } from '../src/engine/approvals.ts';
import * as config from '../src/engine/config.ts';
import * as ev from '../src/engine/events.ts';
import * as fleet from '../src/engine/fleet.ts';
import { createAccount, replaceGrants, updateAccount, workspaceAccess } from '../src/engine/identity.ts';
import { intakeQueue, reviewFile, setBinding } from '../src/engine/intake.ts';
import * as integ from '../src/engine/integration.ts';
import * as org from '../src/engine/org.ts';
import * as ota from '../src/engine/ota.ts';
import { createPipeline, createTemplate, currentTemplate } from '../src/engine/processing.ts';
import * as rel from '../src/engine/release.ts';
import { cleanState } from '../src/engine/seed.ts';
import { commitSnapshot } from '../src/engine/snapshots.ts';
import { sendReceipt, tick } from '../src/engine/simulator.ts';
import type { State } from '../src/engine/types.ts';
import * as v from '../src/engine/validation.ts';
import { answerAll, CONTROLS, dispatchApplied, recordPasses, simpleFeature, verifyFeatureOn } from './helpers.ts';
import { sha, World } from './world.ts';
import type { SceneSpec } from './world.ts';

export const start = (): State => cleanState();

const DEV_TEST = ['development', 'testing'];
const ALL = [...ENVS];
const grant = (role: string, workspaces: string[], groupsOrScopes: { groups?: string[]; scopes?: string[] }, envs: string[] = DEV_TEST, dispatchOnly = false) => ({
  role,
  workspaces,
  groups: groupsOrScopes.groups ?? [],
  scopes: groupsOrScopes.scopes ?? [],
  envs,
  dispatchOnly,
});

const account = (w: World, username: string, displayName: string, grants: ReturnType<typeof grant>[]) =>
  w.as('admin', (c) => createAccount(c, { username, displayName, grants }));

const CONSISTENT_1_0 = [
  { name: 'ADC', version: '1.0', status: 'PASS' as const },
  { name: 'BMS', version: '1.0', status: 'PASS' as const },
  { name: 'VCU', version: '1.0', status: 'PASS' as const },
];

const can = (w: World, user: string, action: Parameters<typeof authorize>[1], target: Parameters<typeof authorize>[2]) => authorize(w.actor(user).grants, action, target).ok;

export const scenes: Record<string, SceneSpec> = {
  A01: {
    adaptation: '浏览器原型没有服务器、数据库或部署；状态保存在浏览器本地。部署与重启在浏览器层以“重置为干净安装 + 刷新页面”核对持久化。',
    run: (w) => {
      // What the engine can show: a clean installation round-trips through its serialized form.
      const restored = new World(JSON.parse(JSON.stringify(w.s)) as State);
      w.eq(Object.keys(restored.s.accounts), ['admin'], 'the serialized installation reads back');
      w.notApplicable('服务部署、数据库与存储健康检查、日志检索不属于浏览器原型');
    },
  },
  A02: {
    run: (w) => {
      w.eq(Object.keys(w.s.accounts), ['admin'], 'only the administrator exists');
      w.check(w.actor('admin').grants.some((g) => g.role === 'PLATFORM_OPS' && g.workspaces.includes('*') && ALL.every((e) => g.envs.includes(e as never))), 'admin holds a full platform-ops grant');
      w.check(ROLES.length >= 8, 'the built-in roles are installed');
      // Boundaries: platform ops administers, it does not author, test or release.
      for (const action of ['feature.create', 'feature.dispatch', 'merge.manage', 'release.promote', 'resource.manage', 'event.query'] as const) {
        w.check(!can(w, 'admin', action, { workspaceId: '*', groupId: '*', scope: 'Vehicle', env: 'development' }), `platform ops cannot ${action}`);
      }
    },
  },
  A03: {
    run: (w) => {
      w.eq([...ENVS], ['development', 'testing', 'production'], 'three environments');
      w.as('admin', (c) => org.createOrgUnit(c, { id: 'company', name: '公司' }));
      w.as('admin', (c) => org.createOrgUnit(c, { id: 'vehicle-rd', name: '整车研发中心', parentId: 'company' }));
      w.as('admin', (c) => org.createOrgUnit(c, { id: 'chassis', name: '底盘部门', parentId: 'vehicle-rd' }));
      w.as('admin', (c) => org.createOrgUnit(c, { id: 'brake-team', name: '制动团队', parentId: 'chassis' }));
      w.as('admin', (c) => org.createOrgUnit(c, { id: 'battery-team', name: '电池团队', parentId: 'vehicle-rd' }));
      w.as('admin', (c) => org.createOrgUnit(c, { id: 'power-team', name: '动力团队', parentId: 'vehicle-rd' }));
      w.as('admin', (c) => org.createOrgUnit(c, { id: 'hmi-team', name: 'HMI 团队', parentId: 'vehicle-rd' }));
      w.eq(
        org.unitPath(w.s, 'brake-team').map((u) => u.id),
        ['company', 'vehicle-rd', 'chassis', 'brake-team'],
        'stable parent chain',
      );
      w.fails('ORG_CYCLE', () => w.as('admin', (c) => org.updateOrgUnit(c, 'chassis', { parentId: 'brake-team' })));
      w.fails('NOT_FOUND', () => w.as('admin', (c) => org.createOrgUnit(c, { id: 'orphan', name: '孤立', parentId: 'nowhere' })));
    },
  },
  A04: {
    adaptation: '跨组只读引用在 Kairoz 中按数据项申请与批准；此时还没有数据项，“读取不等于修改”由 T-N07 验证。',
    run: (w) => {
      for (const [id, code, name, domain, unit] of [
        ['brake', 'chassis.brake', '制动组', 'Chassis', 'brake-team'],
        ['battery', 'battery.pack', '电池组', 'Battery', 'battery-team'],
        ['power', 'power.drive', '动力组', 'Powertrain', 'power-team'],
        ['hmi', 'hmi.cluster', 'HMI 组', 'HMI', 'hmi-team'],
      ] as const) {
        w.as('admin', (c) => org.createGroup(c, { id, code, name, domain, purpose: 'DEV', orgUnitId: unit }));
      }
      w.eq(w.s.groups.brake!.orgUnitId, 'brake-team', 'each group has its maintaining unit');
      // A nested code would let one group claim another's policy namespace.
      w.fails('GROUP_CODE_NESTED', () => w.as('admin', (c) => org.createGroup(c, { id: 'brake-sub', code: 'chassis.brake.abs', name: '嵌套', domain: 'Chassis', purpose: 'DEV', orgUnitId: 'brake-team' })));
    },
  },
  A05: {
    run: (w) => {
      w.as('admin', (c) => org.createVehicleModel(c, { id: 'X89', name: 'X89' }));
      for (const [ws, unit, group, scope, name] of [
        ['team-brake', 'brake-team', 'brake', 'Chassis', '制动团队工作区'],
        ['team-battery', 'battery-team', 'battery', 'Battery', '电池团队工作区'],
        ['team-power', 'power-team', 'power', 'Powertrain', '动力团队工作区'],
      ] as const) {
        w.as('admin', (c) => org.createWorkspace(c, { id: ws, name, kind: 'TEAM', orgUnitId: unit, vehicleModelId: 'X89', groupIds: [group], scopes: [scope], sourceWorkspaceIds: [] }));
      }
      w.eq(w.s.workspaces['team-brake']!.projectId, null, 'a team workspace needs no project');
      w.eq(Object.keys(w.s.projects), [], 'no project is invented');
    },
  },
  A06: {
    run: (w) => {
      account(w, 'business', '陈明', [grant('BUSINESS_DEV', ['team-brake'], { groups: ['brake'] })]);
      account(w, 'battery', '周宁', [grant('BUSINESS_DEV', ['team-battery'], { groups: ['battery'] })]);
      account(w, 'power', '孔亮', [grant('BUSINESS_DEV', ['team-power'], { groups: ['power'] })]);
      account(w, 'brake_tester', '王嘉宁', [grant('BUSINESS_TEST', ['team-brake'], { groups: ['brake'] })]);
      account(w, 'battery_tester', '周悦', [grant('BUSINESS_TEST', ['team-battery'], { groups: ['battery'] })]);
      account(w, 'power_tester', '孔然', [grant('BUSINESS_TEST', ['team-power'], { groups: ['power'] })]);
      account(w, 'workspace_manager', '周子墨', [grant('WORKSPACE_ADMIN', ['team-brake'], {})]);
      account(w, 'dcl', '林书涵', [grant('DCL_ENGINEER', ['*'], { groups: ['*'] }, ALL)]);
      account(w, 'resource', '刘子衡', [grant('VEHICLE_RESOURCE', ['*'], { scopes: ['Vehicle', 'Chassis', 'Battery', 'Powertrain', 'HMI'] }, ALL)]);
      for (const [user, ws] of [
        ['business', 'team-brake'],
        ['battery', 'team-battery'],
        ['power', 'team-power'],
        ['brake_tester', 'team-brake'],
        ['workspace_manager', 'team-brake'],
      ] as const) {
        w.check(workspaceAccess(w.s, w.actor(user)).some((a) => a.workspaceId === ws), `${user} enters ${ws}`);
      }
      w.denied('business', (c) => fleet.registerPhysical(c, { id: 'VEH-X', vin: 'LSDEMX89000000999', vehicleModelId: 'X89', env: 'development', pool: 'Chassis' }));
      w.check(!can(w, 'workspace_manager', 'feature.edit', { workspaceId: 'team-brake', groupId: 'brake' }), 'the workspace admin cannot edit policies');
    },
  },
  A07: {
    run: (w) => {
      w.as('admin', (c) => org.createProject(c, { id: 'x89', name: 'X89 项目', vehicleModelId: 'X89' }));
      for (const [id, name] of [
        ['x89-chassis', '底盘模块'],
        ['x89-battery', '电池模块'],
        ['x89-power', '动力模块'],
        ['x89-hmi', 'HMI 模块'],
        ['x89-integration-test', '整车集成测试组'],
      ] as const) {
        w.as('admin', (c) => org.createOrgUnit(c, { id, name, parentId: 'x89' }));
      }
      w.as('admin', (c) =>
        org.createWorkspace(c, {
          id: 'x89-project',
          name: 'X89 项目研发',
          kind: 'PROJECT',
          orgUnitId: 'x89',
          vehicleModelId: 'X89',
          groupIds: ['brake', 'battery', 'power', 'hmi'],
          scopes: ['Vehicle', 'Chassis', 'Battery', 'Powertrain', 'HMI'],
          sourceWorkspaceIds: ['team-brake', 'team-battery', 'team-power'],
        }),
      );
      w.as('admin', (c) =>
        org.createWorkspace(c, { id: 'x89-integration', name: 'X89 集成测试', kind: 'INTEGRATION', orgUnitId: 'x89-integration-test', vehicleModelId: 'X89', groupIds: [], scopes: ['Vehicle'], sourceWorkspaceIds: ['x89-project'] }),
      );
      account(w, 'integrator', '赵一鸣', [grant('CONFIG_INTEGRATOR', ['x89-project', 'x89-integration'], { scopes: ['Vehicle'] })]);
      account(w, 'chassis_integrator', '钱立', [grant('CONFIG_INTEGRATOR', ['x89-project'], { scopes: ['Chassis'] })]);
      account(w, 'integration_tester', '钱思源', [grant('INTEGRATION_TEST', ['x89-integration'], { scopes: ['Vehicle'] }, ['testing'])]);
      account(w, 'dispatch_operator', '何下发', [grant('BUSINESS_TEST', ['team-brake'], { groups: ['brake'] }, DEV_TEST, true)]);
      account(w, 'release', '孙立', [grant('CONFIG_RELEASE', ['x89-project', 'x89-integration'], { scopes: ['Vehicle'] }, ALL)]);
      w.eq(
        workspaceAccess(w.s, w.actor('integrator')).map((a) => a.workspaceId).sort(),
        ['x89-integration', 'x89-project'],
        'the integrator switches between project and integration workspaces',
      );
      w.eq(org.unitPath(w.s, w.s.workspaces['x89-project']!.orgUnitId).map((u) => u.id), ['x89'], 'project workspaces show the project tree');
      w.eq(org.unitPath(w.s, w.s.workspaces['team-brake']!.orgUnitId)[0]!.id, 'company', 'team workspaces show the team tree');
    },
  },
  A08: {
    run: (w) => {
      const pipe = (code: string, side: 'EDGE' | 'CLOUD', formats: string[]) =>
        w.as('dcl', (c) => createPipeline(c, { code, side, name: code, formats, steps: side === 'EDGE' ? ['Locate', 'Snapshot', 'Compress', 'Encrypt', 'Upload'] : ['Receive', 'Checksum', 'Decrypt', 'RawStore', 'Index'] }));
      for (const [fileType, format, sensitive] of [
        ['text_log', 'text', false],
        ['can_log', 'mcap', false],
        ['camera_image', 'image', true],
        ['pointcloud', 'pointcloud', true],
        ['gnss', 'jsonl', true],
      ] as const) {
        const code = fileType.replace('_', '-');
        const edge = pipe(`default-edge-${code}`, 'EDGE', [format]);
        const cloud = pipe(`default-cloud-${code}`, 'CLOUD', [format]);
        w.as('dcl', (c) => createTemplate(c, { fileType, format, schema: `opaque-${code}@1`, edgePipelineId: edge, cloudPipelineId: cloud, defaultRetentionDays: 30, requiresReview: sensitive }));
      }
      w.check(currentTemplate(w.s, 'text_log') && currentTemplate(w.s, 'can_log'), 'ordinary logs have default templates');
      w.check(currentTemplate(w.s, 'camera_image')?.requiresReview, 'sensitive types require review');
      w.check(!currentTemplate(w.s, 'unknown'), 'unknown formats stay unconfigured');
      w.as('dcl', (c) => fleet.registerImage(c, { id: 'x89-dev-r1', vehicleModelId: 'X89', integrationVersion: null, build: 'x89-dev-r1', digest: sha('x89-dev-r1'), simulator: 'SimOne 3' }));
      w.eq(w.s.images['x89-dev-r1']!.integrationVersion, null, 'an image without a formal vehicle version is valid');
    },
  },
  A09: {
    run: (w) => {
      w.as('workspace_manager', (c) => fleet.createSimulation(c, { id: 'SIM-901', workspaceId: 'team-brake', imageId: 'x89-dev-r1', env: 'development', pool: 'Chassis', displayName: '制动仿真 901' }));
      const r = w.s.resources['SIM-901']!;
      w.eq([r.integrationVersion, r.vin, r.homeWorkspaceId], [null, null, 'team-brake'], 'no software version, no VIN, home team-brake');
    },
  },
  A10: {
    adaptation: '演示 VIN 使用合法的 17 位格式（不含 I/O/Q）。',
    run: (w) => {
      w.as('resource', (c) => fleet.registerPhysical(c, { id: 'VEH-901', vin: 'LSDEMX89000000901', vehicleModelId: 'X89', env: 'development', pool: 'Chassis', displayName: '制动研发车 901' }));
      w.eq(w.s.resources['VEH-901']!.integrationVersion, null, 'unknown software stays unknown');
      w.eq(w.s.resources['VEH-901']!.appliedConfigId, null, 'registering is neither flashing nor applying');
      w.fails('VIN_TAKEN', () => w.as('resource', (c) => fleet.registerPhysical(c, { id: 'VEH-90X', vin: 'LSDEMX89000000901', vehicleModelId: 'X89', env: 'development', pool: 'Chassis' })));
      w.fails('ID_TAKEN', () => w.as('resource', (c) => fleet.registerPhysical(c, { id: 'VEH-901', vin: 'LSDEMX89000000911', vehicleModelId: 'X89', env: 'development', pool: 'Chassis' })));
    },
  },
  A11: {
    run: (w) => {
      w.as('workspace_manager', (c) => fleet.addWorkspaceVehicle(c, 'team-brake', 'VEH-901'));
      w.ref.devGroup = w.as('workspace_manager', (c) => fleet.createVehicleGroup(c, { workspaceId: 'team-brake', groupId: 'brake', name: '制动研发车组', purpose: 'DEV', env: 'development' }));
      w.ref.testGroup = w.as('workspace_manager', (c) => fleet.createVehicleGroup(c, { workspaceId: 'team-brake', groupId: 'brake', name: '制动测试车组', purpose: 'TEST', env: 'development' }));
      w.as('workspace_manager', (c) => fleet.addGroupMember(c, w.ref.devGroup!, 'SIM-901', '仿真验证'));
      w.as('workspace_manager', (c) => fleet.addGroupMember(c, w.ref.testGroup!, 'VEH-901', '实车验证'));
      w.eq(
        fleet.workspaceVehicles(w.s, 'team-brake').map((r) => [r.id, r.integrationVersion, r.appliedConfigId]),
        [
          ['SIM-901', null, null],
          ['VEH-901', null, null],
        ],
        'the team sees both vehicles with empty software and configuration',
      );
      for (const r of ['SIM-901', 'VEH-901']) w.as('workspace_manager', (c) => fleet.reserveVehicle(c, 'team-brake', r, '制动首版验证'));
      const sim = w.s.resources['SIM-901']!;
      if (sim.instance !== 'RUNNING') w.as('workspace_manager', (c) => fleet.startSimulation(c, 'SIM-901'));
      w.eq([w.s.resources['SIM-901']!.instance, sim.agent.online, w.s.resources['VEH-901']!.agent.online], ['RUNNING', true, true], 'running and connected');
      w.check(w.s.resources['VEH-901']!.reservation?.purpose === '制动首版验证', 'reserved for the team test');
    },
  },
  B01: {
    run: (w) => {
      w.check(fleet.workspaceVehicles(w.s, 'team-brake').every((r) => r.vehicleModelId === 'X89'), 'team vehicles are listed');
      w.ref.firstBrake = w.as('business', (c) => config.createFeature(c, { workspaceId: 'team-brake', groupId: 'brake', name: 'first_brake', description: '首版制动诊断' }));
      w.eq(w.s.features[w.ref.firstBrake]!.baseReleaseId, null, 'no release yet: the initial development configuration');
    },
  },
  B02: {
    run: (w) => {
      const f = w.ref.firstBrake!;
      w.ref.debugKey = w.as('business', (c) => config.addFile(c, f, { source: { unit: 'ADC', directory: '/data/brake', pattern: 'debug.log' }, name: '制动诊断日志', purpose: '制动诊断' }));
      const spec = w.s.features[f]!.draft.files[w.ref.debugKey]!;
      const template = currentTemplate(w.s, 'text_log')!;
      w.eq([spec.fileType, spec.edgePipelineId, spec.cloudPipelineId], ['text_log', template.edgePipelineId, template.cloudPipelineId], 'one data_key with both fixed bindings');
      w.eq(spec.requiresReview, false, 'ordinary content matches the approved template');
    },
  },
  B03: {
    run: (w) => {
      const f = w.ref.firstBrake!;
      w.as('business', (c) =>
        config.putPolicy(c, f, 'chassis.brake.pressure_speed', { name: '制动压力异常', trigger: 'brake_pressure > 80 AND vehicle_speed > 30', captures: [w.ref.debugKey!], preSeconds: 10, postSeconds: 20 }),
      );
      const r = w.as('business', (c) => config.submitFeature(c, f, { message: '首版制动诊断' }));
      w.eq(r.stage, 'DCL_READY', 'checks pass; testable without a manual DCL mark');
      w.ref.firstBrakeR1 = r.commitId;
    },
  },
  B04: {
    run: (w) => {
      const f = w.ref.firstBrake!;
      const d = w.as('brake_tester', (c) => v.dispatchFeature(c, f, { commitId: w.ref.firstBrakeR1!, vehicleGroupIds: [w.ref.devGroup!] }));
      w.eq(w.s.deployments[d]!.targets.map((t) => [t.resourceId, t.status]), [['SIM-901', 'PENDING']], 'a frozen member snapshot, pending');
      w.eq(w.s.resources['SIM-901']!.appliedConfigId, null, 'nothing applied before the receipt');
      w.fails('NOT_APPLIED', () => w.as('brake_tester', (c) => v.recordFeatureTest(c, f, { commitId: w.ref.firstBrakeR1!, resourceId: 'SIM-901', result: 'PASS', summary: 'x' })));
      answerAll(w, d);
      recordPasses(w, 'brake_tester', f, ['SIM-901'], '仿真制动压力场景通过');
      const run = w.s.testRuns.at(-1)!;
      w.eq([run.versionId, run.resolvedConfigId], [w.ref.firstBrakeR1, w.s.resources['SIM-901']!.appliedConfigId], 'evidence names the commit and the applied configuration');
    },
  },
  B05: {
    run: (w) => {
      const f = w.ref.firstBrake!;
      dispatchApplied(w, 'brake_tester', f, [w.ref.testGroup!]);
      recordPasses(w, 'brake_tester', f, ['VEH-901'], '实车制动压力场景通过');
      w.as('brake_tester', (c) => v.verifyFeature(c, f));
      w.eq(w.s.features[f]!.stage, 'VERIFIED', 'verified on current evidence only');
    },
  },
  B06: {
    run: (w) => {
      for (const r of ['SIM-901', 'VEH-901']) w.eq(fleet.pendingDeploymentOf(w.s, r), undefined, `${r} is free again`);
      for (const r of ['SIM-901', 'VEH-901']) w.as('workspace_manager', (c) => fleet.releaseReservation(c, 'team-brake', r));
      w.as('workspace_manager', (c) => fleet.stopSimulation(c, 'SIM-901'));
      w.eq([w.s.resources['SIM-901']!.instance, w.s.resources['VEH-901']!.reservation], ['STOPPED', null], 'idle simulation stopped, reservations released');
      w.check(w.s.testRuns.length === 2 && w.s.receipts.length === 2, 'tests and receipts stay as evidence');
    },
  },
  C01: {
    run: (w) => {
      const f = w.as('business', (c) => config.createFeature(c, { workspaceId: 'team-brake', groupId: 'brake', name: 'brake_camera', description: '制动场景前视图像' }));
      w.ref.camera = f;
      w.ref.cameraKey = w.as('business', (c) =>
        config.addFile(c, f, { source: { unit: 'ADC', directory: '/data/camera/front', pattern: 'front_*.jpg' }, name: '前视图像', purpose: '复核急刹前方障碍' }),
      );
      const spec = w.s.features[f]!.draft.files[w.ref.cameraKey]!;
      w.check(spec.requiresReview && spec.edgePipelineId && spec.cloudPipelineId, 'file and both bindings exist, review required');
      w.as('business', (c) => config.putPolicy(c, f, 'chassis.brake.front_obstacle', { name: '急刹前方障碍', trigger: 'brake_pressure > 90', captures: [w.ref.cameraKey!], preSeconds: 5, postSeconds: 5 }));
      w.eq(w.as('business', (c) => config.submitFeature(c, f, { message: '前视图像' })).stage, 'SUBMITTED', 'waits for review');
      w.fails('NOT_DCL_READY', () => w.as('brake_tester', (c) => v.dispatchFeature(c, f, { commitId: w.s.features[f]!.headCommitId!, vehicleGroupIds: [w.ref.devGroup!] })));
    },
  },
  C02: {
    run: (w) => {
      const f = w.ref.camera!;
      w.check(intakeQueue(w.s, w.actor('dcl')).features.some((x) => x.feature.id === f), 'the commit is in the DCL intake queue');
      w.as('dcl', (c) => reviewFile(c, f, { commitId: w.s.features[f]!.headCommitId!, dataKey: w.ref.cameraKey!, decision: 'REJECTED', reason: '采集范围过大：需限制为触发窗口内前视单帧' }));
      w.eq(w.s.features[f]!.stage, 'DRAFT', 'rejected: returned to the authors with the reason');
      w.check(w.s.feedback.some((x) => x.featureId === f && x.reason.includes('采集范围')), 'the reason reaches the authors');
    },
  },
  C03: {
    run: (w) => {
      const f = w.ref.camera!;
      const before = w.s.features[f]!.headCommitId!;
      w.as('business', (c) => config.updateFile(c, f, w.ref.cameraKey!, { purpose: '仅触发窗口内前视单帧，复核急刹前方障碍', retentionDays: 14 }));
      // DCL adjusts the dedicated processing on the technical side.
      const t = currentTemplate(w.s, 'camera_image')!;
      w.as('dcl', (c) => setBinding(c, f, w.ref.cameraKey!, { format: t.format, schema: t.schema, edgePipelineId: t.edgePipelineId, cloudPipelineId: t.cloudPipelineId, reason: '确认使用默认图像处理' }));
      const r1 = w.as('business', (c) => config.submitFeature(c, f, { message: '缩小采集范围' }));
      w.check(r1.commitId !== before && r1.stage === 'SUBMITTED', 'a new commit, back in review');
      w.as('dcl', (c) => reviewFile(c, f, { commitId: r1.commitId, dataKey: w.ref.cameraKey!, decision: 'APPROVED', reason: '范围与保留符合要求', controls: CONTROLS }));
      w.eq(w.s.features[f]!.stage, 'DCL_READY', 'approved');
      // An approval covers only the reviewed content.
      w.as('business', (c) => config.updateFile(c, f, w.ref.cameraKey!, { retentionDays: 30 }));
      const r2 = w.as('business', (c) => config.submitFeature(c, f, { message: '延长保留' }));
      w.eq(r2.stage, 'SUBMITTED', 'changed content needs a new approval');
      w.as('dcl', (c) => reviewFile(c, f, { commitId: r2.commitId, dataKey: w.ref.cameraKey!, decision: 'APPROVED', reason: '保留 30 天可接受', controls: CONTROLS }));
      w.check(w.s.commits[before] && w.s.commits[r1.commitId], 'history is immutable');
    },
  },
  C04: {
    adaptation: '脱敏与上传边界没有真实算子；测试人员在模拟回执生效后登记基于合成样本的结论。仿真在 B06 停止，前置条件“授权仿真可用”由工作区管理员重新启动。',
    run: (w) => {
      const f = w.ref.camera!;
      w.as('workspace_manager', (c) => fleet.startSimulation(c, 'SIM-901'));
      dispatchApplied(w, 'brake_tester', f, [w.ref.devGroup!]);
      recordPasses(w, 'brake_tester', f, ['SIM-901'], '合成图像样本：仅窗口内单帧上传');
    },
  },
  C05: {
    run: (w) => {
      const f = w.ref.camera!;
      dispatchApplied(w, 'brake_tester', f, [w.ref.testGroup!]);
      recordPasses(w, 'brake_tester', f, ['VEH-901'], 'Mock 实车验证通过');
      w.as('brake_tester', (c) => v.verifyFeature(c, f));
      const feature = w.s.features[f]!;
      const approval = reviewItems(w.s, commitSnapshot(w.s, feature.headCommitId!), { groupId: 'brake', workspaceId: 'team-brake' })[0];
      w.eq([feature.stage, approval?.status], ['VERIFIED', 'APPROVED'], 'evidence binds commit, approval and applied configuration');
    },
  },
  D01: {
    run: (w) => {
      w.eq(w.s.workspaces['x89-project']!.sourceWorkspaceIds, ['team-brake', 'team-battery', 'team-power'], 'declared sources');
      // The testing pool is missing: vehicle resources register and assign it.
      w.as('resource', (c) => fleet.registerPhysical(c, { id: 'VEH-902', vin: 'LSDEMX89000000902', vehicleModelId: 'X89', env: 'testing', pool: 'Vehicle', displayName: '集成测试车 902' }));
      w.as('resource', (c) => fleet.createSimulation(c, { id: 'SIM-902', workspaceId: 'x89-integration', imageId: 'x89-dev-r1', env: 'testing', pool: 'Vehicle', displayName: '集成仿真 902' }));
      w.as('resource', (c) => fleet.addWorkspaceVehicle(c, 'x89-integration', 'VEH-902'));
      w.eq(w.s.resources['SIM-902']!.instance, 'RUNNING', 'the simulation instance runs');
      w.ref.integrationGroup = w.as('release', (c) => fleet.createVehicleGroup(c, { workspaceId: 'x89-integration', groupId: null, name: 'X89 集成测试车组', purpose: 'TEST', env: 'testing' }));
      for (const r of ['SIM-902', 'VEH-902']) w.as('release', (c) => fleet.addGroupMember(c, w.ref.integrationGroup!, r, '集成候选验证'));
      w.check(fleet.workspaceVehicles(w.s, 'x89-integration').every((r) => r.env === 'testing'), 'testing vehicles only');
    },
  },
  D02: {
    adaptation: '电池、动力的 Verified 提交没有对应的幕；由前置夹具补齐（平台运维为 workspace_manager 增加电池/动力工作区授权，团队登记仿真与实车并完成业务验证），其中电池两个 Feature 定义同一策略、内容不同，用于检验冲突。',
    run: (w) => {
      // Precondition fixture: battery and power Verified commits.
      w.as('admin', (c) => replaceGrants(c, 'workspace_manager', [grant('WORKSPACE_ADMIN', ['team-brake', 'team-battery', 'team-power'], {})]));
      for (const [team, pool, sim, veh, vin] of [
        ['battery', 'Battery', 'SIM-911', 'VEH-911', 'LSDEMX89000000921'],
        ['power', 'Powertrain', 'SIM-912', 'VEH-912', 'LSDEMX89000000922'],
      ] as const) {
        w.as('workspace_manager', (c) => fleet.createSimulation(c, { id: sim, workspaceId: `team-${team}`, imageId: 'x89-dev-r1', env: 'development', pool }));
        w.as('resource', (c) => fleet.registerPhysical(c, { id: veh, vin, vehicleModelId: 'X89', env: 'development', pool }));
        w.as('workspace_manager', (c) => fleet.addWorkspaceVehicle(c, `team-${team}`, veh));
        const g = w.as('workspace_manager', (c) => fleet.createVehicleGroup(c, { workspaceId: `team-${team}`, groupId: team, name: `${team} 研发车组`, purpose: 'DEV', env: 'development' }));
        w.as('workspace_manager', (c) => fleet.addGroupMember(c, g, sim, '验证'));
        w.as('workspace_manager', (c) => fleet.addGroupMember(c, g, veh, '验证'));
        w.ref[`${team}Group`] = g;
      }
      const soc = simpleFeature(w, 'battery', { workspaceId: 'team-battery', groupId: 'battery', name: 'battery_soc', unit: 'BMS', directory: '/data/bms', pattern: 'soc.log', fileName: 'SOC 日志', policyId: 'battery.pack.soc_drop', policyName: 'SOC 骤降', trigger: 'soc_drop_rate > 5' });
      const temp = simpleFeature(w, 'battery', { workspaceId: 'team-battery', groupId: 'battery', name: 'battery_temp', unit: 'BMS', directory: '/data/bms', pattern: 'temp.log', fileName: '电芯温度', policyId: 'battery.pack.soc_drop', policyName: 'SOC 骤降（温度）', trigger: 'soc_drop_rate > 5 AND cell_temp > 50' });
      const torque = simpleFeature(w, 'power', { workspaceId: 'team-power', groupId: 'power', name: 'power_torque', unit: 'VCU', directory: '/data/vcu', pattern: 'torque.log', fileName: '扭矩日志', policyId: 'power.drive.torque_jump', policyName: '扭矩突变', trigger: 'torque_rate > 400' });
      Object.assign(w.ref, { batterySoc: soc.featureId, batteryTemp: temp.featureId, powerTorque: torque.featureId });
      verifyFeatureOn(w, 'battery_tester', soc.featureId, [w.ref.batteryGroup!]);
      verifyFeatureOn(w, 'battery_tester', temp.featureId, [w.ref.batteryGroup!]);
      verifyFeatureOn(w, 'power_tester', torque.featureId, [w.ref.powerGroup!]);

      // The scene: preview every current Verified commit.
      const sources = integ.verifiedSources(w.s, 'x89-project').map((f) => f.name).sort();
      w.eq(sources, ['battery_soc', 'battery_temp', 'brake_camera', 'first_brake', 'power_torque'], 'all current Verified commits are collectible');
      const plan = w.as('integrator', (c) => integ.previewMerge(c, { workspaceId: 'x89-project', featureIds: integ.verifiedSources(w.s, 'x89-project').map((f) => f.id) }));
      w.ref.conflictPlan = plan;
      const p = w.s.mergePlans[plan]!;
      w.eq(p.status, 'CONFLICT', 'the same policy defined two ways is a conflict, never silently overwritten');
      w.eq(p.conflicts.map((c) => [c.groupId, c.key, c.owner]), [['battery', 'battery.pack.soc_drop', 'BUSINESS']], 'the conflict names group, item and owner');
      w.check(p.merged.brake && p.merged.power, 'other groups merge cleanly');
      const groups = Object.fromEntries(integ.planGroups(w.s, p).map((g) => [g.groupId, g.change]));
      w.eq(groups, { battery: 'ADDED', brake: 'ADDED', hmi: 'EMPTY', power: 'ADDED' }, 'Added / Changed / Removed / Inherited per group; HMI unchanged');
    },
  },
  D03: {
    run: (w) => {
      const temp = w.ref.batteryTemp!;
      const old = w.s.features[temp]!.headCommitId!;
      // Integration never rewrites a maintainer's content.
      w.denied('integrator', (c) => config.putPolicy(c, temp, 'battery.pack.soc_drop', { name: 'x', trigger: 'soc_drop_rate > 5', captures: [], preSeconds: 1, postSeconds: 1 }));
      // The maintainer resolves it: the temperature case becomes its own policy.
      const p = w.s.features[temp]!.draft.policies['battery.pack.soc_drop']!;
      w.as('battery', (c) => config.removePolicy(c, temp, 'battery.pack.soc_drop'));
      w.as('battery', (c) => config.putPolicy(c, temp, 'battery.pack.cell_overheat', { ...p, name: '电芯过温' }));
      const r = w.as('battery', (c) => config.submitFeature(c, temp, { message: '温度场景改为独立策略' }));
      w.check(r.commitId !== old && w.s.commits[old], 'a new commit; the old one stays');
      w.check(v.verifyBlockers(w.s, w.s.features[temp]!).length > 0, 'old tests no longer verify the new commit');
    },
  },
  D04: {
    run: (w) => {
      const temp = w.ref.batteryTemp!;
      w.check(!integ.verifiedSources(w.s, 'x89-project').some((f) => f.id === temp), 'not collectible before re-verification');
      verifyFeatureOn(w, 'battery_tester', temp, [w.ref.batteryGroup!]);
      w.fails('PLAN_NOT_READY', () => w.as('integrator', (c) => integ.freezeCandidate(c, w.ref.conflictPlan!, { label: 'X89-C1' })));
      const plan = w.as('integrator', (c) => integ.previewMerge(c, { workspaceId: 'x89-project', featureIds: integ.verifiedSources(w.s, 'x89-project').map((f) => f.id) }));
      w.eq([w.s.mergePlans[plan]!.status, w.s.mergePlans[w.ref.conflictPlan!]!.status], ['READY', 'SUPERSEDED'], 'a new preview; the conflict plan cannot be frozen');
      w.ref.plan = plan;
    },
  },
  D05: {
    run: (w) => {
      const plan = w.s.mergePlans[w.ref.plan!]!;
      const lines = integ.processingSummary(w.s, plan);
      w.check(lines.some((l) => l.requiresReview && l.review?.status === 'APPROVED'), 'the sensitive camera file carries its approval');
      w.as('dcl', (c) => integ.confirmProcessing(c, plan.id, { note: '最终处理集合确认' }));
      w.check(integ.isConfirmed(w.s, w.s.mergePlans[plan.id]!), 'the confirmation binds the set digest');
    },
  },
  D06: {
    run: (w) => {
      w.ref.candidate = w.as('integrator', (c) => integ.freezeCandidate(c, w.ref.plan!, { label: 'X89-C1' }));
      const cand = w.s.candidates[w.ref.candidate]!;
      w.eq(v.candidateTestStatus(w.s, cand), [], 'no Feature PASS is inherited');
      w.eq(cand.sources.length, 5, 'the source list is frozen');
    },
  },
  D07: {
    needs: ['D01', 'D06'],
    run: (w) => {
      const cand = w.ref.candidate!;
      w.fails('DISPATCH_BLOCKED', () => w.as('integration_tester', (c) => v.dispatchCandidate(c, cand, { vehicleGroupIds: [w.ref.devGroup!] })));
      const d = w.as('integration_tester', (c) => v.dispatchCandidate(c, cand, { vehicleGroupIds: [w.ref.integrationGroup!] }));
      answerAll(w, d);
      for (const r of ['SIM-902', 'VEH-902']) w.as('integration_tester', (c) => v.recordCandidateTest(c, cand, { resourceId: r, result: 'PASS', summary: '整车独立回归' }));
      w.as('integration_tester', (c) => v.verifyCandidate(c, cand));
      const c = w.s.candidates[cand]!;
      w.eq([c.status, w.s.resources['VEH-902']!.appliedConfigId], ['VERIFIED', c.resolvedConfigId], 'candidate digest, applied set and evidence agree');
    },
  },
  E01: {
    run: (w) => {
      w.as('resource', (c) => fleet.recordSoftwareVersion(c, { vehicleModelId: 'X89', version: '1.0', source: '外部软件集成发布 X89-1.0（Mock 记录）' }));
      w.as('resource', (c) => fleet.registerImage(c, { id: 'x89-1.0', vehicleModelId: 'X89', integrationVersion: '1.0', build: 'x89-1.0.0', digest: sha('x89-1.0'), simulator: 'SimOne 3' }));
      for (const [id, vin] of [
        ['VEH-951', 'LSDEMX89000000951'],
        ['VEH-952', 'LSDEMX89000000952'],
      ] as const) {
        w.as('resource', (c) => fleet.registerPhysical(c, { id, vin, vehicleModelId: 'X89', env: 'production', pool: 'Vehicle' }));
        w.as('resource', (c) => fleet.reportControllers(c, id, { target: '1.0', source: 'DIP 上报（Mock）', controllers: CONSISTENT_1_0 }));
      }
      w.as('resource', (c) => fleet.registerPhysical(c, { id: 'VEH-953', vin: 'LSDEMX89000000953', vehicleModelId: 'X89', env: 'production', pool: 'Vehicle' }));
      w.as('resource', (c) => fleet.reportControllers(c, 'VEH-953', { target: '1.0', source: 'DIP 上报（Mock）', controllers: [{ name: 'ADC', version: '1.0', status: 'PASS' }, { name: 'BMS', version: '0.9', status: 'FAIL' }] }));
      const partial = w.s.resources['VEH-953']!;
      w.eq([partial.softwareStatus, partial.integrationVersion], ['PARTIAL_FAILURE', null], 'a partial update claims no whole-vehicle version');
      w.check(rel.releaseFor(w.s, partial).problem?.includes('partial software update'), 'mixed ECU software is not a production target');
    },
  },
  E02: {
    needs: ['D07'],
    run: (w) => {
      const cand = w.ref.candidate!;
      w.denied('integrator', (c) => rel.promoteCandidate(c, cand, { dclVersion: '1.0.0', vehicleIntegrationVersions: ['1.0'] }));
      w.ref.release = w.as('release', (c) => rel.promoteCandidate(c, cand, { dclVersion: '1.0.0', vehicleIntegrationVersions: ['1.0'], notes: 'X89 首个正式 DCL' }));
      w.eq(w.s.resources['VEH-951']!.appliedConfigId, null, 'vehicles do not change on publishing');
      w.eq(w.s.resources['VEH-951']!.integrationVersion, '1.0', 'actual software is untouched');
    },
  },
  E03: {
    needs: ['E02'],
    run: (w) => {
      for (const r of ['VEH-951', 'VEH-952']) w.as('resource', (c) => fleet.addWorkspaceVehicle(c, 'x89-project', r));
      w.ref.prodGroup = w.as('release', (c) => fleet.createVehicleGroup(c, { workspaceId: 'x89-project', groupId: null, name: 'X89 量产车组', purpose: 'PRODUCTION', env: 'production' }));
      for (const r of ['VEH-951', 'VEH-952']) w.as('release', (c) => fleet.addGroupMember(c, w.ref.prodGroup!, r, '量产配置 OTA'));
      w.eq(rel.releaseFor(w.s, w.s.resources['VEH-951']!).release?.id, w.ref.release, 'the default target is the newest matching release');
      w.ref.ota = w.as('release', (c) => ota.createOta(c, { releaseId: w.ref.release!, vehicleGroupIds: [w.ref.prodGroup!], firstWave: ['VEH-951'] }));
      const d = w.s.deployments[w.ref.ota]!;
      w.eq(d.targets.map((t) => [t.resourceId, t.status]), [['VEH-951', 'PENDING'], ['VEH-952', 'QUEUED']], 'a fixed target snapshot');
      w.sys((c) => sendReceipt(c, d.id, 'VEH-951', 'APPLIED'));
      w.eq(w.s.resources['VEH-951']!.appliedConfigId, w.s.releases[w.ref.release!]!.resolvedConfigId, 'applied only after the receipt');
    },
  },
  E04: {
    needs: ['E03'],
    run: (w) => {
      w.as('release', (c) => ota.expandOta(c, w.ref.ota!, 'ALL'));
      w.sys((c) => sendReceipt(c, w.ref.ota!, 'VEH-952', 'FAILED', 'flash timeout'));
      w.eq(w.s.deployments[w.ref.ota!]!.status, 'PAUSED', 'a failure pauses the rollout');
      w.eq(w.s.resources['VEH-952']!.appliedConfigId, null, 'the failed vehicle keeps its confirmed configuration');
    },
  },
  E05: {
    needs: ['E03'],
    run: (w) => {
      const id = w.sys((c) => ev.captureEvent(c, { resourceId: 'VEH-951', policyId: 'chassis.brake.pressure_speed' }));
      w.sys((c) => ev.processEvent(c, id));
      const e = w.s.events[id]!;
      w.eq([e.releaseId, e.status, e.files.length], [w.ref.release, 'DONE', 1], 'the event keeps the configuration it ran under');
      w.check(e.files.every((f) => f.artifactUri && f.chunks.every((c) => c.received)), 'every chunk arrived; cloud artifacts exist');
      w.eq(e.callbacks.length, 1, 'the business callback was delivered');
      w.ref.event = id;
    },
  },
  F01: {
    needs: ['E04'],
    run: (w) => {
      const id = w.ref.ota!;
      // Paused: a vehicle asking again keeps what it confirmed; nothing chases the target.
      w.eq(ota.answerConfigRequest(w.s, 'VEH-952').reason, 'HELD', 'a paused rollout holds the vehicle');
      w.eq(ota.answerConfigRequest(w.s, 'VEH-952').configId, null, 'it keeps its confirmed configuration');
      w.as('release', (c) => ota.resumeOta(c, id));
      w.eq(ota.answerConfigRequest(w.s, 'VEH-952').reason, 'TASK', 'an explicit resume continues');
      const t = () => w.s.deployments[id]!.targets.find((x) => x.resourceId === 'VEH-952')!;
      w.eq([t().attempt, t().history.map((h) => h.status)], [1, ['FAILED']], 'a new attempt; the old failure is kept');
      w.fails('RECEIPT_CONFLICT', () => w.sys((c) => v.acceptReceipt(c, { deploymentId: id, resourceId: 'VEH-952', attempt: 0, result: 'APPLIED' })));
      w.fails('STALE_ATTEMPT', () => w.sys((c) => v.acceptReceipt(c, { deploymentId: id, resourceId: 'VEH-952', attempt: 2, result: 'APPLIED' })));
      w.sys((c) => sendReceipt(c, id, 'VEH-952', 'APPLIED'));
      w.eq(w.s.deployments[id]!.status, 'COMPLETED', 'the new success counts');
      // The first release has no earlier formal configuration to roll back to.
      w.fails('ROLLBACK_BLOCKED', () => w.as('release', (c) => ota.rollbackOta(c, id, '演练')));
      w.eq(ota.answerConfigRequest(w.s, 'VEH-952').configId, w.s.releases[w.ref.release!]!.resolvedConfigId, 'after completion the newest matching release');
    },
  },
  F02: {
    needs: ['E05'],
    run: (w) => {
      const e = w.s.events[w.ref.event!]!;
      const before = e.files[0]!.cloudPipelineId;
      const cloud = w.as('dcl', (c) => createPipeline(c, { code: 'default-cloud-text-log', side: 'CLOUD', name: 'text_log Cloud v2', formats: ['text'], steps: ['Receive', 'Checksum', 'Decrypt', 'RawStore', 'Index', 'Parse'] }));
      const t = currentTemplate(w.s, 'text_log')!;
      w.as('dcl', (c) => createTemplate(c, { fileType: 'text_log', format: 'text', schema: t.schema, edgePipelineId: t.edgePipelineId, cloudPipelineId: cloud, defaultRetentionDays: 30 }));
      w.eq(w.s.events[e.id]!.files[0]!.cloudPipelineId, before, 'the historical event keeps its pinned processing version');
      const failing = w.sys((c) => ev.captureEvent(c, { resourceId: 'VEH-951', policyId: 'chassis.brake.pressure_speed', failParse: true }));
      w.sys((c) => ev.processEvent(c, failing));
      w.as('dcl', (c) => ev.reprocessEvent(c, failing));
      w.sys((c) => tick(c));
      w.eq(w.s.events[failing]!.status, 'DONE', 'the failed node is retried with the same versions');
      const f = w.s.events[e.id]!.files[0]!;
      w.eq(w.sys((c) => ev.receiveChunk(c, e.id, f.dataKey, 0, f.chunks[0]!.sha256)), 'REPLAYED', 'a resent chunk is idempotent');
      w.fails('CHECKSUM_MISMATCH', () => w.sys((c) => ev.receiveChunk(c, e.id, f.dataKey, 0, 'sha256:tampered')));
      w.eq(w.sys((c) => ev.deliverCallback(c, e.id)), 'DUPLICATE', 'a repeated callback is not delivered twice');
      w.eq([w.s.events[e.id]!.callbacks.length, w.s.events[e.id]!.files[0]!.artifactUri], [1, f.artifactUri], 'one product, one callback');
    },
  },
  F03: {
    needs: ['E02'],
    run: (w) => {
      w.fails('FEATURE_IMMUTABLE', () => w.as('business', (c) => config.updateFile(c, w.ref.firstBrake!, w.ref.debugKey!, { purpose: 'x' })));
      const fix = w.as('business', (c) => config.createFeature(c, { workspaceId: 'team-brake', groupId: 'brake', name: 'first_brake_fix', description: '按售后反馈调整窗口' }));
      w.ref.firstBrakeFix = fix;
      w.eq(w.s.features[fix]!.baseReleaseId, w.ref.release, 'new work builds on DCL 1.0.0');
      const p = w.s.features[fix]!.draft.policies['chassis.brake.pressure_speed']!;
      w.as('business', (c) => config.putPolicy(c, fix, 'chassis.brake.pressure_speed', { ...p, postSeconds: 25 }));
      const r = w.as('business', (c) => config.submitFeature(c, fix, { message: '延长事后窗口' }));
      w.eq(r.stage, 'DCL_READY', 'a new commit, not Verified before testing');
      w.eq(w.as('business', (c) => config.submitFeature(c, fix, {})).reused, true, 'no change, no new version');
      w.check(w.s.testRuns.some((x) => x.subjectId === w.ref.firstBrake), 'old evidence stays');
    },
  },
  F04: {
    needs: ['F01'],
    run: (w) => {
      w.as('resource', (c) => fleet.reportControllers(c, 'VEH-952', { target: '1.0', source: '外部软件 OTA 回执', controllers: [{ name: 'ADC', version: '1.0', status: 'PASS' }, { name: 'BMS', version: '0.9', status: 'FAIL' }] }));
      w.eq([w.s.resources['VEH-952']!.softwareStatus, w.s.resources['VEH-952']!.integrationVersion], ['PARTIAL_FAILURE', null], 'the real state, not the expected version');
      w.eq(ota.answerConfigRequest(w.s, 'VEH-952').reason, 'BLOCKED', 'production waits until the software is consistent');
      w.as('resource', (c) => fleet.reportControllers(c, 'VEH-952', { target: '1.0', source: '外部 OTA 完成后的可信上报', controllers: CONSISTENT_1_0 }));
      w.eq(rel.releaseFor(w.s, w.s.resources['VEH-952']!).release?.id, w.ref.release, 'consistent again: eligible for DCL 1.0.0');
    },
  },
  F05: {
    needs: ['F03'],
    adaptation: '原型不建模仿真配额；“回收配额”以停止实例与解除预约体现。',
    run: (w) => {
      const fix = w.ref.firstBrakeFix!;
      const d = w.as('brake_tester', (c) => v.dispatchFeature(c, fix, { commitId: w.s.features[fix]!.headCommitId!, vehicleGroupIds: [w.ref.devGroup!] }));
      w.fails('VEHICLE_BUSY', () => w.as('workspace_manager', (c) => fleet.removeGroupMember(c, w.ref.devGroup!, 'SIM-901', '回收')));
      answerAll(w, d);
      w.fails('SIMULATION_RUNNING', () => w.as('workspace_manager', (c) => fleet.removeGroupMember(c, w.ref.devGroup!, 'SIM-901', '回收')));
      w.as('workspace_manager', (c) => fleet.stopSimulation(c, 'SIM-901'));
      w.as('workspace_manager', (c) => fleet.removeGroupMember(c, w.ref.devGroup!, 'SIM-901', '研发结束，回收'));
      w.fails('GROUP_HAS_MEMBERS', () => w.as('workspace_manager', (c) => fleet.archiveVehicleGroup(c, w.ref.testGroup!, '结束')));
      w.as('workspace_manager', (c) => fleet.archiveVehicleGroup(c, w.ref.devGroup!, '研发结束'));
      w.check(w.s.vehicleGroupEvents.some((x) => x.vehicleGroupId === w.ref.devGroup && x.kind === 'MEMBER_REMOVED'), 'history and snapshots stay');
    },
  },
  F06: {
    run: (w) => {
      w.as('admin', (c) => updateAccount(c, 'power', { status: 'DISABLED' }));
      w.fails('UNAUTHENTICATED', () => w.as('power', (c) => config.createFeature(c, { workspaceId: 'team-power', groupId: 'power', name: 'after_leave' })));
      w.as('admin', (c) => replaceGrants(c, 'battery', []));
      w.denied('battery', (c) => config.createFeature(c, { workspaceId: 'team-battery', groupId: 'battery', name: 'after_revoke' }));
      w.check(Object.values(w.s.commits).some((c) => c.author === 'power'), 'history keeps the original authors');
    },
  },
  F07: {
    adaptation: '原型以“导出 / 导入完整状态 JSON”代替数据库与存储备份恢复；监控接手不适用。',
    run: (w) => {
      const restored = new World(JSON.parse(JSON.stringify(w.s)) as State);
      for (const key of ['releases', 'receipts', 'events', 'audit', 'deployments'] as const) {
        w.eq(JSON.stringify(restored.s[key]), JSON.stringify(w.s[key]), `${key} survive the export / import round trip`);
      }
      w.notApplicable('隔离环境的数据库与存储备份恢复、恢复窗口与监控交接不属于浏览器原型');
    },
  },
};
