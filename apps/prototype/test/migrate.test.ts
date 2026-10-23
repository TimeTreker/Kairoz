import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { migrate } from '../src/engine/migrate.ts';
import { demoState } from '../src/engine/seed.ts';
import { STATE_SCHEMA } from '../src/engine/types.ts';

/** A schema 6 save: today's demo without the fields schema 7 added. */
function schema6(): Record<string, unknown> {
  const s = JSON.parse(JSON.stringify(demoState())) as Record<string, any>;
  s.schema = 6;
  delete s.subsystemReleases;
  delete s.clientReports;
  delete s.devices;
  for (const p of Object.values(s.mergePlans) as any[]) {
    delete p.scope;
    delete p.subsystems;
    for (const c of p.conflicts) delete c.subsystemReleaseIds;
  }
  for (const c of Object.values(s.candidates) as any[]) {
    delete c.scope;
    delete c.subsystems;
  }
  for (const r of Object.values(s.resources) as any[]) delete r.deviceKey;
  return s;
}

describe('saved state migration', () => {
  test('a schema 6 save upgrades to the current schema and keeps everything it had', () => {
    const old = schema6();
    const before = JSON.parse(JSON.stringify(old)) as Record<string, unknown>;
    const migrated = migrate(old)!;
    assert.equal(migrated.schema, STATE_SCHEMA);
    for (const p of Object.values(migrated.mergePlans)) {
      assert.equal(p.scope, 'Vehicle');
      assert.deepEqual(p.subsystems, []);
    }
    for (const c of Object.values(migrated.candidates)) assert.equal(c.scope, 'Vehicle');
    assert.deepEqual(migrated.subsystemReleases, {});
    // Everything the save had is still there, unchanged.
    for (const key of ['accounts', 'features', 'commits', 'releases', 'deployments', 'receipts', 'events', 'audit'] as const) {
      assert.deepEqual((migrated as unknown as Record<string, unknown>)[key], before[key], key);
    }
  });

  test('a current save passes through unchanged', () => {
    const current = JSON.parse(JSON.stringify(demoState()));
    assert.deepEqual(migrate(JSON.parse(JSON.stringify(current))), current);
  });

  test('saves that are too old, from a newer version, or not a platform are not read', () => {
    assert.equal(migrate({ schema: 5 }), null);
    assert.equal(migrate({ schema: STATE_SCHEMA + 1 }), null);
    assert.equal(migrate({}), null);
    assert.equal(migrate('nope'), null);
  });
});
