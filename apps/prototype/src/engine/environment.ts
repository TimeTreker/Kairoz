// Moving a vehicle between development, testing and production (资源环境迁移). Only vehicle
// resources move a vehicle, with a grant for both environments. Everything in flight ends first:
// groups, dispatches and rollouts, reservations, loans, running instances and events being
// processed. A vehicle enters production only running a formal policy set that applies to its
// software. The move never changes the vehicle's software or applied configuration.

import { ENVS } from '../domain/vocabulary.ts';
import type { Env } from '../domain/vocabulary.ts';
import { rule } from '../domain/errors.ts';
import { newId } from '../domain/ids.ts';
import type { Ctx } from './engine.ts';
import { getResource, isUnreleased, openOtaOf, pendingDeploymentOf, pendingImageChangeOf, pendingSoftwareUpdateOf } from './fleet.ts';
import { applicableVersions } from './release.ts';
import type { EnvironmentChange, Resource, State } from './types.ts';

/** Why the vehicle cannot move to `to` now (empty when it can). */
export function environmentMoveProblems(s: State, r: Resource, to: Env): string[] {
  // These never move, whatever else is in flight.
  if (r.personal) return [`personal simulation of ${r.personal.owner}; only its owner uses it`];
  if (r.type === 'SIMULATION' && to === 'production') return ['simulation instances are for development and testing'];
  const problems: string[] = [];
  const vg = s.vehicleGroups[s.groupMembers[r.id] ?? ''];
  if (vg) problems.push(`routes through vehicle group ${vg.name}; take it out first`);
  if (r.instance === 'RUNNING') problems.push('simulation running; stop the instance first');
  if (r.reservation) problems.push(`reserved for ${r.reservation.purpose}; release it first`);
  if (Object.values(s.loans).some((l) => l.resourceId === r.id && (l.status === 'REQUESTED' || l.status === 'APPROVED'))) problems.push(`the loan of ${r.id} is open`);
  const pending = pendingDeploymentOf(s, r.id) ?? openOtaOf(s, r.id);
  if (pending) problems.push(`waiting for deployment ${pending}`);
  if (pendingImageChangeOf(s, r.id)) problems.push('waiting for an image change');
  if (pendingSoftwareUpdateOf(s, r.id)) problems.push('waiting for a software update');
  for (const e of Object.values(s.events)) {
    if (e.resourceId !== r.id) continue;
    if (e.status === 'UPLOADING' || e.status === 'PROCESSING') problems.push(`event ${e.id} is still being processed`);
    else if (e.status === 'HELD') problems.push(`event ${e.id} still waits on the vehicle for upload budget`);
  }
  for (const q of Object.values(s.captureRequests)) {
    if (q.resourceId === r.id && q.status === 'PENDING') problems.push(`after-sales request ${q.id} is pending`);
  }
  if (to === 'production') {
    for (const ws of Object.values(s.workspaces)) {
      // An archived team workspace counts too: restored, it would hold a production vehicle.
      if (ws.kind === 'TEAM' && (s.workspaceResources[ws.id] ?? []).includes(r.id)) problems.push(`team workspace ${ws.name} uses it; production vehicles never serve team workspaces`);
    }
    if (!r.integrationVersion || r.softwareStatus !== 'CONSISTENT') problems.push('software version unknown');
    else if (isUnreleased(s, r.vehicleModelId, r.integrationVersion)) problems.push(`runs software ${r.integrationVersion} PLM has not released yet`);
    else {
      const applied = r.appliedConfigId ? s.resolvedConfigs[r.appliedConfigId] : undefined;
      const release = applied?.kind === 'RELEASE' ? s.releases[applied.sourceId] : undefined;
      if (!release || !applicableVersions(s, release).includes(r.integrationVersion)) problems.push(`runs no formal policy set for software ${r.integrationVersion}; roll one out to it first`);
    }
  }
  return problems;
}

/** Vehicle resources move a vehicle to another environment, with a reason. */
export function setResourceEnvironment(ctx: Ctx, resourceId: string, input: { env: Env; reason: string }): string {
  const r = getResource(ctx.s, resourceId);
  if (!ENVS.includes(input.env)) throw rule('INVALID_ENV', `unknown environment ${input.env}`);
  // Both ends: a grant for where the vehicle is and one for where it goes, each complete on its own.
  ctx.allow('resource.manage', { type: 'resource', id: r.id, scope: r.pool, env: r.env });
  ctx.allow('resource.manage', { type: 'resource', id: r.id, scope: r.pool, env: input.env });
  if (input.env === r.env) throw rule('SAME_ENVIRONMENT', `${r.id} is already a ${r.env} vehicle`);
  if (!input.reason.trim()) throw rule('REASON_REQUIRED', 'say why the vehicle moves');
  const problems = environmentMoveProblems(ctx.s, r, input.env);
  if (problems.length) throw rule('ENV_MOVE_BLOCKED', 'finish what is in flight first', { issues: problems.map((p) => `${r.id}: ${p}`) });
  const id = newId('envmove');
  ctx.s.environmentChanges.push({ id, seq: ctx.seq(), resourceId: r.id, from: r.env, to: input.env, reason: input.reason.trim(), by: ctx.user().username, at: ctx.now });
  const draft = ctx.s.resources[r.id]!;
  draft.env = input.env;
  draft.updatedAt = ctx.now;
  return id;
}

/** A vehicle's environment moves, newest first. */
export function environmentHistory(s: State, resourceId: string): EnvironmentChange[] {
  return s.environmentChanges.filter((c) => c.resourceId === resourceId).sort((a, b) => b.seq - a.seq);
}
