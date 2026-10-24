// 通知中心 (NC01–NC06) on the demo installation: each account's current items in a workspace,
// from its grants there; a change of state raises a new item; read marks are the account's own
// per workspace and change nothing else; an out-of-date item cannot be opened.

import * as fleet from '../src/engine/fleet.ts';
import { returnFeature } from '../src/engine/intake.ts';
import * as nc from '../src/engine/notifications.ts';
import { demoState } from '../src/engine/seed.ts';
import type { State } from '../src/engine/types.ts';
import * as v from '../src/engine/validation.ts';
import { answerAll } from './helpers.ts';
import type { SceneSpec, World } from './world.ts';

export const start = (): State => demoState();

const feature = (w: World, name: string) => Object.values(w.s.features).find((f) => f.name === name)!;
const group = (w: World, name: string) => Object.values(w.s.vehicleGroups).find((g) => g.name === name)!.id;
const items = (w: World, user: string, ws: string) => nc.notificationsFor(w.s, w.actor(user), ws);
const unread = (w: World, user: string, ws: string) => {
  const read = nc.readIds(w.s, user, ws);
  return items(w, user, ws).filter((n) => !read.has(n.id));
};

export const scenes: Record<string, SceneSpec> = {
  NC01: {
    run: (w) => {
      const brake = items(w, 'business', 'team-brake');
      w.eq(brake.map((n) => n.subject).sort(), ['brake_monitor', 'chassis.steering', 'guided_brake'], 'the brake developer: brake Features and a reference request to brake');
      w.eq(items(w, 'steering', 'team-steering').map((n) => n.subject), ['steering_return_rate'], 'the steering developer: steering only');
      w.eq(items(w, 'business', 'team-steering'), [], 'nothing where the account has no grant');
      w.eq(items(w, 'brake_tester', 'team-brake').map((n) => [n.kind, n.subject]), [['FEATURE_TO_TEST', 'guided_brake']], 'the tester: what can be tested');
    },
  },
  NC02: {
    needs: ['NC01'],
    run: (w) => {
      const f = feature(w, 'guided_brake');
      const before = items(w, 'business', 'team-brake').find((n) => n.subject === 'guided_brake')!;
      for (const d of w.as('brake_tester', (c) => v.dispatchFeature(c, f.id, { commitId: f.headCommitId!, vehicleGroupIds: [group(w, '制动研发车组')] }))) answerAll(w, d);
      const after = items(w, 'business', 'team-brake').find((n) => n.subject === 'guided_brake')!;
      w.eq([before.detail, after.detail], ['DCL_READY', 'TESTING'], 'the Feature moved on');
      w.check(after.id !== before.id && !items(w, 'business', 'team-brake').some((n) => n.id === before.id), 'a new item replaces the old one');
      w.ref.staleId = before.id;
    },
  },
  NC03: {
    needs: ['NC02'],
    run: (w) => {
      const ref = items(w, 'business', 'team-brake').find((n) => n.kind === 'REFERENCE_REQUEST')!;
      const stage = feature(w, 'guided_brake').stage;
      const testerUnread = unread(w, 'brake_tester', 'team-brake').length;
      w.as('business', (c) => nc.markNotificationsRead(c, 'team-brake', [ref.id]));
      w.check(nc.readIds(w.s, 'business', 'team-brake').has(ref.id), 'marked read');
      w.eq(unread(w, 'brake_tester', 'team-brake').length, testerUnread, 'another account keeps its own marks');
      w.eq(feature(w, 'guided_brake').stage, stage, 'reading changes no Feature');
      w.eq(w.s.referenceRequests[JSON.parse(ref.id)[2]]?.status, 'PENDING', 'and does not decide the request');
    },
  },
  NC04: {
    needs: ['NC03'],
    run: (w) => {
      w.as('business', (c) => nc.markNotificationsRead(c, 'team-brake', unread(w, 'business', 'team-brake').map((n) => n.id)));
      w.eq(unread(w, 'business', 'team-brake'), [], 'all read');
      w.check(items(w, 'business', 'team-brake').length > 0, 'the items are still there, read');
    },
  },
  NC05: {
    needs: ['NC04'],
    run: (w) => {
      w.as('dcl', (c) => returnFeature(c, feature(w, 'parking_camera').id, { reason: '视频分辨率说明不完整' }));
      const [first] = items(w, 'adc_parking', 'team-adc-parking');
      w.eq([first?.kind, first?.severity, first?.detail], ['FEATURE_RETURNED', 'WARNING', '视频分辨率说明不完整'], 'a returned Feature comes first, as a warning');
      const vg = group(w, '制动研发车组');
      w.as('workspace_manager', (c) => fleet.setGroupApproval(c, vg, true));
      const g = feature(w, 'guided_brake');
      w.ref.request = w.as('brake_tester', (c) => v.requestTeamTest(c, g.id, { commitId: g.headCommitId!, vehicleGroupIds: [vg], goal: '急刹车场景复测' }));
      const pending = items(w, 'workspace_manager', 'team-brake').filter((n) => n.kind === 'TEST_REQUEST_PENDING');
      w.eq(pending.map((n) => [n.subject, n.severity]), [['guided_brake', 'WARNING']], 'the workspace admin is asked to decide');
      w.ref.pendingId = pending[0]!.id;
    },
  },
  NC06: {
    needs: ['NC05'],
    run: (w) => {
      w.as('workspace_manager', (c) => v.decideTestRequest(c, w.ref.request!, { decision: 'APPROVED', note: '同意复测' }));
      w.check(!items(w, 'workspace_manager', 'team-brake').some((n) => n.id === w.ref.pendingId), 'the decided request’s item is out of date and cannot be opened');
      w.check(!items(w, 'business', 'team-brake').some((n) => n.id === w.ref.staleId), 'so is the DCL Ready item of NC02');
      w.eq(items(w, 'brake_tester', 'team-brake').filter((n) => n.kind === 'TEST_REQUEST_DECIDED').map((n) => n.detail), ['APPROVED'], 'the requester is told the decision');
    },
  },
};
