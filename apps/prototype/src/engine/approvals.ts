// Sensitive-file approval state. Approvals belong to content signatures within one group and
// workspace (the context that collects the data); a Feature's intake stage is derived from
// whether every file that needs review has a current approval there.

import type { Draft } from 'immer';
import type { GroupConfig } from '../domain/config.ts';
import { fileApprovalSignature, policyApprovalSignature } from '../domain/intake.ts';
import type { ReviewStatus } from '../domain/intake.ts';
import { commitSnapshot, resolveFiles } from './snapshots.ts';
import { stageAfterIntake } from './stages.ts';
import type { SensitiveReview, State } from './types.ts';

/** The context a decision applies to. A decision never reaches another group or workspace. */
export interface ReviewScope {
  groupId: string;
  workspaceId: string;
}

export interface ReviewItem {
  dataKey: string;
  owned: boolean;
  fileSignature: string;
  policySignature: string;
  status: ReviewStatus;
  lastReview: SensitiveReview | null;
}

/** Review state, within `scope`, of every file in `config` that requires sensitive review. */
export function reviewItems(s: State, config: GroupConfig, scope: ReviewScope): ReviewItem[] {
  const files = resolveFiles(s, config);
  return Object.keys(files)
    .sort()
    .filter((dataKey) => files[dataKey]!.requiresReview)
    .map((dataKey) => {
      const fileSignature = fileApprovalSignature(files[dataKey]!);
      const policySignature = policyApprovalSignature(config.policies, dataKey);
      let last: SensitiveReview | null = null;
      for (const r of s.sensitiveReviews) {
        if (
          r.groupId === scope.groupId &&
          r.workspaceId === scope.workspaceId &&
          r.dataKey === dataKey &&
          r.fileSignature === fileSignature &&
          r.policySignature === policySignature &&
          (!last || r.seq > last.seq)
        ) {
          last = r;
        }
      }
      return { dataKey, owned: dataKey in config.files, fileSignature, policySignature, status: last?.decision ?? 'PENDING', lastReview: last };
    });
}

/** A submitted Feature is DCL Ready exactly when every file needing review is approved. */
export function intakeStage(items: readonly ReviewItem[]): 'SUBMITTED' | 'DCL_READY' {
  return items.every((i) => i.status === 'APPROVED') ? 'DCL_READY' : 'SUBMITTED';
}

/**
 * Re-derives the stage of every submitted Feature within `scope` whose head collects `dataKey`.
 * A Feature in testing whose approval was revoked goes back to SUBMITTED.
 */
export function refreshIntakeStages(s: Draft<State>, dataKey: string, scope: ReviewScope, now: string): void {
  for (const f of Object.values(s.features)) {
    if (f.groupId !== scope.groupId || f.workspaceId !== scope.workspaceId) continue;
    if (!['SUBMITTED', 'DCL_READY', 'TESTING', 'VERIFIED'].includes(f.stage)) continue;
    const head = commitSnapshot(s, f.headCommitId!);
    if (!(dataKey in head.files) && !(dataKey in head.references)) continue;
    const stage = stageAfterIntake(s, f, intakeStage(reviewItems(s, head, scope)));
    if (stage !== f.stage) {
      f.stage = stage;
      f.updatedAt = now;
    }
  }
}
