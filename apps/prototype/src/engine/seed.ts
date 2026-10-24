// Starting states. A clean installation has only `admin`. The demo is built by running the same
// operations real users run, as the demo users, so it obeys every rule of the prototype.

import { produce } from 'immer';
import type { GrantInput } from '../domain/authz.ts';
import { createFeature, addFile, putPolicy, submitFeature } from './config.ts';
import { Engine } from './engine.ts';
import { createAccount, createGrantRule, installAdmin } from './identity.ts';
import { createGroup, createOrgUnit, createProject, createVehicleModel, createWorkspace } from './org.ts';
import { createPipeline, createTemplate } from './processing.ts';
import { requestReference } from './references.ts';
import { addGroupMember, addWorkspaceVehicle, confirmIntegration, createSimulation, createVehicleGroup, recordSoftwareVersion, registerImage, registerPhysical } from './fleet.ts';
import { registerDeviceKey } from './client-report.ts';
import { connectDirectory, hirePerson, syncIfChanged } from './company-directory.ts';
import { captureEvent, processEvent } from './events.ts';
import { confirmProcessing, freezeCandidate, previewMerge } from './integration.ts';
import { createOta } from './ota.ts';
import { promoteCandidate } from './release.ts';
import { devicePublicKey, provisionDevice, reportNow, restartClient, sendReceipt, upgradeClient } from './simulator.ts';
import { dispatchCandidate, dispatchFeature, recordCandidateTest, recordFeatureTest, verifyCandidate, verifyFeature } from './validation.ts';
import { sha256Hex } from '../domain/canonical.ts';
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

/**
 * What X89 software 1.0 and 1.1 provide (mock manifest, recorded with each version): the signals
 * the demo and the drills' triggers read and the data sources their files come from.
 */
const X89_MANIFEST = {
  signals: [
    'apa.active',
    'brake_fault_code',
    'brake_pressure',
    'cell_temp',
    'lane_offset',
    'min_obstacle_distance',
    'soc_drop_rate',
    'steering_angle_rate',
    'steering_return_rate',
    'torque_rate',
    'vehicle_deceleration',
    'vehicle_speed',
    'yaw_rate',
  ],
  sources: [
    { unit: 'ADC', directory: '/data' },
    { unit: 'ADC', directory: '/var/log' },
    { unit: 'BMS', directory: '/data/bms' },
    { unit: 'CDC', directory: '/data' },
    { unit: 'CDC', directory: '/var/log' },
    { unit: 'CHASSIS', directory: '/var/log' },
    { unit: 'VCU', directory: '/data/vcu' },
  ],
};

/** Builds the demo on top of a clean installation and returns the resulting state. */
export function demoState(): State {
  const engine = new Engine(cleanState());
  const admin = 'admin';
  const as = <R>(user: string, op: Parameters<Engine['run']>[1]) => engine.run(user, op) as R;

  as(admin, (c) => createVehicleModel(c, { id: 'X89', name: 'X89' }));
  as(admin, (c) => createVehicleModel(c, { id: 'X90', name: 'X90' }));
  // The team organization comes from the company directory (simulated): departments keep their
  // directory ids as unit ids. People are added once their accounts exist, so sync links them.
  engine.run(null, (c) =>
    connectDirectory(c, {
      departments: [
        { extId: 'company', name: '公司', parentExtId: null },
        { extId: 'vehicle-rd', name: '整车研发中心', parentExtId: 'company' },
        { extId: 'chassis', name: '底盘部门', parentExtId: 'vehicle-rd' },
        { extId: 'ai-center', name: 'AI 中心', parentExtId: 'company' },
        { extId: 'adc', name: 'ADC', parentExtId: 'ai-center' },
        { extId: 'cockpit', name: '座舱部门', parentExtId: 'vehicle-rd' },
        { extId: 'cdc', name: 'CDC', parentExtId: 'cockpit' },
        ...DEMO_TEAMS.map((t) => ({ extId: t.unit, name: t.unitName, parentExtId: t.parent })),
        { extId: 'chassis-test', name: '底盘测试组', parentExtId: 'chassis' },
        { extId: 'vehicle-integration', name: '整车集成与发布部', parentExtId: 'vehicle-rd' },
        { extId: 'vehicle-resources', name: '车辆资源部', parentExtId: 'vehicle-rd' },
        { extId: 'data-closed-loop', name: '数据闭环部', parentExtId: 'ai-center' },
      ],
      people: [],
    }),
  );
  engine.run(null, (c) => syncIfChanged(c));
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
  // ADC and CDC integrate their teams first (子系统集成), each in its own domain workspace that also
  // tests the subsystem candidates. The project then takes chassis Features directly and ADC/CDC
  // only through their subsystem releases.
  for (const [domain, unit, name] of [
    ['ADC', 'x89-adc', 'ADC 域集成'],
    ['CDC', 'x89-cdc', 'CDC 域集成'],
  ] as const) {
    const teams = DEMO_TEAMS.filter((t) => t.domain === domain);
    as(admin, (c) =>
      createWorkspace(c, {
        id: `x89-${domain.toLowerCase()}-integration`,
        name,
        kind: 'INTEGRATION',
        orgUnitId: unit,
        vehicleModelId: 'X89',
        groupIds: teams.map((t) => t.group),
        scopes: [domain],
        sourceWorkspaceIds: teams.map((t) => `team-${t.group}`),
      }),
    );
  }
  as(admin, (c) =>
    createWorkspace(c, {
      id: 'x89-project',
      name: 'X89 项目研发',
      kind: 'PROJECT',
      orgUnitId: 'x89',
      vehicleModelId: 'X89',
      groupIds: DEMO_TEAMS.map((t) => t.group),
      scopes: ['Vehicle', 'Chassis', 'ADC', 'CDC'],
      sourceWorkspaceIds: [...DEMO_TEAMS.filter((t) => t.domain === 'Chassis').map((t) => `team-${t.group}`), 'x89-adc-integration', 'x89-cdc-integration'],
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
  account('integration_admin', '郑书杰', [{ role: 'WORKSPACE_ADMIN', workspaces: ['x89-project', 'x89-integration'], envs: ['testing', 'production'] }]);
  account('integration_tester', '钱思源', [{ role: 'INTEGRATION_TEST', workspaces: ['x89-integration'], scopes: ['Vehicle'], envs: ['testing'] }]);
  account('release', '孙立', [{ role: 'CONFIG_RELEASE', workspaces: ['x89-project', 'x89-integration'], scopes: ['Vehicle'], envs: ALL_ENVS }]);
  account('resource', '刘子衡', [{ role: 'VEHICLE_RESOURCE', workspaces: ['*'], scopes: ['Vehicle', 'Chassis', 'ADC', 'CDC'], envs: ALL_ENVS }]);
  // Domain integrators: integrate, test and publish their domain's subsystem, and run its team
  // vehicles as workspace admin. Never a whole-vehicle or production release.
  for (const [username, name, domain] of [
    ['adc_integrator', '梁思齐', 'ADC'],
    ['cdc_integrator', '顾言之', 'CDC'],
  ] as const) {
    const domainWs = `x89-${domain.toLowerCase()}-integration`;
    const teams = DEMO_TEAMS.filter((t) => t.domain === domain).map((t) => `team-${t.group}`);
    account(username, name, [
      { role: 'CONFIG_INTEGRATOR', workspaces: [domainWs], scopes: [domain] },
      { role: 'INTEGRATION_TEST', workspaces: [domainWs], scopes: [domain], envs: ['testing'] },
      { role: 'WORKSPACE_ADMIN', workspaces: [...teams, domainWs] },
      { role: 'CONFIG_RELEASE', workspaces: [domainWs], scopes: [domain], envs: ['testing'] },
    ]);
  }

  // Everyone but the platform administrator is in the company directory; the sync links their
  // accounts by username. Members of the brake team get business development there from the org
  // rule; every other right stays an explicit grant. Chassis testers sit in their own department,
  // so the rule never lets a tester edit what they test.
  const departmentOf: Record<string, string> = {
    dispatch_operator: 'chassis-test',
    workspace_manager: 'chassis',
    adc_integrator: 'adc',
    cdc_integrator: 'cdc',
    dcl: 'data-closed-loop',
    integrator: 'vehicle-integration',
    integration_admin: 'vehicle-integration',
    integration_tester: 'vehicle-integration',
    release: 'vehicle-integration',
    resource: 'vehicle-resources',
  };
  for (const t of DEMO_TEAMS) {
    departmentOf[t.developer[0]] = t.unit;
    departmentOf[t.tester[0]] = t.domain === 'Chassis' ? 'chassis-test' : t.unit;
  }
  engine.run(null, (c) => {
    for (const [username, deptExtId] of Object.entries(departmentOf)) hirePerson(c, { username, displayName: c.s.accounts[username]!.displayName, deptExtId });
  });
  engine.run(null, (c) => syncIfChanged(c));
  as(admin, (c) =>
    createGrantRule(c, { orgUnitId: 'brake-team', includeSubunits: false, role: 'BUSINESS_DEV', workspaces: ['team-brake'], groups: ['brake'], scopes: [], envs: ['development'] }),
  );

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

  // Vehicles: recorded software versions, simulation images, physical vehicles, a brake simulation.
  as('resource', (c) => recordSoftwareVersion(c, { vehicleModelId: 'X89', version: '1.0', source: '整车 OTA 发布记录 X89-1.0', manifest: X89_MANIFEST }));
  as('resource', (c) => recordSoftwareVersion(c, { vehicleModelId: 'X89', version: '1.1', source: '整车 OTA 发布记录 X89-1.1', manifest: X89_MANIFEST }));
  const digest = (text: string) => `sha256:${sha256Hex(text)}`;
  as('dcl', (c) => registerImage(c, { id: 'x89-dev-sim', vehicleModelId: 'X89', integrationVersion: null, build: 'x89-dev-2026.10', digest: digest('x89-dev-sim'), simulator: 'SimOne 3' }));
  as('dcl', (c) => registerImage(c, { id: 'x89-1.0-sim', vehicleModelId: 'X89', integrationVersion: '1.0', build: 'x89-1.0.4', digest: digest('x89-1.0-sim'), simulator: 'SimOne 3' }));
  as('dcl', (c) => registerImage(c, { id: 'x89-1.1-sim', vehicleModelId: 'X89', integrationVersion: '1.1', build: 'x89-1.1.2', digest: digest('x89-1.1-sim'), simulator: 'SimOne 3' }));
  for (const [id, vin, plate, env, pool, name, version] of [
    ['VEH-001', 'LSDEM0X8900000001', '沪A·D0001', 'development', 'Chassis', '制动研发车 1', '1.0'],
    ['VEH-002', 'LSDEM0X8900000002', '沪A·D0002', 'development', 'ADC', '泊车研发车 1', null],
    ['VEH-003', 'LSDEM0X8900000003', '沪A·D0003', 'development', 'Chassis', '转向研发车 1', '1.0'],
    ['VEH-031', 'LSDEM0X8900000031', '沪A·T0031', 'testing', 'Vehicle', '整车集成测试车 1', '1.0'],
    ['VEH-201', 'LSDEM0X8900000201', '沪A·P0201', 'production', 'Vehicle', '量产车 201', '1.0'],
    ['VEH-202', 'LSDEM0X8900000202', '沪A·P0202', 'production', 'Vehicle', '量产车 202', '1.0'],
  ] as const) {
    as('resource', (c) => registerPhysical(c, { id, vin, licensePlate: plate, vehicleModelId: 'X89', env, pool, displayName: name }));
    if (version) as('resource', (c) => confirmIntegration(c, id, { version, source: 'DIP 上报 2026-10-15' }));
  }
  // ADC and CDC teams test on their own development vehicles; each domain workspace has testing
  // vehicles confirmed on software 1.0 for its subsystem candidates.
  for (const [id, vin, plate, pool, name] of [
    ['VEH-004', 'LSDEM0X8900000004', '沪A·D0004', 'ADC', '智驾研发车 4'],
    ['VEH-005', 'LSDEM0X8900000005', '沪A·D0005', 'CDC', '座舱研发车 5'],
    ['VEH-006', 'LSDEM0X8900000006', '沪A·D0006', 'CDC', '座舱研发车 6'],
  ] as const) {
    as('resource', (c) => registerPhysical(c, { id, vin, licensePlate: plate, vehicleModelId: 'X89', env: 'development', pool, displayName: name }));
  }
  for (const [id, vin, plate, pool, name] of [
    ['VEH-141', 'LSDEM0X8900000141', '沪A·T0141', 'ADC', 'ADC 域集成测试车'],
    ['VEH-151', 'LSDEM0X8900000151', '沪A·T0151', 'CDC', 'CDC 域集成测试车'],
  ] as const) {
    as('resource', (c) => registerPhysical(c, { id, vin, licensePlate: plate, vehicleModelId: 'X89', env: 'testing', pool, displayName: name }));
    as('resource', (c) => confirmIntegration(c, id, { version: '1.0', source: 'DIP 上报 2026-10-15' }));
  }
  for (const [admin_, team, group, sim, vehicle, groupName] of [
    ['adc_integrator', 'team-adc-parking', 'adc-parking', 'SIM-041', 'VEH-002', '泊车研发车组'],
    ['adc_integrator', 'team-adc-system', 'adc-system', 'SIM-042', 'VEH-004', '系统应用研发车组'],
    ['cdc_integrator', 'team-cdc-hmi', 'cdc-hmi', 'SIM-051', 'VEH-005', 'HMI 研发车组'],
    ['cdc_integrator', 'team-cdc-app', 'cdc-app', 'SIM-052', 'VEH-006', '座舱应用研发车组'],
  ] as const) {
    const pool = group.startsWith('adc') ? 'ADC' : 'CDC';
    as(admin_, (c) => createSimulation(c, { id: sim, workspaceId: team, imageId: 'x89-1.0-sim', env: 'development', pool, displayName: `${groupName.replace('车组', '')}仿真` }));
    as(admin_, (c) => addWorkspaceVehicle(c, team, vehicle));
    const g = as<string>(admin_, (c) => createVehicleGroup(c, { workspaceId: team, groupId: group, name: groupName, purpose: 'DEV', env: 'development' }));
    as(admin_, (c) => addGroupMember(c, g, sim, '团队 Feature 仿真验证'));
    as(admin_, (c) => addGroupMember(c, g, vehicle, '团队 Feature 实车验证'));
  }
  for (const [admin_, domainWs, pool, sim, vehicle, groupName] of [
    ['adc_integrator', 'x89-adc-integration', 'ADC', 'SIM-141', 'VEH-141', 'ADC 域集成测试车组'],
    ['cdc_integrator', 'x89-cdc-integration', 'CDC', 'SIM-151', 'VEH-151', 'CDC 域集成测试车组'],
  ] as const) {
    as(admin_, (c) => createSimulation(c, { id: sim, workspaceId: domainWs, imageId: 'x89-1.0-sim', env: 'testing', pool, displayName: `${pool} 域集成仿真` }));
    as(admin_, (c) => addWorkspaceVehicle(c, domainWs, vehicle));
    const g = as<string>(admin_, (c) => createVehicleGroup(c, { workspaceId: domainWs, groupId: null, name: groupName, purpose: 'TEST', env: 'testing' }));
    as(admin_, (c) => addGroupMember(c, g, sim, '子系统候选仿真验证'));
    as(admin_, (c) => addGroupMember(c, g, vehicle, '子系统候选实车验证'));
  }

  as('workspace_manager', (c) => createSimulation(c, { id: 'SIM-021', workspaceId: 'team-brake', imageId: 'x89-1.0-sim', env: 'development', pool: 'Chassis', displayName: '制动仿真 21' }));
  as('workspace_manager', (c) => addWorkspaceVehicle(c, 'team-brake', 'VEH-001'));
  const brakeGroup = as<string>('workspace_manager', (c) =>
    createVehicleGroup(c, { workspaceId: 'team-brake', groupId: 'brake', name: '制动研发车组', purpose: 'DEV', env: 'development' }),
  );
  as('workspace_manager', (c) => addGroupMember(c, brakeGroup, 'SIM-021', '制动 Feature 仿真验证'));
  as('workspace_manager', (c) => addGroupMember(c, brakeGroup, 'VEH-001', '制动 Feature 实车验证'));

  // Steering has already verified a Feature, so integration can be tried right away.
  as('workspace_manager', (c) => createSimulation(c, { id: 'SIM-022', workspaceId: 'team-steering', imageId: 'x89-1.0-sim', env: 'development', pool: 'Chassis', displayName: '转向仿真 22' }));
  as('workspace_manager', (c) => addWorkspaceVehicle(c, 'team-steering', 'VEH-003'));
  const steeringGroup = as<string>('workspace_manager', (c) =>
    createVehicleGroup(c, { workspaceId: 'team-steering', groupId: 'steering', name: '转向研发车组', purpose: 'DEV', env: 'development' }),
  );
  as('workspace_manager', (c) => addGroupMember(c, steeringGroup, 'SIM-022', '转向 Feature 仿真验证'));
  as('workspace_manager', (c) => addGroupMember(c, steeringGroup, 'VEH-003', '转向 Feature 实车验证'));
  const steering = as<string>('steering', (c) =>
    createFeature(c, { workspaceId: 'team-steering', groupId: 'steering', name: 'steering_angle_jump', description: '方向盘转角突变数据采集' }),
  );
  const epsKey = as<string>('steering', (c) =>
    addFile(c, steering, { source: { unit: 'Chassis', directory: '/var/log/eps', pattern: 'eps_trace.bin' }, name: 'EPS 转向轨迹', purpose: '分析方向盘转角突变' }),
  );
  as('steering', (c) =>
    putPolicy(c, steering, 'chassis.steering.angle_jump', {
      name: '转角突变',
      trigger: 'steering_angle_rate > 300 AND vehicle_speed > 20',
      captures: [epsKey],
      preSeconds: 5,
      postSeconds: 10,
    }),
  );
  const steeringCommit = as<{ commitId: string }>('steering', (c) => submitFeature(c, steering, { message: '转角突变首版' })).commitId;
  const [steeringDispatch] = as<string[]>('steering_tester', (c) => dispatchFeature(c, steering, { commitId: steeringCommit, vehicleGroupIds: [steeringGroup] }));
  for (const vehicle of ['SIM-022', 'VEH-003']) engine.run(null, (c) => sendReceipt(c, steeringDispatch!, vehicle, 'APPLIED'));
  as('steering_tester', (c) => recordFeatureTest(c, steering, { commitId: steeringCommit, resourceId: 'SIM-022', result: 'PASS', summary: '仿真回放 20 段转角突变场景，均正确触发' }));
  as('steering_tester', (c) => recordFeatureTest(c, steering, { commitId: steeringCommit, resourceId: 'VEH-003', result: 'PASS', summary: '实车封闭场地触发 5 次，数据完整' }));
  as('steering_tester', (c) => verifyFeature(c, steering));

  // The integration workspace has its own testing vehicles for candidates.
  as('integration_admin', (c) => createSimulation(c, { id: 'SIM-101', workspaceId: 'x89-integration', imageId: 'x89-1.0-sim', env: 'testing', pool: 'Vehicle', displayName: '整车集成仿真 101' }));
  as('integration_admin', (c) => addWorkspaceVehicle(c, 'x89-integration', 'VEH-031'));
  const integrationGroup = as<string>('integration_admin', (c) =>
    createVehicleGroup(c, { workspaceId: 'x89-integration', groupId: null, name: 'X89 集成测试车组', purpose: 'TEST', env: 'testing' }),
  );
  as('integration_admin', (c) => addGroupMember(c, integrationGroup, 'SIM-101', '集成候选仿真验证'));
  as('integration_admin', (c) => addGroupMember(c, integrationGroup, 'VEH-031', '集成候选实车验证'));

  // The first formal integration: steering_angle_jump becomes DCL 1.0.0 and runs on production vehicles.
  const firstPlan = as<string>('integrator', (c) => previewMerge(c, { workspaceId: 'x89-project', featureIds: [steering] }));
  as('dcl', (c) => confirmProcessing(c, firstPlan, { note: '首次正式集成的处理集合' }));
  const firstCandidate = as<string>('integrator', (c) => freezeCandidate(c, firstPlan, { label: 'X89-C1' }));
  const candidateDispatch = as<string>('integration_tester', (c) => dispatchCandidate(c, firstCandidate, { vehicleGroupIds: [integrationGroup] }));
  for (const vehicle of ['SIM-101', 'VEH-031']) engine.run(null, (c) => sendReceipt(c, candidateDispatch, vehicle, 'APPLIED'));
  as('integration_tester', (c) => recordCandidateTest(c, firstCandidate, { resourceId: 'SIM-101', result: 'PASS', summary: '整车仿真回归通过' }));
  as('integration_tester', (c) => recordCandidateTest(c, firstCandidate, { resourceId: 'VEH-031', result: 'PASS', summary: '整车实车回归通过' }));
  as('integration_tester', (c) => verifyCandidate(c, firstCandidate));
  const firstRelease = as<string>('release', (c) => promoteCandidate(c, firstCandidate, { dclVersion: '1.0.0', vehicleIntegrationVersions: ['1.0'], notes: 'X89 首个正式 DCL' }));
  for (const vehicle of ['VEH-201', 'VEH-202']) as('integration_admin', (c) => addWorkspaceVehicle(c, 'x89-project', vehicle));
  const productionGroup = as<string>('release', (c) =>
    createVehicleGroup(c, { workspaceId: 'x89-project', groupId: null, name: 'X89 量产车组', purpose: 'PRODUCTION', env: 'production' }),
  );
  for (const vehicle of ['VEH-201', 'VEH-202']) as('release', (c) => addGroupMember(c, productionGroup, vehicle, '量产配置 OTA'));
  const firstOta = as<string>('release', (c) => createOta(c, { releaseId: firstRelease, vehicleGroupIds: [productionGroup], firstWave: 'ALL' }));
  for (const vehicle of ['VEH-201', 'VEH-202']) engine.run(null, (c) => sendReceipt(c, firstOta, vehicle, 'APPLIED'));

  // Steering continues on top of DCL 1.0.0 and has verified a change, ready for the next integration.
  const returnRate = as<string>('steering', (c) =>
    createFeature(c, { workspaceId: 'team-steering', groupId: 'steering', name: 'steering_return_rate', description: '回正过慢采集，并延长转角突变的事后窗口' }),
  );
  as('steering', (c) =>
    putPolicy(c, returnRate, 'chassis.steering.angle_jump', { name: '转角突变', trigger: 'steering_angle_rate > 300 AND vehicle_speed > 20', captures: [epsKey], preSeconds: 5, postSeconds: 15 }),
  );
  as('steering', (c) =>
    putPolicy(c, returnRate, 'chassis.steering.return_rate', { name: '回正过慢', trigger: 'steering_return_rate < 20 AND vehicle_speed > 40', captures: [epsKey], preSeconds: 10, postSeconds: 10 }),
  );
  const returnCommit = as<{ commitId: string }>('steering', (c) => submitFeature(c, returnRate, { message: '回正速率与更长的事后窗口' })).commitId;
  const [returnDispatch] = as<string[]>('steering_tester', (c) => dispatchFeature(c, returnRate, { commitId: returnCommit, vehicleGroupIds: [steeringGroup] }));
  for (const vehicle of ['SIM-022', 'VEH-003']) engine.run(null, (c) => sendReceipt(c, returnDispatch!, vehicle, 'APPLIED'));
  as('steering_tester', (c) => recordFeatureTest(c, returnRate, { commitId: returnCommit, resourceId: 'SIM-022', result: 'PASS', summary: '仿真回放回正场景 12 段，均正确触发' }));
  as('steering_tester', (c) => recordFeatureTest(c, returnRate, { commitId: returnCommit, resourceId: 'VEH-003', result: 'PASS', summary: '实车低附路面回正测试通过' }));
  as('steering_tester', (c) => verifyFeature(c, returnRate));

  // Brake already monitors hard braking on its development vehicles, so after-sales and training
  // queries have brake data to find.
  const monitor = as<string>('business', (c) => createFeature(c, { workspaceId: 'team-brake', groupId: 'brake', name: 'brake_monitor', description: '急刹车监测与处理失败诊断' }));
  const monitorKey = as<string>('business', (c) =>
    addFile(c, monitor, { source: { unit: 'ADC', directory: '/var/log/brake', pattern: 'monitor.log' }, name: '制动监测日志', purpose: '急刹车与故障诊断' }),
  );
  as('business', (c) =>
    putPolicy(c, monitor, 'chassis.brake.monitor', { name: '急刹车', trigger: 'brake_pressure > 80 AND vehicle_deceleration > 6', captures: [monitorKey], preSeconds: 10, postSeconds: 10 }),
  );
  as('business', (c) =>
    putPolicy(c, monitor, 'chassis.brake.failure_diag', { name: '处理失败诊断', trigger: 'brake_fault_code > 0', captures: [monitorKey], preSeconds: 5, postSeconds: 5 }),
  );
  const monitorCommit = as<{ commitId: string }>('business', (c) => submitFeature(c, monitor, { message: '急刹车监测' })).commitId;
  const [monitorDispatch] = as<string[]>('brake_tester', (c) => dispatchFeature(c, monitor, { commitId: monitorCommit, vehicleGroupIds: [brakeGroup] }));
  for (const vehicle of ['SIM-021', 'VEH-001']) engine.run(null, (c) => sendReceipt(c, monitorDispatch!, vehicle, 'APPLIED'));
  for (const vehicle of ['SIM-021', 'VEH-001']) {
    as('brake_tester', (c) => recordFeatureTest(c, monitor, { commitId: monitorCommit, resourceId: vehicle, result: 'PASS', summary: '急刹车与故障码场景触发正确' }));
  }
  as('brake_tester', (c) => verifyFeature(c, monitor));

  // Sample collection events (MOCK_SAMPLE, fixed date 2026-10-18): successes, a parser failure,
  // unknown quality and unconfirmed use, on vehicles that really run these configurations.
  for (const [vehicle, policyId, at, failParse, quality, trainingUse] of [
    ['VEH-201', 'chassis.steering.angle_jump', '2026-10-18T01:12:00.000Z', false, 'A', 'ALLOWED'],
    ['VEH-201', 'chassis.steering.angle_jump', '2026-10-18T03:40:00.000Z', false, 'B', 'ALLOWED'],
    ['VEH-201', 'chassis.steering.angle_jump', '2026-10-18T05:05:00.000Z', true, 'UNKNOWN', 'UNCONFIRMED'],
    ['VEH-202', 'chassis.steering.angle_jump', '2026-10-18T02:30:00.000Z', false, 'UNKNOWN', 'UNCONFIRMED'],
    ['VEH-202', 'chassis.steering.angle_jump', '2026-10-18T07:15:00.000Z', false, 'C', 'ALLOWED'],
    ['VEH-003', 'chassis.steering.return_rate', '2026-10-18T06:00:00.000Z', false, 'A', 'ALLOWED'],
    ['VEH-003', 'chassis.steering.angle_jump', '2026-10-18T06:20:00.000Z', true, 'UNKNOWN', 'UNCONFIRMED'],
    ['SIM-022', 'chassis.steering.return_rate', '2026-10-18T08:00:00.000Z', false, 'A', 'DENIED'],
    ['VEH-001', 'chassis.brake.monitor', '2026-10-18T01:30:00.000Z', false, 'A', 'ALLOWED'],
    ['VEH-001', 'chassis.brake.monitor', '2026-10-18T04:10:00.000Z', false, 'B', 'ALLOWED'],
    ['VEH-001', 'chassis.brake.monitor', '2026-10-18T06:45:00.000Z', false, 'UNKNOWN', 'UNCONFIRMED'],
    ['VEH-001', 'chassis.brake.failure_diag', '2026-10-18T07:05:00.000Z', true, 'UNKNOWN', 'UNCONFIRMED'],
    ['SIM-021', 'chassis.brake.monitor', '2026-10-18T09:20:00.000Z', false, 'A', 'ALLOWED'],
  ] as const) {
    engine.run(null, (c) => {
      const id = captureEvent(c, { resourceId: vehicle, policyId, occurredAt: at, failParse, origin: 'MOCK_SAMPLE', quality, trainingUse });
      processEvent(c, id);
    });
  }

  // Steering asks brake for read-only use of the brake debug data; brake has not decided yet.
  as('steering', (c) => requestReference(c, { dataKey: brakeKey, readerGroupId: 'steering', reason: '转向事件分析需要制动压力上下文' }));

  // Every vehicle's DCL client: vehicle resources registers its device key, and it reports what it
  // runs. SIM-021 ran an older client before an upgrade and restart, so its history shows a new boot.
  for (const id of Object.keys(engine.getState().resources).sort()) {
    const key = engine.run(null, (c) => {
      provisionDevice(c, id);
      if (id === 'SIM-021') upgradeClient(c, id, '2.2.0');
      return devicePublicKey(c.s, id)!;
    }) as { keyId: string; publicKey: string };
    as('resource', (c) => registerDeviceKey(c, id, key));
    if (engine.getState().resources[id]!.instance === 'STOPPED') continue;
    engine.run(null, (c) => reportNow(c, id));
    engine.run(null, (c) => reportNow(c, id));
  }
  engine.run(null, (c) => {
    upgradeClient(c, 'SIM-021', '2.3.0');
    restartClient(c, 'SIM-021');
  });

  return produce(engine.getState(), (s) => {
    s.installation = 'DEMO';
  });
}
