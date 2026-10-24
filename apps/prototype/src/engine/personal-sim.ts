// Personal simulation (个人研发仿真): a developer's or tester's own simulation instance in a
// workspace. It runs a Feature's uncommitted draft on the base its image's software takes; only an
// APPLIED receipt makes it run. What it shows belongs to the owner alone: trial captures and
// self-tests never count as team tests, never reach data query and gate nothing.

import type { Draft } from 'immer';
import { digestOf } from '../domain/canonical.ts';
import { normalizeConfig, sameConfig } from '../domain/config.ts';
import type { GroupConfig } from '../domain/config.ts';
import { conflict, notFound, rule } from '../domain/errors.ts';
import { newId } from '../domain/ids.ts';
import type { Env } from '../domain/vocabulary.ts';
import { reviewItems } from './approvals.ts';
import { EDITABLE_STAGES, getFeature, submitIssues } from './config.ts';
import type { Ctx } from './engine.ts';
import { sizeOf } from './events.ts';
import { assertIdle, authorizePersonal, baseResource, getResource } from './fleet.ts';
import { getGroup, getWorkspace } from './org.ts';
import { commitSnapshot, resolveFiles } from './snapshots.ts';
import type { PersonalCapture, PersonalTest, Resource, State } from './types.ts';
import { baseTarget, resolveConfig } from './validation.ts';

/** Active (not released) personal simulations one person may hold in one workspace. */
export const PERSONAL_SIM_QUOTA = 3;

export function getPersonalSim(s: State, id: string): Resource {
  const r = getResource(s, id);
  if (!r.personal) throw rule('NOT_PERSONAL_SIMULATION', `${r.id} is not a personal simulation`);
  return r;
}

function ownSim(ctx: Ctx, id: string): Draft<Resource> {
  const r = getPersonalSim(ctx.s, id) as Draft<Resource>;
  authorizePersonal(ctx, r);
  if (r.status === 'RETIRED') throw rule('PERSONAL_SIM_RELEASED', `${r.id} was released`);
  return r;
}

/** A person's personal simulations in a workspace, released ones included (newest first). */
export function personalSimsOf(s: State, username: string, workspaceId: string): Resource[] {
  return Object.values(s.resources)
    .filter((r) => r.personal?.owner === username && r.homeWorkspaceId === workspaceId)
    .sort((a, b) => (a.status === b.status ? b.id.localeCompare(a.id) : a.status === 'RETIRED' ? 1 : -1));
}

export function activePersonalCount(s: State, username: string, workspaceId: string): number {
  return personalSimsOf(s, username, workspaceId).filter((r) => r.status !== 'RETIRED').length;
}

function nextPersonalId(s: State): string {
  for (let n = 1; ; n += 1) {
    const id = `SIM-P${String(n).padStart(3, '0')}`;
    if (!s.resources[id]) return id;
  }
}

/**
 * A business developer or tester creates their own simulation instance from an image of the
 * workspace's model, for drafts of one business group. The software comes from the image; an
 * image without a whole-vehicle version gives unknown software.
 */
export function createPersonalSim(ctx: Ctx, input: { workspaceId: string; groupId: string; imageId: string; displayName?: string; env?: Env }): string {
  const workspace = getWorkspace(ctx.s, input.workspaceId);
  const group = getGroup(ctx.s, input.groupId);
  ctx.allow('personalSim.use', { type: 'personalSim', workspaceId: workspace.id, groupId: group.id, scope: group.domain, env: 'development' });
  if (input.env && input.env !== 'development') throw rule('PERSONAL_DEVELOPMENT_ONLY', 'personal simulations run in the development environment only');
  if (!workspace.groupIds.includes(group.id)) throw rule('GROUP_NOT_IN_WORKSPACE', `group ${group.id} does not work in workspace ${workspace.id}`);
  const image = ctx.s.images[input.imageId];
  if (!image) throw notFound('image', input.imageId);
  if (image.derived) throw rule('IMAGE_NOT_IN_CATALOG', `${image.id} is a derived image of one simulation; choose a catalog image`);
  if (image.vehicleModelId !== workspace.vehicleModelId) throw rule('IMAGE_MODEL_MISMATCH', `image ${image.id} is for ${image.vehicleModelId}`);
  const owner = ctx.user().username;
  if (activePersonalCount(ctx.s, owner, workspace.id) >= PERSONAL_SIM_QUOTA) {
    throw rule('PERSONAL_QUOTA', `you already hold ${PERSONAL_SIM_QUOTA} personal simulations in this workspace; release one first`);
  }
  const id = nextPersonalId(ctx.s);
  const base = baseResource(ctx, { id, vehicleModelId: workspace.vehicleModelId, env: 'development', pool: group.domain, displayName: input.displayName });
  ctx.s.resources[id] = {
    ...base,
    type: 'SIMULATION',
    vin: null,
    uvid: id,
    licensePlate: null,
    integrationVersion: image.integrationVersion,
    integrationSource: `image ${image.id}`,
    softwareStatus: image.integrationVersion ? 'CONSISTENT' : 'UNKNOWN',
    instance: 'RUNNING',
    imageId: image.id,
    homeWorkspaceId: workspace.id,
    personal: { owner, groupId: group.id },
  };
  return id;
}

/** The pending configuration of a personal simulation, if any. */
export function personalPending(s: State, id: string): string | undefined {
  return Object.values(s.deployments).find((d) => d.kind === 'PERSONAL' && d.subjectId === id && d.status === 'PENDING')?.id;
}

/**
 * The owner sends a Feature's current draft to their personal simulation: the draft in place of its
 * business group, on the base the vehicle takes (an explicit base, the set in effect for its
 * software, or the initial configuration for unknown software). Sensitive files still need a
 * current DCL approval. Only the vehicle's receipt makes it run.
 */
export function configurePersonalSim(ctx: Ctx, id: string, input: { featureId: string; disabledPolicies?: string[]; baseReleaseId?: string | null }): string {
  const r = ownSim(ctx, id);
  const feature = getFeature(ctx.s, input.featureId);
  if (feature.workspaceId !== r.homeWorkspaceId || feature.groupId !== r.personal!.groupId) {
    throw rule('PERSONAL_GROUP_MISMATCH', `${r.id} runs drafts of ${r.personal!.groupId} in its own workspace`);
  }
  if (!EDITABLE_STAGES.includes(feature.stage)) throw rule('FEATURE_IMMUTABLE', `feature in stage ${feature.stage} has no draft to run`);
  if (r.instance !== 'RUNNING') throw rule('SIMULATION_STOPPED', `${r.id} is stopped; start it first`);
  assertIdle(ctx.s, r.id);
  const explicit = input.baseReleaseId ?? null;
  if (explicit) {
    const release = ctx.s.releases[explicit];
    if (!release) throw notFound('policy set', explicit);
    if (release.vehicleModelId !== r.vehicleModelId) throw rule('MODEL_MISMATCH', `policy set ${release.dclVersion} is for ${release.vehicleModelId}`);
  }
  const notSwitchable = (input.disabledPolicies ?? []).filter((p) => !ctx.s.policyOwners[p] || ctx.s.policyOwners[p] === feature.groupId);
  if (notSwitchable.length) throw rule('POLICY_NOT_SWITCHABLE', 'only policies of other business groups can be switched off', { issues: notSwitchable });
  const t = baseTarget(ctx.s, feature, explicit, r, input.disabledPolicies ?? []);
  if (t.problem) throw rule(t.conflict ? 'BASE_CONFLICT' : 'NO_BASE', t.problem);

  const group = getGroup(ctx.s, feature.groupId);
  const snapshot: GroupConfig = JSON.parse(JSON.stringify(normalizeConfig(feature.draft)));
  const issues = submitIssues(ctx.s, group, snapshot);
  if (issues.length) throw rule('DRAFT_NOT_RUNNABLE', 'the draft has problems; fix them before running it', { issues: issues.map((i) => `${i.key}: ${i.problems.join('; ')}`) });
  const files = resolveFiles(ctx.s, snapshot);
  const unreviewed = reviewItems(ctx.s, snapshot, { groupId: group.id, workspaceId: feature.workspaceId })
    .filter((i) => i.status !== 'APPROVED')
    .map((i) => files[i.dataKey]?.name ?? i.dataKey);
  if (unreviewed.length) {
    throw rule('SENSITIVE_NOT_REVIEWED', `sensitive files need a current DCL approval before any vehicle collects them: ${unreviewed.join(', ')}`, { issues: unreviewed });
  }

  const digest = digestOf(snapshot);
  const base = t.baseReleaseId ? ctx.s.releases[t.baseReleaseId]!.dclVersion : 'initial';
  const off = t.disabledPolicies.length ? ` −${t.disabledPolicies.length}` : '';
  const configId = resolveConfig(ctx, {
    vehicleModelId: r.vehicleModelId,
    kind: 'PERSONAL',
    sourceId: feature.id,
    baseReleaseId: t.baseReleaseId,
    groups: t.groups,
    disabledPolicies: t.disabledPolicies,
    draft: { groupId: group.id, featureId: feature.id, snapshot, digest },
    label: `${base} / ${group.code} / ${feature.name} / draft${off}`,
  });
  if (r.appliedConfigId === configId) throw conflict('CONFIG_ALREADY_APPLIED', `${r.id} already runs this draft on this base`);
  const deploymentId = newId('dp');
  ctx.s.deployments[deploymentId] = {
    id: deploymentId,
    kind: 'PERSONAL',
    workspaceId: r.homeWorkspaceId!,
    groupId: group.id,
    subjectId: r.id,
    commitId: null,
    resolvedConfigId: configId,
    env: 'development',
    status: 'PENDING',
    vehicleGroupIds: [],
    targets: [{ resourceId: r.id, vehicleGroupId: null, attempt: 0, status: 'PENDING', previousConfigId: r.appliedConfigId, error: null, updatedAt: ctx.now, history: [] }],
    dispatchedBy: ctx.user().username,
    createdAt: ctx.now,
    updatedAt: ctx.now,
  };
  return deploymentId;
}

/** The owner withdraws a configuration the instance has not answered yet; it keeps what it runs. */
export function cancelPersonalConfig(ctx: Ctx, id: string): void {
  const r = ownSim(ctx, id);
  const pending = personalPending(ctx.s, r.id);
  if (!pending) throw rule('NOT_PENDING', `${r.id} is not waiting for a configuration`);
  cancelPending(ctx, pending, 'withdrawn by the owner');
}

function cancelPending(ctx: Ctx, deploymentId: string, reason: string): void {
  const d = ctx.s.deployments[deploymentId]!;
  for (const t of d.targets) {
    if (t.status !== 'PENDING') continue;
    t.status = 'CANCELLED';
    t.error = reason;
    t.updatedAt = ctx.now;
  }
  d.status = 'CANCELLED';
  d.updatedAt = ctx.now;
}

/** Draft policies a personal simulation can fire: those of the personal configuration it runs. */
export function personalCapturablePolicies(s: State, id: string): { policyId: string; name: string }[] {
  const r = s.resources[id];
  const config = r?.appliedConfigId ? s.resolvedConfigs[r.appliedConfigId] : undefined;
  if (!r?.personal || config?.kind !== 'PERSONAL' || !config.draft) return [];
  return Object.entries(config.draft.snapshot.policies)
    .map(([policyId, p]) => ({ policyId, name: p.name }))
    .sort((a, b) => a.policyId.localeCompare(b.policyId));
}

/**
 * The simulated instance fires a draft policy (system context). The owner sees which files it
 * would capture; nothing is uploaded or processed and nothing reaches data query.
 */
export function trialCapture(ctx: Ctx, id: string, policyId: string): string {
  const r = getPersonalSim(ctx.s, id);
  if (r.status === 'RETIRED' || r.instance !== 'RUNNING') throw rule('SIMULATION_STOPPED', `${r.id} is not running`);
  const config = r.appliedConfigId ? ctx.s.resolvedConfigs[r.appliedConfigId] : undefined;
  if (config?.kind !== 'PERSONAL' || !config.draft) throw rule('PERSONAL_NOT_APPLIED', `${r.id} runs no draft yet`);
  const policy = config.draft.snapshot.policies[policyId];
  if (!policy) throw rule('POLICY_NOT_ON_VEHICLE', `policy ${policyId} is not in the draft ${r.id} runs`);
  const files = resolveFiles(ctx.s, config.draft.snapshot);
  const captureId = newId('pc');
  ctx.s.personalCaptures[captureId] = {
    id: captureId,
    seq: ctx.seq(),
    resourceId: r.id,
    owner: r.personal!.owner,
    configId: config.id,
    featureId: config.draft.featureId,
    policyId,
    policyName: policy.name,
    trigger: policy.trigger,
    files: policy.captures.map((dataKey) => ({
      dataKey,
      name: files[dataKey]?.name ?? dataKey,
      format: files[dataKey]?.format ?? '',
      sizeBytes: sizeOf(`${captureId}/${dataKey}`),
    })),
    occurredAt: ctx.now,
  };
  return captureId;
}

/** Trial captures of a personal simulation (newest first); only its owner reads them. */
export function personalCapturesOf(s: State, id: string): PersonalCapture[] {
  return Object.values(s.personalCaptures)
    .filter((c) => c.resourceId === id)
    .sort((a, b) => b.seq - a.seq);
}

/**
 * The owner records their own verdict on the draft the instance runs. It pins the configuration,
 * draft, image, software and the trial captures made since the previous verdict on it.
 */
export function recordPersonalTest(ctx: Ctx, id: string, input: { result: 'PASS' | 'FAIL'; note: string }): string {
  const r = ownSim(ctx, id);
  const config = r.appliedConfigId ? ctx.s.resolvedConfigs[r.appliedConfigId] : undefined;
  if (config?.kind !== 'PERSONAL' || !config.draft) throw rule('PERSONAL_NOT_APPLIED', `${r.id} runs no draft yet; configure it and wait for the receipt`);
  if (input.result !== 'PASS' && input.result !== 'FAIL') throw rule('INVALID_RESULT', 'the result is PASS or FAIL');
  if (!input.note.trim()) throw rule('SUMMARY_REQUIRED', 'describe what was tested');
  const previous = Math.max(0, ...Object.values(ctx.s.personalTests).filter((t) => t.resourceId === r.id && t.configId === config.id).map((t) => t.seq));
  const captureIds = Object.values(ctx.s.personalCaptures)
    .filter((c) => c.resourceId === r.id && c.configId === config.id && c.seq > previous)
    .sort((a, b) => a.seq - b.seq)
    .map((c) => c.id);
  const testId = newId('pt');
  ctx.s.personalTests[testId] = {
    id: testId,
    seq: ctx.seq(),
    resourceId: r.id,
    owner: r.personal!.owner,
    workspaceId: r.homeWorkspaceId!,
    featureId: config.draft.featureId,
    configId: config.id,
    draftDigest: config.draft.digest,
    imageId: r.imageId,
    integrationVersion: r.integrationVersion,
    baseReleaseId: config.baseReleaseId,
    disabledPolicies: [...config.disabledPolicies],
    captureIds,
    result: input.result,
    note: input.note.trim(),
    createdAt: ctx.now,
  };
  return testId;
}

/** The owner gives the instance back. Its configuration history, captures and self-tests stay. */
export function releasePersonalSim(ctx: Ctx, id: string): void {
  const r = ownSim(ctx, id);
  const pending = personalPending(ctx.s, r.id);
  if (pending) throw rule('VEHICLE_BUSY', `${r.id} is waiting for deployment ${pending}; withdraw it or wait for the receipt`, { deploymentId: pending });
  assertIdle(ctx.s, r.id);
  r.status = 'RETIRED';
  r.instance = 'STOPPED';
  r.updatedAt = ctx.now;
}

/**
 * When an account is disabled (it left, or ops disabled it), its personal simulations are given
 * back: pending configurations are withdrawn, the instances retired, their history kept.
 */
export function releasePersonalSimsOf(ctx: Ctx, username: string): string[] {
  const released: string[] = [];
  for (const r of Object.values(ctx.s.resources)) {
    if (r.personal?.owner !== username || r.status === 'RETIRED') continue;
    const pending = personalPending(ctx.s, r.id);
    if (pending) cancelPending(ctx, pending, 'the owner’s account was disabled');
    for (const c of Object.values(ctx.s.imageChanges)) {
      if (c.resourceId !== r.id || c.status !== 'PENDING') continue;
      c.status = 'CANCELLED';
      c.error = 'the owner’s account was disabled';
      c.answeredAt = ctx.now;
    }
    r.status = 'RETIRED';
    r.instance = 'STOPPED';
    r.updatedAt = ctx.now;
    released.push(r.id);
  }
  return released.sort();
}

export interface PersonalTestView extends PersonalTest {
  /** The Feature's draft still has the content that was tested. */
  draftCurrent: boolean;
  /** The instance still runs the image the self-test ran on. */
  imageCurrent: boolean;
  /** The newest commit of the Feature with exactly the tested content, if any. */
  matchingCommitId: string | null;
}

/** Self-tests of a Feature's drafts, newest first: shown to the Feature's readers, never required. */
export function personalTestsOf(s: State, featureId: string): PersonalTestView[] {
  const feature = s.features[featureId];
  if (!feature) return [];
  const commits = Object.values(s.commits)
    .filter((c) => c.featureId === featureId)
    .sort((a, b) => b.seq - a.seq);
  const draft = normalizeConfig(feature.draft);
  return Object.values(s.personalTests)
    .filter((t) => t.featureId === featureId)
    .sort((a, b) => b.seq - a.seq)
    .map((t) => {
      const snapshot = s.resolvedConfigs[t.configId]?.draft?.snapshot;
      return {
        ...t,
        draftCurrent: !!snapshot && sameConfig(snapshot, draft),
        imageCurrent: s.resources[t.resourceId]?.imageId === t.imageId,
        matchingCommitId: (snapshot && commits.find((c) => sameConfig(snapshot, commitSnapshot(s, c.id)))?.id) ?? null,
      };
    });
}
