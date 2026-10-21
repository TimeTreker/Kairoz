import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { DomainError } from '../src/domain/errors.ts';
import type { Actor } from '../src/engine/engine.ts';
import { Engine } from '../src/engine/engine.ts';
import * as ev from '../src/engine/events.ts';
import { demoState } from '../src/engine/seed.ts';
import { tick } from '../src/engine/simulator.ts';

function fails(fn: () => unknown, code: string): DomainError {
  try {
    fn();
  } catch (e) {
    if (e instanceof DomainError && e.code === code) return e;
    throw new Error(`expected ${code}, got ${e instanceof DomainError ? `${e.code} ${JSON.stringify(e.details)}` : e}`);
  }
  throw new Error(`expected ${code}, but it succeeded`);
}

function setup() {
  const e = new Engine(demoState());
  const actor = (username: string): Actor => {
    const a = e.getState().accounts[username]!;
    return { username, displayName: a.displayName, grants: a.grants };
  };
  return { e, actor };
}

describe('collection events', () => {
  test('an event pins the configuration it ran under and captures only the policy’s files', () => {
    const { e } = setup();
    const s = e.getState();
    const prod = Object.values(s.events).filter((x) => x.resourceId === 'VEH-201');
    assert.equal(prod.length, 3);
    const first = prod[0]!;
    assert.equal(s.releases[first.releaseId!]!.dclVersion, '1.0.0');
    assert.equal(first.postSeconds, 10, 'DCL 1.0.0 still has the 10 s window');
    assert.equal(s.policyVersions[first.policyVersionId]!.content.postSeconds, 10);
    const dev = Object.values(s.events).find((x) => x.resourceId === 'VEH-003' && x.policyId === 'chassis.steering.angle_jump')!;
    assert.equal(dev.postSeconds, 15, 'the development vehicle runs the Feature with the longer window');
    assert.equal(dev.releaseId, null);
    assert.deepEqual(
      first.files.map((f) => f.name),
      ['EPS 转向轨迹'],
    );
    assert.equal(s.fileSpecVersions[first.files[0]!.fileSpecVersionId]!.dataKey, first.files[0]!.dataKey);
  });

  test('queries stay inside one grant: workspace, group, environment; platform ops sees nothing', () => {
    const { e, actor } = setup();
    const s = e.getState();
    const count = (user: string, ws: string) => ev.visibleEvents(s, actor(user), ws).length;
    assert.equal(count('steering', 'team-steering'), 3);
    assert.equal(count('steering', 'x89-project'), 0, 'production events belong to the project workspace');
    assert.equal(count('business', 'team-brake'), 0);
    assert.equal(count('release', 'x89-project'), 5);
    assert.equal(count('integrator', 'x89-project'), 0, 'the integrator has no production grant');
    assert.equal(count('dcl', 'x89-project'), 5);
    assert.equal(count('admin', 'x89-project'), 0);
    assert.equal(count('dispatch_operator', 'team-brake'), 0);
    // After-sales filters narrow, never widen.
    assert.equal(ev.aftersalesQuery(s, actor('steering'), 'team-steering', { vehicle: 'VEH-201' }).length, 0);
    assert.equal(ev.aftersalesQuery(s, actor('release'), 'x89-project', { vehicle: 'LSDEM0X8900000201' }).length, 3);
    assert.equal(ev.aftersalesQuery(s, actor('release'), 'x89-project', { status: 'FAILED' })[0]!.failure?.startsWith('ParserFailure'), true);
  });

  test('training data: only selectable by default, no vehicle identity, exports re-check every item', () => {
    const { e, actor } = setup();
    const s = e.getState();
    const selectable = ev.trainingQuery(s, actor('release'), 'x89-project', {});
    assert.deepEqual(selectable.map((t) => t.quality).sort(), ['A', 'B']);
    const all = ev.trainingQuery(s, actor('release'), 'x89-project', { availability: 'ALL' });
    assert.equal(all.length, 5);
    assert.ok(all.some((t) => t.blockers.includes('quality unknown') && t.blockers.includes('training use not confirmed')));
    for (const key of ['resourceId', 'vin', 'uvid', 'licensePlate', 'integrationVersion']) assert.ok(!(key in all[0]!), `${key} is not in training records`);

    const failed = all.find((t) => t.status === 'FAILED')!;
    fails(() => e.run('release', (c) => ev.exportManifest(c, [failed.eventId])), 'NOT_SELECTABLE');
    fails(() => e.run('steering', (c) => ev.exportManifest(c, [selectable[0]!.eventId])), 'FORBIDDEN');
    const manifest = e.run('release', (c) => ev.exportManifest(c, selectable.map((t) => t.eventId)));
    assert.equal(manifest.items.length, 2);
    assert.equal(manifest.items[0]!.dclVersion, '1.0.0');
    assert.match(manifest.items[0]!.files[0]!.artifactUri, /^dcl:\/\/artifacts\//);
    assert.ok(!JSON.stringify(manifest).includes('LSDEM0X89'), 'no VIN in the manifest');
  });

  test('the simulator processes new events; DCL reprocesses parser failures with the pinned versions', () => {
    const { e, actor } = setup();
    fails(() => e.run(null, (c) => ev.captureEvent(c, { resourceId: 'VEH-001', policyId: 'chassis.brake.hard_braking' })), 'NO_APPLIED_CONFIG');
    fails(() => e.run(null, (c) => ev.captureEvent(c, { resourceId: 'VEH-201', policyId: 'chassis.steering.return_rate' })), 'POLICY_NOT_ON_VEHICLE');
    const id = e.run(null, (c) => ev.captureEvent(c, { resourceId: 'VEH-003', policyId: 'chassis.steering.return_rate' }));
    assert.equal(e.getState().events[id]!.status, 'UPLOADING');
    e.run(null, (c) => tick(c));
    e.run(null, (c) => tick(c));
    const done = e.getState().events[id]!;
    assert.equal(done.status, 'DONE');
    assert.deepEqual([done.quality, done.trainingUse], ['UNKNOWN', 'UNCONFIRMED'], 'finishing never proves quality or use');
    assert.ok(!ev.trainingQuery(e.getState(), actor('steering'), 'team-steering', {}).some((t) => t.eventId === id));

    const failed = Object.values(e.getState().events).find((x) => x.resourceId === 'VEH-003' && x.status === 'FAILED')!;
    fails(() => e.run('steering', (c) => ev.reprocessEvent(c, failed.id)), 'FORBIDDEN');
    fails(() => e.run('dcl', (c) => ev.reprocessEvent(c, id)), 'EVENT_NOT_FAILED');
    e.run('dcl', (c) => ev.reprocessEvent(c, failed.id));
    e.run(null, (c) => tick(c));
    const fixed = e.getState().events[failed.id]!;
    assert.equal(fixed.status, 'DONE');
    assert.equal(fixed.processingAttempts, 2);
    assert.equal(fixed.files[0]!.fileSpecVersionId, failed.files[0]!.fileSpecVersionId, 'reprocessing keeps the pinned versions');
    assert.equal(fixed.files[0]!.artifactUri, `dcl://artifacts/${failed.id}/${failed.files[0]!.dataKey}`);
  });
});
