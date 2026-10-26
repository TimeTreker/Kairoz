// DCL 技术变更 (TC01–TC04, N01) on the demo installation: DCL publishes a lighter edge pipeline and
// delivers it through its own technical branch of the steering group: rebinding only, tested by
// the group's testers, merged, integration-tested and released like any Feature.

import { policyCost } from '../src/engine/budget.ts';
import * as config from '../src/engine/config.ts';
import { setTechnicalBinding } from '../src/engine/intake.ts';
import * as integ from '../src/engine/integration.ts';
import { createPipeline } from '../src/engine/processing.ts';
import * as rel from '../src/engine/release.ts';
import { demoState } from '../src/engine/seed.ts';
import { commitSnapshot } from '../src/engine/snapshots.ts';
import type { State } from '../src/engine/types.ts';
import * as v from '../src/engine/validation.ts';
import { answerAll, verifyFeatureOn } from './helpers.ts';
import type { SceneSpec, World } from './world.ts';

export const start = (): State => demoState();

const ANGLE = 'chassis.steering.angle_jump';
const group = (w: World, name: string) => Object.values(w.s.vehicleGroups).find((g) => g.name === name)!.id;
const set = (w: World, version: string) => Object.values(w.s.releases).find((r) => r.dclVersion === version)!;

export const scenes: Record<string, SceneSpec> = {
  TC01: {
    run: (w) => {
      w.ref.edge = w.as('dcl', (c) => createPipeline(c, { code: 'default-edge-bin-log', side: 'EDGE', name: '二进制日志车端处理（精简）', formats: ['binary'], steps: ['Receive', 'Compress', 'Encrypt'] }));
      w.eq(w.ref.edge, 'default-edge-bin-log@2', 'a new immutable version; files bound to @1 keep it');
      const id = w.as('dcl', (c) => config.createTechnicalChange(c, { workspaceId: 'team-steering', groupId: 'steering', name: 'bin_log_edge_v2', description: '二进制日志改用精简车端处理' }));
      const f = w.s.features[id]!;
      w.eq([f.kind, f.baseReleaseId], ['TECHNICAL', set(w, '1.0.0').id], 'a technical branch of the steering group on the mainline');
      w.ref.change = id;
    },
  },
  TC02: {
    needs: ['TC01'],
    run: (w) => {
      const id = w.ref.change!;
      const [dataKey, spec] = Object.entries(w.s.features[id]!.draft.files)[0]!;
      w.fails('TECHNICAL_BINDINGS_ONLY', () => w.as('dcl', (c) => config.putPolicy(c, id, ANGLE, { ...w.s.features[id]!.draft.policies[ANGLE]!, postSeconds: 20 })));
      w.as('dcl', (c) => setTechnicalBinding(c, id, dataKey, { format: spec.format, schema: spec.schema, edgePipelineId: w.ref.edge!, cloudPipelineId: spec.cloudPipelineId }));
      const r = w.as('dcl', (c) => config.submitFeature(c, id, { message: '精简车端处理' }));
      w.eq(r.stage, 'DCL_READY', 'DCL submits its own change; nothing needs review');
      const before = policyCost(w.s, commitSnapshot(w.s, set(w, '1.0.0').groups.steering!), ANGLE);
      const after = policyCost(w.s, commitSnapshot(w.s, r.commitId), ANGLE);
      w.eq([before.cpuSec, after.cpuSec], [0.75, 0.45], 'three edge steps instead of five: less CPU per capture');
    },
  },
  TC03: {
    needs: ['TC02'],
    run: (w) => {
      verifyFeatureOn(w, 'steering_tester', w.ref.change!, [group(w, '转向研发车组')]);
      w.eq(w.s.features[w.ref.change!]!.stage, 'VERIFIED', 'the steering testers verified it, simulation first');
    },
  },
  TC04: {
    needs: ['TC03'],
    run: (w) => {
      const plan = w.as('integrator', (c) => integ.previewMerge(c, { workspaceId: 'x89-project', featureIds: [w.ref.change!] }));
      w.as('dcl', (c) => integ.confirmProcessing(c, plan, { note: '精简车端处理确认' }));
      const cand = w.as('integrator', (c) => integ.freezeCandidate(c, plan, { label: 'X89-C2' }));
      answerAll(w, w.as('integration_tester', (c) => v.dispatchCandidate(c, cand, { vehicleGroupIds: [group(w, 'X89 集成测试车组')] })));
      for (const r of ['SIM-101', 'VEH-031']) w.as('integration_tester', (c) => v.recordCandidateTest(c, cand, { resourceId: r, result: 'PASS', summary: '采集回归通过' }));
      w.as('integration_tester', (c) => v.verifyCandidate(c, cand));
      const id = w.as('release', (c) => rel.promoteCandidate(c, cand, { dclVersion: '1.0.1', vehicleIntegrationVersions: ['1.0'], notes: '精简二进制日志车端处理' }));
      const diff = rel.releaseDiff(w.s, set(w, '1.0.0').id, id);
      w.eq([diff.policies.length, diff.groups.find((g) => g.groupId === 'steering')!.diff.files.changed.map((c) => c.fields)], [0, [['edgePipelineId']]], 'only the binding changed');
      w.eq(w.s.features[w.ref.change!]!.stage, 'ARCHIVED', 'delivered');
    },
  },
  N01: {
    needs: ['TC01'],
    forkAfter: 'TC01',
    run: (w) => {
      w.denied('steering', (c) => config.createTechnicalChange(c, { workspaceId: 'team-steering', groupId: 'steering', name: 'steering_tech' }));
      w.denied('steering', (c) => config.submitFeature(c, w.ref.change!, { message: '越权' }));
      w.denied('integrator', (c) => config.createTechnicalChange(c, { workspaceId: 'team-steering', groupId: 'steering', name: 'steering_tech' }));
      w.fails('NO_CHANGES', () => w.as('dcl', (c) => config.submitFeature(c, w.ref.change!, { message: '无变化' })));
    },
  },
};
