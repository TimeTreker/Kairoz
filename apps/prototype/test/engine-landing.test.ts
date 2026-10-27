import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { Engine } from '../src/engine/engine.ts';
import { landingWorkspace, markNotificationsRead, notificationsFor, unreadByWorkspace } from '../src/engine/notifications.ts';
import { demoState } from '../src/engine/seed.ts';

describe('where an account starts', () => {
  test('in the workspace with the most to do, else project before team before integration', () => {
    const e = new Engine(demoState());
    const land = (u: string) => e.read(u, (s, a) => landingWorkspace(s, a));
    assert.deepEqual(
      ['integrator', 'release', 'integration_tester', 'business', 'steering', 'dcl'].map(land),
      ['x89-project', 'x89-project', 'x89-integration', 'team-brake', 'team-steering', 'team-adc-parking'],
    );
  });

  test('unread counts follow read marks', () => {
    const e = new Engine(demoState());
    const counts = () => e.read('integrator', (s, a) => unreadByWorkspace(s, a).find((x) => x.workspaceId === 'x89-project')!.unread);
    assert.equal(counts(), 2);
    const ids = e.read('integrator', (s, a) => notificationsFor(s, a, 'x89-project').map((n) => n.id));
    e.run('integrator', (c) => markNotificationsRead(c, 'x89-project', ids));
    assert.equal(counts(), 0);
  });
});

describe('what a vehicle of unknown software is told', () => {
  test('it waits for its software to be known, rather than for a new dispatch', async () => {
    const { answerConfigRequest } = await import('../src/engine/ota.ts');
    const fleet = await import('../src/engine/fleet.ts');
    const e = new Engine(demoState());
    e.run('resource', (c) => fleet.confirmIntegration(c, 'VEH-001', { version: null, source: '刷写记录丢失' }));
    assert.equal(answerConfigRequest(e.getState(), 'VEH-001').reason, 'UNKNOWN_SOFTWARE');
  });
});
