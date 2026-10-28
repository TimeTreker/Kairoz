// The simulated TSP (prototype only): the company's record of each car — identity, model, plate,
// hardware configuration and the version it should run. It runs in the system context and owns its
// own data; the platform reads a car when vehicle resources register it, and syncs the cars it has.
// What a car actually runs comes only from the car's own signed report.

import { conflict, notFound, rule } from '../domain/errors.ts';
import type { Ctx } from './engine.ts';
import { syncTsp } from './tsp-sync.ts';
import type { HardwareItem, State, TspCatalog, TspVehicle } from './types.ts';

const VIN = /^[A-HJ-NPR-Z0-9]{17}$/;
const VERSION = /^[0-9]+(\.[0-9]+){0,3}$/;

/** TSP's record of a car, by VIN. */
export function tspVehicle(s: State, vin: string | null): TspVehicle | undefined {
  return vin ? s.tsp.vehicles.find((v) => v.vin === vin) : undefined;
}

function hardwareOf(input: HardwareItem[]): HardwareItem[] {
  const items = input.map((h) => ({ item: h.item.trim(), value: h.value.trim() })).filter((h) => h.item);
  if (items.some((h) => !h.value) || new Set(items.map((h) => h.item)).size !== items.length) throw rule('INVALID_HARDWARE', 'each hardware item has a name and a value, once');
  return items;
}

/** A car TSP now knows (it came off the line, or was fitted with a T-Box). */
export function addTspVehicle(ctx: Ctx, input: { vin: string; vehicleModelId: string; licensePlate?: string | null; hardware?: HardwareItem[]; expectedVersion?: string | null; uvid?: string; tboxId?: string }): string {
  const vin = input.vin.trim().toUpperCase();
  if (!VIN.test(vin)) throw rule('INVALID_VIN', 'a VIN has 17 characters without I, O or Q');
  if (tspVehicle(ctx.s, vin)) throw conflict('TSP_VIN_EXISTS', `TSP already has ${vin}`);
  if (!ctx.s.vehicleModels[input.vehicleModelId]) throw notFound('vehicle model', input.vehicleModelId);
  const expected = input.expectedVersion?.trim() || null;
  if (expected && !VERSION.test(expected)) throw rule('INVALID_VERSION', 'versions look like 1.2 or 1.2.0');
  const uvid = input.uvid?.trim() || `UV-${vin.slice(-10)}`;
  const tboxId = input.tboxId?.trim() || `TBOX-${vin.slice(-10)}`;
  if (ctx.s.tsp.vehicles.some((v) => v.uvid === uvid || v.tboxId === tboxId)) throw conflict('TSP_ID_TAKEN', `TSP already has a car with UVID ${uvid} or T-Box ${tboxId}`);
  ctx.s.tsp.vehicles.push({
    vin,
    uvid,
    tboxId,
    vehicleModelId: input.vehicleModelId,
    licensePlate: input.licensePlate?.trim() || null,
    hardware: hardwareOf(input.hardware ?? []),
    expectedVersion: expected,
  });
  ctx.s.tsp.revision += 1;
  return vin;
}

/**
 * TSP changes what it holds for a car: the version it should run (the vehicle OTA program assigned
 * another one, or TSP's record is simply wrong) or its hardware configuration.
 */
export function updateTspVehicle(ctx: Ctx, vin: string, input: { expectedVersion?: string | null; hardware?: HardwareItem[] }): void {
  const v = tspVehicle(ctx.s, vin);
  if (!v) throw notFound('TSP vehicle', vin);
  if (input.expectedVersion !== undefined) {
    const expected = input.expectedVersion?.trim() || null;
    if (expected && !VERSION.test(expected)) throw rule('INVALID_VERSION', 'versions look like 1.2 or 1.2.0');
    v.expectedVersion = expected;
  }
  if (input.hardware) v.hardware = hardwareOf(input.hardware);
  ctx.s.tsp.revision += 1;
}

/** Sends TSP's records to the platform when they changed since the last sync. */
export function syncTspIfChanged(ctx: Ctx): number {
  if (ctx.s.tsp.revision === ctx.s.tspSync.revision) return 0;
  return syncTsp(ctx, JSON.parse(JSON.stringify(ctx.s.tsp)) as TspCatalog);
}
