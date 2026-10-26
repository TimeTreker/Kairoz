// Regressions from the independent review of Patch mode, collection budgets and run quotas.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { World } from '../acceptance/world.ts';
import { DEFAULT_BUDGET } from '../src/domain/budget.ts';
import * as ap from '../src/engine/applicability.ts';
import { setModelBudget, setVehicleBudget } from '../src/engine/budget.ts';
import { pauseCollection } from '../src/engine/collection-hold.ts';
import { environmentMoveProblems } from '../src/engine/environment.ts';
import { captureEvent } from '../src/engine/events.ts';
import * as fleet from '../src/engine/fleet.ts';
import * as integ from '../src/engine/integration.ts';
import * as rel from '../src/engine/release.ts';
import { demoState } from '../src/engine/seed.ts';
import { tick } from '../src/engine/simulator.ts';
import { ON_10, angleFix, feature, freeze, groupId, mainline110, patch101, preview, set, testCandidate } from './patch-fixtures.ts';

const ANGLE = 'chassis.steering.angle_jump';

describe('review fixes: patches and the mainline', () => {
  test('a patch never takes over software its line does not serve; the mainline takes over from a patch only with its fixes', () => {
    const w = new World(demoState());
    mainline110(w);
    const fix = angleFix(w);
    patch101(w, fix);
    w.fails('PATCH_VERSION_OUTSIDE_TARGET', () => w.as('release', (c) => ap.openApplicabilityCheck(c, { releaseId: set(w, '1.0.1').id, version: '1.1' })));
    const missing = w.fails('PATCH_FIX_MISSING', () => w.as('release', (c) => ap.openApplicabilityCheck(c, { releaseId: set(w, '1.1.0').id, version: '1.0' })));
    assert.match(missing.message, /angle_jump_fix/);
    // Once the fix is closed for the mainline, the mainline head may serve 1.0 too.
    w.as('integrator', (c) => integ.closeForMainline(c, fix, { reason: '主线不需要' }));
    w.as('release', (c) => ap.openApplicabilityCheck(c, { releaseId: set(w, '1.1.0').id, version: '1.0' }));
  });

  test('a mainline release may not list software a patch serves unless it carries the patch’s fixes', () => {
    const w = new World(demoState());
    mainline110(w);
    const fix = angleFix(w);
    // brake_monitor is frozen on the mainline before the fix is patched.
    const brake = freeze(w, preview(w, [feature(w, 'brake_monitor').id]), 'X89-C3');
    patch101(w, fix);
    testCandidate(w, brake, ON_10);
    w.fails('PATCH_FIX_MISSING', () => w.as('release', (c) => rel.promoteCandidate(c, brake, { dclVersion: '1.1.1', vehicleIntegrationVersions: ['1.0'] })));
    assert.equal(rel.promoteVersionProblem(w.s, w.s.candidates[brake]!, '1.0')?.code, 'PATCH_FIX_MISSING');
    w.as('integrator', (c) => integ.cancelCandidate(c, brake, { reason: '带上补丁修复重新集成' }));
    // With the fix merged in, the new mainline set may serve 1.0 as well.
    const both = freeze(w, preview(w, [feature(w, 'brake_monitor').id, fix]), 'X89-C4');
    testCandidate(w, both, ON_10);
    assert.equal(rel.promoteVersionProblem(w.s, w.s.candidates[both]!, '1.0'), null);
    w.as('release', (c) => rel.promoteCandidate(c, both, { dclVersion: '1.1.1', vehicleIntegrationVersions: ['1.0'] }));
    assert.equal(rel.setInEffect(w.s, 'X89', '1.0')?.dclVersion, '1.1.1');
  });

  test('a preview whose patch target moves through applicability is superseded', () => {
    const w = new World(demoState());
    mainline110(w);
    const plan = preview(w, [angleFix(w)], set(w, '1.0.0').id);
    w.as('release', (c) => ap.withdrawApplicability(c, { releaseId: set(w, '1.0.0').id, version: '1.0', reason: '1.0 停用' }));
    assert.equal(w.s.mergePlans[plan]!.status, 'SUPERSEDED');
  });
});

describe('review fixes: budgets, pauses and quotas', () => {
  test('a waiting capture that no longer fits an hour’s upload is dropped instead of blocking the queue', () => {
    const w = new World(demoState());
    w.as('dcl', (c) => setVehicleBudget(c, 'VEH-201', { ...DEFAULT_BUDGET, networkMbPerHour: 4 }));
    w.sys((c) => captureEvent(c, { resourceId: 'VEH-201', policyId: ANGLE }));
    const held = w.sys((c) => captureEvent(c, { resourceId: 'VEH-201', policyId: ANGLE }));
    assert.equal(w.s.events[held]!.status, 'HELD');
    w.as('dcl', (c) => setVehicleBudget(c, 'VEH-201', { ...DEFAULT_BUDGET, networkMbPerHour: 2 }));
    w.sys((c) => tick(c));
    assert.deepEqual([w.s.events[held]!.status, w.s.events[held]!.budgetNote], ['DROPPED', 'NETWORK']);
  });

  test('pausing a vehicle needs a grant in a workspace that uses it', () => {
    const w = new World(demoState());
    w.denied('release', (c) => pauseCollection(c, 'VEH-003', { reason: '越权' }));
    w.denied('adc_integrator', (c) => pauseCollection(c, 'VEH-031', { reason: '越权' }));
    w.as('release', (c) => pauseCollection(c, 'VEH-201', { reason: '链路拥塞' }));
    w.as('dcl', (c) => pauseCollection(c, 'VEH-003', { reason: '链路拥塞' }));
  });

  test('budgets are platform-wide configuration: only a DCL grant over every workspace sets them', () => {
    const w = new World(demoState());
    w.as('dcl', (c) => setModelBudget(c, 'X89', DEFAULT_BUDGET));
    w.denied('resource', (c) => setModelBudget(c, 'X89', DEFAULT_BUDGET));
  });

  test('a capture waiting on the vehicle blocks an environment move', () => {
    const w = new World(demoState());
    w.as('dcl', (c) => setVehicleBudget(c, 'VEH-003', { ...DEFAULT_BUDGET, networkMbPerHour: 5 }));
    w.sys((c) => captureEvent(c, { resourceId: 'VEH-003', policyId: ANGLE }));
    const held = w.sys((c) => captureEvent(c, { resourceId: 'VEH-003', policyId: ANGLE }));
    assert.equal(w.s.events[held]!.status, 'HELD');
    assert.ok(environmentMoveProblems(w.s, w.s.resources['VEH-003']!, 'testing').includes(`event ${held} still waits on the vehicle for upload budget`));
  });

  test('a retired simulation stays retired, so it cannot slip back past the run quota', () => {
    const w = new World(demoState());
    w.as('resource', (c) => fleet.setSimulationQuota(c, 'x89-integration', fleet.runningSimulations(w.s, 'x89-integration').length));
    // SIM-101 runs in a test group: stop it and take it out so it is idle and free to retire.
    w.as('integration_admin', (c) => fleet.stopSimulation(c, 'SIM-101'));
    w.as('integration_admin', (c) => fleet.removeGroupMember(c, groupId(w, 'X89 集成测试车组'), 'SIM-101', '报废'));
    w.as('resource', (c) => fleet.setResourceStatus(c, 'SIM-101', { status: 'RETIRED', reason: '硬件故障' }));
    // The freed place can be used; the retired one never comes back to take a second.
    w.as('integration_admin', (c) => fleet.createSimulation(c, { id: 'SIM-777', workspaceId: 'x89-integration', imageId: 'x89-1.0-sim', env: 'testing', pool: 'Vehicle' }));
    w.fails('VEHICLE_RETIRED', () => w.as('resource', (c) => fleet.setResourceStatus(c, 'SIM-101', { status: 'AVAILABLE', reason: '复活' })));
  });
});
