// After-sales requests (售后回捞) and the periodic grader (Grader). After-sales asks one vehicle to
// capture one of its group's policies now, for a customer case; the vehicle answers on its next
// connected step and the capture runs as core business, first and over budget. Grader captures,
// computed periodically by the cloud, wait while after-sales work is open on the same vehicle.

import { notFound, rule } from '../domain/errors.ts';
import { newId } from '../domain/ids.ts';
import { isCollectionPaused } from './collection-hold.ts';
import type { Actor, Ctx } from './engine.ts';
import { capturablePolicies, captureEvent } from './events.ts';
import { workspaceVehicles } from './fleet.ts';
import { authorize } from '../domain/authz.ts';
import type { CaptureRequest, State } from './types.ts';

/** A business developer, tester or DCL engineer asks a vehicle of the workspace for a capture now. */
export function requestAfterSalesCapture(ctx: Ctx, input: { workspaceId: string; resourceId: string; policyId: string; reason: string }): string {
  const r = ctx.s.resources[input.resourceId];
  if (!r) throw notFound('vehicle', input.resourceId);
  const hit = capturablePolicies(ctx.s, r.id).find((p) => p.policyId === input.policyId);
  ctx.allow('event.requestCapture', { type: 'captureRequest', workspaceId: input.workspaceId, groupId: hit?.groupId, env: r.env });
  if (!workspaceVehicles(ctx.s, input.workspaceId).some((x) => x.id === r.id)) throw rule('VEHICLE_NOT_IN_WORKSPACE', `${r.id} does not work in workspace ${input.workspaceId}`);
  if (r.personal) throw rule('PERSONAL_TRIAL_ONLY', `${r.id} is a personal simulation; its captures are trials for its owner`);
  if (!hit) throw rule('POLICY_NOT_ON_VEHICLE', `policy ${input.policyId} is not in the configuration vehicle ${r.id} runs`);
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
    workspaceId: input.workspaceId,
    reason,
    requestedBy: ctx.user().username,
    requestedAt: ctx.now,
    status: 'PENDING',
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
  const groupId = capturablePolicies(ctx.s, r.id).find((p) => p.policyId === q.policyId)?.groupId;
  ctx.allow('event.requestCapture', { type: 'captureRequest', id: q.id, workspaceId: q.workspaceId, groupId, env: r.env });
  if (q.status !== 'PENDING') throw rule('REQUEST_ANSWERED', 'the vehicle already answered the request');
  q.status = 'CANCELLED';
  q.answeredAt = ctx.now;
}

/**
 * The vehicle answers an after-sales request (system context: the simulator): it captures the
 * policy as an after-sales capture. A vehicle that no longer runs the policy cancels the request.
 */
export function answerCaptureRequest(ctx: Ctx, requestId: string): string | null {
  const q = ctx.s.captureRequests[requestId];
  if (!q) throw notFound('after-sales request', requestId);
  if (q.status !== 'PENDING') throw rule('REQUEST_ANSWERED', 'the vehicle already answered the request');
  if (isCollectionPaused(ctx.s, q.resourceId)) throw rule('COLLECTION_PAUSED', `collection on ${q.resourceId} is paused`);
  q.answeredAt = ctx.now;
  if (!capturablePolicies(ctx.s, q.resourceId).some((p) => p.policyId === q.policyId)) {
    q.status = 'CANCELLED';
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

/** After-sales requests of a workspace the actor may make there, newest first. */
export function captureRequestsFor(s: State, actor: Actor, workspaceId: string): CaptureRequest[] {
  return Object.values(s.captureRequests)
    .filter((q) => q.workspaceId === workspaceId)
    .filter((q) => {
      const r = s.resources[q.resourceId];
      return !!r && authorize(actor.grants, 'event.requestCapture', { workspaceId, env: r.env }).ok;
    })
    .sort((a, b) => b.seq - a.seq);
}

/** Requests the vehicles have not answered yet. */
export function pendingCaptureRequests(s: State): CaptureRequest[] {
  return Object.values(s.captureRequests)
    .filter((q) => q.status === 'PENDING')
    .sort((a, b) => a.seq - b.seq);
}
