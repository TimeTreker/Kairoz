import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { verifyFeatureOn } from '../acceptance/helpers.ts';
import { World } from '../acceptance/world.ts';
import { DEFAULT_BUDGET } from '../src/domain/budget.ts';
import type { Budget } from '../src/domain/budget.ts';
import { budgetOf, resourceCheck, setModelBudget, setVehicleBudget, usageOf } from '../src/engine/budget.ts';
import { confirmHold, isCollectionPaused, pauseCollection, resumeCollection } from '../src/engine/collection-hold.ts';
import * as config from '../src/engine/config.ts';
import { captureEvent, visibleEvents } from '../src/engine/events.ts';
import * as integ from '../src/engine/integration.ts';
import { notificationsFor } from '../src/engine/notifications.ts';
import { demoState } from '../src/engine/seed.ts';
import { advanceClockHours, tick } from '../src/engine/simulator.ts';

const ANGLE = 'chassis.steering.angle_jump';
const groupId = (w: World, name: string) => Object.values(w.s.vehicleGroups).find((g) => g.name === name)!.id;
const budget = (b: Partial<Budget>): Budget => ({ ...DEFAULT_BUDGET, ...b });
const fire = (w: World, resourceId: string, policyId = ANGLE) => w.sys((c) => captureEvent(c, { resourceId, policyId }));
const ev = (w: World, id: string) => w.s.events[id]!;

/** A brake Feature whose one policy is HIGH priority, verified and running on 制动研发车组 (VEH-001, SIM-021). */
function highPolicy(w: World): string {
  const id = w.as('business', (c) => config.createFeature(c, { workspaceId: 'team-brake', groupId: 'brake', name: 'brake_core' }));
  const dataKey = w.as('business', (c) => config.addFile(c, id, { source: { unit: 'CHASSIS', directory: '/var/log/core', pattern: 'core.log' }, name: '制动核心日志', purpose: '售后核心诊断' }));
  w.as('business', (c) => config.putPolicy(c, id, 'chassis.brake.core', { name: '制动核心', trigger: 'brake_pressure > 90', captures: [dataKey], preSeconds: 30, postSeconds: 30, priority: 'HIGH' }));
  w.as('business', (c) => config.submitFeature(c, id, { message: 'core' }));
  verifyFeatureOn(w, 'brake_tester', id, [groupId(w, '制动研发车组')]);
  return 'chassis.brake.core';
}

describe('collection budget', () => {
  test('a capture is sized by its file types over the window and costs the vehicle its edge processing', () => {
    const w = new World(demoState());
    const e = ev(w, fire(w, 'VEH-201'));
    assert.deepEqual([e.status, e.priority, e.cost, e.files.map((f) => f.sizeBytes)], ['UPLOADING', 'NORMAL', { cpuSec: 0.75, memoryMb: 3, ioMb: 3, networkMb: 3 }, [3_000_000]]);
    assert.equal(e.writtenAt, e.occurredAt);
    assert.equal(e.uploadAt, e.occurredAt);
    const u = usageOf(w.s, 'VEH-201');
    assert.deepEqual([u.cpuSec, u.ioMb, u.networkMb, u.bufferMb, u.triggers[ANGLE]], [0.75, 3, 3, 3, 1]);
  });

  test('DCL sets the model budget and per-vehicle overrides; nobody else does', () => {
    const w = new World(demoState());
    assert.equal(budgetOf(w.s, 'VEH-201').source, 'DEFAULT');
    for (const u of ['business', 'brake_tester', 'resource', 'release']) w.denied(u, (c) => setModelBudget(c, 'X89', budget({ networkMbPerHour: 5 })));
    w.fails('INVALID_BUDGET', () => w.as('dcl', (c) => setModelBudget(c, 'X89', budget({ networkMbPerHour: 0 }))));
    w.fails('INVALID_BUDGET', () => w.as('dcl', (c) => setModelBudget(c, 'X89', budget({ triggersPerPolicyPerHour: 2.5 }))));
    w.as('dcl', (c) => setModelBudget(c, 'X89', budget({ networkMbPerHour: 5 })));
    w.as('dcl', (c) => setVehicleBudget(c, 'VEH-031', budget({ networkMbPerHour: 50 })));
    assert.deepEqual([budgetOf(w.s, 'VEH-201'), budgetOf(w.s, 'VEH-031').source], [{ budget: budget({ networkMbPerHour: 5 }), source: 'MODEL' }, 'VEHICLE']);
    w.as('dcl', (c) => setVehicleBudget(c, 'VEH-031', null));
    assert.equal(budgetOf(w.s, 'VEH-031').source, 'MODEL');
    w.fails('NO_VEHICLE_BUDGET', () => w.as('dcl', (c) => setVehicleBudget(c, 'VEH-031', null)));
  });

  test('over the upload budget a capture waits, and uploads in the next hour', () => {
    const w = new World(demoState());
    w.as('dcl', (c) => setModelBudget(c, 'X89', budget({ networkMbPerHour: 5 })));
    const first = fire(w, 'VEH-201');
    const second = fire(w, 'VEH-201');
    assert.deepEqual([ev(w, first).status, ev(w, second).status, ev(w, second).uploadAt], ['UPLOADING', 'HELD', null]);
    w.sys((c) => tick(c));
    assert.equal(ev(w, second).status, 'HELD', 'still no budget this hour');
    assert.equal(usageOf(w.s, 'VEH-201').held, 1);
    w.sys((c) => advanceClockHours(c, 1));
    w.sys((c) => tick(c));
    assert.notEqual(ev(w, second).status, 'HELD', 'the next hour has budget');
    assert.ok(ev(w, second).uploadAt);
  });

  test('a flood is suppressed and storage, CPU or buffer overruns are dropped; neither reaches the data query', () => {
    const w = new World(demoState());
    w.as('dcl', (c) => setModelBudget(c, 'X89', budget({ triggersPerPolicyPerHour: 2 })));
    const ids = [fire(w, 'VEH-201'), fire(w, 'VEH-201'), fire(w, 'VEH-201')];
    assert.deepEqual(ids.map((id) => ev(w, id).status), ['UPLOADING', 'UPLOADING', 'SUPPRESSED']);
    assert.deepEqual([ev(w, ids[2]!).budgetNote, ev(w, ids[2]!).writtenAt, usageOf(w.s, 'VEH-201').suppressed], ['FLOOD', null, 1]);
    assert.ok(!visibleEvents(w.s, w.actor('release'), 'x89-project').some((e) => e.id === ids[2]));

    w.as('dcl', (c) => setVehicleBudget(c, 'VEH-202', budget({ ioMbPerHour: 5 })));
    assert.deepEqual([fire(w, 'VEH-202'), fire(w, 'VEH-202')].map((id) => [ev(w, id).status, ev(w, id).budgetNote]), [['UPLOADING', null], ['DROPPED', 'IO']]);
    w.as('dcl', (c) => setVehicleBudget(c, 'VEH-031', budget({ cpuSecondsPerHour: 1 })));
    assert.deepEqual([fire(w, 'VEH-031'), fire(w, 'VEH-031')].map((id) => ev(w, id).budgetNote), [null, 'CPU']);
    w.as('dcl', (c) => setVehicleBudget(c, 'SIM-101', budget({ memoryMb: 5, networkMbPerHour: 1 })));
    assert.deepEqual([fire(w, 'SIM-101'), fire(w, 'SIM-101')].map((id) => [ev(w, id).status, ev(w, id).budgetNote]), [['HELD', null], ['DROPPED', 'MEMORY']]);
  });

  test('HIGH-priority captures are collected over budget and evict waiting captures, lowest first', () => {
    const w = new World(demoState());
    const high = highPolicy(w);
    w.as('dcl', (c) => setVehicleBudget(c, 'VEH-001', budget({ networkMbPerHour: 1, memoryMb: 7 })));
    // Two NORMAL steering captures wait (3 MB each), then the HIGH one (60 s of text log, 1.2 MB) needs room.
    const waiting = [fire(w, 'VEH-001'), fire(w, 'VEH-001')];
    assert.deepEqual(waiting.map((id) => ev(w, id).status), ['HELD', 'HELD']);
    const core = ev(w, fire(w, 'VEH-001', high));
    assert.deepEqual([core.priority, core.status, core.budgetNote, core.cost?.memoryMb], ['HIGH', 'UPLOADING', 'OVER_BUDGET_HIGH', 1.2]);
    assert.deepEqual(waiting.map((id) => [ev(w, id).status, ev(w, id).budgetNote]), [['HELD', null], ['DROPPED', 'EVICTED']], 'the newest waiting capture made room');
  });
});

describe('resource protection at merge', () => {
  test('a policy whose single capture exceeds the model budget blocks DCL’s confirmation', () => {
    const w = new World(demoState());
    const steering = Object.values(w.s.features).find((f) => f.name === 'steering_return_rate')!;
    const plan = w.as('integrator', (c) => integ.previewMerge(c, { workspaceId: 'x89-project', featureIds: [steering.id] }));
    assert.deepEqual(resourceCheck(w.s, w.s.mergePlans[plan]!).policies.map((p) => [p.policyId, p.status]), [[ANGLE, 'OK'], ['chassis.steering.return_rate', 'OK']]);
    w.as('dcl', (c) => setModelBudget(c, 'X89', budget({ memoryMb: 3.5, networkMbPerHour: 40 })));
    const check = resourceCheck(w.s, w.s.mergePlans[plan]!);
    assert.deepEqual(check.policies.map((p) => [p.status, p.dimensions]), [['NEVER_FITS', ['memory']], ['NEVER_FITS', ['memory']]]);
    const err = w.fails('RESOURCE_BUDGET', () => w.as('dcl', (c) => integ.confirmProcessing(c, plan, { note: '' })));
    assert.match((err.details as { issues: string[] }).issues[0]!, /memory 4 MB > 3.5 MB/);
    w.as('dcl', (c) => setModelBudget(c, 'X89', budget({ memoryMb: 64, networkMbPerHour: 40 })));
    assert.deepEqual(resourceCheck(w.s, w.s.mergePlans[plan]!).policies.map((p) => [p.status, p.dimensions]), [['MAY_THROTTLE', ['network']], ['MAY_THROTTLE', ['network']]], '30 triggers of 4 MB exceed 40 MB an hour');
    w.as('dcl', (c) => integ.confirmProcessing(c, plan, { note: '可能限流，可接受' }));
  });
});

describe('emergency collection pause', () => {
  test('DCL or release pauses one vehicle at once; the vehicle confirms and drops what it holds; resuming is confirmed too', () => {
    const w = new World(demoState());
    w.as('dcl', (c) => setModelBudget(c, 'X89', budget({ networkMbPerHour: 1 })));
    const held = fire(w, 'VEH-201');
    assert.equal(ev(w, held).status, 'HELD');
    w.denied('business', (c) => pauseCollection(c, 'VEH-201', { reason: 'x' }));
    w.denied('resource', (c) => pauseCollection(c, 'VEH-201', { reason: 'x' }));
    w.fails('REASON_REQUIRED', () => w.as('release', (c) => pauseCollection(c, 'VEH-201', { reason: ' ' })));
    w.as('release', (c) => pauseCollection(c, 'VEH-201', { reason: '上传链路拥塞' }));
    assert.equal(w.s.collectionHolds['VEH-201']!.state, 'PAUSING');
    w.fails('COLLECTION_PAUSED', () => fire(w, 'VEH-201'));
    w.fails('ALREADY_PAUSED', () => w.as('dcl', (c) => pauseCollection(c, 'VEH-201', { reason: 'again' })));
    w.fails('PAUSE_UNCONFIRMED', () => w.as('dcl', (c) => resumeCollection(c, 'VEH-201', { reason: '恢复' })));
    assert.ok(notificationsFor(w.s, w.actor('release'), 'x89-project').some((n) => n.kind === 'COLLECTION_PAUSED' && n.subject === 'VEH-201'));

    w.sys((c) => tick(c));
    assert.deepEqual([w.s.collectionHolds['VEH-201']!.state, ev(w, held).status, ev(w, held).budgetNote], ['PAUSED', 'DROPPED', 'EMERGENCY_HOLD']);
    w.as('dcl', (c) => resumeCollection(c, 'VEH-201', { reason: '链路恢复' }));
    assert.ok(isCollectionPaused(w.s, 'VEH-201'), 'still paused until the vehicle confirms');
    w.sys((c) => confirmHold(c, 'VEH-201'));
    assert.equal(isCollectionPaused(w.s, 'VEH-201'), false);
    assert.deepEqual(w.s.collectionHolds['VEH-201']!.history.map((h) => [h.action, h.by, !!h.confirmedAt]), [['PAUSE', 'release', true], ['RESUME', 'dcl', true]]);
    w.fails('NOT_PAUSED', () => w.as('dcl', (c) => resumeCollection(c, 'VEH-201', { reason: 'x' })));
    fire(w, 'VEH-201');
  });
});
