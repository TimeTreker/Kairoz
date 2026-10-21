// Starting states. A clean installation has only `admin`. The demo is built by running the same
// operations real users run, as the demo users, so it obeys every rule of the prototype.

import { produce } from 'immer';
import type { GrantInput } from '../domain/authz.ts';
import { createFeature, addFile, putPolicy, submitFeature } from './config.ts';
import { Engine } from './engine.ts';
import { createAccount, installAdmin } from './identity.ts';
import { createGroup, createOrgUnit, createProject, createVehicleModel, createWorkspace } from './org.ts';
import { createPipeline, createTemplate } from './processing.ts';
import { requestReference } from './references.ts';
import { emptyState } from './types.ts';
import type { State } from './types.ts';

export function cleanState(): State {
  return produce(emptyState(), (s) => {
    installAdmin(s, new Date().toISOString());
  });
}

const ALL_ENVS = ['development', 'testing', 'production'];
const DEV_TEST = ['development', 'testing'];

interface Team {
  group: string;
  code: string;
  groupName: string;
  unit: string;
  unitName: string;
  parent: string;
  domain: 'Chassis' | 'ADC' | 'CDC';
  developer: [string, string];
  tester: [string, string];
}

export const DEMO_TEAMS: Team[] = [
  { group: 'brake', code: 'chassis.brake', groupName: '制动组', unit: 'brake-team', unitName: '制动团队', parent: 'chassis', domain: 'Chassis', developer: ['business', '陈明'], tester: ['brake_tester', '王嘉宁'] },
  { group: 'steering', code: 'chassis.steering', groupName: '转向组', unit: 'steering-team', unitName: '转向团队', parent: 'chassis', domain: 'Chassis', developer: ['steering', '吴泽宇'], tester: ['steering_tester', '吴凡'] },
  { group: 'adc-parking', code: 'adc.parking', groupName: 'ADC 泊车应用组', unit: 'parking-team', unitName: '泊车团队', parent: 'adc', domain: 'ADC', developer: ['adc_parking', '张景然'], tester: ['adc_parking_tester', '张敏'] },
  { group: 'adc-system', code: 'adc.system', groupName: 'ADC 系统应用组', unit: 'adc-system-team', unitName: '系统应用团队', parent: 'adc', domain: 'ADC', developer: ['adc_system', '许文博'], tester: ['adc_system_tester', '许悦'] },
  { group: 'cdc-hmi', code: 'cdc.hmi', groupName: 'CDC HMI 组', unit: 'hmi-team', unitName: 'HMI 团队', parent: 'cdc', domain: 'CDC', developer: ['cdc_hmi', '林雨辰'], tester: ['cdc_hmi_tester', '林晓'] },
  { group: 'cdc-app', code: 'cdc.app', groupName: 'CDC 座舱应用组', unit: 'cabin-app-team', unitName: '座舱应用团队', parent: 'cdc', domain: 'CDC', developer: ['cdc_app', '吴思远'], tester: ['cdc_app_tester', '吴宁'] },
];

// Default RawStorage templates. RawStorage only stores raw files; it does not parse or de-identify.
const FILE_TYPE_FORMATS = [
  ['text_log', 'text'],
  ['bin_log', 'binary'],
  ['can_log', 'mcap'],
  ['camera_image', 'image'],
  ['camera_video', 'mp4'],
  ['pointcloud', 'pointcloud'],
  ['gnss', 'jsonl'],
  ['unknown', 'binary'],
] as const;

/** Builds the demo on top of a clean installation and returns the resulting state. */
export function demoState(): State {
  const engine = new Engine(cleanState());
  const admin = 'admin';
  const as = <R>(user: string, op: Parameters<Engine['run']>[1]) => engine.run(user, op) as R;

  as(admin, (c) => createVehicleModel(c, { id: 'X89', name: 'X89' }));
  as(admin, (c) => createVehicleModel(c, { id: 'X90', name: 'X90' }));
  for (const [id, name, parentId] of [
    ['company', '公司', null],
    ['vehicle-rd', '整车研发中心', 'company'],
    ['chassis', '底盘部门', 'vehicle-rd'],
    ['ai-center', 'AI 中心', 'company'],
    ['adc', 'ADC', 'ai-center'],
    ['cockpit', '座舱部门', 'vehicle-rd'],
    ['cdc', 'CDC', 'cockpit'],
  ] as const) {
    as(admin, (c) => createOrgUnit(c, { id, name, parentId }));
  }
  as(admin, (c) => createProject(c, { id: 'x89', name: 'X89 项目', vehicleModelId: 'X89' }));
  for (const [id, name] of [
    ['x89-chassis', '底盘模块'],
    ['x89-adc', '智驾模块（ADC）'],
    ['x89-cdc', '座舱模块（CDC）'],
    ['x89-integration-test', '整车集成测试组'],
  ] as const) {
    as(admin, (c) => createOrgUnit(c, { id, name, parentId: 'x89' }));
  }
  for (const t of DEMO_TEAMS) {
    as(admin, (c) => createOrgUnit(c, { id: t.unit, name: t.unitName, parentId: t.parent }));
    as(admin, (c) => createGroup(c, { id: t.group, code: t.code, name: t.groupName, domain: t.domain, purpose: 'DEV', orgUnitId: t.unit }));
    as(admin, (c) =>
      createWorkspace(c, {
        id: `team-${t.group}`,
        name: `${t.unitName}工作区`,
        kind: 'TEAM',
        orgUnitId: t.unit,
        vehicleModelId: 'X89',
        groupIds: [t.group],
        scopes: [t.domain],
        sourceWorkspaceIds: [],
      }),
    );
  }
  const teamWorkspaces = DEMO_TEAMS.map((t) => `team-${t.group}`);
  as(admin, (c) =>
    createWorkspace(c, {
      id: 'x89-project',
      name: 'X89 项目研发',
      kind: 'PROJECT',
      orgUnitId: 'x89',
      vehicleModelId: 'X89',
      groupIds: [],
      scopes: ['Vehicle', 'Chassis', 'ADC', 'CDC'],
      sourceWorkspaceIds: teamWorkspaces,
    }),
  );
  as(admin, (c) =>
    createWorkspace(c, {
      id: 'x89-integration',
      name: 'X89 集成测试',
      kind: 'INTEGRATION',
      orgUnitId: 'x89-integration-test',
      vehicleModelId: 'X89',
      groupIds: [],
      scopes: ['Vehicle'],
      sourceWorkspaceIds: ['x89-project'],
    }),
  );

  const account = (username: string, displayName: string, grants: Partial<GrantInput>[]) =>
    as(admin, (c) =>
      createAccount(c, {
        username,
        displayName,
        grants: grants.map((g) => ({ role: g.role!, workspaces: g.workspaces ?? [], groups: g.groups ?? [], scopes: g.scopes ?? [], envs: g.envs ?? DEV_TEST, dispatchOnly: g.dispatchOnly ?? false })),
      }),
    );
  for (const t of DEMO_TEAMS) {
    const ws = [`team-${t.group}`];
    account(t.developer[0], t.developer[1], [{ role: 'BUSINESS_DEV', workspaces: ws, groups: [t.group] }]);
    account(t.tester[0], t.tester[1], [{ role: 'BUSINESS_TEST', workspaces: ws, groups: [t.group] }]);
  }
  account('dispatch_operator', '何下发', [{ role: 'BUSINESS_TEST', workspaces: ['team-brake'], groups: ['brake'], dispatchOnly: true }]);
  account('dcl', '林书涵', [{ role: 'DCL_ENGINEER', workspaces: ['*'], groups: ['*'], envs: ALL_ENVS }]);
  account('workspace_manager', '周子墨', [{ role: 'WORKSPACE_ADMIN', workspaces: ['team-brake', 'team-steering'] }]);
  account('integrator', '赵一鸣', [{ role: 'CONFIG_INTEGRATOR', workspaces: ['x89-project', 'x89-integration'], scopes: ['Vehicle'] }]);
  account('integration_tester', '钱思源', [{ role: 'INTEGRATION_TEST', workspaces: ['x89-integration'], scopes: ['Vehicle'], envs: ['testing'] }]);
  account('release', '孙立', [{ role: 'CONFIG_RELEASE', workspaces: ['x89-project', 'x89-integration'], scopes: ['Vehicle'], envs: ALL_ENVS }]);
  account('resource', '刘子衡', [{ role: 'VEHICLE_RESOURCE', workspaces: ['*'], scopes: ['Vehicle', 'Chassis', 'ADC', 'CDC'], envs: ALL_ENVS }]);

  // DCL engineering publishes RawStorage pipelines and default templates for every file type.
  for (const [fileType, format] of FILE_TYPE_FORMATS) {
    const code = fileType.replaceAll('_', '-');
    const edge = as<string>('dcl', (c) =>
      createPipeline(c, { code: `default-edge-${code}`, side: 'EDGE', name: `${fileType} Edge`, formats: [format], steps: ['Locate', 'Snapshot', 'Compress', 'Encrypt', 'Upload'] }),
    );
    const cloud = as<string>('dcl', (c) =>
      createPipeline(c, { code: `default-cloud-${code}`, side: 'CLOUD', name: `${fileType} Cloud`, formats: [format], steps: ['Receive', 'Checksum', 'Decrypt', 'RawStore', 'Index'] }),
    );
    as('dcl', (c) => createTemplate(c, { fileType, format, schema: `opaque-${code}@1`, edgePipelineId: edge, cloudPipelineId: cloud, defaultRetentionDays: 30 }));
  }

  // A first brake Feature, submitted and DCL Ready.
  const brake = as<string>('business', (c) => createFeature(c, { workspaceId: 'team-brake', groupId: 'brake', name: 'guided_brake', description: '制动压力异常数据采集' }));
  const brakeKey = as<string>('business', (c) =>
    addFile(c, brake, { source: { unit: 'ADC', directory: '/var/log/brake', pattern: 'brake_debug.pb' }, name: '制动调试数据', purpose: '分析制动压力异常' }),
  );
  as('business', (c) =>
    putPolicy(c, brake, 'chassis.brake.hard_braking', {
      name: '急刹车',
      trigger: 'brake_pressure > 80 AND vehicle_speed > 30',
      captures: [brakeKey],
      preSeconds: 10,
      postSeconds: 20,
    }),
  );
  as('business', (c) => submitFeature(c, brake, { message: '首版制动采集' }));

  // A parking camera Feature waiting in the DCL intake queue for sensitive review.
  const parking = as<string>('adc_parking', (c) =>
    createFeature(c, { workspaceId: 'team-adc-parking', groupId: 'adc-parking', name: 'parking_camera', description: '泊车环视视频采集' }),
  );
  const videoKey = as<string>('adc_parking', (c) =>
    addFile(c, parking, { source: { unit: 'ADC', directory: '/data/camera/surround', pattern: 'surround_*.mp4' }, name: '环视视频', purpose: '复现自动泊车擦碰' }),
  );
  as('adc_parking', (c) =>
    putPolicy(c, parking, 'adc.parking.scrape_risk', {
      name: '泊车擦碰风险',
      trigger: 'apa.active AND min_obstacle_distance < 0.2',
      captures: [videoKey],
      preSeconds: 15,
      postSeconds: 5,
    }),
  );
  as('adc_parking', (c) => submitFeature(c, parking, { message: '环视视频首版' }));

  // Steering asks brake for read-only use of the brake debug data; brake has not decided yet.
  as('steering', (c) => requestReference(c, { dataKey: brakeKey, readerGroupId: 'steering', reason: '转向事件分析需要制动压力上下文' }));

  return produce(engine.getState(), (s) => {
    s.installation = 'DEMO';
  });
}
