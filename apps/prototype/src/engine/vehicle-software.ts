// Updating a vehicle's whole-vehicle software (整车软件更新). Instead of adapting the policies to the
// software a vehicle runs, its team can ask the vehicle OTA system (outside the platform) to put it
// on another recorded version the policies fit. The platform records the request and the OTA
// system's answer; what the vehicle runs it learns only from the vehicle's own report after the
// restart. The vehicle then follows its group again: what was dispatched is pushed if it fits.

import type { Draft } from 'immer';
import { conflict, notFound, rule } from '../domain/errors.ts';
import { newId } from '../domain/ids.ts';
import type { Ctx } from './engine.ts';
import { groupPublicationBase } from './delivery.ts';
import { assertIdle, assertNotLentAway, getResource, pendingSoftwareUpdateOf, softwareKey } from './fleet.ts';
import { assessPublicationOn } from './software-change.ts';
import type { PublicationCheck } from './software-change.ts';
import type { Resource, State, VehicleGroup, VehicleSoftwareRequest } from './types.ts';

function groupIn(s: State, workspaceId: string, resourceId: string): VehicleGroup | undefined {
  const g = s.vehicleGroups[s.groupMembers[resourceId] ?? ''];
  return g && g.workspaceId === workspaceId ? g : undefined;
}

/**
 * Business development and testing update the vehicles of their own business group's vehicle
 * groups; the workspace admin and vehicle resources update any vehicle the workspace uses.
 */
function authorizeUpdate(ctx: Ctx, workspaceId: string, r: Resource): void {
  const g = groupIn(ctx.s, workspaceId, r.id);
  const business = g?.groupId ? ctx.s.groups[g.groupId] : undefined;
  const grant = ctx.allow('vehicle.updateSoftware', { type: 'vehicle', id: r.id, workspaceId, ...(business ? { groupId: business.id } : {}), scope: r.pool, env: r.env });
  if ((grant.role === 'BUSINESS_DEV' || grant.role === 'BUSINESS_TEST') && !business) {
    throw rule('NOT_IN_TEAM_GROUP', `${r.id} is in no vehicle group of a business group; ask the workspace admin`);
  }
}

export function getSoftwareRequest(s: State, id: string): VehicleSoftwareRequest {
  const q = s.vehicleSoftwareRequests[id];
  if (!q) throw notFound('software update', id);
  return q;
}

/** Asks the vehicle OTA system to put a development or testing vehicle on a recorded version. */
export function requestVehicleSoftware(ctx: Ctx, workspaceId: string, resourceId: string, input: { version: string; reason: string }): string {
  const r = getResource(ctx.s, resourceId);
  authorizeUpdate(ctx, workspaceId, r);
  if (!(ctx.s.workspaceResources[workspaceId] ?? []).includes(r.id)) throw rule('VEHICLE_NOT_IN_WORKSPACE', `${r.id} is not a vehicle of this workspace`);
  assertNotLentAway(ctx.s, r.id, workspaceId);
  if (r.type !== 'PHYSICAL') throw rule('SIMULATION_SOFTWARE_FROM_IMAGE', 'a simulation’s software comes from its image; switch its image');
  if (r.env === 'production') throw rule('PRODUCTION_SOFTWARE', 'production vehicles change software only through the vehicle OTA program');
  if (r.status === 'RETIRED') throw rule('VEHICLE_UNAVAILABLE', `${r.id} is retired`);
  const version = input.version.trim();
  if (!ctx.s.softwareVersions[softwareKey(r.vehicleModelId, version)]) throw rule('SOFTWARE_NOT_RECORDED', `${r.vehicleModelId} ${version} is not a recorded software version`);
  if (version === r.integrationVersion) throw rule('SAME_SOFTWARE', `${r.id} already runs ${version}`);
  if (!input.reason.trim()) throw rule('REASON_REQUIRED', 'say why the vehicle needs this version');
  if (pendingSoftwareUpdateOf(ctx.s, r.id)) throw conflict('SOFTWARE_UPDATE_PENDING', `${r.id} is already waiting for a software update`);
  assertIdle(ctx.s, r.id);
  const id = newId('vs');
  ctx.s.vehicleSoftwareRequests[id] = {
    id,
    seq: ctx.seq(),
    resourceId: r.id,
    workspaceId,
    fromVersion: r.integrationVersion,
    toVersion: version,
    reason: input.reason.trim(),
    status: 'PENDING',
    error: null,
    requestedBy: ctx.user().username,
    requestedAt: ctx.now,
    answeredAt: null,
  };
  return id;
}

/** Withdraws an update the vehicle OTA system has not answered. */
export function cancelVehicleSoftware(ctx: Ctx, requestId: string): void {
  const q = getSoftwareRequest(ctx.s, requestId) as Draft<VehicleSoftwareRequest>;
  authorizeUpdate(ctx, q.workspaceId, getResource(ctx.s, q.resourceId));
  if (q.status !== 'PENDING') throw rule('NOT_PENDING', 'the software update is no longer pending');
  q.status = 'CANCELLED';
  q.answeredAt = ctx.now;
}

/**
 * The vehicle OTA system answers (system context). Applied: the vehicle waits to follow its group
 * again, and the platform learns the version from the vehicle's next report.
 */
export function answerVehicleSoftware(ctx: Ctx, requestId: string, result: 'APPLIED' | 'FAILED', error?: string): VehicleSoftwareRequest {
  const q = getSoftwareRequest(ctx.s, requestId) as Draft<VehicleSoftwareRequest>;
  if (q.status !== 'PENDING') throw rule('NOT_PENDING', 'the software update is no longer pending');
  q.status = result;
  q.answeredAt = ctx.now;
  q.error = result === 'FAILED' ? (error ?? 'simulated update failure') : null;
  const g = ctx.s.vehicleGroups[ctx.s.groupMembers[q.resourceId] ?? ''];
  if (result === 'APPLIED' && g && g.purpose !== 'PRODUCTION') ctx.s.groupFollows[q.resourceId] = { vehicleGroupId: g.id, reason: 'SOFTWARE_UPDATED', since: ctx.now };
  return q;
}

/**
 * What the vehicle's group published, checked on `version`, before asking for it (null without a
 * group). It is compared with the base the vehicle runs the publication on, or, for a vehicle that
 * does not run it yet (one that joined the group), with the group's base.
 */
export function previewVehicleSoftware(s: State, resourceId: string, version: string): PublicationCheck | null {
  const r = s.resources[resourceId];
  const g = r ? s.vehicleGroups[s.groupMembers[r.id] ?? ''] : undefined;
  if (!r || !g) return null;
  const p = g.publication;
  const applied = r.appliedConfigId ? s.resolvedConfigs[r.appliedConfigId] : undefined;
  const runsIt = p?.kind === 'FEATURE' && applied?.kind === 'FEATURE' && applied.sourceId === p.featureId && !s.groupFollows[r.id];
  return assessPublicationOn(s, r, g, version, runsIt ? applied.baseReleaseId : groupPublicationBase(s, g));
}

/** Software updates of a vehicle, newest first. */
export function softwareRequestsOf(s: State, resourceId: string): VehicleSoftwareRequest[] {
  return Object.values(s.vehicleSoftwareRequests)
    .filter((q) => q.resourceId === resourceId)
    .sort((a, b) => b.seq - a.seq);
}

/** Updates waiting for the vehicle OTA system (simulator). */
export function pendingSoftwareRequests(s: State): VehicleSoftwareRequest[] {
  return Object.values(s.vehicleSoftwareRequests)
    .filter((q) => q.status === 'PENDING')
    .sort((a, b) => a.seq - b.seq);
}
