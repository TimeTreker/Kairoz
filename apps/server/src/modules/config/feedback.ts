import type { Db } from '../../db/pool.ts';

export type FeedbackKind = 'RETURNED' | 'REVIEW_REJECTED' | 'BINDING_CHANGED' | 'REFERENCE_REVOKED';

/** Kinds that ask the authors for changes: an unchanged resubmit of that commit is refused. */
export const CHANGE_REQUESTS: readonly FeedbackKind[] = ['RETURNED', 'BINDING_CHANGED', 'REFERENCE_REVOKED'];

export async function addFeedback(
  db: Db,
  input: { featureId: string; commitId: string | null; kind: FeedbackKind; dataKey?: string; reason: string; author: string },
): Promise<void> {
  await db.query(
    'INSERT INTO feature_feedback (feature_id, commit_id, kind, data_key, reason, author) VALUES ($1, $2, $3, $4, $5, $6)',
    [input.featureId, input.commitId, input.kind, input.dataKey ?? null, input.reason, input.author],
  );
}
