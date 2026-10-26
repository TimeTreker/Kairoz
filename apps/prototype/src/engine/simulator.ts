// The vehicle simulator: stands in for on-vehicle agents and simulators. It runs in the system
// context (no user) and talks to the platform only the way vehicles would: by sending receipts.

import type { Draft } from 'immer';
import { contentDigest, mockPublicKey, mockSign } from '../domain/client-report.ts';
import type { ClientReportPayload, SignedReport, VersionItem } from '../domain/client-report.ts';
import { DomainError, notFound, rule } from '../domain/errors.ts';
import { newId } from '../domain/ids.ts';
import { acceptClientReport, checkClientReport, configurationContents } from './client-report.ts';
import { DAY_MS, nowOf } from './clock.ts';
import type { Ctx } from './engine.ts';
import type { AgentState, DeviceState, Resource, State, UnsentReceipt } from './types.ts';
import { answerCaptureRequest } from './aftersales.ts';
import { releaseHeld } from './budget.ts';
import { confirmHold, isCollectionPaused } from './collection-hold.ts';
import { syncIfChanged } from './company-directory.ts';
import { pushPending } from './delivery.ts';
import { advanceEvent } from './events.ts';
import { answerImageChange } from './sim-software.ts';
import { acceptReceipt } from './validation.ts';
import { answerVehicleSoftware } from './vehicle-software.ts';

export function setAgent(ctx: Ctx, resourceId: string, patch: Partial<AgentState>): void {
  const r = ctx.s.resources[resourceId] as Draft<Resource> | undefined;
  if (!r) throw notFound('vehicle', resourceId);
  Object.assign(r.agent, patch);
}

/**
 * What each vehicle has been asked to apply and has not answered yet. Targets of a paused rollout
 * are held: nothing is delivered and no receipt is accepted until the rollout is resumed.
 */
export function pendingForVehicles(s: State) {
  return Object.values(s.deployments).flatMap((d) =>
    d.status === 'PENDING' || d.status === 'PAUSED'
      ? d.targets.filter((t) => t.status === 'PENDING').map((t) => ({ deployment: d, target: t, held: d.status === 'PAUSED' }))
      : [],
  );
}

/** The vehicle answers one pending configuration. */
export function sendReceipt(ctx: Ctx, deploymentId: string, resourceId: string, result: 'APPLIED' | 'FAILED', error?: string) {
  const d = ctx.s.deployments[deploymentId];
  const t = d?.targets.find((x) => x.resourceId === resourceId);
  if (!d || !t) throw notFound('deployment target', `${deploymentId}/${resourceId}`);
  const answer = acceptReceipt(ctx, { deploymentId, resourceId, attempt: t.attempt, result, ...(error ? { error } : {}) });
  const device = ctx.s.devices[resourceId];
  // The platform now records what the vehicle runs; a receipt it held for this target is delivered.
  if (device && result === 'APPLIED') {
    device.config = null;
    device.unsent = device.unsent.filter((u) => u.deploymentId !== deploymentId);
  }
  return answer;
}

/** What each fault makes the vehicle answer (the error of its FAILED receipt). */
export const FAULT_ERRORS = {
  CHECKSUM: 'package checksum mismatch; nothing installed, the previous configuration stays',
  SIGNATURE: 'package signature does not verify against the platform key; nothing installed, the previous configuration stays',
  APPLY_INTERRUPTED: 'apply interrupted; the previous configuration was restored',
  APPLY_INTERRUPTED_FIRST: 'apply interrupted; there is no earlier configuration to restore, the vehicle runs none',
} as const;

/**
 * The vehicle applies one pushed configuration and answers, playing its fault: a corrupt or
 * unsigned package is refused, an interrupted apply restores the previous configuration, and a
 * lost receipt leaves the platform waiting while the vehicle runs the new configuration.
 */
function applyOnVehicle(ctx: Ctx, deploymentId: string, r: Resource): void {
  const d = ctx.s.deployments[deploymentId]!;
  const runs = ctx.s.devices[r.id]?.config ?? r.appliedConfigId;
  switch (r.agent.fault) {
    case 'CHECKSUM':
    case 'SIGNATURE':
      sendReceipt(ctx, d.id, r.id, 'FAILED', FAULT_ERRORS[r.agent.fault]);
      return;
    case 'APPLY_INTERRUPTED':
      sendReceipt(ctx, d.id, r.id, 'FAILED', runs ? FAULT_ERRORS.APPLY_INTERRUPTED : FAULT_ERRORS.APPLY_INTERRUPTED_FIRST);
      return;
    case 'DROP_RECEIPT': {
      const t = d.targets.find((x) => x.resourceId === r.id)!;
      const device = provisionDevice(ctx, r.id);
      device.config = d.resolvedConfigId;
      device.unsent.push({ deploymentId: d.id, attempt: t.attempt, lastError: 'RECEIPT_LOST' });
      return;
    }
    case 'NONE':
      sendReceipt(ctx, d.id, r.id, 'APPLIED');
  }
}

/** The receipt the vehicle holds for this attempt (it applied it; the platform has not received it). */
export function heldReceipt(s: State, resourceId: string, deploymentId: string, attempt: number): UnsentReceipt | undefined {
  return s.devices[resourceId]?.unsent.find((u) => u.deploymentId === deploymentId && u.attempt === attempt);
}

/** The vehicle applies one pushed configuration now, playing its fault (the simulator's manual answer). */
export function applyNow(ctx: Ctx, deploymentId: string, resourceId: string): void {
  const d = ctx.s.deployments[deploymentId];
  const t = d?.targets.find((x) => x.resourceId === resourceId);
  if (!d || !t) throw notFound('deployment target', `${deploymentId}/${resourceId}`);
  if (holdsReceipt(ctx.s, resourceId, d.id, t.attempt)) throw rule('RECEIPT_HELD', 'the vehicle already applied this attempt; its receipt is waiting to be sent');
  applyOnVehicle(ctx, d.id, ctx.s.resources[resourceId]!);
}

/**
 * The simulation provider answers an image change. A new image starts a fresh DCL client with no
 * configuration: whatever the old image ran without the platform knowing, and its receipts, are gone.
 */
export function completeImageChange(ctx: Ctx, changeId: string, result: 'APPLIED' | 'FAILED', error?: string): void {
  const resourceId = ctx.s.imageChanges[changeId]?.resourceId;
  answerImageChange(ctx, changeId, result, error);
  const device = resourceId ? ctx.s.devices[resourceId] : undefined;
  if (device && result === 'APPLIED') {
    device.config = null;
    device.unsent = [];
  }
}

/** The vehicle applied this attempt and holds its receipt: it is not applied again. */
const holdsReceipt = (s: State, resourceId: string, deploymentId: string, attempt: number) => !!heldReceipt(s, resourceId, deploymentId, attempt);

/**
 * The vehicle sends the receipts it holds, oldest first (once connected and no longer losing them).
 * The platform confirms each attempt once; a paused rollout keeps it waiting until the resume, and
 * one the platform has moved past (cancelled, retried) is dropped.
 */
export function resendReceipts(ctx: Ctx, resourceId: string): { sent: number; waiting: number } {
  const r = runningVehicle(ctx, resourceId);
  const device = provisionDevice(ctx, r.id);
  if (!r.agent.online || r.agent.fault === 'DROP_RECEIPT') return { sent: 0, waiting: device.unsent.length };
  let sent = 0;
  const remaining: UnsentReceipt[] = [];
  for (const u of device.unsent) {
    try {
      acceptReceipt(ctx, { deploymentId: u.deploymentId, resourceId: r.id, attempt: u.attempt, result: 'APPLIED' });
      device.config = null;
      sent += 1;
    } catch (e) {
      if (e instanceof DomainError && e.code === 'OTA_PAUSED') remaining.push({ ...u, lastError: e.code });
      else if (!(e instanceof DomainError)) throw e;
    }
  }
  device.unsent = remaining;
  return { sent, waiting: remaining.length };
}

/** One simulator step: online vehicles in automatic mode answer their pending configurations
 * (not those of a paused rollout), and in-flight collection events move one processing step. */
export function tick(ctx: Ctx): number {
  let answered = 0;
  // Vehicles that are on and connected receive what was dispatched to them (推送).
  for (const r of Object.values(ctx.s.resources)) if (r.agent.online && clientRunning(r)) pushPending(ctx, r.id);
  // Receipts a vehicle could not deliver go out once it is connected and no longer loses them.
  for (const r of Object.values(ctx.s.resources)) {
    if (r.agent.online && clientRunning(r) && r.agent.fault !== 'DROP_RECEIPT' && ctx.s.devices[r.id]?.unsent.length) answered += resendReceipts(ctx, r.id).sent;
  }
  for (const { deployment, target } of pendingForVehicles(ctx.s)) {
    // Read the status now: a failure earlier in this step may have paused the rollout.
    if (ctx.s.deployments[deployment.id]!.status !== 'PENDING') continue;
    const r = ctx.s.resources[target.resourceId]!;
    if (!r.agent.online || !r.agent.autoAck || r.instance === 'STOPPED') continue;
    if (holdsReceipt(ctx.s, r.id, deployment.id, target.attempt)) continue;
    applyOnVehicle(ctx, deployment.id, r);
    answered += 1;
  }
  // A connected agent confirms a pending pause or resume, then uploads what its budget allows.
  for (const h of Object.values(ctx.s.collectionHolds)) {
    const r = ctx.s.resources[h.resourceId];
    if (r && r.agent.online && clientRunning(r) && (h.state === 'PAUSING' || h.state === 'RESUMING')) {
      confirmHold(ctx, r.id);
      answered += 1;
    }
  }
  // A connected vehicle answers after-sales requests first, then uploads what its budget allows.
  for (const q of Object.values(ctx.s.captureRequests)) {
    const r = ctx.s.resources[q.resourceId];
    if (q.status !== 'PENDING' || !r || !r.agent.online || !clientRunning(r) || isCollectionPaused(ctx.s, r.id)) continue;
    answerCaptureRequest(ctx, q.id);
    answered += 1;
  }
  for (const r of Object.values(ctx.s.resources)) {
    if (!r.agent.online || !clientRunning(r) || isCollectionPaused(ctx.s, r.id)) continue;
    if (Object.values(ctx.s.events).some((e) => e.resourceId === r.id && e.status === 'HELD')) answered += releaseHeld(ctx, r.id);
  }
  for (const e of Object.values(ctx.s.events)) {
    if (e.status !== 'UPLOADING' && e.status !== 'PROCESSING') continue;
    advanceEvent(ctx, e.id);
    answered += 1;
  }
  for (const r of Object.values(ctx.s.resources)) reportIfDue(ctx, r);
  // The company directory pushes its changes like a SCIM feed would.
  answered += syncIfChanged(ctx);
  return answered;
}

// ---------------------------------------------------------------------------
// The DCL client on each vehicle: reports what it actually runs (实际状态上报)
// ---------------------------------------------------------------------------

/** The DCL client version simulated vehicles run until upgraded. */
export const DCL_CLIENT_VERSION = '2.3.0';
/** A running client reports at least this often, even when nothing changed. */
export const REPORT_INTERVAL_MS = 60_000;
/** Reports a vehicle keeps while it cannot deliver them; the oldest go beyond this (prototype limit). */
export const OUTBOX_LIMIT = 20;

/** The vehicle's own storage: its key pair, boot counter and unsent reports. Created on first use. */
export function provisionDevice(ctx: Ctx, resourceId: string): Draft<DeviceState> {
  const existing = ctx.s.devices[resourceId];
  if (existing) return existing;
  if (!ctx.s.resources[resourceId]) throw notFound('vehicle', resourceId);
  const secret = `device-secret:${resourceId}:${newId('k')}`;
  ctx.s.devices[resourceId] = {
    keyId: `${resourceId}-k1`,
    secret,
    publicKey: mockPublicKey(secret),
    bootCounter: 1,
    bootId: newId('boot'),
    sequence: 0,
    clientVersion: DCL_CLIENT_VERSION,
    software: null,
    config: null,
    unsent: [],
    outbox: [],
    lastSent: null,
    lastContentDigest: null,
    lastSentAt: null,
  };
  return ctx.s.devices[resourceId]!;
}

/** The public key a vehicle ships with, as vehicle resources would receive it (prototype tool). */
export function devicePublicKey(s: State, resourceId: string): { keyId: string; publicKey: string } | null {
  const d = s.devices[resourceId];
  return d ? { keyId: d.keyId, publicKey: d.publicKey } : null;
}

const clientRunning = (r: Resource) => r.instance !== 'STOPPED' && r.status !== 'RETIRED';

/** What the client observes on its own vehicle. */
function observe(s: State, r: Resource, device: DeviceState): Omit<ClientReportPayload, 'sequence' | 'reportedAt'> {
  // A vehicle whose receipt was lost runs what it applied, whatever the platform recorded.
  const contents = configurationContents(s, device.config ?? r.appliedConfigId);
  const held = device.unsent.at(-1);
  const sent = s.receipts.findLast((x) => x.resourceId === r.id);
  const last = held ? { deploymentId: held.deploymentId, attempt: held.attempt, error: null } : sent;
  // After a simulated software OTA the car runs its own version, whatever the platform recorded.
  const software = r.type === 'PHYSICAL' && device.software ? device.software : r.integrationVersion;
  const domains: VersionItem[] =
    r.type === 'SIMULATION'
      ? [{ id: `image ${r.imageId ?? '—'}`, version: r.integrationVersion, status: r.instance ?? 'RUNNING' }]
      : r.controllers.length && !device.software
        ? r.controllers.map((c) => ({ id: c.name, version: c.version, status: c.status }))
        : [{ id: 'VEHICLE', version: software, status: device.software ? 'CONSISTENT' : r.softwareStatus }];
  return {
    schemaVersion: 1,
    resourceId: r.id,
    vin: r.vin,
    uvid: r.uvid,
    vehicleIntegrationVersion: software,
    domains,
    clients: [{ id: 'dcl-client', version: device.clientVersion, build: `${device.clientVersion}+mock`, status: 'RUNNING' }],
    configuration: contents && { version: contents.version, releaseId: contents.releaseId, digest: contents.digest },
    policies: contents?.policies ?? [],
    files: contents?.files ?? [],
    edgeProcessing: contents?.edgeProcessing ?? [],
    cloudProcessing: contents?.cloudProcessing ?? [],
    execution: { command: last?.deploymentId ?? null, attempt: last?.attempt ?? null, lastError: last?.error ?? null, mode: 'MOCK' },
    bootCounter: device.bootCounter,
    bootId: device.bootId,
  };
}

const contentKey = (o: Omit<ClientReportPayload, 'sequence' | 'reportedAt'>) => contentDigest({ ...o, sequence: 0, reportedAt: '' });

function sign(device: DeviceState, payload: ClientReportPayload): SignedReport {
  return { payload, keyId: device.keyId, signature: mockSign(device.secret, payload) };
}

/** The next report, numbered within the current boot. */
function nextReport(ctx: Ctx, r: Resource, device: Draft<DeviceState>): SignedReport {
  const observed = observe(ctx.s, r, device);
  device.sequence += 1;
  device.lastContentDigest = contentKey(observed);
  device.lastSentAt = ctx.now;
  return sign(device, { ...observed, sequence: device.sequence, reportedAt: ctx.now });
}

function queue(device: Draft<DeviceState>, signed: SignedReport, lastError: string | null): void {
  device.outbox.push({ signed, lastError });
  device.outbox.splice(0, Math.max(0, device.outbox.length - OUTBOX_LIMIT));
}

/** Delivers one report without throwing; the platform's refusal code, or null when accepted. */
function deliver(ctx: Ctx, device: Draft<DeviceState>, signed: SignedReport): string | null {
  const check = checkClientReport(ctx.s, signed);
  if (!check.ok) return check.code;
  acceptClientReport(ctx, signed);
  device.lastSent = signed;
  return null;
}

/** Sends queued reports in order. Each stays queued, with the refusal, until it is accepted. */
function drain(ctx: Ctx, device: Draft<DeviceState>): { sent: number; waiting: number } {
  let sent = 0;
  const remaining: { signed: SignedReport; lastError: string | null }[] = [];
  for (const item of device.outbox) {
    const refused = deliver(ctx, device, item.signed);
    if (refused) remaining.push({ signed: item.signed, lastError: refused });
    else sent += 1;
  }
  device.outbox = remaining;
  return { sent, waiting: remaining.length };
}

/** Each simulator step: a running client sends its queue when connected, then reports on change or every minute. */
function reportIfDue(ctx: Ctx, r: Resource): void {
  if (!clientRunning(r)) return;
  const device = provisionDevice(ctx, r.id);
  if (r.agent.online && device.outbox.length) drain(ctx, device);
  const due = device.lastContentDigest !== contentKey(observe(ctx.s, r, device)) || !device.lastSentAt || Date.parse(ctx.now) - Date.parse(device.lastSentAt) >= REPORT_INTERVAL_MS;
  if (!due) return;
  const signed = nextReport(ctx, r, device);
  if (!r.agent.online) queue(device, signed, null);
  else {
    const refused = deliver(ctx, device, signed);
    if (refused) queue(device, signed, refused);
  }
}

function runningVehicle(ctx: Ctx, resourceId: string): Resource {
  const r = ctx.s.resources[resourceId];
  if (!r) throw notFound('vehicle', resourceId);
  if (!clientRunning(r)) throw rule('CLIENT_NOT_RUNNING', `${r.id}’s client is not running`);
  return r;
}

/** The client reports now; offline, the report waits in the queue. Throws the platform’s refusal. */
export function reportNow(ctx: Ctx, resourceId: string): 'ACCEPTED' | 'REPLAYED' | 'STALE' | 'QUEUED' {
  const r = runningVehicle(ctx, resourceId);
  const device = provisionDevice(ctx, r.id);
  const signed = nextReport(ctx, r, device);
  if (!r.agent.online) {
    queue(device, signed, null);
    return 'QUEUED';
  }
  drain(ctx, device);
  const result = acceptClientReport(ctx, signed);
  device.lastSent = signed;
  return result;
}

/** Sends the queue now (when connected). */
export function flushOutbox(ctx: Ctx, resourceId: string): { sent: number; waiting: number } {
  const r = runningVehicle(ctx, resourceId);
  const device = provisionDevice(ctx, r.id);
  if (!r.agent.online) return { sent: 0, waiting: device.outbox.length };
  return drain(ctx, device);
}

/** A restart: the persistent boot counter goes up, with a new boot id and sequence from zero. */
export function restartClient(ctx: Ctx, resourceId: string): 'ACCEPTED' | 'REPLAYED' | 'STALE' | 'QUEUED' {
  const r = runningVehicle(ctx, resourceId);
  const device = provisionDevice(ctx, r.id);
  device.bootCounter += 1;
  device.bootId = newId('boot');
  device.sequence = 0;
  return reportNow(ctx, resourceId);
}

/** Installs another DCL client version; the next report carries it. */
/**
 * A whole-vehicle software OTA on a simulated physical vehicle: the car now runs `version`, and
 * says so in its next signed report. The platform learns it only from that report.
 */
export function simulateSoftwareOta(ctx: Ctx, resourceId: string, version: string): string {
  const r = ctx.s.resources[resourceId];
  if (!r) throw notFound('vehicle', resourceId);
  if (r.type !== 'PHYSICAL') throw rule('SIMULATION_SOFTWARE_FROM_IMAGE', 'a simulation’s software comes from its image');
  const v = version.trim();
  if (!/^[A-Za-z0-9._-]{1,40}$/.test(v)) throw rule('INVALID_VERSION', 'a software version is letters, digits, . _ - (up to 40)');
  provisionDevice(ctx, r.id).software = v;
  return v;
}

/**
 * The vehicle OTA system carries out a requested software update: on success the vehicle runs the
 * version, restarts and reports it (queued while it is offline).
 */
export function completeVehicleSoftware(ctx: Ctx, requestId: string, result: 'APPLIED' | 'FAILED'): string {
  const q = answerVehicleSoftware(ctx, requestId, result);
  if (result === 'APPLIED') {
    provisionDevice(ctx, q.resourceId).software = q.toVersion;
    if (clientRunning(ctx.s.resources[q.resourceId]!)) restartClient(ctx, q.resourceId);
  }
  return q.status;
}

/** Simulated time (模拟时间): the platform clock moves forward 1 to 30 days; it never goes back. */
export function advanceClock(ctx: Ctx, days: number): string {
  if (!Number.isInteger(days) || days < 1 || days > 30) throw rule('INVALID_CLOCK_STEP', 'move the clock forward 1 to 30 days');
  ctx.s.clockOffsetMs += days * DAY_MS;
  return nowOf(ctx.s);
}

/** Moves the platform clock forward by hours, e.g. into a vehicle's next budget hour. */
export function advanceClockHours(ctx: Ctx, hours: number): string {
  if (!Number.isInteger(hours) || hours < 1 || hours > 24) throw rule('INVALID_CLOCK_STEP', 'move the clock forward 1 to 24 hours');
  ctx.s.clockOffsetMs += hours * 3_600_000;
  return nowOf(ctx.s);
}

export function upgradeClient(ctx: Ctx, resourceId: string, version: string): void {
  provisionDevice(ctx, runningVehicle(ctx, resourceId).id).clientVersion = version;
}

export type ReportFault = 'REPLAY' | 'TAMPER' | 'SEQUENCE_CONFLICT' | 'BOOT_CONFLICT' | 'OUT_OF_ORDER';

/**
 * Sends what a faulty or forged sender would, to show the platform's checks (prototype tool).
 * REPLAY resends the last accepted report; TAMPER changes a signed report; SEQUENCE_CONFLICT
 * reuses the last sequence with other content; BOOT_CONFLICT claims the current boot counter with
 * another boot id; OUT_OF_ORDER delivers two new reports newest first.
 */
export function sendFault(ctx: Ctx, resourceId: string, fault: ReportFault): string {
  const r = runningVehicle(ctx, resourceId);
  const device = provisionDevice(ctx, r.id);
  const last = device.lastSent;
  switch (fault) {
    case 'REPLAY':
      if (!last) throw rule('NOTHING_TO_REPLAY', 'the client has not sent a report yet');
      return acceptClientReport(ctx, last);
    case 'TAMPER': {
      const signed = nextReport(ctx, r, device);
      return acceptClientReport(ctx, { ...signed, payload: { ...signed.payload, vehicleIntegrationVersion: 'forged' } });
    }
    case 'SEQUENCE_CONFLICT': {
      if (!last) throw rule('NOTHING_TO_REPLAY', 'the client has not sent a report yet');
      const payload = { ...last.payload, execution: { ...last.payload.execution, lastError: 'different content' } };
      return acceptClientReport(ctx, sign(device, payload));
    }
    case 'BOOT_CONFLICT': {
      const observed = observe(ctx.s, r, device);
      return acceptClientReport(ctx, sign(device, { ...observed, bootId: newId('boot'), sequence: device.sequence + 1, reportedAt: ctx.now }));
    }
    case 'OUT_OF_ORDER': {
      const first = nextReport(ctx, r, device);
      const second = nextReport(ctx, r, device);
      acceptClientReport(ctx, second);
      device.lastSent = second;
      return acceptClientReport(ctx, first);
    }
  }
}

/** What the simulator shows about a vehicle's client (prototype tool). */
export function deviceSummary(s: State, resourceId: string) {
  const d = s.devices[resourceId];
  if (!d) return null;
  return {
    clientVersion: d.clientVersion,
    bootCounter: d.bootCounter,
    sequence: d.sequence,
    queued: d.outbox.length,
    unsentReceipts: d.unsent.length,
    ownConfig: d.config,
    lastError: d.outbox.findLast((x) => x.lastError)?.lastError ?? null,
    hasSent: d.lastSent !== null,
  };
}
