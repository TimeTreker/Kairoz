// Vehicles (车辆资源): software versions, simulation images, physical vehicles and simulation
// instances, workspace usage, and persistent vehicle groups. Identity, ownership pool and
// environment belong to the vehicle; which workspace may use it is a separate assignment.

import type { Draft } from 'immer';
import { authorize } from '../domain/authz.ts';
import { normalizeManifest } from '../domain/compatibility.ts';
import { conflict, notFound, rule } from '../domain/errors.ts';
import { newId } from '../domain/ids.ts';
import { WILDCARD } from '../domain/vocabulary.ts';
import type { Env, Scope } from '../domain/vocabulary.ts';
import { openCheckForNewSoftware } from './applicability.ts';
import type { Actor, Ctx } from './engine.ts';
import { getWorkspace } from './org.ts';
import { displayName } from './config.ts';
import type { ControllerState, GroupPublication, Resource, State, VehicleGroup, VehicleGroupEvent, VehicleGroupPurpose } from './types.ts';

const RESOURCE_ID = /^[A-Z][A-Z0-9-]{2,40}$/;
const VIN = /^[A-HJ-NPR-Z0-9]{17}$/;
const VERSION = /^[0-9]+(\.[0-9]+){0,3}$/;

type ManifestInput = { signals: string[]; sources: { unit: string; directory: string }[] };

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

/** Personal simulations never join workspace vehicles, vehicle groups or resource operations. */
function assertShared(r: Resource): void {
  if (r.personal) throw rule('PERSONAL_SIMULATION', `${r.id} is a personal simulation of ${r.personal.owner}; it never serves a team`);
}

/** Moving a vehicle out needs it idle, its simulation instance stopped and no reservation. */
function assertRemovable(s: State, resourceId: string): void {
  assertIdle(s, resourceId);
  const r = s.resources[resourceId]!;
  if (r.instance === 'RUNNING') throw rule('SIMULATION_RUNNING', `${r.id} is running; stop the instance first`);
  if (r.reservation) throw rule('VEHICLE_RESERVED', `${r.id} is reserved by ${r.reservation.by} for ${r.reservation.purpose}; release it first`);
}

// ---------------------------------------------------------------------------
// Catalogs
// ---------------------------------------------------------------------------

/**
 * Records a whole-vehicle software version from a trusted source, with what it provides when known.
 * A version no policy set applies to opens an applicability check as a to-do for configuration release.
 */
export function recordSoftwareVersion(ctx: Ctx, input: { vehicleModelId: string; version: string; source: string; manifest?: ManifestInput | null }): string {
  ctx.allow('softwareVersion.record', { type: 'softwareVersion', id: input.version, scope: 'Vehicle' });
  if (!ctx.s.vehicleModels[input.vehicleModelId]) throw notFound('vehicle model', input.vehicleModelId);
  if (!VERSION.test(input.version)) throw rule('INVALID_VERSION', 'versions look like 1.0 or 1.2.3');
  if (!input.source.trim()) throw rule('SOURCE_REQUIRED', 'name the trusted source of this version');
  const key = softwareKey(input.vehicleModelId, input.version);
  if (ctx.s.softwareVersions[key]) throw conflict('VERSION_EXISTS', `version ${input.version} is already recorded`);
  const manifest = input.manifest ? normalizeManifest(input.manifest) : null;
  ctx.s.softwareVersions[key] = { vehicleModelId: input.vehicleModelId, version: input.version, source: input.source.trim(), manifest, recordedBy: ctx.user().username, createdAt: ctx.now };
  openCheckForNewSoftware(ctx, input.vehicleModelId, input.version);
  return key;
}

/** Adds the manifest of a version recorded without one. A recorded manifest is never replaced. */
export function setSoftwareManifest(ctx: Ctx, input: { vehicleModelId: string; version: string; manifest: ManifestInput }): void {
  ctx.allow('softwareVersion.record', { type: 'softwareVersion', id: input.version, scope: 'Vehicle' });
  const v = ctx.s.softwareVersions[softwareKey(input.vehicleModelId, input.version)];
  if (!v) throw notFound('software version', input.version);
  if (v.manifest) throw conflict('MANIFEST_RECORDED', `software ${input.version} already has a manifest`);
  v.manifest = normalizeManifest(input.manifest);
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
  // Demo images may carry an explicitly labelled mock digest instead of a real one.
  if (!/^sha256:([0-9a-f]{64}|mock-[a-z0-9-]{1,60})$/.test(input.digest)) throw rule('INVALID_DIGEST', 'the digest must be sha256:<64 hex> or a labelled sha256:mock-…');
  ctx.s.images[input.id] = { ...input, createdBy: ctx.user().username, createdAt: ctx.now };
  return input.id;
}

// ---------------------------------------------------------------------------
// Vehicles
// ---------------------------------------------------------------------------

export function baseResource(ctx: Ctx, input: { id: string; vehicleModelId: string; env: Env; pool: Scope; displayName?: string }) {
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
    softwareStatus: 'UNKNOWN' as const,
    controllers: [],
    reservation: null,
    appliedConfigId: null,
    personal: null,
    agent: { online: true, autoAck: false, failNext: false },
    deviceKey: null,
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
    instance: null,
    imageId: null,
    homeWorkspaceId: null,
  };
  return input.id;
}

/** A workspace creates its own simulation instances from an image of its vehicle model. */
export function createSimulation(ctx: Ctx, input: { id: string; workspaceId: string; imageId: string; env: Env; pool: Scope; displayName?: string }): string {
  ctx.allow('simulation.manage', { type: 'resource', id: input.id, workspaceId: input.workspaceId, scope: input.pool, env: input.env });
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
    softwareStatus: image.integrationVersion ? ('CONSISTENT' as const) : ('UNKNOWN' as const),
    instance: 'RUNNING' as const,
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
  r.softwareStatus = input.version ? 'CONSISTENT' : 'UNKNOWN';
  r.controllers = [];
  r.updatedAt = ctx.now;
}

/**
 * A trusted per-controller report (vehicle, DIP or software OTA). Only when every controller runs
 * the target does the vehicle get that whole-vehicle version; a partial failure claims none.
 */
export function reportControllers(ctx: Ctx, resourceId: string, input: { target: string; source: string; controllers: ControllerState[] }): void {
  const r = getResource(ctx.s, resourceId) as Draft<Resource>;
  ctx.allow('resource.manage', { type: 'resource', id: r.id, scope: r.pool, env: r.env });
  if (r.type !== 'PHYSICAL') throw rule('SIMULATION_SOFTWARE_FROM_IMAGE', 'a simulation’s software comes from its image');
  if (!ctx.s.softwareVersions[softwareKey(r.vehicleModelId, input.target)]) {
    throw rule('UNKNOWN_SOFTWARE_VERSION', `${r.vehicleModelId} ${input.target} is not a recorded software version`);
  }
  if (!input.source.trim()) throw rule('SOURCE_REQUIRED', 'name the trusted source (e.g. DIP report, OTA confirmation)');
  if (input.controllers.length === 0 || input.controllers.some((c) => !c.name.trim() || !c.version.trim())) {
    throw rule('CONTROLLERS_REQUIRED', 'report every domain controller with its version and result');
  }
  const consistent = input.controllers.every((c) => c.status === 'PASS' && c.version === input.target);
  r.controllers = input.controllers.map((c) => ({ name: c.name.trim(), version: c.version.trim(), status: c.status }));
  r.softwareStatus = consistent ? 'CONSISTENT' : 'PARTIAL_FAILURE';
  // Never write the expected version as the actual one.
  r.integrationVersion = consistent ? input.target : null;
  r.integrationSource = input.source.trim();
  r.updatedAt = ctx.now;
}

/** Only the owner acts on a personal simulation, and only within a grant for its workspace and group. */
export function authorizePersonal(ctx: Ctx, r: Resource): void {
  ctx.allow('personalSim.use', { type: 'personalSim', id: r.id, workspaceId: r.homeWorkspaceId ?? undefined, groupId: r.personal!.groupId, scope: r.pool, env: 'development' });
  if (r.personal!.owner !== ctx.user().username) throw rule('PERSONAL_SIM_OWNER', `${r.id} is a personal simulation of ${r.personal!.owner}; only its owner uses it`);
}

/** Team simulations are run by the workspace or vehicle resources; a personal one by its owner. */
function getSimulation(ctx: Ctx, resourceId: string): Draft<Resource> {
  const r = getResource(ctx.s, resourceId) as Draft<Resource>;
  if (r.type !== 'SIMULATION') throw rule('NOT_A_SIMULATION', `${r.id} is not a simulation instance`);
  if (r.personal) authorizePersonal(ctx, r);
  else ctx.allow('simulation.manage', { type: 'resource', id: r.id, workspaceId: r.homeWorkspaceId ?? undefined, scope: r.pool, env: r.env });
  return r;
}

export function startSimulation(ctx: Ctx, resourceId: string): void {
  const r = getSimulation(ctx, resourceId);
  if (r.status === 'RETIRED') throw rule('VEHICLE_UNAVAILABLE', `${r.id} is retired`);
  if (r.instance === 'RUNNING') throw rule('ALREADY_RUNNING', `${r.id} is already running`);
  r.instance = 'RUNNING';
  r.updatedAt = ctx.now;
}

/** Stops an idle simulation instance; one waiting for a configuration must answer first. */
export function stopSimulation(ctx: Ctx, resourceId: string): void {
  const r = getSimulation(ctx, resourceId);
  if (r.instance === 'STOPPED') throw rule('ALREADY_STOPPED', `${r.id} is already stopped`);
  assertIdle(ctx.s, r.id);
  r.instance = 'STOPPED';
  r.updatedAt = ctx.now;
}

/** The workspace holds a vehicle for a task (预约) until it releases it. */
export function reserveVehicle(ctx: Ctx, workspaceId: string, resourceId: string, purpose: string): void {
  const r = getResource(ctx.s, resourceId) as Draft<Resource>;
  ctx.allow('workspace.resources', { type: 'reservation', id: r.id, workspaceId, scope: r.pool, env: r.env });
  if (!(ctx.s.workspaceResources[workspaceId] ?? []).includes(r.id)) throw rule('VEHICLE_NOT_IN_WORKSPACE', 'add the vehicle to the workspace first');
  if (r.reservation) throw conflict('VEHICLE_RESERVED', `${r.id} is reserved by ${r.reservation.by} for ${r.reservation.purpose}`);
  if (!purpose.trim()) throw rule('PURPOSE_REQUIRED', 'say what the reservation is for');
  r.reservation = { by: ctx.user().username, purpose: purpose.trim(), at: ctx.now };
}

export function releaseReservation(ctx: Ctx, workspaceId: string, resourceId: string): void {
  const r = getResource(ctx.s, resourceId) as Draft<Resource>;
  ctx.allow('workspace.resources', { type: 'reservation', id: r.id, workspaceId, scope: r.pool, env: r.env });
  if (!r.reservation) throw rule('NOT_RESERVED', `${r.id} is not reserved`);
  r.reservation = null;
}

export function setResourceStatus(ctx: Ctx, resourceId: string, input: { status: Resource['status']; reason: string }): void {
  const r = getResource(ctx.s, resourceId) as Draft<Resource>;
  ctx.allow('resource.manage', { type: 'resource', id: r.id, scope: r.pool, env: r.env });
  assertShared(r);
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
      !r.personal &&
      r.status !== 'RETIRED' &&
      // Production vehicles serve project and integration workspaces, never team workspaces.
      (r.env !== 'production' || ws.kind !== 'TEAM') &&
      r.vehicleModelId === ws.vehicleModelId &&
      (ws.scopes.includes(r.pool) || ws.scopes.includes('Vehicle')) &&
      (r.type === 'PHYSICAL' || r.homeWorkspaceId === ws.id),
  );
}

export function addWorkspaceVehicle(ctx: Ctx, workspaceId: string, resourceId: string): void {
  const r = getResource(ctx.s, resourceId);
  ctx.allow('workspace.resources', { type: 'workspaceResource', id: resourceId, workspaceId, scope: r.pool, env: r.env });
  assertShared(r);
  if (!assignableVehicles(ctx.s, workspaceId).some((x) => x.id === resourceId)) {
    throw rule('VEHICLE_NOT_ASSIGNABLE', 'the vehicle does not fit this workspace (model, pool, environment) or is already assigned');
  }
  ctx.s.workspaceResources[workspaceId] = [...(ctx.s.workspaceResources[workspaceId] ?? []), resourceId];
}

export function removeWorkspaceVehicle(ctx: Ctx, workspaceId: string, resourceId: string): void {
  const r = getResource(ctx.s, resourceId);
  ctx.allow('workspace.resources', { type: 'workspaceResource', id: resourceId, workspaceId, scope: r.pool, env: r.env });
  const groupId = ctx.s.groupMembers[resourceId];
  if (groupId && ctx.s.vehicleGroups[groupId]?.workspaceId === workspaceId) {
    throw rule('VEHICLE_IN_GROUP', 'remove the vehicle from its vehicle group first');
  }
  assertRemovable(ctx.s, resourceId);
  ctx.s.workspaceResources[workspaceId] = (ctx.s.workspaceResources[workspaceId] ?? []).filter((id) => id !== resourceId);
}

// ---------------------------------------------------------------------------
// Vehicle groups
// ---------------------------------------------------------------------------

function groupEvent(ctx: Ctx, vehicleGroupId: string, kind: VehicleGroupEvent['kind'], resourceId: string | null, reason: string | null) {
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
  input: { workspaceId: string; groupId: string | null; name: string; purpose: VehicleGroupPurpose; env: Env; requiresApproval?: boolean },
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
    publication: null,
    baseReleaseId: null,
    bindingRevision: 0,
    requiresApproval: input.requiresApproval ?? false,
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
  assertShared(r);
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
  assertRemovable(ctx.s, resourceId);
  delete ctx.s.groupMembers[resourceId];
  groupEvent(ctx, g.id, 'MEMBER_REMOVED', resourceId, reason.trim());
}

/** Whether dispatches to the group need an approved team test request. */
export function setGroupApproval(ctx: Ctx, vehicleGroupId: string, requiresApproval: boolean): void {
  const g = authorizeGroup(ctx, vehicleGroupId);
  g.requiresApproval = requiresApproval;
  groupEvent(ctx, g.id, requiresApproval ? 'APPROVAL_REQUIRED' : 'APPROVAL_NOT_REQUIRED', null, null);
}

/**
 * An explicit base (显式基线) for a development or testing group: its vehicles build on this set
 * instead of the set in effect for their software, e.g. to try software no set applies to yet.
 * Null returns to following each vehicle's software. Nothing is sent until the next publish.
 */
export function setGroupBase(ctx: Ctx, vehicleGroupId: string, releaseId: string | null): void {
  const g = authorizeGroup(ctx, vehicleGroupId);
  if (g.purpose === 'PRODUCTION') throw rule('PRODUCTION_GROUP_BASE', 'production vehicles always take the set in effect for their software');
  if (releaseId !== null) {
    const release = ctx.s.releases[releaseId];
    if (!release) throw notFound('policy set', releaseId);
    if (release.vehicleModelId !== getWorkspace(ctx.s, g.workspaceId).vehicleModelId) throw rule('MODEL_MISMATCH', 'the policy set is for another vehicle model');
  }
  g.baseReleaseId = releaseId;
  groupEvent(ctx, g.id, 'BASE_SET', null, releaseId ? ctx.s.releases[releaseId]!.dclVersion : null);
}

export function archiveVehicleGroup(ctx: Ctx, vehicleGroupId: string, reason: string): void {
  const g = authorizeGroup(ctx, vehicleGroupId);
  if (membersOf(ctx.s, g.id).length > 0) throw rule('GROUP_HAS_MEMBERS', 'move all vehicles out first');
  if (!reason.trim()) throw rule('REASON_REQUIRED', 'give a reason');
  g.status = 'ARCHIVED';
  groupEvent(ctx, g.id, 'ARCHIVED', null, reason.trim());
}

/**
 * Vehicles chosen one by one. Only vehicles that route through no vehicle group may be chosen
 * directly; a grouped vehicle is reached through its group, never around it.
 */
export function directTargetProblems(s: State, workspaceId: string, resourceIds: string[]): string[] {
  const problems: string[] = [];
  for (const rid of resourceIds) {
    if (!s.resources[rid]) problems.push(`${rid}: vehicle does not exist`);
    else if (s.resources[rid]!.personal) problems.push(`${rid}: personal simulation of ${s.resources[rid]!.personal!.owner}; only its owner uses it`);
    else if (!(s.workspaceResources[workspaceId] ?? []).includes(rid)) problems.push(`${rid}: not a vehicle of this workspace`);
    else if (s.groupMembers[rid]) problems.push(`${rid}: routes through vehicle group ${s.vehicleGroups[s.groupMembers[rid]!]?.name}; dispatch to the group`);
  }
  return problems;
}

/** Vehicles of a workspace that route through no vehicle group. */
export function ungroupedVehicles(s: State, workspaceId: string): Resource[] {
  return workspaceVehicles(s, workspaceId).filter((r) => !s.groupMembers[r.id]);
}

export function vehicleGroupsOf(s: State, workspaceId: string): VehicleGroup[] {
  return Object.values(s.vehicleGroups)
    .filter((g) => g.workspaceId === workspaceId)
    .sort((a, b) => (a.status === b.status ? a.name.localeCompare(b.name) : a.status === 'ACTIVE' ? -1 : 1));
}

/** Records what was published to a vehicle group; the event names it. */
export function recordGroupBinding(ctx: Ctx, vehicleGroupId: string, publication: GroupPublication): number {
  const g = ctx.s.vehicleGroups[vehicleGroupId]!;
  g.publication = publication;
  g.bindingRevision += 1;
  groupEvent(ctx, g.id, 'BOUND', null, publicationLabel(ctx.s, publication));
  return g.bindingRevision;
}

/** A short name for what was published: the commit's name, or the configuration's label. */
export function publicationLabel(s: State, p: GroupPublication): string {
  if (p.kind === 'FEATURE') return s.commits[p.commitId] ? displayName(s, p.commitId) : p.commitId;
  return s.resolvedConfigs[p.configId]?.label ?? p.configId;
}
