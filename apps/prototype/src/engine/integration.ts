// Configuration integration (配置集成): three-way merge preview of Verified Features onto the
// target set, DCL confirmation of the final processing set, and freezing a complete candidate.

import { digestOf } from '../domain/canonical.ts';
import { capturableKeys, diffConfig, emptyConfig, MAX_CAPTURE_WINDOW_SECONDS, sameConfig } from '../domain/config.ts';
import type { ConfigDiff, GroupConfig } from '../domain/config.ts';
import { conflict, notFound, rule } from '../domain/errors.ts';
import { requiresSensitiveReview } from '../domain/file-types.ts';
import { newId } from '../domain/ids.ts';
import { mergeGroup, PROCESSING_FIELDS } from '../domain/merge.ts';
import type { MergeSource } from '../domain/merge.ts';
import { parseTrigger } from '../domain/trigger.ts';
import { WILDCARD } from '../domain/vocabulary.ts';
import type { Domain, Scope } from '../domain/vocabulary.ts';
import { reviewItems } from './approvals.ts';
import type { ReviewItem } from './approvals.ts';
import { baseConfig, fileSpecVersion, headChangesRequested, latestRelease, manifestVersion, policyVersion, reviewRequiredBefore } from './config.ts';

export { latestRelease };
import type { Ctx } from './engine.ts';
import { getWorkspace } from './org.ts';
import { bindingIssues } from './processing.ts';
import { commitSnapshot, resolveFiles } from './snapshots.ts';
import type { Candidate, Feature, MergeConflict, MergePlan, Release, State, SubsystemRef, SubsystemRelease, Workspace } from './types.ts';
import { candidateVerifyBlockers, resolveConfig } from './validation.ts';

/**
 * Where merges run: a project workspace, or an integration workspace that takes team workspaces
 * as sources directly (a single-team first integration needs no project workspace).
 */
export function isMergeWorkspace(s: State, workspaceId: string): boolean {
  const ws = s.workspaces[workspaceId];
  if (!ws) return false;
  return ws.kind === 'PROJECT' || (ws.kind === 'INTEGRATION' && ws.sourceWorkspaceIds.some((id) => s.workspaces[id]?.kind === 'TEAM'));
}

/** The scope a merge in this workspace takes unless one is chosen: Vehicle when the workspace has it. */
export function defaultScope(ws: Pick<Workspace, 'scopes'>): Scope {
  return ws.scopes.includes('Vehicle') ? 'Vehicle' : (ws.scopes[0] ?? 'Vehicle');
}

/**
 * Verified Features a merge may collect: from the workspace's declared sources, same vehicle
 * model. A subsystem (domain) merge takes only Features of business groups in its domain.
 */
export function verifiedSources(s: State, workspaceId: string, scope?: Scope): Feature[] {
  const ws = s.workspaces[workspaceId];
  if (!ws) return [];
  const within = scope ?? defaultScope(ws);
  const allowed = new Set([ws.id, ...ws.sourceWorkspaceIds]);
  return Object.values(s.features)
    .filter((f) => allowed.has(f.workspaceId) && f.vehicleModelId === ws.vehicleModelId && isCollectible(s, f))
    .filter((f) => within === 'Vehicle' || s.groups[f.groupId]?.domain === within)
    .sort((a, b) => a.groupId.localeCompare(b.groupId) || a.name.localeCompare(b.name));
}

/** Subsystem releases a whole-vehicle merge may collect: the newest active one per domain from its sources. */
export function collectibleSubsystems(s: State, workspaceId: string): SubsystemRelease[] {
  const ws = s.workspaces[workspaceId];
  if (!ws) return [];
  const sources = new Set(ws.sourceWorkspaceIds);
  const newest = new Map<string, SubsystemRelease>();
  for (const r of Object.values(s.subsystemReleases)) {
    if (r.status !== 'ACTIVE' || !sources.has(r.workspaceId) || r.vehicleModelId !== ws.vehicleModelId) continue;
    const seen = newest.get(r.domain);
    if (!seen || r.sequence > seen.sequence) newest.set(r.domain, r);
  }
  return [...newest.values()].sort((a, b) => a.domain.localeCompare(b.domain));
}

/**
 * The domain's newest subsystem release not yet in a formal release. A new subsystem merge builds
 * on it, so a later subsystem release always contains what the earlier one published.
 */
export function currentSubsystem(s: State, vehicleModelId: string, domain: string): SubsystemRelease | undefined {
  return Object.values(s.subsystemReleases)
    .filter((r) => (r.status === 'ACTIVE' || r.status === 'INTEGRATING') && r.vehicleModelId === vehicleModelId && r.domain === domain)
    .sort((a, b) => b.sequence - a.sequence)[0];
}

/** A subsystem release as merge input: one source per changed group, against the release it was built on. */
function subsystemSources(s: State, ref: SubsystemRef): [string, MergeSource][] {
  const r = s.subsystemReleases[ref.subsystemReleaseId];
  const base = r?.baseReleaseId ? s.releases[r.baseReleaseId] : undefined;
  return Object.entries(ref.groups).map(([groupId, commitId]) => [
    groupId,
    { sourceId: ref.subsystemReleaseId, base: targetConfig(s, base, groupId), theirs: commitSnapshot(s, commitId) },
  ]);
}

/**
 * A Feature whose head commit is verified. Unsubmitted draft edits do not withdraw it: integration
 * collects the fixed commit. A new commit, or a change request on the head, does.
 */
export function isCollectible(s: State, f: Feature): boolean {
  return f.verifiedCommitId !== null && f.verifiedCommitId === f.headCommitId && !['INTEGRATED', 'ARCHIVED'].includes(f.stage) && !headChangesRequested(s, f);
}

function targetGroups(s: State, release: Release | undefined): Record<string, string> {
  return release ? { ...release.groups } : {};
}

function targetConfig(s: State, release: Release | undefined, groupId: string): GroupConfig {
  const commitId = release?.groups[groupId];
  return commitId ? commitSnapshot(s, commitId) : emptyConfig();
}

/** Problems with the complete set after merging: policies, bindings, consistent reference pins. */
function setIssues(s: State, finalSet: Record<string, GroupConfig>): string[] {
  const issues: string[] = [];
  for (const [groupId, config] of Object.entries(finalSet)) {
    const code = s.groups[groupId]?.code ?? groupId;
    const keys = capturableKeys(config);
    for (const [policyId, p] of Object.entries(config.policies)) {
      // Each source passed the policy rules on its own, but a field-by-field merge can combine
      // them into a policy none of them had: one source's seconds before the trigger with another's after it.
      const policy = `${code}: policy ${policyId}`;
      if (p.captures.length === 0) issues.push(`${policy} captures no file`);
      for (const k of p.captures) if (!keys.has(k)) issues.push(`${policy} captures ${k}, which is not in the merged file list`);
      const trigger = parseTrigger(p.trigger);
      if (!trigger.ok) issues.push(`${policy} has an invalid trigger: ${trigger.error.message} at ${trigger.error.position}`);
      const window = p.preSeconds + p.postSeconds;
      if (window > MAX_CAPTURE_WINDOW_SECONDS) {
        issues.push(`${policy} has a merged capture window of ${window} s (${p.preSeconds} s before + ${p.postSeconds} s after the trigger), over the ${MAX_CAPTURE_WINDOW_SECONDS} s limit`);
      }
    }
    for (const spec of Object.values(config.files)) {
      for (const problem of bindingIssues(s, spec)) issues.push(`${code}: ${spec.name}: ${problem}`);
    }
    for (const [dataKey, versionId] of Object.entries(config.references)) {
      const owner = s.dataItems[dataKey]?.ownerGroupId;
      const ownerSpec = owner ? finalSet[owner]?.files[dataKey] : undefined;
      const pinned = s.fileSpecVersions[versionId];
      const name = pinned ? `${pinned.content.name} v${pinned.version}` : dataKey;
      // A reference reads what the owner collects, so the owner must collect it in this set.
      if (!ownerSpec) issues.push(`${code}: references ${name}, which its owner group neither released nor merges here`);
      else if (pinned && digestOf(ownerSpec) !== pinned.digest) issues.push(`${code}: references ${name}, but the owner’s merged definition differs; re-pin the reference`);
    }
  }
  return issues;
}

/** Recomputes the derived review flag of merged files; an earlier committed requirement stays. */
function recomputeReview(s: State, config: GroupConfig): void {
  for (const [dataKey, spec] of Object.entries(config.files)) {
    spec.requiresReview =
      requiresSensitiveReview({
        fileType: spec.fileType,
        privacy: spec.privacy,
        contentTags: spec.contentTags,
        templateRequiresReview: s.templates[spec.templateId]?.requiresReview ?? true,
        pattern: spec.source.pattern,
      }) || reviewRequiredBefore(s, dataKey);
  }
}

/**
 * Previews merging Verified Features (and, for the whole vehicle, subsystem releases) onto the
 * current target set. A subsystem merge covers one domain and builds on the domain's current
 * subsystem release by itself. Supersedes older previews of the same workspace and scope.
 */
export function previewMerge(ctx: Ctx, input: { workspaceId: string; featureIds: string[]; subsystemReleaseIds?: string[]; scope?: Scope }): string {
  const ws = getWorkspace(ctx.s, input.workspaceId);
  const scope = input.scope ?? defaultScope(ws);
  ctx.allow('merge.manage', { type: 'mergePlan', workspaceId: ws.id, scope });
  if (!isMergeWorkspace(ctx.s, ws.id)) throw rule('NOT_A_MERGE_WORKSPACE', 'merges run in a project workspace, or an integration workspace with team sources');
  if (!ws.scopes.includes(scope)) throw rule('SCOPE_OUTSIDE_WORKSPACE', `this workspace integrates ${ws.scopes.join(', ')}, not ${scope}`);
  const allowed = new Set(verifiedSources(ctx.s, ws.id, scope).map((f) => f.id));
  const features = input.featureIds.map((id) => {
    const f = ctx.s.features[id];
    if (!f) throw notFound('feature', id);
    if (!allowed.has(id)) {
      if (verifiedSources(ctx.s, ws.id, 'Vehicle').some((x) => x.id === id)) {
        throw rule('CROSS_DOMAIN_SOURCE', `${f.name} belongs to the ${ctx.s.groups[f.groupId]?.domain} domain, outside this ${scope} merge`);
      }
      throw rule('SOURCE_NOT_ALLOWED', `${f.name} is not a Verified Feature from this workspace’s sources`);
    }
    return f;
  });
  let subsystems: SubsystemRelease[];
  if (scope === 'Vehicle') {
    const collectible = new Set(collectibleSubsystems(ctx.s, ws.id).map((r) => r.id));
    subsystems = (input.subsystemReleaseIds ?? []).map((id) => {
      const r = ctx.s.subsystemReleases[id];
      if (!r) throw notFound('subsystem release', id);
      if (!collectible.has(id)) throw rule('SOURCE_NOT_ALLOWED', `${r.label} is not an active subsystem release from this workspace’s sources`);
      return r;
    });
  } else {
    if (input.subsystemReleaseIds?.length) throw rule('SUBSYSTEM_NOT_ALLOWED', 'a subsystem merge takes Features; it builds on its domain’s current subsystem release by itself');
    if (features.length === 0) throw rule('NO_SOURCES', 'choose Verified Features to merge');
    const chain = currentSubsystem(ctx.s, ws.vehicleModelId, scope);
    subsystems = chain ? [chain] : [];
  }
  if (features.length === 0 && subsystems.length === 0) throw rule('NO_SOURCES', 'choose Verified Features or subsystem releases to merge');
  const release = latestRelease(ctx.s, ws.vehicleModelId);
  const refs: SubsystemRef[] = subsystems.map((r) => ({ subsystemReleaseId: r.id, groups: { ...r.groups } }));
  const byGroup = new Map<string, MergeSource[]>();
  const add = (groupId: string, src: MergeSource) => byGroup.set(groupId, [...(byGroup.get(groupId) ?? []), src]);
  // Published subsystem changes first, then the Features.
  for (const ref of refs) for (const [groupId, src] of subsystemSources(ctx.s, ref)) add(groupId, src);
  for (const f of features) add(f.groupId, { sourceId: f.id, base: baseConfig(ctx.s, f), theirs: commitSnapshot(ctx.s, f.headCommitId!) });

  const merged: Record<string, GroupConfig> = {};
  const conflicts: MergeConflict[] = [];
  for (const [groupId, sources] of byGroup) {
    const result = mergeGroup(targetConfig(ctx.s, release, groupId), sources);
    recomputeReview(ctx.s, result.merged);
    merged[groupId] = result.merged;
    for (const { sourceIds, ...c } of result.conflicts) {
      conflicts.push({
        ...c,
        featureIds: sourceIds.filter((id) => id in ctx.s.features),
        subsystemReleaseIds: sourceIds.filter((id) => id in ctx.s.subsystemReleases),
        groupId,
        owner: PROCESSING_FIELDS.has(c.field) ? 'DCL' : 'BUSINESS',
      });
    }
  }
  const finalSet: Record<string, GroupConfig> = {};
  for (const [g, commitId] of Object.entries(targetGroups(ctx.s, release))) finalSet[g] = commitSnapshot(ctx.s, commitId);
  Object.assign(finalSet, merged);
  const issues = conflicts.length ? [] : setIssues(ctx.s, finalSet);
  const sources = features.map((f) => ({ featureId: f.id, commitId: f.headCommitId! }));

  for (const p of Object.values(ctx.s.mergePlans)) {
    if (p.workspaceId === ws.id && p.scope === scope && ['READY', 'CONFLICT', 'BLOCKED'].includes(p.status)) p.status = 'SUPERSEDED';
  }
  const id = newId('mp');
  ctx.s.mergePlans[id] = {
    id,
    workspaceId: ws.id,
    vehicleModelId: ws.vehicleModelId,
    scope,
    targetReleaseId: release?.id ?? null,
    sources,
    subsystems: refs,
    status: conflicts.length ? 'CONFLICT' : issues.length ? 'BLOCKED' : 'READY',
    merged,
    conflicts,
    issues,
    digest: digestOf({ target: release?.id ?? null, scope, sources, subsystems: refs, merged }),
    createdBy: ctx.user().username,
    createdAt: ctx.now,
  };
  return id;
}

export type GroupChange = 'ADDED' | 'CHANGED' | 'REMOVED' | 'INHERITED' | 'EMPTY';

export interface PlanGroup {
  groupId: string;
  /** ADDED: new to the set; INHERITED: unchanged from the target; EMPTY: no configuration at all. */
  change: GroupChange;
  diff: ConfigDiff;
  /** Items carried over unchanged from the target. */
  inherited: number;
}

const itemCount = (c: GroupConfig) => Object.keys(c.files).length + Object.keys(c.policies).length + Object.keys(c.references).length;

/** Every group of the workspace and of the final set, with how the merge changes it. */
export function planGroups(s: State, plan: MergePlan): PlanGroup[] {
  const release = plan.targetReleaseId ? s.releases[plan.targetReleaseId] : undefined;
  const ids = new Set([...(s.workspaces[plan.workspaceId]?.groupIds ?? []), ...Object.keys(release?.groups ?? {}), ...Object.keys(plan.merged)]);
  return [...ids].sort().map((groupId) => {
    const commitId = release?.groups[groupId];
    const before = commitId ? commitSnapshot(s, commitId) : emptyConfig();
    const after = plan.merged[groupId] ?? before;
    const diff = diffConfig(before, after);
    const changedItems = (['files', 'policies', 'references'] as const).reduce((n, k) => n + diff[k].removed.length + diff[k].changed.length, 0);
    const inherited = itemCount(before) - changedItems;
    let change: GroupChange;
    if (diff.empty) change = itemCount(before) > 0 ? 'INHERITED' : 'EMPTY';
    else if (itemCount(before) === 0) change = 'ADDED';
    else if (itemCount(after) === 0) change = 'REMOVED';
    else change = 'CHANGED';
    return { groupId, change, diff, inherited };
  });
}

export function getPlan(s: State, id: string): MergePlan {
  const p = s.mergePlans[id];
  if (!p) throw notFound('merge plan', id);
  return p;
}

export interface ProcessingLine {
  groupId: string;
  dataKey: string;
  owned: boolean;
  name: string;
  fileType: string;
  format: string;
  schema: string;
  edgePipelineId: string;
  cloudPipelineId: string;
  requiresReview: boolean;
  /** Sensitive approval of the file in its source Feature’s context, if reviewed there. */
  review: ReviewItem | null;
}

/** What DCL confirms: every file of the merged groups with its binding and review status. */
export function processingSummary(s: State, plan: MergePlan): ProcessingLine[] {
  const lines: ProcessingLine[] = [];
  for (const [groupId, config] of Object.entries(plan.merged)) {
    const files = resolveFiles(s, config);
    // The merged content itself must carry an approval: content that only arises from merging
    // was never reviewed, so its signatures match nothing.
    // Approvals were given to the Features in their own workspaces, including those a subsystem release carries.
    const contributors = [...plan.sources.map((x) => x.featureId), ...plan.subsystems.flatMap((x) => s.subsystemReleases[x.subsystemReleaseId]?.features.map((f) => f.featureId) ?? [])];
    const scopes = [...new Set(contributors.map((id) => s.features[id]).filter((f): f is Feature => !!f && f.groupId === groupId).map((f) => f.workspaceId))];
    const perScope = scopes.map((workspaceId) => reviewItems(s, config, { groupId, workspaceId }));
    const best = (dataKey: string) => {
      const items = perScope.map((list) => list.find((r) => r.dataKey === dataKey)).filter((r): r is ReviewItem => !!r);
      return items.find((r) => r.status === 'APPROVED') ?? items[0] ?? null;
    };
    for (const [dataKey, spec] of Object.entries(files)) {
      lines.push({
        groupId,
        dataKey,
        owned: dataKey in config.files,
        name: spec.name,
        fileType: spec.fileType,
        format: spec.format,
        schema: spec.schema,
        edgePipelineId: spec.edgePipelineId,
        cloudPipelineId: spec.cloudPipelineId,
        requiresReview: spec.requiresReview,
        review: best(dataKey),
      });
    }
  }
  return lines;
}

export function isConfirmed(s: State, plan: MergePlan): boolean {
  return s.processingConfirmations.some((c) => c.mergePlanId === plan.id && c.digest === plan.digest);
}

/** DCL engineering confirms the final processing set of a ready preview. */
export function confirmProcessing(ctx: Ctx, planId: string, input: { note: string }): void {
  const plan = getPlan(ctx.s, planId);
  const groups = Object.keys(plan.merged);
  ctx.allow('merge.confirmProcessing', { type: 'mergePlan', id: plan.id, workspaceId: plan.workspaceId, groupId: groups.length === 1 ? groups[0]! : WILDCARD });
  if (plan.status !== 'READY') throw rule('PLAN_NOT_READY', 'only a conflict-free, unblocked preview can be confirmed');
  const unreviewed = processingSummary(ctx.s, plan).filter((l) => l.requiresReview && l.review?.status !== 'APPROVED');
  if (unreviewed.length) {
    throw rule('UNAPPROVED_SENSITIVE_FILES', 'sensitive files in the set lack an approval', { issues: unreviewed.map((l) => `${ctx.s.groups[l.groupId]?.code}: ${l.name}`) });
  }
  if (isConfirmed(ctx.s, plan)) throw conflict('ALREADY_CONFIRMED', 'this preview is already confirmed');
  ctx.s.processingConfirmations.push({ id: newId('pc'), mergePlanId: plan.id, digest: plan.digest, note: input.note.trim(), confirmedBy: ctx.user().username, createdAt: ctx.now });
}

/** Creates (or reuses) an immutable commit holding a merged group configuration. */
function mergeCommit(ctx: Ctx, plan: MergePlan, groupId: string, config: GroupConfig, label: string): string {
  const source = plan.sources.map((x) => ctx.s.features[x.featureId]!).find((f) => f.groupId === groupId && sameConfig(commitSnapshot(ctx.s, f.headCommitId!), config));
  if (source) return source.headCommitId!;
  // Unchanged content of a published subsystem keeps the subsystem's commit.
  const published = plan.subsystems.map((x) => x.groups[groupId]).find((id): id is string => !!id && sameConfig(commitSnapshot(ctx.s, id), config));
  if (published) return published;
  const entries = Object.entries(config.files).map(([dataKey, spec]) => ({ dataKey, spec: fileSpecVersion(ctx, dataKey, spec) }));
  for (const [dataKey, versionId] of Object.entries(config.references)) {
    const v = ctx.s.fileSpecVersions[versionId]!;
    entries.push({ dataKey, spec: { id: v.id, digest: v.digest } });
  }
  const manifest = manifestVersion(ctx, groupId, entries);
  const policies: Record<string, string> = {};
  const digests: [string, string][] = [];
  for (const policyId of Object.keys(config.policies).sort()) {
    const v = policyVersion(ctx, policyId, config.policies[policyId]!);
    policies[policyId] = v.id;
    digests.push([policyId, v.digest]);
  }
  const id = newId('cm');
  const parent = plan.targetReleaseId ? (ctx.s.releases[plan.targetReleaseId]?.groups[groupId] ?? null) : null;
  ctx.s.commits[id] = {
    id,
    seq: ctx.seq(),
    featureId: null,
    mergeLabel: label,
    groupId,
    parentCommitId: parent,
    sequence: Object.values(ctx.s.commits).filter((c) => c.groupId === groupId && c.featureId === null).length + 1,
    baseReleaseId: plan.targetReleaseId,
    manifestVersionId: manifest.id,
    policies,
    digest: digestOf({ groupId, baseReleaseId: plan.targetReleaseId, manifest: manifest.digest, policies: digests }),
    message: `merge of ${plan.sources.length + plan.subsystems.length} source(s)`,
    author: ctx.user().username,
    createdAt: ctx.now,
  };
  return id;
}

/** Freezes the complete set as a candidate. Its tests start from zero. */
export function freezeCandidate(ctx: Ctx, planId: string, input: { label: string }): string {
  const plan = getPlan(ctx.s, planId);
  ctx.allow('merge.manage', { type: 'mergePlan', id: plan.id, workspaceId: plan.workspaceId, scope: plan.scope });
  if (plan.status !== 'READY') throw rule('PLAN_NOT_READY', 'only a conflict-free, unblocked preview can be frozen');
  if (!isConfirmed(ctx.s, plan)) throw rule('PROCESSING_NOT_CONFIRMED', 'DCL engineering must confirm the final processing set first');
  if ((latestRelease(ctx.s, plan.vehicleModelId)?.id ?? null) !== plan.targetReleaseId) {
    throw rule('TARGET_CHANGED', 'a newer release was published; preview the merge again');
  }
  for (const src of plan.sources) {
    const f = ctx.s.features[src.featureId]!;
    if (!isCollectible(ctx.s, f) || f.headCommitId !== src.commitId) throw rule('SOURCE_CHANGED', `${f.name} changed since the preview; preview the merge again`);
  }
  for (const ref of plan.subsystems) {
    const r = ctx.s.subsystemReleases[ref.subsystemReleaseId];
    const usable = plan.scope === 'Vehicle' ? r?.status === 'ACTIVE' : r?.status === 'ACTIVE' || r?.status === 'INTEGRATING';
    if (!usable) throw rule('SOURCE_CHANGED', `${r?.label ?? ref.subsystemReleaseId} changed since the preview; preview the merge again`);
  }
  const open = Object.values(ctx.s.candidates).find((c) => c.workspaceId === plan.workspaceId && c.scope === plan.scope && ['CANDIDATE', 'TESTING', 'VERIFIED'].includes(c.status));
  if (open) throw rule('CANDIDATE_OPEN', `candidate ${open.label} is still open; release or cancel it first`);
  // Candidates are tested in an integration workspace covering their scope: this one, or the one
  // taking the project as source.
  const ws = ctx.s.workspaces[plan.workspaceId]!;
  const testWs =
    ws.kind === 'INTEGRATION' && ws.scopes.includes(plan.scope)
      ? ws
      : Object.values(ctx.s.workspaces).find((w) => w.kind === 'INTEGRATION' && w.status === 'ACTIVE' && w.sourceWorkspaceIds.includes(plan.workspaceId) && w.scopes.includes(plan.scope));
  if (!testWs) throw rule('NO_INTEGRATION_WORKSPACE', 'no integration workspace takes this project workspace as its source');
  const label = input.label.trim();
  if (!label) throw rule('LABEL_REQUIRED', 'name the candidate');

  const groups: Record<string, string> = plan.targetReleaseId ? { ...ctx.s.releases[plan.targetReleaseId]!.groups } : {};
  for (const [groupId, config] of Object.entries(plan.merged)) groups[groupId] = mergeCommit(ctx, plan, groupId, config, label);
  const id = newId('cd');
  const resolvedConfigId = resolveConfig(ctx, { vehicleModelId: plan.vehicleModelId, kind: 'CANDIDATE', sourceId: id, baseReleaseId: plan.targetReleaseId, groups, label: `${label} (candidate)` });
  const candidate: Candidate = {
    id,
    label,
    workspaceId: plan.workspaceId,
    testWorkspaceId: testWs.id,
    vehicleModelId: plan.vehicleModelId,
    mergePlanId: plan.id,
    targetReleaseId: plan.targetReleaseId,
    groups,
    scope: plan.scope,
    sources: plan.sources.map((x) => ({ ...x })),
    subsystems: plan.subsystems.map((x) => ({ ...x, groups: { ...x.groups } })),
    resolvedConfigId,
    status: 'CANDIDATE',
    createdBy: ctx.user().username,
    createdAt: ctx.now,
    verifiedBy: null,
    verifiedAt: null,
  };
  ctx.s.candidates[id] = candidate;
  ctx.s.mergePlans[plan.id]!.status = 'FROZEN';
  for (const src of plan.sources) {
    const f = ctx.s.features[src.featureId]!;
    f.stage = 'INTEGRATED';
    f.updatedAt = ctx.now;
  }
  // A whole-vehicle candidate takes its subsystem releases out of collection while it is open.
  if (plan.scope === 'Vehicle') for (const ref of plan.subsystems) ctx.s.subsystemReleases[ref.subsystemReleaseId]!.status = 'INTEGRATING';
  return id;
}

/** Cancels an unreleased candidate; its source Features become Verified again. */
export function cancelCandidate(ctx: Ctx, candidateId: string, input: { reason: string }): void {
  const c = ctx.s.candidates[candidateId];
  if (!c) throw notFound('candidate', candidateId);
  ctx.allow('merge.manage', { type: 'candidate', id: c.id, workspaceId: c.workspaceId, scope: c.scope });
  if (!['CANDIDATE', 'TESTING', 'VERIFIED'].includes(c.status)) throw rule('CANDIDATE_CLOSED', 'the candidate is already closed');
  if (!input.reason.trim()) throw rule('REASON_REQUIRED', 'give a reason');
  c.status = 'CANCELLED';
  for (const src of c.sources) {
    const f = ctx.s.features[src.featureId]!;
    if (f.stage === 'INTEGRATED' && f.headCommitId === src.commitId) {
      f.stage = sameConfig(f.draft as GroupConfig, commitSnapshot(ctx.s, src.commitId)) ? 'VERIFIED' : 'DRAFT';
      f.updatedAt = ctx.now;
    }
  }
  // Its subsystem releases can be collected again, unless a newer one of the domain replaced them.
  if (c.scope === 'Vehicle') {
    for (const ref of c.subsystems) {
      const r = ctx.s.subsystemReleases[ref.subsystemReleaseId];
      if (r?.status !== 'INTEGRATING') continue;
      const newer = Object.values(ctx.s.subsystemReleases).some((x) => x.vehicleModelId === r.vehicleModelId && x.domain === r.domain && x.sequence > r.sequence && x.status !== 'SUPERSEDED');
      r.status = newer ? 'SUPERSEDED' : 'ACTIVE';
    }
  }
}

/**
 * Publishes a verified subsystem candidate as the domain's subsystem release (子系统发布): an input
 * to whole-vehicle integration, never a DCL version or a production target.
 */
export function publishSubsystem(ctx: Ctx, candidateId: string, input: { notes?: string } = {}): string {
  const c = ctx.s.candidates[candidateId];
  if (!c) throw notFound('candidate', candidateId);
  if (c.scope === 'Vehicle') throw rule('NOT_A_SUBSYSTEM_CANDIDATE', 'a whole-vehicle candidate is promoted to a DCL release, not published as a subsystem');
  ctx.allow('subsystem.publish', { type: 'candidate', id: c.id, workspaceId: c.workspaceId, scope: c.scope });
  if (c.status !== 'VERIFIED') throw rule('CANDIDATE_NOT_VERIFIED', 'only a candidate verified by integration testing can be published');
  const blockers = candidateVerifyBlockers(ctx.s, c);
  if (blockers.length) throw rule('VERIFY_BLOCKED', 'the candidate’s current tests no longer verify it', { issues: blockers });
  const plan = ctx.s.mergePlans[c.mergePlanId];
  if (!plan || !isConfirmed(ctx.s, plan)) throw rule('PROCESSING_NOT_CONFIRMED', 'DCL engineering has not confirmed this processing set');
  if ((latestRelease(ctx.s, c.vehicleModelId)?.id ?? null) !== c.targetReleaseId) {
    throw rule('TARGET_CHANGED', 'a newer release was published after this candidate was frozen; integrate again');
  }
  const domain = c.scope as Domain;
  const base = c.targetReleaseId ? ctx.s.releases[c.targetReleaseId]!.groups : {};
  const groups = Object.fromEntries(Object.entries(c.groups).filter(([g, commitId]) => base[g] !== commitId));
  // Everything it contains: the Features of the release it builds on, then its own.
  const features = new Map<string, { featureId: string; commitId: string }>();
  for (const ref of c.subsystems) for (const f of ctx.s.subsystemReleases[ref.subsystemReleaseId]?.features ?? []) features.set(f.featureId, { ...f });
  for (const f of c.sources) features.set(f.featureId, { ...f });
  const line = Object.values(ctx.s.subsystemReleases).filter((r) => r.vehicleModelId === c.vehicleModelId && r.domain === domain);
  const sequence = line.length + 1;
  const id = newId('ss');
  ctx.s.subsystemReleases[id] = {
    id,
    label: `${domain}-S${sequence}`,
    domain,
    vehicleModelId: c.vehicleModelId,
    workspaceId: c.workspaceId,
    candidateId: c.id,
    resolvedConfigId: c.resolvedConfigId,
    baseReleaseId: c.targetReleaseId,
    groups,
    features: [...features.values()],
    supersedesId: c.subsystems[0]?.subsystemReleaseId ?? null,
    sequence,
    status: 'ACTIVE',
    notes: input.notes?.trim() ?? '',
    publishedBy: ctx.user().username,
    publishedAt: ctx.now,
  };
  for (const r of line) if (r.status === 'ACTIVE') r.status = 'SUPERSEDED';
  ctx.s.candidates[c.id]!.status = 'RELEASED';
  return id;
}
