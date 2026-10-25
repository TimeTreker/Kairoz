import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { World } from '../acceptance/world.ts';
import * as env from '../src/engine/environment.ts';
import * as fleet from '../src/engine/fleet.ts';
import * as lc from '../src/engine/lifecycle.ts';
import { createGroup, createOrgUnit, createWorkspace, updateWorkspace, visibleWorkspaces } from '../src/engine/org.ts';
import { demoState } from '../src/engine/seed.ts';

const groupId = (w: World, name: string) => Object.values(w.s.vehicleGroups).find((g) => g.name === name)!.id;
const issues = (e: { details?: unknown }) => (e.details as { issues: string[] }).issues;

/** An empty project workspace under X89, made by platform operations. */
function labWorkspace(w: World): void {
  w.as('admin', (c) => createOrgUnit(c, { id: 'x89-lab-unit', name: '试验组', parentId: 'x89' }));
  w.as('admin', (c) =>
    createWorkspace(c, { id: 'x89-lab', name: 'X89 试验区', kind: 'PROJECT', orgUnitId: 'x89-lab-unit', vehicleModelId: 'X89', groupIds: [], scopes: ['Vehicle'], sourceWorkspaceIds: [] }),
  );
}

describe('vehicle environments', () => {
  test('vehicle resources move a vehicle once it is out of its group; software and configuration stay', () => {
    const w = new World(demoState());
    const before = w.s.resources['VEH-003']!;
    const e = w.fails('ENV_MOVE_BLOCKED', () => w.as('resource', (c) => env.setResourceEnvironment(c, 'VEH-003', { env: 'testing', reason: '转入转向联调' })));
    assert.deepEqual(issues(e), ['VEH-003: routes through vehicle group 转向研发车组; take it out first']);
    w.denied('workspace_manager', (c) => env.setResourceEnvironment(c, 'VEH-003', { env: 'testing', reason: 'x' }));
    w.as('workspace_manager', (c) => fleet.removeGroupMember(c, groupId(w, '转向研发车组'), 'VEH-003', '转测试'));
    w.fails('REASON_REQUIRED', () => w.as('resource', (c) => env.setResourceEnvironment(c, 'VEH-003', { env: 'testing', reason: ' ' })));
    w.as('resource', (c) => env.setResourceEnvironment(c, 'VEH-003', { env: 'testing', reason: '转入转向联调' }));
    const r = w.s.resources['VEH-003']!;
    assert.deepEqual([r.env, r.integrationVersion, r.appliedConfigId], ['testing', before.integrationVersion, before.appliedConfigId]);
    assert.deepEqual(env.environmentHistory(w.s, 'VEH-003').map((x) => [x.from, x.to, x.by]), [['development', 'testing', 'resource']]);
    w.fails('SAME_ENVIRONMENT', () => w.as('resource', (c) => env.setResourceEnvironment(c, 'VEH-003', { env: 'testing', reason: 'x' })));
  });

  test('production takes a vehicle only on a formal set for its software, never from a team or as a simulation', () => {
    const w = new World(demoState());
    // A simulation never goes to production, whatever else is in flight.
    assert.deepEqual(env.environmentMoveProblems(w.s, w.s.resources['SIM-021']!, 'production'), ['simulation instances are for development and testing']);
    const veh1 = env.environmentMoveProblems(w.s, w.s.resources['VEH-001']!, 'production');
    assert.ok(veh1.includes('team workspace 制动团队工作区 uses it; production vehicles never serve team workspaces'));
    assert.ok(veh1.some((p) => p.startsWith('runs no formal policy set for software 1.0')));
    // A production car out of its group goes to testing and comes back: it still runs policy set 1.0.0.
    w.as('release', (c) => fleet.removeGroupMember(c, groupId(w, 'X89 量产车组'), 'VEH-202', '台架复测'));
    w.as('resource', (c) => env.setResourceEnvironment(c, 'VEH-202', { env: 'testing', reason: '台架复测' }));
    w.as('resource', (c) => env.setResourceEnvironment(c, 'VEH-202', { env: 'production', reason: '复测完成' }));
    assert.equal(w.s.resources['VEH-202']!.env, 'production');
  });
});

describe('archiving and restoring', () => {
  test('a workspace with work in flight is not archived', () => {
    const w = new World(demoState());
    const e = w.fails('ARCHIVE_BLOCKED', () => w.as('workspace_manager', (c) => lc.archiveWorkspace(c, 'team-steering', '团队合并')));
    const list = issues(e);
    assert.ok(list.includes('workspace X89 项目研发 takes it as a source'));
    assert.ok(list.some((p) => p.startsWith('Feature steering_')));
    assert.ok(list.includes('simulation SIM-022 is running'));
  });

  test('an archived workspace is closed to every action until platform operations restore it', () => {
    const w = new World(demoState());
    labWorkspace(w);
    w.fails('REASON_REQUIRED', () => w.as('admin', (c) => lc.archiveWorkspace(c, 'x89-lab', ' ')));
    w.as('admin', (c) => lc.archiveWorkspace(c, 'x89-lab', '试验结束'));
    assert.equal(w.s.workspaces['x89-lab']!.status, 'ARCHIVED');
    assert.ok(!visibleWorkspaces(w.s, w.actor('resource')).some((x) => x.id === 'x89-lab'), 'gone from the switcher');
    const denied = w.denied('resource', (c) => fleet.addWorkspaceVehicle(c, 'x89-lab', 'VEH-031'));
    assert.equal((denied.details as { reason: string }).reason, 'WORKSPACE_ARCHIVED');
    w.denied('integration_admin', (c) => lc.restoreWorkspace(c, 'x89-lab', '重开'));
    w.as('admin', (c) => lc.restoreWorkspace(c, 'x89-lab', '重开试验'));
    assert.equal(w.s.workspaces['x89-lab']!.status, 'ACTIVE');
    assert.deepEqual(lc.lifecycleOf(w.s, 'x89-lab').map((x) => [x.kind, x.reason]), [['RESTORED', '重开试验'], ['ARCHIVED', '试验结束']]);
    w.fails('NOT_ARCHIVED', () => w.as('admin', (c) => lc.restoreWorkspace(c, 'x89-lab', 'x')));
  });

  test('a business group is archived by the admin of its workspaces; no workspace takes it on', () => {
    const w = new World(demoState());
    // The project workspace also holds steering: its own admin cannot archive it alone.
    w.denied('workspace_manager', (c) => lc.archiveGroup(c, 'steering', '并入制动'));
    const blocked = w.fails('ARCHIVE_BLOCKED', () => w.as('admin', (c) => lc.archiveGroup(c, 'steering', '并入制动')));
    assert.ok(issues(blocked).includes('vehicle group 转向研发车组 has vehicles'));
    w.as('workspace_manager', (c) => createGroup(c, { id: 'brake-lab', code: 'chassis.brakelab', name: '制动预研组', domain: 'Chassis', purpose: 'DEV', orgUnitId: 'brake-team', workspaceId: 'team-brake' }));
    w.denied('adc_integrator', (c) => lc.archiveGroup(c, 'brake-lab', 'x'));
    w.as('workspace_manager', (c) => lc.archiveGroup(c, 'brake-lab', '预研结束'));
    assert.equal(w.s.groups['brake-lab']!.status, 'ARCHIVED');
    w.fails('GROUP_ARCHIVED', () => w.as('admin', (c) => updateWorkspace(c, 'x89-project', { groupIds: [...w.s.workspaces['x89-project']!.groupIds, 'brake-lab'] })));
    // The workspace that holds it keeps it, archived: it can still be edited, and it is no reason to stay archived.
    w.as('admin', (c) => updateWorkspace(c, 'team-brake', { name: '制动团队工作区（新）' }));
    assert.ok(w.s.workspaces['team-brake']!.groupIds.includes('brake-lab'));
    assert.deepEqual(lc.workspaceRestoreProblems(w.s, 'team-brake'), []);
  });

  test('an organization unit is archived only with nothing active under it; directory units follow the directory', () => {
    const w = new World(demoState());
    labWorkspace(w);
    const e = w.fails('ARCHIVE_BLOCKED', () => w.as('admin', (c) => lc.archiveOrgUnit(c, 'x89-lab-unit', '撤销')));
    assert.deepEqual(issues(e), ['workspace X89 试验区 is active']);
    w.as('admin', (c) => lc.archiveWorkspace(c, 'x89-lab', '试验结束'));
    w.as('admin', (c) => lc.archiveOrgUnit(c, 'x89-lab-unit', '撤销'));
    assert.equal(w.s.orgUnits['x89-lab-unit']!.status, 'ARCHIVED');
    assert.deepEqual(lc.workspaceRestoreProblems(w.s, 'x89-lab'), ['organization unit 试验组 is archived']);
    w.fails('DIRECTORY_MANAGED', () => w.as('admin', (c) => lc.archiveOrgUnit(c, 'brake-team', 'x')));
  });
});
