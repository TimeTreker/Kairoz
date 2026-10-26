// Config authoring. A Feature (研发分支) holds a full working copy of its group's file list and
// policies, plus read-only references to other groups' files. Saving the draft never creates
// versions; submitting creates immutable, content-addressed FileSpec / Policy / Manifest
// versions and a commit. Unchanged content is reused.

import type { Draft } from 'immer';
import type { Action } from '../domain/authz.ts';
import { canReadGroupConfig } from '../domain/authz.ts';
import { digestOf } from '../domain/canonical.ts';
import {
  assertPolicyIdForGroup,
  capturableKeys,
  diffConfig,
  emptyConfig,
  normalizePolicy,
  normalizeTags,
  policyIssues,
  sameConfig,
} from '../domain/config.ts';
import type { ConfigDiff, FileSpecContent, GroupConfig, PolicyContent, Priority } from '../domain/config.ts';
import { dataCodeStem, globsIntersect, normalizeSource } from '../domain/data-source.ts';
import { conflict, ForbiddenError, notFound, rule } from '../domain/errors.ts';
import { assertNotDowngraded, inferFileType, requiresSensitiveReview } from '../domain/file-types.ts';
import type { FileType, Privacy } from '../domain/file-types.ts';
import { FEATURE_NAME, newId } from '../domain/ids.ts';
import { WILDCARD } from '../domain/vocabulary.ts';
import { intakeStage, reviewItems } from './approvals.ts';
import type { Actor, Ctx } from './engine.ts';
import { getGroup, getWorkspace } from './org.ts';
import { bindingIssues, currentTemplate } from './processing.ts';
import { approvedReference } from './references.ts';
import { commitSnapshot, latestCommittedVersion, resolveFiles } from './snapshots.ts';
import { stageAfterIntake } from './stages.ts';
import type { BusinessGroup, Feature, FeatureStage, FeedbackKind, Release, State } from './types.ts';

/** Stages in which the draft may change. Changing it always returns the Feature to DRAFT. */
export const EDITABLE_STAGES: readonly FeatureStage[] = ['DRAFT', 'SUBMITTED', 'DCL_READY', 'TESTING', 'VERIFIED'];

/** Feedback kinds that ask the authors for changes: an unchanged resubmit is refused. */
const CHANGE_REQUESTS: readonly FeedbackKind[] = ['RETURNED', 'BINDING_CHANGED', 'REFERENCE_REVOKED'];

/** Whether DCL or a data owner asked for changes to the Feature's head commit. */
export function headChangesRequested(s: State, feature: Pick<Feature, 'id' | 'headCommitId'>): boolean {
  return s.feedback.some((f) => f.featureId === feature.id && f.commitId === feature.headCommitId && CHANGE_REQUESTS.includes(f.kind));
}

export function displayName(s: State, commitId: string): string {
  const c = s.commits[commitId]!;
  const g = s.groups[c.groupId]!;
  const base = c.baseReleaseId ? (s.releases[c.baseReleaseId]?.dclVersion ?? c.baseReleaseId) : 'initial';
  const name = c.featureId ? s.features[c.featureId]!.name : `merge:${c.mergeLabel ?? ''}`;
  return `${base} / ${g.code} / ${name} / r${String(c.sequence).padStart(3, '0')}`;
}

/** The newest formal release of a vehicle model: what new work builds on. */
export function latestRelease(s: State, vehicleModelId: string): Release | undefined {
  return Object.values(s.releases)
    .filter((r) => r.vehicleModelId === vehicleModelId)
    .sort((a, b) => b.sequence - a.sequence)[0];
}

/**
 * The head of the model's mainline (主线): the newest set that is not a patch of an older one.
 * Merges, new Features and new software build on it; same-software patches never move it.
 */
export function mainlineRelease(s: State, vehicleModelId: string): Release | undefined {
  return Object.values(s.releases)
    .filter((r) => r.vehicleModelId === vehicleModelId && r.patchOf === null)
    .sort((a, b) => b.sequence - a.sequence)[0];
}

/** The configuration a Feature starts from. Until a release exists it is the empty initial config. */
export function baseConfig(s: State, feature: Pick<Feature, 'baseReleaseId' | 'groupId'>): GroupConfig {
  if (feature.baseReleaseId === null) return emptyConfig();
  const commitId = s.releases[feature.baseReleaseId]?.groups[feature.groupId];
  return commitId ? commitSnapshot(s, commitId) : emptyConfig();
}

export function getFeature(s: State, id: string): Feature {
  const f = s.features[id];
  if (!f) throw notFound('feature', id);
  return f;
}

// ---------------------------------------------------------------------------
// Read side
// ---------------------------------------------------------------------------

export function canReadFeature(state: State, actor: Actor, feature: Pick<Feature, 'groupId' | 'workspaceId'>): boolean {
  const group = state.groups[feature.groupId];
  return !!group && canReadGroupConfig(actor.grants, { groupId: group.id, domain: group.domain, workspaceId: feature.workspaceId });
}

export function assertCanReadGroup(state: State, actor: Actor, group: BusinessGroup, workspaceId?: string): void {
  const target = { groupId: group.id, domain: group.domain, ...(workspaceId !== undefined ? { workspaceId } : {}) };
  if (!canReadGroupConfig(actor.grants, target)) throw new ForbiddenError('config.read', 'NOT_VISIBLE', { type: 'group', id: group.id, ...target });
}

export function visibleFeatures(state: State, actor: Actor, workspaceId: string): Feature[] {
  return Object.values(state.features)
    .filter((f) => f.workspaceId === workspaceId && canReadFeature(state, actor, f))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/** Changes of the draft relative to the head commit and to the base. */
export function featureChanges(s: State, f: Feature): { sinceHead: ConfigDiff; sinceBase: ConfigDiff } {
  const base = baseConfig(s, f);
  const head = f.headCommitId ? commitSnapshot(s, f.headCommitId) : base;
  return { sinceHead: diffConfig(head, f.draft), sinceBase: diffConfig(base, f.draft) };
}

/**
 * Whether a committed version of the data item needed sensitive review. Lowering the declared
 * privacy or dropping a sensitive tag later cannot lift that requirement.
 */
export function reviewRequiredBefore(s: State, dataKey: string): boolean {
  return Object.values(s.fileSpecVersions).some((v) => v.dataKey === dataKey && v.content.requiresReview);
}

/** Files of the draft (owned or referenced) that need DCL sensitive review. */
export function draftReviewRequired(s: State, f: Feature): string[] {
  const files = resolveFiles(s, f.draft);
  return Object.keys(files)
    .filter((k) => files[k]!.requiresReview)
    .sort();
}

/**
 * Overlap suspects as a business group may see them: its own data keys, plus only a flag for
 * other groups' sources (their keys would reveal hidden source paths).
 */
export function visibleSuspects(s: State, groupId: string, suspects: string[]) {
  return {
    overlapSuspects: suspects.filter((k) => s.dataItems[k]?.ownerGroupId === groupId).sort(),
    overlapsOtherGroups: suspects.some((k) => s.dataItems[k] && s.dataItems[k]!.ownerGroupId !== groupId),
  };
}

// ---------------------------------------------------------------------------
// Feature creation and draft editing
// ---------------------------------------------------------------------------

export function createFeature(ctx: Ctx, input: { workspaceId: string; groupId: string; name: string; description?: string; baseReleaseId?: string | null }): string {
  const group = getGroup(ctx.s, input.groupId);
  ctx.allow('feature.create', { type: 'feature', workspaceId: input.workspaceId, groupId: group.id, scope: group.domain });
  const workspace = getWorkspace(ctx.s, input.workspaceId);
  if (workspace.status !== 'ACTIVE') throw rule('WORKSPACE_ARCHIVED', `workspace ${workspace.id} is archived`);
  if (!workspace.groupIds.includes(group.id)) throw rule('GROUP_NOT_IN_WORKSPACE', `group ${group.id} does not work in workspace ${workspace.id}`);
  if (group.status !== 'ACTIVE') throw rule('GROUP_ARCHIVED', `group ${group.id} is archived`);
  if (group.purpose !== 'DEV') throw rule('TEST_GROUP_CANNOT_OWN_CONFIG', 'test groups do not maintain files or policies');
  if (!FEATURE_NAME.test(input.name)) throw rule('INVALID_FEATURE_NAME', `feature name must match ${FEATURE_NAME.source}`);
  if (Object.values(ctx.s.features).some((f) => f.groupId === group.id && f.name === input.name)) {
    throw conflict('FEATURE_NAME_TAKEN', `group ${group.id} already has a feature named ${input.name}`);
  }
  // A Feature starts on the mainline, or on a set the team names (the base its vehicles' new
  // software takes, or an older set a same-software patch fixes).
  let base = mainlineRelease(ctx.s, workspace.vehicleModelId)?.id ?? null;
  if (input.baseReleaseId) {
    const release = ctx.s.releases[input.baseReleaseId];
    if (!release) throw notFound('policy set', input.baseReleaseId);
    if (release.vehicleModelId !== workspace.vehicleModelId) throw rule('MODEL_MISMATCH', `policy set ${release.dclVersion} is for ${release.vehicleModelId}`);
    base = release.id;
  }
  const id = newId('ft');
  const feature: Feature = {
    id,
    workspaceId: workspace.id,
    groupId: group.id,
    vehicleModelId: workspace.vehicleModelId,
    projectId: workspace.projectId,
    name: input.name,
    description: input.description ?? '',
    kind: 'BUSINESS',
    stage: 'DRAFT',
    baseReleaseId: base,
    headCommitId: null,
    verifiedCommitId: null,
    sequence: 0,
    draft: emptyConfig(),
    createdBy: ctx.user().username,
    createdAt: ctx.now,
    updatedAt: ctx.now,
  };
  feature.draft = baseConfig(ctx.s, feature);
  ctx.s.features[id] = feature;
  return id;
}

type FeatureAction = Extract<Action, `feature.${string}`>;

/** Authorizes against a Feature's workspace and group. */
export function authorizeFeature(ctx: Ctx, action: FeatureAction, featureId: string): { feature: Draft<Feature>; group: BusinessGroup } {
  const feature = getFeature(ctx.s, featureId) as Draft<Feature>;
  const group = getGroup(ctx.s, feature.groupId);
  ctx.allow(action, { type: 'feature', id: featureId, workspaceId: feature.workspaceId, groupId: group.id, scope: group.domain });
  return { feature, group };
}

export function addFeedback(
  ctx: Ctx,
  input: { featureId: string; commitId: string | null; kind: FeedbackKind; dataKey?: string; reason: string },
): void {
  ctx.s.feedback.push({
    id: newId('fb'),
    featureId: input.featureId,
    commitId: input.commitId,
    kind: input.kind,
    dataKey: input.dataKey ?? null,
    reason: input.reason,
    author: ctx.user().username,
    createdAt: ctx.now,
  });
}

/**
 * Shared frame for every draft edit: authorize, check the stage, apply the change, and fall back
 * to DRAFT if content changed. Earlier commits and test evidence remain untouched.
 */
export function editDraft(
  ctx: Ctx,
  featureId: string,
  change: (draft: Draft<GroupConfig>, feature: Draft<Feature>, group: BusinessGroup) => void,
  options: { action?: FeatureAction; feedback?: { kind: FeedbackKind; dataKey?: string; reason: string } } = {},
): void {
  const { feature, group } = authorizeFeature(ctx, options.action ?? 'feature.edit', featureId);
  if (!EDITABLE_STAGES.includes(feature.stage)) throw rule('FEATURE_IMMUTABLE', `feature in stage ${feature.stage} cannot change`);
  if (getWorkspace(ctx.s, feature.workspaceId).status !== 'ACTIVE') throw rule('WORKSPACE_ARCHIVED', 'the workspace is archived');
  const before = JSON.parse(JSON.stringify(feature.draft)) as GroupConfig;
  change(feature.draft, feature, group);
  if (sameConfig(before, feature.draft as GroupConfig)) return;
  feature.stage = 'DRAFT';
  feature.updatedAt = ctx.now;
  if (options.feedback) addFeedback(ctx, { featureId, commitId: feature.headCommitId, ...options.feedback });
}

export interface FileAttributes {
  name: string;
  purpose: string;
  fileType?: FileType;
  privacy?: Privacy;
  retentionDays?: number;
  contentTags?: string[];
  priority?: Priority;
}

function templateFor(s: State, fileType: FileType) {
  const template = currentTemplate(s, fileType);
  if (!template) {
    throw rule('TEMPLATE_MISSING', `no processing template is published for file type ${fileType}; ask DCL engineering`, { fileType });
  }
  return template;
}

function checkAttributes(a: { name: string; purpose: string; retentionDays: number }): void {
  if (a.name.length === 0 || a.name.length > 100) throw rule('INVALID_FILE', 'file name must be 1-100 characters');
  if (a.purpose.length === 0 || a.purpose.length > 500) throw rule('INVALID_FILE', 'purpose must be 1-500 characters');
  if (!Number.isInteger(a.retentionDays) || a.retentionDays < 1 || a.retentionDays > 3650) {
    throw rule('INVALID_FILE', 'retentionDays must be a whole number from 1 to 3650');
  }
}

/** Deletes a never-committed data item that no Feature draft (other than `exceptFeatureId`) uses. */
function releaseIfUnused(s: Draft<State>, dataKey: string, exceptFeatureId: string | null): boolean {
  const item = s.dataItems[dataKey];
  if (!item || (item.status !== 'PENDING' && item.status !== 'REVIEW')) return false;
  if (Object.values(s.features).some((f) => f.id !== exceptFeatureId && dataKey in f.draft.files)) return false;
  if (Object.values(s.fileSpecVersions).some((v) => v.dataKey === dataKey)) return false;
  delete s.dataItems[dataKey];
  return true;
}

function uniqueDataCode(s: State, stem: string): string {
  const taken = new Set(Object.values(s.dataItems).map((d) => d.dataCode));
  if (!taken.has(stem)) return stem;
  for (let n = 2; ; n++) if (!taken.has(`${stem}.${n}`)) return `${stem}.${n}`;
}

/**
 * Adds a file to the draft. An exact source already registered by this group reuses its data_key;
 * one registered by another group cannot be re-created to get around read authorization. A new
 * source gets a fresh data_key; if its pattern overlaps another source it waits for DCL review.
 * Returns the data key.
 */
export function addFile(
  ctx: Ctx,
  featureId: string,
  input: FileAttributes & { source: { unit: string; directory: string; pattern: string } },
): string {
  let dataKey = '';
  editDraft(ctx, featureId, (draft, _feature, group) => {
    const source = normalizeSource(input.source);
    const fileType = input.fileType ?? inferFileType(source.pattern);
    assertNotDowngraded(source.pattern, fileType);
    const template = templateFor(ctx.s, fileType);

    const same = (d: { source: typeof source; status: string }) =>
      d.status !== 'ARCHIVED' && d.source.unit === source.unit && d.source.directory === source.directory && d.source.pattern === source.pattern;
    let existing = Object.values(ctx.s.dataItems).find(same);
    if (existing && existing.ownerGroupId !== group.id && releaseIfUnused(ctx.s, existing.dataKey, null)) existing = undefined;
    if (existing) {
      if (existing.ownerGroupId !== group.id) {
        // The data key is only disclosed to a group that may already reference it.
        const referable = approvedReference(ctx.s, existing.dataKey, group.id);
        throw rule('DATA_SOURCE_OWNED_ELSEWHERE', 'this source is already registered by another group; reference it instead', {
          ownerGroupId: existing.ownerGroupId,
          ...(referable ? { dataKey: existing.dataKey } : {}),
        });
      }
      if (draft.files[existing.dataKey]) throw conflict('FILE_ALREADY_IN_DRAFT', 'this source is already in the draft', { dataKey: existing.dataKey });
      dataKey = existing.dataKey;
    } else {
      const suspects = Object.values(ctx.s.dataItems)
        .filter(
          (n) =>
            n.status !== 'ARCHIVED' &&
            n.source.unit === source.unit &&
            n.source.directory === source.directory &&
            globsIntersect(n.source.pattern, source.pattern),
        )
        .map((n) => n.dataKey);
      dataKey = newId('dk');
      ctx.s.dataItems[dataKey] = {
        dataKey,
        dataCode: uniqueDataCode(ctx.s, dataCodeStem(group.code, source.pattern)),
        ownerGroupId: group.id,
        source,
        status: suspects.length > 0 ? 'REVIEW' : 'PENDING',
        overlapSuspects: suspects,
        reviewNote: null,
        createdBy: ctx.user().username,
        createdAt: ctx.now,
      };
    }
    const privacy = input.privacy ?? template.defaultPrivacy;
    const contentTags = normalizeTags(input.contentTags ?? []);
    const spec: FileSpecContent = {
      name: input.name.trim(),
      source,
      fileType,
      purpose: input.purpose.trim(),
      privacy,
      retentionDays: input.retentionDays ?? template.defaultRetentionDays,
      contentTags,
      priority: input.priority ?? 'NORMAL',
      templateId: template.id,
      format: template.format,
      schema: template.schema,
      edgePipelineId: template.edgePipelineId,
      cloudPipelineId: template.cloudPipelineId,
      requiresReview:
        requiresSensitiveReview({
          fileType,
          privacy,
          contentTags,
          templateRequiresReview: template.requiresReview,
          pattern: source.pattern,
        }) || reviewRequiredBefore(ctx.s, dataKey),
    };
    checkAttributes(spec);
    draft.files[dataKey] = spec;
  });
  return dataKey;
}

/** Edits business attributes. The source is the data identity and cannot change. */
export function updateFile(ctx: Ctx, featureId: string, dataKey: string, input: Partial<FileAttributes>): void {
  editDraft(ctx, featureId, (draft) => {
    const current = draft.files[dataKey];
    if (!current) throw notFound('file in draft', dataKey);
    const fileType = input.fileType ?? current.fileType;
    let binding = {
      templateId: current.templateId,
      format: current.format,
      schema: current.schema,
      edgePipelineId: current.edgePipelineId,
      cloudPipelineId: current.cloudPipelineId,
    };
    let reviewByTemplate: boolean;
    if (fileType !== current.fileType) {
      // A new type takes that type's current default binding.
      assertNotDowngraded(current.source.pattern, fileType);
      const t = templateFor(ctx.s, fileType);
      binding = { templateId: t.id, format: t.format, schema: t.schema, edgePipelineId: t.edgePipelineId, cloudPipelineId: t.cloudPipelineId };
      reviewByTemplate = t.requiresReview;
    } else {
      // Same type keeps its binding (including DCL adjustments) even if a newer template exists.
      reviewByTemplate = ctx.s.templates[current.templateId]?.requiresReview ?? true;
    }
    const privacy = input.privacy ?? current.privacy;
    const contentTags = input.contentTags ? normalizeTags(input.contentTags) : [...current.contentTags];
    const spec: FileSpecContent = {
      ...current,
      ...binding,
      source: { ...current.source },
      name: input.name?.trim() ?? current.name,
      purpose: input.purpose?.trim() ?? current.purpose,
      fileType,
      privacy,
      retentionDays: input.retentionDays ?? current.retentionDays,
      contentTags,
      priority: input.priority ?? current.priority,
      requiresReview:
        requiresSensitiveReview({
          fileType,
          privacy,
          contentTags,
          templateRequiresReview: reviewByTemplate,
          pattern: current.source.pattern,
        }) || reviewRequiredBefore(ctx.s, dataKey),
    };
    checkAttributes(spec);
    draft.files[dataKey] = spec;
  });
}

function assertNotCaptured(draft: GroupConfig, dataKey: string): void {
  const capturing = Object.entries(draft.policies)
    .filter(([, p]) => p.captures.includes(dataKey))
    .map(([id]) => id)
    .sort();
  if (capturing.length > 0) throw rule('FILE_CAPTURED_BY_POLICY', 'remove the file from these policies first', { policyIds: capturing });
}

export function removeFile(ctx: Ctx, featureId: string, dataKey: string): void {
  editDraft(ctx, featureId, (draft) => {
    if (!draft.files[dataKey]) throw notFound('file in draft', dataKey);
    assertNotCaptured(draft as GroupConfig, dataKey);
    delete draft.files[dataKey];
    releaseIfUnused(ctx.s, dataKey, featureId);
  });
}

/** Adds (or re-pins) a read-only reference to the owner's current committed definition. */
export function putReference(ctx: Ctx, featureId: string, dataKey: string): void {
  editDraft(ctx, featureId, (draft, _feature, group) => {
    const item = ctx.s.dataItems[dataKey];
    if (!item) throw notFound('data item', dataKey);
    if (item.ownerGroupId === group.id) throw rule('OWN_DATA_ITEM', 'this group owns the data item; add it as a file instead');
    if (!approvedReference(ctx.s, dataKey, group.id)) {
      throw rule('REFERENCE_NOT_GRANTED', `group ${group.id} has no approved reference to ${dataKey}; request one first`);
    }
    const latest = latestCommittedVersion(ctx.s, dataKey);
    if (!latest) throw rule('NOT_COMMITTED', `data item ${dataKey} has no committed definition yet`);
    draft.references[dataKey] = latest.id;
  });
}

export function removeReference(ctx: Ctx, featureId: string, dataKey: string): void {
  editDraft(ctx, featureId, (draft) => {
    if (!draft.references[dataKey]) throw notFound('reference in draft', dataKey);
    assertNotCaptured(draft as GroupConfig, dataKey);
    delete draft.references[dataKey];
  });
}

/** The group that owns a policy id namespace: the one whose code is the longest dotted prefix. */
function policyNamespaceOwner(s: State, policyId: string): string | undefined {
  return Object.values(s.groups)
    .filter((g) => policyId.startsWith(`${g.code}.`))
    .sort((a, b) => b.code.length - a.code.length)[0]?.id;
}

export function putPolicy(ctx: Ctx, featureId: string, policyId: string, input: Omit<PolicyContent, 'priority'> & { priority?: Priority }): void {
  editDraft(ctx, featureId, (draft, _feature, group) => {
    assertPolicyIdForGroup(policyId, group.code);
    const owner = ctx.s.policyOwners[policyId];
    if (owner && owner !== group.id) throw rule('POLICY_OWNED_ELSEWHERE', `policy ${policyId} is maintained by group ${owner}`);
    if (!owner && policyNamespaceOwner(ctx.s, policyId) !== group.id) {
      throw rule('POLICY_NAMESPACE_TAKEN', `policy id ${policyId} falls in another group's namespace`);
    }
    const content = normalizePolicy({ ...input, priority: input.priority ?? 'NORMAL' });
    const issues = policyIssues(content, capturableKeys(draft as GroupConfig));
    if (issues.length > 0) throw rule('INVALID_POLICY', 'the policy is invalid', { issues });
    draft.policies[policyId] = content;
  });
}

export function removePolicy(ctx: Ctx, featureId: string, policyId: string): void {
  editDraft(ctx, featureId, (draft) => {
    if (!draft.policies[policyId]) throw notFound('policy in draft', policyId);
    delete draft.policies[policyId];
  });
}

// ---------------------------------------------------------------------------
// Submit: immutable versions and commit
// ---------------------------------------------------------------------------

interface VersionRef {
  id: string;
  digest: string;
}

export function fileSpecVersion(ctx: Ctx, dataKey: string, content: FileSpecContent): VersionRef {
  const digest = digestOf(content);
  const existing = Object.values(ctx.s.fileSpecVersions).filter((v) => v.dataKey === dataKey);
  const found = existing.find((v) => v.digest === digest);
  if (found) return found;
  const id = newId('fs');
  ctx.s.fileSpecVersions[id] = {
    id,
    dataKey,
    version: Math.max(0, ...existing.map((v) => v.version)) + 1,
    digest,
    content: JSON.parse(JSON.stringify(content)),
    createdBy: ctx.user().username,
    createdAt: ctx.now,
  };
  return { id, digest };
}

export function policyVersion(ctx: Ctx, policyId: string, content: PolicyContent): VersionRef {
  const digest = digestOf(content);
  const existing = Object.values(ctx.s.policyVersions).filter((v) => v.policyId === policyId);
  const found = existing.find((v) => v.digest === digest);
  if (found) return found;
  const id = newId('pv');
  ctx.s.policyVersions[id] = {
    id,
    policyId,
    version: Math.max(0, ...existing.map((v) => v.version)) + 1,
    digest,
    content: JSON.parse(JSON.stringify(content)),
    createdBy: ctx.user().username,
    createdAt: ctx.now,
  };
  return { id, digest };
}

export function manifestVersion(ctx: Ctx, groupId: string, entries: { dataKey: string; spec: VersionRef }[]): VersionRef {
  const sorted = [...entries].sort((a, b) => (a.dataKey < b.dataKey ? -1 : a.dataKey > b.dataKey ? 1 : 0));
  const digest = digestOf(sorted.map((e) => [e.dataKey, e.spec.digest]));
  const existing = Object.values(ctx.s.manifestVersions).filter((m) => m.groupId === groupId);
  const found = existing.find((m) => m.digest === digest);
  if (found) return found;
  const id = newId('mf');
  ctx.s.manifestVersions[id] = {
    id,
    groupId,
    version: Math.max(0, ...existing.map((m) => m.version)) + 1,
    digest,
    entries: sorted.map((e) => ({ dataKey: e.dataKey, fileSpecVersionId: e.spec.id })),
    createdAt: ctx.now,
  };
  return { id, digest };
}

export interface SubmitIssue {
  kind: 'file' | 'reference' | 'policy';
  key: string;
  problems: string[];
}

export function submitIssues(s: State, group: BusinessGroup, draft: GroupConfig): SubmitIssue[] {
  const issues: SubmitIssue[] = [];
  for (const key of Object.keys(draft.files).sort()) {
    const problems: string[] = [];
    const item = s.dataItems[key];
    if (!item) problems.push('data item does not exist');
    else {
      if (item.ownerGroupId !== group.id) problems.push(`owned by group ${item.ownerGroupId}`);
      if (item.status === 'REVIEW') problems.push('source overlaps another source and awaits DCL review');
      if (item.status === 'ARCHIVED') problems.push('data item was archived as a duplicate');
    }
    problems.push(...bindingIssues(s, draft.files[key]!));
    if (problems.length) issues.push({ kind: 'file', key, problems });
  }
  for (const [key, versionId] of Object.entries(draft.references).sort(([a], [b]) => a.localeCompare(b))) {
    const problems: string[] = [];
    if (s.fileSpecVersions[versionId]?.dataKey !== key) problems.push('pinned version does not belong to this data item');
    if (!approvedReference(s, key, group.id)) problems.push('reference is not (or no longer) granted');
    if (problems.length) issues.push({ kind: 'reference', key, problems });
  }
  const available = capturableKeys(draft);
  for (const [policyId, policy] of Object.entries(draft.policies).sort(([a], [b]) => a.localeCompare(b))) {
    const problems = policyIssues(policy, available);
    const owner = s.policyOwners[policyId];
    if (owner && owner !== group.id) problems.push(`maintained by group ${owner}`);
    if (problems.length) issues.push({ kind: 'policy', key: policyId, problems });
  }
  return issues;
}

export interface SubmitResult {
  commitId: string;
  reused: boolean;
  stage: FeatureStage;
}

export function submitFeature(ctx: Ctx, featureId: string, input: { message?: string } = {}): SubmitResult {
  const { feature, group } = authorizeFeature(ctx, 'feature.submit', featureId);
  if (!EDITABLE_STAGES.includes(feature.stage)) throw rule('FEATURE_IMMUTABLE', `feature in stage ${feature.stage} cannot change`);
  const draft = JSON.parse(JSON.stringify(feature.draft)) as GroupConfig;
  const issues = submitIssues(ctx.s, group, draft);
  if (issues.length > 0) throw rule('SUBMIT_BLOCKED', 'the draft cannot be submitted yet', { issues });
  // DCL Ready at once unless a file needs sensitive review without a current approval.
  const stage = intakeStage(reviewItems(ctx.s, draft, { groupId: group.id, workspaceId: feature.workspaceId }));

  if (feature.headCommitId && sameConfig(draft, commitSnapshot(ctx.s, feature.headCommitId))) {
    // Edited back to the committed content: reuse the head commit instead of creating a duplicate,
    // unless DCL asked for changes to that commit.
    const requested = ctx.s.feedback.filter((f) => f.featureId === feature.id && f.commitId === feature.headCommitId && CHANGE_REQUESTS.includes(f.kind));
    if (requested.length > 0) {
      throw rule('CHANGES_REQUESTED', 'changes were requested on this commit; submit a changed draft', {
        feedback: requested.map((f) => ({ kind: f.kind, reason: f.reason })),
      });
    }
    if (feature.stage === 'DRAFT') {
      feature.stage = stageAfterIntake(ctx.s, feature, stage);
      feature.updatedAt = ctx.now;
    }
    return { commitId: feature.headCommitId, reused: true, stage: feature.stage };
  }
  if (!feature.headCommitId && sameConfig(draft, baseConfig(ctx.s, feature))) {
    throw conflict('NO_CHANGES', 'nothing changed compared with the base configuration');
  }

  const entries: { dataKey: string; spec: VersionRef }[] = Object.keys(draft.files).map((dataKey) => ({
    dataKey,
    spec: fileSpecVersion(ctx, dataKey, draft.files[dataKey]!),
  }));
  for (const [dataKey, versionId] of Object.entries(draft.references)) {
    const v = ctx.s.fileSpecVersions[versionId]!;
    entries.push({ dataKey, spec: { id: v.id, digest: v.digest } });
  }
  const manifest = manifestVersion(ctx, group.id, entries);
  const policies: Record<string, string> = {};
  const policyDigests: [string, string][] = [];
  for (const policyId of Object.keys(draft.policies).sort()) {
    ctx.s.policyOwners[policyId] ??= group.id;
    const v = policyVersion(ctx, policyId, draft.policies[policyId]!);
    policies[policyId] = v.id;
    policyDigests.push([policyId, v.digest]);
  }
  const commitId = newId('cm');
  ctx.s.commits[commitId] = {
    id: commitId,
    seq: ctx.seq(),
    featureId: feature.id,
    groupId: group.id,
    parentCommitId: feature.headCommitId,
    sequence: feature.sequence + 1,
    baseReleaseId: feature.baseReleaseId,
    manifestVersionId: manifest.id,
    policies,
    digest: digestOf({ groupId: group.id, baseReleaseId: feature.baseReleaseId, manifest: manifest.digest, policies: policyDigests }),
    message: input.message?.trim() ?? '',
    author: ctx.user().username,
    createdAt: ctx.now,
  };
  for (const key of Object.keys(draft.files)) {
    const item = ctx.s.dataItems[key]!;
    if (item.status === 'PENDING') item.status = 'ACTIVE';
  }
  feature.headCommitId = commitId;
  feature.sequence += 1;
  feature.stage = stage;
  feature.updatedAt = ctx.now;
  return { commitId, reused: false, stage };
}

/** Changes of a commit relative to its parent (or the base for the first commit). */
export function commitChanges(s: State, commitId: string): ConfigDiff {
  const c = s.commits[commitId]!;
  const previous = c.parentCommitId ? commitSnapshot(s, c.parentCommitId) : baseConfig(s, { baseReleaseId: c.baseReleaseId, groupId: c.groupId });
  return diffConfig(previous, commitSnapshot(s, commitId));
}

// ---------------------------------------------------------------------------
// Data items
// ---------------------------------------------------------------------------

/** Groups that own `dataKey` or one of its overlap suspects. */
export function overlapOwners(s: State, dataKey: string): Set<string> {
  const item = s.dataItems[dataKey]!;
  return new Set([item.ownerGroupId, ...item.overlapSuspects.flatMap((k) => (s.dataItems[k] ? [s.dataItems[k]!.ownerGroupId] : []))]);
}

/** DCL decision on a source whose pattern overlaps another: distinct data, or a duplicate to drop. */
export function reviewOverlap(ctx: Ctx, dataKey: string, input: { decision: 'DISTINCT' | 'DUPLICATE'; note: string }): void {
  const item = ctx.s.dataItems[dataKey];
  if (!item) throw notFound('data item', dataKey);
  // The decision concerns every group whose source overlaps, so one grant must cover all of them.
  const owners = overlapOwners(ctx.s, dataKey);
  ctx.allow('dataItem.reviewOverlap', { type: 'dataItem', id: dataKey, groupId: owners.size === 1 ? item.ownerGroupId : WILDCARD });
  if (item.status !== 'REVIEW') throw rule('NOT_UNDER_REVIEW', `data item ${dataKey} is not awaiting overlap review`);
  if (input.note.trim().length === 0) throw rule('NOTE_REQUIRED', 'explain the decision');
  item.status = input.decision === 'DISTINCT' ? 'PENDING' : 'ARCHIVED';
  item.reviewNote = input.note.trim();
}
