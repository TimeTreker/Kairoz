import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { brakeWorld, expectError, ok, publishTemplates, startTestApp } from './helpers.ts';
import type { Client, TestApp } from './helpers.ts';

const BRAKE_LOG = { unit: 'ADC', directory: '/var/log/brake', pattern: 'brake_debug.pb' };
const BRAKE_VIDEO = { unit: 'ADC', directory: '/data/brake_cam', pattern: 'rear_*.mp4' };

describe('cross-group references', () => {
  let t: TestApp;
  let admin: Client;
  let business: Client;
  let steering: Client;
  let dcl: Client;
  let brakeFeature: any;
  let logKey: string;
  let videoKey: string;

  const policy = (captures: string[], postSeconds = 10) => ({
    name: '转向急变',
    trigger: 'steering_rate > 300',
    captures,
    preSeconds: 5,
    postSeconds,
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
      { fileType: 'camera_video', format: 'mp4' },
    ]);
    // Brake commits a log and a camera video.
    let f = ok(await business.post('/api/v1/workspaces/team-brake/features', { groupId: 'brake', name: 'shared_data' }), 201);
    f = ok(await business.post(`/api/v1/features/${f.id}/files`, { expectedRevision: f.revision, source: BRAKE_LOG, name: '制动调试数据', purpose: '分析' }));
    f = ok(await business.post(`/api/v1/features/${f.id}/files`, { expectedRevision: f.revision, source: BRAKE_VIDEO, name: '后视视频', purpose: '倒车' }));
    logKey = Object.keys(f.draft.files).find((k) => f.draft.files[k].source.pattern === 'brake_debug.pb')!;
    videoKey = Object.keys(f.draft.files).find((k) => k !== logKey)!;
    brakeFeature = ok(await business.post(`/api/v1/features/${f.id}/submit`, { expectedRevision: f.revision })).feature;
  });
  after(() => t.close());

  let steeringFeature: any;

  test('without a grant the catalog shows only name, owner and status', async () => {
    const catalog = ok(await steering.get('/api/v1/workspaces/team-steering/groups/steering/catalog'));
    const entry = catalog.find((c: any) => c.dataKey === logKey);
    assert.deepEqual(entry, {
      dataKey: logKey,
      name: '制动调试数据',
      ownerGroupId: 'brake',
      ownerGroupName: '制动组',
      status: 'ACTIVE',
      access: 'NONE',
    });
    steeringFeature = ok(await steering.post('/api/v1/workspaces/team-steering/features', { groupId: 'steering', name: 'steer_events' }), 201);
    const res = await steering.put(`/api/v1/features/${steeringFeature.id}/references/${logKey}`, { expectedRevision: steeringFeature.revision });
    expectError(res, 422, 'REFERENCE_NOT_GRANTED');
  });

  let requestId: string;

  test('requesting a reference: one open request per item and group, never for own or uncommitted data', async () => {
    const req = ok(await steering.post('/api/v1/reference-requests', { dataKey: logKey, readerGroupId: 'steering', reason: '转向事件需要制动压力上下文' }), 201);
    requestId = req.id;
    assert.equal(req.status, 'PENDING');
    assert.equal(req.ownerGroupId, 'brake');
    expectError(
      await steering.post('/api/v1/reference-requests', { dataKey: logKey, readerGroupId: 'steering', reason: 'again' }),
      409,
      'REFERENCE_ALREADY_OPEN',
    );
    expectError(
      await business.post('/api/v1/reference-requests', { dataKey: logKey, readerGroupId: 'brake', reason: 'x' }),
      422,
      'OWN_DATA_ITEM',
    );
    // A data item that is only in a draft has no definition to reference yet.
    let draft = ok(await business.post('/api/v1/workspaces/team-brake/features', { groupId: 'brake', name: 'not_yet' }), 201);
    draft = ok(
      await business.post(`/api/v1/features/${draft.id}/files`, {
        expectedRevision: draft.revision,
        source: { unit: 'ADC', directory: '/var/log/brake', pattern: 'pending.log' },
        name: '未提交',
        purpose: 'x',
      }),
    );
    const pendingKey = Object.keys(draft.draft.files)[0];
    expectError(
      await steering.post('/api/v1/reference-requests', { dataKey: pendingKey, readerGroupId: 'steering', reason: 'x' }),
      422,
      'NOT_COMMITTED',
    );
    // Asking on behalf of a group the grant does not cover.
    const foreign = await steering.post('/api/v1/reference-requests', { dataKey: logKey, readerGroupId: 'brake', reason: 'x' });
    expectError(foreign, 403, 'FORBIDDEN');
  });

  test('the owner group decides; the requester cannot approve its own request', async () => {
    const self = await steering.post(`/api/v1/reference-requests/${requestId}/decision`, { decision: 'APPROVED', reason: '' });
    assert.equal(expectError(self, 403, 'FORBIDDEN').details.reason, 'GROUP_NOT_GRANTED');

    const pending = ok(await business.get('/api/v1/reference-requests?groupId=brake&side=owner&status=PENDING'));
    assert.deepEqual(
      pending.map((r: any) => [r.dataKey, r.readerGroupId]),
      [[logKey, 'steering']],
    );
    const approved = ok(await business.post(`/api/v1/reference-requests/${requestId}/decision`, { decision: 'APPROVED', reason: '同意只读' }));
    assert.equal(approved.status, 'APPROVED');
    assert.equal(approved.decidedBy, 'business');

    const entry = ok(await steering.get('/api/v1/workspaces/team-steering/groups/steering/catalog')).find((c: any) => c.dataKey === logKey);
    assert.equal(entry.access, 'APPROVED');
    assert.equal(entry.dataCode, 'chassis.brake.brake.debug');
    assert.equal(entry.content.source.pattern, 'brake_debug.pb');
  });

  let pinnedVersion: string;

  test('a reference pins the owner version, can be captured, and is committed read-only', async () => {
    let f = ok(await steering.put(`/api/v1/features/${steeringFeature.id}/references/${logKey}`, { expectedRevision: steeringFeature.revision }));
    pinnedVersion = f.draft.references[logKey];
    assert.equal(f.referencedFiles[logKey].ownerGroupId, 'brake');
    assert.equal(f.referencedFiles[logKey].version, 1);
    assert.deepEqual(f.changes.sinceBase.references.added, [logKey]);

    // The definition stays with its owner.
    expectError(
      await steering.patch(`/api/v1/features/${f.id}/files/${logKey}`, { expectedRevision: f.revision, purpose: 'x' }),
      404,
      'NOT_FOUND',
    );

    f = ok(await steering.put(`/api/v1/features/${f.id}/policies/chassis.steering.sharp_turn`, { expectedRevision: f.revision, ...policy([logKey]) }));
    const { commit, feature } = ok(await steering.post(`/api/v1/features/${f.id}/submit`, { expectedRevision: f.revision }));
    assert.equal(feature.stage, 'DCL_READY');
    assert.deepEqual(
      commit.files.map((x: any) => [x.dataKey, x.owned, x.ownerGroupId, x.version.id]),
      [[logKey, false, 'brake', pinnedVersion]],
    );
    steeringFeature = feature;
  });

  test('the owner changing its definition does not move the pin until the reader re-pins', async () => {
    let f = await business.get(`/api/v1/features/${brakeFeature.id}`).then((r) => ok(r));
    f = ok(await business.patch(`/api/v1/features/${f.id}/files/${logKey}`, { expectedRevision: f.revision, retentionDays: 60 }));
    ok(await business.post(`/api/v1/features/${f.id}/submit`, { expectedRevision: f.revision }));

    let reader = ok(await steering.get(`/api/v1/features/${steeringFeature.id}`));
    assert.equal(reader.draft.references[logKey], pinnedVersion);
    reader = ok(await steering.put(`/api/v1/features/${reader.id}/references/${logKey}`, { expectedRevision: reader.revision }));
    assert.equal(reader.referencedFiles[logKey].version, 2);
    assert.deepEqual(reader.changes.sinceHead.references.changed, [{ key: logKey, fields: ['version'] }]);
    steeringFeature = reader;
  });

  test('revocation blocks new references and new submits but keeps history', async () => {
    const old = ok(await steering.get(`/api/v1/features/${steeringFeature.id}/commits`))[0];
    ok(await business.post(`/api/v1/reference-requests/${requestId}/revoke`, { reason: '数据口径调整' }));

    const blocked = await steering.post(`/api/v1/features/${steeringFeature.id}/submit`, { expectedRevision: steeringFeature.revision });
    const issue = expectError(blocked, 422, 'SUBMIT_BLOCKED').details.issues[0];
    assert.deepEqual([issue.kind, issue.key], ['reference', logKey]);

    const history = ok(await steering.get(`/api/v1/commits/${old.id}`));
    assert.equal(history.files[0].version.id, pinnedVersion);

    let f = steeringFeature;
    expectError(await steering.delete(`/api/v1/features/${f.id}/references/${logKey}?expectedRevision=${f.revision}`), 422, 'FILE_CAPTURED_BY_POLICY');
    f = ok(await steering.delete(`/api/v1/features/${f.id}/policies/chassis.steering.sharp_turn?expectedRevision=${f.revision}`));
    f = ok(await steering.delete(`/api/v1/features/${f.id}/references/${logKey}?expectedRevision=${f.revision}`));
    expectError(await steering.put(`/api/v1/features/${f.id}/references/${logKey}`, { expectedRevision: f.revision }), 422, 'REFERENCE_NOT_GRANTED');
  });

  test('platform operations may decide reference requests', async () => {
    const req = ok(await steering.post('/api/v1/reference-requests', { dataKey: videoKey, readerGroupId: 'steering', reason: '转向场景视频' }), 201);
    const decided = ok(await admin.post(`/api/v1/reference-requests/${req.id}/decision`, { decision: 'APPROVED', reason: '平台批准' }));
    assert.equal(decided.decidedBy, 'admin');
  });

  test('a referenced sensitive file needs review in the reader context', async () => {
    let f = ok(await steering.post('/api/v1/workspaces/team-steering/features', { groupId: 'steering', name: 'steer_video' }), 201);
    f = ok(await steering.put(`/api/v1/features/${f.id}/references/${videoKey}`, { expectedRevision: f.revision }));
    assert.deepEqual(f.reviewRequired, [videoKey]);
    f = ok(await steering.put(`/api/v1/features/${f.id}/policies/chassis.steering.reverse_turn`, { expectedRevision: f.revision, ...policy([videoKey]) }));
    const { feature } = ok(await steering.post(`/api/v1/features/${f.id}/submit`, { expectedRevision: f.revision }));
    assert.equal(feature.stage, 'SUBMITTED');
    assert.deepEqual(
      feature.intake.reviews.map((r: any) => [r.dataKey, r.owned, r.status]),
      [[videoKey, false, 'PENDING']],
    );
  });
});
