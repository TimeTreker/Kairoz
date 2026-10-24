// Whether a policy can still work on a vehicle software version: every signal its trigger reads
// and every data source it captures must exist in that software. Checked policy by policy; the
// decision to apply a set to a software version is still taken for the whole set.

import type { FileSpecContent, PolicyContent } from './config.ts';
import { rule } from './errors.ts';
import { parseTrigger } from './trigger.ts';

/** What a software version provides (mock: recorded by vehicle resources from a trusted source). */
export interface SoftwareManifest {
  /** Signal names available to triggers, sorted and unique. */
  signals: string[];
  /** Data sources files may be collected from; a directory covers its subdirectories. */
  sources: { unit: string; directory: string }[];
}

export type CompatibilityStatus = 'OK' | 'MISSING' | 'UNKNOWN';

export interface PolicyCompatibility {
  policyId: string;
  status: CompatibilityStatus;
  missingSignals: string[];
  /** Captured data keys whose source the software does not provide. */
  missingSources: string[];
}

const SIGNAL = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const UNIT = /^[A-Z][A-Z0-9_-]{0,31}$/;

/** Checks and normalizes a manifest typed by vehicle resources. */
export function normalizeManifest(input: { signals: string[]; sources: { unit: string; directory: string }[] }): SoftwareManifest {
  const signals = [...new Set(input.signals.map((s) => s.trim()).filter(Boolean))].sort();
  const bad = signals.filter((s) => !SIGNAL.test(s));
  if (bad.length) throw rule('INVALID_MANIFEST', 'signal names are dotted identifiers', { issues: bad });
  const sources = input.sources.map((s) => {
    const unit = s.unit.trim().toUpperCase();
    const directory = `/${s.directory.trim().split('/').filter(Boolean).join('/')}`;
    if (!UNIT.test(unit) || !s.directory.trim().startsWith('/')) throw rule('INVALID_MANIFEST', 'a source is UNIT:/absolute/directory', { issues: [`${s.unit}:${s.directory}`] });
    return { unit, directory };
  });
  const unique = [...new Map(sources.map((s) => [`${s.unit}:${s.directory}`, s])).values()].sort((a, b) =>
    `${a.unit}:${a.directory}`.localeCompare(`${b.unit}:${b.directory}`),
  );
  return { signals, sources: unique };
}

function covered(manifest: SoftwareManifest, unit: string, directory: string): boolean {
  return manifest.sources.some((s) => s.unit === unit && (directory === s.directory || directory.startsWith(s.directory === '/' ? '/' : `${s.directory}/`)));
}

/** One policy against one software manifest. `files` holds the policy's captured files, owned or referenced. */
export function policyCompatibility(policyId: string, policy: PolicyContent, files: Record<string, FileSpecContent>, manifest: SoftwareManifest | null): PolicyCompatibility {
  if (!manifest) return { policyId, status: 'UNKNOWN', missingSignals: [], missingSources: [] };
  const parsed = parseTrigger(policy.trigger);
  const signals = parsed.ok ? parsed.signals : [];
  const missingSignals = signals.filter((s) => !manifest.signals.includes(s));
  const missingSources = policy.captures.filter((key) => {
    const file = files[key];
    return !file || !covered(manifest, file.source.unit, file.source.directory);
  });
  const status = missingSignals.length || missingSources.length ? 'MISSING' : 'OK';
  return { policyId, status, missingSignals, missingSources };
}
