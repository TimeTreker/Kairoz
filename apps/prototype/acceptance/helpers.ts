// Steps several scenes share: dispatching a fixed version and recording results the way a tester
// does it (simulation first, then physical), with the simulator answering for the vehicles.

import * as config from '../src/engine/config.ts';
import type { Engine } from '../src/engine/engine.ts';
import { membersOf, setSoftwareManifest } from '../src/engine/fleet.ts';
import { registerDeviceKey } from '../src/engine/client-report.ts';
import { publishPlmVersion, syncPlmIfChanged } from '../src/engine/plm.ts';
import { devicePublicKey, provisionDevice, reportNow, sendReceipt, simulateSoftwareOta } from '../src/engine/simulator.ts';
import { addTspVehicle, syncTspIfChanged } from '../src/engine/tsp.ts';
import type { HardwareItem, PlmVersion } from '../src/engine/types.ts';
import * as v from '../src/engine/validation.ts';
import type { World } from './world.ts';

/**
 * PLM publishes a whole-vehicle version (with the DCL part of a working name when `partOf` names one),
 * the platform syncs it, and vehicle resources add the mock manifest when one is given.
 */
export function plmPublish(e: Engine, vehicleModelId: string, version: string, o: { manifest?: { signals: string[]; sources: { unit: string; directory: string }[] } | null; partOf?: string; modules?: PlmVersion['modules'] } = {}): void {
  const part = o.partOf ? e.getState().softwareVersions[`${vehicleModelId}::${o.partOf}`]?.dclPart : null;
  if (o.partOf && !part) throw new Error(`no DCL part was handed over for ${vehicleModelId} ${o.partOf}`);
  e.run(null, (c) => publishPlmVersion(c, { vehicleModelId, version, modules: o.modules, dclPart: part ? { clientVersion: part.clientVersion, setVersion: part.setVersion, digest: part.digest } : null }));
  e.run(null, (c) => syncPlmIfChanged(c));
  if (o.manifest) e.run('resource', (c) => setSoftwareManifest(c, { vehicleModelId, version, manifest: o.manifest! }));
}

/**
 * The vehicle is flashed with `version` (the simulator's software OTA; `failed` controllers keep their
 * software) and says so in its next signed report, and TSP's record follows; vehicle resources
 * register its device key first when it has none.
 */
export function carRuns(e: Engine, resourceId: string, version: string | null, failed: string[] = []): void {
  if (!e.getState().resources[resourceId]!.deviceKey) {
    const key = e.run(null, (c) => (provisionDevice(c, resourceId), devicePublicKey(c.s, resourceId)!));
    e.run('resource', (c) => registerDeviceKey(c, resourceId, key));
  }
  e.run(null, (c) => simulateSoftwareOta(c, resourceId, version, failed));
  e.run(null, (c) => reportNow(c, resourceId));
  // TSP records the target as the version the car should run.
  e.run(null, (c) => syncTspIfChanged(c));
}

/** TSP knows the car (simulated), so vehicle resources can register it. */
export function tspCar(e: Engine, vin: string, vehicleModelId: string, o: { expectedVersion?: string | null; plate?: string; hardware?: HardwareItem[] } = {}): void {
  e.run(null, (c) => addTspVehicle(c, { vin, vehicleModelId, licensePlate: o.plate ?? null, hardware: o.hardware ?? [], expectedVersion: o.expectedVersion ?? null }));
}

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
export function dispatchApplied(w: World, tester: string, featureId: string, vehicleGroupIds: string[]): string[] {
  const head = w.s.features[featureId]!.headCommitId!;
  const gated = vehicleGroupIds.some((g) => w.s.vehicleGroups[g]!.requiresApproval);
  let ds: string[];
  if (gated) {
    const req = w.as(tester, (c) => v.requestTeamTest(c, featureId, { commitId: head, vehicleGroupIds, goal: '团队验证' }));
    w.as('workspace_manager', (c) => v.decideTestRequest(c, req, { decision: 'APPROVED', note: '同意' }));
    ds = w.as(tester, (c) => v.executeTestRequest(c, req));
  } else {
    ds = w.as(tester, (c) => v.dispatchFeature(c, featureId, { commitId: head, vehicleGroupIds }));
  }
  for (const d of ds) answerAll(w, d);
  return ds;
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
