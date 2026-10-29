// 集成征集与发布记录 (IC01–IC12, N01) on the demo installation: the integration admin opens a call
// for working name X89 1.2; leaf groups and upper domains submit their DCL policy versions (ADC
// through a domain call); integration checks the list is complete and sends it to testing round by
// round, on PLM's test build of each whole-vehicle round (1.2.0.1, 1.2.0.2) linked to the call; a
// failed round sends steering back; the passing round is released as 1.1.0 for 1.2 and the linked
// builds, DCL delivers the part, round 2's build references 1.1.0 as it is linked, PLM releases
// round 2 under its own number, and the release history tells the whole story.

import { canOpenPage } from '../src/domain/authz.ts';
import * as ap from '../src/engine/applicability.ts';
import * as calls from '../src/engine/calls.ts';
import * as config from '../src/engine/config.ts';
import * as fleet from '../src/engine/fleet.ts';
import { versionHistory, setsOverTime } from '../src/engine/history.ts';
import * as integ from '../src/engine/integration.ts';
import { notificationsFor } from '../src/engine/notifications.ts';
import { answerConfigRequest } from '../src/engine/ota.ts';
import { publishPlmVersion, releasePlmVersion, syncPlmIfChanged } from '../src/engine/plm.ts';
import { workingNameState } from '../src/engine/plm-sync.ts';
import * as rel from '../src/engine/release.ts';
import { demoState } from '../src/engine/seed.ts';
import { advanceClockHours, sendReceipt, simulateSoftwareOta } from '../src/engine/simulator.ts';
import { partVersion } from '../src/engine/types.ts';
import type { PlmVersion, State } from '../src/engine/types.ts';
import * as v from '../src/engine/validation.ts';
import { requestVehicleSoftware } from '../src/engine/vehicle-software.ts';
import { carRuns, tspCar, verifyFeatureOn } from './helpers.ts';
import type { SceneSpec, World } from './world.ts';

export const start = (): State => demoState();

const RETURN_RATE = 'chassis.steering.return_rate';
const feature = (w: World, name: string) => Object.values(w.s.features).find((f) => f.name === name)!.id;
const group = (w: World, name: string) => Object.values(w.s.vehicleGroups).find((g) => g.name === name)!.id;
const call = (w: World) => w.s.integrationCalls[w.ref.call!]!;
const mod = (w: World, key: string) => call(w).modules.find((m) => m.key === key)!;
const TEST_VEHICLES = ['SIM-112', 'VEH-032'];

/** PLM issues the test build of a whole-vehicle integration test round (整车测试版本), and the platform syncs. */
function issueTestBuild(w: World, version: string, dclPart: PlmVersion['dclPart'] = null): void {
  w.sys((c) => publishPlmVersion(c, { vehicleModelId: 'X89', version, dclPart, stage: 'TEST' }));
  w.sys((c) => syncPlmIfChanged(c));
}

const notices = (w: World, user: string, ws: string) => w.engine.read(user, (s, a) => notificationsFor(s, a, ws)).map((n) => n.kind);

/** Previews the call's submissions, has DCL confirm and freezes the round's test integration version. */
function sendToTest(w: World): string {
  const plan = w.as('integrator', (c) => calls.previewCall(c, w.ref.call!));
  w.as('dcl', (c) => integ.confirmProcessing(c, plan, { note: '' }));
  return w.as('integrator', (c) => integ.freezeCandidate(c, plan, { label: '' }));
}

/** Integration testing runs the round on the 1.2 test vehicles: the simulation passes, the vehicle as given. */
function testRound(w: World, candidateId: string, physical: 'PASS' | 'FAIL'): void {
  const d = w.as('integration_tester', (c) => v.dispatchCandidate(c, candidateId, { resourceIds: TEST_VEHICLES }));
  for (const r of TEST_VEHICLES) w.sys((c) => sendReceipt(c, d, r, 'APPLIED'));
  w.as('integration_tester', (c) => v.recordCandidateTest(c, candidateId, { resourceId: 'SIM-112', result: 'PASS', summary: '1.2 仿真回归通过' }));
  w.as('integration_tester', (c) => v.recordCandidateTest(c, candidateId, { resourceId: 'VEH-032', result: physical, summary: physical === 'PASS' ? '1.2 实车回归通过' : '回正误触发偏多' }));
}

export const scenes: Record<string, SceneSpec> = {
  IC01: {
    run: (w) => {
      w.denied('integration_tester', (c) => calls.openCall(c, { workspaceId: 'x89-project', targetVersion: '1.2' }));
      w.denied('release', (c) => calls.openCall(c, { workspaceId: 'x89-project', targetVersion: '1.2' }));
      w.fails('VERSION_RELEASED', () => w.as('integration_admin', (c) => calls.openCall(c, { workspaceId: 'x89-project', targetVersion: '1.0' })));
      w.ref.call = w.as('integration_admin', (c) => calls.openCall(c, { workspaceId: 'x89-project', targetVersion: '1.2', baseVersion: '1.1' }));
      w.eq(call(w).modules.map((m) => [m.key, m.kind, m.status]), [
        ['brake', 'GROUP', 'WAITING'],
        ['steering', 'GROUP', 'WAITING'],
        ['domain:ADC', 'DOMAIN', 'WAITING'],
        ['domain:CDC', 'DOMAIN', 'WAITING'],
      ], 'leaf groups and upper domains, all waiting');
      w.eq([w.s.softwareVersions['X89::1.2']!.status, w.s.softwareVersions['X89::1.2']!.callId], ['PLANNED', w.ref.call], 'the target is planned');
      const r100 = rel.releasesOf(w.s, 'X89')[0]!.id;
      w.fails('VERSION_PLANNED', () => w.as('release', (c) => ap.openApplicabilityCheck(c, { releaseId: r100, version: '1.2' })));
      w.check(canOpenPage(w.actor('integration_admin').grants, 'versions', 'x89-project'), 'the integration admin opens Integration versions');
    },
  },
  IC02: {
    needs: ['IC01'],
    run: (w) => {
      const steering = feature(w, 'steering_return_rate');
      w.denied('business', (c) => calls.submitGroup(c, w.ref.call!, 'steering', { featureId: steering }));
      w.denied('workspace_manager', (c) => calls.submitGroup(c, w.ref.call!, 'brake', {}));
      w.as('steering', (c) => calls.submitGroup(c, w.ref.call!, 'steering', { featureId: steering }));
      w.as('business', (c) => calls.submitGroup(c, w.ref.call!, 'brake', { featureId: feature(w, 'brake_monitor') }));
      w.eq([mod(w, 'steering').status, mod(w, 'brake').status], ['SUBMITTED', 'SUBMITTED'], 'both leaf groups submitted');
      w.fails('CALL_INCOMPLETE', () => w.as('integrator', (c) => calls.previewCall(c, w.ref.call!)));
      w.eq(w.as('integration_admin', (c) => calls.remindModules(c, w.ref.call!)), 2, 'ADC and CDC are reminded');
    },
  },
  IC03: {
    needs: ['IC02'],
    run: (w) => {
      w.denied('cdc_integrator', (c) => calls.submitDomain(c, w.ref.call!, 'ADC', {}));
      const child = w.as('adc_integrator', (c) => calls.openCall(c, { workspaceId: 'x89-adc-integration', scope: 'ADC', parentCallId: w.ref.call! }));
      w.eq(w.s.integrationCalls[child]!.modules.map((m) => m.key), ['adc-parking', 'adc-system'], 'the domain call collects the ADC groups');
      w.as('adc_parking', (c) => calls.submitGroup(c, child, 'adc-parking', {}));
      w.as('adc_system', (c) => calls.submitGroup(c, child, 'adc-system', {}));
      w.as('adc_integrator', (c) => calls.closeUnchanged(c, child, 'ADC 两组本期无变更'));
      w.eq([mod(w, 'domain:ADC').status, mod(w, 'domain:ADC').by], ['NO_CHANGE', 'adc_integrator'], 'the domain call answered upward');
      w.as('cdc_integrator', (c) => calls.submitDomain(c, w.ref.call!, 'CDC', {}));
      w.eq(calls.callPhase(w.s, call(w)), 'COMPLETE', 'every module answered');
    },
  },
  IC04: {
    needs: ['IC03'],
    run: (w) => {
      // PLM issues the first whole-vehicle test build; the integration admin links it as round 1.
      issueTestBuild(w, '1.2.0.1');
      w.eq(w.s.softwareVersions['X89::1.2.0.1']!.status, 'TESTING', 'a test version, not released');
      w.check(notices(w, 'integration_admin', 'x89-project').includes('TEST_VERSION_UNLINKED'), 'the admin is told PLM issued a build');
      w.denied('release', (c) => calls.linkTestVersion(c, w.ref.call!, '1.2.0.1'));
      w.as('integration_admin', (c) => calls.linkTestVersion(c, w.ref.call!, '1.2.0.1'));
      w.eq(w.s.softwareVersions['X89::1.2.0.1']!.testOf?.round, 1, 'round 1 of working name 1.2');
      // The testing vehicles run round 1's build.
      w.as('dcl', (c) => fleet.registerImage(c, { id: 'x89-1.2-sim', vehicleModelId: 'X89', integrationVersion: '1.2.0.1', build: 'x89-1.2.0.1', digest: 'sha256:mock-x89-1-2-0-1', simulator: 'SimOne 3' }));
      w.as('integration_admin', (c) => fleet.createSimulation(c, { id: 'SIM-112', workspaceId: 'x89-integration', imageId: 'x89-1.2-sim', env: 'testing', pool: 'Vehicle' }));
      tspCar(w.engine, 'LSDEMX89000003200', 'X89');
      w.as('resource', (c) => fleet.registerPhysical(c, { id: 'VEH-032', vin: 'LSDEMX89000003200', vehicleModelId: 'X89', env: 'testing', pool: 'Vehicle' }));
      carRuns(w.engine, 'VEH-032', '1.2.0.1');
      w.as('integration_admin', (c) => fleet.addWorkspaceVehicle(c, 'x89-integration', 'VEH-032'));
      w.eq(w.s.resources['VEH-032']!.integrationVersion, '1.2.0.1', 'VEH-032 runs the test build');
      // DCL's own first round goes to testing on them.
      w.denied('integration_admin', (c) => calls.previewCall(c, w.ref.call!));
      w.ref.t1 = sendToTest(w);
      const t1 = w.s.candidates[w.ref.t1]!;
      w.eq([t1.label, t1.callId, calls.callPhase(w.s, call(w))], ['X89 1.2-T1', w.ref.call, 'TESTING'], 'the first test integration version');
    },
  },
  IC05: {
    needs: ['IC04'],
    run: (w) => {
      testRound(w, w.ref.t1!, 'FAIL');
      w.fails('VERIFY_BLOCKED', () => w.as('integration_tester', (c) => v.verifyCandidate(c, w.ref.t1!)));
      w.denied('integration_tester', (c) => calls.returnModules(c, w.ref.call!, ['steering'], 'x'));
      w.as('integration_admin', (c) => calls.returnModules(c, w.ref.call!, ['steering'], '回正误触发偏多，请收紧阈值'));
      w.eq([w.s.candidates[w.ref.t1!]!.status, call(w).rounds[0]!.outcome, mod(w, 'steering').status], ['CANCELLED', 'CANCELLED', 'RETURNED'], 'T1 cancelled, steering sent back');
      w.eq(mod(w, 'brake').status, 'SUBMITTED', 'the other submissions stay');
      // Steering tightens the threshold, tests it again and resubmits.
      const id = feature(w, 'steering_return_rate');
      const p = w.s.features[id]!.draft.policies[RETURN_RATE]!;
      w.as('steering', (c) => config.putPolicy(c, id, RETURN_RATE, { ...p, trigger: 'steering_return_rate < 15 AND vehicle_speed > 40' }));
      w.as('steering', (c) => config.submitFeature(c, id, { message: '收紧回正阈值' }));
      verifyFeatureOn(w, 'steering_tester', id, [group(w, '转向研发车组')]);
      w.as('steering', (c) => calls.submitGroup(c, w.ref.call!, 'steering', { featureId: id, note: '阈值已收紧' }));
      w.eq(calls.callPhase(w.s, call(w)), 'COMPLETE', 'complete again');
    },
  },
  IC06: {
    needs: ['IC05'],
    run: (w) => {
      w.ref.t2 = sendToTest(w);
      w.eq(w.s.candidates[w.ref.t2]!.label, 'X89 1.2-T2', 'the second round');
      w.fails('TARGET_FIXED', () => w.as('integration_admin', (c) => calls.retargetCall(c, w.ref.call!, '1.3')));
      testRound(w, w.ref.t2!, 'PASS');
      w.as('integration_tester', (c) => v.verifyCandidate(c, w.ref.t2!));
      w.eq(calls.callPhase(w.s, call(w)), 'PASSED', 'passed, waiting for release');
      w.eq(calls.roundSoftware(w.s, w.ref.t2!), ['1.2.0.1'], 'tested on round 1’s whole-vehicle build');
      w.check(rel.testedVersions(w.s, w.s.candidates[w.ref.t2!]!).includes('1.2'), 'a pass on the build counts for the working name');
    },
  },
  IC07: {
    needs: ['IC06'],
    run: (w) => {
      w.denied('integrator', (c) => rel.promoteCandidate(c, w.ref.t2!, { dclVersion: '1.1.0', vehicleIntegrationVersions: ['1.2'] }));
      w.fails('CALL_TARGET_MISSING', () => w.as('release', (c) => rel.promoteCandidate(c, w.ref.t2!, { dclVersion: '1.1.0', vehicleIntegrationVersions: ['1.0'] })));
      w.fails('VERSION_IN_TEST', () => w.as('release', (c) => rel.promoteCandidate(c, w.ref.t2!, { dclVersion: '1.1.0', vehicleIntegrationVersions: ['1.2', '1.2.0.1'] })));
      const set = w.as('release', (c) => rel.promoteCandidate(c, w.ref.t2!, { dclVersion: '1.1.0', vehicleIntegrationVersions: ['1.2'], notes: 'X89 1.2 集成发布' }));
      w.ref.set = set;
      const sv = w.s.softwareVersions['X89::1.2']!;
      w.eq([sv.status, sv.dclModule?.releaseId, call(w).status, call(w).releaseId], ['PLANNED', set, 'RELEASED', set], 'working name still planned, set related, configuration exported');
      w.eq(w.s.releases[set]!.vehicleIntegrationVersions, ['1.2'], 'the set ↔ working name relation');
      const ref = w.s.applicability.find((a) => a.version === '1.2.0.1')!;
      w.eq([ref.releaseId, ref.by, ref.reason], [set, 'release', 'released with 1.2'], 'round 1’s build references 1.1.0 with the release');
      w.eq(rel.releaseFor(w.s, w.s.resources['VEH-202']!).release?.dclVersion, '1.0.0', 'VEH-202 on 1.0 keeps 1.0.0');
    },
  },
  IC08: {
    needs: ['IC07'],
    run: (w) => {
      w.denied('release', (c) => calls.deliverDclPart(c, { vehicleModelId: 'X89', version: '1.2', clientVersion: '2.3.0' }));
      const part = w.as('dcl', (c) => calls.deliverDclPart(c, { vehicleModelId: 'X89', version: '1.2', clientVersion: '2.3.0' }));
      const digest = w.s.resolvedConfigs[w.s.releases[w.ref.set!]!.resolvedConfigId]!.digest;
      w.eq([partVersion(part), part.digest], ['2.3.0+1.1.0', digest], 'the part names the client and the set, and carries the configuration digest');
      w.eq(workingNameState(w.s.softwareVersions['X89::1.2']!), 'DELIVERED', 'handed to PLM, waiting for PLM to publish');
    },
  },
  IC09: {
    needs: ['IC08'],
    run: (w) => {
      // A day later PLM issues round 2's build, the DCL part in its BOM; the admin links it.
      w.sys((c) => advanceClockHours(c, 24));
      const part = w.s.softwareVersions['X89::1.2']!.dclPart!;
      issueTestBuild(w, '1.2.0.2', { clientVersion: part.clientVersion, setVersion: part.setVersion, digest: part.digest });
      w.eq(calls.nextTestReference(w.s, call(w)).set?.id, w.ref.set, 'linking will reference 1.1.0');
      w.as('integration_admin', (c) => calls.linkTestVersion(c, w.ref.call!, '1.2.0.2'));
      const ref = w.s.applicability.find((a) => a.version === '1.2.0.2')!;
      w.eq([ref.releaseId, ref.by, ref.reason, ref.checkId], [w.ref.set, 'integration_admin', 'reference 1.2', null], 'DCL unchanged: the reference is confirmed directly');
      w.eq(rel.setInEffect(w.s, 'X89', '1.2.0.2')?.id, w.ref.set, '1.1.0 ↔ 1.2.0.2');
      // A car of the integration test group flashed with round 2's build gets 1.1.0 from the cloud.
      w.sys((c) => advanceClockHours(c, 1));
      carRuns(w.engine, 'VEH-031', '1.2.0.2');
      const config = w.s.releases[w.ref.set!]!.resolvedConfigId;
      const a = answerConfigRequest(w.s, 'VEH-031');
      w.eq([a.reason, a.configId], ['LATEST_RELEASE', config], 'nothing under test: the set mapped to its software');
      const push = Object.values(w.s.deployments).find((d) => d.kind === 'BASELINE' && d.status === 'PENDING' && d.targets.some((t) => t.resourceId === 'VEH-031'))!;
      w.eq([push.resolvedConfigId, push.dispatchedBy, push.workspaceId], [config, 'integration_admin', 'x89-integration'], 'pushed by the mapping the admin confirmed');
      w.sys((c) => sendReceipt(c, push.id, 'VEH-031', 'APPLIED'));
      w.eq(w.s.resources['VEH-031']!.appliedConfigId, config, 'VEH-031 runs 1.1.0');
    },
  },
  IC10: {
    needs: ['IC09'],
    run: (w) => {
      // Round 2 passes: PLM releases 1.2.0.2 under the same number.
      w.sys((c) => advanceClockHours(c, 24));
      w.sys((c) => releasePlmVersion(c, { vehicleModelId: 'X89', version: '1.2.0.2' }));
      w.sys((c) => syncPlmIfChanged(c));
      const v = w.s.softwareVersions['X89::1.2.0.2']!;
      w.eq([v.status, v.workingName, w.s.softwareVersions['X89::1.2']!.linkedTo, v.dclModule?.releaseId], ['RECORDED', '1.2', '1.2.0.2', w.ref.set], 'released and linked to the working name; the part is its factory configuration');
      w.eq(w.s.softwareVersions['X89::1.2.0.1']!.status, 'TESTING', 'round 1’s build stays a test version');
      w.eq(rel.setInEffect(w.s, 'X89', '1.2.0.2')?.id, w.ref.set, '1.1.0 applies to 1.2.0.2');
      w.eq(Object.values(w.s.applicabilityChecks).filter((c) => c.version === '1.2.0.2').length, 0, 'no applicability check: the reference covers it');
      // The working name is 1.2.0.2 now: no car is put on it, its part is not exported again, no more rounds.
      w.fails('WORKING_NAME_LINKED', () => w.as('business', (c) => requestVehicleSoftware(c, 'team-brake', 'VEH-001', { version: '1.2', reason: '预发布验证' })));
      w.fails('WORKING_NAME_LINKED', () => w.as('dcl', (c) => calls.deliverDclPart(c, { vehicleModelId: 'X89', version: '1.2', clientVersion: '2.4.0' })));
      w.fails('WORKING_NAME_LINKED', () => w.as('integration_admin', (c) => calls.linkTestVersion(c, w.ref.call!, '1.2.0.1')));
      // The vehicle OTA program flashes VEH-201 with 1.2.0.2: it reports the bundled set, no push needed.
      w.sys((c) => advanceClockHours(c, 1));
      carRuns(w.engine, 'VEH-201', '1.2.0.2');
      const config = w.s.releases[w.ref.set!]!.resolvedConfigId;
      w.eq(w.s.resources['VEH-201']!.appliedConfigId, config, 'VEH-201 runs 1.1.0 from the package');
      w.eq(w.s.clientReports['VEH-201']!.latest!.payload.configuration?.digest, w.s.softwareVersions['X89::1.2']!.dclPart!.digest, 'its own report says so');
      w.eq(answerConfigRequest(w.s, 'VEH-201').configId, config, 'nothing more to push');
    },
  },
  IC11: {
    needs: ['IC10'],
    run: (w) => {
      const history = versionHistory(w.s, 'X89', '1.2.0.2');
      const kinds = history.map((e) => e.kind);
      w.eq(kinds[0], 'CALL_OPENED', 'it starts with the call');
      w.eq(
        kinds.filter((k) => k.startsWith('ROUND_') || ['TEST_VERSION_LINKED', 'MODULE_RETURNED', 'PUBLISHED', 'MODULE_EXPORTED', 'PART_DELIVERED', 'PLM_TEST_ISSUED', 'APPLICABILITY_ADDED', 'PLM_RELEASED', 'LINKED'].includes(k)),
        ['TEST_VERSION_LINKED', 'ROUND_FROZEN', 'MODULE_RETURNED', 'ROUND_CANCELLED', 'ROUND_FROZEN', 'ROUND_PASSED', 'PUBLISHED', 'MODULE_EXPORTED', 'PART_DELIVERED', 'PLM_TEST_ISSUED', 'TEST_VERSION_LINKED', 'APPLICABILITY_ADDED', 'PLM_RELEASED', 'LINKED'],
        'round 1 linked, the DCL rounds, the release, the part, round 2 issued and linked with its reference, PLM’s release, in order',
      );
      w.eq(history.find((e) => e.kind === 'ROUND_PASSED')!.software, ['1.2.0.1'], 'the passing DCL round was tested on round 1’s build');
      w.eq(setsOverTime(history), [w.ref.set!], '1.1.0 is the only set 1.2.0.2 ever had');
      w.eq(history.filter((e) => e.kind === 'VEHICLE_ARRIVED').map((e) => e.resourceIds[0]), ['VEH-031', 'VEH-201'], 'the test car on round 2, then the production car');
      w.eq(history.find((e) => e.kind === 'VEHICLE_ARRIVED' && e.resourceIds.includes('VEH-201'))!.releaseId, w.ref.set, 'VEH-201 started on the bundled set');
    },
  },
  IC12: {
    needs: ['IC11'],
    run: (w) => {
      // PLM publishes 1.2.1 (another module fixed) with the same DCL part, outside the call's rounds.
      const part = w.s.softwareVersions['X89::1.2.0.2']!.dclPart!;
      w.sys((c) => publishPlmVersion(c, { vehicleModelId: 'X89', version: '1.2.1', dclPart: { clientVersion: part.clientVersion, setVersion: part.setVersion, digest: part.digest } }));
      w.sys((c) => syncPlmIfChanged(c));
      const v121 = w.s.softwareVersions['X89::1.2.1']!;
      w.eq([v121.dclModule?.releaseId, v121.workingName], [w.ref.set, null], 'factory configuration 1.1.0, no working name');
      w.eq(rel.setInEffect(w.s, 'X89', '1.2.1'), null, 'no set applies yet');
      const checks = Object.values(w.s.applicabilityChecks).filter((c) => c.version === '1.2.1');
      w.eq(checks.map((c) => [c.releaseId, c.auto]), [[w.ref.set, true]], 'an applicability check opens for 1.1.0 on 1.2.1');
    },
  },
  N01: {
    needs: ['IC01'],
    forkAfter: 'IC01',
    run: (w) => {
      w.denied('cdc_integrator', (c) => calls.submitDomain(c, w.ref.call!, 'ADC', {}));
      w.denied('steering', (c) => calls.submitGroup(c, w.ref.call!, 'brake', {}));
      w.denied('integration_tester', (c) => calls.excludeModule(c, w.ref.call!, 'domain:CDC', 'x'));
      w.denied('release', (c) => calls.cancelCall(c, w.ref.call!, 'x'));
      w.check(!canOpenPage(w.actor('integration_admin').grants, 'release', 'x89-project'), 'the integration admin still does not open Release & OTA');
      // Only test builds are linked, by the integration admin; a production car never takes one.
      issueTestBuild(w, '1.2.0.1');
      w.denied('integration_tester', (c) => calls.linkTestVersion(c, w.ref.call!, '1.2.0.1'));
      w.fails('NOT_A_TEST_VERSION', () => w.as('integration_admin', (c) => calls.linkTestVersion(c, w.ref.call!, '1.1')));
      w.fails('TEST_VERSION_FOR_PRODUCTION', () => w.sys((c) => simulateSoftwareOta(c, 'VEH-201', '1.2.0.1')));
      w.as('integration_admin', (c) => calls.cancelCall(c, w.ref.call!, '整车计划调整'));
      w.fails('CALL_CLOSED', () => w.as('steering', (c) => calls.submitGroup(c, w.ref.call!, 'steering', {})));
      w.fails('CALL_CLOSED', () => w.as('integration_admin', (c) => calls.linkTestVersion(c, w.ref.call!, '1.2.0.1')));
    },
  },
};
