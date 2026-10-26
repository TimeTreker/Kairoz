// Emergency collection pause (紧急停采) of one vehicle. DCL engineering or configuration release
// stops a vehicle's collection at once, with a reason, without a new policy set (the two-person
// emergency stop of a policy is the lasting fix). The vehicle refuses new triggers from the
// moment of the request; when its agent confirms, captures it still holds are dropped. Resuming
// takes a reason and is confirmed the same way. The history stays.

import { notFound, rule } from '../domain/errors.ts';
import type { Ctx } from './engine.ts';
import { simulationWorkspace } from './fleet.ts';
import type { CollectionHold, State } from './types.ts';

/** Whether the vehicle refuses new triggers: a pause asked, confirmed, or not lifted yet. */
export function isCollectionPaused(s: State, resourceId: string): boolean {
  const h = s.collectionHolds[resourceId];
  return !!h && h.state !== 'ACTIVE';
}

export function holdOf(s: State, resourceId: string): CollectionHold | null {
  return s.collectionHolds[resourceId] ?? null;
}

function authorizeHold(ctx: Ctx, resourceId: string) {
  const r = ctx.s.resources[resourceId];
  if (!r) throw notFound('vehicle', resourceId);
  ctx.allow('collection.pause', { type: 'collectionHold', id: r.id, workspaceId: simulationWorkspace(ctx.s, r) ?? undefined, env: r.env });
  return r;
}

export function pauseCollection(ctx: Ctx, resourceId: string, input: { reason: string }): void {
  const r = authorizeHold(ctx, resourceId);
  if (isCollectionPaused(ctx.s, r.id)) throw rule('ALREADY_PAUSED', `collection on ${r.id} is already paused`);
  const reason = input.reason.trim();
  if (!reason) throw rule('REASON_REQUIRED', 'give a reason');
  const hold = (ctx.s.collectionHolds[r.id] ??= { resourceId: r.id, state: 'ACTIVE', history: [] });
  hold.state = 'PAUSING';
  hold.history.push({ action: 'PAUSE', reason, by: ctx.user().username, at: ctx.now, confirmedAt: null });
}

export function resumeCollection(ctx: Ctx, resourceId: string, input: { reason: string }): void {
  const r = authorizeHold(ctx, resourceId);
  const hold = ctx.s.collectionHolds[r.id];
  if (!hold || hold.state === 'ACTIVE' || hold.state === 'RESUMING') throw rule('NOT_PAUSED', `collection on ${r.id} is not paused`);
  if (hold.state === 'PAUSING') throw rule('PAUSE_UNCONFIRMED', `${r.id} has not confirmed the pause yet`);
  const reason = input.reason.trim();
  if (!reason) throw rule('REASON_REQUIRED', 'give a reason');
  hold.state = 'RESUMING';
  hold.history.push({ action: 'RESUME', reason, by: ctx.user().username, at: ctx.now, confirmedAt: null });
}

/**
 * The vehicle's agent confirms a pending pause or resume (system context: the simulator). A
 * confirmed pause drops what the vehicle still holds; captures already uploaded stay.
 */
export function confirmHold(ctx: Ctx, resourceId: string): 'PAUSED' | 'ACTIVE' {
  const hold = ctx.s.collectionHolds[resourceId];
  if (!hold || (hold.state !== 'PAUSING' && hold.state !== 'RESUMING')) throw rule('NOTHING_TO_CONFIRM', `${resourceId} has no pause or resume to confirm`);
  const last = hold.history.at(-1)!;
  last.confirmedAt = ctx.now;
  if (hold.state === 'RESUMING') {
    hold.state = 'ACTIVE';
    return 'ACTIVE';
  }
  hold.state = 'PAUSED';
  for (const e of Object.values(ctx.s.events)) {
    if (e.resourceId !== resourceId || (e.status !== 'HELD' && e.status !== 'UPLOADING')) continue;
    e.status = 'DROPPED';
    e.budgetNote = 'EMERGENCY_HOLD';
    e.failure = `EmergencyHold: ${last.reason}`;
  }
  return 'PAUSED';
}

/** Vehicles waiting to confirm a pause or resume. */
export function pendingHolds(s: State): CollectionHold[] {
  return Object.values(s.collectionHolds).filter((h) => h.state === 'PAUSING' || h.state === 'RESUMING');
}
