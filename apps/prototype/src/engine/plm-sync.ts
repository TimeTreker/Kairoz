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
import { appliesTo, releasesOf, setInEffect } from './release.ts';
import { noteReportedSoftware } from './software-change.ts';
import type { DclModule, DclPart, PlmCatalog, PlmConflict, PlmVersion, Release, SoftwareVersion, State } from './types.ts';

/** The set a DCL part carries: the release whose configuration has the part's digest (a digest names one release). */
export function releaseOfDigest(s: State, vehicleModelId: string, digest: string): Release | null {
  return releasesOf(s, vehicleModelId).find((r) => s.resolvedConfigs[r.resolvedConfigId]?.digest === digest) ?? null;
}

/**
 * The working name a part belongs to, while PLM has not published it: the one the part was delivered
 * for, or else the one whose call released the part's set.
 */
function unlinkedWorkingName(s: State, release: Release, digest: string): SoftwareVersion | null {
  const open = (w: SoftwareVersion | undefined) => (w && w.status === 'PLANNED' && !w.linkedTo ? w : null);
  const delivered = Object.values(s.softwareVersions).find((v) => v.vehicleModelId === release.vehicleModelId && v.dclPart?.digest === digest && open(v));
  if (delivered) return delivered;
  const call = Object.values(s.integrationCalls).find((c) => c.releaseId === release.id && c.scope === 'Vehicle');
  return open(call ? s.softwareVersions[softwareKey(call.vehicleModelId, call.targetVersion)] : undefined);
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
/** The sets that apply to a working name, applied to the software that stands for it (a PLM version, a test version). */
export function inheritSets(ctx: Ctx, vehicleModelId: string, from: string, to: string, reason: string | ((r: Release) => string), by: string | null): number {
  let added = 0;
  // A set someone withdrew from the target stays withdrawn.
  const withdrawn = (r: Release) => ctx.s.applicability.some((a) => a.releaseId === r.id && a.version === to && a.action === 'WITHDRAW');
  for (const r of [...releasesOf(ctx.s, vehicleModelId)].reverse().filter((x) => appliesTo(ctx.s, x, from) && !appliesTo(ctx.s, x, to) && !withdrawn(x))) {
    ctx.s.applicability.push({ id: newId('ap'), seq: ctx.seq(), releaseId: r.id, vehicleModelId, version: to, action: 'ADD', checkId: null, reason: typeof reason === 'string' ? reason : reason(r), by, at: ctx.now });
    added += 1;
  }
  return added;
}

/** Vehicles already reporting a version PLM just issued or released waited for it: their latest signed report now counts. */
function settleWaiting(ctx: Ctx, v: PlmVersion): void {
  for (const c of Object.values(ctx.s.softwareChanges).filter((x) => x.status === 'UNRECORDED' && x.toVersion === v.version)) {
    const latest = ctx.s.clientReports[c.resourceId]?.latest?.payload;
    if (ctx.s.resources[c.resourceId]?.vehicleModelId !== v.vehicleModelId) continue;
    // The vehicle reported something else since: that report counted, this one no longer waits.
    if (latest?.vehicleIntegrationVersion !== v.version) {
      c.status = 'RESOLVED';
      continue;
    }
    noteReportedSoftware(ctx, c.resourceId, v.version, latest.configuration?.digest ?? null, latest.domains);
  }
}

/**
 * Applies PLM's versions (system context; it never throws, it runs inside the simulator step). A
 * new version is recorded with the set its DCL part carries as its factory configuration. A test
 * version (整车测试版本) is recorded as such until PLM releases it under the same number; one the
 * integration admin linked to a call then links the call's working name. A part delivered for a
 * working name links the name too: the PLM version takes over every set that applies to it. A
 * version no set applies to opens an applicability check, as any new software does. Returns how
 * many versions were recorded or released.
 */
export function syncPlm(ctx: Ctx, snapshot: PlmCatalog): number {
  let recorded = 0;
  // Conflicts are checked afresh every time: one people settled (a call retargeted) lets the version through.
  const before = ctx.s.plmSync.conflicts ?? [];
  const conflicts: PlmConflict[] = [];
  const missingParts = ctx.s.plmSync.missingParts ?? [];
  const missingBefore = missingParts.length;
  const clash = (v: PlmVersion, kind: PlmConflict['kind'], other: string | null) => {
    const at = before.find((c) => c.vehicleModelId === v.vehicleModelId && c.version === v.version)?.at ?? ctx.now;
    conflicts.push({ vehicleModelId: v.vehicleModelId, version: v.version, kind, other, at });
  };
  for (const v of snapshot.versions) {
    const key = softwareKey(v.vehicleModelId, v.version);
    const raw = ctx.s.softwareVersions[key];
    if (raw?.status === 'RECORDED' || !ctx.s.vehicleModels[v.vehicleModelId]) continue;
    // A planned record its call left behind when it moved to another number (a car still runs it)
    // is no working name any more: PLM's version simply takes its place.
    const left = !!raw && raw.status === 'PLANNED' && !raw.linkedTo && !!raw.callId && ctx.s.integrationCalls[raw.callId]?.targetVersion !== raw.version;
    const existing = left ? undefined : raw;
    const release = v.dclPart ? releaseOfDigest(ctx.s, v.vehicleModelId, v.dclPart.digest) : null;
    const module = release ? moduleFor(ctx.s, release, v.dclPart!.digest) : null;
    const part = v.dclPart ? partFor(ctx.s, v.dclPart) : null;
    if ((v.stage ?? 'RELEASED') === 'TEST') {
      if (existing?.status === 'TESTING') continue;
      // A test build whose number is one of our working names: the platform cannot hold both.
      if (existing) {
        clash(v, existing.linkedTo ? 'LINKED' : 'OTHER_NAME', existing.linkedTo ?? null);
        continue;
      }
      ctx.s.softwareVersions[key] = {
        vehicleModelId: v.vehicleModelId,
        version: v.version,
        source: 'PLM',
        manifest: raw?.manifest ? { signals: [...raw.manifest.signals], sources: raw.manifest.sources.map((x) => ({ ...x })) } : null,
        status: 'TESTING',
        callId: null,
        dclModule: module,
        moduleLog: [],
        plannedBy: null,
        plannedAt: null,
        recordedBy: null,
        createdAt: ctx.now,
        dclPart: part,
        workingName: null,
        linkedTo: null,
        testOf: null,
        issuedForTest: true,
        releasedAt: null,
      };
      // Development and testing vehicles that reported the build count now; production ones keep waiting.
      settleWaiting(ctx, v);
      recorded += 1;
      continue;
    }
    if (existing?.status === 'TESTING') {
      // PLM released the passing round under its test number (同号发布).
      existing.status = 'RECORDED';
      existing.releasedAt = ctx.now;
      existing.dclModule = module;
      existing.dclPart = part;
      // The working name it was linked to as a round, while that call still stands for it; else the one
      // its DCL part was delivered for (nobody linked the round).
      const link = existing.testOf;
      const linkCall = link ? ctx.s.integrationCalls[link.callId] : undefined;
      const named = link && (linkCall?.status === 'OPEN' || linkCall?.status === 'RELEASED') ? ctx.s.softwareVersions[softwareKey(v.vehicleModelId, link.workingName)] : undefined;
      const byRound = named && named.status === 'PLANNED' && !named.linkedTo && named.callId === link!.callId ? named : null;
      const w = byRound ?? (release ? unlinkedWorkingName(ctx.s, release, v.dclPart!.digest) : null);
      if (w) {
        w.linkedTo = v.version;
        existing.workingName = w.version;
        existing.callId = w.callId;
        // It references the working name's sets since its round was linked; anything added to the name since comes too.
        inheritSets(ctx, v.vehicleModelId, w.version, v.version, `working name ${w.version}`, null);
      }
      openCheckForNewSoftware(ctx, v.vehicleModelId, v.version);
      settleWaiting(ctx, v);
      recorded += 1;
      continue;
    }
    const owner = release ? unlinkedWorkingName(ctx.s, release, v.dclPart!.digest) : null;
    // PLM's number is one of our working names, but not for that working name's software: a working
    // name PLM already published under another number, or a part delivered for another name. The
    // platform cannot hold both; it records the conflict for people to settle with PLM.
    if (existing && (existing.linkedTo || (release && owner?.version !== existing.version))) {
      clash(v, existing.linkedTo ? 'LINKED' : 'OTHER_NAME', existing.linkedTo ?? owner?.version ?? null);
      continue;
    }
    if (existing) {
      // PLM kept the working name as its number but left out the part DCL delivered for it: the
      // version is recorded without a factory configuration, and the delivery stays on record.
      // (A part the platform recognises, even an older delivery, is the version's factory configuration.)
      const delivered = existing.dclPart?.deliveredBy ? existing.dclPart : null;
      if (delivered && !release) missingParts.push({ vehicleModelId: v.vehicleModelId, version: v.version, part: { ...delivered }, at: ctx.now });
      // PLM kept the working name as its number: the same record becomes the published version.
      existing.status = 'RECORDED';
      existing.source = 'PLM';
      existing.recordedBy = null;
      existing.createdAt = ctx.now;
      existing.releasedAt = ctx.now;
      existing.workingName = existing.callId ? existing.version : null;
      existing.dclModule = module;
      existing.dclPart = part;
    } else {
      const w = owner;
      const manifest = (w ?? raw)?.manifest;
      ctx.s.softwareVersions[key] = {
        vehicleModelId: v.vehicleModelId,
        version: v.version,
        source: 'PLM',
        manifest: manifest ? { signals: [...manifest.signals], sources: manifest.sources.map((x) => ({ ...x })) } : null,
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
        testOf: null,
        issuedForTest: false,
        releasedAt: ctx.now,
      };
      if (w) {
        ctx.s.softwareVersions[softwareKey(w.vehicleModelId, w.version)]!.linkedTo = v.version;
        // The PLM version is the software the working name stood for: the same sets apply to it.
        inheritSets(ctx, v.vehicleModelId, w.version, v.version, `working name ${w.version}`, null);
      }
    }
    openCheckForNewSoftware(ctx, v.vehicleModelId, v.version);
    settleWaiting(ctx, v);
    recorded += 1;
  }
  // A retry that settled nothing changes nothing, so an idle simulator step does not rewrite the state.
  const unchanged = snapshot.revision === ctx.s.plmSync.revision && recorded === 0 && missingParts.length === missingBefore && JSON.stringify(conflicts) === JSON.stringify(before);
  if (!unchanged) ctx.s.plmSync = { revision: snapshot.revision, syncedAt: ctx.now, conflicts, missingParts };
  return recorded;
}

/** A working name's delivered part no longer carries the set in effect for it (an emergency stop since): DCL exports it again. */
export function deliveredPartOutdated(s: State, v: SoftwareVersion): boolean {
  if (workingNameState(v) !== 'DELIVERED') return false;
  const current = setInEffect(s, v.vehicleModelId, v.version);
  return !!current && s.resolvedConfigs[current.resolvedConfigId]?.digest !== v.dclPart!.digest;
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
