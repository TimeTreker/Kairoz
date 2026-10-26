// 售后与 Grader (AS01–AS04, N01) on the demo installation: the brake team asks VEH-001 for a
// capture of its own policy for a customer case; the vehicle runs it as core business on its next
// connection, the grader's periodic capture on the same vehicle waits, and the data reaches the
// team's query.

import { answerCaptureRequest, cancelCaptureRequest, graderCapture, requestAfterSalesCapture } from '../src/engine/aftersales.ts';
import { captureEvent, visibleEvents } from '../src/engine/events.ts';
import { notificationsFor } from '../src/engine/notifications.ts';
import { demoState } from '../src/engine/seed.ts';
import { setAgent, tick } from '../src/engine/simulator.ts';
import type { State } from '../src/engine/types.ts';
import type { SceneSpec, World } from './world.ts';

export const start = (): State => demoState();

const MONITOR = 'chassis.brake.monitor';
const DIAG = 'chassis.brake.failure_diag';
const ask = (w: World, user: string, policyId: string) => w.as(user, (c) => requestAfterSalesCapture(c, { workspaceId: 'team-brake', resourceId: 'VEH-001', policyId, reason: '客户投诉：低速制动异响' }));

export const scenes: Record<string, SceneSpec> = {
  AS01: {
    run: (w) => {
      w.sys((c) => setAgent(c, 'VEH-001', { online: false }));
      w.ref.request = ask(w, 'business', MONITOR);
      w.eq(w.s.captureRequests[w.ref.request]!.status, 'PENDING', 'the vehicle is offline: the request waits');
      w.fails('REQUEST_PENDING', () => ask(w, 'brake_tester', MONITOR));
    },
  },
  AS02: {
    needs: ['AS01'],
    run: (w) => {
      const grader = w.sys((c) => graderCapture(c, 'VEH-001', DIAG));
      w.eq([w.s.events[grader]!.status, w.s.events[grader]!.budgetNote], ['HELD', 'DEFERRED'], 'after-sales first: the grader capture waits');
      const trigger = w.sys((c) => captureEvent(c, { resourceId: 'VEH-001', policyId: DIAG }));
      w.eq(w.s.events[trigger]!.status, 'UPLOADING', 'the policy’s own trigger is not held back');
      w.ref.grader = grader;
    },
  },
  AS03: {
    needs: ['AS02'],
    run: (w) => {
      w.sys((c) => setAgent(c, 'VEH-001', { online: true }));
      w.sys((c) => tick(c));
      const q = w.s.captureRequests[w.ref.request!]!;
      const e = w.s.events[q.eventId!]!;
      w.eq([q.status, e.source, e.priority, e.workspaceId], ['CAPTURED', 'AFTERSALES', 'HIGH', 'team-brake'], 'the vehicle captures it as core business for the brake team');
      w.eq(w.s.events[w.ref.grader!]!.status, 'HELD', 'the grader capture still waits for the after-sales upload');
      w.sys((c) => tick(c));
      w.check(w.s.events[w.ref.grader!]!.status !== 'HELD', 'then the grader capture goes');
      while (w.s.events[e.id]!.status !== 'DONE') w.sys((c) => tick(c));
      w.check(visibleEvents(w.s, w.actor('business'), 'team-brake').some((x) => x.id === e.id && x.source === 'AFTERSALES'), 'the team finds it in its data query');
      w.check(notificationsFor(w.s, w.actor('business'), 'team-brake').some((n) => n.kind === 'AFTERSALES_READY'), 'the asker is told the data is ready');
    },
  },
  AS04: {
    needs: ['AS01'],
    run: (w) => {
      w.sys((c) => setAgent(c, 'VEH-001', { online: false }));
      const q = ask(w, 'brake_tester', DIAG);
      w.as('brake_tester', (c) => cancelCaptureRequest(c, q));
      w.fails('REQUEST_ANSWERED', () => w.sys((c) => answerCaptureRequest(c, q)));
      w.sys((c) => setAgent(c, 'VEH-001', { online: true }));
    },
  },
  N01: {
    needs: ['AS01'],
    run: (w) => {
      w.denied('business', (c) => requestAfterSalesCapture(c, { workspaceId: 'team-brake', resourceId: 'VEH-001', policyId: 'chassis.steering.angle_jump', reason: '越权' }));
      w.denied('dispatch_operator', (c) => requestAfterSalesCapture(c, { workspaceId: 'team-brake', resourceId: 'VEH-001', policyId: MONITOR, reason: '越权' }));
      w.denied('resource', (c) => requestAfterSalesCapture(c, { workspaceId: 'team-brake', resourceId: 'VEH-001', policyId: MONITOR, reason: '越权' }));
      w.fails('REASON_REQUIRED', () => w.as('business', (c) => requestAfterSalesCapture(c, { workspaceId: 'team-brake', resourceId: 'VEH-001', policyId: DIAG, reason: '' })));
    },
  },
};
