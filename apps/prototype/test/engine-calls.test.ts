import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { DomainError } from '../src/domain/errors.ts';
import * as ap from '../src/engine/applicability.ts';
import * as calls from '../src/engine/calls.ts';
import { Engine } from '../src/engine/engine.ts';
import * as fleet from '../src/engine/fleet.ts';
import * as h from '../src/engine/history.ts';
import * as integ from '../src/engine/integration.ts';
import * as ota from '../src/engine/ota.ts';
import * as rel from '../src/engine/release.ts';
import { demoState } from '../src/engine/seed.ts';
import { advanceClockHours, sendReceipt } from '../src/engine/simulator.ts';
import * as v from '../src/engine/validation.ts';
import { carRuns, plmPublish, tspCar } from '../acceptance/helpers.ts';

function fails(fn: () => unknown, code: string): DomainError {
  try {
    fn();
  } catch (e) {
    if (e instanceof DomainError && e.code === code) return e;
    throw new Error(`expected ${code}, got ${e instanceof DomainError ? `${e.code} ${JSON.stringify(e.details)}` : e}`);
  }
  throw new Error(`expected ${code}, but it succeeded`);
}

const featureId = (e: Engine, name: string) => Object.values(e.getState().features).find((f) => f.name === name)!.id;

/** The demo with a call for X89 1.2 opened by the integration admin. */
function opened() {
  const e = new Engine(demoState());
  const callId = e.run('integration_admin', (c) => calls.openCall(c, { workspaceId: 'x89-project', targetVersion: '1.2', dueDate: null }));
  return { e, callId, call: () => e.getState().integrationCalls[callId]! };
}

/** Every module answered: steering and brake submit their Verified Features, ADC and CDC say no change. */
function complete() {
  const x = opened();
  const { e, callId } = x;
  e.run('steering', (c) => calls.submitGroup(c, callId, 'steering', { featureId: featureId(e, 'steering_return_rate') }));
  e.run('business', (c) => calls.submitGroup(c, callId, 'brake', { featureId: featureId(e, 'brake_monitor') }));
  e.run('adc_integrator', (c) => calls.submitDomain(c, callId, 'ADC', { note: 'ADC 本次无变更' }));
  e.run('cdc_integrator', (c) => calls.submitDomain(c, callId, 'CDC', {}));
  return x;
}

/** A simulation and a physical testing vehicle in X89 integration testing running the planned 1.2. */
function testVehiclesOn12(e: Engine): string[] {
  e.run('dcl', (c) => fleet.registerImage(c, { id: 'x89-1.2-sim', vehicleModelId: 'X89', integrationVersion: '1.2', build: 'x89-1.2.0-rc1', digest: 'sha256:mock-x89-1-2-rc1', simulator: 'SimOne 3' }));
  e.run('integration_admin', (c) => fleet.createSimulation(c, { id: 'SIM-112', workspaceId: 'x89-integration', imageId: 'x89-1.2-sim', env: 'testing', pool: 'Vehicle' }));
  tspCar(e, 'LSDEMX89000003200', 'X89');
  e.run('resource', (c) => fleet.registerPhysical(c, { id: 'VEH-032', vin: 'LSDEMX89000003200', vehicleModelId: 'X89', env: 'testing', pool: 'Vehicle' }));
  carRuns(e, 'VEH-032', '1.2');
  e.run('integration_admin', (c) => fleet.addWorkspaceVehicle(c, 'x89-integration', 'VEH-032'));
  return ['SIM-112', 'VEH-032'];
}

/** Previews, confirms and freezes the call's next round. */
function sendToTest(e: Engine, callId: string): string {
  const plan = e.run('integrator', (c) => calls.previewCall(c, callId));
  e.run('dcl', (c) => integ.confirmProcessing(c, plan, { note: '' }));
  return e.run('integrator', (c) => integ.freezeCandidate(c, plan, { label: '' }));
}

function test1Round(e: Engine, candidateId: string, vehicles: string[], result: 'PASS' | 'FAIL') {
  const d = e.run('integration_tester', (c) => v.dispatchCandidate(c, candidateId, { resourceIds: vehicles }));
  for (const r of vehicles) e.run(null, (c) => sendReceipt(c, d, r, 'APPLIED'));
  e.run('integration_tester', (c) => v.recordCandidateTest(c, candidateId, { resourceId: vehicles[0]!, result: 'PASS', summary: '仿真回归通过' }));
  e.run('integration_tester', (c) => v.recordCandidateTest(c, candidateId, { resourceId: vehicles[1]!, result, summary: result === 'PASS' ? '实车回归通过' : '回正误触发偏多' }));
}

describe('integration calls', () => {
  test('opening a call lists leaf groups and upper domains, and plans the target version', () => {
    const { e, callId, call } = opened();
    const s = e.getState();
    assert.deepEqual(
      call().modules.map((m) => [m.key, m.kind, m.workspaceId, m.status]),
      [
        ['brake', 'GROUP', 'team-brake', 'WAITING'],
        ['steering', 'GROUP', 'team-steering', 'WAITING'],
        ['domain:ADC', 'DOMAIN', 'x89-adc-integration', 'WAITING'],
        ['domain:CDC', 'DOMAIN', 'x89-cdc-integration', 'WAITING'],
      ],
    );
    const planned = s.softwareVersions['X89::1.2']!;
    assert.deepEqual([planned.status, planned.callId, call().baseVersion], ['PLANNED', callId, '1.1']);
    assert.deepEqual(planned.manifest, s.softwareVersions['X89::1.1']!.manifest, 'the manifest comes from the base version');
    assert.equal(calls.callPhase(s, call()), 'COLLECTING');
    assert.equal(Object.values(s.applicabilityChecks).filter((c) => c.version === '1.2').length, 0, 'a planned version opens no applicability check');

    fails(() => e.run('integration_tester', (c) => calls.openCall(c, { workspaceId: 'x89-project', targetVersion: '1.3' })), 'FORBIDDEN');
    fails(() => e.run('release', (c) => calls.openCall(c, { workspaceId: 'x89-project', targetVersion: '1.3' })), 'FORBIDDEN');
    fails(() => e.run('integrator', (c) => calls.openCall(c, { workspaceId: 'x89-project', targetVersion: '1.2' })), 'CALL_EXISTS');
    fails(() => e.run('integrator', (c) => calls.openCall(c, { workspaceId: 'x89-project', targetVersion: '1.0' })), 'VERSION_RELEASED');
    fails(() => e.run('integrator', (c) => calls.openCall(c, { workspaceId: 'x89-project', targetVersion: 'X89-RC' })), 'INVALID_VERSION');
  });

  test('leaf groups are submitted by their developers, upper domains by their admin or integration', () => {
    const { e, callId, call } = opened();
    const steering = featureId(e, 'steering_return_rate');
    fails(() => e.run('business', (c) => calls.submitGroup(c, callId, 'steering', { featureId: steering })), 'FORBIDDEN');
    fails(() => e.run('workspace_manager', (c) => calls.submitGroup(c, callId, 'brake', {})), 'FORBIDDEN');
    fails(() => e.run('steering', (c) => calls.submitGroup(c, callId, 'steering', { featureId: featureId(e, 'brake_monitor') })), 'SOURCE_NOT_ALLOWED');
    fails(() => e.run('adc_parking', (c) => calls.submitDomain(c, callId, 'ADC', {})), 'FORBIDDEN');
    fails(() => e.run('cdc_integrator', (c) => calls.submitDomain(c, callId, 'ADC', {})), 'FORBIDDEN');

    e.run('steering', (c) => calls.submitGroup(c, callId, 'steering', { featureId: steering }));
    fails(() => e.run('integrator', (c) => calls.previewCall(c, callId)), 'CALL_INCOMPLETE');
    assert.equal(e.run('integration_admin', (c) => calls.remindModules(c, callId)), 3);
    assert.ok(call().modules.filter((m) => m.status === 'WAITING').every((m) => m.remindedAt));

    e.run('business', (c) => calls.submitGroup(c, callId, 'brake', { featureId: featureId(e, 'brake_monitor') }));
    e.run('adc_integrator', (c) => calls.submitDomain(c, callId, 'ADC', {}));
    e.run('cdc_integrator', (c) => calls.submitDomain(c, callId, 'CDC', {}));
    const m = call().modules.find((x) => x.key === 'steering')!;
    assert.deepEqual([m.status, m.featureId, m.by], ['SUBMITTED', steering, 'steering']);
    assert.equal(calls.callPhase(e.getState(), call()), 'COMPLETE');
    fails(() => e.run('integration_admin', (c) => calls.remindModules(c, callId)), 'NOTHING_TO_REMIND');
  });

  test('a failed round sends a module back and cancels its test integration version; the next round passes and is released for 1.2', () => {
    const { e, callId, call } = complete();
    const vehicles = testVehiclesOn12(e);
    // A production car reporting a working name waits: production runs only what PLM published.
    carRuns(e, 'VEH-201', '1.2');
    assert.equal(e.getState().resources['VEH-201']!.integrationVersion, '1.0');
    const r100 = rel.releasesOf(e.getState(), 'X89')[0]!.id;
    fails(() => e.run('release', (c) => ap.openApplicabilityCheck(c, { releaseId: r100, version: '1.2' })), 'VERSION_PLANNED');

    const t1 = sendToTest(e, callId);
    assert.equal(e.getState().candidates[t1]!.label, 'X89 1.2-T1');
    assert.equal(e.getState().candidates[t1]!.callId, callId);
    assert.equal(calls.callPhase(e.getState(), call()), 'TESTING');
    fails(() => e.run('integrator', (c) => calls.previewCall(c, callId)), 'CALL_ROUND_OPEN');
    fails(() => e.run('integration_admin', (c) => calls.retargetCall(c, callId, '1.3')), 'TARGET_FIXED');
    test1Round(e, t1, vehicles, 'FAIL');
    fails(() => e.run('integration_tester', (c) => v.verifyCandidate(c, t1)), 'VERIFY_BLOCKED');

    fails(() => e.run('integration_admin', (c) => calls.returnModules(c, callId, ['steering'], '  ')), 'REASON_REQUIRED');
    e.run('integration_admin', (c) => calls.returnModules(c, callId, ['steering'], '回正误触发偏多，请收紧阈值'));
    let s = e.getState();
    assert.equal(s.candidates[t1]!.status, 'CANCELLED');
    assert.deepEqual([call().rounds[0]!.outcome, call().rounds[0]!.reason], ['CANCELLED', '回正误触发偏多，请收紧阈值']);
    assert.equal(call().modules.find((m) => m.key === 'steering')!.status, 'RETURNED');
    assert.equal(s.features[featureId(e, 'steering_return_rate')]!.stage, 'VERIFIED', 'the Feature can be collected again');
    assert.equal(calls.callPhase(s, call()), 'COLLECTING');

    e.run('steering', (c) => calls.submitGroup(c, callId, 'steering', { featureId: featureId(e, 'steering_return_rate'), note: '阈值已复核' }));
    const t2 = sendToTest(e, callId);
    assert.equal(e.getState().candidates[t2]!.label, 'X89 1.2-T2');
    test1Round(e, t2, vehicles, 'PASS');
    e.run('integration_tester', (c) => v.verifyCandidate(c, t2));
    assert.equal(calls.callPhase(e.getState(), call()), 'PASSED');

    fails(() => e.run('release', (c) => rel.promoteCandidate(c, t2, { dclVersion: '1.1.0', vehicleIntegrationVersions: ['1.0'] })), 'CALL_TARGET_MISSING');
    const set = e.run('release', (c) => rel.promoteCandidate(c, t2, { dclVersion: '1.1.0', vehicleIntegrationVersions: ['1.2'], notes: 'X89 1.2 集成发布' }));
    s = e.getState();
    const sv = s.softwareVersions['X89::1.2']!;
    // The working name stays planned until PLM publishes the software; its set is exported for DCL.
    assert.deepEqual([sv.status, sv.callId, sv.linkedTo], ['PLANNED', callId, null]);
    assert.deepEqual([call().status, call().releaseId, call().rounds.map((r) => r.outcome)], ['RELEASED', set, ['CANCELLED', 'RELEASED']]);
    assert.deepEqual(s.releases[set]!.vehicleIntegrationVersions, ['1.2'], 'the set ↔ version relation');
    assert.equal(rel.setInEffect(s, 'X89', '1.2')!.id, set);
    assert.equal(rel.setInEffect(s, 'X89', '1.0')!.id, r100, '1.0 keeps its set');
    assert.deepEqual([sv.dclModule?.releaseId, sv.dclModule?.resolvedConfigId], [set, s.releases[set]!.resolvedConfigId]);
    assert.equal(s.resources['VEH-201']!.integrationVersion, '1.0', 'still waiting for PLM');

    // DCL hands the part over to PLM; PLM publishes the software as 1.2.0 with it in the BOM, and the
    // platform links the working name by the part's configuration digest.
    fails(() => e.run('release', (c) => calls.deliverDclPart(c, { vehicleModelId: 'X89', version: '1.2', clientVersion: '2.3.0' })), 'FORBIDDEN');
    const part = e.run('dcl', (c) => calls.deliverDclPart(c, { vehicleModelId: 'X89', version: '1.2', clientVersion: '2.3.0' }));
    assert.deepEqual([part.clientVersion, part.setVersion, part.digest], ['2.3.0', '1.1.0', s.resolvedConfigs[s.releases[set]!.resolvedConfigId]!.digest]);
    e.run(null, (c) => advanceClockHours(c, 1));
    plmPublish(e, 'X89', '1.2.0', { partOf: '1.2' });
    s = e.getState();
    const plm = s.softwareVersions['X89::1.2.0']!;
    assert.deepEqual([plm.status, plm.workingName, plm.callId, s.softwareVersions['X89::1.2']!.linkedTo], ['RECORDED', '1.2', callId, '1.2.0']);
    assert.equal(rel.setInEffect(s, 'X89', '1.2.0')!.id, set, 'the PLM version takes over the working name’s set');
    assert.equal(Object.values(s.applicabilityChecks).filter((c) => c.version === '1.2.0').length, 0, 'no check: the call tested this software');

    // A production vehicle flashed with 1.2.0 reports the bundled digest and runs the set at once,
    // without a cloud push (weak signal included).
    carRuns(e, 'VEH-201', '1.2.0');
    s = e.getState();
    assert.equal(rel.releaseFor(s, s.resources['VEH-201']!).release?.id, set);
    assert.equal(s.resources['VEH-201']!.appliedConfigId, s.releases[set]!.resolvedConfigId, 'applied with the software');
    assert.deepEqual(ota.answerConfigRequest(s, 'VEH-201'), { configId: s.releases[set]!.resolvedConfigId, reason: 'LATEST_RELEASE', detail: 'policy set 1.1.0' });
    const change = Object.values(s.softwareChanges).find((c) => c.resourceId === 'VEH-201' && c.toVersion === '1.2.0')!;
    assert.equal(change.configId, s.releases[set]!.resolvedConfigId);
    assert.equal(h.versionHistory(s, 'X89', '1.2.0').find((x) => x.kind === 'VEHICLE_ARRIVED')!.releaseId, set);
    // A testing vehicle keeps what it was sent: bundles are for production vehicles.
    assert.notEqual(s.resources['VEH-032']!.appliedConfigId, s.releases[set]!.resolvedConfigId);

    // The PLM version's history tells the working name's story first.
    const history = h.versionHistory(e.getState(), 'X89', '1.2.0');
    const kinds = history.map((x) => x.kind);
    assert.equal(kinds[0], 'CALL_OPENED');
    assert.deepEqual(
      kinds.filter((k) => k.startsWith('ROUND_') || ['PUBLISHED', 'MODULE_RETURNED', 'MODULE_EXPORTED', 'PART_DELIVERED', 'PLM_PUBLISHED', 'LINKED', 'APPLICABILITY_ADDED'].includes(k)),
      ['ROUND_FROZEN', 'MODULE_RETURNED', 'ROUND_CANCELLED', 'ROUND_FROZEN', 'ROUND_PASSED', 'PUBLISHED', 'MODULE_EXPORTED', 'PART_DELIVERED', 'PLM_PUBLISHED', 'LINKED', 'APPLICABILITY_ADDED'],
    );
    assert.equal(history.find((x) => x.kind === 'PUBLISHED')!.inEffect, null, 'published for the working name, not yet for 1.2.0');
    assert.equal(history.find((x) => x.kind === 'APPLICABILITY_ADDED')!.inEffect, set);
    assert.deepEqual(h.setsOverTime(history), [set]);
    assert.equal(h.versionHistory(e.getState(), 'X89', '1.2').find((x) => x.kind === 'PUBLISHED')!.inEffect, set);
    assert.equal(kinds.filter((k) => k === 'MODULE_SUBMITTED').length, 3, 'steering twice and brake once');
  });

  test('a domain call collects its groups and answers the whole-vehicle call', () => {
    const { e, callId, call } = opened();
    fails(() => e.run('adc_integrator', (c) => calls.openCall(c, { workspaceId: 'x89-adc-integration', scope: 'ADC' })), 'PARENT_CALL_REQUIRED');
    fails(() => e.run('adc_integrator', (c) => calls.openCall(c, { workspaceId: 'x89-cdc-integration', scope: 'CDC', parentCallId: callId })), 'FORBIDDEN');
    const child = e.run('adc_integrator', (c) => calls.openCall(c, { workspaceId: 'x89-adc-integration', scope: 'ADC', parentCallId: callId }));
    const s = e.getState();
    assert.deepEqual(s.integrationCalls[child]!.modules.map((m) => [m.key, m.workspaceId]), [
      ['adc-parking', 'team-adc-parking'],
      ['adc-system', 'team-adc-system'],
    ]);
    assert.equal(s.integrationCalls[child]!.targetVersion, '1.2');
    fails(() => e.run('adc_integrator', (c) => calls.closeUnchanged(c, child)), 'CALL_CHANGED');
    e.run('adc_parking', (c) => calls.submitGroup(c, child, 'adc-parking', {}));
    e.run('adc_system', (c) => calls.submitGroup(c, child, 'adc-system', {}));
    fails(() => e.run('adc_integrator', (c) => calls.previewCall(c, child)), 'CALL_INCOMPLETE');
    e.run('adc_integrator', (c) => calls.closeUnchanged(c, child, 'ADC 两组均无变更'));
    assert.equal(e.getState().integrationCalls[child]!.status, 'NO_CHANGE');
    const adc = call().modules.find((m) => m.key === 'domain:ADC')!;
    assert.deepEqual([adc.status, adc.by], ['NO_CHANGE', 'adc_integrator']);
  });

  test('a call targets a working name: PLM versions are refused, and a part exists only after the release', () => {
    const e = new Engine(demoState());
    fails(() => e.run('integration_admin', (c) => calls.openCall(c, { workspaceId: 'x89-project', targetVersion: '1.1', dueDate: null })), 'TARGET_RECORDED');
    const callId = e.run('integration_admin', (c) => calls.openCall(c, { workspaceId: 'x89-project', targetVersion: '1.2', dueDate: null }));
    fails(() => e.run('integration_admin', (c) => calls.retargetCall(c, callId, '1.1')), 'TARGET_RECORDED');
    fails(() => e.run('dcl', (c) => calls.deliverDclPart(c, { vehicleModelId: 'X89', version: '1.2', clientVersion: '2.3.0' })), 'NO_MODULE_TO_DELIVER');
    fails(() => e.run('dcl', (c) => calls.deliverDclPart(c, { vehicleModelId: 'X89', version: '1.0', clientVersion: '2.3.0' })), 'TARGET_RECORDED');
  });

  test('leaving out, retargeting before testing, and cancelling', () => {
    const { e, callId, call } = opened();
    fails(() => e.run('integration_admin', (c) => calls.excludeModule(c, callId, 'domain:CDC', '')), 'REASON_REQUIRED');
    e.run('integration_admin', (c) => calls.excludeModule(c, callId, 'domain:CDC', 'CDC 本期不改'));
    fails(() => e.run('cdc_integrator', (c) => calls.submitDomain(c, callId, 'CDC', {})), 'MODULE_EXCLUDED');
    e.run('integration_admin', (c) => calls.retargetCall(c, callId, '1.3'));
    let s = e.getState();
    assert.equal(call().targetVersion, '1.3');
    assert.equal(s.softwareVersions['X89::1.2'], undefined, 'an unused planned version moves with its call');
    assert.equal(s.softwareVersions['X89::1.3']!.status, 'PLANNED');
    e.run('integration_admin', (c) => calls.cancelCall(c, callId, '整车计划调整'));
    s = e.getState();
    assert.deepEqual([call().status, call().note, calls.callPhase(s, call())], ['CANCELLED', '整车计划调整', 'CANCELLED']);
    fails(() => e.run('steering', (c) => calls.submitGroup(c, callId, 'steering', {})), 'CALL_CLOSED');
    // Released outside the call, the planned version becomes recorded and asks for applicability.
    plmPublish(e, 'X89', '1.3');
    s = e.getState();
    assert.equal(s.softwareVersions['X89::1.3']!.status, 'RECORDED');
    assert.equal(Object.values(s.applicabilityChecks).filter((c) => c.version === '1.3').length, 1);
  });
});
