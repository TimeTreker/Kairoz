// 借用车辆与下发、推送 (BR01–BR10, N01) on the demo installation: the brake workspace borrows the ADC
// system team's VEH-004 for its development group. The ADC workspace agrees, vehicle resources
// approve, and the car follows the group: unknown software does not fit, so the team updates the
// car instead of the policies, and the group's configuration is pushed. A dispatch reaches an
// offline car only when it comes back; an overdue loan stops new dispatches until it is extended;
// the returned car keeps its software, and its lender is told. Finally a car whose software
// changed by itself goes back on request.

import { addDays, todayOf } from '../src/engine/clock.ts';
import * as dl from '../src/engine/delivery.ts';
import * as fleet from '../src/engine/fleet.ts';
import * as ln from '../src/engine/loans.ts';
import * as nc from '../src/engine/notifications.ts';
import { demoState } from '../src/engine/seed.ts';
import { advanceClock, completeVehicleSoftware, reportNow, sendReceipt, setAgent, simulateSoftwareOta, tick } from '../src/engine/simulator.ts';
import * as sc from '../src/engine/software-change.ts';
import type { State } from '../src/engine/types.ts';
import * as v from '../src/engine/validation.ts';
import * as vs from '../src/engine/vehicle-software.ts';
import { answerAll } from './helpers.ts';
import type { SceneSpec, World } from './world.ts';

export const start = (): State => demoState();

const feature = (w: World, name: string) => Object.values(w.s.features).find((f) => f.name === name)!;
const group = (w: World, name: string) => Object.values(w.s.vehicleGroups).find((g) => g.name === name)!.id;
const items = (w: World, user: string, ws: string) => nc.notificationsFor(w.s, w.actor(user), ws);
const has = (w: World, user: string, ws: string, kind: string, subject: string) => items(w, user, ws).some((n) => n.kind === kind && n.subject === subject);
const follows = (w: World, rid: string) => Object.values(w.s.deployments).filter((d) => d.trigger === 'GROUP_FOLLOW' && d.targets.some((t) => t.resourceId === rid));
const stateOf = (w: World, d: string, rid: string) => dl.deliveryState(w.s.deployments[d]!.targets.find((t) => t.resourceId === rid)!);
const dispatchGuided = (w: World) => {
  const f = feature(w, 'guided_brake');
  return w.as('brake_tester', (c) => v.dispatchFeature(c, f.id, { commitId: f.headCommitId!, vehicleGroupIds: [group(w, '制动研发车组')] }));
};

export const scenes: Record<string, SceneSpec> = {
  BR01: {
    run: (w) => {
      const catalog = ln.loanCatalog(w.s, 'team-brake');
      const veh4 = catalog.find((x) => x.resourceId === 'VEH-004');
      w.eq([veh4?.type, veh4?.env, veh4?.pool, veh4?.integrationVersion, veh4?.usedBy], ['PHYSICAL', 'development', 'ADC', null, ['team-adc-system']], 'VEH-004: what is needed to choose it');
      w.check(veh4 && !('appliedConfigId' in veh4) && !('controllers' in veh4), 'no configuration or controller detail before approval');
      w.check(!catalog.some((x) => x.resourceId === 'VEH-201' || x.resourceId === 'VEH-202'), 'production vehicles are never lent');
      w.check(!catalog.some((x) => x.resourceId === 'VEH-001' || x.resourceId === 'SIM-021'), 'the workspace’s own vehicles are not in it');
    },
  },
  BR02: {
    needs: ['BR01'],
    run: (w) => {
      const vg = group(w, '制动研发车组');
      const ask = (dueDate: string, user = 'workspace_manager') =>
        w.as(user, (c) => ln.requestLoan(c, { workspaceId: 'team-brake', resourceId: 'VEH-004', vehicleGroupId: vg, dueDate, purpose: 'AEB 联合制动验证' }));
      w.fails('INVALID_DUE_DATE', () => ask(todayOf(w.s)));
      w.denied('business', (c) => ln.requestLoan(c, { workspaceId: 'team-brake', resourceId: 'VEH-004', vehicleGroupId: vg, dueDate: addDays(todayOf(w.s), 7), purpose: 'x' }));
      w.ref.loan = ask(addDays(todayOf(w.s), 7));
      const l = w.s.loans[w.ref.loan]!;
      w.eq([l.status, l.lenders.map((x) => [x.workspaceId, x.decision])], ['REQUESTED', [['team-adc-system', 'PENDING']]], 'waits for the ADC system workspace');
      w.fails('LENDER_NOT_AGREED', () => w.as('resource', (c) => ln.decideLoan(c, w.ref.loan!, { approve: true })));
    },
  },
  BR03: {
    needs: ['BR02'],
    run: (w) => {
      w.check(has(w, 'adc_integrator', 'team-adc-system', 'LOAN_TO_AGREE', 'VEH-004'), 'the ADC admin is asked');
      w.as('adc_integrator', (c) => ln.answerLoanAsLender(c, w.ref.loan!, { workspaceId: 'team-adc-system', agree: true }));
      w.eq(ln.loansToApprove(w.s, w.actor('resource')).map((l) => l.id), [w.ref.loan], 'now with vehicle resources');
      w.check(has(w, 'resource', 'team-brake', 'LOAN_TO_APPROVE', 'VEH-004'), 'vehicle resources are told');
    },
  },
  BR04: {
    needs: ['BR03'],
    run: (w) => {
      w.eq(ln.approvalProblems(w.s, w.s.loans[w.ref.loan!]!), [], 'nothing stops the loan');
      w.as('resource', (c) => ln.decideLoan(c, w.ref.loan!, { approve: true }));
      w.eq(w.s.groupMembers['VEH-004'], group(w, '制动研发车组'), 'it joined the brake group');
      w.check(w.s.workspaceResources['team-brake']!.includes('VEH-004') && w.s.workspaceResources['team-adc-system']!.includes('VEH-004'), 'in the borrower’s list and still in the lender’s');
      const events = w.s.vehicleGroupEvents.filter((e) => e.resourceId === 'VEH-004').slice(-2).map((e) => [e.kind, e.reason]);
      w.eq(events, [['MEMBER_REMOVED', '借出至 制动团队工作区'], ['MEMBER_ADDED', '借用：AEB 联合制动验证']], 'both groups record it');
      w.check(has(w, 'workspace_manager', 'team-brake', 'LOAN_DECIDED', 'VEH-004'), 'the borrower is told');
    },
  },
  BR05: {
    needs: ['BR04'],
    run: (w) => {
      w.sys((c) => reportNow(c, 'VEH-004'));
      w.eq(follows(w, 'VEH-004').length, 0, 'nothing pushed');
      const fit = dl.fitOf(w.s, 'VEH-004');
      w.eq([fit?.fits, fit?.check.outcome], [false, 'UNKNOWN_SOFTWARE'], 'unknown software does not fit');
      w.check(has(w, 'business', 'team-brake', 'GROUP_MISMATCH', 'VEH-004'), 'the brake developer is told');
    },
  },
  BR06: {
    needs: ['BR05'],
    run: (w) => {
      w.eq(vs.previewVehicleSoftware(w.s, 'VEH-004', '1.0')?.outcome, 'NONE', 'on 1.0 the group’s publication fits');
      const q = w.as('business', (c) => vs.requestVehicleSoftware(c, 'team-brake', 'VEH-004', { version: '1.0', reason: '与车组一致' }));
      w.sys((c) => completeVehicleSoftware(c, q, 'APPLIED'));
      w.eq(w.s.resources['VEH-004']!.integrationVersion, '1.0', 'the car restarted and reported 1.0');
      const [push] = follows(w, 'VEH-004');
      w.check(push && dl.deliveryState(push.targets[0]!) === 'PUSHED', 'the group’s configuration was pushed');
      w.eq(push!.resolvedConfigId, w.s.resources['VEH-001']!.appliedConfigId, 'the configuration the group runs');
      w.sys((c) => sendReceipt(c, push!.id, 'VEH-004', 'APPLIED'));
      w.eq(w.s.resources['VEH-004']!.appliedConfigId, push!.resolvedConfigId, 'applied after the receipt');
    },
  },
  BR07: {
    needs: ['BR06'],
    run: (w) => {
      w.sys((c) => setAgent(c, 'VEH-004', { online: false }));
      const [d] = dispatchGuided(w);
      w.eq(['SIM-021', 'VEH-001', 'VEH-004'].map((r) => stateOf(w, d!, r)), ['NOT_PUSHED', 'NOT_PUSHED', 'NOT_PUSHED'], 'dispatched: only the cloud configuration changed');
      w.sys((c) => tick(c));
      w.eq(['SIM-021', 'VEH-001', 'VEH-004'].map((r) => stateOf(w, d!, r)), ['PUSHED', 'PUSHED', 'NOT_PUSHED'], 'the offline car has not received it');
      w.sys((c) => setAgent(c, 'VEH-004', { online: true }));
      w.sys((c) => tick(c));
      w.eq(stateOf(w, d!, 'VEH-004'), 'PUSHED', 'pushed once it is back');
      answerAll(w, d!);
      w.eq(stateOf(w, d!, 'VEH-004'), 'APPLIED', 'applied');
    },
  },
  BR08: {
    needs: ['BR07'],
    run: (w) => {
      w.sys((c) => advanceClock(c, 8));
      const l = w.s.loans[w.ref.loan!]!;
      w.check(fleet.isOverdue(w.s, l), 'overdue');
      w.check(has(w, 'workspace_manager', 'team-brake', 'LOAN_OVERDUE', 'VEH-004') && has(w, 'resource', 'team-brake', 'LOAN_OVERDUE', 'VEH-004'), 'both sides are warned');
      const e = w.fails('DISPATCH_BLOCKED', () => dispatchGuided(w));
      w.eq((e.details as { issues: string[] }).issues, [`VEH-004: loan overdue since ${l.dueDate}; extend or return it`], 'blocked by the loan only');
      w.as('workspace_manager', (c) => ln.requestExtension(c, w.ref.loan!, { dueDate: addDays(todayOf(w.s), 7), reason: '联合验证还需一周' }));
      w.check(has(w, 'resource', 'team-brake', 'EXTENSION_TO_APPROVE', 'VEH-004'), 'vehicle resources are asked');
      w.as('resource', (c) => ln.decideExtension(c, w.ref.loan!, true));
      w.check(!fleet.isOverdue(w.s, w.s.loans[w.ref.loan!]!), 'extended');
      for (const d of dispatchGuided(w)) answerAll(w, d);
    },
  },
  BR09: {
    needs: ['BR08'],
    run: (w) => {
      w.as('workspace_manager', (c) => ln.returnLoan(c, w.ref.loan!));
      const l = w.s.loans[w.ref.loan!]!;
      w.eq([l.status, l.softwareAtStart, l.softwareAtEnd], ['RETURNED', null, '1.0'], 'returned on 1.0');
      w.check(!w.s.groupMembers['VEH-004'] && !w.s.workspaceResources['team-brake']!.includes('VEH-004'), 'it left the brake group and workspace');
      w.check(!!w.s.resources['VEH-004']!.appliedConfigId, 'its configuration stays');
      const ended = items(w, 'adc_integrator', 'team-adc-system').find((n) => n.kind === 'LOAN_ENDED' && n.subject === 'VEH-004');
      w.eq(ended?.detail, 'RETURNED · — → 1.0', 'the lender is told, with the software');
      w.as('adc_integrator', (c) => fleet.addGroupMember(c, group(w, '系统应用研发车组'), 'VEH-004', '归还后入组'));
      w.sys((c) => reportNow(c, 'VEH-004'));
      w.check(follows(w, 'VEH-004').length === 1 && !w.s.groupFollows['VEH-004'], 'nothing published there, nothing pushed');
    },
  },
  BR10: {
    needs: ['BR09'],
    run: (w) => {
      const applied = w.s.resources['VEH-001']!.appliedConfigId;
      w.sys((c) => simulateSoftwareOta(c, 'VEH-001', '1.1'));
      w.sys((c) => reportNow(c, 'VEH-001'));
      const [change] = sc.softwareChangesFor(w.s, w.actor('business'), 'team-brake');
      w.eq(change && sc.assessSoftwareChange(w.s, change.id).outcome, 'NO_BASE', 'no set applies to 1.1');
      const q = w.as('business', (c) => vs.requestVehicleSoftware(c, 'team-brake', 'VEH-001', { version: '1.0', reason: '回到策略适用的版本' }));
      w.sys((c) => completeVehicleSoftware(c, q, 'APPLIED'));
      w.eq(w.s.resources['VEH-001']!.integrationVersion, '1.0', 'back on 1.0');
      w.eq(sc.softwareChangesFor(w.s, w.actor('business'), 'team-brake'), [], 'the changes are seen');
      w.check(w.s.resources['VEH-001']!.appliedConfigId === applied && follows(w, 'VEH-001').length === 0, 'the configuration still fits: nothing pushed');
    },
  },
  N01: {
    forkAfter: 'BR04',
    run: (w) => {
      w.denied('steering', (c) => ln.returnLoan(c, w.ref.loan!));
      w.fails('VEHICLE_ON_LOAN', () => w.as('adc_integrator', (c) => fleet.addGroupMember(c, group(w, '系统应用研发车组'), 'VEH-004', '收回')));
      w.fails('VEHICLE_ON_LOAN', () => w.as('resource', (c) => fleet.setResourceStatus(c, 'VEH-004', { status: 'MAINTENANCE', reason: '保养' })));
      w.denied('dispatch_operator', (c) => vs.requestVehicleSoftware(c, 'team-brake', 'VEH-004', { version: '1.0', reason: 'x' }));
    },
  },
};
