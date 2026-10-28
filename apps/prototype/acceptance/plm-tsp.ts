// 外部系统：PLM 与 TSP (EX01–EX04, N01) on the demo installation: whole-vehicle versions come from
// PLM, cars from TSP. TSP says which version a car should run; only the car's own signed report says
// which it runs.

import * as fleet from '../src/engine/fleet.ts';
import { notificationsFor } from '../src/engine/notifications.ts';
import { publishPlmVersion, syncPlmIfChanged } from '../src/engine/plm.ts';
import { demoState } from '../src/engine/seed.ts';
import { registerDeviceKey } from '../src/engine/client-report.ts';
import { devicePublicKey, provisionDevice, reportNow } from '../src/engine/simulator.ts';
import { syncTspIfChanged, updateTspVehicle } from '../src/engine/tsp.ts';
import { tspMismatch } from '../src/engine/tsp-sync.ts';
import type { State } from '../src/engine/types.ts';
import { carRuns } from './helpers.ts';
import type { SceneSpec, World } from './world.ts';

export const start = (): State => demoState();

const notes = (w: World, user: string) => w.engine.read(user, (s, a) => notificationsFor(s, a, 'x89-project'));

export const scenes: Record<string, SceneSpec> = {
  EX01: {
    run: (w) => {
      w.sys((c) => publishPlmVersion(c, { vehicleModelId: 'X89', version: '1.2', dclPart: null }));
      w.sys((c) => syncPlmIfChanged(c));
      const v = w.s.softwareVersions['X89::1.2']!;
      w.eq([v.status, v.source, v.dclPart], ['RECORDED', 'PLM', null], 'PLM published 1.2 with no DCL part');
      w.eq(w.s.plm.versions.at(-1)!.modules.map((m) => m.name), ['ADC', 'CDC', 'BMS', 'VCU'], 'its BOM starts from 1.1');
      const checks = Object.values(w.s.applicabilityChecks).filter((c) => c.version === '1.2');
      w.eq(checks.map((c) => [c.auto, c.openedBy]), [[true, null]], 'an applicability check opens as a to-do');
      w.denied('business', (c) => fleet.setSoftwareManifest(c, { vehicleModelId: 'X89', version: '1.2', manifest: { signals: [], sources: [] } }));
    },
  },
  EX02: {
    run: (w) => {
      w.sys((c) => publishPlmVersion(c, { vehicleModelId: 'X89', version: '1.3', dclPart: { clientVersion: '2.3.0', setVersion: '9.9.9', digest: 'sha256:0123456789abcdef' } }));
      w.sys((c) => syncPlmIfChanged(c));
      w.eq(w.s.softwareVersions['X89::1.3']!.dclModule, null, 'the part carries no set the platform knows');
      w.check(notes(w, 'release').some((n) => n.kind === 'PLM_PART_UNKNOWN' && n.subject === 'X89 1.3'), 'configuration release is told');
      w.check(notes(w, 'dcl').some((n) => n.kind === 'PLM_PART_UNKNOWN'), 'and DCL');
    },
  },
  EX03: {
    run: (w) => {
      w.fails('TSP_REQUIRED', () => w.as('resource', (c) => fleet.registerPhysical(c, { id: 'VEH-009', vin: 'LSDEMX89000000900', env: 'development', pool: 'Chassis' })));
      w.as('resource', (c) => fleet.registerPhysical(c, { id: 'VEH-007', vin: 'LSDEM0X8900000007', env: 'development', pool: 'ADC', displayName: '泊车研发车 2' }));
      const r = w.s.resources['VEH-007']!;
      w.eq([r.vehicleModelId, r.licensePlate, r.tsp?.tboxId], ['X89', '沪A·D0007', 'TBOX-8900000007'], 'model, plate and T-Box come from TSP');
      w.eq(r.tsp?.hardware, [{ item: '激光雷达', value: '有' }, { item: '座舱芯片', value: '8295' }], 'with its hardware configuration');
      w.eq(r.integrationVersion, null, 'its software is unknown until it reports');
      const key = w.sys((c) => (provisionDevice(c, 'VEH-007'), devicePublicKey(c.s, 'VEH-007')!));
      w.as('resource', (c) => registerDeviceKey(c, 'VEH-007', key));
      carRuns(w.engine, 'VEH-007', '1.1');
      w.eq(w.s.resources['VEH-007']!.integrationVersion, '1.1', 'the car reports 1.1 after a flash');
    },
  },
  EX04: {
    run: (w) => {
      // The vehicle OTA program assigned VEH-201 1.1; the car has not updated yet.
      w.sys((c) => updateTspVehicle(c, 'LSDEM0X8900000201', { expectedVersion: '1.1' }));
      w.sys((c) => syncTspIfChanged(c));
      w.sys((c) => reportNow(c, 'VEH-201'));
      const r = () => w.s.resources['VEH-201']!;
      w.eq([r().tsp?.expectedVersion, r().integrationVersion, tspMismatch(r())], ['1.1', '1.0', true], 'TSP says 1.1, the car says 1.0: the car counts');
      w.check(notes(w, 'resource').some((n) => n.kind === 'TSP_MISMATCH' && n.subject === 'VEH-201'), 'vehicle resources see the difference');
      w.check(notes(w, 'release').some((n) => n.kind === 'EXPECTED_WITHOUT_SET' && n.subject === 'X89 1.1'), 'release is told 1.1 has no set before the car gets there');
      // The update fails on one controller: still no whole-vehicle version.
      carRuns(w.engine, 'VEH-201', '1.1', ['BMS']);
      w.eq([r().softwareStatus, r().integrationVersion], ['PARTIAL_FAILURE', null], 'a partial update, reported by the car');
      carRuns(w.engine, 'VEH-201', '1.1');
      w.eq([r().softwareStatus, r().integrationVersion, tspMismatch(r())], ['CONSISTENT', '1.1', false], 'updated: TSP and the car agree');
    },
  },
  N01: {
    run: (w) => {
      w.fails('TSP_MODEL_MISMATCH', () => w.as('resource', (c) => fleet.registerPhysical(c, { id: 'VEH-919', vin: 'LSDEM0X9000000001', vehicleModelId: 'X89', env: 'development', pool: 'Chassis' })));
      w.fails('VIN_TAKEN', () => w.as('resource', (c) => fleet.registerPhysical(c, { id: 'VEH-919', vin: 'LSDEM0X8900000001', env: 'development', pool: 'Chassis' })));
      w.denied('business', (c) => fleet.registerPhysical(c, { id: 'VEH-919', vin: 'LSDEM0X9000000001', env: 'development', pool: 'Chassis' }));
      w.fails('PLM_VERSION_EXISTS', () => w.sys((c) => publishPlmVersion(c, { vehicleModelId: 'X89', version: '1.1', dclPart: null })));
    },
  },
};
