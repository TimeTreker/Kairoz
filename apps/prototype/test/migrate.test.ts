import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { migrate } from '../src/engine/migrate.ts';
import { demoState } from '../src/engine/seed.ts';
import { STATE_SCHEMA } from '../src/engine/types.ts';

/** A schema 10 save: a copy of a demo (today's by default) without the fields schema 11 added. */
function schema10(demo: unknown = demoState()): Record<string, any> {
  const s = JSON.parse(JSON.stringify(demo)) as Record<string, any>;
  s.schema = 10;
  delete s.softwareChanges;
  for (const d of Object.values(s.devices) as any[]) delete d.software;
  return s;
}

/** A schema 9 save: a schema 10 save without the fields schema 10 added. */
function schema9(demo: unknown = demoState()): Record<string, any> {
  const s = schema10(demo);
  s.schema = 9;
  delete s.softwareBuilds;
  delete s.imageChanges;
  for (const i of Object.values(s.images) as any[]) delete i.derived;
  for (const t of s.testRuns as any[]) delete t.imageId;
  return s;
}

/** A schema 8 save: a schema 9 save without the fields schema 9 added. */
function schema8(demo: unknown = demoState()): Record<string, any> {
  const s = schema9(demo);
  s.schema = 8;
  delete s.personalCaptures;
  delete s.personalTests;
  for (const r of Object.values(s.resources) as any[]) delete r.personal;
  for (const c of Object.values(s.resolvedConfigs) as any[]) delete c.draft;
  return s;
}

/** A schema 7 save: a schema 8 save without the fields schema 8 added. */
function schema7(demo: unknown = demoState()): Record<string, any> {
  const s = schema8(demo);
  s.schema = 7;
  for (const key of ['applicability', 'applicabilityChecks', 'emergencyStops', 'grantRules', 'directory', 'directorySync']) delete s[key];
  for (const c of Object.values(s.resolvedConfigs) as any[]) delete c.disabledPolicies;
  for (const r of Object.values(s.releases) as any[]) delete r.emergency;
  for (const v of Object.values(s.softwareVersions) as any[]) delete v.manifest;
  for (const g of Object.values(s.vehicleGroups) as any[]) {
    const p = g.publication;
    g.targetConfigId =
      !p ? null
      : p.kind === 'FEATURE' ? Object.values(s.resolvedConfigs).find((c: any) => c.kind === 'FEATURE' && c.sourceId === p.featureId && Object.values(c.groups).includes(p.commitId))!['id' as never]
      : p.configId;
    delete g.publication;
    delete g.baseReleaseId;
  }
  for (const a of Object.values(s.accounts) as any[]) {
    delete a.orgUnitId;
    delete a.employeeId;
    delete a.grantReview;
  }
  for (const u of Object.values(s.orgUnits) as any[]) {
    delete u.source;
    delete u.externalId;
  }
  return s;
}

/** A schema 6 save: a schema 7 save without the fields schema 7 added. */
function schema6(): Record<string, any> {
  const s = schema7();
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
    for (const key of ['features', 'commits', 'deployments', 'receipts', 'events', 'audit'] as const) {
      assert.deepEqual((migrated as unknown as Record<string, unknown>)[key], before[key], key);
    }
  });

  test('a schema 7 save keeps its group bindings as publications and gains empty defaults', () => {
    const current = JSON.parse(JSON.stringify(demoState()));
    const migrated = migrate(schema7(current))!;
    assert.equal(migrated.schema, STATE_SCHEMA);
    for (const [id, g] of Object.entries(migrated.vehicleGroups)) {
      assert.deepEqual(g.publication, current.vehicleGroups[id].publication, g.name);
      assert.equal('targetConfigId' in g, false);
      assert.equal(g.baseReleaseId, null);
    }
    for (const a of Object.values(migrated.accounts)) assert.deepEqual([a.orgUnitId, a.employeeId, a.grantReview], [null, null, null]);
    for (const u of Object.values(migrated.orgUnits)) assert.equal(u.source, 'PLATFORM');
    for (const c of Object.values(migrated.resolvedConfigs)) assert.deepEqual(c.disabledPolicies, []);
    assert.deepEqual(migrated.applicability, []);
    assert.equal(migrated.directory, null);
    assert.deepEqual(migrated.releases, current.releases);
  });

  test('a schema 10 save gains device software and an empty change log', () => {
    const current = JSON.parse(JSON.stringify(demoState()));
    const migrated = migrate(schema10(current))!;
    assert.equal(migrated.schema, STATE_SCHEMA);
    for (const d of Object.values(migrated.devices)) assert.equal(d.software, null);
    assert.deepEqual(migrated.softwareChanges, {});
    assert.deepEqual(migrated, current);
  });

  test('a schema 9 save pins old test results to the image the vehicle runs', () => {
    const current = JSON.parse(JSON.stringify(demoState()));
    const migrated = migrate(schema9(current))!;
    assert.equal(migrated.schema, STATE_SCHEMA);
    for (const t of migrated.testRuns) assert.equal(t.imageId, migrated.resources[t.resourceId]!.imageId, t.id);
    assert.deepEqual([migrated.softwareBuilds, migrated.imageChanges], [{}, {}]);
    assert.deepEqual(migrated, current);
  });

  test('a schema 8 save gains personal simulation defaults and keeps everything else', () => {
    const current = JSON.parse(JSON.stringify(demoState()));
    const migrated = migrate(schema8(current))!;
    assert.equal(migrated.schema, STATE_SCHEMA);
    for (const r of Object.values(migrated.resources)) assert.equal(r.personal, null, r.id);
    for (const c of Object.values(migrated.resolvedConfigs)) assert.equal(c.draft, null, c.id);
    assert.deepEqual([migrated.personalCaptures, migrated.personalTests], [{}, {}]);
    assert.deepEqual(migrated, current);
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
