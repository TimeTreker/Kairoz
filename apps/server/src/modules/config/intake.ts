// DCL intake (DCL 接入): the work queue, sensitive-file review of committed content, returning a
// Feature to its authors, and adjusting a file's processing binding.

import { many, one } from '../../db/pool.ts';
import { authorize } from '../../domain/authz.ts';
import { normalizeConfig } from '../../domain/config.ts';
import { conflict, ForbiddenError, notFound, revisionConflict, rule } from '../../domain/errors.ts';
import { approvalControlIssues, fileApprovalSignature, policyApprovalSignature } from '../../domain/intake.ts';
import type { ReviewControls } from '../../domain/intake.ts';
import { WILDCARD } from '../../domain/vocabulary.ts';
import type { ReadCtx, WriteCtx } from '../../http/context.ts';
import { getGroup } from '../org/service.ts';
import type { GroupView } from '../org/service.ts';
import { bindingIssues } from '../processing/service.ts';
import type { Binding } from '../processing/service.ts';
import { refreshIntakeStages, reviewItems } from './approvals.ts';
import { addFeedback } from './feedback.ts';
import { approvedReference } from './references.ts';
import {
  dataItemView,
  displayName,
  editDraft,
  featureDetail,
  getFeatureRow,
  lockFeatureFor,
  overlapOwners,
} from './service.ts';
import type { FeatureRow } from './service.ts';
import { commitSnapshot, resolveFiles } from './snapshots.ts';

/** What a DCL engineer can act on: submitted Features awaiting review, and overlapping sources. */
export async function intakeQueue(ctx: ReadCtx) {
  const grants = ctx.actor.grants;
  if (!grants.some((g) => g.role === 'DCL_ENGINEER')) throw new ForbiddenError('intake.read', 'ROLE_NOT_GRANTED', { type: 'intake' });

  const rows = await many<FeatureRow>(ctx.db, "SELECT * FROM features WHERE stage = 'SUBMITTED' ORDER BY updated_at, id");
  const groups = new Map<string, GroupView>();
  const features = [];
  for (const row of rows) {
    if (!authorize(grants, 'feature.review', { workspaceId: row.workspace_id, groupId: row.group_id }).ok) continue;
    const group = groups.get(row.group_id) ?? (await getGroup(ctx.db, row.group_id));
    groups.set(group.id, group);
    const reviews = await reviewItems(ctx.db, await commitSnapshot(ctx.db, row.head_commit_id!), {
      groupId: row.group_id,
      workspaceId: row.workspace_id,
    });
    features.push({
      featureId: row.id,
      name: row.name,
      workspaceId: row.workspace_id,
      groupId: row.group_id,
      groupCode: group.code,
      headCommitId: row.head_commit_id,
      displayName: displayName(row.base_release_id, group.code, row.name, row.sequence),
      submittedAt: row.updated_at.toISOString(),
      reviews,
    });
  }

  const items = await many<Parameters<typeof dataItemView>[0]>(ctx.db, "SELECT * FROM data_items WHERE status = 'REVIEW' ORDER BY created_at");
  const overlaps = [];
  for (const item of items) {
    const owners = await overlapOwners(ctx.db, item);
    const target = { groupId: owners.size === 1 ? item.owner_group_id : WILDCARD };
    if (authorize(grants, 'dataItem.reviewOverlap', target).ok) overlaps.push({ ...dataItemView(item), ownerGroupIds: [...owners].sort() });
  }
  return { features, overlaps };
}

function assertInIntake(feature: FeatureRow): void {
  if (!feature.head_commit_id || (feature.stage !== 'SUBMITTED' && feature.stage !== 'DCL_READY')) {
    throw rule('NOT_IN_INTAKE', `feature in stage ${feature.stage} is not in DCL intake`);
  }
}

export interface ReviewInput {
  commitId: string;
  dataKey: string;
  decision: 'APPROVED' | 'REJECTED';
  reason: string;
  controls?: ReviewControls;
}

/**
 * Records a decision on one file of the Feature's head commit, for the Feature's group and
 * workspace. A rejection sends the Feature back to its authors. Every submitted Feature there
 * that collects the same content is re-evaluated.
 */
export async function reviewFile(ctx: WriteCtx, featureId: string, input: ReviewInput) {
  const { feature, group } = await lockFeatureFor(ctx, 'feature.review', featureId, { intake: true });
  const scope = { groupId: group.id, workspaceId: feature.workspace_id };
  assertInIntake(feature);
  if (input.commitId !== feature.head_commit_id) {
    throw conflict('STALE_COMMIT', 'the Feature has a newer commit; review that one', { headCommitId: feature.head_commit_id });
  }
  const head = await commitSnapshot(ctx.db, feature.head_commit_id);
  const spec = (await resolveFiles(ctx.db, head))[input.dataKey];
  if (!spec) throw notFound('file in commit', input.dataKey);
  if (!spec.requiresReview) throw rule('REVIEW_NOT_REQUIRED', `file ${input.dataKey} does not need sensitive review`);
  if (input.reason.trim().length === 0) throw rule('REASON_REQUIRED', 'explain the decision');
  const referenced = !(input.dataKey in head.files);
  if (input.decision === 'APPROVED' && referenced && !(await approvedReference(ctx.db, input.dataKey, group.id, true))) {
    throw rule('REFERENCE_NOT_GRANTED', 'the reference to this file was revoked; it cannot be approved');
  }
  if (input.decision === 'APPROVED') {
    const issues = approvalControlIssues(input.controls);
    if (issues.length) throw rule('INCOMPLETE_CONTROLS', 'approval needs every control confirmed', { issues });
    const binding = await bindingIssues(ctx.db, spec);
    if (binding.length) throw rule('INCOMPATIBLE_BINDING', 'the Edge/Cloud binding is not compatible', { issues: binding });
  }

  const review = await one<{ id: string; created_at: Date }>(
    ctx.db,
    `INSERT INTO sensitive_reviews
       (group_id, workspace_id, data_key, feature_id, commit_id, file_signature, policy_signature, decision, reason, controls, reviewer)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id, created_at`,
    [
      scope.groupId,
      scope.workspaceId,
      input.dataKey,
      feature.id,
      feature.head_commit_id,
      fileApprovalSignature(spec),
      policyApprovalSignature(head.policies, input.dataKey),
      input.decision,
      input.reason.trim(),
      input.controls ? JSON.stringify(input.controls) : null,
      ctx.actor.username,
    ],
  );
  if (input.decision === 'REJECTED') {
    await ctx.db.query("UPDATE features SET stage = 'DRAFT', revision = revision + 1, updated_at = now() WHERE id = $1", [feature.id]);
    await addFeedback(ctx.db, {
      featureId: feature.id,
      commitId: feature.head_commit_id,
      kind: 'REVIEW_REJECTED',
      dataKey: input.dataKey,
      reason: input.reason.trim(),
      author: ctx.actor.username,
    });
  }
  await refreshIntakeStages(ctx.db, input.dataKey, scope);
  return {
    review: { id: review!.id, dataKey: input.dataKey, decision: input.decision, createdAt: review!.created_at.toISOString() },
    feature: await featureDetail(ctx.db, await getFeatureRow(ctx.db, feature.id), group),
  };
}

/** DCL sends a submitted Feature back to its authors with a reason. */
export async function returnFeature(ctx: WriteCtx, featureId: string, input: { expectedRevision: number; reason: string }) {
  const { feature, group } = await lockFeatureFor(ctx, 'feature.return', featureId);
  if (feature.revision !== input.expectedRevision) throw revisionConflict('feature', feature.id, feature.revision);
  assertInIntake(feature);
  if (input.reason.trim().length === 0) throw rule('REASON_REQUIRED', 'explain what needs to change');
  const updated = await one<FeatureRow>(
    ctx.db,
    "UPDATE features SET stage = 'DRAFT', revision = revision + 1, updated_at = now() WHERE id = $1 RETURNING *",
    [feature.id],
  );
  await addFeedback(ctx.db, {
    featureId: feature.id,
    commitId: feature.head_commit_id,
    kind: 'RETURNED',
    reason: input.reason.trim(),
    author: ctx.actor.username,
  });
  updated!.draft = normalizeConfig(updated!.draft);
  return featureDetail(ctx.db, updated!, group);
}

/**
 * DCL adjusts the processing binding of a file in a Feature draft (format, schema, Edge and
 * Cloud pipelines). Business fields stay with the business authors, who resubmit.
 */
export async function setBinding(
  ctx: WriteCtx,
  featureId: string,
  dataKey: string,
  input: Binding & { expectedRevision: number; reason: string },
) {
  if (input.reason.trim().length === 0) throw rule('REASON_REQUIRED', 'explain the binding change');
  return editDraft(
    ctx,
    featureId,
    input.expectedRevision,
    async (draft) => {
      const spec = draft.files[dataKey];
      if (!spec) throw notFound('owned file in draft', dataKey);
      const binding: Binding = {
        format: input.format,
        schema: input.schema,
        edgePipelineId: input.edgePipelineId,
        cloudPipelineId: input.cloudPipelineId,
      };
      const issues = await bindingIssues(ctx.db, binding);
      if (issues.length) throw rule('INCOMPATIBLE_BINDING', 'the Edge/Cloud binding is not compatible', { issues });
      draft.files[dataKey] = { ...spec, ...binding };
      return draft;
    },
    { action: 'feature.editBinding', feedback: { kind: 'BINDING_CHANGED', dataKey, reason: input.reason.trim() } },
  );
}
