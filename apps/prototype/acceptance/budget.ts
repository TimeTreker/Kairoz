// 资源预算与紧急停采 (BG01–BG07, N01) on the demo installation: DCL's collection budget per vehicle
// model, the resource-protection check at merge, the vehicle's budget guard (wait, drop, flood
// suppression, HIGH priority first), per-vehicle overrides and the emergency collection pause.

import { DEFAULT_BUDGET } from '../src/domain/budget.ts';
import type { Budget } from '../src/domain/budget.ts';
import { budgetOf, resourceCheck, setModelBudget, setVehicleBudget, usageOf } from '../src/engine/budget.ts';
import { isCollectionPaused, pauseCollection, resumeCollection } from '../src/engine/collection-hold.ts';
import * as config from '../src/engine/config.ts';
import { captureEvent, visibleEvents } from '../src/engine/events.ts';
import * as integ from '../src/engine/integration.ts';
import { notificationsFor } from '../src/engine/notifications.ts';
import { demoState } from '../src/engine/seed.ts';
import { advanceClockHours, tick } from '../src/engine/simulator.ts';
import type { State } from '../src/engine/types.ts';
import { verifyFeatureOn } from './helpers.ts';
import type { SceneSpec, World } from './world.ts';

export const start = (): State => demoState();

const ANGLE = 'chassis.steering.angle_jump';
const X89: Budget = { ...DEFAULT_BUDGET, memoryMb: 64, networkMbPerHour: 5, triggersPerPolicyPerHour: 3 };
const group = (w: World, name: string) => Object.values(w.s.vehicleGroups).find((g) => g.name === name)!.id;
const fire = (w: World, resourceId: string, policyId = ANGLE) => w.sys((c) => captureEvent(c, { resourceId, policyId }));
const status = (w: World, id: string) => w.s.events[id]!.status;

export const scenes: Record<string, SceneSpec> = {
  BG01: {
    run: (w) => {
      w.eq(budgetOf(w.s, 'VEH-201').source, 'DEFAULT', 'until DCL sets one, the default budget applies');
      w.fails('INVALID_BUDGET', () => w.as('dcl', (c) => setModelBudget(c, 'X89', { ...X89, networkMbPerHour: -1 })));
      w.as('dcl', (c) => setModelBudget(c, 'X89', X89));
      w.eq(budgetOf(w.s, 'VEH-201'), { budget: X89, source: 'MODEL' }, 'every X89 vehicle takes the model budget');
    },
  },
  BG02: {
    needs: ['BG01'],
    run: (w) => {
      // A steering change that keeps 115 s around the trigger: 23 MB a capture, more than an hour's upload.
      const id = w.as('steering', (c) => config.createFeature(c, { workspaceId: 'team-steering', groupId: 'steering', name: 'angle_jump_long' }));
      const p = w.s.features[id]!.draft.policies[ANGLE]!;
      w.as('steering', (c) => config.putPolicy(c, id, ANGLE, { ...p, postSeconds: 110 }));
      w.as('steering', (c) => config.submitFeature(c, id, { message: '延长转角突变录制' }));
      verifyFeatureOn(w, 'steering_tester', id, [group(w, '转向研发车组')]);
      let plan = w.as('integrator', (c) => integ.previewMerge(c, { workspaceId: 'x89-project', featureIds: [id] }));
      const check = resourceCheck(w.s, w.s.mergePlans[plan]!).policies.find((x) => x.policyId === ANGLE)!;
      w.eq([check.status, check.dimensions, check.cost.networkMb], ['NEVER_FITS', ['network'], 23], 'one capture is more than an hour of upload');
      w.fails('RESOURCE_BUDGET', () => w.as('dcl', (c) => integ.confirmProcessing(c, plan, { note: '' })));
      // The team shortens the window and tests again; it fits, though a full hour of triggers would be throttled.
      w.as('steering', (c) => config.putPolicy(c, id, ANGLE, { ...p, postSeconds: 15 }));
      w.as('steering', (c) => config.submitFeature(c, id, { message: '缩短到 20 秒' }));
      verifyFeatureOn(w, 'steering_tester', id, [group(w, '转向研发车组')]);
      plan = w.as('integrator', (c) => integ.previewMerge(c, { workspaceId: 'x89-project', featureIds: [id] }));
      w.eq(resourceCheck(w.s, w.s.mergePlans[plan]!).policies.find((x) => x.policyId === ANGLE)!.status, 'MAY_THROTTLE', '4 MB a capture fits; three an hour may wait');
      w.as('dcl', (c) => integ.confirmProcessing(c, plan, { note: '高频时会排队，可接受' }));
    },
  },
  BG03: {
    needs: ['BG01'],
    run: (w) => {
      // The brake team's after-sales diagnosis is core business: HIGH priority.
      const id = w.as('business', (c) => config.createFeature(c, { workspaceId: 'team-brake', groupId: 'brake', name: 'brake_core' }));
      const dataKey = w.as('business', (c) => config.addFile(c, id, { source: { unit: 'CHASSIS', directory: '/var/log/core', pattern: 'core.log' }, name: '制动核心日志', purpose: '售后核心诊断' }));
      w.as('business', (c) => config.putPolicy(c, id, 'chassis.brake.core', { name: '制动核心', trigger: 'brake_pressure > 90', captures: [dataKey], preSeconds: 30, postSeconds: 30, priority: 'HIGH' }));
      w.as('business', (c) => config.submitFeature(c, id, { message: '售后核心诊断' }));
      verifyFeatureOn(w, 'brake_tester', id, [group(w, '制动研发车组')]);
      const e = fire(w, 'VEH-001');
      w.eq([status(w, e), w.s.events[e]!.cost?.networkMb], ['UPLOADING', 3], 'within budget the capture uploads at once');
      w.ref.firstCapture = e;
    },
  },
  BG04: {
    needs: ['BG03'],
    run: (w) => {
      const waiting = fire(w, 'VEH-001');
      w.eq(status(w, waiting), 'HELD', 'another 3 MB would pass the 5 MB upload budget: it waits');
      const core = fire(w, 'VEH-001', 'chassis.brake.core');
      w.eq([status(w, core), w.s.events[core]!.budgetNote], ['UPLOADING', null], 'the 1.2 MB HIGH capture still fits and goes ahead of the waiting one');
      const again = fire(w, 'VEH-001', 'chassis.brake.core');
      w.eq([status(w, again), w.s.events[again]!.budgetNote], ['UPLOADING', 'OVER_BUDGET_HIGH'], 'the next HIGH capture runs over the hour and is still collected');
      w.sys((c) => tick(c));
      w.eq(status(w, waiting), 'HELD', 'no budget left this hour');
      w.sys((c) => advanceClockHours(c, 1));
      w.sys((c) => tick(c));
      w.check(status(w, waiting) !== 'HELD' && !!w.s.events[waiting]!.uploadAt, 'the next hour uploads it');
    },
  },
  BG05: {
    needs: ['BG01'],
    run: (w) => {
      const ids = Array.from({ length: 10 }, () => fire(w, 'VEH-201'));
      const counts = ids.reduce<Record<string, number>>((m, id) => ((m[status(w, id)] = (m[status(w, id)] ?? 0) + 1), m), {});
      w.eq(counts, { UPLOADING: 1, HELD: 2, SUPPRESSED: 7 }, 'three triggers an hour; the rest are suppressed, and two wait for upload');
      w.eq(usageOf(w.s, 'VEH-201').suppressed, 7, 'the vehicle counts the suppressed triggers');
      w.check(!visibleEvents(w.s, w.actor('release'), 'x89-project').some((e) => e.status === 'SUPPRESSED'), 'suppressed triggers carry no data');
      w.check(notificationsFor(w.s, w.actor('dcl'), 'x89-project').some((n) => n.kind === 'BUDGET_DROPS' && n.subject === 'VEH-201'), 'DCL is told');
      w.ref.flood = ids.find((id) => status(w, id) === 'HELD')!;
    },
  },
  BG06: {
    needs: ['BG05'],
    run: (w) => {
      w.as('release', (c) => pauseCollection(c, 'VEH-201', { reason: '上传链路拥塞' }));
      w.fails('COLLECTION_PAUSED', () => fire(w, 'VEH-201'));
      w.check(notificationsFor(w.s, w.actor('release'), 'x89-project').some((n) => n.kind === 'COLLECTION_PAUSED'), 'the pause shows in the notification center');
      w.sys((c) => tick(c));
      w.eq([w.s.collectionHolds['VEH-201']!.state, status(w, w.ref.flood!), w.s.events[w.ref.flood!]!.budgetNote], ['PAUSED', 'DROPPED', 'EMERGENCY_HOLD'], 'the vehicle confirms and drops what it still holds');
      w.as('dcl', (c) => resumeCollection(c, 'VEH-201', { reason: '链路恢复' }));
      w.sys((c) => tick(c));
      w.eq(isCollectionPaused(w.s, 'VEH-201'), false, 'collection resumes once the vehicle confirms');
      w.eq(w.s.collectionHolds['VEH-201']!.history.map((h) => [h.action, h.by]), [['PAUSE', 'release'], ['RESUME', 'dcl']], 'the history stays');
    },
  },
  BG07: {
    needs: ['BG01'],
    run: (w) => {
      w.as('dcl', (c) => setVehicleBudget(c, 'VEH-031', { ...X89, networkMbPerHour: 100 }));
      w.eq([fire(w, 'VEH-031'), fire(w, 'VEH-031')].map((id) => status(w, id)), ['UPLOADING', 'UPLOADING'], 'the test car uploads on its own budget');
      w.as('dcl', (c) => setVehicleBudget(c, 'VEH-031', null));
      w.eq(budgetOf(w.s, 'VEH-031').source, 'MODEL', 'cleared, it is back on the model budget');
    },
  },
  N01: {
    needs: ['BG01'],
    run: (w) => {
      for (const u of ['business', 'brake_tester', 'resource', 'release', 'integrator']) w.denied(u, (c) => setModelBudget(c, 'X89', X89));
      for (const u of ['business', 'brake_tester', 'resource', 'integrator', 'workspace_manager']) w.denied(u, (c) => pauseCollection(c, 'VEH-201', { reason: '越权' }));
      w.fails('NOT_PAUSED', () => w.as('dcl', (c) => resumeCollection(c, 'VEH-201', { reason: 'x' })));
    },
  },
};
