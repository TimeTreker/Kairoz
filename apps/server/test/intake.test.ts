import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { ALL_ENVS, brakeWorld, expectError, ok, publishTemplates, startTestApp } from './helpers.ts';
import type { Client, TestApp } from './helpers.ts';

const CONTROLS = {
  purposeConfirmed: true,
  scopeConfirmed: true,
  retentionConfirmed: true,
  accessControl: '仅制动组与 DCL 工程可读',
  uploadControl: '车端加密，仅 Wi-Fi 上传',
  processingControl: '人脸与车牌脱敏需外部引擎确认',
};

const VIDEO = { unit: 'ADC', directory: '/data/camera', pattern: 'front_*.mp4' };

describe('DCL intake', () => {
  let t: TestApp;
  let admin: Client;
  let business: Client;
  let dcl: Client;

  before(async () => {
    t = await startTestApp();
    ({ admin } = await brakeWorld(t));
    business = await t.login('business');
    dcl = await t.login('dcl');
    await publishTemplates(dcl, [
      { fileType: 'bin_log', format: 'protobuf' },
      { fileType: 'camera_video', format: 'mp4' },
    ]);
  });
  after(() => t.close());

  const get = async (id: string) => ok(await business.get(`/api/v1/features/${id}`));

  /** A Feature with the front camera video and one policy capturing it. */
  const cameraFeature = async (name: string, postSeconds = 20) => {
    let f = ok(await business.post('/api/v1/workspaces/team-brake/features', { groupId: 'brake', name }), 201);
    f = ok(await business.post(`/api/v1/features/${f.id}/files`, { expectedRevision: f.revision, source: VIDEO, name: '前视视频', purpose: '复现 AEB 误触发' }));
    const key = Object.keys(f.draft.files)[0]!;
    f = ok(
      await business.put(`/api/v1/features/${f.id}/policies/chassis.brake.aeb_false_trigger`, {
        expectedRevision: f.revision,
        name: 'AEB 误触发',
        trigger: 'aeb.active AND obstacle_distance > 50',
        captures: [key],
        preSeconds: 10,
        postSeconds,
      }),
    );
    return { feature: f, key };
  };

  const submit = async (f: any) => ok(await business.post(`/api/v1/features/${f.id}/submit`, { expectedRevision: f.revision })).feature;

  const approve = (f: any, key: string) =>
    dcl.post(`/api/v1/features/${f.id}/reviews`, {
      commitId: f.headCommitId,
      dataKey: key,
      decision: 'APPROVED',
      reason: '用途明确，范围受控',
      controls: CONTROLS,
    });

  let featureA: any;
  let videoKey: string;

  test('a submitted sensitive file appears in the DCL intake queue', async () => {
    const { feature, key } = await cameraFeature('aeb_camera');
    videoKey = key;
    featureA = await submit(feature);
    assert.equal(featureA.stage, 'SUBMITTED');
    assert.deepEqual(
      featureA.intake.reviews.map((r: any) => [r.dataKey, r.status]),
      [[key, 'PENDING']],
    );
    const queue = ok(await dcl.get('/api/v1/intake'));
    const entry = queue.features.find((f: any) => f.featureId === featureA.id);
    assert.equal(entry.displayName, 'initial / chassis.brake / aeb_camera / r001');
    assert.equal(entry.reviews[0].status, 'PENDING');
    expectError(await business.get('/api/v1/intake'), 403, 'FORBIDDEN');
  });

  test('approval requires every control and the current commit', async () => {
    const base = { commitId: featureA.headCommitId, dataKey: videoKey, decision: 'APPROVED', reason: 'ok' };
    expectError(await dcl.post(`/api/v1/features/${featureA.id}/reviews`, base), 422, 'INCOMPLETE_CONTROLS');
    const partial = await dcl.post(`/api/v1/features/${featureA.id}/reviews`, {
      ...base,
      controls: { ...CONTROLS, retentionConfirmed: false, uploadControl: ' ' },
    });
    assert.deepEqual(expectError(partial, 422, 'INCOMPLETE_CONTROLS').details.issues, [
      'confirm the retention period',
      'describe uploadControl',
    ]);
    expectError(
      await dcl.post(`/api/v1/features/${featureA.id}/reviews`, { ...base, commitId: 'cm_old', controls: CONTROLS }),
      409,
      'STALE_COMMIT',
    );
    const notDcl = await business.post(`/api/v1/features/${featureA.id}/reviews`, { ...base, controls: CONTROLS });
    expectError(notDcl, 403, 'FORBIDDEN');
  });

  test('approving every sensitive file makes the Feature DCL Ready', async () => {
    const result = ok(await approve(featureA, videoKey), 201);
    assert.equal(result.feature.stage, 'DCL_READY');
    assert.equal(result.feature.intake.reviews[0].status, 'APPROVED');
    assert.equal(result.feature.intake.reviews[0].lastReview.reviewer, 'dcl');
    const queue = ok(await dcl.get('/api/v1/intake'));
    assert.equal(queue.features.some((f: any) => f.featureId === featureA.id), false);
  });

  test('the approval follows the content: name changes keep it, retention or window changes need a new review', async () => {
    let f = await get(featureA.id);
    f = ok(await business.patch(`/api/v1/features/${f.id}/files/${videoKey}`, { expectedRevision: f.revision, name: '前视摄像头视频' }));
    f = await submit(f);
    assert.equal(f.stage, 'DCL_READY', 'display name is not part of the approval');

    f = ok(await business.patch(`/api/v1/features/${f.id}/files/${videoKey}`, { expectedRevision: f.revision, retentionDays: 90 }));
    f = await submit(f);
    assert.equal(f.stage, 'SUBMITTED', 'retention changed');
    f = ok(await approve(f, videoKey), 201).feature;
    assert.equal(f.stage, 'DCL_READY');

    f = ok(
      await business.put(`/api/v1/features/${f.id}/policies/chassis.brake.aeb_false_trigger`, {
        expectedRevision: f.revision,
        name: 'AEB 误触发',
        trigger: 'aeb.active AND obstacle_distance > 50',
        captures: [videoKey],
        preSeconds: 10,
        postSeconds: 40,
      }),
    );
    f = await submit(f);
    assert.equal(f.stage, 'SUBMITTED', 'capture window changed');
    featureA = f;
  });

  test('a rejection returns the Feature and revokes the approval wherever the same content appears', async () => {
    featureA = ok(await approve(featureA, videoKey), 201).feature;
    assert.equal(featureA.stage, 'DCL_READY');

    // Feature B collects exactly the same content (same data key, same policy) and reuses the approval.
    const { feature } = await cameraFeature('aeb_camera_copy', 40);
    let featureB = ok(
      await business.patch(`/api/v1/features/${feature.id}/files/${videoKey}`, { expectedRevision: feature.revision, retentionDays: 90 }),
    );
    featureB = await submit(featureB);
    assert.equal(featureB.stage, 'DCL_READY', 'approved content is not reviewed twice');

    const rejected = ok(
      await dcl.post(`/api/v1/features/${featureB.id}/reviews`, {
        commitId: featureB.headCommitId,
        dataKey: videoKey,
        decision: 'REJECTED',
        reason: '采集窗口过长，超出用途所需',
      }),
      201,
    );
    assert.equal(rejected.feature.stage, 'DRAFT');
    assert.equal(rejected.feature.feedback[0].kind, 'REVIEW_REJECTED');
    assert.equal(rejected.feature.feedback[0].reason, '采集窗口过长，超出用途所需');
    assert.equal((await get(featureA.id)).stage, 'SUBMITTED', 'the shared approval was revoked');
    assert.equal((await get(featureA.id)).intake.reviews[0].status, 'REJECTED');
  });

  test('DCL can return a Feature in intake with a reason', async () => {
    let f = ok(await business.post('/api/v1/workspaces/team-brake/features', { groupId: 'brake', name: 'plain_log' }), 201);
    f = ok(
      await business.post(`/api/v1/features/${f.id}/files`, {
        expectedRevision: f.revision,
        source: { unit: 'ADC', directory: '/var/log/brake', pattern: 'brake_debug.pb' },
        name: '制动调试数据',
        purpose: '分析',
      }),
    );
    f = await submit(f);
    assert.equal(f.stage, 'DCL_READY');
    expectError(await dcl.post(`/api/v1/features/${f.id}/return`, { expectedRevision: f.revision, reason: ' ' }), 422, 'REASON_REQUIRED');
    const returned = ok(await dcl.post(`/api/v1/features/${f.id}/return`, { expectedRevision: f.revision, reason: '请补充 Schema 说明' }));
    assert.equal(returned.stage, 'DRAFT');
    assert.deepEqual(
      returned.feedback.map((x: any) => [x.kind, x.reason, x.author]),
      [['RETURNED', '请补充 Schema 说明', 'dcl']],
    );
    expectError(
      await dcl.post(`/api/v1/features/${f.id}/return`, { expectedRevision: returned.revision, reason: 'again' }),
      422,
      'NOT_IN_INTAKE',
    );
  });

  test('DCL adjusts a processing binding; the business keeps it and resubmits', async () => {
    const cloud = ok(
      await dcl.post('/api/v1/processing/pipelines', {
        code: 'cloud-bin-log',
        side: 'CLOUD',
        name: 'bin cloud with parser',
        formats: ['protobuf'],
        steps: ['Receive', 'Checksum', 'Decrypt', 'Parse', 'Index'],
        capability: 'Parse',
      }),
      201,
    );
    assert.equal(cloud.id, 'cloud-bin-log@2');
    let f = ok(await business.get('/api/v1/workspaces/team-brake/features')).find((x: any) => x.name === 'plain_log');
    f = await get(f.id);
    const key = Object.keys(f.draft.files)[0]!;
    const spec = f.draft.files[key];
    const body = {
      expectedRevision: f.revision,
      format: spec.format,
      schema: spec.schema,
      edgePipelineId: spec.edgePipelineId,
      cloudPipelineId: cloud.id,
      reason: '使用带 Parser 的云端处理',
    };
    expectError(await business.put(`/api/v1/features/${f.id}/files/${key}/binding`, body), 403, 'FORBIDDEN');
    const wrong = await dcl.put(`/api/v1/features/${f.id}/files/${key}/binding`, { ...body, cloudPipelineId: spec.edgePipelineId });
    expectError(wrong, 422, 'INCOMPATIBLE_BINDING');

    f = ok(await dcl.put(`/api/v1/features/${f.id}/files/${key}/binding`, body));
    assert.equal(f.stage, 'DRAFT');
    assert.equal(f.draft.files[key].cloudPipelineId, 'cloud-bin-log@2');
    assert.equal(f.feedback[0].kind, 'BINDING_CHANGED');
    assert.deepEqual(f.changes.sinceHead.files.changed, [{ key, fields: ['cloudPipelineId'] }]);

    // A business edit of the same type keeps the DCL binding.
    f = ok(await business.patch(`/api/v1/features/${f.id}/files/${key}`, { expectedRevision: f.revision, purpose: '分析制动压力' }));
    assert.equal(f.draft.files[key].cloudPipelineId, 'cloud-bin-log@2');
    assert.equal((await submit(f)).stage, 'DCL_READY');
  });

  test('a DCL engineer only sees and reviews the groups the grant covers', async () => {
    ok(
      await admin.post('/api/v1/accounts', {
        username: 'steering_dcl',
        displayName: '转向 DCL',
        grants: [{ role: 'DCL_ENGINEER', workspaces: ['*'], groups: ['steering'], envs: ALL_ENVS }],
      }),
      201,
    );
    const steeringDcl = await t.login('steering_dcl');
    const queue = ok(await steeringDcl.get('/api/v1/intake'));
    assert.equal(queue.features.some((f: any) => f.groupId === 'brake'), false);
    const brakeFeature = await get(featureA.id);
    const res = await steeringDcl.post(`/api/v1/features/${brakeFeature.id}/reviews`, {
      commitId: brakeFeature.headCommitId,
      dataKey: videoKey,
      decision: 'APPROVED',
      reason: 'x',
      controls: CONTROLS,
    });
    assert.equal(expectError(res, 403, 'FORBIDDEN').details.reason, 'GROUP_NOT_GRANTED');
  });
});
