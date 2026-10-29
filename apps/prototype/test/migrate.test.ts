import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { migrate } from '../src/engine/migrate.ts';
import { demoState } from '../src/engine/seed.ts';
import { STATE_SCHEMA } from '../src/engine/types.ts';

/**
 * A demo without the test groups' pushes of the set mapped to their software (schema 26): a save
 * from before schema 13 had no triggers, and its migration reads every dispatch as a person's.
 */
function withoutBaselines(demo: Record<string, any>): Record<string, any> {
  for (const [id, d] of Object.entries(demo.deployments) as [string, any][]) if (d.kind === 'BASELINE') delete demo.deployments[id];
  return demo;
}

/** A schema 20 save: a copy of a demo (today's by default) without the rollout logs schema 21 added. */
function schema20(demo: unknown = demoState()): Record<string, any> {
  const s = JSON.parse(JSON.stringify(demo)) as Record<string, any>;
  s.schema = 20;
  for (const d of Object.values(s.deployments) as any[]) {
    delete d.log;
    for (const t of d.targets) delete t.software;
  }
  return s;
}

/** A schema 16 save: a copy of a demo (today's by default) without the fields schema 17 added. */
function schema16(demo: unknown = demoState()): Record<string, any> {
  const s = JSON.parse(JSON.stringify(demo)) as Record<string, any>;
  s.schema = 16;
  delete s.collectionBudgets;
  delete s.collectionHolds;
  for (const e of Object.values(s.events) as any[]) for (const k of ['priority', 'cost', 'writtenAt', 'uploadAt', 'budgetNote']) delete e[k];
  return s;
}

/** A schema 15 save: a copy of a demo (today's by default) without the fields schema 16 added. */
function schema15(demo: unknown = demoState()): Record<string, any> {
  const s = JSON.parse(JSON.stringify(demo)) as Record<string, any>;
  s.schema = 15;
  for (const r of Object.values(s.releases) as any[]) delete r.patchOf;
  for (const p of Object.values(s.mergePlans) as any[]) delete p.patch;
  for (const c of Object.values(s.candidates) as any[]) delete c.patch;
  return s;
}

/** A schema 13 save: a schema 15 save without the fields schema 14 added. */
function schema13(demo: unknown = demoState()): Record<string, any> {
  const s = schema15(demo);
  s.schema = 13;
  delete s.environmentChanges;
  delete s.lifecycleEvents;
  return s;
}

/** A schema 12 save: a schema 13 save without the fields schema 13 added. */
function schema12(demo: unknown = demoState()): Record<string, any> {
  const s = schema13(demo);
  s.schema = 12;
  for (const d of Object.values(s.deployments) as any[]) {
    delete d.trigger;
    for (const t of d.targets) delete t.pushedAt;
  }
  for (const c of Object.values(s.softwareChanges) as any[]) delete c.requestId;
  delete s.groupFollows;
  delete s.vehicleSoftwareRequests;
  delete s.loans;
  delete s.clockOffsetMs;
  return s;
}

/** A schema 11 save: a schema 12 save without the fields schema 12 added. */
function schema11(demo: unknown = demoState()): Record<string, any> {
  const s = schema12(demo);
  s.schema = 11;
  delete s.notificationReads;
  return s;
}

/** A schema 10 save: a schema 11 save without the fields schema 11 added. */
function schema10(demo: unknown = demoState()): Record<string, any> {
  const s = schema11(demo);
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
    // Everything the save had is still there, unchanged; deployments only gain how they were sent.
    for (const key of ['features', 'commits', 'receipts', 'events', 'audit'] as const) {
      assert.deepEqual((migrated as unknown as Record<string, unknown>)[key], before[key], key);
    }
    for (const [id, d] of Object.entries(migrated.deployments)) {
      const { trigger, targets, ...rest } = d;
      const { targets: oldTargets, ...oldRest } = (before.deployments as Record<string, any>)[id];
      assert.equal(trigger, 'DISPATCH');
      assert.deepEqual(rest, oldRest, id);
      assert.deepEqual(targets.map(({ pushedAt: _, ...t }) => t), oldTargets, id);
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

  test('a schema 20 save gives each rollout the start and end its records show, and each vehicle its current software', () => {
    const current = JSON.parse(JSON.stringify(demoState()));
    const migrated = migrate(schema20(current))!;
    assert.equal(migrated.schema, STATE_SCHEMA);
    const rollouts = Object.values(migrated.deployments).filter((d) => d.kind === 'OTA');
    assert.ok(rollouts.length > 0);
    for (const d of rollouts) assert.deepEqual(d.log!.map((x) => x.kind), ['STARTED', 'COMPLETED'], d.id);
    for (const d of Object.values(migrated.deployments).filter((x) => x.kind !== 'OTA')) assert.equal(d.log, undefined, d.id);
    assert.deepEqual(migrated, current);
  });

  test('a schema 16 save gains empty budgets and pauses; its events cost nothing and keep their policy’s priority', () => {
    const current = JSON.parse(JSON.stringify(demoState()));
    const migrated = migrate(schema16(current))!;
    assert.equal(migrated.schema, STATE_SCHEMA);
    assert.deepEqual([migrated.collectionBudgets, migrated.collectionHolds], [{ models: {}, vehicles: {} }, {}]);
    for (const e of Object.values(migrated.events)) {
      assert.deepEqual([e.cost, e.writtenAt, e.uploadAt, e.budgetNote], [null, e.occurredAt, e.occurredAt, null], e.id);
      assert.equal(e.priority, migrated.policyVersions[e.policyVersionId]!.content.priority);
    }
    assert.deepEqual(migrated.features, current.features);
  });

  test('a schema 15 save puts every policy set, preview and candidate on the mainline', () => {
    const current = JSON.parse(JSON.stringify(demoState()));
    const migrated = migrate(schema15(current))!;
    assert.equal(migrated.schema, STATE_SCHEMA);
    for (const r of Object.values(migrated.releases)) assert.equal(r.patchOf, null, r.dclVersion);
    for (const p of Object.values(migrated.mergePlans)) assert.equal(p.patch, null, p.id);
    for (const c of Object.values(migrated.candidates)) assert.equal(c.patch, null, c.label);
    assert.deepEqual(migrated, current);
  });

  test('a schema 13 save gains empty environment moves and lifecycle history', () => {
    const current = JSON.parse(JSON.stringify(demoState()));
    const migrated = migrate(schema13(current))!;
    assert.equal(migrated.schema, STATE_SCHEMA);
    assert.deepEqual([migrated.environmentChanges, migrated.lifecycleEvents], [[], []]);
    assert.deepEqual(migrated, current);
  });

  test('a schema 12 save counts finished targets as pushed and gains empty loans and follows', () => {
    const current = withoutBaselines(JSON.parse(JSON.stringify(demoState())));
    const migrated = migrate(schema12(current))!;
    assert.equal(migrated.schema, STATE_SCHEMA);
    assert.deepEqual([migrated.groupFollows, migrated.vehicleSoftwareRequests, migrated.loans, migrated.clockOffsetMs], [{}, {}, {}, 0]);
    assert.ok(Object.values(migrated.deployments).every((d) => d.trigger === 'DISPATCH'));
    assert.deepEqual(migrated, current);
  });

  test('a schema 11 save gains empty notification read marks', () => {
    const current = withoutBaselines(JSON.parse(JSON.stringify(demoState())));
    const migrated = migrate(schema11(current))!;
    assert.equal(migrated.schema, STATE_SCHEMA);
    assert.deepEqual(migrated.notificationReads, {});
    assert.deepEqual(migrated, current);
  });

  test('a schema 10 save gains device software (a car runs what was recorded) and an empty change log', () => {
    const current = withoutBaselines(JSON.parse(JSON.stringify(demoState())));
    const migrated = migrate(schema10(current))!;
    assert.equal(migrated.schema, STATE_SCHEMA);
    for (const [id, d] of Object.entries(migrated.devices)) {
      const r = migrated.resources[id]!;
      assert.equal(d.software, r.type === 'PHYSICAL' ? r.integrationVersion : null, id);
    }
    assert.deepEqual(migrated.softwareChanges, {});
    assert.deepEqual(migrated, current);
  });

  test('a schema 9 save pins old test results to the image the vehicle runs', () => {
    const current = withoutBaselines(JSON.parse(JSON.stringify(demoState())));
    const migrated = migrate(schema9(current))!;
    assert.equal(migrated.schema, STATE_SCHEMA);
    for (const t of migrated.testRuns) assert.equal(t.imageId, migrated.resources[t.resourceId]!.imageId, t.id);
    assert.deepEqual([migrated.softwareBuilds, migrated.imageChanges], [{}, {}]);
    assert.deepEqual(migrated, current);
  });

  test('a schema 8 save gains personal simulation defaults and keeps everything else', () => {
    const current = withoutBaselines(JSON.parse(JSON.stringify(demoState())));
    const migrated = migrate(schema8(current))!;
    assert.equal(migrated.schema, STATE_SCHEMA);
    for (const r of Object.values(migrated.resources)) assert.equal(r.personal, null, r.id);
    for (const c of Object.values(migrated.resolvedConfigs)) assert.equal(c.draft, null, c.id);
    assert.deepEqual([migrated.personalCaptures, migrated.personalTests], [{}, {}]);
    assert.deepEqual(migrated, current);
  });

  test('a schema 25 save reads PLM’s versions as released and links no test version', () => {
    const current = JSON.parse(JSON.stringify(demoState()));
    const old = JSON.parse(JSON.stringify(current));
    old.schema = 25;
    for (const v of old.plm.versions) {
      delete v.stage;
      delete v.releasedAt;
    }
    for (const v of Object.values(old.softwareVersions) as any[]) {
      delete v.testOf;
      delete v.issuedForTest;
      delete v.releasedAt;
    }
    const migrated = migrate(old)!;
    assert.equal(migrated.schema, STATE_SCHEMA);
    assert.ok(migrated.plm.versions.every((v) => v.stage === 'RELEASED' && v.releasedAt === v.publishedAt));
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
