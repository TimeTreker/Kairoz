// Regression tests for issues found in the first code review of slice 1.

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { ALL_ENVS, brakeWorld, expectError, ok, publishTemplates, startTestApp } from './helpers.ts';
import type { Client, TestApp } from './helpers.ts';

describe('hardening', () => {
  let t: TestApp;
  let admin: Client;
  let business: Client;
  let steering: Client;
  let dcl: Client;

  const account = async (username: string, grants: unknown[]) =>
    ok(await admin.post('/api/v1/accounts', { username, displayName: username, grants }), 201);

  const newFeature = async (client: Client, group: string, name: string) =>
    ok(await client.post(`/api/v1/workspaces/team-${group}/features`, { groupId: group, name }), 201);

  const addFile = async (client: Client, feature: any, source: object, extra: object = {}) =>
    client.post(`/api/v1/features/${feature.id}/files`, {
      expectedRevision: feature.revision,
      source,
      name: 'f',
      purpose: 'p',
      ...extra,
    });

  before(async () => {
    t = await startTestApp();
    ({ admin } = await brakeWorld(t));
    business = await t.login('business');
    steering = await t.login('steering');
    dcl = await t.login('dcl');
    await publishTemplates(dcl, [
      { fileType: 'bin_log', format: 'protobuf' },
      { fileType: 'text_log', format: 'text' },
    ]);
  });
  after(() => t.close());

  test('an administrator limited to one environment cannot manage accounts or grant more', async () => {
    await account('devops', [{ role: 'PLATFORM_OPS', workspaces: ['*'], envs: ['development'] }]);
    const devops = await t.login('devops');
    const res = await devops.post('/api/v1/accounts', {
      username: 'shadow_admin',
      displayName: 'x',
      grants: [{ role: 'PLATFORM_OPS', workspaces: ['*'], envs: ALL_ENVS }],
    });
    assert.equal(expectError(res, 403, 'FORBIDDEN').details.reason, 'ENV_NOT_GRANTED');
    expectError(await devops.post('/api/v1/vehicle-models', { id: 'X99', name: 'x' }), 403, 'FORBIDDEN');
  });

  test('a wildcard pattern that may match video needs review whatever type is declared', async () => {
    let feature = await newFeature(business, 'brake', 'camera_like');
    feature = ok(
      await addFile(business, feature, { unit: 'ADC', directory: '/data/camera', pattern: 'front_*.mp?' }, { fileType: 'bin_log' }),
    );
    const key = Object.keys(feature.draft.files)[0]!;
    assert.equal(feature.draft.files[key].requiresReview, true);
    const submitted = ok(await business.post(`/api/v1/features/${feature.id}/submit`, { expectedRevision: feature.revision }));
    assert.equal(submitted.feature.stage, 'SUBMITTED');
  });

  test('concurrent moves cannot create a cycle', async () => {
    for (const [id, parentId] of [
      ['m-a', 'company'],
      ['m-b', 'company'],
      ['m-c', 'm-a'],
    ]) {
      ok(await admin.post('/api/v1/org-units', { id, name: id, parentId }), 201);
    }
    const units = ok(await admin.get('/api/v1/org-units?kind=TEAM'));
    const rev = (id: string) => units.find((u: any) => u.id === id).revision;
    const results = await Promise.all([
      admin.patch('/api/v1/org-units/m-a', { expectedRevision: rev('m-a'), parentId: 'm-b' }),
      admin.patch('/api/v1/org-units/m-b', { expectedRevision: rev('m-b'), parentId: 'm-c' }),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 422]);
    assert.equal(results.find((r) => r.status === 422)!.body.error.code, 'ORG_CYCLE');
    ok(await admin.get('/api/v1/workspaces'));
  });

  test('data items are read through a workspace that holds the group', async () => {
    await account('wide_tester', [{ role: 'BUSINESS_TEST', workspaces: ['team-steering'], groups: ['*'], envs: ['development'] }]);
    const tester = await t.login('wide_tester');
    expectError(await tester.get('/api/v1/workspaces/team-brake/groups/brake/data-items'), 403, 'FORBIDDEN');
    expectError(await tester.get('/api/v1/workspaces/team-steering/groups/brake/data-items'), 404, 'NOT_FOUND');
    ok(await tester.get('/api/v1/workspaces/team-steering/groups/steering/data-items'));
  });

  test('a DCL engineer limited to some groups cannot change the shared catalog', async () => {
    await account('narrow_dcl', [{ role: 'DCL_ENGINEER', workspaces: ['*'], groups: ['steering'], envs: ALL_ENVS }]);
    const narrow = await t.login('narrow_dcl');
    const res = await narrow.post('/api/v1/processing/pipelines', {
      code: 'edge-bin-log',
      side: 'EDGE',
      name: 'takeover',
      formats: ['protobuf'],
      steps: ['Upload'],
    });
    assert.equal(expectError(res, 403, 'FORBIDDEN').details.reason, 'GROUP_NOT_GRANTED');
  });

  test('removing a draft file releases a never-committed source', async () => {
    let feature = await newFeature(business, 'brake', 'borrowed_path');
    const source = { unit: 'ADC', directory: '/var/log/steering', pattern: 'steer.log' };
    feature = ok(await addFile(business, feature, source));
    const key = Object.keys(feature.draft.files)[0]!;
    ok(await business.delete(`/api/v1/features/${feature.id}/files/${key}?expectedRevision=${feature.revision}`));

    const mine = await newFeature(steering, 'steering', 'steer_log');
    const added = ok(await addFile(steering, mine, source));
    const steerKey = Object.keys(added.draft.files)[0]!;
    assert.notEqual(steerKey, key);
    assert.equal(added.dataItems[steerKey].status, 'PENDING');
  });

  test('concurrent registrations of overlapping sources are still detected', async () => {
    const a = await newFeature(business, 'brake', 'race_all_logs');
    const b = await newFeature(steering, 'steering', 'race_one_log');
    const [ra, rb] = await Promise.all([
      addFile(business, a, { unit: 'VCU', directory: '/race', pattern: '*.log' }),
      addFile(steering, b, { unit: 'VCU', directory: '/race', pattern: 'steer.log' }),
    ]);
    const statuses = [ok(ra), ok(rb)].map((f: any) => Object.values(f.dataItems).map((i: any) => i.status)[0]);
    assert.ok(statuses.includes('REVIEW'), `expected one REVIEW, got ${statuses}`);
  });

  test('overlap decisions across groups need a grant covering every involved group', async () => {
    await account('brake_dcl', [{ role: 'DCL_ENGINEER', workspaces: ['*'], groups: ['brake'], envs: ALL_ENVS }]);
    const brakeDcl = await t.login('brake_dcl');
    const brakeItems = ok(await business.get('/api/v1/workspaces/team-brake/groups/brake/data-items'));
    const steeringItems = ok(await steering.get('/api/v1/workspaces/team-steering/groups/steering/data-items'));
    const review = [...brakeItems, ...steeringItems].find((i: any) => i.status === 'REVIEW' && i.source.directory === '/race');
    const res = await brakeDcl.post(`/api/v1/data-items/${review.dataKey}/overlap-review`, { decision: 'DISTINCT', note: 'x' });
    expectError(res, 403, 'FORBIDDEN');
    ok(await dcl.post(`/api/v1/data-items/${review.dataKey}/overlap-review`, { decision: 'DISTINCT', note: '不同数据' }));
  });

  test('a TEAM workspace never holds a group from outside its team', async () => {
    const res = await admin.post('/api/v1/groups', {
      id: 'body-grp',
      code: 'body.grp',
      name: 'x',
      domain: 'Other',
      purpose: 'DEV',
      orgUnitId: 'company',
      workspaceId: 'team-brake',
    });
    expectError(res, 422, 'UNIT_OUTSIDE_WORKSPACE');

    ok(
      await admin.post('/api/v1/workspaces', {
        id: 'chassis-ws',
        name: '底盘工作区',
        kind: 'TEAM',
        orgUnitId: 'chassis',
        vehicleModelId: 'X89',
        groupIds: ['steering'],
      }),
      201,
    );
    const unit = ok(await admin.get('/api/v1/org-units?kind=TEAM')).find((u: any) => u.id === 'steering-team');
    const move = await admin.patch('/api/v1/org-units/steering-team', { expectedRevision: unit.revision, parentId: 'company' });
    assert.deepEqual(expectError(move, 422, 'GROUP_OUTSIDE_TEAM').details.memberships, [
      { workspaceId: 'chassis-ws', groupId: 'steering' },
    ]);
  });

  test('group codes cannot nest inside another group namespace', async () => {
    const res = await admin.post('/api/v1/groups', {
      id: 'steer-ops',
      code: 'chassis.steering.ops',
      name: 'x',
      domain: 'Chassis',
      purpose: 'DEV',
      orgUnitId: 'steering-team',
    });
    expectError(res, 409, 'GROUP_CODE_NESTED');
  });

  test('invalid values are client errors, not server errors', async () => {
    const feature = await newFeature(business, 'brake', 'bad_values');
    const nul = await addFile(business, feature, { unit: 'ADC', directory: '/x', pattern: 'a.log' }, { purpose: 'bad\u0000value' });
    expectError(nul, 400, 'INVALID_INPUT');
    expectError(await admin.get('/api/v1/audit?beforeId=99999999999999999999'), 400, 'VALIDATION_FAILED');
  });
});
