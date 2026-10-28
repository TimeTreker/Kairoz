import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { DomainError } from '../src/domain/errors.ts';
import * as calls from '../src/engine/calls.ts';
import { Engine } from '../src/engine/engine.ts';
import * as fleet from '../src/engine/fleet.ts';
import * as h from '../src/engine/history.ts';
import * as identity from '../src/engine/identity.ts';
import * as integ from '../src/engine/integration.ts';
import * as lifecycle from '../src/engine/lifecycle.ts';
import { migrate } from '../src/engine/migrate.ts';
import { demoState } from '../src/engine/seed.ts';
import { sendReceipt } from '../src/engine/simulator.ts';
import * as vs from '../src/engine/vehicle-software.ts';
import * as v from '../src/engine/validation.ts';
import { carRuns } from '../acceptance/helpers.ts';

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

function opened(e = new Engine(demoState())) {
  const callId = e.run('integration_admin', (c) => calls.openCall(c, { workspaceId: 'x89-project', targetVersion: '1.2', dueDate: null }));
  return { e, callId, call: () => e.getState().integrationCalls[callId]! };
}

function complete() {
  const x = opened();
  const { e, callId } = x;
  e.run('steering', (c) => calls.submitGroup(c, callId, 'steering', { featureId: featureId(e, 'steering_return_rate') }));
  e.run('business', (c) => calls.submitGroup(c, callId, 'brake', { featureId: featureId(e, 'brake_monitor') }));
  e.run('adc_integrator', (c) => calls.submitDomain(c, callId, 'ADC', {}));
  e.run('cdc_integrator', (c) => calls.submitDomain(c, callId, 'CDC', {}));
  return x;
}

function preview(e: Engine, callId: string): string {
  const plan = e.run('integrator', (c) => calls.previewCall(c, callId));
  e.run('dcl', (c) => integ.confirmProcessing(c, plan, { note: '' }));
  return plan;
}

function testVehiclesOn12(e: Engine): string[] {
  e.run('dcl', (c) => fleet.registerImage(c, { id: 'x89-1.2-sim', vehicleModelId: 'X89', integrationVersion: '1.2', build: 'x89-1.2.0-rc1', digest: 'sha256:mock-x89-1-2-rc1', simulator: 'SimOne 3' }));
  e.run('integration_admin', (c) => fleet.createSimulation(c, { id: 'SIM-112', workspaceId: 'x89-integration', imageId: 'x89-1.2-sim', env: 'testing', pool: 'Vehicle' }));
  return ['SIM-112'];
}

describe('call rounds follow the call’s records', () => {
  test('a round in test is locked for submitters; the admin leaving a module out closes it and frees its test vehicles', () => {
    const { e, callId, call } = complete();
    const [sim] = testVehiclesOn12(e);
    const plan = preview(e, callId);
    const cand = e.run('integrator', (c) => integ.freezeCandidate(c, plan, { label: '' }));
    const d = e.run('integration_tester', (c) => v.dispatchCandidate(c, cand, { resourceIds: [sim!] }));
    assert.deepEqual(calls.callProblems(e.getState(), call()), [], 'frozen submissions are still current while they are tested');
    fails(() => e.run('business', (c) => calls.submitGroup(c, callId, 'brake', {})), 'CALL_ROUND_OPEN');
    fails(() => e.run('cdc_integrator', (c) => calls.submitDomain(c, callId, 'CDC', {})), 'CALL_ROUND_OPEN');
    e.run('integration_admin', (c) => calls.excludeModule(c, callId, 'brake', '制动本次不参加'));
    const s = e.getState();
    assert.deepEqual([call().rounds.at(-1)!.outcome, call().rounds.at(-1)!.reason], ['CANCELLED', '制动本次不参加']);
    assert.equal(s.candidates[cand]!.status, 'CANCELLED');
    assert.deepEqual([s.deployments[d]!.status, s.deployments[d]!.targets.map((t) => t.status)], ['CANCELLED', ['CANCELLED']]);
    fails(() => e.run(null, (c) => sendReceipt(c, d, sim!, 'APPLIED')), 'TARGET_NOT_PENDING');
  });

  test('a preview whose submissions changed cannot be frozen', () => {
    const { e, callId } = complete();
    const plan = preview(e, callId);
    e.run('business', (c) => calls.submitGroup(c, callId, 'brake', { note: '撤回本次改动' }));
    fails(() => e.run('integrator', (c) => integ.freezeCandidate(c, plan, { label: '' })), 'CALL_ROUND_STALE');
  });

  test('a domain left out opens no domain call; closing the whole-vehicle call closes its domain calls', () => {
    const e = new Engine(demoState());
    const callId = e.run('integration_admin', (c) => calls.openCall(c, { workspaceId: 'x89-project', targetVersion: '1.2', dueDate: null, exclude: ['domain:CDC'] }));
    fails(() => e.run('cdc_integrator', (c) => calls.openCall(c, { workspaceId: 'x89-cdc-integration', scope: 'CDC', parentCallId: callId })), 'MODULE_EXCLUDED');
    const child = e.run('adc_integrator', (c) => calls.openCall(c, { workspaceId: 'x89-adc-integration', scope: 'ADC', parentCallId: callId }));
    e.run('adc_integrator', (c) => calls.submitDomain(c, callId, 'ADC', {}));
    e.run('steering', (c) => calls.submitGroup(c, callId, 'steering', {}));
    e.run('business', (c) => calls.submitGroup(c, callId, 'brake', {}));
    e.run('integration_admin', (c) => calls.closeUnchanged(c, callId, '本次无变更'));
    assert.deepEqual([e.getState().integrationCalls[callId]!.status, e.getState().integrationCalls[child]!.status], ['NO_CHANGE', 'CANCELLED']);
  });
});

describe('retargeting a call', () => {
  test('a version that already has a set cannot be the target', () => {
    const { e, callId } = opened();
    fails(() => e.run('integration_admin', (c) => calls.retargetCall(c, callId, '1.0')), 'VERSION_RELEASED');
  });

  test('a planned version a vehicle is being updated to stays when the call moves on', () => {
    const { e, callId } = opened();
    const ws = 'team-brake';
    e.run('business', (c) => vs.requestVehicleSoftware(c, ws, 'VEH-001', { version: '1.2', reason: '预发布验证' }));
    e.run('integration_admin', (c) => calls.retargetCall(c, callId, '1.3'));
    const s = e.getState();
    assert.deepEqual([s.softwareVersions['X89::1.2']?.status, s.softwareVersions['X89::1.3']?.status], ['PLANNED', 'PLANNED']);
  });
});

describe('archiving', () => {
  test('a workspace with an open call, or whose set is in effect, is not archived', () => {
    const { e } = opened();
    const problems = lifecycle.workspaceArchiveProblems(e.getState(), 'x89-project');
    assert.ok(problems.some((p) => p.startsWith('integration call X89 1.2 is open')), problems.join('\n'));
    assert.ok(problems.some((p) => p === 'policy set 1.0.0 is in effect for 1.0'), problems.join('\n'));
  });

  test('a pending team test request holds its workspace', () => {
    const e = new Engine(demoState());
    const vg = Object.values(e.getState().vehicleGroups).find((g) => g.name === '制动研发车组')!.id;
    e.run('workspace_manager', (c) => fleet.setGroupApproval(c, vg, true));
    const guided = Object.values(e.getState().features).find((f) => f.name === 'guided_brake')!;
    const req = e.run('brake_tester', (c) => v.requestTeamTest(c, guided.id, { commitId: guided.headCommitId!, vehicleGroupIds: [vg], goal: '急刹车验证' }));
    assert.ok(lifecycle.workspaceArchiveProblems(e.getState(), 'team-brake').includes(`team test request ${req} is open`));
    // Withdrawing is authorized like every other change.
    e.run('admin', (c) => identity.replaceGrants(c, 'brake_tester', []));
    fails(() => e.run('brake_tester', (c) => v.withdrawTestRequest(c, req)), 'FORBIDDEN');
  });
});

describe('release history keeps every step', () => {
  test('the planned moment of a call’s working name', () => {
    const { e: e2, callId } = opened();
    const planned = h.versionHistory(e2.getState(), 'X89', '1.2').map((x) => x.kind);
    assert.ok(planned.includes('SOFTWARE_PLANNED'));
    assert.equal(e2.getState().integrationCalls[callId]!.targetVersion, '1.2');
  });

  test('a schema 21 save gets its planned time, and PLM records the versions it had', () => {
    const { e } = opened();
    const current = JSON.parse(JSON.stringify(e.getState()));
    const saved = JSON.parse(JSON.stringify(current));
    saved.schema = 21;
    delete saved.plm;
    delete saved.plmSync;
    for (const x of Object.values(saved.softwareVersions) as any[]) for (const k of ['moduleLog', 'plannedBy', 'plannedAt', 'dclPart', 'workingName', 'linkedTo']) delete x[k];
    const migrated = migrate(saved)!;
    assert.deepEqual(migrated.softwareVersions, current.softwareVersions);
    assert.deepEqual(migrated.plm.versions.map((v) => v.version), ['1.0', '1.1']);
    assert.equal(migrated.plmSync.revision, migrated.plm.revision);
  });

  test('a migrated schema 20 rollout keeps the software its vehicles ran when it was sent', () => {
    const e = new Engine(demoState());
    carRuns(e, 'VEH-201', '1.1');
    const live = e.getState();
    const saved = JSON.parse(JSON.stringify(live));
    saved.schema = 20;
    for (const d of Object.values(saved.deployments) as any[]) {
      delete d.log;
      for (const t of d.targets) delete t.software;
    }
    const m = migrate(saved)!;
    for (const d of Object.values(m.deployments).filter((x) => x.kind === 'OTA')) {
      assert.deepEqual(d.targets.map((t) => t.software), live.deployments[d.id]!.targets.map((t) => t.software), d.id);
    }
  });
});
