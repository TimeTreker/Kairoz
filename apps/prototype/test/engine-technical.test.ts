import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { verifyFeatureOn } from '../acceptance/helpers.ts';
import { World } from '../acceptance/world.ts';
import { policyCost } from '../src/engine/budget.ts';
import * as config from '../src/engine/config.ts';
import { setBinding, setTechnicalBinding } from '../src/engine/intake.ts';
import * as integ from '../src/engine/integration.ts';
import { createPipeline } from '../src/engine/processing.ts';
import * as rel from '../src/engine/release.ts';
import { demoState } from '../src/engine/seed.ts';
import { commitSnapshot } from '../src/engine/snapshots.ts';
import { ON_10, groupId, set, testCandidate } from './patch-fixtures.ts';

const ANGLE = 'chassis.steering.angle_jump';

/** DCL publishes a lighter edge pipeline for binary logs and opens a technical change of the steering group. */
function lighterEdge(w: World): { id: string; dataKey: string; edge: string } {
  const edge = w.as('dcl', (c) => createPipeline(c, { code: 'default-edge-bin-log', side: 'EDGE', name: '二进制日志车端处理（精简）', formats: ['binary'], steps: ['Receive', 'Compress', 'Encrypt'] }));
  const id = w.as('dcl', (c) => config.createTechnicalChange(c, { workspaceId: 'team-steering', groupId: 'steering', name: 'bin_log_edge_v2', description: '二进制日志改用精简车端处理' }));
  const dataKey = Object.keys(w.s.features[id]!.draft.files)[0]!;
  return { id, dataKey, edge };
}

describe('DCL technical changes', () => {
  test('DCL opens a technical branch that only rebinds processing; business cannot edit it', () => {
    const w = new World(demoState());
    w.denied('steering', (c) => config.createTechnicalChange(c, { workspaceId: 'team-steering', groupId: 'steering', name: 'x_tech' }));
    const { id, dataKey, edge } = lighterEdge(w);
    const f = w.s.features[id]!;
    assert.deepEqual([f.kind, f.stage, f.baseReleaseId], ['TECHNICAL', 'DRAFT', set(w, '1.0.0').id]);
    assert.deepEqual(f.draft, commitSnapshot(w.s, set(w, '1.0.0').groups.steering!), 'it starts from the base');
    // Business authors never edit it; DCL never changes files or policies in it.
    w.denied('steering', (c) => config.putPolicy(c, id, ANGLE, { ...f.draft.policies[ANGLE]!, postSeconds: 20 }));
    w.fails('TECHNICAL_BINDINGS_ONLY', () => w.as('dcl', (c) => config.putPolicy(c, id, ANGLE, { ...f.draft.policies[ANGLE]!, postSeconds: 20 })));
    w.fails('NOT_IN_INTAKE', () => w.as('dcl', (c) => setBinding(c, id, dataKey, { format: 'binary', schema: 'opaque-bin-log@1', edgePipelineId: edge, cloudPipelineId: 'default-cloud-bin-log@1', reason: 'x' })));
    const business = Object.values(w.s.features).find((x) => x.name === 'steering_return_rate')!;
    w.fails('NOT_TECHNICAL', () => w.as('dcl', (c) => setTechnicalBinding(c, business.id, dataKey, { format: 'binary', schema: 'opaque-bin-log@1', edgePipelineId: edge, cloudPipelineId: 'default-cloud-bin-log@1' })));
    w.fails('NO_CHANGES', () => w.as('dcl', (c) => config.submitFeature(c, id, { message: '无变化' })));

    const spec = w.s.features[id]!.draft.files[dataKey]!;
    w.as('dcl', (c) => setTechnicalBinding(c, id, dataKey, { format: spec.format, schema: spec.schema, edgePipelineId: edge, cloudPipelineId: spec.cloudPipelineId }));
    w.denied('steering', (c) => config.submitFeature(c, id, { message: 'x' }));
    const r = w.as('dcl', (c) => config.submitFeature(c, id, { message: '精简车端处理' }));
    assert.equal(r.stage, 'DCL_READY', 'no sensitive file changed review: DCL Ready at once');
    assert.equal(w.s.feedback.filter((x) => x.featureId === id).length, 0, 'DCL’s own change sends no feedback');
    // Three edge steps instead of five: a capture costs the vehicle less CPU.
    const before = policyCost(w.s, commitSnapshot(w.s, set(w, '1.0.0').groups.steering!), ANGLE);
    const after = policyCost(w.s, commitSnapshot(w.s, r.commitId), ANGLE);
    assert.ok(after.cpuSec < before.cpuSec);
  });

  test('the group’s testers verify it, integration merges it, and release publishes it', () => {
    const w = new World(demoState());
    const { id, dataKey, edge } = lighterEdge(w);
    const spec = w.s.features[id]!.draft.files[dataKey]!;
    w.as('dcl', (c) => setTechnicalBinding(c, id, dataKey, { format: spec.format, schema: spec.schema, edgePipelineId: edge, cloudPipelineId: spec.cloudPipelineId }));
    w.as('dcl', (c) => config.submitFeature(c, id, { message: '精简车端处理' }));
    verifyFeatureOn(w, 'steering_tester', id, [groupId(w, '转向研发车组')]);
    assert.equal(w.s.features[id]!.stage, 'VERIFIED');
    const plan = w.as('integrator', (c) => integ.previewMerge(c, { workspaceId: 'x89-project', featureIds: [id] }));
    assert.equal(w.s.mergePlans[plan]!.merged.steering!.files[dataKey]!.edgePipelineId, edge);
    w.as('dcl', (c) => integ.confirmProcessing(c, plan, { note: '精简处理确认' }));
    const cand = w.as('integrator', (c) => integ.freezeCandidate(c, plan, { label: 'X89-C2' }));
    testCandidate(w, cand, ON_10);
    const release = w.as('release', (c) => rel.promoteCandidate(c, cand, { dclVersion: '1.0.1', vehicleIntegrationVersions: ['1.0'] }));
    const diff = rel.releaseDiff(w.s, set(w, '1.0.0').id, release);
    assert.deepEqual(diff.policies, [], 'no policy changed');
    assert.deepEqual(diff.groups.find((g) => g.groupId === 'steering')!.diff.files.changed.map((c) => c.fields), [['edgePipelineId']]);
    assert.equal(w.s.features[id]!.stage, 'ARCHIVED');
  });
});
