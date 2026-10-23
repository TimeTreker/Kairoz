// The DCL client's actual-state report (DCL Client 实际状态上报), contract v1. A vehicle reports
// what it actually runs; the platform keeps the latest snapshot and the history. A report is
// diagnostic: it never completes an OTA, never changes ownership and never sets a software version.

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
