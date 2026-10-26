import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { World } from '../acceptance/world.ts';
import { answerCaptureRequest, cancelCaptureRequest, graderCapture, requestAfterSalesCapture } from '../src/engine/aftersales.ts';
import { pauseCollection } from '../src/engine/collection-hold.ts';
import { captureEvent, visibleEvents } from '../src/engine/events.ts';
import { migrate } from '../src/engine/migrate.ts';
import { notificationsFor } from '../src/engine/notifications.ts';
import { demoState } from '../src/engine/seed.ts';
import { setAgent, tick } from '../src/engine/simulator.ts';
import { STATE_SCHEMA } from '../src/engine/types.ts';

const MONITOR = 'chassis.brake.monitor';
const ask = (w: World, user = 'business', policyId = MONITOR) =>
  w.as(user, (c) => requestAfterSalesCapture(c, { workspaceId: 'team-brake', resourceId: 'VEH-001', policyId, reason: '客户投诉：制动异响' }));

describe('after-sales requests and the grader', () => {
  test('the brake team asks VEH-001 for a capture of its own policy; the vehicle answers as core business', () => {
    const w = new World(demoState());
    w.denied('business', (c) => requestAfterSalesCapture(c, { workspaceId: 'team-brake', resourceId: 'VEH-001', policyId: 'chassis.steering.angle_jump', reason: 'x' }));
    w.denied('dispatch_operator', (c) => requestAfterSalesCapture(c, { workspaceId: 'team-brake', resourceId: 'VEH-001', policyId: MONITOR, reason: 'x' }));
    w.fails('REASON_REQUIRED', () => w.as('business', (c) => requestAfterSalesCapture(c, { workspaceId: 'team-brake', resourceId: 'VEH-001', policyId: MONITOR, reason: ' ' })));
    const q = ask(w);
    w.fails('REQUEST_PENDING', () => ask(w));
    w.sys((c) => tick(c));
    const req = w.s.captureRequests[q]!;
    const e = w.s.events[req.eventId!]!;
    assert.deepEqual([req.status, e.source, e.priority, e.requestId, e.workspaceId], ['CAPTURED', 'AFTERSALES', 'HIGH', q, 'team-brake']);
    while (w.s.events[e.id]!.status !== 'DONE') w.sys((c) => tick(c));
    assert.ok(visibleEvents(w.s, w.actor('business'), 'team-brake').some((x) => x.id === e.id), 'the team finds it in its data query');
    assert.ok(notificationsFor(w.s, w.actor('business'), 'team-brake').some((n) => n.kind === 'AFTERSALES_READY' && n.detail?.startsWith('DONE')));
  });

  test('grader captures wait while after-sales work is open on the vehicle; triggers do not', () => {
    const w = new World(demoState());
    w.sys((c) => setAgent(c, 'VEH-001', { online: false }));
    const q = ask(w);
    const grader = w.sys((c) => graderCapture(c, 'VEH-001', 'chassis.brake.failure_diag'));
    assert.deepEqual([w.s.events[grader]!.status, w.s.events[grader]!.budgetNote, w.s.events[grader]!.source], ['HELD', 'DEFERRED', 'GRADER']);
    const trigger = w.sys((c) => captureEvent(c, { resourceId: 'VEH-001', policyId: 'chassis.brake.failure_diag' }));
    assert.equal(w.s.events[trigger]!.status, 'UPLOADING', 'a trigger is not after-sales arbitration’s business');
    w.sys((c) => setAgent(c, 'VEH-001', { online: true }));
    w.sys((c) => tick(c));
    assert.equal(w.s.captureRequests[q]!.status, 'CAPTURED');
    assert.equal(w.s.events[grader]!.status, 'HELD', 'still waiting: the after-sales capture is uploading');
    w.sys((c) => tick(c));
    assert.notEqual(w.s.events[grader]!.status, 'HELD', 'after-sales is uploaded; the grader capture goes');
    assert.equal(w.s.events[grader]!.budgetNote, null);
  });

  test('a request is cancelled by its asker, refused while collection is paused, and answered only once', () => {
    const w = new World(demoState());
    w.sys((c) => setAgent(c, 'VEH-001', { online: false }));
    const q = ask(w);
    w.as('business', (c) => cancelCaptureRequest(c, q));
    w.fails('REQUEST_ANSWERED', () => w.as('business', (c) => cancelCaptureRequest(c, q)));
    w.fails('REQUEST_ANSWERED', () => w.sys((c) => answerCaptureRequest(c, q)));
    w.as('dcl', (c) => pauseCollection(c, 'VEH-001', { reason: '链路拥塞' }));
    w.fails('COLLECTION_PAUSED', () => ask(w));
  });

  test('a schema 18 save: every capture came from a trigger, and there are no requests', () => {
    const current = JSON.parse(JSON.stringify(demoState()));
    const old = JSON.parse(JSON.stringify(current));
    old.schema = 18;
    delete old.captureRequests;
    for (const e of Object.values(old.events) as Record<string, unknown>[]) {
      delete e.source;
      delete e.requestId;
    }
    const migrated = migrate(old)!;
    assert.equal(migrated.schema, STATE_SCHEMA);
    assert.deepEqual(migrated, current);
  });
});
