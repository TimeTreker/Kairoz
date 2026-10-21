// Vehicles (车辆资源): software versions, simulation images, physical vehicles and simulation
// instances, workspace usage, and persistent vehicle groups. Identity, ownership pool and
// environment belong to the vehicle; which workspace may use it is a separate assignment.

import type { Draft } from 'immer';
import { authorize } from '../domain/authz.ts';
import { conflict, notFound, rule } from '../domain/errors.ts';
import { newId } from '../domain/ids.ts';
import { WILDCARD } from '../domain/vocabulary.ts';
import type { Env, Scope } from '../domain/vocabulary.ts';
import type { Actor, Ctx } from './engine.ts';
import { getWorkspace } from './org.ts';
import type { Resource, State, VehicleGroup, VehicleGroupPurpose } from './types.ts';

const RESOURCE_ID = /^[A-Z][A-Z0-9-]{2,40}$/;
const VIN = /^[A-HJ-NPR-Z0-9]{17}$/;
const VERSION = /^[0-9]+(\.[0-9]+){0,3}$/;

export const softwareKey = (vehicleModelId: string, version: string) => `${vehicleModelId}::${version}`;

export function getResource(s: State, id: string): Resource {
  const r = s.resources[id];
  if (!r) throw notFound('vehicle', id);
  return r;
}

/** A vehicle waits on at most one dispatch at a time. */
export function pendingDeploymentOf(s: State, resourceId: string): string | undefined {
  return Object.values(s.deployments).find((d) => d.status !== 'CANCELLED' && d.targets.some((t) => t.resourceId === resourceId && t.status === 'PENDING'))?.id;
}

/** An unfinished OTA rollout the vehicle is still part of (queued, waiting or failed). */
export function openOtaOf(s: State, resourceId: string, except?: string): string | undefined {
  return Object.values(s.deployments).find(
    (d) =>
      d.kind === 'OTA' &&
      d.id !== except &&
      (d.status === 'PENDING' || d.status === 'PAUSED') &&
      d.targets.some((t) => t.resourceId === resourceId && ['QUEUED', 'PENDING', 'FAILED'].includes(t.status)),
  )?.id;
}

function assertIdle(s: State, resourceId: string): void {
  const pending = pendingDeploymentOf(s, resourceId) ?? openOtaOf(s, resourceId);
  if (pending) throw rule('VEHICLE_BUSY', `vehicle ${resourceId} is waiting for deployment ${pending}`, { deploymentId: pending });
}

// ---------------------------------------------------------------------------
// Catalogs
// ---------------------------------------------------------------------------

export function recordSoftwareVersion(ctx: Ctx, input: { vehicleModelId: string; version: string; source: string }): string {
  ctx.allow('softwareVersion.record', { type: 'softwareVersion', id: input.version, scope: 'Vehicle' });
  if (!ctx.s.vehicleModels[input.vehicleModelId]) throw notFound('vehicle model', input.vehicleModelId);
  if (!VERSION.test(input.version)) throw rule('INVALID_VERSION', 'versions look like 1.0 or 1.2.3');
  if (!input.source.trim()) throw rule('SOURCE_REQUIRED', 'name the trusted source of this version');
  const key = softwareKey(input.vehicleModelId, input.version);
  if (ctx.s.softwareVersions[key]) throw conflict('VERSION_EXISTS', `version ${input.version} is already recorded`);
  ctx.s.softwareVersions[key] = { vehicleModelId: input.vehicleModelId, version: input.version, source: input.source.trim(), recordedBy: ctx.user().username, createdAt: ctx.now };
  return key;
}

export function registerImage(
  ctx: Ctx,
  input: { id: string; vehicleModelId: string; integrationVersion: string | null; build: string; digest: string; simulator: string },
): string {
  ctx.allow('image.register', { type: 'image', id: input.id, workspaceId: WILDCARD, groupId: WILDCARD });
  if (!/^[a-z0-9][a-z0-9._-]{1,80}$/.test(input.id)) throw rule('INVALID_ID', 'image ids are lower-case letters, digits, . _ -');
  if (ctx.s.images[input.id]) throw conflict('ID_TAKEN', `image ${input.id} already exists; images are immutable`);
  if (!ctx.s.vehicleModels[input.vehicleModelId]) throw notFound('vehicle model', input.vehicleModelId);
  if (input.integrationVersion && !ctx.s.softwareVersions[softwareKey(input.vehicleModelId, input.integrationVersion)]) {
    throw rule('UNKNOWN_SOFTWARE_VERSION', `${input.vehicleModelId} ${input.integrationVersion} is not a recorded software version`);
  }
  if (!/^sha256:[0-9a-f]{64}$/.test(input.digest)) throw rule('INVALID_DIGEST', 'the digest must be sha256:<64 hex>');
  ctx.s.images[input.id] = { ...input, createdBy: ctx.user().username, createdAt: ctx.now };
  return input.id;
}

// ---------------------------------------------------------------------------
// Vehicles
// ---------------------------------------------------------------------------

function baseResource(ctx: Ctx, input: { id: string; vehicleModelId: string; env: Env; pool: Scope; displayName?: string }) {
  if (!RESOURCE_ID.test(input.id)) throw rule('INVALID_ID', 'vehicle ids look like VEH-001 or SIM-021');
  if (ctx.s.resources[input.id]) throw conflict('ID_TAKEN', `vehicle ${input.id} already exists`);
  const model = ctx.s.vehicleModels[input.vehicleModelId];
  if (!model) throw notFound('vehicle model', input.vehicleModelId);
  return {
    id: input.id,
    vehicleModelId: model.id,
    env: input.env,
    pool: input.pool,
    displayName: input.displayName?.trim() ?? '',
    status: 'AVAILABLE' as const,
    appliedConfigId: null,
    agent: { online: true, autoAck: false, failNext: false },
    createdBy: ctx.user().username,
    createdAt: ctx.now,
    updatedAt: ctx.now,
  };
}

/** Physical vehicles are registered by vehicle resources; the actual software version starts unknown. */
export function registerPhysical(
  ctx: Ctx,
  input: { id: string; vin: string; licensePlate?: string; vehicleModelId: string; env: Env; pool: Scope; displayName?: string; uvid?: string },
): string {
  ctx.allow('resource.manage', { type: 'resource', id: input.id, scope: input.pool, env: input.env });
  const base = baseResource(ctx, input);
  const vin = input.vin.trim().toUpperCase();
  if (!VIN.test(vin)) throw rule('INVALID_VIN', 'a VIN has 17 characters without I, O or Q');
  if (Object.values(ctx.s.resources).some((r) => r.vin === vin)) throw conflict('VIN_TAKEN', `VIN ${vin} is already registered`);
  if (input.uvid && Object.values(ctx.s.resources).some((r) => r.uvid === input.uvid)) throw conflict('UVID_TAKEN', `UVID ${input.uvid} is already registered`);
  ctx.s.resources[input.id] = {
    ...base,
    type: 'PHYSICAL',
    vin,
    uvid: input.uvid ?? null,
    licensePlate: input.licensePlate?.trim() || null,
    integrationVersion: null,
    integrationSource: null,
    imageId: null,
    homeWorkspaceId: null,
  };
  return input.id;
}

/** A workspace creates its own simulation instances from an image of its vehicle model. */
export function createSimulation(ctx: Ctx, input: { id: string; workspaceId: string; imageId: string; env: Env; pool: Scope; displayName?: string }): string {
  ctx.allow('simulation.manage', { type: 'resource', id: input.id, workspaceId: input.workspaceId, env: input.env });
  const workspace = getWorkspace(ctx.s, input.workspaceId);
  if (input.env === 'production') throw rule('PRODUCTION_SIMULATION', 'simulation instances are for development and testing');
  const image = ctx.s.images[input.imageId];
  if (!image) throw notFound('image', input.imageId);
  if (image.vehicleModelId !== workspace.vehicleModelId) throw rule('IMAGE_MODEL_MISMATCH', `image ${image.id} is for ${image.vehicleModelId}`);
  if (!workspace.scopes.includes(input.pool) && !workspace.scopes.includes('Vehicle')) {
    throw rule('POOL_OUTSIDE_WORKSPACE', `pool ${input.pool} is not in the workspace scopes`);
  }
  const base = baseResource(ctx, { ...input, vehicleModelId: workspace.vehicleModelId });
  ctx.s.resources[input.id] = {
    ...base,
    type: 'SIMULATION',
    vin: null,
    uvid: input.id,
    licensePlate: null,
    // The software of a simulation comes from its image, never from a label.
    integrationVersion: image.integrationVersion,
    integrationSource: `image ${image.id}`,
    imageId: image.id,
    homeWorkspaceId: workspace.id,
  };
  ctx.s.workspaceResources[workspace.id] = [...(ctx.s.workspaceResources[workspace.id] ?? []), input.id];
  return input.id;
}

/** Vehicle resources confirm the actual software of a physical vehicle from a trusted source. */
export function confirmIntegration(ctx: Ctx, resourceId: string, input: { version: string | null; source: string }): void {
  const r = getResource(ctx.s, resourceId) as Draft<Resource>;
  ctx.allow('resource.manage', { type: 'resource', id: r.id, scope: r.pool, env: r.env });
  if (r.type !== 'PHYSICAL') throw rule('SIMULATION_SOFTWARE_FROM_IMAGE', 'a simulation’s software comes from its image');
  if (input.version !== null && !ctx.s.softwareVersions[softwareKey(r.vehicleModelId, input.version)]) {
    throw rule('UNKNOWN_SOFTWARE_VERSION', `${r.vehicleModelId} ${input.version} is not a recorded software version`);
  }
  if (!input.source.trim()) throw rule('SOURCE_REQUIRED', 'name the trusted source (e.g. DIP report, OTA confirmation)');
  r.integrationVersion = input.version;
  r.integrationSource = input.source.trim();
  r.updatedAt = ctx.now;
}

export function setResourceStatus(ctx: Ctx, resourceId: string, input: { status: Resource['status']; reason: string }): void {
  const r = getResource(ctx.s, resourceId) as Draft<Resource>;
  ctx.allow('resource.manage', { type: 'resource', id: r.id, scope: r.pool, env: r.env });
  if (!input.reason.trim()) throw rule('REASON_REQUIRED', 'give a reason');
  if (input.status !== 'AVAILABLE') assertIdle(ctx.s, r.id);
  r.status = input.status;
  r.updatedAt = ctx.now;
}

/** Vehicles that `actor` manages as vehicle resources (by pool scope). */
export function managedResources(s: State, actor: Actor): Resource[] {
  return Object.values(s.resources)
    .filter((r) => authorize(actor.grants, 'resource.manage', { scope: r.pool, env: r.env }).ok)
    .sort((a, b) => a.id.localeCompare(b.id));
}

// ---------------------------------------------------------------------------
// Workspace usage
// ---------------------------------------------------------------------------

export function workspaceVehicles(s: State, workspaceId: string): Resource[] {
  return (s.workspaceResources[workspaceId] ?? []).map((id) => s.resources[id]!).filter(Boolean);
}

/** Vehicles a workspace admin could add: right model, pool within the workspace scopes, not production. */
export function assignableVehicles(s: State, workspaceId: string): Resource[] {
  const ws = s.workspaces[workspaceId];
  if (!ws) return [];
  const assigned = new Set(s.workspaceResources[workspaceId] ?? []);
  return Object.values(s.resources).filter(
    (r) =>
      !assigned.has(r.id) &&
      r.status !== 'RETIRED' &&
      // Production vehicles only serve project workspaces, where production vehicle groups live.
      (r.env !== 'production' || ws.kind === 'PROJECT') &&
      r.vehicleModelId === ws.vehicleModelId &&
      (ws.scopes.includes(r.pool) || ws.scopes.includes('Vehicle')) &&
      (r.type === 'PHYSICAL' || r.homeWorkspaceId === ws.id),
  );
}

export function addWorkspaceVehicle(ctx: Ctx, workspaceId: string, resourceId: string): void {
  const r = getResource(ctx.s, resourceId);
  ctx.allow('workspace.resources', { type: 'workspaceResource', id: resourceId, workspaceId, env: r.env });
  if (!assignableVehicles(ctx.s, workspaceId).some((x) => x.id === resourceId)) {
    throw rule('VEHICLE_NOT_ASSIGNABLE', 'the vehicle does not fit this workspace (model, pool, environment) or is already assigned');
  }
  ctx.s.workspaceResources[workspaceId] = [...(ctx.s.workspaceResources[workspaceId] ?? []), resourceId];
}

export function removeWorkspaceVehicle(ctx: Ctx, workspaceId: string, resourceId: string): void {
  const r = getResource(ctx.s, resourceId);
  ctx.allow('workspace.resources', { type: 'workspaceResource', id: resourceId, workspaceId, env: r.env });
  const groupId = ctx.s.groupMembers[resourceId];
  if (groupId && ctx.s.vehicleGroups[groupId]?.workspaceId === workspaceId) {
    throw rule('VEHICLE_IN_GROUP', 'remove the vehicle from its vehicle group first');
  }
  assertIdle(ctx.s, resourceId);
  ctx.s.workspaceResources[workspaceId] = (ctx.s.workspaceResources[workspaceId] ?? []).filter((id) => id !== resourceId);
}

// ---------------------------------------------------------------------------
// Vehicle groups
// ---------------------------------------------------------------------------

function groupEvent(ctx: Ctx, vehicleGroupId: string, kind: 'CREATED' | 'MEMBER_ADDED' | 'MEMBER_REMOVED' | 'BOUND' | 'ARCHIVED', resourceId: string | null, reason: string | null) {
  ctx.s.vehicleGroupEvents.push({ id: newId('ve'), vehicleGroupId, kind, resourceId, reason, actor: ctx.user().username, createdAt: ctx.now });
}

export function membersOf(s: State, vehicleGroupId: string): string[] {
  return Object.entries(s.groupMembers)
    .filter(([, g]) => g === vehicleGroupId)
    .map(([r]) => r)
    .sort();
}

export function createVehicleGroup(
  ctx: Ctx,
  input: { workspaceId: string; groupId: string | null; name: string; purpose: VehicleGroupPurpose; env: Env },
): string {
  ctx.allow('vehicleGroup.manage', { type: 'vehicleGroup', workspaceId: input.workspaceId, env: input.env });
  const ws = getWorkspace(ctx.s, input.workspaceId);
  if (ws.status !== 'ACTIVE') throw rule('WORKSPACE_ARCHIVED', 'the workspace is archived');
  if ((input.purpose === 'PRODUCTION') !== (input.env === 'production')) {
    throw rule('PURPOSE_ENV_MISMATCH', 'production vehicle groups are exactly the groups in the production environment');
  }
  // Team vehicle groups route one business group's Features; project and integration groups
  // carry complete configurations and serve no single business group.
  const groupId = ws.kind === 'TEAM' ? input.groupId : null;
  if (ws.kind === 'TEAM') {
    if (input.purpose === 'PRODUCTION') throw rule('PRODUCTION_IN_TEAM', 'production vehicle groups belong to project workspaces');
    if (!groupId || !ws.groupIds.includes(groupId)) throw rule('GROUP_NOT_IN_WORKSPACE', 'choose a business group of this workspace');
  }
  if (!input.name.trim()) throw rule('NAME_REQUIRED', 'name the vehicle group');
  if (Object.values(ctx.s.vehicleGroups).some((g) => g.workspaceId === ws.id && g.name === input.name.trim())) {
    throw conflict('NAME_TAKEN', 'the workspace already has a vehicle group with this name');
  }
  const id = newId('vg');
  const group: VehicleGroup = {
    id,
    workspaceId: ws.id,
    groupId,
    name: input.name.trim(),
    purpose: input.purpose,
    env: input.env,
    status: 'ACTIVE',
    targetConfigId: null,
    bindingRevision: 0,
    createdBy: ctx.user().username,
    createdAt: ctx.now,
  };
  ctx.s.vehicleGroups[id] = group;
  groupEvent(ctx, id, 'CREATED', null, null);
  return id;
}

function authorizeGroup(ctx: Ctx, vehicleGroupId: string): Draft<VehicleGroup> {
  const g = ctx.s.vehicleGroups[vehicleGroupId];
  if (!g) throw notFound('vehicle group', vehicleGroupId);
  ctx.allow('vehicleGroup.manage', { type: 'vehicleGroup', id: g.id, workspaceId: g.workspaceId, env: g.env });
  if (g.status !== 'ACTIVE') throw rule('VEHICLE_GROUP_ARCHIVED', 'the vehicle group is archived');
  return g;
}

export function addGroupMember(ctx: Ctx, vehicleGroupId: string, resourceId: string, reason: string): void {
  const g = authorizeGroup(ctx, vehicleGroupId);
  const r = getResource(ctx.s, resourceId);
  if (!reason.trim()) throw rule('REASON_REQUIRED', 'give a reason for the membership change');
  if (!(ctx.s.workspaceResources[g.workspaceId] ?? []).includes(r.id)) throw rule('VEHICLE_NOT_IN_WORKSPACE', 'add the vehicle to the workspace first');
  if (r.env !== g.env) throw rule('ENV_MISMATCH', `vehicle ${r.id} is a ${r.env} vehicle; the group is ${g.env}`);
  if (r.vehicleModelId !== getWorkspace(ctx.s, g.workspaceId).vehicleModelId) throw rule('MODEL_MISMATCH', 'the vehicle is of another model');
  if (r.status !== 'AVAILABLE') throw rule('VEHICLE_UNAVAILABLE', `vehicle ${r.id} is ${r.status.toLowerCase()}`);
  const current = ctx.s.groupMembers[r.id];
  if (current) {
    throw rule('VEHICLE_ALREADY_GROUPED', `vehicle ${r.id} already routes through vehicle group ${ctx.s.vehicleGroups[current]?.name}; remove it there first`);
  }
  assertIdle(ctx.s, r.id);
  ctx.s.groupMembers[r.id] = g.id;
  groupEvent(ctx, g.id, 'MEMBER_ADDED', r.id, reason.trim());
}

/** Removing a member never rolls back its applied configuration. */
export function removeGroupMember(ctx: Ctx, vehicleGroupId: string, resourceId: string, reason: string): void {
  const g = authorizeGroup(ctx, vehicleGroupId);
  if (ctx.s.groupMembers[resourceId] !== g.id) throw notFound('member', resourceId);
  if (!reason.trim()) throw rule('REASON_REQUIRED', 'give a reason for the membership change');
  assertIdle(ctx.s, resourceId);
  delete ctx.s.groupMembers[resourceId];
  groupEvent(ctx, g.id, 'MEMBER_REMOVED', resourceId, reason.trim());
}

export function archiveVehicleGroup(ctx: Ctx, vehicleGroupId: string, reason: string): void {
  const g = authorizeGroup(ctx, vehicleGroupId);
  if (membersOf(ctx.s, g.id).length > 0) throw rule('GROUP_HAS_MEMBERS', 'move all vehicles out first');
  if (!reason.trim()) throw rule('REASON_REQUIRED', 'give a reason');
  g.status = 'ARCHIVED';
  groupEvent(ctx, g.id, 'ARCHIVED', null, reason.trim());
}

export function vehicleGroupsOf(s: State, workspaceId: string): VehicleGroup[] {
  return Object.values(s.vehicleGroups)
    .filter((g) => g.workspaceId === workspaceId)
    .sort((a, b) => (a.status === b.status ? a.name.localeCompare(b.name) : a.status === 'ACTIVE' ? -1 : 1));
}

export function recordGroupBinding(ctx: Ctx, vehicleGroupId: string, configId: string): number {
  const g = ctx.s.vehicleGroups[vehicleGroupId]!;
  g.targetConfigId = configId;
  g.bindingRevision += 1;
  groupEvent(ctx, g.id, 'BOUND', null, ctx.s.resolvedConfigs[configId]?.label ?? configId);
  return g.bindingRevision;
}
