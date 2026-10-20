import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { seedDemo } from '../src/demo/seed.ts';
import { ok, startTestApp } from './helpers.ts';
import type { TestApp } from './helpers.ts';

let t: TestApp;
before(async () => {
  t = await startTestApp();
});
after(() => t.close());

test('the demo data loads through the API into a clean installation, once', async () => {
  const log = await seedDemo(t.app);
  assert.ok(log.some((l) => /guided_brake submitted as initial \/ chassis\.brake \/ guided_brake \/ r001 \(DCL_READY\)/.test(l)));
  assert.ok(log.some((l) => /parking_camera submitted \(SUBMITTED/.test(l)));
  const dcl = await t.login('dcl');
  const queue = ok(await dcl.get('/api/v1/intake'));
  assert.deepEqual(
    queue.features.map((f: any) => f.name),
    ['parking_camera'],
  );
  const business0 = await t.login('business');
  const pending = ok(await business0.get('/api/v1/reference-requests?groupId=brake&side=owner&status=PENDING'));
  assert.equal(pending.length, 1);
  const business = await t.login('business');
  const features = ok(await business.get('/api/v1/workspaces/team-brake/features'));
  assert.deepEqual(
    features.map((f: any) => [f.name, f.stage]),
    [['guided_brake', 'DCL_READY']],
  );
  await assert.rejects(seedDemo(t.app), /clean installation/);
});
