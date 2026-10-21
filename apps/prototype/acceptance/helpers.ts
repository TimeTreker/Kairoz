// Steps several scenes share: dispatching a fixed version and recording results the way a tester
// does it (simulation first, then physical), with the simulator answering for the vehicles.

import * as config from '../src/engine/config.ts';
import { membersOf } from '../src/engine/fleet.ts';
import { sendReceipt } from '../src/engine/simulator.ts';
import * as v from '../src/engine/validation.ts';
import type { World } from './world.ts';

export const CONTROLS = {
  purposeConfirmed: true,
  scopeConfirmed: true,
  retentionConfirmed: true,
  accessControl: '仅制动组与 DCL 可读',
  uploadControl: '加密上传，仅触发窗口',
  processingControl: '云端外部脱敏后入库',
};

/** The simulator confirms (or fails) every pending target of a deployment. */
export function answerAll(w: World, deploymentId: string, result: 'APPLIED' | 'FAILED' = 'APPLIED'): void {
  for (const t of w.s.deployments[deploymentId]!.targets) {
    if (t.status === 'PENDING') w.sys((c) => sendReceipt(c, deploymentId, t.resourceId, result));
  }
}

/**
 * Dispatches the Feature's head commit to vehicle groups and lets every vehicle apply it. Groups
 * that need approval go through a team test request decided by the workspace admin.
 */
export function dispatchApplied(w: World, tester: string, featureId: string, vehicleGroupIds: string[]): string {
  const head = w.s.features[featureId]!.headCommitId!;
  const gated = vehicleGroupIds.some((g) => w.s.vehicleGroups[g]!.requiresApproval);
  let d: string;
  if (gated) {
    const req = w.as(tester, (c) => v.requestTeamTest(c, featureId, { commitId: head, vehicleGroupIds, goal: '团队验证' }));
    w.as('workspace_manager', (c) => v.decideTestRequest(c, req, { decision: 'APPROVED', note: '同意' }));
    d = w.as(tester, (c) => v.executeTestRequest(c, req));
  } else {
    d = w.as(tester, (c) => v.dispatchFeature(c, featureId, { commitId: head, vehicleGroupIds }));
  }
  answerAll(w, d);
  return d;
}

/** Records PASS on the given vehicles in order (simulation first). */
export function recordPasses(w: World, tester: string, featureId: string, resourceIds: string[], summary = 'Mock 场景验证通过'): void {
  const head = w.s.features[featureId]!.headCommitId!;
  for (const resourceId of resourceIds) w.as(tester, (c) => v.recordFeatureTest(c, featureId, { commitId: head, resourceId, result: 'PASS', summary }));
}

/** The whole business test of a Feature: dispatch to each group, apply, record, verify. */
export function verifyFeatureOn(w: World, tester: string, featureId: string, vehicleGroupIds: string[]): void {
  for (const g of vehicleGroupIds) dispatchApplied(w, tester, featureId, [g]);
  const vehicles = vehicleGroupIds.flatMap((g) => membersOf(w.s, g));
  const sims = vehicles.filter((r) => w.s.resources[r]!.type === 'SIMULATION');
  const physical = vehicles.filter((r) => w.s.resources[r]!.type === 'PHYSICAL');
  recordPasses(w, tester, featureId, [...sims, ...physical]);
  w.as(tester, (c) => v.verifyFeature(c, featureId));
}

/** A business Feature with one ordinary file and one policy capturing it, submitted. */
export function simpleFeature(
  w: World,
  author: string,
  input: { workspaceId: string; groupId: string; name: string; unit: string; directory: string; pattern: string; fileName: string; policyId: string; policyName: string; trigger: string; pre?: number; post?: number },
): { featureId: string; dataKey: string; commitId: string } {
  const featureId = w.as(author, (c) => config.createFeature(c, { workspaceId: input.workspaceId, groupId: input.groupId, name: input.name }));
  const dataKey = w.as(author, (c) =>
    config.addFile(c, featureId, { source: { unit: input.unit, directory: input.directory, pattern: input.pattern }, name: input.fileName, purpose: `${input.policyName}诊断` }),
  );
  w.as(author, (c) =>
    config.putPolicy(c, featureId, input.policyId, { name: input.policyName, trigger: input.trigger, captures: [dataKey], preSeconds: input.pre ?? 10, postSeconds: input.post ?? 20 }),
  );
  const commitId = w.as(author, (c) => config.submitFeature(c, featureId, { message: input.name })).commitId;
  return { featureId, dataKey, commitId };
}
