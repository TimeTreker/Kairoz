import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { World } from '../acceptance/world.ts';
import { addDays, todayOf } from '../src/engine/clock.ts';
import * as dl from '../src/engine/delivery.ts';
import { checkVehicleProblems } from '../src/engine/applicability.ts';
import * as fleet from '../src/engine/fleet.ts';
import { replaceGrants } from '../src/engine/identity.ts';
import * as ln from '../src/engine/loans.ts';
import * as nc from '../src/engine/notifications.ts';
import { demoState } from '../src/engine/seed.ts';
import { advanceClock, completeVehicleSoftware, reportNow, sendReceipt } from '../src/engine/simulator.ts';
import * as v from '../src/engine/validation.ts';
import * as vs from '../src/engine/vehicle-software.ts';
import { tspCar } from '../acceptance/helpers.ts';

const feature = (w: World, name: string) => Object.values(w.s.features).find((f) => f.name === name)!;
const groupId = (w: World, name: string) => Object.values(w.s.vehicleGroups).find((g) => g.name === name)!.id;
const kinds = (w: World, user: string, ws: string) => nc.notificationsFor(w.s, w.actor(user), ws).map((n) => [n.kind, n.subject]);
const due = (w: World, days: number) => addDays(todayOf(w.s), days);

/** The brake workspace borrows VEH-004 (ADC pool, used by the ADC system team) for its development group. */
function ask(w: World, rid = 'VEH-004'): string {
  return w.as('workspace_manager', (c) =>
    ln.requestLoan(c, { workspaceId: 'team-brake', resourceId: rid, vehicleGroupId: groupId(w, '制动研发车组'), dueDate: due(w, 7), purpose: 'AEB 联合制动验证' }),
  );
}

function lend(w: World): string {
  const id = ask(w);
  w.as('adc_integrator', (c) => ln.answerLoanAsLender(c, id, { workspaceId: 'team-adc-system', agree: true }));
  w.as('resource', (c) => ln.decideLoan(c, id, { approve: true }));
  return id;
}

/** A loan of VEH-031 (X89 integration's testing car) to the ADC domain workspace, approved. */
function lendIntegrationCar(w: World): string {
  const id = w.as('adc_integrator', (c) =>
    ln.requestLoan(c, { workspaceId: 'x89-adc-integration', resourceId: 'VEH-031', vehicleGroupId: groupId(w, 'ADC 域集成测试车组'), dueDate: due(w, 3), purpose: '域集成联调' }),
  );
  w.as('integration_admin', (c) => ln.answerLoanAsLender(c, id, { workspaceId: 'x89-integration', agree: true }));
  w.as('resource', (c) => ln.decideLoan(c, id, { approve: true }));
  return id;
}

describe('borrowing', () => {
  test('the catalog shows what is needed to choose a vehicle, never its configuration', () => {
    const w = new World(demoState());
    const catalog = ln.loanCatalog(w.s, 'team-brake');
    const veh4 = catalog.find((x) => x.resourceId === 'VEH-004')!;
    assert.deepEqual([veh4.pool, veh4.env, veh4.usedBy, veh4.integrationVersion, veh4.direct], ['ADC', 'development', ['team-adc-system'], null, false]);
    assert.equal('appliedConfigId' in veh4, false);
    assert.ok(!catalog.some((x) => x.resourceId === 'VEH-201'), 'production vehicles are never lent');
    assert.ok(!catalog.some((x) => x.resourceId === 'VEH-001'), 'the workspace’s own vehicles are not borrowed');
    assert.ok(catalog.some((x) => x.resourceId === 'SIM-022'), 'another workspace’s simulation can be');
  });

  test('the workspace using the car agrees, then vehicle resources approve; the car changes groups', () => {
    const w = new World(demoState());
    const adcGroup = groupId(w, '系统应用研发车组');
    const id = ask(w);
    assert.deepEqual(w.s.loans[id]!.lenders.map((x) => [x.workspaceId, x.decision]), [['team-adc-system', 'PENDING']]);
    assert.deepEqual(kinds(w, 'adc_integrator', 'team-adc-system').filter(([k]) => k === 'LOAN_TO_AGREE'), [['LOAN_TO_AGREE', 'VEH-004']]);
    w.fails('LENDER_NOT_AGREED', () => w.as('resource', (c) => ln.decideLoan(c, id, { approve: true })));
    w.as('adc_integrator', (c) => ln.answerLoanAsLender(c, id, { workspaceId: 'team-adc-system', agree: true }));
    assert.deepEqual(ln.loansToApprove(w.s, w.actor('resource')).map((l) => l.id), [id]);
    w.as('resource', (c) => ln.decideLoan(c, id, { approve: true }));
    const l = w.s.loans[id]!;
    assert.deepEqual([l.status, l.leftGroupId, l.softwareAtStart], ['APPROVED', adcGroup, null]);
    assert.equal(w.s.groupMembers['VEH-004'], groupId(w, '制动研发车组'));
    assert.ok(w.s.workspaceResources['team-brake']!.includes('VEH-004'));
    assert.ok(w.s.workspaceResources['team-adc-system']!.includes('VEH-004'), 'the lender keeps it in its list');
    assert.equal(w.s.groupFollows['VEH-004']?.reason, 'JOINED');
    const events = w.s.vehicleGroupEvents.filter((e) => e.resourceId === 'VEH-004').map((e) => [e.vehicleGroupId, e.kind, e.reason]);
    assert.deepEqual(events.slice(-2), [
      [adcGroup, 'LENT_OUT', '制动团队工作区'],
      [groupId(w, '制动研发车组'), 'BORROWED_IN', 'AEB 联合制动验证'],
    ]);
    assert.deepEqual(kinds(w, 'workspace_manager', 'team-brake').filter(([k]) => k === 'LOAN_DECIDED'), [['LOAN_DECIDED', 'VEH-004']]);
  });

  test('a car nobody uses needs only vehicle resources; a declined or withdrawn request ends', () => {
    const w = new World(demoState());
    tspCar(w.engine, 'LSDEM0X8900000090', 'X89');
    w.as('resource', (c) => fleet.registerPhysical(c, { id: 'VEH-090', vin: 'LSDEM0X8900000090', vehicleModelId: 'X89', env: 'development', pool: 'ADC', displayName: '公共试验车' }));
    const id = ask(w, 'VEH-090');
    assert.deepEqual(w.s.loans[id]!.lenders, []);
    w.as('resource', (c) => ln.decideLoan(c, id, { approve: true }));
    assert.equal(w.s.loans[id]!.status, 'APPROVED');

    const declined = ask(w);
    w.fails('REASON_REQUIRED', () => w.as('adc_integrator', (c) => ln.answerLoanAsLender(c, declined, { workspaceId: 'team-adc-system', agree: false })));
    w.as('adc_integrator', (c) => ln.answerLoanAsLender(c, declined, { workspaceId: 'team-adc-system', agree: false, note: '本周路测在用' }));
    assert.deepEqual([w.s.loans[declined]!.status, w.s.loans[declined]!.decisionNote], ['REJECTED', '本周路测在用']);
    const withdrawn = ask(w);
    w.as('workspace_manager', (c) => ln.withdrawLoan(c, withdrawn));
    assert.equal(w.s.loans[withdrawn]!.status, 'WITHDRAWN');
  });

  test('what may be asked for', () => {
    const w = new World(demoState());
    const brake = groupId(w, '制动研发车组');
    const req = (rid: string, over: Partial<{ vehicleGroupId: string; dueDate: string; purpose: string }> = {}) =>
      w.as('workspace_manager', (c) => ln.requestLoan(c, { workspaceId: 'team-brake', resourceId: rid, vehicleGroupId: brake, dueDate: due(w, 7), purpose: '验证', ...over }));
    w.denied('workspace_manager', (c) => ln.requestLoan(c, { workspaceId: 'team-brake', resourceId: 'VEH-201', vehicleGroupId: brake, dueDate: due(w, 7), purpose: '验证' }));
    tspCar(w.engine, 'LSDEM0X8900000091', 'X89');
    w.as('resource', (c) => fleet.registerPhysical(c, { id: 'VEH-091', vin: 'LSDEM0X8900000091', vehicleModelId: 'X89', env: 'development', pool: 'ADC', displayName: '待报废车' }));
    w.as('resource', (c) => fleet.setResourceStatus(c, 'VEH-091', { status: 'RETIRED', reason: '报废' }));
    w.fails('LOAN_NOT_LENDABLE', () => req('VEH-091'));
    w.fails('ALREADY_IN_WORKSPACE', () => req('VEH-001'));
    w.fails('LOAN_TARGET_GROUP', () => req('VEH-141'));
    w.fails('INVALID_DUE_DATE', () => req('VEH-004', { dueDate: todayOf(w.s) }));
    w.fails('INVALID_DUE_DATE', () => req('VEH-004', { dueDate: due(w, 91) }));
    w.fails('LOAN_PURPOSE_REQUIRED', () => req('VEH-004', { purpose: ' ' }));
    w.denied('business', (c) => ln.requestLoan(c, { workspaceId: 'team-brake', resourceId: 'VEH-004', vehicleGroupId: brake, dueDate: due(w, 7), purpose: '验证' }));
    req('VEH-004');
    w.fails('LOAN_OPEN', () => req('VEH-004'));
  });

  test('while lent, only the borrower works with the car', () => {
    const w = new World(demoState());
    lend(w);
    w.fails('VEHICLE_ON_LOAN', () => w.as('adc_integrator', (c) => fleet.addGroupMember(c, groupId(w, '系统应用研发车组'), 'VEH-004', '收回')));
    w.fails('VEHICLE_ON_LOAN', () => w.as('adc_integrator', (c) => fleet.reserveVehicle(c, 'team-adc-system', 'VEH-004', '路测')));
    w.fails('VEHICLE_ON_LOAN', () => w.as('adc_integrator', (c) => fleet.removeWorkspaceVehicle(c, 'team-adc-system', 'VEH-004')));
    w.fails('VEHICLE_ON_LOAN', () => w.as('resource', (c) => fleet.setResourceStatus(c, 'VEH-004', { status: 'MAINTENANCE', reason: '保养' })));
    w.fails('VEHICLE_ON_LOAN', () => w.as('adc_integrator', (c) => vs.requestVehicleSoftware(c, 'team-adc-system', 'VEH-004', { version: '1.0', reason: 'x' })));
    w.fails('VEHICLE_IN_GROUP', () => w.as('workspace_manager', (c) => fleet.removeWorkspaceVehicle(c, 'team-brake', 'VEH-004')));
    w.as('workspace_manager', (c) => fleet.removeGroupMember(c, groupId(w, '制动研发车组'), 'VEH-004', '换组'));
    w.fails('VEHICLE_ON_LOAN', () => w.as('workspace_manager', (c) => fleet.removeWorkspaceVehicle(c, 'team-brake', 'VEH-004')));
    w.as('workspace_manager', (c) => fleet.reserveVehicle(c, 'team-brake', 'VEH-004', '联合验证'));
  });

  test('an overdue loan stops new dispatches until it is extended', () => {
    const w = new World(demoState());
    const id = lend(w);
    const f = feature(w, 'guided_brake');
    const dispatch = () => w.as('brake_tester', (c) => v.dispatchFeature(c, f.id, { commitId: f.headCommitId!, vehicleGroupIds: [groupId(w, '制动研发车组')] }));
    w.sys((c) => advanceClock(c, 8));
    assert.ok(fleet.isOverdue(w.s, w.s.loans[id]!));
    const e = w.fails('DISPATCH_BLOCKED', dispatch);
    assert.deepEqual((e.details as { issues: string[] }).issues, [`VEH-004: loan overdue since ${w.s.loans[id]!.dueDate}; extend or return it`]);
    assert.ok(kinds(w, 'workspace_manager', 'team-brake').some(([k]) => k === 'LOAN_OVERDUE'));
    assert.ok(kinds(w, 'resource', 'team-brake').some(([k]) => k === 'LOAN_OVERDUE'));
    w.fails('INVALID_DUE_DATE', () => w.as('workspace_manager', (c) => ln.requestExtension(c, id, { dueDate: todayOf(w.s), reason: '还需一周' })));
    w.as('workspace_manager', (c) => ln.requestExtension(c, id, { dueDate: due(w, 7), reason: '还需一周' }));
    w.fails('EXTENSION_PENDING', () => w.as('workspace_manager', (c) => ln.requestExtension(c, id, { dueDate: due(w, 8), reason: 'x' })));
    w.as('resource', (c) => ln.decideExtension(c, id, true));
    assert.equal(w.s.loans[id]!.dueDate, due(w, 7));
    assert.equal(fleet.isOverdue(w.s, w.s.loans[id]!), false);
    assert.ok(dispatch().length > 0);
  });

  test('returning keeps the car’s software and configuration; its lender is told', () => {
    const w = new World(demoState());
    const id = lend(w);
    // Unknown software does not fit the group: the team updates the car, which is then pushed.
    w.sys((c) => reportNow(c, 'VEH-004'));
    assert.equal(dl.fitOf(w.s, 'VEH-004')!.check.outcome, 'UNKNOWN_SOFTWARE');
    assert.ok(kinds(w, 'business', 'team-brake').some(([k, s]) => k === 'GROUP_MISMATCH' && s === 'VEH-004'));
    const q = w.as('business', (c) => vs.requestVehicleSoftware(c, 'team-brake', 'VEH-004', { version: '1.0', reason: '与车组一致' }));
    w.sys((c) => completeVehicleSoftware(c, q, 'APPLIED'));
    const push = Object.values(w.s.deployments).find((d) => d.trigger === 'GROUP_FOLLOW' && d.targets[0]!.resourceId === 'VEH-004')!;
    w.fails('VEHICLE_BUSY', () => w.as('workspace_manager', (c) => ln.returnLoan(c, id)));
    w.sys((c) => sendReceipt(c, push.id, 'VEH-004', 'APPLIED'));
    w.denied('steering', (c) => ln.returnLoan(c, id));
    w.as('workspace_manager', (c) => ln.returnLoan(c, id));
    const r = w.s.resources['VEH-004']!;
    assert.deepEqual([w.s.loans[id]!.status, w.s.loans[id]!.softwareAtEnd, r.integrationVersion, r.appliedConfigId], ['RETURNED', '1.0', '1.0', push.resolvedConfigId]);
    assert.equal(w.s.groupMembers['VEH-004'], undefined, 'not put back in a group by the platform');
    assert.ok(!w.s.workspaceResources['team-brake']!.includes('VEH-004'));
    assert.ok(kinds(w, 'adc_integrator', 'team-adc-system').some(([k, s]) => k === 'LOAN_ENDED' && s === 'VEH-004'));
    w.as('adc_integrator', (c) => fleet.addGroupMember(c, groupId(w, '系统应用研发车组'), 'VEH-004', '归还后入组'));
  });

  test('vehicle resources recall a car; a lent simulation is run by its borrower', () => {
    const w = new World(demoState());
    const id = lend(w);
    w.fails('REASON_REQUIRED', () => w.as('resource', (c) => ln.recallLoan(c, id, ' ')));
    w.as('resource', (c) => ln.recallLoan(c, id, '年检'));
    assert.equal(w.s.loans[id]!.status, 'RECALLED');
    assert.ok(kinds(w, 'workspace_manager', 'team-brake').some(([k]) => k === 'LOAN_RECALLED'));

    // The steering workspace borrows the brake simulation.
    const steeringGroup = groupId(w, '转向研发车组');
    const sim = w.as('workspace_manager', (c) => ln.requestLoan(c, { workspaceId: 'team-steering', resourceId: 'SIM-021', vehicleGroupId: steeringGroup, dueDate: due(w, 3), purpose: '转向制动联合仿真' }));
    w.as('workspace_manager', (c) => ln.answerLoanAsLender(c, sim, { workspaceId: 'team-brake', agree: true }));
    w.fails('LOAN_NOT_APPROVABLE', () => w.as('resource', (c) => ln.decideLoan(c, sim, { approve: true })));
    w.as('workspace_manager', (c) => fleet.stopSimulation(c, 'SIM-021'));
    w.as('resource', (c) => ln.decideLoan(c, sim, { approve: true }));
    assert.equal(fleet.simulationWorkspace(w.s, w.s.resources['SIM-021']!), 'team-steering');
    w.as('workspace_manager', (c) => fleet.startSimulation(c, 'SIM-021'));
    assert.equal(w.s.groupMembers['SIM-021'], steeringGroup);
  });

  test('only workspace admins ask and lend; nobody decides their own request', () => {
    const w = new World(demoState());
    const vg = groupId(w, '制动研发车组');
    w.denied('resource', (c) => ln.requestLoan(c, { workspaceId: 'team-brake', resourceId: 'VEH-004', vehicleGroupId: vg, dueDate: due(w, 7), purpose: 'x' }));
    const id = ask(w);
    w.denied('resource', (c) => ln.answerLoanAsLender(c, id, { workspaceId: 'team-adc-system', agree: true }));
    w.as('adc_integrator', (c) => ln.answerLoanAsLender(c, id, { workspaceId: 'team-adc-system', agree: true }));
    // workspace_manager also gets vehicle resources: still not for a request of their own.
    const grants = [
      { role: 'WORKSPACE_ADMIN', workspaces: ['team-brake', 'team-steering'], groups: [], scopes: [], envs: ['development', 'testing'] },
      { role: 'VEHICLE_RESOURCE', workspaces: ['*'], groups: [], scopes: ['Vehicle', 'Chassis', 'ADC', 'CDC'], envs: ['development', 'testing', 'production'] },
    ];
    w.as('admin', (c) => replaceGrants(c, 'workspace_manager', grants));
    w.fails('SELF_APPROVAL', () => w.as('workspace_manager', (c) => ln.decideLoan(c, id, { approve: true })));
  });

  test('a car the workspace can simply add is not borrowed, and a car it already has is not lent to it', () => {
    const w = new World(demoState());
    tspCar(w.engine, 'LSDEM0X8900000092', 'X89');
    w.as('resource', (c) => fleet.registerPhysical(c, { id: 'VEH-092', vin: 'LSDEM0X8900000092', vehicleModelId: 'X89', env: 'development', pool: 'Chassis', displayName: '底盘公共车' }));
    w.fails('LOAN_NOT_NEEDED', () => ask(w, 'VEH-092'));
    // Steering uses it; brake asks; steering agrees and lets it go; brake then adds it directly.
    w.as('workspace_manager', (c) => fleet.addWorkspaceVehicle(c, 'team-steering', 'VEH-092'));
    const id = ask(w, 'VEH-092');
    w.as('workspace_manager', (c) => ln.answerLoanAsLender(c, id, { workspaceId: 'team-steering', agree: true }));
    w.as('workspace_manager', (c) => fleet.removeWorkspaceVehicle(c, 'team-steering', 'VEH-092'));
    w.as('workspace_manager', (c) => fleet.addWorkspaceVehicle(c, 'team-brake', 'VEH-092'));
    assert.ok(ln.approvalProblems(w.s, w.s.loans[id]!).includes('already a vehicle of the borrowing workspace'));
    w.fails('LOAN_NOT_APPROVABLE', () => w.as('resource', (c) => ln.decideLoan(c, id, { approve: true })));
  });

  test('the lender reaches a lent car by no path: direct tests, reservations', () => {
    const w = new World(demoState());
    lendIntegrationCar(w);
    const check = { vehicleModelId: 'X89', version: '1.0', testWorkspaceId: 'x89-integration' } as unknown as Parameters<typeof checkVehicleProblems>[1];
    assert.ok(checkVehicleProblems(w.s, check, 'VEH-031').some((p) => p.startsWith('VEH-031: lent to ADC 域集成 until')));
    w.as('adc_integrator', (c) => fleet.removeGroupMember(c, groupId(w, 'ADC 域集成测试车组'), 'VEH-031', '单独测试'));
    w.as('adc_integrator', (c) => fleet.reserveVehicle(c, 'x89-adc-integration', 'VEH-031', '联调'));
    w.fails('VEHICLE_ON_LOAN', () => w.as('integration_admin', (c) => fleet.releaseReservation(c, 'x89-integration', 'VEH-031')));
    w.fails('VEHICLE_NOT_IN_WORKSPACE', () => w.as('cdc_integrator', (c) => fleet.releaseReservation(c, 'team-cdc-hmi', 'VEH-031')));
  });

  test('an overdue car is blocked, not a mismatch; an extension to a day gone is refused', () => {
    const w = new World(demoState());
    const id = lend(w);
    const q = w.as('business', (c) => vs.requestVehicleSoftware(c, 'team-brake', 'VEH-004', { version: '1.0', reason: '与车组一致' }));
    w.as('workspace_manager', (c) => ln.requestExtension(c, id, { dueDate: due(w, 9), reason: '还需两天' }));
    w.sys((c) => advanceClock(c, 10));
    w.sys((c) => completeVehicleSoftware(c, q, 'APPLIED'));
    const fit = dl.fitOf(w.s, 'VEH-004')!;
    assert.equal(fit.state, 'BLOCKED', 'it fits; only the loan stops the push');
    assert.ok(!kinds(w, 'business', 'team-brake').some(([k]) => k === 'GROUP_MISMATCH'));
    w.fails('INVALID_DUE_DATE', () => w.as('resource', (c) => ln.decideExtension(c, id, true)));
  });

  test('answers leave the notification center after two weeks', () => {
    const w = new World(demoState());
    const id = lend(w);
    w.as('workspace_manager', (c) => ln.returnLoan(c, id));
    assert.ok(kinds(w, 'adc_integrator', 'team-adc-system').some(([k]) => k === 'LOAN_ENDED'));
    w.sys((c) => advanceClock(c, 15));
    assert.ok(!kinds(w, 'adc_integrator', 'team-adc-system').some(([k]) => k === 'LOAN_ENDED'));
  });
});
