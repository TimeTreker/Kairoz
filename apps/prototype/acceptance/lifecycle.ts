// 车辆环境迁移与组织归档 (LV01–LV07, N01) on the demo installation: vehicle resources move a car
// to testing once it left its group, production only takes a car on a formal set for its
// software, and a production car can go to the test bench and back. Workspaces, business groups
// and organization units are archived only with nothing in flight; an archived workspace is
// closed until platform operations restore it.

import * as env from '../src/engine/environment.ts';
import * as fleet from '../src/engine/fleet.ts';
import * as lc from '../src/engine/lifecycle.ts';
import * as nc from '../src/engine/notifications.ts';
import { createGroup, createOrgUnit, createWorkspace, updateWorkspace, visibleWorkspaces } from '../src/engine/org.ts';
import { demoState } from '../src/engine/seed.ts';
import type { State } from '../src/engine/types.ts';
import type { SceneSpec, World } from './world.ts';

export const start = (): State => demoState();

const group = (w: World, name: string) => Object.values(w.s.vehicleGroups).find((g) => g.name === name)!.id;
const issues = (e: { details?: unknown }) => (e.details as { issues: string[] }).issues;

export const scenes: Record<string, SceneSpec> = {
  LV01: {
    run: (w) => {
      const before = w.s.resources['VEH-003']!;
      const e = w.fails('ENV_MOVE_BLOCKED', () => w.as('resource', (c) => env.setResourceEnvironment(c, 'VEH-003', { env: 'testing', reason: '转入转向联调' })));
      w.eq(issues(e), ['VEH-003: routes through vehicle group 转向研发车组; take it out first'], 'out of its group first');
      w.as('workspace_manager', (c) => fleet.removeGroupMember(c, group(w, '转向研发车组'), 'VEH-003', '转测试环境'));
      w.as('resource', (c) => env.setResourceEnvironment(c, 'VEH-003', { env: 'testing', reason: '转入转向联调' }));
      const r = w.s.resources['VEH-003']!;
      w.eq([r.env, r.integrationVersion, r.appliedConfigId], ['testing', before.integrationVersion, before.appliedConfigId], 'software and configuration stay');
      w.eq(env.environmentHistory(w.s, 'VEH-003').map((x) => [x.from, x.to, x.reason]), [['development', 'testing', '转入转向联调']], 'the move is recorded');
      w.check(nc.notificationsFor(w.s, w.actor('workspace_manager'), 'team-steering').some((n) => n.kind === 'VEHICLE_ENV_CHANGED' && n.subject === 'VEH-003'), 'the steering admin is told');
    },
  },
  LV02: {
    needs: ['LV01'],
    run: (w) => {
      const veh1 = env.environmentMoveProblems(w.s, w.s.resources['VEH-001']!, 'production');
      w.check(veh1.includes('team workspace 制动团队工作区 uses it; production vehicles never serve team workspaces'), 'never from a team workspace');
      w.check(veh1.some((p) => p.startsWith('runs no formal policy set for software 1.0')), 'only on a formal set');
      w.check(env.environmentMoveProblems(w.s, w.s.resources['SIM-021']!, 'production').includes('simulation instances are for development and testing'), 'simulations never');
    },
  },
  LV03: {
    needs: ['LV02'],
    run: (w) => {
      w.as('release', (c) => fleet.removeGroupMember(c, group(w, 'X89 量产车组'), 'VEH-202', '台架复测'));
      w.as('resource', (c) => env.setResourceEnvironment(c, 'VEH-202', { env: 'testing', reason: '台架复测' }));
      w.eq(env.environmentMoveProblems(w.s, w.s.resources['VEH-202']!, 'production'), [], 'it still runs policy set 1.0.0 for 1.0');
      w.as('resource', (c) => env.setResourceEnvironment(c, 'VEH-202', { env: 'production', reason: '复测完成' }));
      w.eq(w.s.resources['VEH-202']!.env, 'production', 'back in production');
    },
  },
  LV04: {
    needs: ['LV03'],
    run: (w) => {
      const e = w.fails('ARCHIVE_BLOCKED', () => w.as('workspace_manager', (c) => lc.archiveWorkspace(c, 'team-steering', '团队合并')));
      const list = issues(e);
      w.check(list.includes('workspace X89 项目研发 takes it as a source'), 'the project takes it as a source');
      w.check(list.some((p) => p.startsWith('Feature steering_')) && list.includes('simulation SIM-022 is running'), 'Features and a running simulation');
    },
  },
  LV05: {
    needs: ['LV04'],
    run: (w) => {
      w.as('admin', (c) => createOrgUnit(c, { id: 'x89-lab-unit', name: '试验组', parentId: 'x89' }));
      w.as('admin', (c) =>
        createWorkspace(c, { id: 'x89-lab', name: 'X89 试验区', kind: 'PROJECT', orgUnitId: 'x89-lab-unit', vehicleModelId: 'X89', groupIds: [], scopes: ['Vehicle'], sourceWorkspaceIds: [] }),
      );
      w.as('admin', (c) => lc.archiveWorkspace(c, 'x89-lab', '试验结束'));
      w.check(!visibleWorkspaces(w.s, w.actor('resource')).some((x) => x.id === 'x89-lab'), 'gone from the switcher');
      const denied = w.denied('resource', (c) => fleet.addWorkspaceVehicle(c, 'x89-lab', 'VEH-031'));
      w.eq((denied.details as { reason: string }).reason, 'WORKSPACE_ARCHIVED', 'nothing acts in it');
      w.as('admin', (c) => lc.restoreWorkspace(c, 'x89-lab', '重开试验'));
      w.eq(w.s.workspaces['x89-lab']!.status, 'ACTIVE', 'restored');
    },
  },
  LV06: {
    needs: ['LV05'],
    run: (w) => {
      w.as('workspace_manager', (c) => createGroup(c, { id: 'brake-lab', code: 'chassis.brakelab', name: '制动预研组', domain: 'Chassis', purpose: 'DEV', orgUnitId: 'brake-team', workspaceId: 'team-brake' }));
      w.as('workspace_manager', (c) => lc.archiveGroup(c, 'brake-lab', '预研结束'));
      w.eq(w.s.groups['brake-lab']!.status, 'ARCHIVED', 'archived by the admin of its only workspace');
      w.fails('GROUP_ARCHIVED', () => w.as('admin', (c) => updateWorkspace(c, 'x89-project', { groupIds: [...w.s.workspaces['x89-project']!.groupIds, 'brake-lab'] })));
    },
  },
  LV07: {
    needs: ['LV06'],
    run: (w) => {
      const e = w.fails('ARCHIVE_BLOCKED', () => w.as('admin', (c) => lc.archiveOrgUnit(c, 'x89-lab-unit', '撤销')));
      w.eq(issues(e), ['workspace X89 试验区 is active'], 'its workspace first');
      w.as('admin', (c) => lc.archiveWorkspace(c, 'x89-lab', '撤销试验组'));
      w.as('admin', (c) => lc.archiveOrgUnit(c, 'x89-lab-unit', '撤销'));
      w.eq(lc.workspaceRestoreProblems(w.s, 'x89-lab'), ['organization unit 试验组 is archived'], 'a workspace does not come back without its unit');
      w.fails('DIRECTORY_MANAGED', () => w.as('admin', (c) => lc.archiveOrgUnit(c, 'brake-team', 'x')));
    },
  },
  N01: {
    run: (w) => {
      w.denied('workspace_manager', (c) => lc.archiveGroup(c, 'steering', '并入制动'));
      w.denied('workspace_manager', (c) => env.setResourceEnvironment(c, 'VEH-003', { env: 'testing', reason: 'x' }));
      w.denied('integration_admin', (c) => lc.restoreWorkspace(c, 'x89-integration', 'x'));
    },
  },
};
