// DCL intake (DCL 接入): the work queue, sensitive-file review of committed content, returning a
// Feature to its authors, and adjusting a file's processing binding.

import { authorize } from '../domain/authz.ts';
import { approvalControlIssues, fileApprovalSignature, policyApprovalSignature } from '../domain/intake.ts';
import type { ReviewControls } from '../domain/intake.ts';
import { conflict, notFound, rule } from '../domain/errors.ts';
import { newId } from '../domain/ids.ts';
import { WILDCARD } from '../domain/vocabulary.ts';
import { refreshIntakeStages, reviewItems } from './approvals.ts';
import type { ReviewItem } from './approvals.ts';
import { addFeedback, authorizeFeature, editDraft, overlapOwners } from './config.ts';
import type { Actor, Ctx } from './engine.ts';
import { bindingIssues } from './processing.ts';
import type { Binding } from './processing.ts';
import { approvedReference } from './references.ts';
import { commitSnapshot, resolveFiles } from './snapshots.ts';
import type { DataItem, Feature, State } from './types.ts';

export interface IntakeQueue {
  features: { feature: Feature; reviews: ReviewItem[] }[];
  overlaps: { item: DataItem; ownerGroupIds: string[] }[];
}

/** What a DCL engineer can act on: submitted Features awaiting review, and overlapping sources. */
export function intakeQueue(s: State, actor: Actor): IntakeQueue {
  const features = Object.values(s.features)
    .filter((f) => f.stage === 'SUBMITTED' && authorize(actor.grants, 'feature.review', { workspaceId: f.workspaceId, groupId: f.groupId }).ok)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? -1 : 1))
    .map((feature) => ({
      feature,
      reviews: reviewItems(s, commitSnapshot(s, feature.headCommitId!), { groupId: feature.groupId, workspaceId: feature.workspaceId }),
    }));
  const overlaps = Object.values(s.dataItems)
    .filter((item) => item.status === 'REVIEW')
    .flatMap((item) => {
      const owners = overlapOwners(s, item.dataKey);
      const target = { groupId: owners.size === 1 ? item.ownerGroupId : WILDCARD };
      return authorize(actor.grants, 'dataItem.reviewOverlap', target).ok ? [{ item, ownerGroupIds: [...owners].sort() }] : [];
    });
  return { features, overlaps };
}

function assertInIntake(feature: Feature): void {
  if (!feature.headCommitId || (feature.stage !== 'SUBMITTED' && feature.stage !== 'DCL_READY')) {
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
 * workspace. A rejection sends the Feature back to its authors. Every Feature in intake there
 * that collects the same content is re-evaluated.
 */
export function reviewFile(ctx: Ctx, featureId: string, input: ReviewInput): void {
  const { feature, group } = authorizeFeature(ctx, 'feature.review', featureId);
  assertInIntake(feature);
  if (input.commitId !== feature.headCommitId) {
    throw conflict('STALE_COMMIT', 'the Feature has a newer commit; review that one', { headCommitId: feature.headCommitId });
  }
  const head = commitSnapshot(ctx.s, feature.headCommitId);
  const spec = resolveFiles(ctx.s, head)[input.dataKey];
  if (!spec) throw notFound('file in commit', input.dataKey);
  if (!spec.requiresReview) throw rule('REVIEW_NOT_REQUIRED', `file ${input.dataKey} does not need sensitive review`);
  if (!input.reason.trim()) throw rule('REASON_REQUIRED', 'explain the decision');
  if (input.decision === 'APPROVED') {
    if (!(input.dataKey in head.files) && !approvedReference(ctx.s, input.dataKey, group.id)) {
      throw rule('REFERENCE_NOT_GRANTED', 'the reference to this file was revoked; it cannot be approved');
    }
    const issues = approvalControlIssues(input.controls);
    if (issues.length) throw rule('INCOMPLETE_CONTROLS', 'approval needs every control confirmed', { issues });
    const binding = bindingIssues(ctx.s, spec);
    if (binding.length) throw rule('INCOMPATIBLE_BINDING', 'the Edge/Cloud binding is not compatible', { issues: binding });
  }
  const scope = { groupId: group.id, workspaceId: feature.workspaceId };
  ctx.s.sensitiveReviews.push({
    id: newId('sr'),
    seq: ctx.seq(),
    ...scope,
    dataKey: input.dataKey,
    featureId: feature.id,
    commitId: feature.headCommitId,
    fileSignature: fileApprovalSignature(spec),
    policySignature: policyApprovalSignature(head.policies, input.dataKey),
    decision: input.decision,
    reason: input.reason.trim(),
    controls: input.controls ? { ...input.controls } : null,
    reviewer: ctx.user().username,
    createdAt: ctx.now,
  });
  if (input.decision === 'REJECTED') {
    feature.stage = 'DRAFT';
    feature.updatedAt = ctx.now;
    addFeedback(ctx, { featureId: feature.id, commitId: feature.headCommitId, kind: 'REVIEW_REJECTED', dataKey: input.dataKey, reason: input.reason.trim() });
  }
  refreshIntakeStages(ctx.s, input.dataKey, scope, ctx.now);
}

/** DCL sends a Feature in intake back to its authors with a reason. */
export function returnFeature(ctx: Ctx, featureId: string, input: { reason: string }): void {
  const { feature } = authorizeFeature(ctx, 'feature.return', featureId);
  assertInIntake(feature);
  if (!input.reason.trim()) throw rule('REASON_REQUIRED', 'explain what needs to change');
  feature.stage = 'DRAFT';
  feature.updatedAt = ctx.now;
  addFeedback(ctx, { featureId: feature.id, commitId: feature.headCommitId, kind: 'RETURNED', reason: input.reason.trim() });
}

/** DCL rebinds a file in its own technical change: no feedback, DCL submits the change itself. */
export function setTechnicalBinding(ctx: Ctx, featureId: string, dataKey: string, input: Binding): void {
  editDraft(
    ctx,
    featureId,
    (draft, feature) => {
      if (feature.kind !== 'TECHNICAL') throw rule('NOT_TECHNICAL', 'only a DCL technical change is rebound this way; adjust a business Feature in intake');
      const spec = draft.files[dataKey];
      if (!spec) throw notFound('owned file in draft', dataKey);
      const binding: Binding = { format: input.format, schema: input.schema, edgePipelineId: input.edgePipelineId, cloudPipelineId: input.cloudPipelineId };
      const issues = bindingIssues(ctx.s, binding);
      if (issues.length) throw rule('INCOMPATIBLE_BINDING', 'the Edge/Cloud binding is not compatible', { issues });
      Object.assign(spec, binding);
    },
    { action: 'feature.editBinding' },
  );
}

/** DCL adjusts the processing binding of a file in a draft. Business authors resubmit. */
export function setBinding(ctx: Ctx, featureId: string, dataKey: string, input: Binding & { reason: string }): void {
  if (ctx.s.features[featureId]?.kind === 'TECHNICAL') throw rule('NOT_IN_INTAKE', 'a technical change is DCL’s own; rebind it directly');
  if (!input.reason.trim()) throw rule('REASON_REQUIRED', 'explain the binding change');
  editDraft(
    ctx,
    featureId,
    (draft) => {
      const spec = draft.files[dataKey];
      if (!spec) throw notFound('owned file in draft', dataKey);
      const binding: Binding = { format: input.format, schema: input.schema, edgePipelineId: input.edgePipelineId, cloudPipelineId: input.cloudPipelineId };
      const issues = bindingIssues(ctx.s, binding);
      if (issues.length) throw rule('INCOMPATIBLE_BINDING', 'the Edge/Cloud binding is not compatible', { issues });
      Object.assign(spec, binding);
    },
    { action: 'feature.editBinding', feedback: { kind: 'BINDING_CHANGED', dataKey, reason: input.reason.trim() } },
  );
}
