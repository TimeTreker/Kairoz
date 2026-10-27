import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { DEFAULT_BUDGET } from '../src/domain/budget.ts';
import { DomainError } from '../src/domain/errors.ts';
import { setModelBudget } from '../src/engine/budget.ts';
import * as config from '../src/engine/config.ts';
import { Engine } from '../src/engine/engine.ts';
import * as integ from '../src/engine/integration.ts';
import * as org from '../src/engine/org.ts';
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

const featureId = (e: Engine, name: string) => Object.values(e.getState().features).find((f) => f.name === name)!.id;
const ANGLE = 'chassis.steering.angle_jump';

describe('gates the design asks for', () => {
  test('a policy whose single capture exceeds the model budget stops at submission', () => {
    const e = new Engine(demoState());
    e.run('dcl', (c) => setModelBudget(c, 'X89', { ...DEFAULT_BUDGET, networkMbPerHour: 5 }));
    const id = e.run('steering', (c) => config.createFeature(c, { workspaceId: 'team-steering', groupId: 'steering', name: 'angle_jump_long' }));
    const p = e.getState().features[id]!.draft.policies[ANGLE]!;
    e.run('steering', (c) => config.putPolicy(c, id, ANGLE, { ...p, postSeconds: 110 }));
    const err = fails(() => e.run('steering', (c) => config.submitFeature(c, id, {})), 'SUBMIT_BLOCKED');
    const issues = (err.details as { issues: { key: string; problems: string[] }[] }).issues;
    assert.deepEqual(issues.map((i) => i.key), [ANGLE]);
    assert.match(issues[0]!.problems[0]!, /^one capture exceeds the X89 budget \(upload 23 MB > 5 MB per hour\)/);
  });

  test('a source in an unfinished integration stays; a source change keeps what it was before', () => {
    const e = new Engine(demoState());
    const plan = e.run('integrator', (c) => integ.previewMerge(c, { workspaceId: 'x89-project', featureIds: [featureId(e, 'steering_return_rate')] }));
    const sources = e.getState().workspaces['x89-project']!.sourceWorkspaceIds;
    const err = fails(() => e.run('admin', (c) => org.updateWorkspace(c, 'x89-project', { sourceWorkspaceIds: sources.filter((w) => w !== 'team-steering') })), 'SOURCE_IN_USE');
    assert.deepEqual((err.details as { issues: string[] }).issues, [`转向团队工作区: merge preview ${plan} is open`]);
    // Without one in flight, the change goes through and is recorded.
    e.run('admin', (c) => org.updateWorkspace(c, 'x89-project', { sourceWorkspaceIds: sources.filter((w) => w !== 'x89-cdc-integration') }));
    const last = e.getState().lifecycleEvents.at(-1)!;
    assert.equal(last.kind, 'SOURCES_CHANGED');
    assert.ok(last.before!.includes('CDC 域集成') && !last.after!.includes('CDC 域集成'), `${last.before} → ${last.after}`);
  });

  test('renaming and moving an org unit keep the name and path before', () => {
    const e = new Engine(demoState());
    const unit = Object.values(e.getState().orgUnits).find((u) => u.source !== 'DIRECTORY' && u.parentId)!;
    e.run('admin', (c) => org.updateOrgUnit(c, unit.id, { name: `${unit.name}（新）` }));
    const renamed = e.getState().lifecycleEvents.at(-1)!;
    assert.deepEqual([renamed.kind, renamed.before, renamed.after], ['RENAMED', unit.name, `${unit.name}（新）`]);
  });

  test('vehicle resources free one vehicle from another team’s dispatch; the rest goes on', () => {
    const e = new Engine(demoState());
    const f = Object.values(e.getState().features).find((x) => x.name === 'guided_brake')!;
    const group = Object.values(e.getState().vehicleGroups).find((g) => g.name === '制动研发车组')!.id;
    const [d] = e.run('brake_tester', (c) => v.dispatchFeature(c, f.id, { commitId: f.headCommitId!, vehicleGroupIds: [group] }));
    fails(() => e.run('business', (c) => v.releaseVehicle(c, 'VEH-001', '转测试环境')), 'FORBIDDEN');
    fails(() => e.run('resource', (c) => v.releaseVehicle(c, 'VEH-001', ' ')), 'REASON_REQUIRED');
    e.run('resource', (c) => v.releaseVehicle(c, 'VEH-001', '转测试环境'));
    const dep = e.getState().deployments[d!]!;
    assert.deepEqual([dep.status, dep.targets.map((t) => [t.resourceId, t.status])], ['PENDING', [['SIM-021', 'PENDING'], ['VEH-001', 'CANCELLED']]]);
  });

  test('an earlier commit is dispatched and tested on its own; the head’s verification is untouched', () => {
    const e = new Engine(demoState());
    const f0 = Object.values(e.getState().features).find((x) => x.name === 'brake_monitor')!;
    const r1 = f0.headCommitId!;
    const policy = Object.keys(f0.draft.policies)[0]!;
    e.run('business', (c) => config.putPolicy(c, f0.id, policy, { ...f0.draft.policies[policy]!, postSeconds: f0.draft.policies[policy]!.postSeconds + 5 }));
    e.run('business', (c) => config.submitFeature(c, f0.id, { message: '延长录制' }));
    const group = Object.values(e.getState().vehicleGroups).find((g) => g.name === '制动研发车组')!.id;
    const [d] = e.run('brake_tester', (c) => v.dispatchFeature(c, f0.id, { commitId: r1, vehicleGroupIds: [group] }));
    assert.equal(e.getState().features[f0.id]!.stage, 'DCL_READY', 'a regression dispatch does not move the Feature');
    for (const r of ['SIM-021', 'VEH-001']) e.run(null, (c) => sendReceipt(c, d!, r, 'APPLIED'));
    e.run('brake_tester', (c) => v.recordFeatureTest(c, f0.id, { commitId: r1, resourceId: 'SIM-021', result: 'PASS', summary: '回归 r001' }));
    const s = e.getState();
    assert.deepEqual(s.testRuns.filter((x) => x.subjectId === f0.id && x.versionId === r1 && x.summary === '回归 r001').map((x) => x.resourceId), ['SIM-021']);
    assert.ok(v.verifyBlockers(s, s.features[f0.id]!).includes('no vehicles were dispatched for this commit'), 'the head still needs its own tests');
    // Approvals cover the head only.
    fails(() => e.run('brake_tester', (c) => v.requestTeamTest(c, f0.id, { commitId: r1, vehicleGroupIds: [group], goal: '回归' })), 'STALE_COMMIT');
  });
});
