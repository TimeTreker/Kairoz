// Formal release (正式发布): configuration release promotes a Verified candidate to an immutable
// DCL version for listed whole-vehicle software versions. Publishing changes no vehicle: vehicles
// resolve to the newest matching release and only receipts change what they run.

import { conflict, notFound, rule } from '../domain/errors.ts';
import { newId } from '../domain/ids.ts';
import { latestRelease } from './config.ts';
import type { Ctx } from './engine.ts';
import { isConfirmed } from './integration.ts';
import { commitSnapshot, resolveFiles } from './snapshots.ts';
import type { Candidate, Release, Resource, State } from './types.ts';
import { candidateTestStatus, candidateVerifyBlockers, getCandidate, resolveConfig } from './validation.ts';

export const DCL_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export function getRelease(s: State, id: string): Release {
  const r = s.releases[id];
  if (!r) throw notFound('release', id);
  return r;
}

export function releasesOf(s: State, vehicleModelId: string): Release[] {
  return Object.values(s.releases)
    .filter((r) => r.vehicleModelId === vehicleModelId)
    .sort((a, b) => b.sequence - a.sequence);
}

/** Whole-vehicle software versions the candidate passed its integration tests on. */
export function testedVersions(s: State, c: Candidate): string[] {
  const versions = candidateTestStatus(s, c)
    .filter((t) => t.latest?.result === 'PASS' && t.latest.integrationVersion)
    .map((t) => t.latest!.integrationVersion!);
  return [...new Set(versions)].sort(compareVersions);
}

/** Suggested next DCL version: the next patch of the newest release, or 1.0.0. */
export function nextDclVersion(s: State, vehicleModelId: string): string {
  const latest = latestRelease(s, vehicleModelId);
  if (!latest) return '1.0.0';
  const [major, minor, patch] = latest.dclVersion.split('.').map(Number);
  return `${major}.${minor}.${(patch ?? 0) + 1}`;
}

/** Promotes a Verified candidate to a formal release. */
export function promoteCandidate(ctx: Ctx, candidateId: string, input: { dclVersion: string; vehicleIntegrationVersions: string[]; notes?: string }): string {
  const c = getCandidate(ctx.s, candidateId);
  // Said first, whoever asks: a subsystem candidate never becomes a DCL release.
  if (c.scope !== 'Vehicle') throw rule('SUBSYSTEM_CANDIDATE', 'a subsystem candidate is published as a subsystem release by its domain, not promoted to a DCL release');
  ctx.allow('release.promote', { type: 'candidate', id: c.id, workspaceId: c.workspaceId, scope: 'Vehicle' });
  if (c.status !== 'VERIFIED') throw rule('CANDIDATE_NOT_VERIFIED', 'only a candidate verified by integration testing can be released');
  // The release re-checks everything the candidate stands on.
  const blockers = candidateVerifyBlockers(ctx.s, c);
  if (blockers.length) throw rule('VERIFY_BLOCKED', 'the candidate’s current tests no longer verify it', { issues: blockers });
  const plan = ctx.s.mergePlans[c.mergePlanId];
  if (!plan || !isConfirmed(ctx.s, plan)) throw rule('PROCESSING_NOT_CONFIRMED', 'DCL engineering has not confirmed this processing set');
  if ((latestRelease(ctx.s, c.vehicleModelId)?.id ?? null) !== c.targetReleaseId) {
    throw rule('TARGET_CHANGED', 'a newer release was published after this candidate was frozen; integrate again');
  }
  const version = input.dclVersion.trim();
  if (!DCL_VERSION.test(version)) throw rule('INVALID_DCL_VERSION', 'a DCL version is major.minor.patch, e.g. 1.0.1');
  const existing = releasesOf(ctx.s, c.vehicleModelId);
  if (existing.some((r) => r.dclVersion === version)) throw conflict('DCL_VERSION_TAKEN', `DCL ${version} already exists`);
  const newest = existing[0];
  if (newest && compareVersions(version, newest.dclVersion) <= 0) throw rule('DCL_VERSION_NOT_NEWER', `the version must be newer than DCL ${newest.dclVersion}`);

  const versions = [...new Set(input.vehicleIntegrationVersions.map((v) => v.trim()).filter(Boolean))].sort(compareVersions);
  if (versions.length === 0) throw rule('NO_VEHICLE_VERSIONS', 'list the whole-vehicle software versions this release applies to');
  const unknown = versions.filter((v) => !ctx.s.softwareVersions[`${c.vehicleModelId}::${v}`]);
  if (unknown.length) throw rule('UNKNOWN_SOFTWARE_VERSION', 'these software versions are not recorded', { issues: unknown });
  // Applicability is evidence too: on a formal baseline each listed version must have passed
  // integration testing. The first integration is tested before any software is released, on
  // vehicles without a formal version, and lists the versions from trusted software records.
  if (c.targetReleaseId !== null) {
    const tested = new Set(testedVersions(ctx.s, c));
    const untested = versions.filter((v) => !tested.has(v));
    if (untested.length) {
      throw rule('VERSION_NOT_TESTED', 'some listed software versions have no passing integration test', { issues: untested.map((v) => `${c.vehicleModelId} ${v}`) });
    }
  }

  const id = newId('rl');
  const resolvedConfigId = resolveConfig(ctx, { vehicleModelId: c.vehicleModelId, kind: 'RELEASE', sourceId: id, baseReleaseId: c.targetReleaseId, groups: c.groups, label: `DCL ${version}` });
  ctx.s.releases[id] = {
    id,
    vehicleModelId: c.vehicleModelId,
    dclVersion: version,
    vehicleIntegrationVersions: versions,
    groups: { ...c.groups },
    candidateId: c.id,
    resolvedConfigId,
    sequence: (newest?.sequence ?? 0) + 1,
    notes: input.notes?.trim() ?? '',
    publishedBy: ctx.user().username,
    publishedAt: ctx.now,
  };
  ctx.s.candidates[c.id]!.status = 'RELEASED';
  // The participating Features are closed; later changes start new Features on this release.
  // Subsystem releases it included are now part of a formal release, and so are their Features.
  const included = c.subsystems.flatMap((ref) => {
    const r = ctx.s.subsystemReleases[ref.subsystemReleaseId]!;
    r.status = 'INTEGRATED';
    return r.features;
  });
  for (const src of [...c.sources, ...included]) {
    const f = ctx.s.features[src.featureId];
    if (f && f.stage === 'INTEGRATED') {
      f.stage = 'ARCHIVED';
      f.updatedAt = ctx.now;
    }
  }
  // Previews built on the old target can no longer be frozen.
  for (const p of Object.values(ctx.s.mergePlans)) {
    if (p.vehicleModelId === c.vehicleModelId && ['READY', 'CONFLICT', 'BLOCKED'].includes(p.status)) p.status = 'SUPERSEDED';
  }
  return id;
}

/** The complete configuration set of a release, for review and hand-over (配置集合). */
export function releaseConfiguration(s: State, releaseId: string) {
  const r = getRelease(s, releaseId);
  const pipeline = (id: string) => {
    const p = s.pipelines[id];
    return p ? `${p.code}@${p.version}` : id;
  };
  return {
    kind: 'kairoz.release-configuration',
    prototype: true,
    productionInstallable: false,
    vehicleModelId: r.vehicleModelId,
    dclVersion: r.dclVersion,
    vehicleIntegrationVersions: r.vehicleIntegrationVersions,
    sequence: r.sequence,
    candidate: r.candidateId ? (s.candidates[r.candidateId]?.label ?? null) : null,
    digest: s.resolvedConfigs[r.resolvedConfigId]?.digest ?? null,
    publishedBy: r.publishedBy,
    publishedAt: r.publishedAt,
    groups: Object.entries(r.groups).map(([groupId, commitId]) => {
      const config = commitSnapshot(s, commitId);
      const files = resolveFiles(s, config);
      return {
        group: s.groups[groupId]?.code ?? groupId,
        commitId,
        commitDigest: s.commits[commitId]?.digest ?? null,
        files: Object.entries(files).map(([dataKey, f]) => ({
          dataKey,
          name: f.name,
          owned: dataKey in config.files,
          source: f.source,
          fileType: f.fileType,
          format: f.format,
          schema: f.schema,
          edge: pipeline(f.edgePipelineId),
          cloud: pipeline(f.cloudPipelineId),
          retentionDays: f.retentionDays,
          privacy: f.privacy,
        })),
        policies: Object.entries(config.policies).map(([policyId, p]) => ({ policyId, ...p })),
      };
    }),
  };
}

export interface Resolution {
  release: Release | null;
  /** Why no release applies, when none does. */
  problem: string | null;
}

/** The formal release a vehicle should run: the newest one listing its actual software version. */
export function releaseFor(s: State, r: Resource): Resolution {
  if (r.softwareStatus === 'PARTIAL_FAILURE') {
    const failed = r.controllers.filter((c) => c.status === 'FAIL').map((c) => c.name);
    return { release: null, problem: `a partial software update left controllers inconsistent (${failed.join(', ') || 'mixed versions'}); finish or roll back the software OTA first` };
  }
  if (!r.integrationVersion) return { release: null, problem: 'the whole-vehicle software version is unknown' };
  const release = releasesOf(s, r.vehicleModelId).find((x) => x.vehicleIntegrationVersions.includes(r.integrationVersion!));
  if (!release) return { release: null, problem: `no release applies to ${r.vehicleModelId} ${r.integrationVersion}` };
  return { release, problem: null };
}
