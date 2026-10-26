// Emergency stop of one policy (紧急停用): a policy that floods bandwidth or collects the wrong data
// is taken out fast, yet a vehicle still always runs a set the platform can name. One person asks,
// another with configuration release decides; approval publishes a new policy set version, the
// source set without that policy, for exactly the software versions the source served.

import { digestOf } from '../domain/canonical.ts';
import { conflict, notFound, rule } from '../domain/errors.ts';
import { newId } from '../domain/ids.ts';
import { mainlineRelease } from './config.ts';
import type { Ctx } from './engine.ts';
import { getRelease, nextDclVersion, releasesOf, supersedeMovedPlans, versionsInEffect } from './release.ts';
import type { EmergencyStop, Release, State } from './types.ts';
import { resolveConfig } from './validation.ts';

/** The workspace a set was released from: its candidate's, or the model's whole-vehicle project. */
export function releaseWorkspace(s: State, release: Release): string | undefined {
  if (release.candidateId) return s.candidates[release.candidateId]?.workspaceId;
  if (release.emergency) {
    const source = s.releases[release.emergency.sourceReleaseId];
    if (source) return releaseWorkspace(s, source);
  }
  return Object.values(s.workspaces).find((w) => w.kind === 'PROJECT' && w.vehicleModelId === release.vehicleModelId && w.scopes.includes('Vehicle'))?.id;
}

/** The business group whose commit in the set holds the policy. */
function owningGroup(release: Release, s: State, policyId: string): string | undefined {
  return Object.entries(release.groups).find(([, commitId]) => policyId in s.commits[commitId]!.policies)?.[0];
}

export function getStop(s: State, id: string): EmergencyStop {
  const stop = s.emergencyStops[id];
  if (!stop) throw notFound('emergency stop', id);
  return stop;
}

/** DCL engineering or configuration release asks to stop one policy of a set in effect. */
export function requestEmergencyStop(ctx: Ctx, input: { releaseId: string; policyId: string; reason: string }): string {
  const release = getRelease(ctx.s, input.releaseId);
  const groupId = owningGroup(release, ctx.s, input.policyId);
  ctx.allow('emergency.request', { type: 'release', id: release.id, workspaceId: releaseWorkspace(ctx.s, release), groupId: groupId ?? '*', scope: 'Vehicle' });
  if (!groupId) throw rule('POLICY_NOT_IN_SET', `policy ${input.policyId} is not in policy set ${release.dclVersion}`);
  if (versionsInEffect(ctx.s, release).length === 0) throw rule('SET_NOT_IN_EFFECT', `policy set ${release.dclVersion} is not in effect for any software version`);
  const open = Object.values(ctx.s.emergencyStops).find((x) => x.releaseId === release.id && x.policyId === input.policyId && x.status === 'REQUESTED');
  if (open) throw conflict('STOP_PENDING', 'a stop of this policy is already waiting for a decision');
  if (!input.reason.trim()) throw rule('REASON_REQUIRED', 'say why the policy must stop');
  const id = newId('es');
  ctx.s.emergencyStops[id] = {
    id,
    releaseId: release.id,
    policyId: input.policyId,
    groupId,
    reason: input.reason.trim(),
    status: 'REQUESTED',
    requestedBy: ctx.user().username,
    requestedAt: ctx.now,
    decidedBy: null,
    decidedAt: null,
    decisionNote: null,
    newReleaseId: null,
  };
  return id;
}

/**
 * Another configuration release decides. Approval publishes the source set without the policy as a
 * new version for the software versions the source is in effect for; it changes no vehicle until a
 * configuration OTA delivers it.
 */
export function decideEmergencyStop(ctx: Ctx, stopId: string, input: { decision: 'APPROVED' | 'REJECTED'; note: string }): string | null {
  const stop = getStop(ctx.s, stopId);
  const source = getRelease(ctx.s, stop.releaseId);
  ctx.allow('emergency.approve', { type: 'emergencyStop', id: stop.id, workspaceId: releaseWorkspace(ctx.s, source), scope: 'Vehicle' });
  if (stop.status !== 'REQUESTED') throw rule('REQUEST_DECIDED', 'the stop is already decided');
  if (stop.requestedBy === ctx.user().username) throw rule('SELF_APPROVAL', 'nobody decides their own request');
  if (!input.note.trim()) throw rule('REASON_REQUIRED', 'give a reason');
  const draft = ctx.s.emergencyStops[stop.id]!;
  draft.decidedBy = ctx.user().username;
  draft.decidedAt = ctx.now;
  draft.decisionNote = input.note.trim();
  if (input.decision === 'REJECTED') {
    draft.status = 'REJECTED';
    return null;
  }
  const versions = versionsInEffect(ctx.s, source);
  if (versions.length === 0) throw rule('SET_NOT_IN_EFFECT', `policy set ${source.dclVersion} is no longer in effect for any software version`);

  // The owning group's commit without the policy; files stay as they are.
  const base = ctx.s.commits[source.groups[stop.groupId]!]!;
  const policies = Object.fromEntries(Object.entries(base.policies).filter(([id]) => id !== stop.policyId));
  const manifest = ctx.s.manifestVersions[base.manifestVersionId]!;
  const commitId = newId('cm');
  ctx.s.commits[commitId] = {
    id: commitId,
    seq: ctx.seq(),
    featureId: null,
    mergeLabel: `emergency-stop ${stop.policyId}`,
    groupId: stop.groupId,
    parentCommitId: base.id,
    sequence: Object.values(ctx.s.commits).filter((c) => c.groupId === stop.groupId && c.featureId === null).length + 1,
    baseReleaseId: source.id,
    manifestVersionId: base.manifestVersionId,
    policies,
    digest: digestOf({
      groupId: stop.groupId,
      baseReleaseId: source.id,
      manifest: manifest.digest,
      policies: Object.keys(policies)
        .sort()
        .map((id) => [id, ctx.s.policyVersions[policies[id]!]!.digest]),
    }),
    message: `emergency stop: ${stop.reason}`,
    author: ctx.user().username,
    createdAt: ctx.now,
  };

  // A stop of the mainline head stays on the mainline; a stop of an older set is a patch of it.
  const patchOf = mainlineRelease(ctx.s, source.vehicleModelId)?.id === source.id ? null : source.id;
  const version = nextDclVersion(ctx.s, source.vehicleModelId, patchOf);
  const groups = { ...source.groups, [stop.groupId]: commitId };
  const id = newId('rl');
  const resolvedConfigId = resolveConfig(ctx, { vehicleModelId: source.vehicleModelId, kind: 'RELEASE', sourceId: id, baseReleaseId: source.id, groups, label: `DCL ${version}` });
  ctx.s.releases[id] = {
    id,
    vehicleModelId: source.vehicleModelId,
    dclVersion: version,
    vehicleIntegrationVersions: versions,
    groups,
    candidateId: null,
    resolvedConfigId,
    sequence: (releasesOf(ctx.s, source.vehicleModelId)[0]?.sequence ?? 0) + 1,
    notes: `紧急停用 ${stop.policyId}：${stop.reason}`,
    emergency: { stopId: stop.id, sourceReleaseId: source.id, policyId: stop.policyId },
    patchOf,
    publishedBy: ctx.user().username,
    publishedAt: ctx.now,
  };
  draft.status = 'APPROVED';
  draft.newReleaseId = id;
  supersedeMovedPlans(ctx.s, source.vehicleModelId);
  return id;
}

export function emergencyStopsOf(s: State, vehicleModelId: string): EmergencyStop[] {
  return Object.values(s.emergencyStops)
    .filter((x) => s.releases[x.releaseId]?.vehicleModelId === vehicleModelId)
    .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt) || b.id.localeCompare(a.id));
}
