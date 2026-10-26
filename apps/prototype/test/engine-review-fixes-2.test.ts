// Regressions from the second independent review: take-overs from patches, after-sales requests,
// grader deferral, flood counting and technical changes.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { answerAll, verifyFeatureOn } from '../acceptance/helpers.ts';
import { World } from '../acceptance/world.ts';
import { DEFAULT_BUDGET } from '../src/domain/budget.ts';
import { cancelCaptureRequest, captureRequestsFor, graderCapture, requestAfterSalesCapture } from '../src/engine/aftersales.ts';
import * as ap from '../src/engine/applicability.ts';
import { setVehicleBudget } from '../src/engine/budget.ts';
import { addDays, todayOf } from '../src/engine/clock.ts';
import * as config from '../src/engine/config.ts';
import { decideEmergencyStop, requestEmergencyStop } from '../src/engine/emergency.ts';
import { environmentMoveProblems } from '../src/engine/environment.ts';
import { captureEvent } from '../src/engine/events.ts';
import { returnFeature, setTechnicalBinding } from '../src/engine/intake.ts';
import * as integ from '../src/engine/integration.ts';
import { workspaceArchiveProblems } from '../src/engine/lifecycle.ts';
import * as ln from '../src/engine/loans.ts';
import { createPipeline } from '../src/engine/processing.ts';
import * as rel from '../src/engine/release.ts';
import { demoState } from '../src/engine/seed.ts';
import { setAgent, tick } from '../src/engine/simulator.ts';
import { latestCommittedVersion } from '../src/engine/snapshots.ts';
import { ON_10, angleFix, feature, freeze, groupId, mainline110, patch101, preview, set, testCandidate } from './patch-fixtures.ts';

const MONITOR = 'chassis.brake.monitor';
const DIAG = 'chassis.brake.failure_diag';
const CORE = 'chassis.brake.core';
const ask = (w: World, user: string, policyId: string) => w.as(user, (c) => requestAfterSalesCapture(c, { workspaceId: 'team-brake', resourceId: 'VEH-001', policyId, reason: '客户投诉' }));

/** A brake Feature whose one policy is HIGH priority, verified and running on 制动研发车组 (VEH-001, SIM-021). */
function highPolicy(w: World): void {
  const id = w.as('business', (c) => config.createFeature(c, { workspaceId: 'team-brake', groupId: 'brake', name: 'brake_core' }));
  const dataKey = w.as('business', (c) => config.addFile(c, id, { source: { unit: 'CHASSIS', directory: '/var/log/core', pattern: 'core.log' }, name: '制动核心日志', purpose: '售后核心诊断' }));
  w.as('business', (c) => config.putPolicy(c, id, CORE, { name: '制动核心', trigger: 'brake_pressure > 90', captures: [dataKey], preSeconds: 30, postSeconds: 30, priority: 'HIGH' }));
  w.as('business', (c) => config.submitFeature(c, id, { message: 'core' }));
  verifyFeatureOn(w, 'brake_tester', id, [groupId(w, '制动研发车组')]);
}

describe('second review: patches and the mainline', () => {
  test('the mainline head confirmed for a patch’s software becomes the set in effect there', () => {
    const w = new World(demoState());
    mainline110(w);
    const fix = angleFix(w);
    patch101(w, fix);
    w.as('integrator', (c) => integ.closeForMainline(c, fix, { reason: '主线不需要' }));
    const check = w.as('release', (c) => ap.openApplicabilityCheck(c, { releaseId: set(w, '1.1.0').id, version: '1.0' }));
    answerAll(w, w.as('integration_tester', (c) => ap.dispatchApplicability(c, check, { vehicleGroupIds: [groupId(w, 'X89 集成测试车组')] })));
    for (const r of ON_10.vehicles) w.as('integration_tester', (c) => ap.recordApplicabilityTest(c, check, { resourceId: r, result: 'PASS', summary: '回归通过' }));
    w.as('integration_tester', (c) => ap.verifyApplicability(c, check));
    w.as('release', (c) => ap.confirmApplicability(c, check, { note: '主线接管 1.0' }));
    assert.equal(rel.setInEffect(w.s, 'X89', '1.0')?.dclVersion, '1.1.0');
    assert.equal(rel.appliesTo(w.s, set(w, '1.0.1'), '1.0'), false, 'the patch no longer serves 1.0');
  });

  test('a mainline set does not take software over from an emergency-stop patch while it runs a pre-stop version', () => {
    const w = new World(demoState());
    mainline110(w);
    // Software 1.0 runs 1.0.0; stopping angle_jump there gives patch 1.0.1 of 1.0.0.
    const stop = w.as('dcl', (c) => requestEmergencyStop(c, { releaseId: set(w, '1.0.0').id, policyId: 'chassis.steering.angle_jump', reason: '误触发' }));
    w.as('release', (c) => decideEmergencyStop(c, stop, { decision: 'APPROVED', note: '批准' }));
    assert.equal(set(w, '1.0.1').patchOf, set(w, '1.0.0').id);
    // The mainline still runs angle_jump in a version made before the stop.
    const cand = freeze(w, preview(w, [feature(w, 'brake_monitor').id]), 'X89-C3');
    testCandidate(w, cand, ON_10);
    assert.equal(rel.promoteVersionProblem(w.s, w.s.candidates[cand]!, '1.0')?.code, 'PATCH_FIX_MISSING');
  });
});

describe('second review: after-sales and the grader', () => {
  test('a vehicle lent away takes no request from its lender; pending requests block moves and archiving', () => {
    const w = new World(demoState());
    const q = ask(w, 'business', MONITOR);
    assert.ok(environmentMoveProblems(w.s, w.s.resources['VEH-001']!, 'testing').some((p) => p.includes('after-sales request')));
    assert.ok(workspaceArchiveProblems(w.s, 'team-brake').some((p) => p.includes('after-sales request')));
    w.as('business', (c) => cancelCaptureRequest(c, q));
    // The brake team lends VEH-001 to the steering team.
    const loan = w.as('workspace_manager', (c) => ln.requestLoan(c, { workspaceId: 'team-steering', resourceId: 'VEH-001', vehicleGroupId: groupId(w, '转向研发车组'), dueDate: addDays(todayOf(w.s), 7), purpose: '联调' }));
    w.as('workspace_manager', (c) => ln.answerLoanAsLender(c, loan, { workspaceId: 'team-brake', agree: true }));
    w.as('resource', (c) => ln.decideLoan(c, loan, { approve: true }));
    w.fails('VEHICLE_ON_LOAN', () => ask(w, 'business', MONITOR));
  });

  test('a HIGH grader capture that waited for after-sales still goes, over budget', () => {
    const w = new World(demoState());
    highPolicy(w);
    w.as('dcl', (c) => setVehicleBudget(c, 'VEH-001', { ...DEFAULT_BUDGET, networkMbPerHour: 1.5 }));
    w.sys((c) => setAgent(c, 'VEH-001', { online: false }));
    ask(w, 'business', CORE);
    const grader = w.sys((c) => graderCapture(c, 'VEH-001', CORE));
    assert.deepEqual([w.s.events[grader]!.priority, w.s.events[grader]!.status, w.s.events[grader]!.budgetNote], ['HIGH', 'HELD', 'DEFERRED']);
    w.sys((c) => setAgent(c, 'VEH-001', { online: true }));
    w.sys((c) => tick(c));
    w.sys((c) => tick(c));
    assert.deepEqual([w.s.events[grader]!.status !== 'HELD' && w.s.events[grader]!.status !== 'DROPPED', w.s.events[grader]!.budgetNote], [true, 'OVER_BUDGET_HIGH']);
  });

  test('only the vehicle’s own triggers count toward the flood limit', () => {
    const w = new World(demoState());
    w.as('dcl', (c) => setVehicleBudget(c, 'VEH-001', { ...DEFAULT_BUDGET, triggersPerPolicyPerHour: 1 }));
    const graders = [w.sys((c) => graderCapture(c, 'VEH-001', DIAG)), w.sys((c) => graderCapture(c, 'VEH-001', DIAG))];
    assert.ok(graders.every((id) => w.s.events[id]!.status === 'UPLOADING'), 'grader captures are not floods');
    const first = w.sys((c) => captureEvent(c, { resourceId: 'VEH-001', policyId: DIAG }));
    const second = w.sys((c) => captureEvent(c, { resourceId: 'VEH-001', policyId: DIAG }));
    assert.deepEqual([w.s.events[first]!.status, w.s.events[second]!.status], ['UPLOADING', 'SUPPRESSED']);
    w.sys((c) => captureEvent(c, { resourceId: 'VEH-001', policyId: MONITOR }));
    const q = ask(w, 'business', MONITOR);
    w.sys((c) => tick(c));
    assert.notEqual(w.s.events[w.s.captureRequests[q]!.eventId!]!.status, 'SUPPRESSED', 'an after-sales capture is never a flood');
  });

  test('requests are listed and cancelled within the policy’s group only', () => {
    const w = new World(demoState());
    const q = ask(w, 'business', MONITOR);
    const steering = w.actor('steering');
    // A steering developer working in the brake workspace sees no brake requests.
    const inBrake = { ...steering, grants: steering.grants.map((g) => ({ ...g, workspaces: [...g.workspaces, 'team-brake'] })) };
    assert.deepEqual(captureRequestsFor(w.s, inBrake, 'team-brake').map((x) => x.id), []);
    assert.deepEqual(captureRequestsFor(w.s, w.actor('brake_tester'), 'team-brake').map((x) => x.id), [q]);
    w.as('brake_tester', (c) => cancelCaptureRequest(c, q));
    assert.equal(w.s.captureRequests[q]!.cancelledBy, 'brake_tester');
  });
});

describe('second review: technical changes', () => {
  test('a technical change is never returned to business authors, and may re-pin to a binding-only new version', () => {
    const w = new World(demoState());
    const edge = w.as('dcl', (c) => createPipeline(c, { code: 'default-edge-bin-log', side: 'EDGE', name: '精简', formats: ['binary'], steps: ['Receive', 'Encrypt'] }));
    const id = w.as('dcl', (c) => config.createTechnicalChange(c, { workspaceId: 'team-steering', groupId: 'steering', name: 'tech_x' }));
    const [dataKey, spec] = Object.entries(w.s.features[id]!.draft.files)[0]!;
    const before = latestCommittedVersion(w.s, dataKey)!;
    w.as('dcl', (c) => setTechnicalBinding(c, id, dataKey, { format: spec.format, schema: spec.schema, edgePipelineId: edge, cloudPipelineId: spec.cloudPipelineId }));
    w.as('dcl', (c) => config.submitFeature(c, id, { message: '精简' }));
    w.fails('NOT_IN_INTAKE', () => w.as('dcl', (c) => returnFeature(c, id, { reason: 'x' })));
    // The rebound version differs from the old one only in its binding: a reader may follow it in a technical change.
    const after = latestCommittedVersion(w.s, dataKey)!;
    const ref = (versionId: string) => ({ files: {}, policies: {}, references: { [dataKey]: versionId } });
    assert.deepEqual(config.technicalScopeIssues(w.s, ref(before.id), ref(after.id)), []);
  });
});
