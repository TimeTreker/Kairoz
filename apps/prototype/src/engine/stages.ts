// Feature stage after intake: once DCL Ready, existing test work on the same head commit is
// restored (TESTING / VERIFIED) rather than forgotten.

import type { Feature, FeatureStage, State } from './types.ts';

export function stageAfterIntake(s: State, feature: Pick<Feature, 'id' | 'headCommitId' | 'verifiedCommitId'>, intake: 'SUBMITTED' | 'DCL_READY'): FeatureStage {
  if (intake !== 'DCL_READY' || !feature.headCommitId) return intake;
  if (feature.verifiedCommitId === feature.headCommitId) return 'VERIFIED';
  const tested = s.testTargets.some((t) => t.subjectKind === 'FEATURE' && t.subjectId === feature.id && t.versionId === feature.headCommitId);
  return tested ? 'TESTING' : 'DCL_READY';
}
