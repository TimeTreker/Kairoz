// Config authoring. A Feature (研发分支) holds a full working copy of its group's file list and
// policies. Saving the draft never creates versions; submitting creates immutable,
// content-addressed FileSpec / Policy / Manifest versions and a commit. Unchanged content is reused.

import type { Db } from '../../db/pool.ts';
import { many, one } from '../../db/pool.ts';
import { canReadGroupConfig } from '../../domain/authz.ts';
import { digestOf } from '../../domain/canonical.ts';
import {
  assertPolicyIdForGroup,
  diffConfig,
  emptyConfig,
  normalizePolicy,
  normalizeTags,
  policyIssues,
  sameConfig,
} from '../../domain/config.ts';
import type { ConfigDiff, FileSpecContent, GroupConfig, PolicyContent, Priority } from '../../domain/config.ts';
import { dataCodeStem, globsIntersect, normalizeSource } from '../../domain/data-source.ts';
import type { DataSource } from '../../domain/data-source.ts';
import { conflict, ForbiddenError, notFound, revisionConflict, rule } from '../../domain/errors.ts';
import { assertNotDowngraded, inferFileType, requiresSensitiveReview } from '../../domain/file-types.ts';
import type { FileType, Privacy } from '../../domain/file-types.ts';
import { FEATURE_NAME, newId } from '../../domain/ids.ts';
import { WILDCARD } from '../../domain/vocabulary.ts';
import type { ReadCtx, WriteCtx } from '../../http/context.ts';
import { getGroup, workspaceForAction } from '../org/service.ts';
import type { GroupView } from '../org/service.ts';
import { bindingIssues, currentTemplate } from '../processing/service.ts';

export type FeatureStage = 'DRAFT' | 'SUBMITTED' | 'DCL_READY';
const EDITABLE_STAGES: readonly FeatureStage[] = ['DRAFT', 'SUBMITTED', 'DCL_READY'];

interface FeatureRow {
  id: string;
  workspace_id: string;
  group_id: string;
  vehicle_model_id: string;
  project_id: string | null;
  name: string;
  description: string;
  kind: string;
  stage: FeatureStage;
  base_release_id: string | null;
  head_commit_id: string | null;
  sequence: number;
  draft: GroupConfig;
  revision: number;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

interface DataItemRow {
  data_key: string;
  data_code: string;
  owner_group_id: string;
  source_unit: string;
  source_directory: string;
  source_pattern: string;
  status: 'PENDING' | 'REVIEW' | 'ACTIVE' | 'ARCHIVED';
  overlap_suspects: string[];
  review_note: string | null;
  created_by: string;
  created_at: Date;
}

const sourceOf = (r: DataItemRow): DataSource => ({ unit: r.source_unit, directory: r.source_directory, pattern: r.source_pattern });

function displayName(baseReleaseId: string | null, groupCode: string, featureName: string, sequence: number): string {
  return `${baseReleaseId ?? 'initial'} / ${groupCode} / ${featureName} / r${String(sequence).padStart(3, '0')}`;
}

/** The configuration a Feature starts from. Releases arrive in a later slice; until then it is the empty initial config. */
function baseConfig(baseReleaseId: string | null): GroupConfig {
  if (baseReleaseId !== null) throw new Error(`release bases are not supported yet: ${baseReleaseId}`);
  return emptyConfig();
}

// ---------------------------------------------------------------------------
// Read side
// ---------------------------------------------------------------------------

function assertCanRead(ctx: ReadCtx, group: GroupView, workspaceId?: string): void {
  const target = { groupId: group.id, domain: group.domain, ...(workspaceId !== undefined ? { workspaceId } : {}) };
  if (!canReadGroupConfig(ctx.actor.grants, target)) {
    throw new ForbiddenError('config.read', 'NOT_VISIBLE', { type: 'group', id: group.id, ...target });
  }
}

async function getFeatureRow(db: Db, id: string, lock = false): Promise<FeatureRow> {
  const row = await one<FeatureRow>(db, `SELECT * FROM features WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [id]);
  if (!row) throw notFound('feature', id);
  return row;
}

async function commitSnapshot(db: Db, commitId: string): Promise<GroupConfig> {
  const files = await many<{ data_key: string; content: FileSpecContent }>(
    db,
    `SELECT e.data_key, v.content FROM commits c
       JOIN manifest_entries e ON e.manifest_version_id = c.manifest_version_id
       JOIN file_spec_versions v ON v.id = e.file_spec_version_id
     WHERE c.id = $1`,
    [commitId],
  );
  const policies = await many<{ policy_id: string; content: PolicyContent }>(
    db,
    `SELECT cp.policy_id, v.content FROM commit_policies cp JOIN policy_versions v ON v.id = cp.policy_version_id
     WHERE cp.commit_id = $1`,
    [commitId],
  );
  return {
    files: Object.fromEntries(files.map((f) => [f.data_key, f.content])),
    policies: Object.fromEntries(policies.map((p) => [p.policy_id, p.content])),
  };
}

export interface FeatureSummary {
  id: string;
  workspaceId: string;
  groupId: string;
  groupCode: string;
  vehicleModelId: string;
  projectId: string | null;
  name: string;
  description: string;
  kind: string;
  stage: FeatureStage;
  baseReleaseId: string | null;
  headCommitId: string | null;
  sequence: number;
  revision: number;
  fileCount: number;
  policyCount: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

function featureSummary(row: FeatureRow, group: GroupView): FeatureSummary {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    groupId: row.group_id,
    groupCode: group.code,
    vehicleModelId: row.vehicle_model_id,
    projectId: row.project_id,
    name: row.name,
    description: row.description,
    kind: row.kind,
    stage: row.stage,
    baseReleaseId: row.base_release_id,
    headCommitId: row.head_commit_id,
    sequence: row.sequence,
    revision: row.revision,
    fileCount: Object.keys(row.draft.files).length,
    policyCount: Object.keys(row.draft.policies).length,
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export interface FeatureDetail extends FeatureSummary {
  draft: GroupConfig;
  dataItems: Record<string, { dataCode: string; status: DataItemRow['status']; overlapSuspects: string[] }>;
  /** Draft files that need DCL sensitive review before the Feature can become DCL Ready. */
  reviewRequired: string[];
  changes: { sinceHead: ConfigDiff; sinceBase: ConfigDiff };
}

async function featureDetail(db: Db, row: FeatureRow, group: GroupView): Promise<FeatureDetail> {
  const keys = Object.keys(row.draft.files);
  const items = await many<DataItemRow>(db, 'SELECT * FROM data_items WHERE data_key = ANY($1)', [keys]);
  const base = baseConfig(row.base_release_id);
  const head = row.head_commit_id ? await commitSnapshot(db, row.head_commit_id) : base;
  return {
    ...featureSummary(row, group),
    draft: row.draft,
    dataItems: Object.fromEntries(
      items.map((i) => [i.data_key, { dataCode: i.data_code, status: i.status, overlapSuspects: i.overlap_suspects }]),
    ),
    reviewRequired: keys.filter((k) => row.draft.files[k]!.requiresReview).sort(),
    changes: { sinceHead: diffConfig(head, row.draft), sinceBase: diffConfig(base, row.draft) },
  };
}

export async function listFeatures(ctx: ReadCtx, filter: { workspaceId: string; groupId?: string }): Promise<FeatureSummary[]> {
  const rows = await many<FeatureRow>(
    ctx.db,
    `SELECT * FROM features WHERE workspace_id = $1 AND ($2::text IS NULL OR group_id = $2) ORDER BY created_at DESC`,
    [filter.workspaceId, filter.groupId ?? null],
  );
  const groups = new Map<string, GroupView>();
  const result: FeatureSummary[] = [];
  for (const row of rows) {
    let group = groups.get(row.group_id);
    if (!group) {
      group = await getGroup(ctx.db, row.group_id);
      groups.set(group.id, group);
    }
    const visible = canReadGroupConfig(ctx.actor.grants, { groupId: group.id, domain: group.domain, workspaceId: row.workspace_id });
    if (visible) result.push(featureSummary(row, group));
  }
  return result;
}

export async function getFeature(ctx: ReadCtx, id: string): Promise<FeatureDetail> {
  const row = await getFeatureRow(ctx.db, id);
  const group = await getGroup(ctx.db, row.group_id);
  assertCanRead(ctx, group, row.workspace_id);
  return featureDetail(ctx.db, row, group);
}

// ---------------------------------------------------------------------------
// Feature creation and draft editing
// ---------------------------------------------------------------------------

export async function createFeature(
  ctx: WriteCtx,
  input: { workspaceId: string; groupId: string; name: string; description?: string },
): Promise<FeatureDetail> {
  const group = await getGroup(ctx.db, input.groupId);
  ctx.allow('feature.create', {
    type: 'feature',
    workspaceId: input.workspaceId,
    groupId: group.id,
    scope: group.domain,
  });
  // FOR SHARE: a concurrent workspace update cannot remove the group underneath the new Feature.
  const workspace = await workspaceForAction(ctx.db, input.workspaceId, 'share');
  if (workspace.status !== 'ACTIVE') throw rule('WORKSPACE_ARCHIVED', `workspace ${workspace.id} is archived`);
  if (!workspace.groupIds.includes(group.id)) {
    throw rule('GROUP_NOT_IN_WORKSPACE', `group ${group.id} does not work in workspace ${workspace.id}`);
  }
  if (group.status !== 'ACTIVE') throw rule('GROUP_ARCHIVED', `group ${group.id} is archived`);
  if (group.purpose !== 'DEV') throw rule('TEST_GROUP_CANNOT_OWN_CONFIG', 'test groups do not maintain files or policies');
  if (!FEATURE_NAME.test(input.name)) throw rule('INVALID_FEATURE_NAME', `feature name must match ${FEATURE_NAME.source}`);
  if (await one(ctx.db, 'SELECT 1 FROM features WHERE group_id = $1 AND name = $2', [group.id, input.name])) {
    throw conflict('FEATURE_NAME_TAKEN', `group ${group.id} already has a feature named ${input.name}`);
  }
  const id = newId('ft');
  const row = await one<FeatureRow>(
    ctx.db,
    `INSERT INTO features (id, workspace_id, group_id, vehicle_model_id, project_id, name, description, stage, draft, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'DRAFT', $8, $9) RETURNING *`,
    [
      id,
      workspace.id,
      group.id,
      workspace.vehicleModelId,
      workspace.projectId,
      input.name,
      input.description ?? '',
      JSON.stringify(baseConfig(null)),
      ctx.actor.username,
    ],
  );
  return featureDetail(ctx.db, row!, group);
}

interface EditScope {
  feature: FeatureRow;
  group: GroupView;
}

/** Authorizes against a Feature's (immutable) workspace and group, then locks the row. */
async function lockFeatureFor(ctx: WriteCtx, action: 'feature.edit' | 'feature.submit', featureId: string) {
  const unlocked = await getFeatureRow(ctx.db, featureId);
  const group = await getGroup(ctx.db, unlocked.group_id);
  ctx.allow(action, { type: 'feature', id: featureId, workspaceId: unlocked.workspace_id, groupId: group.id, scope: group.domain });
  return { feature: await getFeatureRow(ctx.db, featureId, true), group };
}

/**
 * Shared frame for every draft edit: authorize, lock, check the revision and stage, apply the
 * change, and fall back to DRAFT if content changed. Earlier commits remain untouched.
 */
async function editDraft(
  ctx: WriteCtx,
  featureId: string,
  expectedRevision: number,
  change: (draft: GroupConfig, scope: EditScope) => Promise<GroupConfig>,
): Promise<FeatureDetail> {
  const { feature, group } = await lockFeatureFor(ctx, 'feature.edit', featureId);
  if (feature.revision !== expectedRevision) throw revisionConflict('feature', feature.id, feature.revision);
  if (!EDITABLE_STAGES.includes(feature.stage)) throw rule('FEATURE_IMMUTABLE', `feature in stage ${feature.stage} cannot change`);
  const workspace = await workspaceForAction(ctx.db, feature.workspace_id);
  if (workspace.status !== 'ACTIVE') throw rule('WORKSPACE_ARCHIVED', `workspace ${workspace.id} is archived`);

  const next = await change(structuredClone(feature.draft), { feature, group });
  if (sameConfig(next, feature.draft)) return featureDetail(ctx.db, feature, group);
  const updated = await one<FeatureRow>(
    ctx.db,
    `UPDATE features SET draft = $2, stage = 'DRAFT', revision = revision + 1, updated_at = now()
     WHERE id = $1 RETURNING *`,
    [feature.id, JSON.stringify(next)],
  );
  return featureDetail(ctx.db, updated!, group);
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

async function templateFor(db: Db, fileType: FileType) {
  const template = await currentTemplate(db, fileType);
  if (!template) {
    throw rule('TEMPLATE_MISSING', `no processing template is published for file type ${fileType}; ask DCL engineering`, {
      fileType,
    });
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

/**
 * Serializes registration and release of data sources in one unit + directory, so overlap
 * detection always sees every concurrent registration.
 */
async function lockSourceDirectory(db: Db, source: DataSource): Promise<void> {
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`kairoz.source.${source.unit}|${source.directory}`]);
}

/**
 * Deletes a never-committed data item that no Feature draft (other than `exceptFeatureId`)
 * references, so an abandoned registration does not hold its source forever.
 */
async function releaseIfUnused(db: Db, dataKey: string, exceptFeatureId: string | null): Promise<boolean> {
  const item = await one<{ status: string }>(db, 'SELECT status FROM data_items WHERE data_key = $1 FOR UPDATE', [dataKey]);
  if (!item || (item.status !== 'PENDING' && item.status !== 'REVIEW')) return false;
  const referenced = await one(
    db,
    `SELECT 1 FROM features WHERE ($2::text IS NULL OR id <> $2) AND jsonb_exists(draft -> 'files', $1) LIMIT 1`,
    [dataKey, exceptFeatureId],
  );
  if (referenced) return false;
  if (await one(db, 'SELECT 1 FROM file_spec_versions WHERE data_key = $1 LIMIT 1', [dataKey])) return false;
  await db.query('DELETE FROM data_items WHERE data_key = $1', [dataKey]);
  return true;
}

async function uniqueDataCode(db: Db, stem: string): Promise<string> {
  const taken = new Set(
    (await many<{ data_code: string }>(db, 'SELECT data_code FROM data_items WHERE data_code = $1 OR data_code LIKE $2', [
      stem,
      `${stem.replace(/[\\%_]/g, (c) => `\\${c}`)}.%`,
    ])).map((r) => r.data_code),
  );
  if (!taken.has(stem)) return stem;
  for (let n = 2; ; n++) if (!taken.has(`${stem}.${n}`)) return `${stem}.${n}`;
}

/**
 * Adds a file to the draft. An exact source already registered by this group reuses its data_key;
 * one registered by another group cannot be re-created to get around read authorization. A new
 * source gets a fresh data_key; if its pattern overlaps another source it waits for DCL review.
 */
export async function addFile(
  ctx: WriteCtx,
  featureId: string,
  input: FileAttributes & { expectedRevision: number; source: { unit: string; directory: string; pattern: string } },
): Promise<FeatureDetail> {
  return editDraft(ctx, featureId, input.expectedRevision, async (draft, { group }) => {
    const source = normalizeSource(input.source);
    const fileType = input.fileType ?? inferFileType(source.pattern);
    assertNotDowngraded(source.pattern, fileType);
    const template = await templateFor(ctx.db, fileType);

    await lockSourceDirectory(ctx.db, source);
    let existing = await one<DataItemRow>(
      ctx.db,
      `SELECT * FROM data_items
       WHERE source_unit = $1 AND source_directory = $2 AND source_pattern = $3 AND status <> 'ARCHIVED'`,
      [source.unit, source.directory, source.pattern],
    );
    if (existing && existing.owner_group_id !== group.id && (await releaseIfUnused(ctx.db, existing.data_key, null))) {
      existing = undefined;
    }
    let dataKey: string;
    if (existing) {
      if (existing.owner_group_id !== group.id) {
        throw rule('DATA_SOURCE_OWNED_ELSEWHERE', 'this source is already registered by another group; reference it instead', {
          dataKey: existing.data_key,
          ownerGroupId: existing.owner_group_id,
        });
      }
      if (draft.files[existing.data_key]) {
        throw conflict('FILE_ALREADY_IN_DRAFT', 'this source is already in the draft', { dataKey: existing.data_key });
      }
      dataKey = existing.data_key;
    } else {
      const neighbours = await many<DataItemRow>(
        ctx.db,
        "SELECT * FROM data_items WHERE source_unit = $1 AND source_directory = $2 AND status <> 'ARCHIVED'",
        [source.unit, source.directory],
      );
      const suspects = neighbours.filter((n) => globsIntersect(n.source_pattern, source.pattern)).map((n) => n.data_key);
      dataKey = newId('dk');
      await ctx.db.query(
        `INSERT INTO data_items
           (data_key, data_code, owner_group_id, source_unit, source_directory, source_pattern, status, overlap_suspects, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          dataKey,
          await uniqueDataCode(ctx.db, dataCodeStem(group.code, source.pattern)),
          group.id,
          source.unit,
          source.directory,
          source.pattern,
          suspects.length > 0 ? 'REVIEW' : 'PENDING',
          suspects,
          ctx.actor.username,
        ],
      );
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
      requiresReview: requiresSensitiveReview({
        fileType,
        privacy,
        contentTags,
        templateRequiresReview: template.requiresReview,
        pattern: source.pattern,
      }),
    };
    checkAttributes(spec);
    draft.files[dataKey] = spec;
    return draft;
  });
}

/** Edits business attributes. The source is the data identity and cannot change. */
export async function updateFile(
  ctx: WriteCtx,
  featureId: string,
  dataKey: string,
  input: Partial<FileAttributes> & { expectedRevision: number },
): Promise<FeatureDetail> {
  return editDraft(ctx, featureId, input.expectedRevision, async (draft) => {
    const current = draft.files[dataKey];
    if (!current) throw notFound('file in draft', dataKey);
    const fileType = input.fileType ?? current.fileType;
    let binding: Pick<FileSpecContent, 'templateId' | 'format' | 'schema' | 'edgePipelineId' | 'cloudPipelineId'> = current;
    let templateRequiresReview: boolean;
    if (fileType !== current.fileType) {
      // A new type takes that type's current default binding.
      assertNotDowngraded(current.source.pattern, fileType);
      const template = await templateFor(ctx.db, fileType);
      binding = {
        templateId: template.id,
        format: template.format,
        schema: template.schema,
        edgePipelineId: template.edgePipelineId,
        cloudPipelineId: template.cloudPipelineId,
      };
      templateRequiresReview = template.requiresReview;
    } else {
      // Same type keeps its original binding even if a newer template exists.
      const row = await one<{ requires_review: boolean }>(ctx.db, 'SELECT requires_review FROM processing_templates WHERE id = $1', [
        current.templateId,
      ]);
      templateRequiresReview = row?.requires_review ?? true;
    }
    const privacy = input.privacy ?? current.privacy;
    const contentTags = input.contentTags ? normalizeTags(input.contentTags) : current.contentTags;
    const spec: FileSpecContent = {
      ...current,
      ...binding,
      name: input.name?.trim() ?? current.name,
      purpose: input.purpose?.trim() ?? current.purpose,
      fileType,
      privacy,
      retentionDays: input.retentionDays ?? current.retentionDays,
      contentTags,
      priority: input.priority ?? current.priority,
      requiresReview: requiresSensitiveReview({ fileType, privacy, contentTags, templateRequiresReview, pattern: current.source.pattern }),
    };
    checkAttributes(spec);
    draft.files[dataKey] = spec;
    return draft;
  });
}

export async function removeFile(ctx: WriteCtx, featureId: string, dataKey: string, expectedRevision: number) {
  return editDraft(ctx, featureId, expectedRevision, async (draft) => {
    const spec = draft.files[dataKey];
    if (!spec) throw notFound('file in draft', dataKey);
    const capturing = Object.entries(draft.policies)
      .filter(([, p]) => p.captures.includes(dataKey))
      .map(([id]) => id)
      .sort();
    if (capturing.length > 0) {
      throw rule('FILE_CAPTURED_BY_POLICY', 'remove the file from these policies first', { policyIds: capturing });
    }
    delete draft.files[dataKey];
    await lockSourceDirectory(ctx.db, spec.source);
    await releaseIfUnused(ctx.db, dataKey, featureId);
    return draft;
  });
}

/** The group that owns a policy id: the one whose code is the longest dotted prefix. */
async function policyNamespaceOwner(db: Db, policyId: string): Promise<string | undefined> {
  const row = await one<{ id: string }>(
    db,
    "SELECT id FROM business_groups WHERE starts_with($1, code || '.') ORDER BY length(code) DESC LIMIT 1",
    [policyId],
  );
  return row?.id;
}

export async function putPolicy(
  ctx: WriteCtx,
  featureId: string,
  policyId: string,
  input: Omit<PolicyContent, 'priority'> & { priority?: Priority; expectedRevision: number },
): Promise<FeatureDetail> {
  return editDraft(ctx, featureId, input.expectedRevision, async (draft, { group }) => {
    assertPolicyIdForGroup(policyId, group.code);
    // Existing ownership is authoritative; the namespace rule decides only for new policy ids.
    const owner = await one<{ owner_group_id: string }>(ctx.db, 'SELECT owner_group_id FROM policies WHERE policy_id = $1', [
      policyId,
    ]);
    if (owner && owner.owner_group_id !== group.id) {
      throw rule('POLICY_OWNED_ELSEWHERE', `policy ${policyId} is maintained by group ${owner.owner_group_id}`);
    }
    if (!owner && (await policyNamespaceOwner(ctx.db, policyId)) !== group.id) {
      throw rule('POLICY_NAMESPACE_TAKEN', `policy id ${policyId} falls in another group's namespace`);
    }
    const content = normalizePolicy({ ...input, priority: input.priority ?? 'NORMAL' });
    const issues = policyIssues(content, new Set(Object.keys(draft.files)));
    if (issues.length > 0) throw rule('INVALID_POLICY', 'the policy is invalid', { issues });
    draft.policies[policyId] = content;
    return draft;
  });
}

export async function removePolicy(ctx: WriteCtx, featureId: string, policyId: string, expectedRevision: number) {
  return editDraft(ctx, featureId, expectedRevision, async (draft) => {
    if (!draft.policies[policyId]) throw notFound('policy in draft', policyId);
    delete draft.policies[policyId];
    return draft;
  });
}

// ---------------------------------------------------------------------------
// Submit: immutable versions and commit
// ---------------------------------------------------------------------------

/** Serializes version numbering for one versioned object. */
async function lockVersions(db: Db, key: string): Promise<void> {
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [key]);
}

interface VersionRef {
  id: string;
  version: number;
  digest: string;
}

async function fileSpecVersion(ctx: WriteCtx, dataKey: string, content: FileSpecContent): Promise<VersionRef> {
  const digest = digestOf(content);
  await lockVersions(ctx.db, `kairoz.fsv.${dataKey}`);
  const found = await one<VersionRef>(ctx.db, 'SELECT id, version, digest FROM file_spec_versions WHERE data_key = $1 AND digest = $2', [
    dataKey,
    digest,
  ]);
  if (found) return found;
  return (await one<VersionRef>(
    ctx.db,
    `INSERT INTO file_spec_versions (data_key, version, digest, content, created_by)
     SELECT $1, coalesce(max(version), 0) + 1, $2, $3, $4 FROM file_spec_versions WHERE data_key = $1
     RETURNING id, version, digest`,
    [dataKey, digest, JSON.stringify(content), ctx.actor.username],
  ))!;
}

async function policyVersion(ctx: WriteCtx, policyId: string, content: PolicyContent): Promise<VersionRef> {
  const digest = digestOf(content);
  await lockVersions(ctx.db, `kairoz.policy.${policyId}`);
  const found = await one<VersionRef>(ctx.db, 'SELECT id, version, digest FROM policy_versions WHERE policy_id = $1 AND digest = $2', [
    policyId,
    digest,
  ]);
  if (found) return found;
  return (await one<VersionRef>(
    ctx.db,
    `INSERT INTO policy_versions (policy_id, version, digest, content, created_by)
     SELECT $1, coalesce(max(version), 0) + 1, $2, $3, $4 FROM policy_versions WHERE policy_id = $1
     RETURNING id, version, digest`,
    [policyId, digest, JSON.stringify(content), ctx.actor.username],
  ))!;
}

async function manifestVersion(
  ctx: WriteCtx,
  groupId: string,
  entries: { dataKey: string; spec: VersionRef }[],
): Promise<VersionRef> {
  const digest = digestOf(entries.map((e) => [e.dataKey, e.spec.digest]));
  await lockVersions(ctx.db, `kairoz.manifest.${groupId}`);
  const found = await one<VersionRef>(ctx.db, 'SELECT id, version, digest FROM manifest_versions WHERE group_id = $1 AND digest = $2', [
    groupId,
    digest,
  ]);
  if (found) return found;
  const created = (await one<VersionRef>(
    ctx.db,
    `INSERT INTO manifest_versions (group_id, version, digest, created_by)
     SELECT $1, coalesce(max(version), 0) + 1, $2, $3 FROM manifest_versions WHERE group_id = $1
     RETURNING id, version, digest`,
    [groupId, digest, ctx.actor.username],
  ))!;
  for (const e of entries) {
    await ctx.db.query('INSERT INTO manifest_entries (manifest_version_id, data_key, file_spec_version_id) VALUES ($1, $2, $3)', [
      created.id,
      e.dataKey,
      e.spec.id,
    ]);
  }
  return created;
}

export interface SubmitIssue {
  kind: 'file' | 'policy';
  key: string;
  problems: string[];
}

async function submitIssues(ctx: WriteCtx, group: GroupView, draft: GroupConfig): Promise<SubmitIssue[]> {
  const issues: SubmitIssue[] = [];
  const keys = Object.keys(draft.files).sort();
  const items = new Map(
    (await many<DataItemRow>(ctx.db, 'SELECT * FROM data_items WHERE data_key = ANY($1)', [keys])).map((i) => [i.data_key, i]),
  );
  for (const key of keys) {
    const problems: string[] = [];
    const item = items.get(key);
    if (!item) problems.push('data item does not exist');
    else {
      if (item.owner_group_id !== group.id) problems.push(`owned by group ${item.owner_group_id}`);
      if (item.status === 'REVIEW') problems.push('source overlaps another source and awaits DCL review');
      if (item.status === 'ARCHIVED') problems.push('data item was archived as a duplicate');
    }
    problems.push(...(await bindingIssues(ctx.db, draft.files[key]!)));
    if (problems.length) issues.push({ kind: 'file', key, problems });
  }
  const available = new Set(keys);
  for (const [policyId, policy] of Object.entries(draft.policies).sort(([a], [b]) => a.localeCompare(b))) {
    const problems = policyIssues(policy, available);
    const owner = await one<{ owner_group_id: string }>(ctx.db, 'SELECT owner_group_id FROM policies WHERE policy_id = $1', [policyId]);
    if (owner && owner.owner_group_id !== group.id) problems.push(`maintained by group ${owner.owner_group_id}`);
    if (problems.length) issues.push({ kind: 'policy', key: policyId, problems });
  }
  return issues;
}

export async function submitFeature(
  ctx: WriteCtx,
  featureId: string,
  input: { expectedRevision: number; message?: string },
): Promise<{ commit: CommitView; feature: FeatureDetail; reused: boolean }> {
  const { feature, group } = await lockFeatureFor(ctx, 'feature.submit', featureId);
  if (feature.revision !== input.expectedRevision) throw revisionConflict('feature', feature.id, feature.revision);
  if (!EDITABLE_STAGES.includes(feature.stage)) throw rule('FEATURE_IMMUTABLE', `feature in stage ${feature.stage} cannot change`);

  const draft = feature.draft;
  // Ordinary content is DCL Ready at once; sensitive files wait for DCL review (next slice).
  const stage: FeatureStage = Object.values(draft.files).some((f) => f.requiresReview) ? 'SUBMITTED' : 'DCL_READY';
  if (feature.head_commit_id) {
    if (sameConfig(draft, await commitSnapshot(ctx.db, feature.head_commit_id))) {
      // Edited back to the committed content: reuse the head commit instead of creating a duplicate.
      const current =
        feature.stage === stage
          ? feature
          : (await one<FeatureRow>(
              ctx.db,
              'UPDATE features SET stage = $2, revision = revision + 1, updated_at = now() WHERE id = $1 RETURNING *',
              [feature.id, stage],
            ))!;
      return { commit: await commitView(ctx.db, feature.head_commit_id), feature: await featureDetail(ctx.db, current, group), reused: true };
    }
  } else if (sameConfig(draft, baseConfig(feature.base_release_id))) {
    throw conflict('NO_CHANGES', 'nothing changed compared with the base configuration');
  }

  const issues = await submitIssues(ctx, group, draft);
  if (issues.length > 0) throw rule('SUBMIT_BLOCKED', 'the draft cannot be submitted yet', { issues });

  const entries: { dataKey: string; spec: VersionRef }[] = [];
  for (const dataKey of Object.keys(draft.files).sort()) {
    entries.push({ dataKey, spec: await fileSpecVersion(ctx, dataKey, draft.files[dataKey]!) });
  }
  const manifest = await manifestVersion(ctx, group.id, entries);
  const policies: { policyId: string; version: VersionRef }[] = [];
  for (const policyId of Object.keys(draft.policies).sort()) {
    await ctx.db.query('INSERT INTO policies (policy_id, owner_group_id) VALUES ($1, $2) ON CONFLICT (policy_id) DO NOTHING', [
      policyId,
      group.id,
    ]);
    policies.push({ policyId, version: await policyVersion(ctx, policyId, draft.policies[policyId]!) });
  }

  const sequence = feature.sequence + 1;
  const commitId = newId('cm');
  const digest = digestOf({
    groupId: group.id,
    baseReleaseId: feature.base_release_id,
    manifest: manifest.digest,
    policies: policies.map((p) => [p.policyId, p.version.digest]),
  });
  await ctx.db.query(
    `INSERT INTO commits (id, feature_id, group_id, parent_commit_id, sequence, base_release_id, manifest_version_id, digest, message, author)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      commitId,
      feature.id,
      group.id,
      feature.head_commit_id,
      sequence,
      feature.base_release_id,
      manifest.id,
      digest,
      input.message?.trim() ?? '',
      ctx.actor.username,
    ],
  );
  for (const p of policies) {
    await ctx.db.query('INSERT INTO commit_policies (commit_id, policy_id, policy_version_id) VALUES ($1, $2, $3)', [
      commitId,
      p.policyId,
      p.version.id,
    ]);
  }
  await ctx.db.query(
    "UPDATE data_items SET status = 'ACTIVE', updated_at = now() WHERE data_key = ANY($1) AND status = 'PENDING'",
    [entries.map((e) => e.dataKey)],
  );
  const updated = await one<FeatureRow>(
    ctx.db,
    `UPDATE features SET head_commit_id = $2, sequence = $3, stage = $4, revision = revision + 1, updated_at = now()
     WHERE id = $1 RETURNING *`,
    [feature.id, commitId, sequence, stage],
  );
  return { commit: await commitView(ctx.db, commitId), feature: await featureDetail(ctx.db, updated!, group), reused: false };
}

// ---------------------------------------------------------------------------
// Commits
// ---------------------------------------------------------------------------

export interface CommitView {
  id: string;
  featureId: string;
  featureName: string;
  groupId: string;
  groupCode: string;
  sequence: number;
  displayName: string;
  parentCommitId: string | null;
  baseReleaseId: string | null;
  digest: string;
  message: string;
  author: string;
  createdAt: string;
  manifest: VersionRef;
  files: { dataKey: string; dataCode: string; version: VersionRef; content: FileSpecContent }[];
  policies: { policyId: string; version: VersionRef; content: PolicyContent }[];
  /** Changes relative to the parent commit, or to the base for the first commit. */
  changes: ConfigDiff;
}

async function commitView(db: Db, id: string): Promise<CommitView> {
  const c = await one<{
    id: string;
    feature_id: string;
    feature_name: string;
    group_id: string;
    group_code: string;
    sequence: number;
    parent_commit_id: string | null;
    base_release_id: string | null;
    digest: string;
    message: string;
    author: string;
    created_at: Date;
    manifest_id: string;
    manifest_version: number;
    manifest_digest: string;
  }>(
    db,
    `SELECT c.*, f.name AS feature_name, g.code AS group_code,
            m.id AS manifest_id, m.version AS manifest_version, m.digest AS manifest_digest
     FROM commits c
       JOIN features f ON f.id = c.feature_id
       JOIN business_groups g ON g.id = c.group_id
       JOIN manifest_versions m ON m.id = c.manifest_version_id
     WHERE c.id = $1`,
    [id],
  );
  if (!c) throw notFound('commit', id);
  const files = await many<{ data_key: string; data_code: string; id: string; version: number; digest: string; content: FileSpecContent }>(
    db,
    `SELECT e.data_key, d.data_code, v.id, v.version, v.digest, v.content
     FROM manifest_entries e
       JOIN file_spec_versions v ON v.id = e.file_spec_version_id
       JOIN data_items d ON d.data_key = e.data_key
     WHERE e.manifest_version_id = $1 ORDER BY e.data_key`,
    [c.manifest_id],
  );
  const policies = await many<{ policy_id: string; id: string; version: number; digest: string; content: PolicyContent }>(
    db,
    `SELECT cp.policy_id, v.id, v.version, v.digest, v.content
     FROM commit_policies cp JOIN policy_versions v ON v.id = cp.policy_version_id
     WHERE cp.commit_id = $1 ORDER BY cp.policy_id`,
    [id],
  );
  const snapshot: GroupConfig = {
    files: Object.fromEntries(files.map((f) => [f.data_key, f.content])),
    policies: Object.fromEntries(policies.map((p) => [p.policy_id, p.content])),
  };
  const previous = c.parent_commit_id ? await commitSnapshot(db, c.parent_commit_id) : baseConfig(c.base_release_id);
  return {
    id: c.id,
    featureId: c.feature_id,
    featureName: c.feature_name,
    groupId: c.group_id,
    groupCode: c.group_code,
    sequence: c.sequence,
    displayName: displayName(c.base_release_id, c.group_code, c.feature_name, c.sequence),
    parentCommitId: c.parent_commit_id,
    baseReleaseId: c.base_release_id,
    digest: c.digest,
    message: c.message,
    author: c.author,
    createdAt: c.created_at.toISOString(),
    manifest: { id: c.manifest_id, version: c.manifest_version, digest: c.manifest_digest },
    files: files.map((f) => ({
      dataKey: f.data_key,
      dataCode: f.data_code,
      version: { id: f.id, version: f.version, digest: f.digest },
      content: f.content,
    })),
    policies: policies.map((p) => ({
      policyId: p.policy_id,
      version: { id: p.id, version: p.version, digest: p.digest },
      content: p.content,
    })),
    changes: diffConfig(previous, snapshot),
  };
}

export async function getCommit(ctx: ReadCtx, id: string): Promise<CommitView> {
  const row = await one<{ group_id: string; workspace_id: string }>(
    ctx.db,
    'SELECT c.group_id, f.workspace_id FROM commits c JOIN features f ON f.id = c.feature_id WHERE c.id = $1',
    [id],
  );
  if (!row) throw notFound('commit', id);
  assertCanRead(ctx, await getGroup(ctx.db, row.group_id), row.workspace_id);
  return commitView(ctx.db, id);
}

export async function listCommits(ctx: ReadCtx, featureId: string) {
  const feature = await getFeatureRow(ctx.db, featureId);
  const group = await getGroup(ctx.db, feature.group_id);
  assertCanRead(ctx, group, feature.workspace_id);
  const rows = await many<{ id: string; sequence: number; digest: string; message: string; author: string; created_at: Date }>(
    ctx.db,
    'SELECT id, sequence, digest, message, author, created_at FROM commits WHERE feature_id = $1 ORDER BY sequence DESC',
    [featureId],
  );
  return rows.map((r) => ({
    id: r.id,
    sequence: r.sequence,
    displayName: displayName(feature.base_release_id, group.code, feature.name, r.sequence),
    digest: r.digest,
    message: r.message,
    author: r.author,
    createdAt: r.created_at.toISOString(),
  }));
}

// ---------------------------------------------------------------------------
// Data items
// ---------------------------------------------------------------------------

function dataItemView(r: DataItemRow & { latest_version?: number | null }) {
  return {
    dataKey: r.data_key,
    dataCode: r.data_code,
    ownerGroupId: r.owner_group_id,
    source: sourceOf(r),
    status: r.status,
    overlapSuspects: r.overlap_suspects,
    reviewNote: r.review_note,
    latestSpecVersion: r.latest_version ?? null,
    createdBy: r.created_by,
    createdAt: r.created_at.toISOString(),
  };
}

/** A group's data identities, read in the context of a workspace the group works in. */
export async function listDataItems(ctx: ReadCtx, workspaceId: string, groupId: string) {
  const group = await getGroup(ctx.db, groupId);
  assertCanRead(ctx, group, workspaceId);
  const workspace = await workspaceForAction(ctx.db, workspaceId);
  if (!workspace.groupIds.includes(groupId)) throw notFound('group in workspace', groupId);
  const rows = await many<DataItemRow & { latest_version: number | null }>(
    ctx.db,
    `SELECT d.*, (SELECT max(version) FROM file_spec_versions v WHERE v.data_key = d.data_key) AS latest_version
     FROM data_items d WHERE owner_group_id = $1 ORDER BY data_code`,
    [groupId],
  );
  return rows.map(dataItemView);
}

/** DCL decision on a source whose pattern overlaps another: distinct data, or a duplicate to drop. */
export async function reviewOverlap(
  ctx: WriteCtx,
  dataKey: string,
  input: { decision: 'DISTINCT' | 'DUPLICATE'; note: string },
) {
  const unlocked = await one<DataItemRow>(ctx.db, 'SELECT * FROM data_items WHERE data_key = $1', [dataKey]);
  if (!unlocked) throw notFound('data item', dataKey);
  // The decision concerns every group whose source overlaps, so one grant must cover all of them.
  const owners = new Set([
    unlocked.owner_group_id,
    ...(
      await many<{ owner_group_id: string }>(ctx.db, 'SELECT owner_group_id FROM data_items WHERE data_key = ANY($1)', [
        unlocked.overlap_suspects,
      ])
    ).map((r) => r.owner_group_id),
  ]);
  ctx.allow('dataItem.reviewOverlap', {
    type: 'dataItem',
    id: dataKey,
    groupId: owners.size === 1 ? unlocked.owner_group_id : WILDCARD,
  });
  const item = (await one<DataItemRow>(ctx.db, 'SELECT * FROM data_items WHERE data_key = $1 FOR UPDATE', [dataKey]))!;
  if (item.status !== 'REVIEW') throw rule('NOT_UNDER_REVIEW', `data item ${dataKey} is not awaiting overlap review`);
  if (input.note.trim().length === 0) throw rule('NOTE_REQUIRED', 'explain the decision');
  const row = await one<DataItemRow>(
    ctx.db,
    'UPDATE data_items SET status = $2, review_note = $3, updated_at = now() WHERE data_key = $1 RETURNING *',
    [dataKey, input.decision === 'DISTINCT' ? 'PENDING' : 'ARCHIVED', input.note.trim()],
  );
  return dataItemView(row!);
}
