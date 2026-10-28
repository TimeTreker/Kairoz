import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { carRuns, tspCar } from '../acceptance/helpers.ts';
import { World } from '../acceptance/world.ts';
import { clientReportView, registerDeviceKey } from '../src/engine/client-report.ts';
import * as fleet from '../src/engine/fleet.ts';
import { productionDistribution } from '../src/engine/history.ts';
import { migrate } from '../src/engine/migrate.ts';
import { notificationsFor } from '../src/engine/notifications.ts';
import * as rel from '../src/engine/release.ts';
import { demoState } from '../src/engine/seed.ts';
import { devicePublicKey, provisionDevice, reportNow, simulateSoftwareOta, tick } from '../src/engine/simulator.ts';
import { addTspVehicle, syncTspIfChanged, updateTspVehicle } from '../src/engine/tsp.ts';
import { tspMismatch } from '../src/engine/tsp-sync.ts';

const kinds = (w: World, user: string, ws: string) => w.engine.read(user, (s, a) => notificationsFor(s, a, ws));

describe('cars come from TSP', () => {
  test('vehicle resources register a car TSP knows; identity, plate and hardware come from TSP', () => {
    const w = new World(demoState());
    w.fails('TSP_REQUIRED', () => w.as('resource', (c) => fleet.registerPhysical(c, { id: 'VEH-009', vin: 'LSDEMX89000000900', env: 'development', pool: 'Chassis' })));
    w.fails('TSP_MODEL_MISMATCH', () => w.as('resource', (c) => fleet.registerPhysical(c, { id: 'VEH-007', vin: 'LSDEM0X8900000007', vehicleModelId: 'X90', env: 'development', pool: 'ADC' })));
    w.as('resource', (c) => fleet.registerPhysical(c, { id: 'VEH-007', vin: 'LSDEM0X8900000007', env: 'development', pool: 'ADC', displayName: '泊车研发车 2' }));
    const r = w.s.resources['VEH-007']!;
    assert.deepEqual([r.vehicleModelId, r.licensePlate, r.uvid, r.tsp?.tboxId, r.tsp?.hardware], ['X89', '沪A·D0007', 'UV-8900000007', 'TBOX-8900000007', [{ item: '激光雷达', value: '有' }, { item: '座舱芯片', value: '8295' }]]);
    assert.equal(r.integrationVersion, null, 'unknown until the car reports');
    w.fails('VIN_TAKEN', () => w.as('resource', (c) => fleet.registerPhysical(c, { id: 'VEH-008', vin: 'LSDEM0X8900000007', env: 'development', pool: 'ADC' })));
    w.fails('TSP_VIN_EXISTS', () => w.sys((c) => addTspVehicle(c, { vin: 'LSDEM0X8900000007', vehicleModelId: 'X89' })));
  });

  test('a new car leaves the factory on the version TSP holds, and says so once its key is registered', () => {
    const w = new World(demoState());
    tspCar(w.engine, 'LSDEMX89000000920', 'X89', { expectedVersion: '1.1' });
    w.as('resource', (c) => fleet.registerPhysical(c, { id: 'VEH-920', vin: 'LSDEMX89000000920', env: 'testing', pool: 'Vehicle' }));
    const key = w.sys((c) => (provisionDevice(c, 'VEH-920'), devicePublicKey(c.s, 'VEH-920')!));
    w.as('resource', (c) => registerDeviceKey(c, 'VEH-920', key));
    w.sys((c) => reportNow(c, 'VEH-920'));
    assert.deepEqual([w.s.resources['VEH-920']!.integrationVersion, w.s.resources['VEH-920']!.integrationSource], ['1.1', 'DCL client report (signed)']);
  });

  test('TSP’s expected version never becomes the actual one: the car’s report counts, a difference is flagged', () => {
    const w = new World(demoState());
    w.sys((c) => updateTspVehicle(c, 'LSDEM0X8900000201', { expectedVersion: '1.1' }));
    w.sys((c) => syncTspIfChanged(c));
    const r = () => w.s.resources['VEH-201']!;
    assert.deepEqual([r().tsp!.expectedVersion, r().integrationVersion, tspMismatch(w.s, r())], ['1.1', '1.0', true]);
    assert.ok(kinds(w, 'resource', 'x89-project').some((n) => n.kind === 'TSP_MISMATCH' && n.subject === 'VEH-201'));
    // 1.1 has no policy set: release is told before the car arrives there.
    const coming = kinds(w, 'release', 'x89-project').find((n) => n.kind === 'EXPECTED_WITHOUT_SET')!;
    assert.deepEqual([coming.subject, coming.detail], ['X89 1.1', '1|CHECK|']);
    assert.deepEqual(productionDistribution(w.s, 'X89').map((x) => [x.version, x.vehicles, x.expected]), [['1.0', 2, 1], ['1.1', 0, 1]]);
    // A wrong TSP record: the car still runs 1.0, and says so.
    w.sys((c) => reportNow(c, 'VEH-201'));
    assert.equal(r().integrationVersion, '1.0');
    // Once the car is updated, the two agree.
    carRuns(w.engine, 'VEH-201', '1.1');
    assert.deepEqual([r().integrationVersion, tspMismatch(w.s, r())], ['1.1', false]);
  });

  test('a partial update comes from the car: a failed controller keeps its software and no version is claimed', () => {
    const w = new World(demoState());
    carRuns(w.engine, 'VEH-202', '1.1', ['BMS']);
    const r = () => w.s.resources['VEH-202']!;
    assert.deepEqual([r().softwareStatus, r().integrationVersion, r().tsp!.expectedVersion], ['PARTIAL_FAILURE', null, '1.1']);
    assert.deepEqual(r().controllers, [
      { name: 'ADC', version: '3.3.0', status: 'PASS' },
      { name: 'CDC', version: '5.1.2', status: 'PASS' },
      { name: 'BMS', version: '2.0.4', status: 'FAIL' },
      { name: 'VCU', version: '1.9.0', status: 'PASS' },
    ]);
    assert.match(rel.releaseFor(w.s, r()).problem!, /partial software update/);
    // The car names 1.1 with BMS failed: its client state reads a partial update, as the registry does.
    const view = w.engine.read('resource', (s, a) => clientReportView(s, a, 'VEH-202', null))!;
    assert.deepEqual(view.comparison!.software, { reported: '1.1', partial: true, recorded: null, recordedStatus: 'PARTIAL_FAILURE', same: true });
    w.fails('UNKNOWN_CONTROLLER', () => carRuns(w.engine, 'VEH-202', '1.1', ['LIDAR']));
    carRuns(w.engine, 'VEH-202', '1.1');
    assert.deepEqual([r().softwareStatus, r().integrationVersion, r().controllers], ['CONSISTENT', '1.1', []]);
    // A car that cannot tell its version makes it unknown.
    carRuns(w.engine, 'VEH-202', null);
    assert.deepEqual([r().softwareStatus, r().integrationVersion], ['UNKNOWN', null]);
  });

  test('a simulated vehicle OTA tells TSP at once; the platform’s mirror follows without a tick', () => {
    const w = new World(demoState());
    w.sys((c) => simulateSoftwareOta(c, 'VEH-201', '1.1'));
    const r = w.s.resources['VEH-201']!;
    assert.deepEqual([r.tsp!.expectedVersion, r.integrationVersion, w.s.tspSync.revision], ['1.1', '1.0', w.s.tsp.revision]);
  });

  test('hardware changes in TSP reach the vehicle with the next sync', () => {
    const w = new World(demoState());
    w.sys((c) => updateTspVehicle(c, 'LSDEM0X8900000001', { hardware: [{ item: '激光雷达', value: '有' }] }));
    w.fails('INVALID_HARDWARE', () => w.sys((c) => updateTspVehicle(c, 'LSDEM0X8900000001', { hardware: [{ item: '激光雷达', value: '' }] })));
    assert.deepEqual(w.s.resources['VEH-001']!.tsp!.hardware, [{ item: '激光雷达', value: '无' }, { item: '座舱芯片', value: '8155' }]);
    w.sys((c) => tick(c));
    assert.deepEqual(w.s.resources['VEH-001']!.tsp!.hardware, [{ item: '激光雷达', value: '有' }]);
    assert.equal(w.s.tspSync.revision, w.s.tsp.revision);
  });

  test('a schema 22 save gets a TSP holding its physical cars, and devices that run what was recorded', () => {
    const w = new World(demoState());
    const saved = JSON.parse(JSON.stringify(w.s));
    saved.schema = 22;
    delete saved.tsp;
    delete saved.tspSync;
    delete saved.plm;
    delete saved.plmSync;
    for (const r of Object.values(saved.resources) as Record<string, unknown>[]) delete r.tsp;
    for (const d of Object.values(saved.devices) as Record<string, unknown>[]) {
      d.software = null;
      delete d.controllers;
    }
    for (const x of Object.values(saved.softwareVersions) as Record<string, unknown>[]) for (const k of ['dclPart', 'workingName', 'linkedTo']) delete x[k];
    const s = migrate(saved)!;
    assert.equal(s.tsp.vehicles.length, Object.values(s.resources).filter((r) => r.type === 'PHYSICAL').length);
    assert.deepEqual(s.resources['VEH-201']!.tsp, { tboxId: 'TBOX-8900000201', hardware: [], expectedVersion: '1.0', syncedAt: s.resources['VEH-201']!.updatedAt });
    assert.deepEqual([s.devices['VEH-201']!.software, s.devices['VEH-002']!.software, s.devices['SIM-021']!.software], ['1.0', null, null]);
    assert.equal(s.tspSync.revision, s.tsp.revision);
  });
});

describe('round 3: TSP against the car’s own report', () => {
  const notes = (w: World, user: string, kind: string) => w.engine.read(user, (s, a) => notificationsFor(s, a, 'x89-project')).filter((n) => n.kind === kind);

  test('a car that never reported is not flagged; once it reports another version than TSP holds, it is', () => {
    const w = new World(demoState());
    tspCar(w.engine, 'LSDEMX89000009900', 'X89', { expectedVersion: '1.1' });
    w.as('resource', (c) => fleet.registerPhysical(c, { id: 'VEH-099', vin: 'LSDEMX89000009900', env: 'development', pool: 'Chassis' }));
    const r = () => w.s.resources['VEH-099']!;
    assert.equal(tspMismatch(w.s, r()), false, 'unknown until it reports');
    assert.ok(!notes(w, 'resource', 'TSP_MISMATCH').some((n) => n.subject === 'VEH-099'));
    // The car is flashed with 1.0 (TSP follows), then TSP is told 1.1 again: the car still says 1.0.
    carRuns(w.engine, 'VEH-099', '1.0');
    assert.equal(tspMismatch(w.s, r()), false);
    w.sys((c) => updateTspVehicle(c, 'LSDEMX89000009900', { expectedVersion: '1.1' }));
    w.sys((c) => syncTspIfChanged(c));
    assert.equal(tspMismatch(w.s, r()), true);
    assert.deepEqual(notes(w, 'resource', 'TSP_MISMATCH').filter((n) => n.subject === 'VEH-099').map((n) => n.detail), ['1.1 · 1.0']);
  });

  test('a car on a version PLM has not published agrees with TSP; it waits for PLM instead', () => {
    const w = new World(demoState());
    carRuns(w.engine, 'VEH-031', '1.3');
    const r = w.s.resources['VEH-031']!;
    assert.deepEqual([r.integrationVersion, r.tsp!.expectedVersion, tspMismatch(w.s, r)], ['1.0', '1.3', false]);
    assert.ok(notes(w, 'resource', 'UNRECORDED_SOFTWARE').some((n) => n.subject === 'VEH-031'));
  });

  test('the arrival warning says what release can do about TSP’s number', () => {
    const w = new World(demoState());
    const why = () => notes(w, 'release', 'EXPECTED_WITHOUT_SET').map((n) => n.detail);
    w.sys((c) => updateTspVehicle(c, 'LSDEM0X8900000201', { expectedVersion: '1.5' }));
    w.sys((c) => syncTspIfChanged(c));
    assert.deepEqual(why(), ['1|UNKNOWN|'], 'PLM has no 1.5');
    w.sys((c) => updateTspVehicle(c, 'LSDEM0X8900000201', { expectedVersion: '1.1' }));
    w.sys((c) => syncTspIfChanged(c));
    assert.deepEqual(why(), ['1|CHECK|']);
  });
});
