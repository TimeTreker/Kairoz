import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { carRuns, plmPublish, tspCar } from '../acceptance/helpers.ts';
import { World } from '../acceptance/world.ts';
import * as calls from '../src/engine/calls.ts';
import * as em from '../src/engine/emergency.ts';
import * as fleet from '../src/engine/fleet.ts';
import * as integ from '../src/engine/integration.ts';
import { migrate } from '../src/engine/migrate.ts';
import { notificationsFor } from '../src/engine/notifications.ts';
import { publishPlmVersion, syncPlmIfChanged } from '../src/engine/plm.ts';
import { syncPlm, workingNameState } from '../src/engine/plm-sync.ts';
import * as rel from '../src/engine/release.ts';
import { demoState } from '../src/engine/seed.ts';
import { advanceClockHours, sendReceipt, tick } from '../src/engine/simulator.ts';
import * as v from '../src/engine/validation.ts';
import * as vs from '../src/engine/vehicle-software.ts';

const fid = (w: World, name: string) => Object.values(w.s.features).find((f) => f.name === name)!.id;

/** The demo after the call for working name 1.2 was released as policy set 1.1.0. */
function released(): { w: World; callId: string; set: string } {
  const w = new World(demoState());
  const callId = w.as('integration_admin', (c) => calls.openCall(c, { workspaceId: 'x89-project', targetVersion: '1.2', dueDate: null }));
  w.as('steering', (c) => calls.submitGroup(c, callId, 'steering', { featureId: fid(w, 'steering_return_rate') }));
  w.as('business', (c) => calls.submitGroup(c, callId, 'brake', { featureId: fid(w, 'brake_monitor') }));
  w.as('adc_integrator', (c) => calls.submitDomain(c, callId, 'ADC', {}));
  w.as('cdc_integrator', (c) => calls.submitDomain(c, callId, 'CDC', {}));
  w.as('dcl', (c) => fleet.registerImage(c, { id: 'x89-1.2-sim', vehicleModelId: 'X89', integrationVersion: '1.2', build: 'x89-1.2.0-rc1', digest: 'sha256:mock-x89-1-2-rc1', simulator: 'SimOne 3' }));
  w.as('integration_admin', (c) => fleet.createSimulation(c, { id: 'SIM-112', workspaceId: 'x89-integration', imageId: 'x89-1.2-sim', env: 'testing', pool: 'Vehicle' }));
  // A testing car runs a pre-release build of the working name and says so.
  tspCar(w.engine, 'LSDEMX89000003200', 'X89');
  w.as('resource', (c) => fleet.registerPhysical(c, { id: 'VEH-032', vin: 'LSDEMX89000003200', vehicleModelId: 'X89', env: 'testing', pool: 'Vehicle' }));
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
  return { w, callId, set };
}

const deliver = (w: World, clientVersion = '2.3.0') => w.as('dcl', (c) => calls.deliverDclPart(c, { vehicleModelId: 'X89', version: '1.2', clientVersion }));
const kinds = (w: World, user: string, ws: string) => w.engine.read(user, (s, a) => notificationsFor(s, a, ws)).map((n) => n.kind);

describe('working names and the DCL part', () => {
  test('a released working name stays planned; DCL exports its part for PLM, and only DCL', () => {
    const { w, set } = released();
    const sv = () => w.s.softwareVersions['X89::1.2']!;
    assert.equal(workingNameState(sv()), 'TO_DELIVER');
    assert.ok(kinds(w, 'dcl', 'x89-project').includes('DCL_PART_TO_DELIVER'));
    w.denied('release', (c) => calls.deliverDclPart(c, { vehicleModelId: 'X89', version: '1.2', clientVersion: '2.3.0' }));
    w.fails('INVALID_CLIENT_VERSION', () => deliver(w, 'v2'));
    const part = deliver(w);
    assert.deepEqual([part.clientVersion, part.setVersion, part.digest, part.deliveredBy], ['2.3.0', '1.1.0', w.s.resolvedConfigs[w.s.releases[set]!.resolvedConfigId]!.digest, 'dcl']);
    assert.equal(workingNameState(sv()), 'DELIVERED');
    assert.ok(!kinds(w, 'dcl', 'x89-project').includes('DCL_PART_TO_DELIVER'));
    w.fails('PART_DELIVERED', () => deliver(w));
    // Another client version replaces the part until PLM publishes.
    deliver(w, '2.4.0');
    assert.equal(sv().dclPart!.clientVersion, '2.4.0');
    assert.equal(calls.reportedClientVersion(w.s, 'X89'), '2.3.0', 'the demo vehicles run DCL client 2.3.0');
  });

  test('PLM publishes the software with the part: the platform links the working name by the digest', () => {
    const { w, callId, set } = released();
    // A policy stopped before PLM published: the working name's newer set goes with it.
    const stop = w.as('dcl', (c) => em.requestEmergencyStop(c, { releaseId: set, policyId: 'chassis.steering.return_rate', reason: '回正率误报' }));
    const set111 = w.as('release', (c) => em.decideEmergencyStop(c, stop, { decision: 'APPROVED', note: '同意' }))!;
    deliver(w);
    w.sys((c) => advanceClockHours(c, 2));
    plmPublish(w.engine, 'X89', '1.2.0', { partOf: '1.2' });
    const v120 = w.s.softwareVersions['X89::1.2.0']!;
    assert.deepEqual([v120.status, v120.source, v120.workingName, v120.callId, v120.recordedBy], ['RECORDED', 'PLM', '1.2', callId, null]);
    assert.equal(v120.dclModule!.releaseId, set, 'the factory configuration is the delivered set');
    assert.equal(v120.dclPart!.deliveredBy, 'dcl');
    assert.deepEqual(v120.manifest, w.s.softwareVersions['X89::1.2']!.manifest);
    assert.equal(w.s.softwareVersions['X89::1.2']!.linkedTo, '1.2.0');
    assert.deepEqual(rel.applicableVersions(w.s, w.s.releases[set]!), ['1.2', '1.2.0']);
    assert.equal(rel.setInEffect(w.s, 'X89', '1.2.0')!.id, set111);
    assert.deepEqual(
      w.s.applicability.filter((a) => a.version === '1.2.0').map((a) => [a.releaseId, a.action, a.checkId, a.by]),
      [[set, 'ADD', null, null], [set111, 'ADD', null, null]],
    );
    assert.equal(Object.values(w.s.applicabilityChecks).filter((c) => c.version === '1.2.0').length, 0);
    // The working name is not chosen any more.
    w.fails('WORKING_NAME_LINKED', () => w.as('business', (c) => vs.requestVehicleSoftware(c, 'team-brake', 'VEH-001', { version: '1.2', reason: '预发布验证' })));
    w.fails('WORKING_NAME_LINKED', () => deliver(w, '2.5.0'));
  });

  test('a production vehicle flashed with the PLM version reports the factory configuration; the newer set follows over the air', () => {
    const { w, set } = released();
    deliver(w);
    plmPublish(w.engine, 'X89', '1.2.0', { partOf: '1.2' });
    carRuns(w.engine, 'VEH-202', '1.2.0');
    const r = w.s.resources['VEH-202']!;
    assert.equal(r.appliedConfigId, w.s.releases[set]!.resolvedConfigId);
    assert.equal(w.s.devices['VEH-202']!.clientVersion, '2.3.0', 'the package brought the part’s DCL client');
    assert.equal(rel.releaseFor(w.s, r).release!.id, set);
  });

  test('PLM keeping the working name as its number turns the same record into the published version', () => {
    const { w, set } = released();
    deliver(w);
    plmPublish(w.engine, 'X89', '1.2', { partOf: '1.2' });
    const sv = w.s.softwareVersions['X89::1.2']!;
    assert.deepEqual([sv.status, sv.source, sv.workingName, sv.linkedTo, sv.dclModule!.releaseId], ['RECORDED', 'PLM', '1.2', null, set]);
    assert.equal(sv.dclPart!.deliveredBy, 'dcl');
    carRuns(w.engine, 'VEH-201', '1.2');
    assert.equal(w.s.resources['VEH-201']!.appliedConfigId, w.s.releases[set]!.resolvedConfigId);
  });

  test('a later PLM version reusing the part runs the same factory configuration but needs an applicability check', () => {
    const { w, set } = released();
    deliver(w);
    plmPublish(w.engine, 'X89', '1.2.0', { partOf: '1.2' });
    const part = w.s.softwareVersions['X89::1.2.0']!.dclPart!;
    w.sys((c) => publishPlmVersion(c, { vehicleModelId: 'X89', version: '1.2.1', dclPart: { clientVersion: part.clientVersion, setVersion: part.setVersion, digest: part.digest } }));
    w.sys((c) => syncPlmIfChanged(c));
    const v121 = w.s.softwareVersions['X89::1.2.1']!;
    assert.deepEqual([v121.dclModule!.releaseId, v121.workingName, v121.dclPart!.deliveredBy], [set, null, 'dcl']);
    assert.equal(rel.setInEffect(w.s, 'X89', '1.2.1'), null);
    const checks = Object.values(w.s.applicabilityChecks).filter((c) => c.version === '1.2.1');
    assert.deepEqual(checks.map((c) => [c.releaseId, c.auto, c.openedBy]), [[set, true, null]]);
  });

  test('a part the platform does not know is flagged and recognised as no set', () => {
    const w = new World(demoState());
    w.sys((c) => publishPlmVersion(c, { vehicleModelId: 'X89', version: '1.3', dclPart: { clientVersion: '2.3.0', setVersion: '9.9.9', digest: 'sha256:0123456789abcdef' } }));
    w.sys((c) => tick(c));
    const v13 = w.s.softwareVersions['X89::1.3']!;
    assert.deepEqual([v13.status, v13.dclModule, v13.dclPart!.deliveredBy], ['RECORDED', null, null]);
    assert.ok(kinds(w, 'release', 'x89-project').includes('PLM_PART_UNKNOWN'));
    assert.ok(kinds(w, 'dcl', 'x89-project').includes('PLM_PART_UNKNOWN'));
    assert.equal(Object.values(w.s.applicabilityChecks).filter((c) => c.version === '1.3').length, 1);
  });

  test('PLM refuses a number twice; the sync applies each published version once', () => {
    const w = new World(demoState());
    w.fails('PLM_VERSION_EXISTS', () => w.sys((c) => publishPlmVersion(c, { vehicleModelId: 'X89', version: '1.1', dclPart: null })));
    w.fails('INVALID_BOM', () => w.sys((c) => publishPlmVersion(c, { vehicleModelId: 'X89', version: '1.4', modules: [{ name: 'ADC', version: '' }], dclPart: null })));
    w.sys((c) => publishPlmVersion(c, { vehicleModelId: 'X89', version: '1.4', dclPart: null }));
    assert.deepEqual(w.s.plm.versions.at(-1)!.modules, w.s.plm.versions.find((x) => x.version === '1.1')!.modules, 'the BOM starts from the previous version');
    const recorded = w.sys((c) => syncPlmIfChanged(c));
    assert.equal(recorded, 1);
    assert.equal(w.sys((c) => syncPlmIfChanged(c)), 0);
    assert.equal(w.sys((c) => syncPlm(c, JSON.parse(JSON.stringify(c.s.plm)))), 0);
  });

  test('a call targets a working name, never a version PLM published', () => {
    const w = new World(demoState());
    w.fails('TARGET_RECORDED', () => w.as('integration_admin', (c) => calls.openCall(c, { workspaceId: 'x89-project', targetVersion: '1.1', dueDate: null })));
  });

  test('a schema 22 save is read with PLM holding the versions it recorded', () => {
    const { w } = released();
    const saved = JSON.parse(JSON.stringify(w.s));
    saved.schema = 22;
    delete saved.plm;
    delete saved.plmSync;
    for (const x of Object.values(saved.softwareVersions) as Record<string, unknown>[]) for (const k of ['dclPart', 'workingName', 'linkedTo']) delete x[k];
    const s = migrate(saved)!;
    assert.deepEqual(s.plm.versions.map((x) => [x.version, x.modules, x.dclPart]), [['1.0', [], null], ['1.1', [], null]]);
    assert.equal(s.plmSync.revision, s.plm.revision);
    assert.deepEqual([s.softwareVersions['X89::1.2']!.workingName, s.softwareVersions['X89::1.2']!.linkedTo, s.softwareVersions['X89::1.2']!.dclPart], [null, null, null]);
  });
});
