// The simulated PLM (prototype only): the company's record of published whole-vehicle integration
// versions. PLM maps every module's version to one version number once integration starts, the DCL
// part included. It runs in the system context and owns its own data; the platform learns about a
// published version only by syncing (`syncPlm`).

import { conflict, notFound, rule } from '../domain/errors.ts';
import type { Ctx } from './engine.ts';
import { syncPlm } from './plm-sync.ts';
import type { PlmCatalog, PlmVersion } from './types.ts';

const VERSION = /^[0-9]+(\.[0-9]+){0,3}$/;
const CLIENT_VERSION = /^[0-9]+(\.[0-9]+){1,3}$/;
const DIGEST = /^sha256:[0-9a-f]{8,64}$/;

/** The newest version PLM published for a model, the usual start of the next BOM. */
export function latestPlmVersion(plm: PlmCatalog, vehicleModelId: string): PlmVersion | null {
  return plm.versions.filter((v) => v.vehicleModelId === vehicleModelId).at(-1) ?? null;
}

/**
 * PLM publishes a whole-vehicle version: its BOM maps each module's version (the previous version's
 * modules when none are given), with the DCL part DCL handed over when it carries one.
 */
export function publishPlmVersion(ctx: Ctx, input: { vehicleModelId: string; version: string; modules?: PlmVersion['modules']; dclPart: PlmVersion['dclPart'] }): string {
  const version = input.version.trim();
  if (!ctx.s.vehicleModels[input.vehicleModelId]) throw notFound('vehicle model', input.vehicleModelId);
  if (!VERSION.test(version)) throw rule('INVALID_VERSION', 'versions look like 1.2 or 1.2.0');
  if (ctx.s.plm.versions.some((v) => v.vehicleModelId === input.vehicleModelId && v.version === version)) {
    throw conflict('PLM_VERSION_EXISTS', `PLM already published ${input.vehicleModelId} ${version}`);
  }
  const part = input.dclPart;
  if (part && (!CLIENT_VERSION.test(part.clientVersion) || !VERSION.test(part.setVersion) || !DIGEST.test(part.digest))) {
    throw rule('INVALID_DCL_PART', 'a DCL part names its client version, policy set version and configuration digest');
  }
  const modules = (input.modules ?? latestPlmVersion(ctx.s.plm, input.vehicleModelId)?.modules ?? []).map((m) => ({ name: m.name.trim(), version: m.version.trim() }));
  if (modules.some((m) => !m.name || !m.version) || new Set(modules.map((m) => m.name)).size !== modules.length) {
    throw rule('INVALID_BOM', 'each module of the BOM has a name and a version, once');
  }
  ctx.s.plm.versions.push({ vehicleModelId: input.vehicleModelId, version, modules, dclPart: part ? { ...part } : null, publishedAt: ctx.now });
  ctx.s.plm.revision += 1;
  return version;
}

/** Sends PLM's published versions to the platform when they changed since the last sync. */
export function syncPlmIfChanged(ctx: Ctx): number {
  // A version held back by another name's part is tried again until people settle it (one whose
  // number is a working name PLM already published elsewhere never settles).
  if (ctx.s.plm.revision === ctx.s.plmSync.revision && !ctx.s.plmSync.conflicts?.some((c) => c.kind === 'OTHER_NAME')) return 0;
  return syncPlm(ctx, JSON.parse(JSON.stringify(ctx.s.plm)) as PlmCatalog);
}
