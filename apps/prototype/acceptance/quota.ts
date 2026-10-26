// 仿真运行配额 (Q01–Q03, N01) on the demo installation: vehicle resources cap how many simulations
// a workspace runs at once; team and personal simulations count together, and a quota never
// drops below what runs now.

import { createSimulation, runningSimulations, setSimulationQuota, stopSimulation } from '../src/engine/fleet.ts';
import { createPersonalSim } from '../src/engine/personal-sim.ts';
import { demoState } from '../src/engine/seed.ts';
import type { State } from '../src/engine/types.ts';
import type { SceneSpec, World } from './world.ts';

export const start = (): State => demoState();

const running = (w: World) => runningSimulations(w.s, 'team-brake').map((r) => r.id).sort();
const teamSim = (w: World) => w.as('workspace_manager', (c) => createSimulation(c, { id: 'SIM-029', workspaceId: 'team-brake', imageId: 'x89-1.0-sim', env: 'development', pool: 'Chassis', displayName: '制动联调仿真' }));
const personalSim = (w: World) => w.as('business', (c) => createPersonalSim(c, { workspaceId: 'team-brake', groupId: 'brake', imageId: 'x89-1.0-sim' }));

export const scenes: Record<string, SceneSpec> = {
  Q01: {
    run: (w) => {
      const now = running(w).length;
      w.fails('QUOTA_BELOW_RUNNING', () => w.as('resource', (c) => setSimulationQuota(c, 'team-brake', now - 1)));
      w.as('resource', (c) => setSimulationQuota(c, 'team-brake', now + 1));
      w.eq(w.s.simulationQuotas['team-brake'], now + 1, 'one more simulation fits');
      w.ref.quota = String(now + 1);
    },
  },
  Q02: {
    needs: ['Q01'],
    run: (w) => {
      personalSim(w);
      w.eq(running(w).length, Number(w.ref.quota), 'the personal simulation took the last place');
      w.fails('SIMULATION_QUOTA', () => teamSim(w));
      w.fails('SIMULATION_QUOTA', () => personalSim(w));
    },
  },
  Q03: {
    needs: ['Q02'],
    run: (w) => {
      w.as('workspace_manager', (c) => stopSimulation(c, 'SIM-021'));
      teamSim(w);
      w.check(running(w).includes('SIM-029'), 'stopping one made room for the new team simulation');
      w.as('resource', (c) => setSimulationQuota(c, 'team-brake', null));
      w.eq(w.s.simulationQuotas['team-brake'], undefined, 'the limit is lifted');
    },
  },
  N01: {
    needs: ['Q01'],
    run: (w) => {
      for (const u of ['workspace_manager', 'business', 'dcl', 'release', 'integration_admin']) w.denied(u, (c) => setSimulationQuota(c, 'team-brake', 9));
      w.fails('INVALID_QUOTA', () => w.as('resource', (c) => setSimulationQuota(c, 'team-brake', -1)));
    },
  },
};
