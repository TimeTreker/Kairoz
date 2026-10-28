// Regression tests for the independent review of the PLM and TSP work (findings 1–7).
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { carRuns, plmPublish, tspCar } from '../acceptance/helpers.ts';
import { World } from '../acceptance/world.ts';
import { registerDeviceKey } from '../src/engine/client-report.ts';
import * as calls from '../src/engine/calls.ts';
import * as em from '../src/engine/emergency.ts';
import * as fleet from '../src/engine/fleet.ts';
import { versionHistory } from '../src/engine/history.ts';
import * as integ from '../src/engine/integration.ts';
import { migrate } from '../src/engine/migrate.ts';
import { notificationsFor } from '../src/engine/notifications.ts';
import { publishPlmVersion, syncPlmIfChanged } from '../src/engine/plm.ts';
import { workingNameState } from '../src/engine/plm-sync.ts';
import * as rel from '../src/engine/release.ts';
import { demoState } from '../src/engine/seed.ts';
import { advanceClockHours, devicePublicKey, provisionDevice, reportNow, sendReceipt } from '../src/engine/simulator.ts';
import { addTspVehicle } from '../src/engine/tsp.ts';
import * as v from '../src/engine/validation.ts';

const fid = (w: World, name: string) => Object.values(w.s.features).find((f) => f.name === name)!.id;
const kinds = (w: World, user: string) => w.engine.read(user, (s, a) => notificationsFor(s, a, 'x89-project'));
const deliver = (w: World, clientVersion = '2.3.0') => w.as('dcl', (c) => calls.deliverDclPart(c, { vehicleModelId: 'X89', version: '1.2', clientVersion }));

/** The demo after the call for working name 1.2 was released as policy set 1.1.0. */
function released(): { w: World; set: string } {
  const w = new World(demoState());
  const callId = w.as('integration_admin', (c) => calls.openCall(c, { workspaceId: 'x89-project', targetVersion: '1.2', dueDate: null }));
  w.as('steering', (c) => calls.submitGroup(c, callId, 'steering', { featureId: fid(w, 'steering_return_rate') }));
  w.as('business', (c) => calls.submitGroup(c, callId, 'brake', { featureId: fid(w, 'brake_monitor') }));
  w.as('adc_integrator', (c) => calls.submitDomain(c, callId, 'ADC', {}));
  w.as('cdc_integrator', (c) => calls.submitDomain(c, callId, 'CDC', {}));
  w.as('dcl', (c) => fleet.registerImage(c, { id: 'x89-1.2-sim', vehicleModelId: 'X89', integrationVersion: '1.2', build: 'x89-1.2.0-rc1', digest: 'sha256:mock-x89-1-2-rc1', simulator: 'SimOne 3' }));
  w.as('integration_admin', (c) => fleet.createSimulation(c, { id: 'SIM-112', workspaceId: 'x89-integration', imageId: 'x89-1.2-sim', env: 'testing', pool: 'Vehicle' }));
  tspCar(w.engine, 'LSDEMX89000003200', 'X89');
  w.as('resource', (c) => fleet.registerPhysical(c, { id: 'VEH-032', vin: 'LSDEMX89000003200', env: 'testing', pool: 'Vehicle' }));
  carRuns(w.engine, 'VEH-032', '1.2');
  w.as('integration_admin', (c) => fleet.addWorkspaceVehicle(c, 'x89-integration', 'VEH-032'));
  const plan = w.as('integrator', (c) => calls.previewCall(c, callId));
  w.as('dcl', (c) => integ.confirmProcessing(c, plan, { note: '' }));
  const cand = w.as('integrator', (c) => integ.freezeCandidate(c, plan, { label: '' }));
  const d = w.as('integration_tester', (c) => v.dispatchCandidate(c, cand, { resourceIds: ['SIM-112', 'VEH-032'] }));
  for (const r of ['SIM-112', 'VEH-032']) w.sys((c) => sendReceipt(c, d, r, 'APPLIED'));
  for (const r of ['SIM-112', 'VEH-032']) w.as('integration_tester', (c) => v.recordCandidateTest(c, cand, { resourceId: r, result: 'PASS', summary: '通过' }));
  w.as('integration_tester', (c) => v.verifyCandidate(c, cand));
  const set = w.as('release', (c) => rel.promoteCandidate(c, cand, { dclVersion: '1.1.0', vehicleIntegrationVersions: ['1.2'] }));
  return { w, set };
}

describe('review 4: PLM numbers and working names', () => {
  test('PLM publishing a linked working name’s number again is a conflict, not a rewrite', () => {
    const { w, set } = released();
    deliver(w);
    plmPublish(w.engine, 'X89', '1.2.0', { partOf: '1.2' });
    w.sys((c) => publishPlmVersion(c, { vehicleModelId: 'X89', version: '1.2', dclPart: null }));
    w.sys((c) => syncPlmIfChanged(c));
    const sv = w.s.softwareVersions['X89::1.2']!;
    assert.deepEqual([sv.status, sv.linkedTo, sv.dclModule?.releaseId], ['PLANNED', '1.2.0', set]);
    assert.deepEqual(w.s.plmSync.conflicts.map((c) => c.version), ['1.2']);
    assert.ok(kinds(w, 'release').some((n) => n.kind === 'PLM_NUMBER_CONFLICT' && n.subject === 'X89 1.2'));
    // A production car flashed with "1.2" still waits: the platform never took PLM's 1.2.
    carRuns(w.engine, 'VEH-201', '1.2');
    assert.equal(w.s.resources['VEH-201']!.integrationVersion, '1.0');
  });

  test('a part delivered for one working name, published under another one’s number, links nothing', () => {
    const { w } = released();
    deliver(w);
    w.as('integration_admin', (c) => calls.openCall(c, { workspaceId: 'x89-project', targetVersion: '1.3', dueDate: null }));
    plmPublish(w.engine, 'X89', '1.3', { partOf: '1.2' });
    assert.equal(w.s.softwareVersions['X89::1.3']!.status, 'PLANNED');
    assert.equal(workingNameState(w.s.softwareVersions['X89::1.2']!), 'DELIVERED');
    assert.deepEqual(w.s.plmSync.conflicts.map((c) => [c.version, c.reason]), [['1.3', 'the part was delivered for 1.2']]);
    // PLM corrects its number: the part links its own working name.
    plmPublish(w.engine, 'X89', '1.2.0', { partOf: '1.2' });
    assert.equal(w.s.softwareVersions['X89::1.2']!.linkedTo, '1.2.0');
  });

  test('a reused part is not shown as delivered for the later version', () => {
    const { w } = released();
    deliver(w);
    plmPublish(w.engine, 'X89', '1.2.0', { partOf: '1.2' });
    w.sys((c) => advanceClockHours(c, 24));
    const part = w.s.softwareVersions['X89::1.2.0']!.dclPart!;
    w.sys((c) => publishPlmVersion(c, { vehicleModelId: 'X89', version: '1.2.1', dclPart: { clientVersion: part.clientVersion, setVersion: part.setVersion, digest: part.digest } }));
    w.sys((c) => syncPlmIfChanged(c));
    assert.ok(!versionHistory(w.s, 'X89', '1.2.1').some((e) => e.kind === 'PART_DELIVERED'));
    assert.ok(versionHistory(w.s, 'X89', '1.2.0').some((e) => e.kind === 'PART_DELIVERED'));
  });

  test('an emergency stop after delivery asks DCL for a new part, which carries the stopped set', () => {
    const { w, set } = released();
    deliver(w);
    const toDeliver = () => kinds(w, 'dcl').filter((n) => n.kind === 'DCL_PART_TO_DELIVER');
    assert.equal(toDeliver().length, 0);
    const stop = w.as('dcl', (c) => em.requestEmergencyStop(c, { releaseId: set, policyId: 'chassis.steering.return_rate', reason: '回正率误报' }));
    w.as('release', (c) => em.decideEmergencyStop(c, stop, { decision: 'APPROVED', note: '同意' }));
    assert.deepEqual(toDeliver().map((n) => n.detail), ['1.1.1']);
    const part = deliver(w);
    assert.deepEqual([part.clientVersion, part.setVersion], ['2.3.0', '1.1.1']);
    assert.equal(toDeliver().length, 0);
  });
});

describe('review 4: vehicles', () => {
  test('a partial flash between two versions still records the change from the last whole version', () => {
    const w = new World(demoState());
    carRuns(w.engine, 'VEH-001', '1.1', ['ADC']);
    assert.equal(w.s.resources['VEH-001']!.softwareStatus, 'PARTIAL_FAILURE');
    carRuns(w.engine, 'VEH-001', '1.1');
    const changes = Object.values(w.s.softwareChanges).filter((c) => c.resourceId === 'VEH-001');
    assert.deepEqual(changes.map((c) => [c.fromVersion, c.toVersion, c.status]), [['1.0', '1.1', 'APPLIED']]);
  });

  test('TSP gives every car its own UVID and T-Box: the demo X90 car can be registered', () => {
    const w = new World(demoState());
    w.as('resource', (c) => fleet.registerPhysical(c, { id: 'VEH-990', vin: 'LSDEM0X9000000001', env: 'development', pool: 'Chassis' }));
    assert.deepEqual([w.s.resources['VEH-990']!.uvid, w.s.resources['VEH-001']!.uvid], ['UV-9000000001', 'UV-8900000001']);
    w.fails('TSP_ID_TAKEN', () => w.sys((c) => addTspVehicle(c, { vin: 'LSDEMX89000000099', vehicleModelId: 'X89', uvid: 'UV-8900000001' })));
  });

  test('a production car fresh from the factory reports its version’s factory configuration', () => {
    const { w, set } = released();
    deliver(w);
    plmPublish(w.engine, 'X89', '1.2.0', { partOf: '1.2' });
    tspCar(w.engine, 'LSDEMX89000000977', 'X89', { expectedVersion: '1.2.0' });
    w.as('resource', (c) => fleet.registerPhysical(c, { id: 'VEH-977', vin: 'LSDEMX89000000977', env: 'production', pool: 'Vehicle' }));
    const key = w.sys((c) => (provisionDevice(c, 'VEH-977'), devicePublicKey(c.s, 'VEH-977')!));
    w.as('resource', (c) => registerDeviceKey(c, 'VEH-977', key));
    w.sys((c) => reportNow(c, 'VEH-977'));
    const r = w.s.resources['VEH-977']!;
    assert.deepEqual([r.integrationVersion, r.appliedConfigId], ['1.2.0', w.s.releases[set]!.resolvedConfigId]);
  });

  test('the schema 23 migration keeps a partial car partial and turns an exported module into the version’s part', () => {
    const w = new World(demoState());
    carRuns(w.engine, 'VEH-202', '1.1', ['BMS']);
    const saved = JSON.parse(JSON.stringify(w.s));
    saved.schema = 22;
    for (const k of ['plm', 'plmSync', 'tsp', 'tspSync']) delete saved[k];
    for (const r of Object.values(saved.resources) as Record<string, unknown>[]) delete r.tsp;
    for (const d of Object.values(saved.devices) as Record<string, unknown>[]) {
      d.software = null;
      delete d.controllers;
    }
    for (const x of Object.values(saved.softwareVersions) as Record<string, unknown>[]) for (const k of ['dclPart', 'workingName', 'linkedTo']) delete x[k];
    const r100 = rel.releasesOf(w.s, 'X89').find((r) => r.dclVersion === '1.0.0')!;
    saved.softwareVersions['X89::1.0'].dclModule = { releaseId: r100.id, resolvedConfigId: r100.resolvedConfigId, digest: w.s.resolvedConfigs[r100.resolvedConfigId]!.digest, exportedBy: 'release', exportedAt: r100.publishedAt };
    const s = migrate(saved)!;
    assert.deepEqual(s.devices['VEH-202']!.controllers, w.s.resources['VEH-202']!.controllers);
    assert.deepEqual(s.plm.versions.find((x) => x.version === '1.0')!.dclPart, { clientVersion: '2.3.0', setVersion: '1.0.0', digest: w.s.resolvedConfigs[r100.resolvedConfigId]!.digest });
    assert.equal(s.softwareVersions['X89::1.0']!.dclPart!.deliveredBy, 'release');
    // The migrated partial car keeps reporting its controllers.
    const m = new World(s);
    m.sys((c) => reportNow(c, 'VEH-202'));
    assert.equal(m.s.resources['VEH-202']!.softwareStatus, 'PARTIAL_FAILURE');
  });
});
