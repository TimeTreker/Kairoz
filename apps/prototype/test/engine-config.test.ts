import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { DomainError } from '../src/domain/errors.ts';
import { reviewItems } from '../src/engine/approvals.ts';
import * as config from '../src/engine/config.ts';
import { Engine } from '../src/engine/engine.ts';
import * as identity from '../src/engine/identity.ts';
import { intakeQueue, returnFeature, reviewFile, setBinding } from '../src/engine/intake.ts';
import * as org from '../src/engine/org.ts';
import { createPipeline } from '../src/engine/processing.ts';
import * as refs from '../src/engine/references.ts';
import { commitSnapshot } from '../src/engine/snapshots.ts';
import { cleanState, demoState } from '../src/engine/seed.ts';

function fails(fn: () => unknown, code: string): DomainError {
  try {
    fn();
  } catch (e) {
    if (e instanceof DomainError && e.code === code) return e;
    throw new Error(`expected ${code}, got ${e instanceof DomainError ? e.code : e}`);
  }
  throw new Error(`expected ${code}, but it succeeded`);
}

const CONTROLS = {
  purposeConfirmed: true,
  scopeConfirmed: true,
  retentionConfirmed: true,
  accessControl: '受控',
  uploadControl: '加密上传',
  processingControl: '外部脱敏',
};

describe('clean installation', () => {
  test('has only the administrator, who cannot be removed', () => {
    const e = new Engine(cleanState());
    assert.deepEqual(Object.keys(e.getState().accounts), ['admin']);
    fails(() => e.run('admin', (c) => identity.updateAccount(c, 'admin', { status: 'DISABLED' })), 'LAST_ADMINISTRATOR');
  });

  test('blocks files until DCL publishes a template', () => {
    const e = new Engine(cleanState());
    e.run('admin', (c) => org.createVehicleModel(c, { id: 'X89', name: 'X89' }));
    e.run('admin', (c) => org.createOrgUnit(c, { id: 'team-a', name: 'A' }));
    e.run('admin', (c) => org.createGroup(c, { id: 'brake', code: 'chassis.brake', name: '制动', domain: 'Chassis', purpose: 'DEV', orgUnitId: 'team-a' }));
    e.run('admin', (c) =>
      org.createWorkspace(c, { id: 'ws', name: 'WS', kind: 'TEAM', orgUnitId: 'team-a', vehicleModelId: 'X89', groupIds: ['brake'], scopes: ['Chassis'], sourceWorkspaceIds: [] }),
    );
    e.run('admin', (c) =>
      identity.createAccount(c, {
        username: 'dev',
        displayName: 'Dev',
        grants: [{ role: 'BUSINESS_DEV', workspaces: ['ws'], groups: ['brake'], scopes: [], envs: ['development'] }],
      }),
    );
    const f = e.run('dev', (c) => config.createFeature(c, { workspaceId: 'ws', groupId: 'brake', name: 'first' }));
    const err = fails(
      () => e.run('dev', (c) => config.addFile(c, f, { source: { unit: 'ADC', directory: '/x', pattern: 'a.pb' }, name: 'a', purpose: 'p' })),
      'TEMPLATE_MISSING',
    );
    assert.deepEqual(err.details, { fileType: 'bin_log' });
  });
});

describe('demo workflow rules', () => {
  test('the demo loads with a DCL Ready Feature, one in intake and one pending reference', () => {
    const e = new Engine(demoState());
    const s = e.getState();
    const byName = (n: string) => Object.values(s.features).find((f) => f.name === n)!;
    assert.equal(byName('guided_brake').stage, 'DCL_READY');
    assert.equal(byName('parking_camera').stage, 'SUBMITTED');
    assert.deepEqual(
      e.read('dcl', (st, a) => intakeQueue(st, a).features.map((x) => x.feature.name)),
      ['parking_camera'],
    );
    assert.equal(Object.values(s.referenceRequests)[0]!.status, 'PENDING');
  });

  test('a single grant must cover workspace, group and environment; denials are audited', () => {
    const e = new Engine(demoState());
    const err = fails(() => e.run('business', (c) => config.createFeature(c, { workspaceId: 'team-steering', groupId: 'steering', name: 'nope' })), 'FORBIDDEN');
    assert.equal((err.details as { reason: string }).reason, 'WORKSPACE_NOT_GRANTED');
    const last = e.getState().audit.at(-1)!;
    assert.deepEqual([last.username, last.outcome, last.action], ['business', 'DENIED', 'feature.create']);
  });

  test('submit creates content-addressed versions and reuses unchanged ones', () => {
    const e = new Engine(demoState());
    const f = Object.values(e.getState().features).find((x) => x.name === 'guided_brake')!;
    const firstHead = f.headCommitId!;
    e.run('business', (c) =>
      config.putPolicy(c, f.id, 'chassis.brake.hard_braking', {
        name: '急刹车',
        trigger: 'brake_pressure > 80 AND vehicle_speed > 30',
        captures: Object.keys(f.draft.files),
        preSeconds: 10,
        postSeconds: 30,
      }),
    );
    assert.equal(e.getState().features[f.id]!.stage, 'DRAFT');
    const r = e.run('business', (c) => config.submitFeature(c, f.id));
    const s = e.getState();
    const [a, b] = [s.commits[firstHead]!, s.commits[r.commitId]!];
    assert.equal(b.sequence, 2);
    assert.equal(a.manifestVersionId, b.manifestVersionId, 'manifest reused');
    assert.notEqual(a.policies['chassis.brake.hard_braking'], b.policies['chassis.brake.hard_braking']);
    assert.equal(config.displayName(s, r.commitId), 'initial / chassis.brake / guided_brake / r002');
    assert.deepEqual(config.commitChanges(s, r.commitId).policies.changed, [{ key: 'chassis.brake.hard_braking', fields: ['postSeconds'] }]);
    // Unchanged content reuses the head commit.
    assert.equal(e.run('business', (c) => config.submitFeature(c, f.id)).reused, true);
  });

  test('wildcard patterns that may match video need review; overlap waits for DCL', () => {
    const e = new Engine(demoState());
    const f = e.run('business', (c) => config.createFeature(c, { workspaceId: 'team-brake', groupId: 'brake', name: 'wild' }));
    const key = e.run('business', (c) =>
      config.addFile(c, f, { source: { unit: 'ADC', directory: '/var/log/brake', pattern: 'brake_*.pb' }, name: 'all', purpose: 'p', fileType: 'bin_log' }),
    );
    const item = e.getState().dataItems[key]!;
    assert.equal(item.status, 'REVIEW', 'overlaps brake_debug.pb');
    fails(() => e.run('business', (c) => config.submitFeature(c, f)), 'SUBMIT_BLOCKED');
    e.run('dcl', (c) => config.reviewOverlap(c, key, { decision: 'DISTINCT', note: '用途不同' }));
    assert.equal(e.run('business', (c) => config.submitFeature(c, f)).stage, 'DCL_READY');

    const g = e.run('business', (c) => config.createFeature(c, { workspaceId: 'team-brake', groupId: 'brake', name: 'video_like' }));
    const k2 = e.run('business', (c) =>
      config.addFile(c, g, { source: { unit: 'ADC', directory: '/cam', pattern: 'front_*.mp?' }, name: 'v', purpose: 'p', fileType: 'bin_log' }),
    );
    assert.equal(e.getState().features[g]!.draft.files[k2]!.requiresReview, true);
  });

  test('sensitive review: approval follows content, rejection returns and revokes', () => {
    const e = new Engine(demoState());
    const f = Object.values(e.getState().features).find((x) => x.name === 'parking_camera')!;
    const key = Object.keys(f.draft.files)[0]!;
    fails(() => e.run('dcl', (c) => reviewFile(c, f.id, { commitId: f.headCommitId!, dataKey: key, decision: 'APPROVED', reason: 'ok' })), 'INCOMPLETE_CONTROLS');
    e.run('dcl', (c) => reviewFile(c, f.id, { commitId: f.headCommitId!, dataKey: key, decision: 'APPROVED', reason: 'ok', controls: CONTROLS }));
    assert.equal(e.getState().features[f.id]!.stage, 'DCL_READY');

    // Display-name change keeps the approval; a window change needs a new review.
    e.run('adc_parking', (c) => config.updateFile(c, f.id, key, { name: '环视摄像头视频' }));
    assert.equal(e.run('adc_parking', (c) => config.submitFeature(c, f.id)).stage, 'DCL_READY');
    e.run('adc_parking', (c) =>
      config.putPolicy(c, f.id, 'adc.parking.scrape_risk', { name: 'x', trigger: 'apa.active', captures: [key], preSeconds: 30, postSeconds: 5 }),
    );
    assert.equal(e.run('adc_parking', (c) => config.submitFeature(c, f.id)).stage, 'SUBMITTED');

    const head = e.getState().features[f.id]!.headCommitId!;
    e.run('dcl', (c) => reviewFile(c, f.id, { commitId: head, dataKey: key, decision: 'REJECTED', reason: '窗口过长' }));
    const after = e.getState().features[f.id]!;
    assert.equal(after.stage, 'DRAFT');
    assert.equal(e.getState().feedback.at(-1)!.kind, 'REVIEW_REJECTED');
    const items = reviewItems(e.getState(), commitSnapshot(e.getState(), head), { groupId: after.groupId, workspaceId: after.workspaceId });
    assert.equal(items[0]!.status, 'REJECTED');
  });

  test('DCL return and binding changes cannot be undone by an unchanged resubmit', () => {
    const e = new Engine(demoState());
    const f = Object.values(e.getState().features).find((x) => x.name === 'guided_brake')!;
    e.run('dcl', (c) => returnFeature(c, f.id, { reason: '补充用途' }));
    fails(() => e.run('business', (c) => config.submitFeature(c, f.id)), 'CHANGES_REQUESTED');

    const key = Object.keys(f.draft.files)[0]!;
    e.run('business', (c) => config.updateFile(c, f.id, key, { purpose: '分析制动压力' }));
    e.run('business', (c) => config.submitFeature(c, f.id));
    const cloud = e.run('dcl', (c) =>
      createPipeline(c, { code: 'default-cloud-bin-log', side: 'CLOUD', name: 'parser', formats: ['binary'], steps: ['Receive', 'Parse'], capability: 'Parse' }),
    );
    const spec = e.getState().features[f.id]!.draft.files[key]!;
    e.run('dcl', (c) => setBinding(c, f.id, key, { format: spec.format, schema: spec.schema, edgePipelineId: spec.edgePipelineId, cloudPipelineId: cloud, reason: 'parser' }));
    assert.equal(e.getState().features[f.id]!.stage, 'DRAFT');
    assert.equal(e.getState().feedback.at(-1)!.kind, 'BINDING_CHANGED');
    fails(() => e.run('business', (c) => setBinding(c, f.id, key, { ...spec, reason: 'x' })), 'FORBIDDEN');
  });

  test('references: hidden until approved, pinned, revocation returns the reader Feature', () => {
    const e = new Engine(demoState());
    const s0 = e.getState();
    const brakeKey = Object.values(s0.dataItems).find((d) => d.source.pattern === 'brake_debug.pb')!.dataKey;
    const entry = refs.referenceCatalog(s0, 'steering').find((x) => x.dataKey === brakeKey)!;
    assert.equal(entry.access, 'PENDING');
    assert.equal(entry.dataCode, undefined, 'hidden without a grant');

    const reqId = Object.keys(s0.referenceRequests)[0]!;
    fails(() => e.run('steering', (c) => refs.decideReference(c, reqId, { decision: 'APPROVED', reason: '' })), 'FORBIDDEN');
    e.run('business', (c) => refs.decideReference(c, reqId, { decision: 'APPROVED', reason: '同意' }));
    assert.equal(refs.referenceCatalog(e.getState(), 'steering').find((x) => x.dataKey === brakeKey)!.dataCode, 'chassis.brake.brake.debug');

    const f = e.run('steering', (c) => config.createFeature(c, { workspaceId: 'team-steering', groupId: 'steering', name: 'steer' }));
    e.run('steering', (c) => config.putReference(c, f, brakeKey));
    e.run('steering', (c) =>
      config.putPolicy(c, f, 'chassis.steering.sharp_turn', { name: '急转', trigger: 'steering_rate > 300', captures: [brakeKey], preSeconds: 5, postSeconds: 5 }),
    );
    const r = e.run('steering', (c) => config.submitFeature(c, f));
    assert.equal(r.stage, 'DCL_READY');
    fails(() => e.run('steering', (c) => config.updateFile(c, f, brakeKey, { purpose: 'x' })), 'NOT_FOUND');

    const returned = e.run('business', (c) => refs.revokeReference(c, reqId, { reason: '口径调整' }));
    assert.deepEqual(returned, [f]);
    assert.equal(e.getState().features[f]!.stage, 'DRAFT');
    const blocked = fails(() => e.run('steering', (c) => config.submitFeature(c, f)), 'SUBMIT_BLOCKED');
    assert.equal((blocked.details as { issues: { kind: string }[] }).issues[0]!.kind, 'reference');
  });

  test('a failed operation leaves no partial change', () => {
    const e = new Engine(demoState());
    const before = e.getState();
    fails(
      () =>
        e.run('business', (c) => {
          const f = config.createFeature(c, { workspaceId: 'team-brake', groupId: 'brake', name: 'halfway' });
          config.addFile(c, f, { source: { unit: 'ADC', directory: 'relative', pattern: 'a.pb' }, name: 'a', purpose: 'p' });
        }),
      'INVALID_SOURCE',
    );
    assert.equal(e.getState(), before);
  });
});
