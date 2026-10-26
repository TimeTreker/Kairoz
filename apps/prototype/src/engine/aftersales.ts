// After-sales requests (售后回捞) and the periodic grader (Grader). After-sales asks one vehicle to
// capture one of its group's policies now, for a customer case; the vehicle answers on its next
// connected step and the capture runs as core business, first and over budget. Grader captures,
// computed periodically by the cloud, wait while after-sales work is open on the same vehicle.

import { authorize } from '../domain/authz.ts';
import { notFound, rule } from '../domain/errors.ts';
import { newId } from '../domain/ids.ts';
import { isCollectionPaused } from './collection-hold.ts';
import type { Actor, Ctx } from './engine.ts';
import { capturablePolicies, captureEvent } from './events.ts';
import { activeLoanOf, workspaceVehicles } from './fleet.ts';
import type { CaptureRequest, State } from './types.ts';

/**
 * Why a vehicle cannot capture for a workspace now, or null: it is retired, not one of the
 * workspace's vehicles, lent to another workspace (only the borrower works with it), the
 * workspace is archived, or it no longer runs the policy.
 */
function requestProblem(s: State, resourceId: string, workspaceId: string, policyId: string): string | null {
  const r = s.resources[resourceId];
  if (!r) return `vehicle ${resourceId} is gone`;
  if (r.status === 'RETIRED') return `${r.id} is retired`;
  if (s.workspaces[workspaceId]?.status !== 'ACTIVE') return `workspace ${workspaceId} is archived`;
  if (!workspaceVehicles(s, workspaceId).some((x) => x.id === r.id)) return `${r.id} does not work in workspace ${workspaceId}`;
  const loan = activeLoanOf(s, r.id);
  if (loan && loan.workspaceId !== workspaceId) return `${r.id} is lent to ${s.workspaces[loan.workspaceId]?.name ?? loan.workspaceId}`;
  if (!capturablePolicies(s, r.id).some((p) => p.policyId === policyId)) return `policy ${policyId} is not in the configuration ${r.id} runs`;
  return null;
}

/** A business developer, tester or DCL engineer asks a vehicle of the workspace for a capture now. */
export function requestAfterSalesCapture(ctx: Ctx, input: { workspaceId: string; resourceId: string; policyId: string; reason: string }): string {
  const r = ctx.s.resources[input.resourceId];
  if (!r) throw notFound('vehicle', input.resourceId);
  // The policy's owning group decides who may ask; a policy the vehicle does not run is refused below.
  const groupId = ctx.s.policyOwners[input.policyId] ?? capturablePolicies(ctx.s, r.id).find((p) => p.policyId === input.policyId)?.groupId ?? '';
  ctx.allow('event.requestCapture', { type: 'captureRequest', workspaceId: input.workspaceId, groupId, env: r.env });
  if (r.personal) throw rule('PERSONAL_TRIAL_ONLY', `${r.id} is a personal simulation; its captures are trials for its owner`);
  if (r.status === 'RETIRED') throw rule('VEHICLE_UNAVAILABLE', `${r.id} is retired`);
  if (!workspaceVehicles(ctx.s, input.workspaceId).some((x) => x.id === r.id)) throw rule('VEHICLE_NOT_IN_WORKSPACE', `${r.id} does not work in workspace ${input.workspaceId}`);
  const loan = activeLoanOf(ctx.s, r.id);
  if (loan && loan.workspaceId !== input.workspaceId) throw rule('VEHICLE_ON_LOAN', `${r.id} is lent to ${ctx.s.workspaces[loan.workspaceId]?.name ?? loan.workspaceId}; only the borrower works with it`);
  if (!capturablePolicies(ctx.s, r.id).some((p) => p.policyId === input.policyId)) throw rule('POLICY_NOT_ON_VEHICLE', `policy ${input.policyId} is not in the configuration vehicle ${r.id} runs`);
  if (isCollectionPaused(ctx.s, r.id)) throw rule('COLLECTION_PAUSED', `collection on ${r.id} is paused`);
  const reason = input.reason.trim();
  if (!reason) throw rule('REASON_REQUIRED', 'give the customer case or reason');
  if (Object.values(ctx.s.captureRequests).some((q) => q.resourceId === r.id && q.policyId === input.policyId && q.status === 'PENDING')) {
    throw rule('REQUEST_PENDING', `${r.id} already has a pending after-sales request for ${input.policyId}`);
  }
  const id = newId('cr');
  ctx.s.captureRequests[id] = {
    id,
    seq: ctx.seq(),
    resourceId: r.id,
    policyId: input.policyId,
    groupId,
    workspaceId: input.workspaceId,
    reason,
    requestedBy: ctx.user().username,
    requestedAt: ctx.now,
    status: 'PENDING',
    cancelledBy: null,
    note: null,
    eventId: null,
    answeredAt: null,
  };
  return id;
}

/** The requester (or another account allowed to ask there) withdraws a request the vehicle has not answered. */
export function cancelCaptureRequest(ctx: Ctx, requestId: string): void {
  const q = ctx.s.captureRequests[requestId];
  if (!q) throw notFound('after-sales request', requestId);
  const r = ctx.s.resources[q.resourceId]!;
  ctx.allow('event.requestCapture', { type: 'captureRequest', id: q.id, workspaceId: q.workspaceId, groupId: q.groupId, env: r.env });
  if (q.status !== 'PENDING') throw rule('REQUEST_ANSWERED', 'the vehicle already answered the request');
  q.status = 'CANCELLED';
  q.cancelledBy = ctx.user().username;
  q.answeredAt = ctx.now;
}

/**
 * The vehicle answers an after-sales request (system context: the simulator): it captures the
 * policy as an after-sales capture. When it can no longer capture for the asking workspace (the
 * loan ended, it was lent away or retired, the workspace archived, the policy gone), the platform
 * cancels the request and says why.
 */
export function answerCaptureRequest(ctx: Ctx, requestId: string): string | null {
  const q = ctx.s.captureRequests[requestId];
  if (!q) throw notFound('after-sales request', requestId);
  if (q.status !== 'PENDING') throw rule('REQUEST_ANSWERED', 'the vehicle already answered the request');
  if (isCollectionPaused(ctx.s, q.resourceId)) throw rule('COLLECTION_PAUSED', `collection on ${q.resourceId} is paused`);
  q.answeredAt = ctx.now;
  const problem = requestProblem(ctx.s, q.resourceId, q.workspaceId, q.policyId);
  if (problem) {
    q.status = 'CANCELLED';
    q.note = problem;
    return null;
  }
  // The request is answered by this capture; it no longer counts as open after-sales work.
  q.status = 'CAPTURED';
  const eventId = captureEvent(ctx, { resourceId: q.resourceId, policyId: q.policyId, source: 'AFTERSALES', requestId: q.id, workspaceId: q.workspaceId });
  q.eventId = eventId;
  return eventId;
}

/** The cloud's periodic grader computes a capture for a vehicle's policy (system context: the simulator). */
export function graderCapture(ctx: Ctx, resourceId: string, policyId: string): string {
  return captureEvent(ctx, { resourceId, policyId, source: 'GRADER' });
}

/** Whether the actor may see and cancel a request: a grant to ask for that group's policies there. */
export function canHandleRequest(s: State, actor: Actor, q: CaptureRequest): boolean {
  const r = s.resources[q.resourceId];
  return !!r && authorize(actor.grants, 'event.requestCapture', { workspaceId: q.workspaceId, groupId: q.groupId, env: r.env }).ok;
}

/** After-sales requests of a workspace the actor may handle there (its own groups' policies), newest first. */
export function captureRequestsFor(s: State, actor: Actor, workspaceId: string): CaptureRequest[] {
  return Object.values(s.captureRequests)
    .filter((q) => q.workspaceId === workspaceId && canHandleRequest(s, actor, q))
    .sort((a, b) => b.seq - a.seq);
}

/** Requests the vehicles have not answered yet. */
export function pendingCaptureRequests(s: State): CaptureRequest[] {
  return Object.values(s.captureRequests)
    .filter((q) => q.status === 'PENDING')
    .sort((a, b) => a.seq - b.seq);
}
