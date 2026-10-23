// The DCL client's actual-state report (DCL Client 实际状态上报), contract v1. A vehicle reports
// what it actually runs; the platform keeps the latest snapshot and the history. A report is
// diagnostic: it never completes an OTA, never changes ownership and never sets a software version.

import { canonicalJson, sha256Hex } from './canonical.ts';

/** A versioned item the client runs: a controller, a policy or a file. Unknown versions stay null. */
export interface VersionItem {
  id: string;
  version: string | null;
  status: string;
}

/** A DCL node on the vehicle. */
export interface ClientNode {
  id: string;
  version: string;
  build: string;
  status: string;
}

export interface ClientReportPayload {
  schemaVersion: number;
  resourceId: string;
  vin: string | null;
  uvid: string | null;
  /** The whole-vehicle version the client observes; null when unknown. */
  vehicleIntegrationVersion: string | null;
  domains: VersionItem[];
  clients: ClientNode[];
  /** The complete configuration in effect on the vehicle. */
  configuration: { version: string; releaseId: string | null; digest: string } | null;
  /** "Configured" means the configuration contains the policy, not that a business node applied it. */
  policies: VersionItem[];
  files: VersionItem[];
  edgeProcessing: string[];
  /** Cloud references the configuration names; not proof the cloud runs them. */
  cloudProcessing: string[];
  execution: { command: string | null; attempt: number | null; lastError: string | null; mode: 'MOCK' };
  /** Persistent, monotonic across restarts. */
  bootCounter: number;
  bootId: string;
  /** Monotonic within one boot. */
  sequence: number;
  /** Client clock; never used for ordering. */
  reportedAt: string;
}

export interface SignedReport {
  payload: ClientReportPayload;
  keyId: string;
  signature: string;
}

export const CLIENT_REPORT_SCHEMA = 1;
/** At most this many entries in each version list. */
export const MAX_REPORT_ITEMS = 256;
/** At most this many bytes of execution detail. */
export const MAX_EXECUTION_BYTES = 8 * 1024;

/** Why the payload is unacceptable as data, or null. Codes match the platform's error codes. */
export function payloadIssue(p: ClientReportPayload): { code: 'REPORT_SCHEMA_UNSUPPORTED' | 'REPORT_TOO_LARGE'; detail: string } | null {
  if (p.schemaVersion !== CLIENT_REPORT_SCHEMA) return { code: 'REPORT_SCHEMA_UNSUPPORTED', detail: `schema ${p.schemaVersion}; this platform reads ${CLIENT_REPORT_SCHEMA}` };
  if (!Number.isInteger(p.bootCounter) || p.bootCounter < 1 || !Number.isInteger(p.sequence) || p.sequence < 0 || !p.bootId) {
    return { code: 'REPORT_SCHEMA_UNSUPPORTED', detail: 'boot counter, boot id and sequence are required' };
  }
  for (const [name, list] of [['domains', p.domains], ['clients', p.clients], ['policies', p.policies], ['files', p.files], ['edgeProcessing', p.edgeProcessing], ['cloudProcessing', p.cloudProcessing]] as const) {
    if (list.length > MAX_REPORT_ITEMS) return { code: 'REPORT_TOO_LARGE', detail: `${name} has ${list.length} entries; at most ${MAX_REPORT_ITEMS}` };
  }
  const execution = new TextEncoder().encode(canonicalJson(p.execution)).length;
  if (execution > MAX_EXECUTION_BYTES) return { code: 'REPORT_TOO_LARGE', detail: `execution detail is ${execution} bytes; at most ${MAX_EXECUTION_BYTES}` };
  return null;
}

/** Identifies a report's content; the client clock is not part of it. */
export function contentDigest(p: ClientReportPayload): string {
  return `sha256:${sha256Hex(canonicalJson({ ...p, reportedAt: undefined }))}`;
}

/** Whether report a is newer than b: by boot counter, then sequence. Never by clock. */
export function isNewer(a: { bootCounter: number; sequence: number }, b: { bootCounter: number; sequence: number }): boolean {
  return a.bootCounter !== b.bootCounter ? a.bootCounter > b.bootCounter : a.sequence > b.sequence;
}

// Mock device signature. The real contract is an Ed25519 signature over the payload with a key
// registered beforehand. The prototype keeps the same flow (register a public key, sign, verify)
// with hashes, which anyone can forge: it shows the checks, not device authentication.

export function mockPublicKey(secret: string): string {
  return `mock-ed25519:${sha256Hex(`pub:${secret}`)}`;
}

export function mockSign(secret: string, payload: ClientReportPayload): string {
  return `mock-sig:${sha256Hex(mockPublicKey(secret) + canonicalJson(payload))}`;
}

export function mockVerify(publicKey: string, payload: ClientReportPayload, signature: string): boolean {
  return signature === `mock-sig:${sha256Hex(publicKey + canonicalJson(payload))}`;
}
