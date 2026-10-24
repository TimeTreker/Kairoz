// Simulation software (仿真车软件): what image a simulation runs. A catalog image can be switched
// in, a module rebuilt from source by the mock CI into a derived image and deployed, and the last
// change rolled back. Only the simulation provider's answer changes the running image; the DCL
// client then starts empty, and test results from the earlier image stop counting.

import type { Draft } from 'immer';
import { conflict, notFound, rule } from '../domain/errors.ts';
import { newId } from '../domain/ids.ts';
import { refIssue, repositoryIssue, resolvedCommit, simModule } from '../domain/sim-software.ts';
import type { Ctx } from './engine.ts';
import { assertIdle, authorizeSimulation, getResource, pendingImageChangeOf } from './fleet.ts';
import type { ImageChange, Resource, SimulationImage, SoftwareBuild, State } from './types.ts';

/** Images a simulation of the model may be created on or switched to: never derived ones. */
export function catalogImages(s: State, vehicleModelId: string): SimulationImage[] {
  return Object.values(s.images)
    .filter((i) => i.vehicleModelId === vehicleModelId && !i.derived)
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function buildsOf(s: State, resourceId: string): SoftwareBuild[] {
  return Object.values(s.softwareBuilds)
    .filter((b) => b.resourceId === resourceId)
    .sort((a, b) => b.seq - a.seq);
}

export function imageChangesOf(s: State, resourceId: string): ImageChange[] {
  return Object.values(s.imageChanges)
    .filter((c) => c.resourceId === resourceId)
    .sort((a, b) => b.seq - a.seq);
}

/** The change a rollback would undo: the latest applied change, unless it was itself a rollback. */
export function rollbackTarget(s: State, resourceId: string): ImageChange | null {
  const last = imageChangesOf(s, resourceId).find((c) => c.status === 'APPLIED');
  const r = s.resources[resourceId];
  if (!last || !r || last.kind === 'ROLLBACK' || !last.fromImageId || r.imageId !== last.toImageId) return null;
  return last;
}

function simulation(ctx: Ctx, resourceId: string): Draft<Resource> {
  const r = authorizeSimulation(ctx, resourceId);
  if (r.status === 'RETIRED') throw rule('VEHICLE_UNAVAILABLE', `${r.id} is retired`);
  return r;
}

function getBuild(s: State, resourceId: string, buildId: string): Draft<SoftwareBuild> {
  const b = s.softwareBuilds[buildId];
  if (!b || b.resourceId !== resourceId) throw notFound('build', buildId);
  return b as Draft<SoftwareBuild>;
}

/** A build that is requested, or built and not deployed yet. */
function isOpen(s: State, b: SoftwareBuild): boolean {
  if (b.status === 'REQUESTED') return true;
  if (b.status !== 'BUILT') return false;
  return !Object.values(s.imageChanges).some((c) => c.buildId === b.id && (c.status === 'APPLIED' || c.status === 'PENDING'));
}

export function openBuildOf(s: State, resourceId: string): SoftwareBuild | undefined {
  return buildsOf(s, resourceId).find((b) => isOpen(s, b));
}

/**
 * Asks the mock CI to rebuild one module of the simulation's current image from a GitHub
 * repository and ref. Derived images are for development simulations only.
 */
export function requestBuild(ctx: Ctx, resourceId: string, input: { module: string; repository: string; ref: string }): string {
  const r = simulation(ctx, resourceId);
  if (r.env !== 'development') throw rule('DERIVED_DEVELOPMENT_ONLY', 'derived images run on development simulations only; integration tests use catalog images');
  const module = simModule(input.module);
  if (!module) throw rule('UNKNOWN_MODULE', `module ${input.module} is not connected to the build provider`);
  const repoIssue = repositoryIssue(input.repository);
  if (repoIssue) throw rule('INVALID_REPOSITORY', repoIssue);
  const refProblem = refIssue(input.ref);
  if (refProblem) throw rule('INVALID_REF', refProblem);
  if (!r.imageId) throw rule('NO_IMAGE', `${r.id} runs no image to build on`);
  if (openBuildOf(ctx.s, r.id)) throw conflict('BUILD_OPEN', `${r.id} already has an open build; deploy or cancel it first`);
  const id = newId('bd');
  ctx.s.softwareBuilds[id] = {
    id,
    seq: ctx.seq(),
    resourceId: r.id,
    module: module.id,
    recipe: module.recipe,
    repository: input.repository.trim(),
    requestedRef: input.ref.trim(),
    baseImageId: r.imageId,
    status: 'REQUESTED',
    resolvedCommit: null,
    imageId: null,
    log: null,
    requestedBy: ctx.user().username,
    requestedAt: ctx.now,
    builtAt: null,
  };
  return id;
}

/** Withdraws a build that was not deployed. */
export function cancelBuild(ctx: Ctx, resourceId: string, buildId: string): void {
  simulation(ctx, resourceId);
  const b = getBuild(ctx.s, resourceId, buildId);
  if (!isOpen(ctx.s, b)) throw rule('BUILD_CLOSED', 'only a requested or built, undeployed build can be cancelled');
  b.status = 'CANCELLED';
}

/**
 * The mock CI answers a build (system context). Success registers a derived image of the base
 * with the module replaced; the simulation keeps running what it ran.
 */
export function completeBuild(ctx: Ctx, buildId: string, result: 'PASS' | 'FAIL'): string | null {
  const b = ctx.s.softwareBuilds[buildId];
  if (!b) throw notFound('build', buildId);
  if (b.status !== 'REQUESTED') throw rule('BUILD_CLOSED', `build ${b.id} is not waiting for the build provider`);
  b.builtAt = ctx.now;
  if (result === 'FAIL') {
    b.status = 'BUILD_FAILED';
    b.log = 'Mock: module build failed; the running image is unchanged';
    return null;
  }
  const base = ctx.s.images[b.baseImageId]!;
  const commit = resolvedCommit(b.requestedRef, b.id);
  let n = 1;
  while (ctx.s.images[`dev-${base.id}-${b.module}-${n}`]) n += 1;
  const imageId = `dev-${base.id}-${b.module}-${n}`;
  ctx.s.images[imageId] = {
    id: imageId,
    vehicleModelId: base.vehicleModelId,
    // A derived image keeps its base's software version as its source version.
    integrationVersion: base.integrationVersion,
    build: `${base.build}+${b.module}.${n}`,
    digest: `sha256:mock-${b.id.slice(-20).toLowerCase()}`,
    simulator: base.simulator,
    derived: {
      fromImageId: base.id,
      buildId: b.id,
      resourceId: b.resourceId,
      modules: { ...(base.derived?.modules ?? {}), [b.module]: { repository: b.repository, commit, buildId: b.id } },
    },
    createdBy: b.requestedBy,
    createdAt: ctx.now,
  };
  b.status = 'BUILT';
  b.resolvedCommit = commit;
  b.imageId = imageId;
  b.log = `Mock: resolved ${b.requestedRef} → ${commit}; built ${b.module} with ${b.recipe}; composed ${imageId}`;
  return imageId;
}

/** The instance must be stopped and idle before its image may change. */
function assertChangeable(s: State, r: Resource): void {
  if (r.instance === 'RUNNING') throw rule('SIMULATION_RUNNING', `${r.id} is running; stop the instance first`);
  if (r.reservation) throw rule('VEHICLE_RESERVED', `${r.id} is reserved by ${r.reservation.by} for ${r.reservation.purpose}; release it first`);
  assertIdle(s, r.id);
}

function requestChange(ctx: Ctx, r: Resource, input: Pick<ImageChange, 'kind' | 'toImageId' | 'buildId' | 'rollbackOf'>): string {
  const id = newId('ic');
  ctx.s.imageChanges[id] = {
    id,
    seq: ctx.seq(),
    resourceId: r.id,
    fromImageId: r.imageId,
    ...input,
    status: 'PENDING',
    error: null,
    requestedBy: ctx.user().username,
    requestedAt: ctx.now,
    answeredAt: null,
  };
  return id;
}

/** Asks the simulation provider to run a built image instead of the one it was built on. */
export function deployBuild(ctx: Ctx, resourceId: string, buildId: string): string {
  const r = simulation(ctx, resourceId);
  const b = getBuild(ctx.s, resourceId, buildId);
  if (b.status !== 'BUILT' || !b.imageId || !isOpen(ctx.s, b)) throw rule('BUILD_NOT_DEPLOYABLE', `build ${b.id} has no undeployed image`);
  if (r.imageId !== b.baseImageId) throw rule('STALE_BUILD', `${r.id} no longer runs ${b.baseImageId}, the image this build started from; build again`);
  assertChangeable(ctx.s, r);
  return requestChange(ctx, r, { kind: 'DEPLOY', toImageId: b.imageId, buildId: b.id, rollbackOf: null });
}

/** Asks the simulation provider to run a catalog image of the same model. */
export function switchImage(ctx: Ctx, resourceId: string, imageId: string): string {
  const r = simulation(ctx, resourceId);
  const image = ctx.s.images[imageId];
  if (!image) throw notFound('image', imageId);
  if (image.derived) throw rule('IMAGE_NOT_IN_CATALOG', `${image.id} is a derived image of one simulation; choose a catalog image`);
  if (image.vehicleModelId !== r.vehicleModelId) throw rule('IMAGE_MODEL_MISMATCH', `image ${image.id} is for ${image.vehicleModelId}`);
  if (image.id === r.imageId) throw rule('SAME_IMAGE', `${r.id} already runs ${image.id}`);
  assertChangeable(ctx.s, r);
  return requestChange(ctx, r, { kind: 'SWITCH', toImageId: image.id, buildId: null, rollbackOf: null });
}

/** Asks the simulation provider to return to the image before the latest change. */
export function rollbackImage(ctx: Ctx, resourceId: string): string {
  const r = simulation(ctx, resourceId);
  const target = rollbackTarget(ctx.s, r.id);
  if (!target) throw rule('NOTHING_TO_ROLL_BACK', `${r.id} has no image change to roll back`);
  assertChangeable(ctx.s, r);
  return requestChange(ctx, r, { kind: 'ROLLBACK', toImageId: target.fromImageId!, buildId: null, rollbackOf: target.id });
}

/** Withdraws an image change the provider has not answered. */
export function cancelImageChange(ctx: Ctx, resourceId: string): void {
  simulation(ctx, resourceId);
  const id = pendingImageChangeOf(ctx.s, resourceId);
  if (!id) throw rule('NOT_PENDING', `${resourceId} is not waiting for an image change`);
  const c = ctx.s.imageChanges[id]!;
  c.status = 'CANCELLED';
  c.answeredAt = ctx.now;
}

/**
 * The simulation provider answers an image change (system context): deployed and healthy, or
 * failed. A new image runs a fresh DCL client, so the applied configuration is cleared; a
 * failure keeps the image and configuration the simulation had.
 */
export function answerImageChange(ctx: Ctx, changeId: string, result: 'APPLIED' | 'FAILED', error?: string): void {
  const c = ctx.s.imageChanges[changeId];
  if (!c) throw notFound('image change', changeId);
  if (c.status !== 'PENDING') throw rule('NOT_PENDING', 'the image change is no longer pending');
  const r = getResource(ctx.s, c.resourceId) as Draft<Resource>;
  c.answeredAt = ctx.now;
  if (result === 'FAILED') {
    c.status = 'FAILED';
    c.error = error ?? 'simulated health check failure';
    return;
  }
  const image = ctx.s.images[c.toImageId]!;
  c.status = 'APPLIED';
  r.imageId = image.id;
  r.integrationVersion = image.integrationVersion;
  r.integrationSource = `image ${image.id}`;
  r.softwareStatus = image.integrationVersion ? 'CONSISTENT' : 'UNKNOWN';
  r.appliedConfigId = null;
  r.updatedAt = ctx.now;
}
