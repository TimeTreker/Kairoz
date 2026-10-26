import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { World } from '../acceptance/world.ts';
import { createSimulation, runningSimulations, setSimulationQuota, startSimulation, stopSimulation } from '../src/engine/fleet.ts';
import { migrate } from '../src/engine/migrate.ts';
import { createPersonalSim } from '../src/engine/personal-sim.ts';
import { demoState } from '../src/engine/seed.ts';
import { STATE_SCHEMA } from '../src/engine/types.ts';

const running = (w: World, ws: string) => runningSimulations(w.s, ws).map((r) => r.id).sort();

describe('simulation run quota', () => {
  test('vehicle resources cap a workspace’s running simulations; team and personal ones count together', () => {
    const w = new World(demoState());
    const now = running(w, 'team-brake');
    assert.ok(now.length >= 1, 'the brake team runs simulations');
    for (const u of ['workspace_manager', 'business', 'dcl', 'release']) w.denied(u, (c) => setSimulationQuota(c, 'team-brake', 5));
    w.fails('INVALID_QUOTA', () => w.as('resource', (c) => setSimulationQuota(c, 'team-brake', 1.5)));
    w.fails('QUOTA_BELOW_RUNNING', () => w.as('resource', (c) => setSimulationQuota(c, 'team-brake', now.length - 1)));
    w.as('resource', (c) => setSimulationQuota(c, 'team-brake', now.length + 1));

    // One more fits: a personal simulation takes it.
    w.as('business', (c) => createPersonalSim(c, { workspaceId: 'team-brake', groupId: 'brake', imageId: 'x89-1.0-sim' }));
    assert.equal(running(w, 'team-brake').length, now.length + 1);
    w.fails('SIMULATION_QUOTA', () => w.as('workspace_manager', (c) => createSimulation(c, { id: 'SIM-029', workspaceId: 'team-brake', imageId: 'x89-1.0-sim', env: 'development', pool: 'Chassis' })));
    w.fails('SIMULATION_QUOTA', () => w.as('business', (c) => createPersonalSim(c, { workspaceId: 'team-brake', groupId: 'brake', imageId: 'x89-1.0-sim' })));

    // Stopping one makes room; starting it again is refused once the room is taken.
    const team = now[0]!;
    w.as('workspace_manager', (c) => stopSimulation(c, team));
    w.as('workspace_manager', (c) => createSimulation(c, { id: 'SIM-029', workspaceId: 'team-brake', imageId: 'x89-1.0-sim', env: 'development', pool: 'Chassis' }));
    w.fails('SIMULATION_QUOTA', () => w.as('workspace_manager', (c) => startSimulation(c, team)));

    // Lifting the quota removes the limit; other workspaces never had one.
    w.as('resource', (c) => setSimulationQuota(c, 'team-brake', null));
    w.as('workspace_manager', (c) => startSimulation(c, team));
    assert.equal(w.s.simulationQuotas['team-steering'], undefined);
  });

  test('a schema 17 save has no quotas and keeps everything else', () => {
    const current = JSON.parse(JSON.stringify(demoState()));
    const old = JSON.parse(JSON.stringify(current));
    old.schema = 17;
    delete old.simulationQuotas;
    const migrated = migrate(old)!;
    assert.equal(migrated.schema, STATE_SCHEMA);
    assert.deepEqual(migrated, current);
  });
});
