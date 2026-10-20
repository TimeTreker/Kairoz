// Sensitive-file approval state. Approvals belong to content signatures within one group and
// workspace (the context that collects the data); a Feature's intake stage is derived from
// whether every file that needs review has a current approval there.

import type { Db } from '../../db/pool.ts';
import { many, one } from '../../db/pool.ts';
import type { GroupConfig } from '../../domain/config.ts';
import { fileApprovalSignature, policyApprovalSignature } from '../../domain/intake.ts';
import type { ReviewStatus } from '../../domain/intake.ts';
import { commitSnapshot, resolveFiles } from './snapshots.ts';

/** The context a decision applies to. A decision never reaches another group or workspace. */
export interface ReviewScope {
  groupId: string;
  workspaceId: string;
}

/**
 * Serializes everything that reads or changes a group's approval state: reviews, submits and
 * reference revocations. Taken before any Feature row lock, so they cannot deadlock.
 */
export async function lockIntake(db: Db, groupId: string): Promise<void> {
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`kairoz.intake.${groupId}`]);
}

export interface ReviewItem {
  dataKey: string;
  owned: boolean;
  fileSignature: string;
  policySignature: string;
  status: ReviewStatus;
  lastReview: { id: string; decision: 'APPROVED' | 'REJECTED'; reason: string; reviewer: string; createdAt: string } | null;
}

/** Review state, within `scope`, of every file in `config` that requires sensitive review. */
export async function reviewItems(db: Db, config: GroupConfig, scope: ReviewScope): Promise<ReviewItem[]> {
  const files = await resolveFiles(db, config);
  const items: ReviewItem[] = [];
  for (const dataKey of Object.keys(files).sort()) {
    const spec = files[dataKey]!;
    if (!spec.requiresReview) continue;
    const fileSignature = fileApprovalSignature(spec);
    const policySignature = policyApprovalSignature(config.policies, dataKey);
    const last = await one<{ id: string; decision: 'APPROVED' | 'REJECTED'; reason: string; reviewer: string; created_at: Date }>(
      db,
      `SELECT id, decision, reason, reviewer, created_at FROM sensitive_reviews
       WHERE group_id = $1 AND workspace_id = $2 AND data_key = $3 AND file_signature = $4 AND policy_signature = $5
       ORDER BY seq DESC LIMIT 1`,
      [scope.groupId, scope.workspaceId, dataKey, fileSignature, policySignature],
    );
    items.push({
      dataKey,
      owned: dataKey in config.files,
      fileSignature,
      policySignature,
      status: last?.decision ?? 'PENDING',
      lastReview: last
        ? { id: last.id, decision: last.decision, reason: last.reason, reviewer: last.reviewer, createdAt: last.created_at.toISOString() }
        : null,
    });
  }
  return items;
}

/** A submitted Feature is DCL Ready exactly when every file needing review is approved. */
export function intakeStage(items: readonly ReviewItem[]): 'SUBMITTED' | 'DCL_READY' {
  return items.every((i) => i.status === 'APPROVED') ? 'DCL_READY' : 'SUBMITTED';
}

/**
 * Re-derives the stage of every submitted Feature in `scope` whose head commit collects
 * `dataKey`, after a decision changed what is approved there. Caller holds the intake lock.
 */
export async function refreshIntakeStages(db: Db, dataKey: string, scope: ReviewScope): Promise<void> {
  const features = await many<{ id: string; stage: string; head_commit_id: string }>(
    db,
    `SELECT f.id, f.stage, f.head_commit_id FROM features f
       JOIN commits c ON c.id = f.head_commit_id
       JOIN manifest_entries e ON e.manifest_version_id = c.manifest_version_id
     WHERE e.data_key = $1 AND f.group_id = $2 AND f.workspace_id = $3 AND f.stage IN ('SUBMITTED', 'DCL_READY')
     ORDER BY f.id
     FOR UPDATE OF f`,
    [dataKey, scope.groupId, scope.workspaceId],
  );
  for (const f of features) {
    const stage = intakeStage(await reviewItems(db, await commitSnapshot(db, f.head_commit_id), scope));
    if (stage !== f.stage) {
      await db.query('UPDATE features SET stage = $2, revision = revision + 1, updated_at = now() WHERE id = $1', [f.id, stage]);
    }
  }
}
