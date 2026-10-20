// Regression tests for issues found in the code review of slice 2.

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { ALL_ENVS, brakeWorld, expectError, ok, publishTemplates, startTestApp } from './helpers.ts';
import type { Client, TestApp } from './helpers.ts';

const CONTROLS = {
  purposeConfirmed: true,
  scopeConfirmed: true,
  retentionConfirmed: true,
  accessControl: '受控',
  uploadControl: '加密上传',
  processingControl: '外部脱敏',
};

describe('intake and reference hardening', () => {
  let t: TestApp;
  let admin: Client;
  let business: Client;
  let steering: Client;
  let dcl: Client;

  const account = async (username: string, grants: unknown[]) =>
    ok(await admin.post('/api/v1/accounts', { username, displayName: username, grants }), 201);

  const feature = async (client: Client, group: string, name: string, workspace = `team-${group}`) =>
    ok(await client.post(`/api/v1/workspaces/${workspace}/features`, { groupId: group, name }), 201);

  const addFile = async (client: Client, f: any, source: object, extra: object = {}) =>
    ok(await client.post(`/api/v1/features/${f.id}/files`, { expectedRevision: f.revision, source, name: 'f', purpose: 'p', ...extra }));

  const putPolicy = async (client: Client, f: any, policyId: string, captures: string[], postSeconds = 10) =>
    ok(
      await client.put(`/api/v1/features/${f.id}/policies/${policyId}`, {
        expectedRevision: f.revision,
        name: 'p',
        trigger: 'speed > 10',
        captures,
        preSeconds: 5,
        postSeconds,
      }),
    );

  const submit = async (client: Client, f: any) =>
    ok(await client.post(`/api/v1/features/${f.id}/submit`, { expectedRevision: f.revision })).feature;

  const review = (client: Client, f: any, dataKey: string, decision: 'APPROVED' | 'REJECTED') =>
    client.post(`/api/v1/features/${f.id}/reviews`, {
      commitId: f.headCommitId,
      dataKey,
      decision,
      reason: decision === 'APPROVED' ? '同意' : '拒绝',
      ...(decision === 'APPROVED' ? { controls: CONTROLS } : {}),
    });

  /** Owner `brake` commits a file; `steering` gets an approved reference to it. */
  const sharedFile = async (name: string, source: object) => {
    let f = await feature(business, 'brake', name);
    f = await addFile(business, f, source);
    const key = Object.keys(f.draft.files)[0]!;
    f = await submit(business, f);
    const req = ok(await steering.post('/api/v1/reference-requests', { dataKey: key, readerGroupId: 'steering', reason: '需要' }), 201);
    ok(await business.post(`/api/v1/reference-requests/${req.id}/decision`, { decision: 'APPROVED', reason: '' }));
    return { owner: f, key, requestId: req.id as string };
  };

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
  });
  after(() => t.close());

  test('revocation returns reader Features in intake, and an unchanged resubmit is still blocked', async () => {
    const { key, requestId } = await sharedFile('rv_owner', { unit: 'ADC', directory: '/rv', pattern: 'a.pb' });
    let reader = await feature(steering, 'steering', 'rv_reader');
    reader = ok(await steering.put(`/api/v1/features/${reader.id}/references/${key}`, { expectedRevision: reader.revision }));
    reader = await putPolicy(steering, reader, 'chassis.steering.rv', [key]);
    reader = await submit(steering, reader);
    assert.equal(reader.stage, 'DCL_READY');

    const revoked = ok(await business.post(`/api/v1/reference-requests/${requestId}/revoke`, { reason: '口径调整' }));
    assert.deepEqual(revoked.returnedFeatureIds, [reader.id]);
    reader = ok(await steering.get(`/api/v1/features/${reader.id}`));
    assert.equal(reader.stage, 'DRAFT');
    assert.equal(reader.feedback[0].kind, 'REFERENCE_REVOKED');

    const again = await steering.post(`/api/v1/features/${reader.id}/submit`, { expectedRevision: reader.revision });
    assert.equal(expectError(again, 422, 'SUBMIT_BLOCKED').details.issues[0].kind, 'reference');
  });

  test('a decision never changes Features of another group, even for identical content', async () => {
    const video = { unit: 'ADC', directory: '/dg', pattern: 'rear_*.mp4' };
    const { owner, key } = await sharedFile('dg_owner', video);
    assert.equal(owner.stage, 'SUBMITTED');
    let reader = await feature(steering, 'steering', 'dg_reader');
    reader = ok(await steering.put(`/api/v1/features/${reader.id}/references/${key}`, { expectedRevision: reader.revision }));
    reader = await submit(steering, reader);
    assert.equal(reader.stage, 'SUBMITTED');

    await account('steering_dcl', [{ role: 'DCL_ENGINEER', workspaces: ['*'], groups: ['steering'], envs: ALL_ENVS }]);
    const steeringDcl = await t.login('steering_dcl');
    assert.equal(ok(await review(steeringDcl, reader, key, 'APPROVED'), 201).feature.stage, 'DCL_READY');
    const ownerNow = ok(await business.get(`/api/v1/features/${owner.id}`));
    assert.equal(ownerNow.stage, 'SUBMITTED');
    assert.equal(ownerNow.intake.reviews[0].status, 'PENDING');
    assert.equal(ownerNow.intake.reviews[0].lastReview, null);
  });

  test('a decision in one workspace does not apply to the same group in another', async () => {
    ok(
      await admin.post('/api/v1/workspaces', {
        id: 'chassis-ws',
        name: '底盘工作区',
        kind: 'TEAM',
        orgUnitId: 'chassis',
        vehicleModelId: 'X89',
        groupIds: ['brake'],
        scopes: ['Chassis'],
      }),
      201,
    );
    const account0 = ok(await admin.get('/api/v1/accounts')).find((a: any) => a.username === 'business');
    ok(
      await admin.put('/api/v1/accounts/business/grants', {
        expectedRevision: account0.revision,
        grants: [{ role: 'BUSINESS_DEV', workspaces: ['team-brake', 'chassis-ws'], groups: ['brake'], envs: ['development', 'testing'] }],
      }),
    );
    business = await t.login('business');
    const video = { unit: 'ADC', directory: '/ws', pattern: 'side_*.mp4' };
    let a = await feature(business, 'brake', 'ws_team');
    a = await submit(business, await addFile(business, a, video));
    let b = await feature(business, 'brake', 'ws_chassis', 'chassis-ws');
    b = await submit(business, await addFile(business, b, video));
    ok(await review(dcl, a, Object.keys(a.draft.files)[0]!, 'APPROVED'), 201);
    assert.equal(ok(await business.get(`/api/v1/features/${b.id}`)).stage, 'SUBMITTED');
  });

  test('concurrent reviews and submits on shared content end consistent and without deadlock', async () => {
    const video = { unit: 'ADC', directory: '/cc', pattern: 'cc_*.mp4' };
    let a = await feature(business, 'brake', 'cc_a');
    a = await submit(business, await addFile(business, a, video));
    const key = Object.keys(a.draft.files)[0]!;
    let b = await feature(business, 'brake', 'cc_b');
    b = await submit(business, await addFile(business, b, video));
    const both = await Promise.all([review(dcl, a, key, 'APPROVED'), review(dcl, b, key, 'APPROVED')]);
    assert.deepEqual(both.map((r) => r.status), [201, 201]);

    // C has the same content; its submit races a rejection on A.
    let c = await feature(business, 'brake', 'cc_c');
    c = await addFile(business, c, video);
    a = ok(await business.get(`/api/v1/features/${a.id}`));
    const [rejected, submitted] = await Promise.all([
      review(dcl, a, key, 'REJECTED'),
      business.post(`/api/v1/features/${c.id}/submit`, { expectedRevision: c.revision }),
    ]);
    ok(rejected, 201);
    ok(submitted);
    const cNow = ok(await business.get(`/api/v1/features/${c.id}`));
    assert.equal(cNow.intake.reviews[0].status, 'REJECTED');
    assert.equal(cNow.stage, 'SUBMITTED');
  });

  test('an unchanged resubmit cannot undo a return or a binding change', async () => {
    let f = await feature(business, 'brake', 'undo');
    f = await submit(business, await addFile(business, f, { unit: 'ADC', directory: '/undo', pattern: 'u.pb' }));
    const key = Object.keys(f.draft.files)[0]!;
    f = ok(await dcl.post(`/api/v1/features/${f.id}/return`, { expectedRevision: f.revision, reason: '补充用途' }));
    expectError(await business.post(`/api/v1/features/${f.id}/submit`, { expectedRevision: f.revision }), 422, 'CHANGES_REQUESTED');

    f = ok(await business.patch(`/api/v1/features/${f.id}/files/${key}`, { expectedRevision: f.revision, purpose: '分析制动' }));
    f = await submit(business, f);
    const spec = f.draft.files[key];
    f = ok(
      await dcl.put(`/api/v1/features/${f.id}/files/${key}/binding`, {
        expectedRevision: f.revision,
        format: spec.format,
        schema: 'brake-debug@2',
        edgePipelineId: spec.edgePipelineId,
        cloudPipelineId: spec.cloudPipelineId,
        reason: '使用新 Schema',
      }),
    );
    // Switching the type away and back restores the template binding, i.e. the head content.
    f = ok(await business.patch(`/api/v1/features/${f.id}/files/${key}`, { expectedRevision: f.revision, fileType: 'text_log' }));
    f = ok(await business.patch(`/api/v1/features/${f.id}/files/${key}`, { expectedRevision: f.revision, fileType: 'bin_log' }));
    assert.equal(f.changes.sinceHead.files.changed.length, 0);
    expectError(await business.post(`/api/v1/features/${f.id}/submit`, { expectedRevision: f.revision }), 422, 'CHANGES_REQUESTED');
  });

  test('other groups\' hidden sources are not revealed by overlap suspects or ownership errors', async () => {
    const { key } = await sharedFile('hide_owner', { unit: 'ADC', directory: '/hide', pattern: 'secret.pb' });
    // A steering probe that overlaps the brake source.
    let probe = await feature(steering, 'steering', 'hide_probe');
    probe = await addFile(steering, probe, { unit: 'ADC', directory: '/hide', pattern: 's*.pb' });
    const probeKey = Object.keys(probe.draft.files)[0]!;
    assert.deepEqual(probe.dataItems[probeKey].overlapSuspects, []);
    assert.equal(probe.dataItems[probeKey].overlapsOtherGroups, true);
    const listed = ok(await steering.get('/api/v1/workspaces/team-steering/groups/steering/data-items')).find((i: any) => i.dataKey === probeKey);
    assert.deepEqual(listed.overlapSuspects, []);
    assert.equal(JSON.stringify(probe).includes(key), false, 'the brake data key must not appear');

    // An exact guess by a group without a reference names the owner but not the data key.
    ok(await admin.post('/api/v1/groups', { id: 'brake-sys', code: 'chassis.brake_sys', name: '制动系统组', domain: 'Chassis', purpose: 'DEV', orgUnitId: 'brake-team' }), 201);
    await account('brake_sys_dev', [{ role: 'BUSINESS_DEV', workspaces: ['team-brake'], groups: ['brake-sys'], envs: ['development'] }]);
    const ws = ok(await admin.get('/api/v1/workspaces/team-brake'));
    ok(await admin.patch('/api/v1/workspaces/team-brake', { expectedRevision: ws.revision, groupIds: [...ws.groupIds, 'brake-sys'] }));
    const sys = await t.login('brake_sys_dev');
    const g = await feature(sys, 'brake-sys', 'guess', 'team-brake');
    const guess = await sys.post(`/api/v1/features/${g.id}/files`, {
      expectedRevision: g.revision,
      source: { unit: 'ADC', directory: '/hide', pattern: 'secret.pb' },
      name: 'x',
      purpose: 'x',
    });
    assert.deepEqual(expectError(guess, 422, 'DATA_SOURCE_OWNED_ELSEWHERE').details, { ownerGroupId: 'brake' });
  });

  test('a reference pins the owner\'s current definition, not the highest version number', async () => {
    const { owner, key } = await sharedFile('pin_owner', { unit: 'ADC', directory: '/pin', pattern: 'p.pb' });
    let f = ok(await business.get(`/api/v1/features/${owner.id}`));
    f = ok(await business.patch(`/api/v1/features/${f.id}/files/${key}`, { expectedRevision: f.revision, retentionDays: 365 }));
    f = await submit(business, f);
    f = ok(await business.patch(`/api/v1/features/${f.id}/files/${key}`, { expectedRevision: f.revision, retentionDays: 30 }));
    f = await submit(business, f);
    let reader = await feature(steering, 'steering', 'pin_reader');
    reader = ok(await steering.put(`/api/v1/features/${reader.id}/references/${key}`, { expectedRevision: reader.revision }));
    assert.equal(reader.referencedFiles[key].version, 1);
    assert.equal(reader.referencedFiles[key].content.retentionDays, 30);
    const entry = ok(await steering.get('/api/v1/workspaces/team-steering/groups/steering/catalog')).find((c: any) => c.dataKey === key);
    assert.equal(entry.latestVersion.version, 1);
  });

  test('platform operations need every environment to administer references', async () => {
    let f = await feature(business, 'brake', 'env_owner');
    f = await submit(business, await addFile(business, f, { unit: 'ADC', directory: '/env', pattern: 'e.pb' }));
    const key = Object.keys(f.draft.files)[0]!;
    const req = ok(await steering.post('/api/v1/reference-requests', { dataKey: key, readerGroupId: 'steering', reason: 'x' }), 201);
    await account('dev_ops', [{ role: 'PLATFORM_OPS', workspaces: ['*'], envs: ['development'] }]);
    const devOps = await t.login('dev_ops');
    const res = await devOps.post(`/api/v1/reference-requests/${req.id}/decision`, { decision: 'APPROVED', reason: '' });
    assert.equal(expectError(res, 403, 'FORBIDDEN').details.reason, 'ENV_NOT_GRANTED');
  });
});
