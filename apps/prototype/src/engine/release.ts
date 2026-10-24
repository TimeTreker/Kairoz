// Formal release (正式发布): configuration release promotes a Verified candidate to an immutable
// DCL policy set version for listed whole-vehicle software versions. Sets and software versions
// are many-to-many: later applicability records add or withdraw software versions without a new
// set version. Publishing changes no vehicle: a vehicle resolves to the newest set that applies to
// its software, and only receipts change what it runs.

import { diffConfig, emptyConfig } from '../domain/config.ts';
import type { ConfigDiff } from '../domain/config.ts';
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

/** Whether a set applies to a software version: its publish list, then appended records (the newest wins). */
export function appliesTo(s: State, release: Release, version: string): boolean {
  const last = s.applicability.filter((a) => a.releaseId === release.id && a.version === version).sort((a, b) => b.seq - a.seq)[0];
  return last ? last.action === 'ADD' : release.vehicleIntegrationVersions.includes(version);
}

/** Every software version a set applies to now. */
export function applicableVersions(s: State, release: Release): string[] {
  const versions = new Set(release.vehicleIntegrationVersions);
  for (const a of s.applicability.filter((x) => x.releaseId === release.id).sort((x, y) => x.seq - y.seq)) {
    if (a.action === 'ADD') versions.add(a.version);
    else versions.delete(a.version);
  }
  return [...versions].sort(compareVersions);
}

/** The set in effect for a software version: the newest that applies to it. */
export function setInEffect(s: State, vehicleModelId: string, version: string): Release | null {
  return releasesOf(s, vehicleModelId).find((r) => appliesTo(s, r, version)) ?? null;
}

/** The software versions a set is the one in effect for. */
export function versionsInEffect(s: State, release: Release): string[] {
  return applicableVersions(s, release).filter((v) => setInEffect(s, release.vehicleModelId, v)?.id === release.id);
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
  if (existing.some((r) => r.dclVersion === version)) throw conflict('DCL_VERSION_TAKEN', `policy set ${version} already exists`);
  const newest = existing[0];
  if (newest && compareVersions(version, newest.dclVersion) <= 0) throw rule('DCL_VERSION_NOT_NEWER', `the version must be newer than policy set ${newest.dclVersion}`);

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
    emergency: null,
    publishedBy: ctx.user().username,
    publishedAt: ctx.now,
  };
  ctx.s.candidates[c.id]!.status = 'RELEASED';
  // Open applicability checks for versions the new set lists are answered by it.
  for (const check of Object.values(ctx.s.applicabilityChecks)) {
    if (check.vehicleModelId === c.vehicleModelId && versions.includes(check.version) && ['OPEN', 'TESTING', 'VERIFIED'].includes(check.status)) {
      check.status = 'SUPERSEDED';
      check.note = `policy set ${version} lists ${check.version}`;
    }
  }
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
  const release = setInEffect(s, r.vehicleModelId, r.integrationVersion);
  if (!release) return { release: null, problem: `no policy set applies to ${r.vehicleModelId} ${r.integrationVersion}` };
  return { release, problem: null };
}

export interface GroupChange {
  groupId: string;
  status: 'ADDED' | 'REMOVED' | 'CHANGED' | 'SAME';
  diff: ConfigDiff;
}

export interface PolicyChange {
  policyId: string;
  groupId: string;
  /** Policy version numbers; null when the policy is not in that set. */
  from: number | null;
  to: number | null;
}

/** What changed from one set version to another, business group by business group and policy by policy. */
export function releaseDiff(s: State, fromId: string | null, toId: string): { groups: GroupChange[]; policies: PolicyChange[] } {
  const to = getRelease(s, toId);
  const from = fromId ? getRelease(s, fromId) : null;
  const groupIds = [...new Set([...Object.keys(from?.groups ?? {}), ...Object.keys(to.groups)])].sort();
  const groups: GroupChange[] = groupIds.map((groupId) => {
    const a = from?.groups[groupId];
    const b = to.groups[groupId];
    const diff = diffConfig(a ? commitSnapshot(s, a) : emptyConfig(), b ? commitSnapshot(s, b) : emptyConfig());
    const status = !a ? 'ADDED' : !b ? 'REMOVED' : diff.empty ? 'SAME' : 'CHANGED';
    return { groupId, status, diff };
  });
  const policies: PolicyChange[] = [];
  for (const groupId of groupIds) {
    const a = from?.groups[groupId] ? s.commits[from.groups[groupId]!]!.policies : {};
    const b = to.groups[groupId] ? s.commits[to.groups[groupId]!]!.policies : {};
    for (const policyId of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
      const before = a[policyId] ? s.policyVersions[a[policyId]!]!.version : null;
      const after = b[policyId] ? s.policyVersions[b[policyId]!]!.version : null;
      if (before !== after) policies.push({ policyId, groupId, from: before, to: after });
    }
  }
  return { groups, policies };
}

/** The set published just before this one for the same vehicle model. */
export function previousRelease(s: State, release: Release): Release | null {
  return releasesOf(s, release.vehicleModelId).find((r) => r.sequence < release.sequence) ?? null;
}
