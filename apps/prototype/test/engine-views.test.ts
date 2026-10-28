import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { Engine } from '../src/engine/engine.ts';
import * as fleet from '../src/engine/fleet.ts';
import { productionDistribution } from '../src/engine/history.ts';
import { workspaceMembers } from '../src/engine/identity.ts';
import { demoState } from '../src/engine/seed.ts';
import { carRuns } from '../acceptance/helpers.ts';

describe('views for the roles', () => {
  test('a workspace’s members: those its grants name, then platform-wide ones', () => {
    const s = demoState();
    const members = workspaceMembers(s, 'team-brake');
    assert.deepEqual(
      members.filter((m) => !m.everywhere).map((m) => m.username),
      ['brake_tester', 'business', 'dispatch_operator', 'workspace_manager'],
    );
    assert.ok(members.filter((m) => m.everywhere).some((m) => m.username === 'dcl'));
  });

  test('production vehicles by software and running set, without ids; unknown software apart', () => {
    const e = new Engine(demoState());
    assert.deepEqual(productionDistribution(e.getState(), 'X89'), [{ version: '1.0', vehicles: 2, expected: 2, sets: [{ dclVersion: '1.0.0', vehicles: 2 }] }]);
    carRuns(e, 'VEH-202', null);
    assert.deepEqual(
      productionDistribution(e.getState(), 'X89').map((r) => [r.version, r.vehicles]),
      [['1.0', 1], [null, 1]],
    );
  });
});
