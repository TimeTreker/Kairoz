import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { World } from '../acceptance/world.ts';
import * as dl from '../src/engine/delivery.ts';
import * as fleet from '../src/engine/fleet.ts';
import { demoState } from '../src/engine/seed.ts';
import { completeVehicleSoftware, reportNow, setAgent, simulateSoftwareOta } from '../src/engine/simulator.ts';
import * as sc from '../src/engine/software-change.ts';
import * as v from '../src/engine/validation.ts';
import * as vs from '../src/engine/vehicle-software.ts';

const feature = (w: World, name: string) => Object.values(w.s.features).find((f) => f.name === name)!;
const groupId = (w: World, name: string) => Object.values(w.s.vehicleGroups).find((g) => g.name === name)!.id;
const follows = (w: World, rid: string) => Object.values(w.s.deployments).filter((d) => d.trigger === 'GROUP_FOLLOW' && d.targets.some((t) => t.resourceId === rid));
const update = (w: World, user: string, rid: string, version: string) => w.as(user, (c) => vs.requestVehicleSoftware(c, 'team-brake', rid, { version, reason: '回到策略适用的版本' }));

describe('updating a vehicle’s software', () => {
  test('a car whose software changed by itself goes back on request; the policies stay as they are', () => {
    const w = new World(demoState());
    const applied = w.s.resources['VEH-001']!.appliedConfigId;
    w.sys((c) => simulateSoftwareOta(c, 'VEH-001', '1.1'));
    w.sys((c) => reportNow(c, 'VEH-001'));
    const [change] = sc.softwareChangesFor(w.s, w.actor('business'), 'team-brake');
    assert.equal(sc.assessSoftwareChange(w.s, change!.id).outcome, 'NO_BASE');
    assert.equal(vs.previewVehicleSoftware(w.s, 'VEH-001', '1.0')!.outcome, 'NONE', 'the preview shows 1.0 fits');
    const q = update(w, 'business', 'VEH-001', '1.0');
    const f = feature(w, 'guided_brake');
    w.fails('DISPATCH_BLOCKED', () => w.as('brake_tester', (c) => v.dispatchFeature(c, f.id, { commitId: f.headCommitId!, vehicleGroupIds: [groupId(w, '制动研发车组')] })));
    w.sys((c) => completeVehicleSoftware(c, q, 'APPLIED'));
    // The car restarted and reported 1.0; the change is the team's own.
    const r = w.s.resources['VEH-001']!;
    const back = Object.values(w.s.softwareChanges).find((c) => c.requestId === q)!;
    assert.deepEqual([r.integrationVersion, back.fromVersion, back.toVersion, back.acknowledgedBy], ['1.0', '1.1', '1.0', 'business']);
    assert.equal(w.s.softwareChanges[change!.id]!.acknowledgedBy, 'business', 'the change it answered is seen too');
    assert.deepEqual(sc.softwareChangesFor(w.s, w.actor('business'), 'team-brake'), []);
    // The configuration still fits: nothing to push, nothing waits.
    assert.equal(follows(w, 'VEH-001').length, 0);
    assert.equal(w.s.groupFollows['VEH-001'], undefined);
    assert.equal(r.appliedConfigId, applied);
  });

  test('a joining car on software no set applies to is updated, then pushed what the group runs', () => {
    const w = new World(demoState());
    w.sys((c) => simulateSoftwareOta(c, 'VEH-003', '1.1'));
    w.sys((c) => reportNow(c, 'VEH-003'));
    w.as('workspace_manager', (c) => fleet.removeGroupMember(c, groupId(w, '转向研发车组'), 'VEH-003', '调到制动'));
    w.as('workspace_manager', (c) => fleet.addWorkspaceVehicle(c, 'team-brake', 'VEH-003'));
    w.as('workspace_manager', (c) => fleet.addGroupMember(c, groupId(w, '制动研发车组'), 'VEH-003', '制动验证'));
    w.sys((c) => reportNow(c, 'VEH-003'));
    assert.equal(dl.fitOf(w.s, 'VEH-003')!.fits, false);
    const q = update(w, 'brake_tester', 'VEH-003', '1.0');
    w.sys((c) => completeVehicleSoftware(c, q, 'APPLIED'));
    assert.equal(w.s.resources['VEH-003']!.integrationVersion, '1.0');
    const [d] = follows(w, 'VEH-003');
    assert.ok(d, 'pushed after the restart’s report');
    assert.equal(d.resolvedConfigId, w.s.resources['VEH-001']!.appliedConfigId);
  });

  test('an offline car learns of the update when it comes back; a failed update changes nothing', () => {
    const w = new World(demoState());
    w.sys((c) => setAgent(c, 'VEH-001', { online: false }));
    const q = update(w, 'workspace_manager', 'VEH-001', '1.1');
    w.sys((c) => completeVehicleSoftware(c, q, 'APPLIED'));
    assert.equal(w.s.resources['VEH-001']!.integrationVersion, '1.0', 'the report waits in the car');
    w.sys((c) => setAgent(c, 'VEH-001', { online: true }));
    w.sys((c) => reportNow(c, 'VEH-001'));
    assert.equal(w.s.resources['VEH-001']!.integrationVersion, '1.1');
    const again = update(w, 'workspace_manager', 'VEH-001', '1.0');
    w.sys((c) => completeVehicleSoftware(c, again, 'FAILED'));
    assert.deepEqual([w.s.vehicleSoftwareRequests[again]!.status, w.s.resources['VEH-001']!.integrationVersion], ['FAILED', '1.1']);
    const withdrawn = update(w, 'workspace_manager', 'VEH-001', '1.0');
    w.as('workspace_manager', (c) => vs.cancelVehicleSoftware(c, withdrawn));
    assert.equal(w.s.vehicleSoftwareRequests[withdrawn]!.status, 'CANCELLED');
  });

  test('who may update which vehicle, to what', () => {
    const w = new World(demoState());
    w.denied('steering', (c) => vs.requestVehicleSoftware(c, 'team-brake', 'VEH-001', { version: '1.1', reason: 'x' }));
    w.denied('dispatch_operator', (c) => vs.requestVehicleSoftware(c, 'team-brake', 'VEH-001', { version: '1.1', reason: 'x' }));
    w.fails('SIMULATION_SOFTWARE_FROM_IMAGE', () => update(w, 'business', 'SIM-021', '1.1'));
    w.fails('SOFTWARE_NOT_RECORDED', () => update(w, 'business', 'VEH-001', '9.9'));
    w.fails('SAME_SOFTWARE', () => update(w, 'business', 'VEH-001', '1.0'));
    w.fails('REASON_REQUIRED', () => w.as('business', (c) => vs.requestVehicleSoftware(c, 'team-brake', 'VEH-001', { version: '1.1', reason: ' ' })));
    w.fails('PRODUCTION_SOFTWARE', () => w.as('integration_admin', (c) => vs.requestVehicleSoftware(c, 'x89-project', 'VEH-201', { version: '1.1', reason: 'x' })));
    update(w, 'business', 'VEH-001', '1.1');
    w.fails('SOFTWARE_UPDATE_PENDING', () => update(w, 'brake_tester', 'VEH-001', '1.1'));
    w.fails('SOFTWARE_UPDATE_PENDING', () => w.as('workspace_manager', (c) => fleet.removeGroupMember(c, groupId(w, '制动研发车组'), 'VEH-001', 'x')));
  });
});
