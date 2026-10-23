import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { DomainError } from '../src/domain/errors.ts';
import { emptyConfig } from '../src/domain/config.ts';
import type { FileSpecContent, GroupConfig } from '../src/domain/config.ts';
import { mergeGroup, PROCESSING_FIELDS } from '../src/domain/merge.ts';
import * as config from '../src/engine/config.ts';
import { Engine } from '../src/engine/engine.ts';
import * as integ from '../src/engine/integration.ts';
import { demoState } from '../src/engine/seed.ts';
import { sendReceipt } from '../src/engine/simulator.ts';
import * as v from '../src/engine/validation.ts';

function fails(fn: () => unknown, code: string): DomainError {
  try {
    fn();
  } catch (e) {
    if (e instanceof DomainError && e.code === code) return e;
    throw new Error(`expected ${code}, got ${e instanceof DomainError ? `${e.code} ${JSON.stringify(e.details)}` : e}`);
  }
  throw new Error(`expected ${code}, but it succeeded`);
}

const spec = (over: Partial<FileSpecContent> = {}): FileSpecContent => ({
  name: 'f',
  source: { unit: 'ADC', directory: '/log', pattern: 'a.pb' },
  fileType: 'bin_log',
  purpose: 'p',
  privacy: 'P3',
  retentionDays: 30,
  contentTags: [],
  priority: 'NORMAL',
  templateId: 't1',
  format: 'binary',
  schema: 's@1',
  edgePipelineId: 'e',
  cloudPipelineId: 'c',
  requiresReview: false,
  ...over,
});
const cfg = (files: Record<string, FileSpecContent>): GroupConfig => ({ ...emptyConfig(), files });

describe('three-way merge', () => {
  test('changes against each source’s own base apply; different bases alone never conflict', () => {
    const base = cfg({ a: spec() });
    const ours = cfg({ a: spec({ retentionDays: 60 }) }); // the target moved on since the base
    const result = mergeGroup(ours, [
      { featureId: 'f1', base, theirs: cfg({ a: spec({ purpose: 'new' }) }) },
      { featureId: 'f2', base: emptyConfig(), theirs: cfg({ b: spec({ name: 'b' }) }) },
    ]);
    assert.deepEqual(result.conflicts, []);
    assert.equal(result.merged.files.a!.retentionDays, 60);
    assert.equal(result.merged.files.a!.purpose, 'new');
    assert.equal(result.merged.files.b!.name, 'b');
  });

  test('the same field changed two ways conflicts, naming both sources; processing fields are DCL’s', () => {
    const base = cfg({ a: spec() });
    const result = mergeGroup(base, [
      { featureId: 'f1', base, theirs: cfg({ a: spec({ format: 'mcap' }) }) },
      { featureId: 'f2', base, theirs: cfg({ a: spec({ format: 'text' }) }) },
    ]);
    assert.equal(result.conflicts.length, 1);
    const c = result.conflicts[0]!;
    assert.deepEqual([c.section, c.key, c.field, c.ours, c.theirs], ['files', 'a', 'format', 'mcap', 'text']);
    assert.deepEqual(c.featureIds, ['f1', 'f2']);
    assert.ok(PROCESSING_FIELDS.has(c.field));
  });

  test('removing an item someone else changed conflicts; the derived review flag never does', () => {
    const base = cfg({ a: spec() });
    const result = mergeGroup(base, [
      { featureId: 'f1', base, theirs: cfg({ a: spec({ purpose: 'x', requiresReview: true }) }) },
      { featureId: 'f2', base, theirs: emptyConfig() },
    ]);
    assert.deepEqual(
      result.conflicts.map((c) => [c.key, c.field, c.featureIds]),
      [['a', '*', ['f2']]],
    );
    assert.equal(result.merged.files.a!.requiresReview, false, 'derived flags are recomputed by the caller');
  });
});

function setup() {
  const e = new Engine(demoState());
  const s = e.getState();
  const feature = (name: string) => Object.values(e.getState().features).find((f) => f.name === name)!;
  const vehicleGroup = (name: string) => Object.values(s.vehicleGroups).find((g) => g.name === name)!.id;
  return { e, feature, vehicleGroup };
}

/** Takes a DCL Ready brake Feature through dispatch, receipts and tests to Verified. */
function verifyBrake(e: Engine, featureId: string, vg: string) {
  const head = e.getState().features[featureId]!.headCommitId!;
  const d = e.run('brake_tester', (c) => v.dispatchFeature(c, featureId, { commitId: head, vehicleGroupIds: [vg] }));
  for (const r of ['SIM-021', 'VEH-001']) e.run(null, (c) => sendReceipt(c, d, r, 'APPLIED'));
  for (const r of ['SIM-021', 'VEH-001']) e.run('brake_tester', (c) => v.recordFeatureTest(c, featureId, { commitId: head, resourceId: r, result: 'PASS', summary: 'ok' }));
  e.run('brake_tester', (c) => v.verifyFeature(c, featureId));
}

describe('integration', () => {
  test('preview → DCL confirmation → frozen candidate → independent integration tests → Verified', () => {
    const { e, feature, vehicleGroup } = setup();
    const steering = feature('steering_return_rate');
    assert.equal(steering.stage, 'VERIFIED', 'the demo has a Verified steering Feature on DCL 1.0.0');
    assert.deepEqual(
      integ.verifiedSources(e.getState(), 'x89-project').map((f) => f.name),
      ['brake_monitor', 'steering_return_rate'],
    );
    fails(() => e.run('steering', (c) => integ.previewMerge(c, { workspaceId: 'x89-project', featureIds: [steering.id] })), 'FORBIDDEN');
    fails(() => e.run('integrator', (c) => integ.previewMerge(c, { workspaceId: 'x89-integration', featureIds: [steering.id] })), 'NOT_A_MERGE_WORKSPACE');
    const brake = feature('guided_brake');
    fails(() => e.run('integrator', (c) => integ.previewMerge(c, { workspaceId: 'x89-project', featureIds: [brake.id] })), 'SOURCE_NOT_ALLOWED');

    const plan = e.run('integrator', (c) => integ.previewMerge(c, { workspaceId: 'x89-project', featureIds: [steering.id] }));
    const preview = e.getState().mergePlans[plan]!;
    assert.equal(preview.status, 'READY');
    assert.equal(e.getState().releases[preview.targetReleaseId!]!.dclVersion, '1.0.0');
    // Three-way onto the target: the changed window and the new policy both arrive.
    assert.equal(preview.merged.steering!.policies['chassis.steering.angle_jump']!.postSeconds, 15);
    assert.ok(preview.merged.steering!.policies['chassis.steering.return_rate']);
    fails(() => e.run('integrator', (c) => integ.freezeCandidate(c, plan, { label: 'X89-C2' })), 'PROCESSING_NOT_CONFIRMED');
    fails(() => e.run('integrator', (c) => integ.confirmProcessing(c, plan, { note: '' })), 'FORBIDDEN');
    e.run('dcl', (c) => integ.confirmProcessing(c, plan, { note: '处理集合确认' }));
    fails(() => e.run('dcl', (c) => integ.confirmProcessing(c, plan, { note: '' })), 'ALREADY_CONFIRMED');

    const cand = e.run('integrator', (c) => integ.freezeCandidate(c, plan, { label: 'X89-C2' }));
    let s = e.getState();
    const candidate = s.candidates[cand]!;
    assert.equal(s.features[steering.id]!.stage, 'INTEGRATED');
    assert.equal(s.mergePlans[plan]!.status, 'FROZEN');
    assert.equal(candidate.testWorkspaceId, 'x89-integration');
    assert.equal(candidate.groups.steering, steering.headCommitId, 'unchanged content reuses the source commit');
    assert.equal(s.resolvedConfigs[candidate.resolvedConfigId]!.kind, 'CANDIDATE');
    assert.deepEqual(v.candidateTestStatus(s, candidate), [], 'tests of a candidate start from zero');

    // Candidates only go to the integration workspace's testing vehicle groups.
    fails(() => e.run('integration_tester', (c) => v.dispatchCandidate(c, cand, { vehicleGroupIds: [vehicleGroup('制动研发车组')] })), 'DISPATCH_BLOCKED');
    const vg = vehicleGroup('X89 集成测试车组');
    const d = e.run('integration_tester', (c) => v.dispatchCandidate(c, cand, { vehicleGroupIds: [vg] }));
    assert.equal(e.getState().candidates[cand]!.status, 'TESTING');
    fails(() => e.run('integration_tester', (c) => v.recordCandidateTest(c, cand, { resourceId: 'SIM-101', result: 'PASS', summary: 'x' })), 'NOT_APPLIED');
    for (const r of ['SIM-101', 'VEH-031']) e.run(null, (c) => sendReceipt(c, d, r, 'APPLIED'));
    fails(() => e.run('integration_tester', (c) => v.recordCandidateTest(c, cand, { resourceId: 'VEH-031', result: 'PASS', summary: 'x' })), 'SIMULATION_FIRST');
    fails(() => e.run('integrator', (c) => v.recordCandidateTest(c, cand, { resourceId: 'SIM-101', result: 'PASS', summary: 'x' })), 'FORBIDDEN');
    e.run('integration_tester', (c) => v.recordCandidateTest(c, cand, { resourceId: 'SIM-101', result: 'PASS', summary: '整车仿真回归' }));
    fails(() => e.run('integration_tester', (c) => v.verifyCandidate(c, cand)), 'VERIFY_BLOCKED');
    e.run('integration_tester', (c) => v.recordCandidateTest(c, cand, { resourceId: 'VEH-031', result: 'PASS', summary: '整车实车回归' }));
    e.run('integration_tester', (c) => v.verifyCandidate(c, cand));
    s = e.getState();
    assert.equal(s.candidates[cand]!.status, 'VERIFIED');
    assert.equal(s.candidates[cand]!.verifiedBy, 'integration_tester');
    assert.equal(s.resources['VEH-031']!.appliedConfigId, candidate.resolvedConfigId);
  });

  test('a merged policy is checked again: windows from two sources may add up past the limit', () => {
    const { e, feature, vehicleGroup } = setup();
    const returnRate = feature('steering_return_rate'); // angle_jump: 5 s before, 15 s after
    const wider = e.run('steering', (c) => config.createFeature(c, { workspaceId: 'team-steering', groupId: 'steering', name: 'angle_lead_in', description: '' }));
    const eps = Object.keys(e.getState().features[wider]!.draft.files)[0]!;
    e.run('steering', (c) =>
      config.putPolicy(c, wider, 'chassis.steering.angle_jump', { name: '转角突变', trigger: 'steering_angle_rate > 300 AND vehicle_speed > 20', captures: [eps], preSeconds: 110, postSeconds: 10 }),
    );
    const head = e.run('steering', (c) => config.submitFeature(c, wider, { message: '更长的事前窗口' })).commitId;
    const d = e.run('steering_tester', (c) => v.dispatchFeature(c, wider, { commitId: head, vehicleGroupIds: [vehicleGroup('转向研发车组')] }));
    for (const r of ['SIM-022', 'VEH-003']) e.run(null, (c) => sendReceipt(c, d, r, 'APPLIED'));
    for (const r of ['SIM-022', 'VEH-003']) e.run('steering_tester', (c) => v.recordFeatureTest(c, wider, { commitId: head, resourceId: r, result: 'PASS', summary: 'ok' }));
    e.run('steering_tester', (c) => v.verifyFeature(c, wider));

    // Each Feature is valid alone (120 s and 20 s); merged field by field the window is 125 s.
    const plan = e.run('integrator', (c) => integ.previewMerge(c, { workspaceId: 'x89-project', featureIds: [returnRate.id, wider] }));
    const p = e.getState().mergePlans[plan]!;
    assert.deepEqual(p.conflicts, []);
    assert.equal(p.status, 'BLOCKED');
    assert.deepEqual(p.issues, [
      'chassis.steering: policy chassis.steering.angle_jump has a merged capture window of 125 s (110 s before + 15 s after the trigger), over the 120 s limit',
    ]);
    fails(() => e.run('dcl', (c) => integ.confirmProcessing(c, plan, { note: '' })), 'PLAN_NOT_READY');
    fails(() => e.run('integrator', (c) => integ.freezeCandidate(c, plan, { label: 'X89-C2' })), 'PLAN_NOT_READY');
    const alone = e.run('integrator', (c) => integ.previewMerge(c, { workspaceId: 'x89-project', featureIds: [wider] }));
    assert.equal(e.getState().mergePlans[alone]!.status, 'READY');
  });

  test('conflicting sources block the preview; a changed source invalidates it; cancel restores Verified', () => {
    const { e, feature, vehicleGroup } = setup();
    const vg = vehicleGroup('制动研发车组');
    const brake = feature('guided_brake');
    verifyBrake(e, brake.id, vg);
    // A second brake Feature defines the same policy id differently.
    const abs = e.run('business', (c) => config.createFeature(c, { workspaceId: 'team-brake', groupId: 'brake', name: 'abs_events', description: '' }));
    const absKey = e.run('business', (c) => config.addFile(c, abs, { source: { unit: 'ADC', directory: '/var/log/brake', pattern: 'abs_trace.pb' }, name: 'ABS 轨迹', purpose: 'ABS 介入分析' }));
    e.run('business', (c) =>
      config.putPolicy(c, abs, 'chassis.brake.hard_braking', { name: '急刹车（ABS）', trigger: 'abs.active', captures: [absKey], preSeconds: 5, postSeconds: 5 }),
    );
    e.run('business', (c) => config.submitFeature(c, abs, { message: 'abs' }));
    verifyBrake(e, abs, vg);

    const plan = e.run('integrator', (c) => integ.previewMerge(c, { workspaceId: 'x89-project', featureIds: [brake.id, abs] }));
    const p = e.getState().mergePlans[plan]!;
    assert.equal(p.status, 'CONFLICT');
    assert.deepEqual(
      p.conflicts.map((c) => [c.section, c.key, c.field, c.owner, c.featureIds]),
      [['policies', 'chassis.brake.hard_braking', '*', 'BUSINESS', [brake.id, abs]]],
    );
    fails(() => e.run('dcl', (c) => integ.confirmProcessing(c, plan, { note: '' })), 'PLAN_NOT_READY');

    // Without the conflicting source the set is ready; a new preview supersedes the old one.
    const steering = feature('steering_return_rate');
    const plan2 = e.run('integrator', (c) => integ.previewMerge(c, { workspaceId: 'x89-project', featureIds: [brake.id, steering.id] }));
    assert.equal(e.getState().mergePlans[plan]!.status, 'SUPERSEDED');
    assert.equal(e.getState().mergePlans[plan2]!.status, 'READY');
    assert.deepEqual(Object.keys(e.getState().mergePlans[plan2]!.merged).sort(), ['brake', 'steering']);
    e.run('dcl', (c) => integ.confirmProcessing(c, plan2, { note: '' }));
    // Editing the draft keeps the verified commit collectible; a new commit makes the preview stale.
    e.run('steering', (c) => config.updateFile(c, steering.id, Object.keys(steering.draft.files)[0]!, { purpose: '转角突变与路面激励分析' }));
    assert.ok(integ.verifiedSources(e.getState(), 'x89-project').some((f) => f.id === steering.id));
    e.run('steering', (c) => config.submitFeature(c, steering.id, { message: '用途补充' }));
    fails(() => e.run('integrator', (c) => integ.freezeCandidate(c, plan2, { label: 'X89-C2' })), 'SOURCE_CHANGED');

    const plan3 = e.run('integrator', (c) => integ.previewMerge(c, { workspaceId: 'x89-project', featureIds: [brake.id] }));
    e.run('dcl', (c) => integ.confirmProcessing(c, plan3, { note: '' }));
    const cand = e.run('integrator', (c) => integ.freezeCandidate(c, plan3, { label: 'X89-C2' }));
    assert.equal(e.getState().features[brake.id]!.stage, 'INTEGRATED');
    const plan4 = e.run('integrator', (c) => integ.previewMerge(c, { workspaceId: 'x89-project', featureIds: [abs] }));
    e.run('dcl', (c) => integ.confirmProcessing(c, plan4, { note: '' }));
    fails(() => e.run('integrator', (c) => integ.freezeCandidate(c, plan4, { label: 'X89-C3' })), 'CANDIDATE_OPEN');
    e.run('integrator', (c) => integ.cancelCandidate(c, cand, { reason: '重新组合' }));
    assert.equal(e.getState().candidates[cand]!.status, 'CANCELLED');
    assert.equal(e.getState().features[brake.id]!.stage, 'VERIFIED');
  });
});
