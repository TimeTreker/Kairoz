import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { brakeWorld, expectError, ok, publishTemplates, startTestApp } from './helpers.ts';
import type { Client, TestApp } from './helpers.ts';

const brakeDebug = {
  source: { unit: 'adc', directory: '/var/log/brake/', pattern: 'brake_debug.pb' },
  name: '制动调试数据',
  purpose: '分析制动压力异常',
};

const hardBraking = {
  name: '急刹车',
  trigger: 'brake_pressure > 80 AND vehicle_speed > 30',
  preSeconds: 10,
  postSeconds: 20,
};

describe('config authoring', () => {
  let t: TestApp;
  let admin: Client;
  let business: Client;
  let dcl: Client;

  before(async () => {
    t = await startTestApp();
    ({ admin } = await brakeWorld(t));
    business = await t.login('business');
    dcl = await t.login('dcl');
  });
  after(() => t.close());

  const createFeature = async (name: string) =>
    ok(await business.post('/api/v1/workspaces/team-brake/features', { groupId: 'brake', name }), 201);

  test('a clean installation blocks files until DCL publishes a template', async () => {
    const feature = await createFeature('first_try');
    assert.equal(feature.stage, 'DRAFT');
    assert.equal(feature.baseReleaseId, null);
    assert.equal(feature.projectId, null);
    const res = await business.post(`/api/v1/features/${feature.id}/files`, { expectedRevision: feature.revision, ...brakeDebug });
    assert.equal(expectError(res, 422, 'TEMPLATE_MISSING').details.fileType, 'bin_log');
  });

  test('only DCL engineering maintains the processing catalog', async () => {
    const res = await business.post('/api/v1/processing/pipelines', {
      code: 'edge-x',
      side: 'EDGE',
      name: 'x',
      formats: ['binary'],
      steps: ['Upload'],
    });
    expectError(res, 403, 'FORBIDDEN');

    await publishTemplates(dcl, [
      { fileType: 'bin_log', format: 'protobuf' },
      { fileType: 'text_log', format: 'text' },
      { fileType: 'camera_video', format: 'mp4' },
    ]);
    const templates = ok(await business.get('/api/v1/processing/templates?current=true'));
    assert.deepEqual(
      templates.map((x: any) => [x.id, x.requiresReview, x.defaultPrivacy]),
      [
        ['template-bin_log@1', false, 'P1'],
        ['template-camera_video@1', true, 'P3'],
        ['template-text_log@1', false, 'P1'],
      ],
    );
  });

  test('pipelines keep their side and templates need compatible bindings', async () => {
    const wrongSide = await dcl.post('/api/v1/processing/pipelines', {
      code: 'edge-bin-log',
      side: 'CLOUD',
      name: 'x',
      formats: ['protobuf'],
      steps: ['Receive'],
    });
    expectError(wrongSide, 422, 'PIPELINE_SIDE_FIXED');
    const v2 = ok(
      await dcl.post('/api/v1/processing/pipelines', {
        code: 'edge-bin-log',
        side: 'EDGE',
        name: 'bin edge v2',
        formats: ['protobuf'],
        steps: ['Locate', 'Upload'],
      }),
      201,
    );
    assert.equal(v2.id, 'edge-bin-log@2');
    const incompatible = await dcl.post('/api/v1/processing/templates', {
      fileType: 'bin_log',
      format: 'text',
      schema: 's',
      edgePipelineId: 'edge-bin-log@2',
      cloudPipelineId: 'edge-bin-log@1',
      defaultRetentionDays: 30,
    });
    const issues: string[] = expectError(incompatible, 422, 'INCOMPATIBLE_BINDING').details.issues;
    assert.ok(issues.some((i) => i.includes('not an CLOUD pipeline')));
    assert.ok(issues.some((i) => i.includes('does not support format text')));
  });

  let featureId: string;
  let brakeKey: string;

  test('adding a file registers a stable data identity and fixes its processing binding', async () => {
    const feature = await createFeature('guided_brake');
    featureId = feature.id;
    const updated = ok(await business.post(`/api/v1/features/${featureId}/files`, { expectedRevision: feature.revision, ...brakeDebug }));
    brakeKey = Object.keys(updated.draft.files)[0]!;
    assert.match(brakeKey, /^dk_/);
    const spec = updated.draft.files[brakeKey];
    assert.deepEqual(spec.source, { unit: 'ADC', directory: '/var/log/brake', pattern: 'brake_debug.pb' });
    assert.equal(spec.fileType, 'bin_log');
    assert.equal(spec.templateId, 'template-bin_log@1');
    assert.equal(spec.edgePipelineId, 'edge-bin-log@1');
    assert.equal(spec.requiresReview, false);
    assert.deepEqual(updated.dataItems[brakeKey], { dataCode: 'chassis.brake.brake.debug', status: 'PENDING', overlapSuspects: [] });
    assert.equal(updated.revision, feature.revision + 1);
    assert.deepEqual(updated.changes.sinceBase.files.added, [brakeKey]);
  });

  test('policies are validated against the file list, the trigger grammar and the group namespace', async () => {
    const feature = ok(await business.get(`/api/v1/features/${featureId}`));
    const put = (policyId: string, body: object) =>
      business.put(`/api/v1/features/${featureId}/policies/${policyId}`, { expectedRevision: feature.revision, ...body });

    expectError(await put('chassis.steering.x', { ...hardBraking, captures: [brakeKey] }), 422, 'INVALID_POLICY_ID');
    const missing = await put('chassis.brake.hard_braking', { ...hardBraking, captures: ['dk_missing'] });
    assert.match(expectError(missing, 422, 'INVALID_POLICY').details.issues[0], /not in the file list/);
    const badTrigger = await put('chassis.brake.hard_braking', { ...hardBraking, trigger: 'brake_pressure >', captures: [brakeKey] });
    assert.match(expectError(badTrigger, 422, 'INVALID_POLICY').details.issues[0], /^trigger:/);
    const window = await put('chassis.brake.hard_braking', { ...hardBraking, preSeconds: 100, postSeconds: 30, captures: [brakeKey] });
    expectError(window, 422, 'INVALID_POLICY');

    const saved = ok(await put('chassis.brake.hard_braking', { ...hardBraking, captures: [brakeKey] }));
    assert.deepEqual(Object.keys(saved.draft.policies), ['chassis.brake.hard_braking']);
  });

  test('a stale revision is rejected', async () => {
    const res = await business.post(`/api/v1/features/${featureId}/files`, {
      expectedRevision: 1,
      ...brakeDebug,
      source: { ...brakeDebug.source, pattern: 'other.pb' },
    });
    expectError(res, 409, 'REVISION_CONFLICT');
  });

  test('concurrent edits on one revision: exactly one wins', async () => {
    const feature = ok(await business.get(`/api/v1/features/${featureId}`));
    const add = (pattern: string) =>
      business.post(`/api/v1/features/${featureId}/files`, {
        expectedRevision: feature.revision,
        name: pattern,
        purpose: 'race',
        source: { unit: 'VCU', directory: '/race', pattern },
      });
    const results = await Promise.all([add('one.log'), add('two.log')]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    const winner = results.find((r) => r.status === 200)!.body;
    const added = winner.changes.sinceBase.files.added.find((k: string) => k !== brakeKey);
    ok(await business.delete(`/api/v1/features/${featureId}/files/${added}?expectedRevision=${winner.revision}`));
  });

  let firstCommit: any;

  test('submitting creates an immutable commit; ordinary content is DCL Ready at once', async () => {
    const feature = ok(await business.get(`/api/v1/features/${featureId}`));
    const result = ok(await business.post(`/api/v1/features/${featureId}/submit`, { expectedRevision: feature.revision, message: '首版' }));
    firstCommit = result.commit;
    assert.equal(result.reused, false);
    assert.equal(result.feature.stage, 'DCL_READY');
    assert.equal(result.feature.headCommitId, firstCommit.id);
    assert.match(firstCommit.id, /^cm_/);
    assert.equal(firstCommit.sequence, 1);
    assert.equal(firstCommit.displayName, 'initial / chassis.brake / guided_brake / r001');
    assert.equal(firstCommit.files[0].version.version, 1);
    assert.equal(firstCommit.policies[0].version.version, 1);
    assert.deepEqual(firstCommit.changes.files.added, [brakeKey]);
    assert.match(firstCommit.digest, /^sha256:[0-9a-f]{64}$/);

    const items = ok(await business.get('/api/v1/workspaces/team-brake/groups/brake/data-items'));
    assert.equal(items.find((i: any) => i.dataKey === brakeKey).status, 'ACTIVE');
  });

  test('submitting unchanged content reuses the head commit', async () => {
    const feature = ok(await business.get(`/api/v1/features/${featureId}`));
    const again = ok(await business.post(`/api/v1/features/${featureId}/submit`, { expectedRevision: feature.revision }));
    assert.equal(again.reused, true);
    assert.equal(again.commit.id, firstCommit.id);
    assert.equal(ok(await business.get(`/api/v1/features/${featureId}/commits`)).length, 1);
  });

  test('editing returns to Draft; the next commit reuses unchanged versions', async () => {
    let feature = ok(await business.get(`/api/v1/features/${featureId}`));
    feature = ok(
      await business.put(`/api/v1/features/${featureId}/policies/chassis.brake.hard_braking`, {
        expectedRevision: feature.revision,
        ...hardBraking,
        postSeconds: 30,
        captures: [brakeKey],
      }),
    );
    assert.equal(feature.stage, 'DRAFT');
    assert.deepEqual(feature.changes.sinceHead.policies.changed, [{ key: 'chassis.brake.hard_braking', fields: ['postSeconds'] }]);

    const { commit } = ok(await business.post(`/api/v1/features/${featureId}/submit`, { expectedRevision: feature.revision }));
    assert.equal(commit.sequence, 2);
    assert.equal(commit.parentCommitId, firstCommit.id);
    assert.equal(commit.files[0].version.id, firstCommit.files[0].version.id, 'file spec version reused');
    assert.equal(commit.manifest.id, firstCommit.manifest.id, 'manifest version reused');
    assert.equal(commit.policies[0].version.version, 2);
    assert.deepEqual(commit.changes.policies.changed, [{ key: 'chassis.brake.hard_braking', fields: ['postSeconds'] }]);

    // The first commit is unchanged.
    const old = ok(await business.get(`/api/v1/commits/${firstCommit.id}`));
    assert.equal(old.policies[0].content.postSeconds, 20);
  });

  test('a file captured by a policy cannot be removed', async () => {
    const feature = ok(await business.get(`/api/v1/features/${featureId}`));
    const res = await business.delete(`/api/v1/features/${featureId}/files/${brakeKey}?expectedRevision=${feature.revision}`);
    assert.deepEqual(expectError(res, 422, 'FILE_CAPTURED_BY_POLICY').details.policyIds, ['chassis.brake.hard_braking']);
  });

  test('sensitive files cannot be downgraded and wait for DCL review after submit', async () => {
    let feature = await createFeature('front_camera');
    const video = {
      source: { unit: 'ADC', directory: '/data/camera', pattern: 'front_*.mp4' },
      name: '前视视频',
      purpose: '复现 AEB 误触发',
    };
    const downgrade = await business.post(`/api/v1/features/${feature.id}/files`, {
      expectedRevision: feature.revision,
      ...video,
      fileType: 'text_log',
    });
    expectError(downgrade, 422, 'SENSITIVE_TYPE_DOWNGRADE');

    feature = ok(await business.post(`/api/v1/features/${feature.id}/files`, { expectedRevision: feature.revision, ...video }));
    const key = Object.keys(feature.draft.files)[0]!;
    assert.equal(feature.draft.files[key].privacy, 'P3');
    assert.deepEqual(feature.reviewRequired, [key]);
    const result = ok(await business.post(`/api/v1/features/${feature.id}/submit`, { expectedRevision: feature.revision }));
    assert.equal(result.feature.stage, 'SUBMITTED');
  });

  test('raising privacy or adding a sensitive tag requires review', async () => {
    let feature = await createFeature('cabin_log');
    feature = ok(
      await business.post(`/api/v1/features/${feature.id}/files`, {
        expectedRevision: feature.revision,
        source: { unit: 'CDC', directory: '/log', pattern: 'cabin.log' },
        name: '座舱日志',
        purpose: '诊断',
      }),
    );
    const key = Object.keys(feature.draft.files)[0]!;
    assert.equal(feature.draft.files[key].requiresReview, false);
    feature = ok(
      await business.patch(`/api/v1/features/${feature.id}/files/${key}`, { expectedRevision: feature.revision, contentTags: ['Voice'] }),
    );
    assert.deepEqual(feature.draft.files[key].contentTags, ['voice']);
    assert.equal(feature.draft.files[key].requiresReview, true);
  });

  test('overlapping sources wait for a DCL decision before they can be committed', async () => {
    let feature = await createFeature('all_pb');
    feature = ok(
      await business.post(`/api/v1/features/${feature.id}/files`, {
        expectedRevision: feature.revision,
        source: { unit: 'ADC', directory: '/var/log/brake', pattern: '*.pb' },
        name: '全部 pb',
        purpose: '全量',
      }),
    );
    const key = Object.keys(feature.draft.files)[0]!;
    assert.deepEqual(feature.dataItems[key], { dataCode: 'chassis.brake.data', status: 'REVIEW', overlapSuspects: [brakeKey] });

    const blocked = await business.post(`/api/v1/features/${feature.id}/submit`, { expectedRevision: feature.revision });
    const issue = expectError(blocked, 422, 'SUBMIT_BLOCKED').details.issues[0];
    assert.equal(issue.key, key);
    assert.match(issue.problems[0], /awaits DCL review/);

    expectError(
      await business.post(`/api/v1/data-items/${key}/overlap-review`, { decision: 'DISTINCT', note: 'x' }),
      403,
      'FORBIDDEN',
    );
    const reviewed = ok(await dcl.post(`/api/v1/data-items/${key}/overlap-review`, { decision: 'DISTINCT', note: '用途不同，保留' }));
    assert.equal(reviewed.status, 'PENDING');
    ok(await business.post(`/api/v1/features/${feature.id}/submit`, { expectedRevision: feature.revision }));
  });

  test('another group cannot take over a registered source or read this group', async () => {
    const steering = await t.login('steering');
    let feature = ok(await steering.post('/api/v1/workspaces/team-steering/features', { groupId: 'steering', name: 'steer_trace' }), 201);
    const takeOver = await steering.post(`/api/v1/features/${feature.id}/files`, { expectedRevision: feature.revision, ...brakeDebug });
    const error = expectError(takeOver, 422, 'DATA_SOURCE_OWNED_ELSEWHERE');
    assert.equal(error.details.ownerGroupId, 'brake');

    expectError(await steering.get(`/api/v1/features/${featureId}`), 403, 'FORBIDDEN');
    expectError(await steering.get('/api/v1/workspaces/team-brake/groups/brake/data-items'), 403, 'FORBIDDEN');
    assert.deepEqual(ok(await steering.get('/api/v1/workspaces/team-brake/features')), []);

    feature = ok(
      await steering.post(`/api/v1/features/${feature.id}/files`, {
        expectedRevision: feature.revision,
        source: { unit: 'ADC', directory: '/var/log/steering', pattern: 'steer.log' },
        name: '转向日志',
        purpose: '诊断',
      }),
    );
    const steerKey = Object.keys(feature.draft.files)[0]!;
    const foreignCapture = await steering.put(`/api/v1/features/${feature.id}/policies/chassis.steering.uses_brake`, {
      expectedRevision: feature.revision,
      ...hardBraking,
      captures: [steerKey, brakeKey],
    });
    expectError(foreignCapture, 422, 'INVALID_POLICY');
  });

  test('business development needs one grant covering workspace, group and environment', async () => {
    const wrongWorkspace = await business.post('/api/v1/workspaces/team-steering/features', { groupId: 'steering', name: 'nope' });
    assert.equal(expectError(wrongWorkspace, 403, 'FORBIDDEN').details.reason, 'WORKSPACE_NOT_GRANTED');
    const wm = await t.login('workspace_manager');
    const notDev = await wm.post('/api/v1/workspaces/team-brake/features', { groupId: 'brake', name: 'nope' });
    assert.equal(expectError(notDev, 403, 'FORBIDDEN').details.reason, 'ROLE_NOT_GRANTED');
  });

  test('test groups do not own configuration', async () => {
    ok(await admin.post('/api/v1/groups', { id: 'brake-test', code: 'chassis.brake_test', name: '制动测试组', domain: 'Chassis', purpose: 'TEST', orgUnitId: 'brake-team', workspaceId: 'team-brake' }), 201);
    const accounts = ok(await admin.get('/api/v1/accounts'));
    const account = accounts.find((a: any) => a.username === 'business');
    ok(
      await admin.put('/api/v1/accounts/business/grants', {
        expectedRevision: account.revision,
        grants: [{ role: 'BUSINESS_DEV', workspaces: ['team-brake'], groups: ['brake', 'brake-test'], envs: ['development', 'testing'] }],
      }),
    );
    business = await t.login('business');
    const res = await business.post('/api/v1/workspaces/team-brake/features', { groupId: 'brake-test', name: 'nope' });
    expectError(res, 422, 'TEST_GROUP_CANNOT_OWN_CONFIG');
  });

  test('feature names are unique within a group', async () => {
    expectError(await business.post('/api/v1/workspaces/team-brake/features', { groupId: 'brake', name: 'guided_brake' }), 409, 'FEATURE_NAME_TAKEN');
  });

  test('DCL engineering can read group configuration; platform operations cannot', async () => {
    ok(await dcl.get(`/api/v1/features/${featureId}`));
    ok(await dcl.get(`/api/v1/commits/${firstCommit.id}`));
    expectError(await admin.get(`/api/v1/features/${featureId}`), 403, 'FORBIDDEN');
  });

  test('every allowed write is audited with the grant that authorized it', async () => {
    const audit = ok(await admin.get('/api/v1/audit?action=feature.submit&limit=1'));
    assert.equal(audit[0].outcome, 'ALLOWED');
    assert.equal(audit[0].role, 'BUSINESS_DEV');
    assert.equal(audit[0].workspaceId, 'team-brake');
    assert.ok(audit[0].grantId);
  });
});
