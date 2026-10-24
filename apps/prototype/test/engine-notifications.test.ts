import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { answerAll } from '../acceptance/helpers.ts';
import { World } from '../acceptance/world.ts';
import * as fleet from '../src/engine/fleet.ts';
import { replaceGrants } from '../src/engine/identity.ts';
import { returnFeature } from '../src/engine/intake.ts';
import * as nc from '../src/engine/notifications.ts';
import { demoState } from '../src/engine/seed.ts';
import * as v from '../src/engine/validation.ts';

const feature = (w: World, name: string) => Object.values(w.s.features).find((f) => f.name === name)!;
const groupId = (w: World, name: string) => Object.values(w.s.vehicleGroups).find((g) => g.name === name)!.id;
const items = (w: World, user: string, ws: string) => nc.notificationsFor(w.s, w.actor(user), ws);

describe('notification center', () => {
  test('items come from what the account may see in the workspace, never another group', () => {
    const w = new World(demoState());
    const business = items(w, 'business', 'team-brake');
    assert.ok(business.length > 0);
    assert.ok(business.every((n) => n.role === 'BUSINESS_DEV'));
    assert.ok(!business.some((n) => n.subject === 'steering_return_rate'), 'no other group’s Features');
    assert.deepEqual(items(w, 'business', 'team-steering'), [], 'no grant there, nothing there');
    assert.deepEqual(items(w, 'steering', 'team-steering').map((n) => n.subject), ['steering_return_rate']);
  });

  test('a state change raises a new item; read marks are the account’s own and change nothing else', () => {
    const w = new World(demoState());
    const guided = feature(w, 'guided_brake');
    const before = items(w, 'business', 'team-brake').find((n) => n.subject === 'guided_brake')!;
    assert.equal(before.detail, 'DCL_READY');
    const features = w.s.features;
    w.as('business', (c) => nc.markNotificationsRead(c, 'team-brake', [before.id]));
    assert.ok(nc.readIds(w.s, 'business', 'team-brake').has(before.id));
    assert.equal(nc.readIds(w.s, 'brake_tester', 'team-brake').size, 0, 'another account has its own marks');
    assert.equal(nc.readIds(w.s, 'business', 'team-steering').size, 0, 'and so has another workspace');
    assert.equal(w.s.features, features, 'reading changes no Feature');
    // Dispatching moves the Feature on: a new, unread item.
    for (const d of w.as('brake_tester', (c) => v.dispatchFeature(c, guided.id, { commitId: guided.headCommitId!, vehicleGroupIds: [groupId(w, '制动研发车组')] }))) answerAll(w, d);
    const after = items(w, 'business', 'team-brake').find((n) => n.subject === 'guided_brake')!;
    assert.equal(after.detail, 'TESTING');
    assert.notEqual(after.id, before.id);
    assert.ok(!nc.readIds(w.s, 'business', 'team-brake').has(after.id));
  });

  test('warnings come first: a returned Feature, a pending team test request and its decision', () => {
    const w = new World(demoState());
    const parking = feature(w, 'parking_camera');
    w.as('dcl', (c) => returnFeature(c, parking.id, { reason: '视频分辨率说明不完整' }));
    const [first] = items(w, 'adc_parking', 'team-adc-parking');
    assert.deepEqual([first!.kind, first!.severity, first!.detail], ['FEATURE_RETURNED', 'WARNING', '视频分辨率说明不完整']);

    const vg = groupId(w, '制动研发车组');
    w.as('workspace_manager', (c) => fleet.setGroupApproval(c, vg, true));
    const guided = feature(w, 'guided_brake');
    const req = w.as('brake_tester', (c) => v.requestTeamTest(c, guided.id, { commitId: guided.headCommitId!, vehicleGroupIds: [vg], goal: '急刹车验证' }));
    assert.deepEqual(items(w, 'workspace_manager', 'team-brake').filter((n) => n.kind === 'TEST_REQUEST_PENDING').map((n) => n.subject), ['guided_brake']);
    w.as('workspace_manager', (c) => v.decideTestRequest(c, req, { decision: 'APPROVED', note: '同意' }));
    assert.equal(items(w, 'workspace_manager', 'team-brake').filter((n) => n.kind === 'TEST_REQUEST_PENDING').length, 0, 'decided: gone');
    assert.deepEqual(items(w, 'brake_tester', 'team-brake').filter((n) => n.kind === 'TEST_REQUEST_DECIDED').map((n) => n.detail), ['APPROVED']);
  });

  test('items follow the grants: without them the account sees nothing', () => {
    const w = new World(demoState());
    assert.ok(items(w, 'business', 'team-brake').length > 0);
    w.as('admin', (c) => replaceGrants(c, 'business', []));
    // The brake team's org rule still gives business development there.
    assert.ok(items(w, 'business', 'team-brake').every((n) => n.role === 'BUSINESS_DEV'));
    w.as('admin', (c) => replaceGrants(c, 'steering', []));
    assert.deepEqual(items(w, 'steering', 'team-steering'), []);
  });
});
