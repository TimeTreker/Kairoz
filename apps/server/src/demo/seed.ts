// Demo data for manual exploration, modeled on the prototype's sample organization.
// It is loaded only on explicit request and only into a clean installation. Every object is
// created through the HTTP API in-process, so the demo obeys the same rules as real users.

import type { FastifyInstance } from 'fastify';

const ALL_ENVS = ['development', 'testing', 'production'];
const DEV_TEST = ['development', 'testing'];

interface Team {
  group: string;
  code: string;
  groupName: string;
  unit: string;
  unitName: string;
  parent: string;
  domain: string;
  developer: [string, string];
  tester: [string, string];
}

const TEAMS: Team[] = [
  { group: 'brake', code: 'chassis.brake', groupName: '制动组', unit: 'brake-team', unitName: '制动团队', parent: 'chassis', domain: 'Chassis', developer: ['business', '陈明'], tester: ['brake_tester', '王嘉宁'] },
  { group: 'steering', code: 'chassis.steering', groupName: '转向组', unit: 'steering-team', unitName: '转向团队', parent: 'chassis', domain: 'Chassis', developer: ['steering', '吴泽宇'], tester: ['steering_tester', '吴凡'] },
  { group: 'adc-parking', code: 'adc.parking', groupName: 'ADC 泊车应用组', unit: 'parking-team', unitName: '泊车团队', parent: 'adc', domain: 'ADC', developer: ['adc_parking', '张景然'], tester: ['adc_parking_tester', '张敏'] },
  { group: 'adc-system', code: 'adc.system', groupName: 'ADC 系统应用组', unit: 'adc-system-team', unitName: '系统应用团队', parent: 'adc', domain: 'ADC', developer: ['adc_system', '许文博'], tester: ['adc_system_tester', '许悦'] },
  { group: 'cdc-hmi', code: 'cdc.hmi', groupName: 'CDC HMI组', unit: 'hmi-team', unitName: 'HMI 团队', parent: 'cdc', domain: 'CDC', developer: ['cdc_hmi', '林雨辰'], tester: ['cdc_hmi_tester', '林晓'] },
  { group: 'cdc-app', code: 'cdc.app', groupName: 'CDC 座舱应用组', unit: 'cabin-app-team', unitName: '座舱应用团队', parent: 'cdc', domain: 'CDC', developer: ['cdc_app', '吴思远'], tester: ['cdc_app_tester', '吴宁'] },
];

// Default RawStorage templates. RawStorage only stores raw files; it does not parse or de-identify.
const FILE_TYPE_FORMATS: [string, string][] = [
  ['text_log', 'text'],
  ['bin_log', 'binary'],
  ['can_log', 'mcap'],
  ['camera_image', 'image'],
  ['camera_video', 'mp4'],
  ['pointcloud', 'pointcloud'],
  ['gnss', 'jsonl'],
  ['unknown', 'binary'],
];

export async function seedDemo(app: FastifyInstance): Promise<string[]> {
  const log: string[] = [];

  const call = async (token: string | null, method: string, url: string, body?: unknown) => {
    const res = await app.inject({
      method: method as 'GET',
      url,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
    });
    if (res.statusCode >= 300) throw new Error(`${method} ${url} -> ${res.statusCode} ${res.body}`);
    return res.body ? res.json() : undefined;
  };
  const login = async (username: string): Promise<string> =>
    (await call(null, 'POST', '/api/v1/auth/dev-login', { username })).token;

  const admin = await login('admin');
  const accounts = await call(admin, 'GET', '/api/v1/accounts');
  const workspaces = await call(admin, 'GET', '/api/v1/workspaces');
  if (accounts.length > 1 || workspaces.length > 0) {
    throw new Error('demo data can only be loaded into a clean installation');
  }
  const post = (token: string, url: string, body: unknown) => call(token, 'POST', url, body);

  // Vehicle models, team organization, project organization.
  await post(admin, '/api/v1/vehicle-models', { id: 'X89', name: 'X89' });
  await post(admin, '/api/v1/vehicle-models', { id: 'X90', name: 'X90' });
  for (const [id, name, parentId] of [
    ['company', '公司', undefined],
    ['vehicle-rd', '整车研发中心', 'company'],
    ['chassis', '底盘部门', 'vehicle-rd'],
    ['ai-center', 'AI 中心', 'company'],
    ['adc', 'ADC', 'ai-center'],
    ['cockpit', '座舱部门', 'vehicle-rd'],
    ['cdc', 'CDC', 'cockpit'],
  ] as const) {
    await post(admin, '/api/v1/org-units', { id, name, ...(parentId ? { parentId } : {}) });
  }
  await post(admin, '/api/v1/projects', { id: 'x89', name: 'X89项目', vehicleModelId: 'X89' });
  for (const [id, name, parentId] of [
    ['x89-chassis', '底盘模块', 'x89'],
    ['x89-adc', '智驾模块（ADC）', 'x89'],
    ['x89-cdc', '座舱模块（CDC）', 'x89'],
    ['x89-integration-test', '整车集成测试组', 'x89'],
  ] as const) {
    await post(admin, '/api/v1/org-units', { id, name, parentId });
  }

  // One DEV group and TEAM workspace per team, plus project and integration workspaces.
  for (const team of TEAMS) {
    await post(admin, '/api/v1/org-units', { id: team.unit, name: team.unitName, parentId: team.parent });
    await post(admin, '/api/v1/groups', {
      id: team.group,
      code: team.code,
      name: team.groupName,
      domain: team.domain,
      purpose: 'DEV',
      orgUnitId: team.unit,
    });
    await post(admin, '/api/v1/workspaces', {
      id: `team-${team.group}`,
      name: `${team.unitName}工作区`,
      kind: 'TEAM',
      orgUnitId: team.unit,
      vehicleModelId: 'X89',
      groupIds: [team.group],
      scopes: [team.domain],
    });
  }
  const teamWorkspaces = TEAMS.map((t) => `team-${t.group}`);
  await post(admin, '/api/v1/workspaces', {
    id: 'x89-project',
    name: 'X89 项目研发',
    kind: 'PROJECT',
    orgUnitId: 'x89',
    vehicleModelId: 'X89',
    scopes: ['Vehicle', 'Chassis', 'ADC', 'CDC'],
    sourceWorkspaceIds: teamWorkspaces,
  });
  await post(admin, '/api/v1/workspaces', {
    id: 'x89-integration',
    name: 'X89 集成测试',
    kind: 'INTEGRATION',
    orgUnitId: 'x89-integration-test',
    vehicleModelId: 'X89',
    scopes: ['Vehicle'],
    sourceWorkspaceIds: ['x89-project'],
  });
  log.push(`organization: ${7 + TEAMS.length} team units, project x89 with 4 modules, vehicle models X89 / X90`);
  log.push(`workspaces: ${teamWorkspaces.length} team, x89-project, x89-integration`);

  // Accounts. Each grant is one complete authorization; people may hold several.
  const account = (username: string, displayName: string, grants: unknown[]) =>
    post(admin, '/api/v1/accounts', { username, displayName, grants });
  for (const team of TEAMS) {
    const ws = [`team-${team.group}`];
    await account(team.developer[0], team.developer[1], [{ role: 'BUSINESS_DEV', workspaces: ws, groups: [team.group], envs: DEV_TEST }]);
    await account(team.tester[0], team.tester[1], [{ role: 'BUSINESS_TEST', workspaces: ws, groups: [team.group], envs: DEV_TEST }]);
  }
  await account('dcl', '林书涵', [{ role: 'DCL_ENGINEER', workspaces: ['*'], groups: ['*'], envs: ALL_ENVS }]);
  await account('workspace_manager', '周子墨', [
    { role: 'WORKSPACE_ADMIN', workspaces: ['team-brake', 'team-steering'], envs: DEV_TEST },
  ]);
  await account('integrator', '赵一鸣', [
    { role: 'CONFIG_INTEGRATOR', workspaces: ['x89-project', 'x89-integration'], scopes: ['Vehicle'], envs: DEV_TEST },
  ]);
  await account('integration_tester', '钱思源', [
    { role: 'INTEGRATION_TEST', workspaces: ['x89-integration'], scopes: ['Vehicle'], envs: ['testing'] },
  ]);
  await account('release', '孙立', [{ role: 'CONFIG_RELEASE', workspaces: ['x89-project'], scopes: ['Vehicle'], envs: ALL_ENVS }]);
  await account('resource', '刘子衡', [{ role: 'VEHICLE_RESOURCE', workspaces: ['*'], scopes: ['Vehicle', 'Chassis', 'ADC', 'CDC'], envs: ALL_ENVS }]);
  log.push(`accounts: admin plus ${TEAMS.length * 2 + 6} demo accounts`);

  // DCL engineering publishes RawStorage pipelines and default templates for every file type.
  const dcl = await login('dcl');
  for (const [fileType, format] of FILE_TYPE_FORMATS) {
    const code = fileType.replaceAll('_', '-');
    const edge = await post(dcl, '/api/v1/processing/pipelines', {
      code: `default-edge-${code}`,
      side: 'EDGE',
      name: `${fileType} Edge`,
      formats: [format],
      steps: ['Locate', 'Snapshot', 'Compress', 'Encrypt', 'Upload'],
      capability: 'RawStorage',
    });
    const cloud = await post(dcl, '/api/v1/processing/pipelines', {
      code: `default-cloud-${code}`,
      side: 'CLOUD',
      name: `${fileType} Cloud`,
      formats: [format],
      steps: ['Receive', 'Checksum', 'Decrypt', 'RawStore', 'Index'],
      capability: 'RawStorage',
    });
    await post(dcl, '/api/v1/processing/templates', {
      fileType,
      format,
      schema: `opaque-${code}@1`,
      edgePipelineId: edge.id,
      cloudPipelineId: cloud.id,
      defaultRetentionDays: 30,
    });
  }
  log.push(`processing: ${FILE_TYPE_FORMATS.length} default templates (RawStorage only)`);

  // A first brake Feature, submitted: guided_brake with one file and one policy.
  const business = await login('business');
  let feature = await post(business, '/api/v1/workspaces/team-brake/features', {
    groupId: 'brake',
    name: 'guided_brake',
    description: '制动压力异常数据采集',
  });
  feature = await post(business, `/api/v1/features/${feature.id}/files`, {
    expectedRevision: feature.revision,
    source: { unit: 'ADC', directory: '/var/log/brake', pattern: 'brake_debug.pb' },
    name: '制动调试数据',
    purpose: '分析制动压力异常',
  });
  const dataKey = Object.keys(feature.draft.files)[0];
  feature = await call(business, 'PUT', `/api/v1/features/${feature.id}/policies/chassis.brake.hard_braking`, {
    expectedRevision: feature.revision,
    name: '急刹车',
    trigger: 'brake_pressure > 80 AND vehicle_speed > 30',
    captures: [dataKey],
    preSeconds: 10,
    postSeconds: 20,
  });
  const submitted = await post(business, `/api/v1/features/${feature.id}/submit`, {
    expectedRevision: feature.revision,
    message: '首版制动采集',
  });
  log.push(`feature guided_brake submitted as ${submitted.commit.displayName} (${submitted.feature.stage})`);
  return log;
}
