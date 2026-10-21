// Configuration integration (配置集成): three-way merge preview of Verified Features onto the
// target set, DCL confirmation of the final processing set, and freezing a complete candidate.

import { digestOf } from '../domain/canonical.ts';
import { capturableKeys, emptyConfig, sameConfig } from '../domain/config.ts';
import type { GroupConfig } from '../domain/config.ts';
import { conflict, notFound, rule } from '../domain/errors.ts';
import { requiresSensitiveReview } from '../domain/file-types.ts';
import { newId } from '../domain/ids.ts';
import { mergeGroup, PROCESSING_FIELDS } from '../domain/merge.ts';
import { WILDCARD } from '../domain/vocabulary.ts';
import { reviewItems } from './approvals.ts';
import type { ReviewItem } from './approvals.ts';
import { baseConfig, fileSpecVersion, latestRelease, manifestVersion, policyVersion } from './config.ts';

export { latestRelease };
import type { Ctx } from './engine.ts';
import { getWorkspace } from './org.ts';
import { bindingIssues } from './processing.ts';
import { commitSnapshot, resolveFiles } from './snapshots.ts';
import type { Candidate, Feature, MergeConflict, MergePlan, Release, State } from './types.ts';
import { resolveConfig } from './validation.ts';

/** Verified Features a project workspace may collect: from its declared sources, same vehicle model. */
export function verifiedSources(s: State, workspaceId: string): Feature[] {
  const ws = s.workspaces[workspaceId];
  if (!ws) return [];
  const allowed = new Set([ws.id, ...ws.sourceWorkspaceIds]);
  return Object.values(s.features)
    .filter((f) => allowed.has(f.workspaceId) && f.vehicleModelId === ws.vehicleModelId && f.stage === 'VERIFIED' && f.verifiedCommitId === f.headCommitId)
    .sort((a, b) => a.groupId.localeCompare(b.groupId) || a.name.localeCompare(b.name));
}

function targetGroups(s: State, release: Release | undefined): Record<string, string> {
  return release ? { ...release.groups } : {};
}

function targetConfig(s: State, release: Release | undefined, groupId: string): GroupConfig {
  const commitId = release?.groups[groupId];
  return commitId ? commitSnapshot(s, commitId) : emptyConfig();
}

/** Problems with the complete set after merging: captures, bindings, consistent reference pins. */
function setIssues(s: State, finalSet: Record<string, GroupConfig>): string[] {
  const issues: string[] = [];
  for (const [groupId, config] of Object.entries(finalSet)) {
    const code = s.groups[groupId]?.code ?? groupId;
    const keys = capturableKeys(config);
    for (const [policyId, p] of Object.entries(config.policies)) {
      for (const k of p.captures) if (!keys.has(k)) issues.push(`${code}: policy ${policyId} captures ${k}, which is not in the merged file list`);
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

/** Recomputes the derived review flag of merged files. */
function recomputeReview(s: State, config: GroupConfig): void {
  for (const spec of Object.values(config.files)) {
    spec.requiresReview = requiresSensitiveReview({
      fileType: spec.fileType,
      privacy: spec.privacy,
      contentTags: spec.contentTags,
      templateRequiresReview: s.templates[spec.templateId]?.requiresReview ?? true,
      pattern: spec.source.pattern,
    });
  }
}

/** Previews merging Verified Features onto the current target set. Supersedes older previews. */
export function previewMerge(ctx: Ctx, input: { workspaceId: string; featureIds: string[] }): string {
  ctx.allow('merge.manage', { type: 'mergePlan', workspaceId: input.workspaceId, scope: 'Vehicle' });
  const ws = getWorkspace(ctx.s, input.workspaceId);
  if (ws.kind !== 'PROJECT') throw rule('NOT_A_PROJECT_WORKSPACE', 'integration merges run in a project workspace');
  if (input.featureIds.length === 0) throw rule('NO_SOURCES', 'choose Verified Features to merge');
  const allowed = new Set(verifiedSources(ctx.s, ws.id).map((f) => f.id));
  const features = input.featureIds.map((id) => {
    const f = ctx.s.features[id];
    if (!f) throw notFound('feature', id);
    if (!allowed.has(id)) throw rule('SOURCE_NOT_ALLOWED', `${f.name} is not a Verified Feature from this workspace’s sources`);
    return f;
  });
  const release = latestRelease(ctx.s, ws.vehicleModelId);
  const byGroup = new Map<string, Feature[]>();
  for (const f of features) byGroup.set(f.groupId, [...(byGroup.get(f.groupId) ?? []), f]);

  const merged: Record<string, GroupConfig> = {};
  const conflicts: MergeConflict[] = [];
  for (const [groupId, sources] of byGroup) {
    const result = mergeGroup(
      targetConfig(ctx.s, release, groupId),
      sources.map((f) => ({ featureId: f.id, base: baseConfig(ctx.s, f), theirs: commitSnapshot(ctx.s, f.headCommitId!) })),
    );
    recomputeReview(ctx.s, result.merged);
    merged[groupId] = result.merged;
    for (const c of result.conflicts) conflicts.push({ ...c, groupId, owner: PROCESSING_FIELDS.has(c.field) ? 'DCL' : 'BUSINESS' });
  }
  const finalSet: Record<string, GroupConfig> = {};
  for (const [g, commitId] of Object.entries(targetGroups(ctx.s, release))) finalSet[g] = commitSnapshot(ctx.s, commitId);
  Object.assign(finalSet, merged);
  const issues = conflicts.length ? [] : setIssues(ctx.s, finalSet);
  const sources = features.map((f) => ({ featureId: f.id, commitId: f.headCommitId! }));

  for (const p of Object.values(ctx.s.mergePlans)) {
    if (p.workspaceId === ws.id && ['READY', 'CONFLICT', 'BLOCKED'].includes(p.status)) p.status = 'SUPERSEDED';
  }
  const id = newId('mp');
  ctx.s.mergePlans[id] = {
    id,
    workspaceId: ws.id,
    vehicleModelId: ws.vehicleModelId,
    targetReleaseId: release?.id ?? null,
    sources,
    status: conflicts.length ? 'CONFLICT' : issues.length ? 'BLOCKED' : 'READY',
    merged,
    conflicts,
    issues,
    digest: digestOf({ target: release?.id ?? null, sources, merged }),
    createdBy: ctx.user().username,
    createdAt: ctx.now,
  };
  return id;
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
    const scopes = [...new Set(plan.sources.map((x) => s.features[x.featureId]!).filter((f) => f.groupId === groupId).map((f) => f.workspaceId))];
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
    message: `merge of ${plan.sources.length} source(s)`,
    author: ctx.user().username,
    createdAt: ctx.now,
  };
  return id;
}

/** Freezes the complete set as a candidate. Its tests start from zero. */
export function freezeCandidate(ctx: Ctx, planId: string, input: { label: string }): string {
  const plan = getPlan(ctx.s, planId);
  ctx.allow('merge.manage', { type: 'mergePlan', id: plan.id, workspaceId: plan.workspaceId, scope: 'Vehicle' });
  if (plan.status !== 'READY') throw rule('PLAN_NOT_READY', 'only a conflict-free, unblocked preview can be frozen');
  if (!isConfirmed(ctx.s, plan)) throw rule('PROCESSING_NOT_CONFIRMED', 'DCL engineering must confirm the final processing set first');
  if ((latestRelease(ctx.s, plan.vehicleModelId)?.id ?? null) !== plan.targetReleaseId) {
    throw rule('TARGET_CHANGED', 'a newer release was published; preview the merge again');
  }
  for (const src of plan.sources) {
    const f = ctx.s.features[src.featureId]!;
    if (f.stage !== 'VERIFIED' || f.headCommitId !== src.commitId) throw rule('SOURCE_CHANGED', `${f.name} changed since the preview; preview the merge again`);
  }
  const open = Object.values(ctx.s.candidates).find((c) => c.workspaceId === plan.workspaceId && ['CANDIDATE', 'TESTING', 'VERIFIED'].includes(c.status));
  if (open) throw rule('CANDIDATE_OPEN', `candidate ${open.label} is still open; release or cancel it first`);
  const testWs = Object.values(ctx.s.workspaces).find((w) => w.kind === 'INTEGRATION' && w.status === 'ACTIVE' && w.sourceWorkspaceIds.includes(plan.workspaceId));
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
    sources: plan.sources.map((x) => ({ ...x })),
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
  return id;
}

/** Cancels an unreleased candidate; its source Features become Verified again. */
export function cancelCandidate(ctx: Ctx, candidateId: string, input: { reason: string }): void {
  const c = ctx.s.candidates[candidateId];
  if (!c) throw notFound('candidate', candidateId);
  ctx.allow('merge.manage', { type: 'candidate', id: c.id, workspaceId: c.workspaceId, scope: 'Vehicle' });
  if (!['CANDIDATE', 'TESTING', 'VERIFIED'].includes(c.status)) throw rule('CANDIDATE_CLOSED', 'the candidate is already closed');
  if (!input.reason.trim()) throw rule('REASON_REQUIRED', 'give a reason');
  c.status = 'CANCELLED';
  for (const src of c.sources) {
    const f = ctx.s.features[src.featureId]!;
    if (f.stage === 'INTEGRATED' && f.headCommitId === src.commitId) {
      f.stage = 'VERIFIED';
      f.updatedAt = ctx.now;
    }
  }
}
