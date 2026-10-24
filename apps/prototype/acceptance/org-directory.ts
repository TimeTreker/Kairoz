// 公司目录与组织授权 (O01–O06) on the demo installation. The company directory is played by the
// simulator; sync runs as the system.

import { authorize } from '../src/domain/authz.ts';
import * as dir from '../src/engine/company-directory.ts';
import * as config from '../src/engine/config.ts';
import { archiveGrantRule, confirmGrantReview, createGrantRule, grantsOf } from '../src/engine/identity.ts';
import * as org from '../src/engine/org.ts';
import { demoState } from '../src/engine/seed.ts';
import type { State } from '../src/engine/types.ts';
import * as v from '../src/engine/validation.ts';
import type { SceneSpec, World } from './world.ts';

export const start = (): State => demoState();

const employee = (w: World, username: string) => w.s.directory!.people.find((p) => p.username === username)!.employeeId;
const sync = (w: World) => w.sys((c) => dir.syncIfChanged(c));
const brakeRule = (w: World) => Object.values(w.s.grantRules).find((r) => r.orgUnitId === 'brake-team')!;
const can = (w: World, username: string, action: Parameters<typeof authorize>[1], target: Parameters<typeof authorize>[2]) => authorize(grantsOf(w.s, w.s.accounts[username]!), action, target).ok;

export const scenes: Record<string, SceneSpec> = {
  O01: {
    run: (w) => {
      w.sys((c) => dir.hirePerson(c, { username: 'brake_dev2', displayName: '何晓', deptExtId: 'brake-team' }));
      sync(w);
      const a = w.s.accounts['brake_dev2']!;
      w.eq([a.grants, a.orgUnitId, a.createdBy], [[], 'brake-team', 'directory'], 'a new account with no explicit grants');
      const f = w.as('brake_dev2', (c) => config.createFeature(c, { workspaceId: 'team-brake', groupId: 'brake', name: 'brake_wear' }));
      w.check(!!w.s.features[f], 'the base right lets them develop in the brake team');
      w.eq(w.s.audit.at(-1)!.grantId, `rule:${brakeRule(w).id}`, 'the audit names the org rule');
      const monitor = Object.values(w.s.features).find((x) => x.name === 'brake_monitor')!;
      w.denied('brake_dev2', (c) => v.verifyFeature(c, monitor.id));
      w.denied('brake_dev2', (c) => config.createFeature(c, { workspaceId: 'team-steering', groupId: 'steering', name: 'not_mine' }));
    },
  },
  O02: {
    needs: ['O01'],
    run: (w) => {
      w.sys((c) => dir.transferPerson(c, employee(w, 'business'), 'steering-team'));
      sync(w);
      const a = w.s.accounts['business']!;
      w.eq(a.orgUnitId, 'steering-team', 'the account moved with the person');
      w.check(!grantsOf(w.s, a).some((g) => g.ruleId), 'the brake team rule no longer covers them');
      w.eq([a.grantReview?.fromUnitId, a.grantReview?.toUnitId], ['brake-team', 'steering-team'], 'explicit grants wait for review');
      w.denied('business', (c) => confirmGrantReview(c, 'business'));
      w.as('admin', (c) => confirmGrantReview(c, 'business'));
      w.eq(w.s.accounts['business']!.grantReview, null, 'ops kept them');
    },
  },
  O03: {
    needs: ['O02'],
    run: (w) => {
      const before = { ws: w.s.workspaces['team-brake']!.orgUnitId, code: w.s.groups['brake']!.code, rule: brakeRule(w).orgUnitId };
      w.sys((c) => dir.renameDepartment(c, 'brake-team', '制动与线控团队'));
      sync(w);
      w.eq(w.s.orgUnits['brake-team']!.name, '制动与线控团队', 'the unit is renamed');
      w.eq({ ws: w.s.workspaces['team-brake']!.orgUnitId, code: w.s.groups['brake']!.code, rule: brakeRule(w).orgUnitId }, before, 'id, workspace, group code and rule are unchanged');
      w.eq(w.s.directorySync.log[0]!.kind, 'UNIT_RENAMED', 'the sync log records it');
    },
  },
  O04: {
    needs: ['O03'],
    run: (w) => {
      w.sys((c) => dir.mergeDepartment(c, 'hmi-team', 'cdc'));
      sync(w);
      w.eq([w.s.orgUnits['hmi-team']!.status, w.s.accounts['cdc_hmi']!.orgUnitId], ['ARCHIVED', 'cdc'], 'the unit is archived and its people moved');
      w.eq(org.orphanedOrgObjects(w.s), { workspaces: ['team-cdc-hmi'], groups: ['cdc-hmi'] }, 'its workspace and group are flagged');
      w.as('admin', (c) => org.moveWorkspaceUnit(c, 'team-cdc-hmi', 'cdc'));
      w.eq([w.s.workspaces['team-cdc-hmi']!.orgUnitId, w.s.groups['cdc-hmi']!.orgUnitId, w.s.groups['cdc-hmi']!.code], ['cdc', 'cdc', 'cdc.hmi'], 're-attached; the group moved with it and kept its code');
      w.eq(org.orphanedOrgObjects(w.s), { workspaces: [], groups: [] }, 'nothing is left orphaned');
    },
  },
  O05: {
    needs: ['O04'],
    run: (w) => {
      w.sys((c) => dir.personLeaves(c, employee(w, 'steering')));
      sync(w);
      w.eq(w.s.accounts['steering']!.status, 'DISABLED', 'the leaver is disabled');
      w.fails('UNAUTHENTICATED', () => w.as('steering', (c) => config.createFeature(c, { workspaceId: 'team-steering', groupId: 'steering', name: 'after_leaving' })));
      w.check(Object.values(w.s.commits).some((c) => c.author === 'steering'), 'history keeps them as author');
      w.sys((c) => dir.hirePerson(c, { username: 'admin', displayName: '同名人员', deptExtId: 'company' }));
      sync(w);
      w.eq([w.s.accounts['admin']!.employeeId, w.s.accounts['admin']!.status, w.s.directorySync.log[0]!.kind], [null, 'ACTIVE', 'ACCOUNT_SKIPPED'], 'the local administrator is never touched');
    },
  },
  O06: {
    needs: ['O05'],
    run: (w) => {
      w.fails('GRANT_NOT_BASE_ELIGIBLE', () => w.as('admin', (c) => createGrantRule(c, { orgUnitId: 'brake-team', includeSubunits: false, role: 'BUSINESS_TEST', workspaces: ['team-brake'], groups: ['brake'], scopes: [], envs: ['development'] })));
      w.fails('GRANT_NOT_BASE_ELIGIBLE', () => w.as('admin', (c) => createGrantRule(c, { orgUnitId: 'brake-team', includeSubunits: false, role: 'BUSINESS_DEV', workspaces: ['team-brake'], groups: ['brake'], scopes: [], envs: ['testing'] })));
      w.fails('DIRECTORY_MANAGED', () => w.as('admin', (c) => org.updateOrgUnit(c, 'brake-team', { name: '平台内改名' })));
      const target = { workspaceId: 'team-brake', groupId: 'brake', env: 'development' as const };
      w.check(can(w, 'brake_dev2', 'feature.create', target), 'before: the base right applies');
      w.as('admin', (c) => archiveGrantRule(c, brakeRule(w).id));
      w.check(!can(w, 'brake_dev2', 'feature.create', target), 'after archiving the rule its members lose it at once');
    },
  },
};
