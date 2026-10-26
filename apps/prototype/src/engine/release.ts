// Formal release (正式发布): configuration release promotes a Verified candidate to an immutable
// DCL policy set version for listed whole-vehicle software versions. Sets and software versions
// are many-to-many: later applicability records add or withdraw software versions without a new
// set version. Publishing changes no vehicle: a vehicle resolves to the newest set that applies to
// its software, and only receipts change what it runs.
//
// Sets form a mainline (主线) that merges build on, and same-software patches (补丁): a patch of an
// older set serves only software versions that set was in effect for, is numbered in its
// major.minor line, and never moves the mainline.

import { diffConfig, emptyConfig, sameConfig } from '../domain/config.ts';
import type { ConfigDiff, GroupConfig } from '../domain/config.ts';
import { conflict, notFound, rule } from '../domain/errors.ts';
import { newId } from '../domain/ids.ts';
import { mainlineRelease } from './config.ts';
import type { Ctx } from './engine.ts';
import { isConfirmed } from './integration.ts';
import { commitSnapshot, resolveFiles } from './snapshots.ts';
import type { Candidate, MergePlan, Release, Resource, State } from './types.ts';
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

/** A version's major.minor line, e.g. 1.0 for 1.0.2. */
export function versionLine(version: string): string {
  return version.split('.').slice(0, 2).join('.');
}

/** The model's highest set version, or the highest of one major.minor line. */
export function highestVersion(s: State, vehicleModelId: string, line?: string): string | null {
  const versions = releasesOf(s, vehicleModelId)
    .map((r) => r.dclVersion)
    .filter((v) => line === undefined || versionLine(v) === line);
  return versions.sort(compareVersions).at(-1) ?? null;
}

/**
 * Suggested next DCL version: on the mainline, the next patch number above every version of the
 * model (1.0.0 for the first set); for a patch of an older set, the next one in that set's line.
 */
export function nextDclVersion(s: State, vehicleModelId: string, patchOf: string | null = null): string {
  const target = patchOf ? s.releases[patchOf] : undefined;
  const top = highestVersion(s, vehicleModelId, target ? versionLine(target.dclVersion) : undefined);
  if (!top) return '1.0.0';
  const [major, minor, patch] = top.split('.').map(Number);
  return `${major}.${minor}.${(patch ?? 0) + 1}`;
}

/**
 * Sets a same-software patch may target: every set but the mainline head that is still in effect
 * for some software version, newest first.
 */
export function patchTargets(s: State, vehicleModelId: string): Release[] {
  const head = mainlineRelease(s, vehicleModelId);
  return releasesOf(s, vehicleModelId).filter((r) => r.id !== head?.id && versionsInEffect(s, r).length > 0);
}

/** A set and the older sets it patches, back to the mainline set the line started from. */
export function patchChain(s: State, releaseId: string): Release[] {
  const chain: Release[] = [];
  for (let r = s.releases[releaseId]; r; r = r.patchOf ? s.releases[r.patchOf] : undefined) chain.push(r);
  return chain;
}

/**
 * Whether a preview's or candidate's target moved since it was made: on the mainline, a newer
 * mainline set; for a patch, the target no longer in effect for a software version it served.
 */
export function targetMoved(s: State, x: Pick<MergePlan, 'vehicleModelId' | 'targetReleaseId' | 'patch'>): boolean {
  if (!x.patch) return (mainlineRelease(s, x.vehicleModelId)?.id ?? null) !== x.targetReleaseId;
  return x.patch.versions.some((v) => setInEffect(s, x.vehicleModelId, v)?.id !== x.targetReleaseId);
}

/** After a set is published, previews whose target moved can no longer be frozen. */
export function supersedeMovedPlans(s: State, vehicleModelId: string): void {
  for (const p of Object.values(s.mergePlans)) {
    if (p.vehicleModelId === vehicleModelId && ['READY', 'CONFLICT', 'BLOCKED'].includes(p.status) && targetMoved(s, p)) p.status = 'SUPERSEDED';
  }
}

/** Features released in a patch of this set's line that have neither reached the mainline nor been closed for it. */
export function pendingPatchFeatures(s: State, release: Release): string[] {
  const ids = new Set<string>();
  for (const r of patchChain(s, release.id)) {
    if (r.patchOf === null || !r.candidateId) continue;
    for (const src of s.candidates[r.candidateId]?.sources ?? []) if (s.features[src.featureId]?.stage !== 'ARCHIVED') ids.add(src.featureId);
  }
  return [...ids].sort();
}

/**
 * Why a set may not become the one in effect for a software version, or null when it may. A patch
 * only takes over versions its own line serves. A mainline set never takes over from a newer
 * mainline set; it takes over from a patch only as the mainline head, once the patch's fixes
 * reached the mainline or were closed for it (`including`: Features the set brings itself).
 */
export function takeOverProblem(
  s: State,
  release: Pick<Release, 'id' | 'vehicleModelId' | 'patchOf' | 'sequence' | 'dclVersion'>,
  version: string,
  including: ReadonlySet<string> = new Set(),
): { code: string; message: string } | null {
  const current = setInEffect(s, release.vehicleModelId, version);
  if (current?.id === release.id) return null;
  if (release.patchOf) {
    if (current && patchChain(s, release.id).some((r) => r.id === current.id)) return null;
    return { code: 'PATCH_VERSION_OUTSIDE_TARGET', message: `policy set ${release.dclVersion} is a same-software patch; it only serves software its own line serves, not ${version}` };
  }
  if (!current) return null;
  if (current.patchOf === null) {
    return current.sequence > release.sequence ? { code: 'APPLICABILITY_SHADOWED', message: `the newer policy set ${current.dclVersion} already applies to ${version}` } : null;
  }
  const head = mainlineRelease(s, release.vehicleModelId);
  if (head && head.id !== release.id && head.sequence > release.sequence) {
    return { code: 'APPLICABILITY_SHADOWED', message: `software ${version} runs patch ${current.dclVersion}; only the mainline head ${head.dclVersion} may take it over` };
  }
  const missing = pendingPatchFeatures(s, current).filter((id) => !including.has(id));
  if (missing.length) {
    return {
      code: 'PATCH_FIX_MISSING',
      message: `software ${version} runs patch ${current.dclVersion}; merge ${missing.map((id) => s.features[id]?.name ?? id).join(', ')} into the mainline, or close them for it, first`,
    };
  }
  return null;
}

/** Why a candidate's release may not list a software version, or null when it may. */
export function promoteVersionProblem(s: State, c: Candidate, version: string): { code: string; message: string } | null {
  const sequence = (releasesOf(s, c.vehicleModelId)[0]?.sequence ?? 0) + 1;
  const patchOf = c.patch ? c.targetReleaseId : null;
  return takeOverProblem(s, { id: '', vehicleModelId: c.vehicleModelId, patchOf, sequence, dclVersion: 'new' }, version, new Set(c.sources.map((x) => x.featureId)));
}

/** The same-software patches a Feature's current head went into. */
export function patchesOf(s: State, feature: { id: string; headCommitId: string | null }): Release[] {
  return Object.values(s.releases)
    .filter((r) => r.patchOf !== null && r.candidateId && s.candidates[r.candidateId]?.sources.some((x) => x.featureId === feature.id && x.commitId === feature.headCommitId))
    .sort((a, b) => a.sequence - b.sequence);
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
  if (targetMoved(ctx.s, c)) {
    throw rule('TARGET_CHANGED', c.patch ? 'the set this patch targets was replaced for its software since the candidate was frozen; integrate again' : 'a newer release was published after this candidate was frozen; integrate again');
  }
  const version = input.dclVersion.trim();
  if (!DCL_VERSION.test(version)) throw rule('INVALID_DCL_VERSION', 'a DCL version is major.minor.patch, e.g. 1.0.1');
  const existing = releasesOf(ctx.s, c.vehicleModelId);
  if (existing.some((r) => r.dclVersion === version)) throw conflict('DCL_VERSION_TAKEN', `policy set ${version} already exists`);
  const newest = existing[0];
  const target = c.patch ? ctx.s.releases[c.targetReleaseId!]! : null;
  if (target) {
    // A patch is numbered in its target's major.minor line, above every set of that line.
    const line = versionLine(target.dclVersion);
    const top = highestVersion(ctx.s, c.vehicleModelId, line)!;
    if (versionLine(version) !== line || compareVersions(version, top) <= 0) {
      throw rule('PATCH_VERSION_LINE', `a patch of policy set ${target.dclVersion} is numbered ${line}.x, newer than ${top}`);
    }
  } else {
    const top = highestVersion(ctx.s, c.vehicleModelId);
    if (top && compareVersions(version, top) <= 0) throw rule('DCL_VERSION_NOT_NEWER', `the version must be newer than policy set ${top}`);
  }

  const versions = [...new Set(input.vehicleIntegrationVersions.map((v) => v.trim()).filter(Boolean))].sort(compareVersions);
  if (versions.length === 0) throw rule('NO_VEHICLE_VERSIONS', 'list the whole-vehicle software versions this release applies to');
  const unknown = versions.filter((v) => !ctx.s.softwareVersions[`${c.vehicleModelId}::${v}`]);
  if (unknown.length) throw rule('UNKNOWN_SOFTWARE_VERSION', 'these software versions are not recorded', { issues: unknown });
  if (target) {
    // Same software only: a patch replaces its target where the target is in effect, nowhere else.
    const serving = new Set(versionsInEffect(ctx.s, target));
    const outside = versions.filter((v) => !serving.has(v));
    if (outside.length) {
      throw rule('PATCH_VERSION_OUTSIDE_TARGET', `policy set ${target.dclVersion} is in effect for ${[...serving].join(', ')} only`, { issues: outside.map((v) => `${c.vehicleModelId} ${v}`) });
    }
  } else {
    // A mainline set takes software over from a patch only with the patch's fixes in it.
    const missing = versions.map((v) => promoteVersionProblem(ctx.s, c, v)).filter((p): p is NonNullable<typeof p> => !!p);
    if (missing.length) throw rule('PATCH_FIX_MISSING', 'some listed software versions run a patch whose fixes this set lacks', { issues: missing.map((p) => p.message) });
  }
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
    patchOf: target?.id ?? null,
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
  // A patch's Features stay open for the mainline: the fix is merged there too, or declined.
  const included = c.subsystems.flatMap((ref) => {
    const r = ctx.s.subsystemReleases[ref.subsystemReleaseId]!;
    r.status = 'INTEGRATED';
    return r.features;
  });
  for (const src of [...c.sources, ...included]) {
    const f = ctx.s.features[src.featureId];
    if (f && f.stage === 'INTEGRATED') {
      f.stage = !target ? 'ARCHIVED' : sameConfig(f.draft as GroupConfig, commitSnapshot(ctx.s, src.commitId)) ? 'VERIFIED' : 'DRAFT';
      f.updatedAt = ctx.now;
    }
  }
  supersedeMovedPlans(ctx.s, c.vehicleModelId);
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

/** The set this one follows: the set a patch fixes, or the mainline set published before it. */
export function previousRelease(s: State, release: Release): Release | null {
  if (release.patchOf) return s.releases[release.patchOf] ?? null;
  return releasesOf(s, release.vehicleModelId).find((r) => r.sequence < release.sequence && r.patchOf === null) ?? null;
}
