// Readable names for records whose ids are opaque: a merge preview, a dispatch or a rollout is
// known by its number within its workspace (or subject), as candidates are (X89-C2).

import type { Deployment, MergePlan, State } from './types.ts';

/** A merge preview's number among its workspace's previews (ids sort by creation). */
export function planNumber(s: State, plan: Pick<MergePlan, 'id' | 'workspaceId'>): number {
  return Object.values(s.mergePlans).filter((p) => p.workspaceId === plan.workspaceId && p.id <= plan.id).length;
}

/** A dispatch's number among the dispatches of its subject (a Feature, candidate or set), or a rollout's among its model's rollouts. */
export function deploymentNumber(s: State, d: Pick<Deployment, 'id' | 'kind' | 'subjectId'>): number {
  if (d.kind === 'OTA') {
    const model = s.releases[d.subjectId]?.vehicleModelId;
    return Object.values(s.deployments).filter((x) => x.kind === 'OTA' && s.releases[x.subjectId]?.vehicleModelId === model && x.id <= d.id).length;
  }
  return Object.values(s.deployments).filter((x) => x.kind === d.kind && x.subjectId === d.subjectId && x.id <= d.id).length;
}
