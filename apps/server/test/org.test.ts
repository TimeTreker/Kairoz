import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { brakeWorld, expectError, ok, startTestApp } from './helpers.ts';
import type { Client, TestApp } from './helpers.ts';

describe('organization and workspaces', () => {
  let t: TestApp;
  let admin: Client;

  before(async () => {
    t = await startTestApp();
    ({ admin } = await brakeWorld(t));
    ok(await admin.post('/api/v1/projects', { id: 'x89', name: 'X89项目', vehicleModelId: 'X89' }), 201);
    ok(await admin.post('/api/v1/org-units', { id: 'x89-adc', name: '智驾模块（ADC）', parentId: 'x89' }), 201);
    ok(await admin.post('/api/v1/org-units', { id: 'x89-parking', name: '泊车业务组', parentId: 'x89-adc' }), 201);
  });
  after(() => t.close());

  test('team and project trees stay separate', async () => {
    const team = ok(await admin.get('/api/v1/org-units?kind=TEAM'));
    const project = ok(await admin.get('/api/v1/org-units?projectId=x89'));
    assert.deepEqual(
      team.map((u: any) => u.id),
      ['brake-team', 'chassis', 'company', 'steering-team'],
    );
    assert.deepEqual(
      project.map((u: any) => [u.id, u.parentId]),
      [
        ['x89', null],
        ['x89-adc', 'x89'],
        ['x89-parking', 'x89-adc'],
      ],
    );
    const unit = project.find((u: any) => u.id === 'x89-adc');
    const crossTree = await admin.patch('/api/v1/org-units/x89-adc', { expectedRevision: unit.revision, parentId: 'chassis' });
    expectError(crossTree, 422, 'CROSS_TREE_MOVE');
  });

  test('moving a unit beneath itself is rejected', async () => {
    const chassis = ok(await admin.get('/api/v1/org-units?kind=TEAM')).find((u: any) => u.id === 'chassis');
    const cycle = await admin.patch('/api/v1/org-units/chassis', { expectedRevision: chassis.revision, parentId: 'brake-team' });
    expectError(cycle, 422, 'ORG_CYCLE');
  });

  test('renaming keeps the stable id', async () => {
    const team = ok(await admin.get('/api/v1/org-units?kind=TEAM')).find((u: any) => u.id === 'steering-team');
    const renamed = ok(await admin.patch('/api/v1/org-units/steering-team', { expectedRevision: team.revision, name: '转向与悬架团队' }));
    assert.equal(renamed.id, 'steering-team');
    assert.equal(renamed.revision, team.revision + 1);
    const ws = ok(await admin.get('/api/v1/workspaces/team-steering'));
    assert.deepEqual(
      ws.orgPath.map((p: any) => p.name),
      ['公司', '底盘部门', '转向与悬架团队'],
    );
  });

  test('the workspace kind decides which tree it sits on', async () => {
    const teamOnProject = await admin.post('/api/v1/workspaces', {
      id: 'bad-team',
      name: 'bad',
      kind: 'TEAM',
      orgUnitId: 'x89-adc',
      vehicleModelId: 'X89',
    });
    expectError(teamOnProject, 422, 'WORKSPACE_TREE_MISMATCH');
    const projectOnTeam = await admin.post('/api/v1/workspaces', {
      id: 'bad-project',
      name: 'bad',
      kind: 'PROJECT',
      orgUnitId: 'chassis',
      vehicleModelId: 'X89',
    });
    expectError(projectOnTeam, 422, 'WORKSPACE_TREE_MISMATCH');
  });

  test('a project workspace derives its project and declares explicit sources', async () => {
    const ws = ok(
      await admin.post('/api/v1/workspaces', {
        id: 'x89-project',
        name: 'X89 项目研发',
        kind: 'PROJECT',
        orgUnitId: 'x89',
        vehicleModelId: 'X89',
        scopes: ['Vehicle', 'Chassis'],
        sourceWorkspaceIds: ['team-brake', 'team-steering'],
      }),
      201,
    );
    assert.equal(ws.projectId, 'x89');
    assert.deepEqual(ws.sourceWorkspaceIds, ['team-brake', 'team-steering']);

    // Team workspaces never take sources, and project workspaces only use their own project's groups.
    const brake = ok(await admin.get('/api/v1/workspaces/team-brake'));
    expectError(
      await admin.patch('/api/v1/workspaces/team-brake', { expectedRevision: brake.revision, sourceWorkspaceIds: ['team-steering'] }),
      422,
      'TEAM_HAS_NO_SOURCES',
    );
    expectError(
      await admin.patch('/api/v1/workspaces/x89-project', { expectedRevision: ws.revision, groupIds: ['brake'] }),
      422,
      'GROUP_TREE_MISMATCH',
    );
  });

  test('sources must share the vehicle model', async () => {
    ok(await admin.post('/api/v1/vehicle-models', { id: 'X90', name: 'X90' }), 201);
    ok(await admin.post('/api/v1/projects', { id: 'x90', name: 'X90项目', vehicleModelId: 'X90' }), 201);
    const res = await admin.post('/api/v1/workspaces', {
      id: 'x90-project',
      name: 'X90 项目研发',
      kind: 'PROJECT',
      orgUnitId: 'x90',
      vehicleModelId: 'X90',
      sourceWorkspaceIds: ['team-brake'],
    });
    expectError(res, 422, 'SOURCE_MODEL_MISMATCH');
  });

  test('workspace admins create groups only beneath their workspace and within its domains', async () => {
    const wm = await t.login('workspace_manager');
    ok(await admin.post('/api/v1/org-units', { id: 'brake-sub', name: '制动子团队', parentId: 'brake-team' }), 201);
    const created = ok(
      await wm.post('/api/v1/groups', {
        id: 'brake-abs',
        code: 'chassis.brake_abs',
        name: 'ABS 研发组',
        domain: 'Chassis',
        purpose: 'DEV',
        orgUnitId: 'brake-sub',
        workspaceId: 'team-brake',
      }),
      201,
    );
    assert.equal(created.orgUnitId, 'brake-sub');
    assert.ok(ok(await wm.get('/api/v1/workspaces/team-brake')).groupIds.includes('brake-abs'));

    const outside = await wm.post('/api/v1/groups', {
      id: 'steer-x',
      code: 'chassis.steer_x',
      name: 'x',
      domain: 'Chassis',
      purpose: 'DEV',
      orgUnitId: 'steering-team',
      workspaceId: 'team-brake',
    });
    expectError(outside, 422, 'UNIT_OUTSIDE_WORKSPACE');

    const wrongDomain = await wm.post('/api/v1/groups', {
      id: 'brake-hmi',
      code: 'chassis.brake_hmi',
      name: 'x',
      domain: 'HMI',
      purpose: 'TEST',
      orgUnitId: 'brake-sub',
      workspaceId: 'team-brake',
    });
    expectError(wrongDomain, 422, 'DOMAIN_OUTSIDE_WORKSPACE');

    // Without a workspace the request is a platform-level creation, which workspace admins cannot do.
    const platformLevel = await wm.post('/api/v1/groups', {
      id: 'free-group',
      code: 'free.group',
      name: 'x',
      domain: 'Chassis',
      purpose: 'DEV',
      orgUnitId: 'brake-sub',
    });
    expectError(platformLevel, 403, 'FORBIDDEN');

    const otherWorkspace = await wm.post('/api/v1/groups', {
      id: 'steer-y',
      code: 'chassis.steer_y',
      name: 'x',
      domain: 'Chassis',
      purpose: 'DEV',
      orgUnitId: 'steering-team',
      workspaceId: 'team-steering',
    });
    assert.equal(expectError(otherWorkspace, 403, 'FORBIDDEN').details.reason, 'WORKSPACE_NOT_GRANTED');
  });

  test('creating a group grants nobody anything', async () => {
    const business = await t.login('business');
    const me = ok(await business.get('/api/v1/me'));
    assert.deepEqual(me.account.grants[0].groups, ['brake']);
  });

  test('non-administrators only see workspaces their grants cover', async () => {
    const business = await t.login('business');
    assert.deepEqual(
      ok(await business.get('/api/v1/workspaces')).map((w: any) => w.id),
      ['team-brake'],
    );
    expectError(await business.get('/api/v1/workspaces/team-steering'), 404, 'NOT_FOUND');
    assert.ok(ok(await admin.get('/api/v1/workspaces')).length >= 3);
  });

  test('group codes and ids are unique', async () => {
    const dup = await admin.post('/api/v1/groups', {
      id: 'brake-2',
      code: 'chassis.brake',
      name: 'dup',
      domain: 'Chassis',
      purpose: 'DEV',
      orgUnitId: 'brake-team',
    });
    expectError(dup, 409, 'GROUP_CODE_TAKEN');
  });
});
