// The vehicle simulator: stands in for on-vehicle agents and simulators. It runs in the system
// context (no user) and talks to the platform only the way vehicles would: by sending receipts.

import type { Draft } from 'immer';
import { notFound } from '../domain/errors.ts';
import type { Ctx } from './engine.ts';
import type { AgentState, Resource, State } from './types.ts';
import { acceptReceipt } from './validation.ts';

export function setAgent(ctx: Ctx, resourceId: string, patch: Partial<AgentState>): void {
  const r = ctx.s.resources[resourceId] as Draft<Resource> | undefined;
  if (!r) throw notFound('vehicle', resourceId);
  Object.assign(r.agent, patch);
}

/** What each vehicle has been asked to apply and has not answered yet. */
export function pendingForVehicles(s: State) {
  return Object.values(s.deployments).flatMap((d) =>
    d.status === 'PENDING' || d.status === 'PAUSED' ? d.targets.filter((t) => t.status === 'PENDING').map((t) => ({ deployment: d, target: t })) : [],
  );
}

/** The vehicle answers one pending configuration. */
export function sendReceipt(ctx: Ctx, deploymentId: string, resourceId: string, result: 'APPLIED' | 'FAILED', error?: string) {
  const d = ctx.s.deployments[deploymentId];
  const t = d?.targets.find((x) => x.resourceId === resourceId);
  if (!d || !t) throw notFound('deployment target', `${deploymentId}/${resourceId}`);
  return acceptReceipt(ctx, { deploymentId, resourceId, attempt: t.attempt, result, ...(error ? { error } : {}) });
}

/** One simulator step: online vehicles in automatic mode answer their pending configurations. */
export function tick(ctx: Ctx): number {
  let answered = 0;
  for (const { deployment, target } of pendingForVehicles(ctx.s)) {
    const r = ctx.s.resources[target.resourceId]!;
    if (!r.agent.online || !r.agent.autoAck) continue;
    if (r.agent.failNext) {
      sendReceipt(ctx, deployment.id, r.id, 'FAILED', 'simulated apply failure');
      r.agent.failNext = false;
    } else {
      sendReceipt(ctx, deployment.id, r.id, 'APPLIED');
    }
    answered += 1;
  }
  return answered;
}
