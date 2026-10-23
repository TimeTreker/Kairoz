// Client reports (DCL Client 实际状态上报): what each vehicle says it actually runs. The platform
// checks the device and keeps the latest snapshot plus a history. A report is diagnostic only:
// it never completes an OTA, never changes ownership and never sets the recorded software version.

import { authorize } from '../domain/authz.ts';
import { contentDigest, isNewer, mockVerify, payloadIssue } from '../domain/client-report.ts';
import type { SignedReport, VersionItem } from '../domain/client-report.ts';
import { notFound, rule } from '../domain/errors.ts';
import type { DomainError } from '../domain/errors.ts';
import type { Actor, Ctx } from './engine.ts';
import { workspaceVehicles } from './fleet.ts';
import type { ClientReportLog, DeviceKey, State, StoredReport } from './types.ts';

/** History kept per vehicle; older reports are dropped. */
export const REPORT_HISTORY_LIMIT = 50;

export type ReportRefusal =
  | 'REPORT_SCHEMA_UNSUPPORTED'
  | 'REPORT_TOO_LARGE'
  | 'DEVICE_NOT_REGISTERED'
  | 'SIGNATURE_INVALID'
  | 'REPORT_IDENTITY_MISMATCH'
  | 'REPORT_BOOT_CONFLICT'
  | 'REPORT_SEQUENCE_CONFLICT';

export type ReportCheck = { ok: true; kind: 'NEW' | 'REPLAYED' | 'STALE'; digest: string } | { ok: false; code: ReportRefusal; detail: string };

/** Vehicle resources registers the device's public key; only registered devices may report. */
export function registerDeviceKey(ctx: Ctx, resourceId: string, input: { keyId: string; publicKey: string }): void {
  const r = ctx.s.resources[resourceId];
  if (!r) throw notFound('vehicle', resourceId);
  ctx.allow('resource.manage', { type: 'resource', id: r.id, scope: r.pool, env: r.env });
  const keyId = input.keyId.trim();
  const publicKey = input.publicKey.trim();
  if (!keyId || !/^mock-ed25519:[0-9a-f]{64}$/.test(publicKey)) throw rule('INVALID_DEVICE_KEY', 'give a key id and the device’s public key (mock-ed25519:…)');
  const key: DeviceKey = { keyId, publicKey, registeredBy: ctx.user().username, registeredAt: ctx.now };
  r.deviceKey = key;
  r.updatedAt = ctx.now;
}

function sameReport(a: StoredReport, bootCounter: number, sequence: number) {
  return a.bootCounter === bootCounter && a.sequence === sequence;
}

/** Whether a report would be accepted, without changing anything. Never throws. */
export function checkClientReport(s: State, signed: SignedReport): ReportCheck {
  const p = signed.payload;
  const issue = payloadIssue(p);
  if (issue) return { ok: false, code: issue.code, detail: issue.detail };
  const r = s.resources[p.resourceId];
  if (!r) return { ok: false, code: 'REPORT_IDENTITY_MISMATCH', detail: `${p.resourceId} is not a registered vehicle` };
  if (!r.deviceKey || r.deviceKey.keyId !== signed.keyId) {
    return { ok: false, code: 'DEVICE_NOT_REGISTERED', detail: `${r.id} has no registered device key ${signed.keyId}` };
  }
  if (!mockVerify(r.deviceKey.publicKey, p, signed.signature)) return { ok: false, code: 'SIGNATURE_INVALID', detail: `the signature does not match ${r.id}’s registered key` };
  if (p.vin !== r.vin || p.uvid !== r.uvid) return { ok: false, code: 'REPORT_IDENTITY_MISMATCH', detail: `the report’s VIN/UVID differ from ${r.id}’s registration` };
  const digest = contentDigest(p);
  const log = s.clientReports[r.id];
  const bootId = log?.boots[String(p.bootCounter)];
  if (bootId && bootId !== p.bootId) return { ok: false, code: 'REPORT_BOOT_CONFLICT', detail: `boot ${p.bootCounter} already has another boot id` };
  const earlier = log ? [...(log.latest ? [log.latest] : []), ...log.history].find((x) => sameReport(x, p.bootCounter, p.sequence)) : undefined;
  if (earlier) {
    return earlier.digest === digest
      ? { ok: true, kind: 'REPLAYED', digest }
      : { ok: false, code: 'REPORT_SEQUENCE_CONFLICT', detail: `boot ${p.bootCounter} sequence ${p.sequence} was already reported with other content` };
  }
  return { ok: true, kind: log?.latest && !isNewer(p, log.latest) ? 'STALE' : 'NEW', digest };
}

function refusal(code: ReportRefusal, detail: string): DomainError {
  // Literal codes, so every one is checked for a label.
  switch (code) {
    case 'REPORT_SCHEMA_UNSUPPORTED':
      return rule('REPORT_SCHEMA_UNSUPPORTED', detail);
    case 'REPORT_TOO_LARGE':
      return rule('REPORT_TOO_LARGE', detail);
    case 'DEVICE_NOT_REGISTERED':
      return rule('DEVICE_NOT_REGISTERED', detail);
    case 'SIGNATURE_INVALID':
      return rule('SIGNATURE_INVALID', detail);
    case 'REPORT_IDENTITY_MISMATCH':
      return rule('REPORT_IDENTITY_MISMATCH', detail);
    case 'REPORT_BOOT_CONFLICT':
      return rule('REPORT_BOOT_CONFLICT', detail);
    case 'REPORT_SEQUENCE_CONFLICT':
      return rule('REPORT_SEQUENCE_CONFLICT', detail);
  }
}

/**
 * A vehicle's report (system context). A newer report becomes the latest; an older one only joins
 * the history; an identical resend changes nothing.
 */
export function acceptClientReport(ctx: Ctx, signed: SignedReport): 'ACCEPTED' | 'REPLAYED' | 'STALE' {
  const check = checkClientReport(ctx.s, signed);
  if (!check.ok) throw refusal(check.code, check.detail);
  if (check.kind === 'REPLAYED') return 'REPLAYED';
  const p = signed.payload;
  const log: ClientReportLog = (ctx.s.clientReports[p.resourceId] ??= { latest: null, history: [], boots: {} });
  const entry: StoredReport = {
    bootCounter: p.bootCounter,
    bootId: p.bootId,
    sequence: p.sequence,
    digest: check.digest,
    payload: p,
    receivedAt: ctx.now,
    result: check.kind === 'NEW' ? 'ACCEPTED' : 'STALE',
  };
  log.boots[String(p.bootCounter)] = p.bootId;
  if (check.kind === 'NEW') {
    if (log.latest) log.history.unshift(log.latest);
    log.latest = entry;
  } else {
    log.history.unshift(entry);
    log.history.sort((a, b) => (isNewer(a, b) ? -1 : isNewer(b, a) ? 1 : 0));
  }
  log.history.splice(REPORT_HISTORY_LIMIT);
  return check.kind === 'NEW' ? 'ACCEPTED' : 'STALE';
}

/** The configuration contents a vehicle runs: what a client reports about its applied configuration. */
export function configurationContents(s: State, resolvedConfigId: string | null) {
  const config = resolvedConfigId ? s.resolvedConfigs[resolvedConfigId] : undefined;
  if (!config) return null;
  const pipeline = (id: string) => {
    const p = s.pipelines[id];
    return p ? `${p.code}@${p.version}` : id;
  };
  const policies: VersionItem[] = [];
  const files: VersionItem[] = [];
  const edge = new Set<string>();
  const cloud = new Set<string>();
  for (const [groupId, commitId] of Object.entries(config.groups)) {
    const commit = s.commits[commitId];
    if (!commit) continue;
    for (const [policyId, versionId] of Object.entries(commit.policies)) {
      policies.push({ id: policyId, version: `v${s.policyVersions[versionId]?.version ?? '?'}`, status: 'CONFIGURED' });
    }
    for (const e of s.manifestVersions[commit.manifestVersionId]?.entries ?? []) {
      if (s.dataItems[e.dataKey]?.ownerGroupId !== groupId) continue; // references are collected by their owner
      const v = s.fileSpecVersions[e.fileSpecVersionId];
      if (!v) continue;
      files.push({ id: s.dataItems[e.dataKey]?.dataCode ?? e.dataKey, version: `v${v.version}`, status: 'CONFIGURED' });
      edge.add(pipeline(v.content.edgePipelineId));
      cloud.add(pipeline(v.content.cloudPipelineId));
    }
  }
  const byId = (a: VersionItem, b: VersionItem) => a.id.localeCompare(b.id);
  return {
    version: config.label,
    releaseId: config.kind === 'RELEASE' ? config.sourceId : null,
    digest: config.digest,
    policies: policies.sort(byId),
    files: files.sort(byId),
    edgeProcessing: [...edge].sort(),
    cloudProcessing: [...cloud].sort(),
  };
}

/**
 * A vehicle's client reports for an actor: in a workspace that uses the vehicle (with the
 * environment granted there), or through vehicle resources. Null when not allowed.
 */
export function clientReportView(s: State, actor: Actor, resourceId: string, workspaceId: string | null) {
  const r = s.resources[resourceId];
  if (!r) return null;
  const allowed = workspaceId
    ? workspaceVehicles(s, workspaceId).some((v) => v.id === r.id) && authorize(actor.grants, 'clientReport.read', { workspaceId, env: r.env }).ok
    : authorize(actor.grants, 'resource.manage', { scope: r.pool, env: r.env }).ok;
  if (!allowed) return null;
  const log = s.clientReports[r.id] ?? { latest: null, history: [], boots: {} };
  const latest = log.latest?.payload ?? null;
  const applied = r.appliedConfigId ? s.resolvedConfigs[r.appliedConfigId] : undefined;
  return {
    resourceId: r.id,
    deviceKey: r.deviceKey,
    latest: log.latest,
    history: log.history,
    // Diagnostic comparison with the platform's own record; a difference changes nothing.
    comparison: latest && {
      configuration: {
        reported: latest.configuration?.digest ?? null,
        reportedLabel: latest.configuration?.version ?? null,
        recorded: applied?.digest ?? null,
        recordedLabel: applied?.label ?? null,
        same: (latest.configuration?.digest ?? null) === (applied?.digest ?? null),
      },
      software: { reported: latest.vehicleIntegrationVersion, recorded: r.integrationVersion, same: latest.vehicleIntegrationVersion === r.integrationVersion },
    },
  };
}
