import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { World } from '../acceptance/world.ts';
import { authorize } from '../src/domain/authz.ts';
import * as dir from '../src/engine/company-directory.ts';
import * as config from '../src/engine/config.ts';
import { archiveGrantRule, confirmGrantReview, createGrantRule, grantsOf, replaceGrants } from '../src/engine/identity.ts';
import * as org from '../src/engine/org.ts';
import { demoState } from '../src/engine/seed.ts';

const employee = (w: World, username: string) => w.s.directory!.people.find((p) => p.username === username)!.employeeId;
const sync = (w: World) => w.sys((c) => dir.syncIfChanged(c));
const devInBrake = (w: World, username: string) => authorize(grantsOf(w.s, w.s.accounts[username]!), 'feature.create', { workspaceId: 'team-brake', groupId: 'brake', env: 'development' }).ok;

describe('company directory and base grants', () => {
  test('the demo team tree and people come from the directory; the platform administrator stays local', () => {
    const w = new World(demoState());
    for (const id of ['company', 'chassis', 'brake-team', 'vehicle-integration']) {
      assert.deepEqual([w.s.orgUnits[id]!.source, w.s.orgUnits[id]!.externalId], ['DIRECTORY', id]);
    }
    assert.equal(w.s.orgUnits['x89']!.source, 'PLATFORM', 'project trees are the platform’s');
    assert.deepEqual([w.s.accounts['business']!.orgUnitId, w.s.accounts['release']!.orgUnitId], ['brake-team', 'vehicle-integration']);
    assert.deepEqual([w.s.accounts['admin']!.orgUnitId, w.s.accounts['admin']!.employeeId], [null, null]);
    assert.equal(w.s.directorySync.revision, w.s.directory!.revision);
    // business has both its explicit grant and the brake team's base grant; each is one complete grant.
    assert.deepEqual(grantsOf(w.s, w.s.accounts['business']!).map((g) => g.ruleId ?? 'explicit'), ['explicit', Object.keys(w.s.grantRules)[0]]);
  });

  test('a new hire gets base rights from the rule and nothing else; the audit names the rule', () => {
    const w = new World(demoState());
    w.sys((c) => dir.hirePerson(c, { username: 'brake_dev2', displayName: '何晓', deptExtId: 'brake-team' }));
    sync(w);
    const account = w.s.accounts['brake_dev2']!;
    assert.deepEqual([account.grants, account.orgUnitId, account.createdBy], [[], 'brake-team', 'directory']);
    const feature = w.as('brake_dev2', (c) => config.createFeature(c, { workspaceId: 'team-brake', groupId: 'brake', name: 'brake_wear' }));
    assert.ok(w.s.features[feature]);
    assert.match(w.s.audit.at(-1)!.grantId!, /^rule:/);
    // Testing and other special rights are never base rights.
    assert.equal(authorize(grantsOf(w.s, account), 'feature.recordTest', { workspaceId: 'team-brake', groupId: 'brake', env: 'development' }).ok, false);
    assert.equal(authorize(grantsOf(w.s, account), 'feature.create', { workspaceId: 'team-steering', groupId: 'steering', env: 'development' }).ok, false);
    w.fails('GRANT_NOT_BASE_ELIGIBLE', () => w.as('admin', (c) => createGrantRule(c, { orgUnitId: 'brake-team', includeSubunits: false, role: 'BUSINESS_TEST', workspaces: ['team-brake'], groups: ['brake'], scopes: [], envs: ['development'] })));
    w.fails('GRANT_NOT_BASE_ELIGIBLE', () => w.as('admin', (c) => createGrantRule(c, { orgUnitId: 'brake-team', includeSubunits: false, role: 'BUSINESS_DEV', workspaces: ['team-brake'], groups: ['brake'], scopes: [], envs: ['testing'] })));
    w.fails('UNIT_NOT_TEAM', () => w.as('admin', (c) => createGrantRule(c, { orgUnitId: 'x89', includeSubunits: true, role: 'BUSINESS_DEV', workspaces: ['team-brake'], groups: ['brake'], scopes: [], envs: ['development'] })));
    // Archiving the rule takes the base right away at once.
    w.as('admin', (c) => archiveGrantRule(c, Object.keys(w.s.grantRules)[0]!));
    assert.equal(devInBrake(w, 'brake_dev2'), false);
  });

  test('a transfer moves base rights with the person and flags explicit grants for review', () => {
    const w = new World(demoState());
    w.sys((c) => dir.transferPerson(c, employee(w, 'business'), 'steering-team'));
    sync(w);
    const a = w.s.accounts['business']!;
    assert.equal(a.orgUnitId, 'steering-team');
    assert.equal(grantsOf(w.s, a).some((g) => g.ruleId), false, 'the brake team rule no longer covers them');
    assert.equal(devInBrake(w, 'business'), true, 'the explicit grant stays until reviewed');
    assert.deepEqual([a.grantReview?.fromUnitId, a.grantReview?.toUnitId], ['brake-team', 'steering-team']);
    w.fails('FORBIDDEN', () => w.as('business', (c) => confirmGrantReview(c, 'business')));
    w.as('admin', (c) => confirmGrantReview(c, 'business'));
    assert.equal(w.s.accounts['business']!.grantReview, null);
    w.fails('NO_REVIEW_PENDING', () => w.as('admin', (c) => confirmGrantReview(c, 'business')));
    // Someone without explicit grants has nothing to review.
    w.sys((c) => dir.hirePerson(c, { username: 'brake_dev2', displayName: '何晓', deptExtId: 'brake-team' }));
    sync(w);
    w.sys((c) => dir.transferPerson(c, employee(w, 'brake_dev2'), 'hmi-team'));
    sync(w);
    assert.equal(w.s.accounts['brake_dev2']!.grantReview, null);
    w.as('admin', (c) => replaceGrants(c, 'business', []));
    assert.equal(w.s.accounts['business']!.grantReview, null);
  });

  test('renames change nothing else; a merged department archives its unit until workspaces are re-attached', () => {
    const w = new World(demoState());
    w.sys((c) => dir.renameDepartment(c, 'brake-team', '制动与线控团队'));
    sync(w);
    assert.equal(w.s.orgUnits['brake-team']!.name, '制动与线控团队');
    assert.equal(w.s.workspaces['team-brake']!.orgUnitId, 'brake-team');

    w.sys((c) => dir.mergeDepartment(c, 'hmi-team', 'cdc'));
    sync(w);
    assert.equal(w.s.orgUnits['hmi-team']!.status, 'ARCHIVED');
    assert.equal(w.s.accounts['cdc_hmi']!.orgUnitId, 'cdc');
    assert.deepEqual(org.orphanedOrgObjects(w.s), { workspaces: ['team-cdc-hmi'], groups: ['cdc-hmi'] });
    w.fails('UNIT_ARCHIVED', () => w.as('admin', (c) => org.moveWorkspaceUnit(c, 'team-cdc-hmi', 'hmi-team')));
    w.as('admin', (c) => org.moveWorkspaceUnit(c, 'team-cdc-hmi', 'cdc'));
    assert.deepEqual([w.s.workspaces['team-cdc-hmi']!.orgUnitId, w.s.groups['cdc-hmi']!.orgUnitId, w.s.groups['cdc-hmi']!.code], ['cdc', 'cdc', 'cdc.hmi']);
    assert.deepEqual(org.orphanedOrgObjects(w.s), { workspaces: [], groups: [] });

    // The directory's units are read-only here.
    w.fails('DIRECTORY_MANAGED', () => w.as('admin', (c) => org.updateOrgUnit(c, 'brake-team', { name: '改名' })));
    w.fails('DIRECTORY_MANAGED', () => w.as('admin', (c) => org.createOrgUnit(c, { id: 'brake-sub', name: '子组', parentId: 'brake-team' })));
  });

  test('a leaver is disabled and keeps their history; local accounts are never touched', () => {
    const w = new World(demoState());
    w.sys((c) => dir.personLeaves(c, employee(w, 'business')));
    sync(w);
    assert.equal(w.s.accounts['business']!.status, 'DISABLED');
    w.fails('UNAUTHENTICATED', () => w.as('business', (c) => config.createFeature(c, { workspaceId: 'team-brake', groupId: 'brake', name: 'left_over' })));
    assert.ok(Object.values(w.s.commits).some((c) => c.author === 'business'), 'history keeps them as author');
    w.sys((c) => dir.hirePerson(c, { username: 'admin', displayName: '同名', deptExtId: 'company' }));
    sync(w);
    assert.equal(w.s.accounts['admin']!.employeeId, null);
    assert.equal(w.s.directorySync.log[0]!.kind, 'ACCOUNT_SKIPPED');
  });
});
