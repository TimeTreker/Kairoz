// TSP sync (TSP 同步). Car information comes from TSP: what TSP holds for each registered car — its
// T-Box, hardware configuration and the version it should run — is mirrored onto the vehicle. The
// version TSP expects never becomes the vehicle's actual version: only the car's own signed report
// says what it runs, and a difference means the car has not updated yet (or failed to).

import type { Ctx } from './engine.ts';
import type { Resource, State, TspCatalog, TspVehicle } from './types.ts';

/** The mirror of TSP's record on a vehicle. */
export function tspMirror(v: TspVehicle, at: string): NonNullable<Resource['tsp']> {
  return { tboxId: v.tboxId, hardware: v.hardware.map((h) => ({ ...h })), expectedVersion: v.expectedVersion, syncedAt: at };
}

/** Applies TSP's records to the registered cars (system context; it never throws). Returns how many changed. */
export function syncTsp(ctx: Ctx, snapshot: TspCatalog): number {
  let changed = 0;
  const byVin = new Map(snapshot.vehicles.map((v) => [v.vin, v]));
  for (const r of Object.values(ctx.s.resources)) {
    const v = r.type === 'PHYSICAL' && r.vin ? byVin.get(r.vin) : undefined;
    if (!v) continue;
    const next = tspMirror(v, ctx.now);
    const same = r.tsp && JSON.stringify({ ...r.tsp, syncedAt: '' }) === JSON.stringify({ ...next, syncedAt: '' });
    if (same) continue;
    r.tsp = next;
    changed += 1;
  }
  ctx.s.tspSync = { revision: snapshot.revision, syncedAt: ctx.now };
  return changed;
}

/** What the car's latest signed report says it runs (a version, or a partial update); null before it ever reported. */
export function reportedSoftware(s: State, r: Resource): { version: string | null; partial: boolean } | null {
  const latest = s.clientReports[r.id]?.latest?.payload;
  return latest ? { version: latest.vehicleIntegrationVersion, partial: latest.domains.some((d) => d.status === 'FAIL') } : null;
}

/**
 * Whether the car's own report differs from the version TSP holds for it (not updated yet, or the
 * update failed). It compares with what the car says, not the platform's record: a car on a version
 * PLM has not published agrees with TSP all the same. A car that never reported is not compared.
 */
export function tspMismatch(s: State, r: Resource): boolean {
  if (r.type !== 'PHYSICAL' || !r.tsp?.expectedVersion) return false;
  const reported = reportedSoftware(s, r);
  return !!reported && (reported.partial || reported.version !== r.tsp.expectedVersion);
}
