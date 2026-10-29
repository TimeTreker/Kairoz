import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { carRuns, tspCar } from '../acceptance/helpers.ts';
import { World } from '../acceptance/world.ts';
import * as ap from '../src/engine/applicability.ts';
import * as calls from '../src/engine/calls.ts';
import * as em from '../src/engine/emergency.ts';
import * as fleet from '../src/engine/fleet.ts';
import { versionHistory } from '../src/engine/history.ts';
import * as integ from '../src/engine/integration.ts';
import { notificationsFor } from '../src/engine/notifications.ts';
import { answerConfigRequest } from '../src/engine/ota.ts';
import { publishPlmVersion, releasePlmVersion, syncPlmIfChanged } from '../src/engine/plm.ts';
import * as rel from '../src/engine/release.ts';
import { demoState } from '../src/engine/seed.ts';
import { noteReportedSoftware } from '../src/engine/software-change.ts';
import { sendReceipt, simulateSoftwareOta, tick } from '../src/engine/simulator.ts';
import type { PlmVersion } from '../src/engine/types.ts';
import * as v from '../src/engine/validation.ts';

const fid = (w: World, name: string) => Object.values(w.s.features).find((f) => f.name === name)!.id;
const kinds = (w: World, user: string, ws: string) => w.engine.read(user, (s, a) => notificationsFor(s, a, ws)).map((n) => n.kind);
const sv = (w: World, version: string) => w.s.softwareVersions[`X89::${version}`]!;
const testGroup = (w: World) => Object.values(w.s.vehicleGroups).find((g) => g.workspaceId === 'x89-integration' && g.purpose === 'TEST')!;

/** PLM issues a test build for an integration test round (整车测试版本), and the platform syncs. */
function issue(w: World, version: string, dclPart: PlmVersion['dclPart'] = null): void {
  w.sys((c) => publishPlmVersion(c, { vehicleModelId: 'X89', version, dclPart, stage: 'TEST' }));
  w.sys((c) => syncPlmIfChanged(c));
}

const link = (w: World, callId: string, version: string) => w.as('integration_admin', (c) => calls.linkTestVersion(c, callId, version));

/** The demo with the call for working name 1.2 complete, and PLM's first test build 1.2.0.1 linked as round 1 and run by the test vehicles. */
function round1(): { w: World; callId: string } {
  const w = new World(demoState());
  const callId = w.as('integration_admin', (c) => calls.openCall(c, { workspaceId: 'x89-project', targetVersion: '1.2', dueDate: null }));
  w.as('steering', (c) => calls.submitGroup(c, callId, 'steering', { featureId: fid(w, 'steering_return_rate') }));
  w.as('business', (c) => calls.submitGroup(c, callId, 'brake', { featureId: fid(w, 'brake_monitor') }));
  w.as('adc_integrator', (c) => calls.submitDomain(c, callId, 'ADC', {}));
  w.as('cdc_integrator', (c) => calls.submitDomain(c, callId, 'CDC', {}));
  issue(w, '1.2.0.1');
  link(w, callId, '1.2.0.1');
  w.as('dcl', (c) => fleet.registerImage(c, { id: 'x89-1.2-sim', vehicleModelId: 'X89', integrationVersion: '1.2.0.1', build: 'x89-1.2.0.1', digest: 'sha256:mock-x89-1-2-0-1', simulator: 'SimOne 3' }));
  w.as('integration_admin', (c) => fleet.createSimulation(c, { id: 'SIM-112', workspaceId: 'x89-integration', imageId: 'x89-1.2-sim', env: 'testing', pool: 'Vehicle' }));
  tspCar(w.engine, 'LSDEMX89000003200', 'X89');
  w.as('resource', (c) => fleet.registerPhysical(c, { id: 'VEH-032', vin: 'LSDEMX89000003200', vehicleModelId: 'X89', env: 'testing', pool: 'Vehicle' }));
  carRuns(w.engine, 'VEH-032', '1.2.0.1');
  w.as('integration_admin', (c) => fleet.addWorkspaceVehicle(c, 'x89-integration', 'VEH-032'));
  return { w, callId };
}

/** Round 1 of DCL passed on vehicles running 1.2.0.1, and release published policy set 1.1.0 for working name 1.2. */
function released(): { w: World; callId: string; set: string; cand: string } {
  const { w, callId } = round1();
  const plan = w.as('integrator', (c) => calls.previewCall(c, callId));
  w.as('dcl', (c) => integ.confirmProcessing(c, plan, { note: '' }));
  const cand = w.as('integrator', (c) => integ.freezeCandidate(c, plan, { label: '' }));
  const d = w.as('integration_tester', (c) => v.dispatchCandidate(c, cand, { resourceIds: ['SIM-112', 'VEH-032'] }));
  for (const r of ['SIM-112', 'VEH-032']) w.sys((c) => sendReceipt(c, d, r, 'APPLIED'));
  for (const r of ['SIM-112', 'VEH-032']) w.as('integration_tester', (c) => v.recordCandidateTest(c, cand, { resourceId: r, result: 'PASS', summary: '通过' }));
  w.as('integration_tester', (c) => v.verifyCandidate(c, cand));
  const set = w.as('release', (c) => rel.promoteCandidate(c, cand, { dclVersion: '1.1.0', vehicleIntegrationVersions: ['1.2'] }));
  return { w, callId, set, cand };
}

describe('PLM test versions (整车测试版本)', () => {
  test('a test build syncs as a test version: no applicability check, never on a production vehicle', () => {
    const w = new World(demoState());
    issue(w, '1.2.0.1');
    const t = sv(w, '1.2.0.1');
    assert.deepEqual([t.status, t.source, t.issuedForTest, t.releasedAt, t.testOf], ['TESTING', 'PLM', true, null, null]);
    assert.ok(!Object.values(w.s.applicabilityChecks).some((c) => c.version === '1.2.0.1'), 'a test version takes no applicability check');
    const set = rel.releasesOf(w.s, 'X89')[0]!.id;
    w.fails('VERSION_IN_TEST', () => w.as('release', (c) => ap.openApplicabilityCheck(c, { releaseId: set, version: '1.2.0.1' })));
    w.fails('TEST_VERSION_FOR_PRODUCTION', () => w.sys((c) => simulateSoftwareOta(c, 'VEH-201', '1.2.0.1')));
    // A production car that says it runs one anyway waits, like for a version PLM never released.
    const running = w.s.resources['VEH-201']!.integrationVersion;
    w.sys((c) => noteReportedSoftware(c, 'VEH-201', '1.2.0.1', null, []));
    assert.equal(w.s.resources['VEH-201']!.integrationVersion, running);
    assert.ok(Object.values(w.s.softwareChanges).some((c) => c.resourceId === 'VEH-201' && c.toVersion === '1.2.0.1' && c.status === 'UNRECORDED'));
    assert.ok(kinds(w, 'resource', 'x89-project').includes('UNRECORDED_SOFTWARE'));
    // A call cannot target PLM's test number.
    w.fails('TARGET_RECORDED', () => w.as('integration_admin', (c) => calls.openCall(c, { workspaceId: 'x89-project', targetVersion: '1.2.0.1', dueDate: null })));
  });

  test('the integration admin links test versions as the call’s rounds; nobody else, and only test versions', () => {
    const w = new World(demoState());
    const callId = w.as('integration_admin', (c) => calls.openCall(c, { workspaceId: 'x89-project', targetVersion: '1.2', dueDate: null }));
    issue(w, '1.2.0.1');
    assert.ok(kinds(w, 'integration_admin', 'x89-project').includes('TEST_VERSION_UNLINKED'));
    w.denied('release', (c) => calls.linkTestVersion(c, callId, '1.2.0.1'));
    w.denied('integration_tester', (c) => calls.linkTestVersion(c, callId, '1.2.0.1'));
    w.fails('NOT_A_TEST_VERSION', () => link(w, callId, '1.1'));
    link(w, callId, '1.2.0.1');
    const t = sv(w, '1.2.0.1');
    assert.deepEqual([t.testOf!.workingName, t.testOf!.callId, t.testOf!.round, t.testOf!.linkedBy], ['1.2', callId, 1, 'integration_admin']);
    assert.deepEqual(t.manifest, sv(w, '1.2').manifest, 'the build provides what the working name does');
    assert.equal(rel.setInEffect(w.s, 'X89', '1.2.0.1'), null, 'nothing to reference before the call is released');
    assert.ok(!kinds(w, 'integration_admin', 'x89-project').includes('TEST_VERSION_UNLINKED'));
    w.fails('TEST_VERSION_LINKED', () => link(w, callId, '1.2.0.1'));
    issue(w, '1.2.0.2');
    link(w, callId, '1.2.0.2');
    assert.deepEqual(calls.testVersionsOf(w.s, w.s.integrationCalls[callId]!).map((x) => [x.version, x.testOf.round]), [['1.2.0.1', 1], ['1.2.0.2', 2]]);
    // A cancelled call takes no more.
    issue(w, '1.2.0.3');
    w.as('integration_admin', (c) => calls.cancelCall(c, callId, '计划调整'));
    w.fails('CALL_CLOSED', () => link(w, callId, '1.2.0.3'));
  });

  test('tests on a test build count for the working name; the release references the linked builds', () => {
    const { w, set, cand } = released();
    assert.deepEqual(rel.testedVersions(w.s, w.s.candidates[cand]!), ['1.2', '1.2.0.1']);
    assert.deepEqual(calls.roundSoftware(w.s, cand), ['1.2.0.1']);
    const ref = w.s.applicability.find((a) => a.version === '1.2.0.1')!;
    assert.deepEqual([ref.releaseId, ref.action, ref.checkId, ref.by, ref.reason], [set, 'ADD', null, 'release', 'released with 1.2']);
    assert.equal(calls.referenceReason(ref.reason)!.kind, 'RELEASED');
    assert.equal(rel.setInEffect(w.s, 'X89', '1.2.0.1')?.id, set);
  });

  test('a release lists the working name, never a test build', () => {
    const { w, callId } = round1();
    const plan = w.as('integrator', (c) => calls.previewCall(c, callId));
    w.as('dcl', (c) => integ.confirmProcessing(c, plan, { note: '' }));
    const cand = w.as('integrator', (c) => integ.freezeCandidate(c, plan, { label: '' }));
    const d = w.as('integration_tester', (c) => v.dispatchCandidate(c, cand, { resourceIds: ['SIM-112', 'VEH-032'] }));
    for (const r of ['SIM-112', 'VEH-032']) w.sys((c) => sendReceipt(c, d, r, 'APPLIED'));
    for (const r of ['SIM-112', 'VEH-032']) w.as('integration_tester', (c) => v.recordCandidateTest(c, cand, { resourceId: r, result: 'PASS', summary: '通过' }));
    w.as('integration_tester', (c) => v.verifyCandidate(c, cand));
    w.fails('VERSION_IN_TEST', () => w.as('release', (c) => rel.promoteCandidate(c, cand, { dclVersion: '1.1.0', vehicleIntegrationVersions: ['1.2', '1.2.0.1'] })));
  });

  test('after the release, linking the next round confirms the reference, and says when the set changed', () => {
    const { w, callId, set } = released();
    issue(w, '1.2.0.2');
    link(w, callId, '1.2.0.2');
    const ref = w.s.applicability.find((a) => a.version === '1.2.0.2')!;
    assert.deepEqual([ref.releaseId, ref.by, ref.reason], [set, 'integration_admin', 'reference 1.2']);
    assert.equal(calls.referenceReason(ref.reason)!.kind, 'CONFIRMED');
    // An emergency stop replaces 1.1.0 wherever it was in effect, the test builds included.
    const stop = w.as('dcl', (c) => em.requestEmergencyStop(c, { releaseId: set, policyId: 'chassis.steering.return_rate', reason: '回正率误报' }));
    const set111 = w.as('release', (c) => em.decideEmergencyStop(c, stop, { decision: 'APPROVED', note: '同意' }))!;
    for (const x of ['1.2', '1.2.0.1', '1.2.0.2']) assert.equal(rel.setInEffect(w.s, 'X89', x)?.id, set111, x);
    issue(w, '1.2.0.3');
    assert.equal(calls.nextTestReference(w.s, w.s.integrationCalls[callId]!).changedFrom, null, 'round 2 already runs the stop');
    link(w, callId, '1.2.0.3');
    assert.equal(rel.setInEffect(w.s, 'X89', '1.2.0.3')?.id, set111);
    const reasons = w.s.applicability.filter((a) => a.version === '1.2.0.3').map((a) => a.reason);
    assert.deepEqual(reasons, ['reference 1.2', 'reference 1.2'], 'both sets that apply to the working name, unchanged since round 2');
  });

  test('a set that changed since the previous round is named in the reference', () => {
    const { w, callId, set } = released();
    const stop = w.as('dcl', (c) => em.requestEmergencyStop(c, { releaseId: set, policyId: 'chassis.steering.return_rate', reason: '回正率误报' }));
    const set111 = w.as('release', (c) => em.decideEmergencyStop(c, stop, { decision: 'APPROVED', note: '同意' }))!;
    // Round 1's build went back to 1.1.0 (the stop withdrawn there), so round 2 runs another set than round 1.
    w.as('release', (c) => ap.withdrawApplicability(c, { releaseId: set111, version: '1.2.0.1', reason: '第 1 轮保持 1.1.0' }));
    issue(w, '1.2.0.2');
    const next = calls.nextTestReference(w.s, w.s.integrationCalls[callId]!);
    assert.deepEqual([next.set?.id, next.changedFrom?.id, next.previousRound], [set111, set, 1]);
    link(w, callId, '1.2.0.2');
    assert.equal(w.s.applicability.filter((a) => a.version === '1.2.0.2').at(-1)!.reason, 'reference 1.2 changed 1.1.0 1.1.1');
    assert.equal(rel.setInEffect(w.s, 'X89', '1.2.0.2')?.id, set111);
    assert.deepEqual(calls.referenceReason('reference 1.2 changed 1.1.0 1.1.1'), { kind: 'CHANGED', workingName: '1.2', from: '1.1.0', to: '1.1.1' });
    assert.equal(calls.referenceReason('working name 1.2')!.kind, 'LINKED');
    assert.equal(calls.referenceReason('回正率误报'), null);
  });

  test('PLM releases the passing round under its number: the working name links to it and keeps its references', () => {
    const { w, callId, set } = released();
    const part = w.as('dcl', (c) => calls.deliverDclPart(c, { vehicleModelId: 'X89', version: '1.2', clientVersion: '2.3.0' }));
    issue(w, '1.2.0.2', { clientVersion: part.clientVersion, setVersion: part.setVersion, digest: part.digest });
    link(w, callId, '1.2.0.2');
    const checks = Object.keys(w.s.applicabilityChecks).length;
    w.sys((c) => releasePlmVersion(c, { vehicleModelId: 'X89', version: '1.2.0.2' }));
    w.fails('PLM_VERSION_RELEASED', () => w.sys((c) => releasePlmVersion(c, { vehicleModelId: 'X89', version: '1.2.0.2' })));
    w.sys((c) => syncPlmIfChanged(c));
    const t = sv(w, '1.2.0.2');
    assert.deepEqual([t.status, t.workingName, t.callId, t.testOf!.round, !!t.releasedAt, t.dclModule?.releaseId], ['RECORDED', '1.2', callId, 2, true, set]);
    assert.equal(sv(w, '1.2').linkedTo, '1.2.0.2');
    assert.equal(sv(w, '1.2.0.1').status, 'TESTING', 'round 1 stays a test build');
    assert.equal(Object.keys(w.s.applicabilityChecks).length, checks, 'the reference already covers it');
    assert.equal(w.s.applicability.filter((a) => a.version === '1.2.0.2' && a.releaseId === set).length, 1, 'no second record for the same set');
    w.fails('WORKING_NAME_LINKED', () => link(w, callId, '1.2.0.1'));
    // A production car flashed with the release runs the bundled set from the start.
    carRuns(w.engine, 'VEH-201', '1.2.0.2');
    assert.equal(w.s.resolvedConfigs[w.s.resources['VEH-201']!.appliedConfigId!]?.sourceId, set);
    const story = versionHistory(w.s, 'X89', '1.2.0.2').map((e) => e.kind);
    for (const k of ['CALL_OPENED', 'TEST_VERSION_LINKED', 'ROUND_PASSED', 'PUBLISHED', 'PART_DELIVERED', 'PLM_TEST_ISSUED', 'APPLICABILITY_ADDED', 'PLM_RELEASED', 'LINKED', 'VEHICLE_ARRIVED'] as const) assert.ok(story.includes(k), k);
    assert.ok(story.indexOf('PLM_RELEASED') < story.indexOf('LINKED'));
    const passed = versionHistory(w.s, 'X89', '1.2.0.2').find((e) => e.kind === 'ROUND_PASSED')!;
    assert.deepEqual(passed.software, ['1.2.0.1']);
  });

  test('a test group with nothing under test takes the set mapped to each vehicle’s software; a test dispatch replaces the push', () => {
    const { w, callId, set } = released();
    const g = testGroup(w);
    const car = fleet.membersOf(w.s, g.id).find((id) => w.s.resources[id]!.type === 'PHYSICAL')!;
    issue(w, '1.2.0.2');
    link(w, callId, '1.2.0.2');
    carRuns(w.engine, car, '1.2.0.2');
    const answer = answerConfigRequest(w.s, car);
    assert.deepEqual([answer.reason, answer.configId], ['LATEST_RELEASE', w.s.releases[set]!.resolvedConfigId]);
    const pushed = Object.values(w.s.deployments).filter((d) => d.kind === 'BASELINE' && d.status === 'PENDING' && d.targets.some((t) => t.resourceId === car));
    assert.equal(pushed.length, 1, 'the earlier mapping’s push gave way to this one');
    assert.deepEqual([pushed[0]!.subjectId, pushed[0]!.dispatchedBy, !!pushed[0]!.targets[0]!.pushedAt, pushed[0]!.workspaceId], [set, 'integration_admin', true, 'x89-integration']);
    assert.equal(fleet.pendingDeploymentOf(w.s, car), undefined, 'the push holds nothing up');
    w.sys((c) => sendReceipt(c, pushed[0]!.id, car, 'APPLIED'));
    assert.equal(w.s.resources[car]!.appliedConfigId, w.s.releases[set]!.resolvedConfigId);
    // Another report changes nothing: the vehicle runs the mapped set.
    carRuns(w.engine, car, '1.2.0.2');
    assert.equal(Object.values(w.s.deployments).filter((d) => d.kind === 'BASELINE' && d.status === 'PENDING' && d.targets.some((t) => t.resourceId === car)).length, 0);
    // An applicability test dispatched to the group stands while the check is open.
    issue(w, '1.2.0.3');
    w.sys((c) => releasePlmVersion(c, { vehicleModelId: 'X89', version: '1.2.0.3' }));
    w.sys((c) => syncPlmIfChanged(c));
    const check = Object.values(w.s.applicabilityChecks).find((c) => c.version === '1.2.0.3')!;
    carRuns(w.engine, car, '1.2.0.3');
    // The car moves to a test group of its own for the check.
    w.as('integration_admin', (c) => fleet.removeGroupMember(c, g.id, car, '单独做适用性测试'));
    const own = w.as('integration_admin', (c) => fleet.createVehicleGroup(c, { workspaceId: 'x89-integration', groupId: null, name: '1.2.0.3 适用性', purpose: 'TEST', env: 'testing' }));
    w.as('integration_admin', (c) => fleet.addGroupMember(c, own, car, '单独做适用性测试'));
    const d = w.as('integration_tester', (c) => ap.dispatchApplicability(c, check.id, { vehicleGroupIds: [own] }));
    assert.equal(answerConfigRequest(w.s, car).reason, 'GROUP_TARGET');
    assert.ok(Object.values(w.s.deployments).every((x) => x.kind !== 'BASELINE' || x.status !== 'PENDING' || !x.targets.some((t) => t.resourceId === car && t.status === 'PENDING')), 'the test replaced any push');
    assert.equal(fleet.pendingDeploymentOf(w.s, car), d);
  });

  test('idle simulator steps write nothing once the test builds are linked', () => {
    const { w, callId } = released();
    issue(w, '1.2.0.2');
    link(w, callId, '1.2.0.2');
    issue(w, '1.2.0.3');
    w.sys((c) => tick(c));
    w.sys((c) => tick(c));
    const before = w.s;
    w.sys((c) => tick(c));
    assert.equal(w.s, before);
  });
});
