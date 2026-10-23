// Upgrades a saved platform to the current schema, one version at a time, so a new version of
// the prototype keeps what people built. A save older than the first migration is not upgraded.

import { STATE_SCHEMA } from './types.ts';
import type { State } from './types.ts';

type Saved = Record<string, unknown> & { schema?: unknown };
type Rows = Record<string, Record<string, unknown>>;

const OLDEST_MIGRATABLE = 6;

/** Schema 7: integration scope and subsystem releases; device keys and client reports. */
function to7(s: Saved): void {
  for (const plan of Object.values((s.mergePlans ?? {}) as Rows)) {
    plan.scope ??= 'Vehicle';
    plan.subsystems ??= [];
    for (const c of (plan.conflicts ?? []) as Record<string, unknown>[]) c.subsystemReleaseIds ??= [];
  }
  for (const c of Object.values((s.candidates ?? {}) as Rows)) {
    c.scope ??= 'Vehicle';
    c.subsystems ??= [];
  }
  for (const r of Object.values((s.resources ?? {}) as Rows)) r.deviceKey ??= null;
  s.subsystemReleases ??= {};
  s.clientReports ??= {};
  s.devices ??= {};
  s.schema = 7;
}

const STEPS: Record<number, (s: Saved) => void> = { 6: to7 };

/** The state at the current schema, or null when it cannot be read or is too old. Mutates `raw`. */
export function migrate(raw: unknown): State | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Saved;
  if (typeof s.schema !== 'number' || s.schema < OLDEST_MIGRATABLE || s.schema > STATE_SCHEMA) return null;
  while (s.schema < STATE_SCHEMA) STEPS[s.schema as number]!(s);
  return s as unknown as State;
}
