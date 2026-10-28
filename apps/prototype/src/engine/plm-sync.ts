// PLM sync (PLM 同步). Published whole-vehicle versions come from PLM, the company's version record;
// the platform never records one by hand. An integration call's target is a working name (工作名)
// until PLM publishes the software: the DCL part delivered for it carries the released set's
// configuration digest, so the version PLM publishes with that part is linked to the working name
// and takes over the sets that apply to it. The bundled set is the version's factory configuration
// (出厂配置); later sets reach its vehicles over the air.

import { newId } from '../domain/ids.ts';
import { openCheckForNewSoftware } from './applicability.ts';
import type { Ctx } from './engine.ts';
import { softwareKey } from './fleet.ts';
import { appliesTo, releasesOf } from './release.ts';
import { noteReportedSoftware } from './software-change.ts';
import type { DclModule, DclPart, PlmCatalog, PlmVersion, Release, SoftwareVersion, State } from './types.ts';

/** The set a DCL part carries: the release whose configuration has the part's digest (a digest names one release). */
export function releaseOfDigest(s: State, vehicleModelId: string, digest: string): Release | null {
  return releasesOf(s, vehicleModelId).find((r) => s.resolvedConfigs[r.resolvedConfigId]?.digest === digest) ?? null;
}

/** The working name a set was released for, while PLM has not published it. */
function unlinkedWorkingName(s: State, release: Release): SoftwareVersion | null {
  const call = Object.values(s.integrationCalls).find((c) => c.releaseId === release.id && c.scope === 'Vehicle');
  const w = call ? s.softwareVersions[softwareKey(call.vehicleModelId, call.targetVersion)] : undefined;
  return w && w.status === 'PLANNED' && !w.linkedTo ? w : null;
}

/** The module a version bundles for a set: as it was exported, or built from the release when it never was. */
function moduleFor(s: State, release: Release, digest: string): DclModule {
  const exported = Object.values(s.softwareVersions).find((v) => v.vehicleModelId === release.vehicleModelId && v.dclModule?.digest === digest)?.dclModule;
  return exported ? { ...exported } : { releaseId: release.id, resolvedConfigId: release.resolvedConfigId, digest, exportedBy: release.publishedBy, exportedAt: release.publishedAt };
}

/** The part as the platform knows it: who delivered it, when it did. */
function partFor(s: State, part: NonNullable<PlmVersion['dclPart']>): DclPart {
  const delivered = Object.values(s.softwareVersions).find((v) => v.dclPart?.digest === part.digest && v.dclPart.deliveredBy)?.dclPart;
  return { ...part, deliveredBy: delivered?.deliveredBy ?? null, deliveredAt: delivered?.deliveredAt ?? null };
}

/**
 * Applies PLM's published versions (system context; it never throws, it runs inside the simulator
 * step). A new version is recorded with the set its DCL part carries as its factory configuration.
 * A part delivered for a working name links the name: the PLM version takes over every set that
 * applies to it. A version no set applies to opens an applicability check, as any new software
 * does. Returns how many versions were recorded.
 */
export function syncPlm(ctx: Ctx, snapshot: PlmCatalog): number {
  let recorded = 0;
  for (const v of snapshot.versions) {
    const key = softwareKey(v.vehicleModelId, v.version);
    const existing = ctx.s.softwareVersions[key];
    if (existing?.status === 'RECORDED' || !ctx.s.vehicleModels[v.vehicleModelId]) continue;
    const release = v.dclPart ? releaseOfDigest(ctx.s, v.vehicleModelId, v.dclPart.digest) : null;
    const module = release ? moduleFor(ctx.s, release, v.dclPart!.digest) : null;
    const part = v.dclPart ? partFor(ctx.s, v.dclPart) : null;
    if (existing) {
      // PLM kept the working name as its number: the same record becomes the published version.
      existing.status = 'RECORDED';
      existing.source = 'PLM';
      existing.recordedBy = null;
      existing.createdAt = ctx.now;
      existing.workingName = existing.callId ? existing.version : null;
      existing.dclModule = module;
      existing.dclPart = part;
    } else {
      const w = release ? unlinkedWorkingName(ctx.s, release) : null;
      ctx.s.softwareVersions[key] = {
        vehicleModelId: v.vehicleModelId,
        version: v.version,
        source: 'PLM',
        manifest: w?.manifest ? { signals: [...w.manifest.signals], sources: w.manifest.sources.map((x) => ({ ...x })) } : null,
        status: 'RECORDED',
        callId: w?.callId ?? null,
        dclModule: module,
        moduleLog: [],
        plannedBy: null,
        plannedAt: null,
        recordedBy: null,
        createdAt: ctx.now,
        dclPart: part,
        workingName: w?.version ?? null,
        linkedTo: null,
      };
      if (w) {
        ctx.s.softwareVersions[softwareKey(w.vehicleModelId, w.version)]!.linkedTo = v.version;
        // The PLM version is the software the working name stood for: the same sets apply to it.
        for (const r of [...releasesOf(ctx.s, v.vehicleModelId)].reverse().filter((x) => appliesTo(ctx.s, x, w.version))) {
          ctx.s.applicability.push({
            id: newId('ap'),
            seq: ctx.seq(),
            releaseId: r.id,
            vehicleModelId: v.vehicleModelId,
            version: v.version,
            action: 'ADD',
            checkId: null,
            reason: `working name ${w.version}`,
            by: null,
            at: ctx.now,
          });
        }
      }
    }
    openCheckForNewSoftware(ctx, v.vehicleModelId, v.version);
    // Vehicles already reporting this version waited for PLM: their latest signed report now counts.
    for (const c of Object.values(ctx.s.softwareChanges).filter((x) => x.status === 'UNRECORDED' && x.toVersion === v.version)) {
      const latest = ctx.s.clientReports[c.resourceId]?.latest?.payload;
      if (ctx.s.resources[c.resourceId]?.vehicleModelId !== v.vehicleModelId || latest?.vehicleIntegrationVersion !== v.version) continue;
      noteReportedSoftware(ctx, c.resourceId, v.version, latest.configuration?.digest ?? null, latest.domains);
    }
    recorded += 1;
  }
  ctx.s.plmSync = { revision: snapshot.revision, syncedAt: ctx.now };
  return recorded;
}

/**
 * Where a working name stands (界面状态): planned, released by its call and waiting for DCL to deliver
 * its part, delivered and waiting for PLM, or linked to the PLM version that published it.
 */
export function workingNameState(sv: SoftwareVersion): 'PLANNED' | 'TO_DELIVER' | 'DELIVERED' | 'LINKED' | null {
  if (sv.status !== 'PLANNED') return null;
  if (sv.linkedTo) return 'LINKED';
  if (sv.dclPart) return 'DELIVERED';
  return sv.dclModule ? 'TO_DELIVER' : 'PLANNED';
}
