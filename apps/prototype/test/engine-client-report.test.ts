import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { mockSign } from '../src/domain/client-report.ts';
import type { ClientReportPayload } from '../src/domain/client-report.ts';
import { DomainError } from '../src/domain/errors.ts';
import { acceptClientReport, clientReportView, registerDeviceKey, REPORT_HISTORY_LIMIT } from '../src/engine/client-report.ts';
import type { Actor } from '../src/engine/engine.ts';
import { Engine } from '../src/engine/engine.ts';
import { demoState } from '../src/engine/seed.ts';
import { devicePublicKey, flushOutbox, provisionDevice, reportNow, restartClient, sendFault, setAgent, tick, upgradeClient } from '../src/engine/simulator.ts';
import { dispatchFeature } from '../src/engine/validation.ts';

function fails(fn: () => unknown, code: string): DomainError {
  try {
    fn();
  } catch (e) {
    if (e instanceof DomainError && e.code === code) return e;
    throw new Error(`expected ${code}, got ${e instanceof DomainError ? `${e.code} ${JSON.stringify(e.details)}` : e}`);
  }
  throw new Error(`expected ${code}, but it succeeded`);
}

/** The demo with SIM-021's client registered by vehicle resources. */
function setup(register = true) {
  const e = new Engine(demoState());
  const actor = (username: string): Actor => {
    const a = e.getState().accounts[username]!;
    return { username, displayName: a.displayName, grants: a.grants };
  };
  const sys = <R>(op: Parameters<Engine['run']>[1]) => e.run(null, op) as R;
  // Start these two clients afresh: no device storage, no registered key, no reports.
  const s0 = e.getState();
  const devices = { ...s0.devices };
  const resources = { ...s0.resources };
  for (const id of ['SIM-021', 'VEH-001']) {
    delete devices[id];
    resources[id] = { ...resources[id]!, deviceKey: null };
  }
  e.replace({ ...s0, devices, resources, clientReports: {} });
  for (const id of ['SIM-021', 'VEH-001']) sys((c) => provisionDevice(c, id));
  if (register) {
    for (const id of ['SIM-021', 'VEH-001']) e.run('resource', (c) => registerDeviceKey(c, id, devicePublicKey(c.s, id)!));
  }
  const log = (id = 'SIM-021') => e.getState().clientReports[id];
  return { e, actor, sys, log };
}

/** A payload signed with SIM-021's own key, for crafted reports. */
function craft(e: Engine, change: (p: ClientReportPayload) => ClientReportPayload) {
  const device = e.getState().devices['SIM-021']!;
  const base: ClientReportPayload = {
    schemaVersion: 1,
    resourceId: 'SIM-021',
    vin: null,
    uvid: 'SIM-021',
    vehicleIntegrationVersion: '1.0',
    domains: [],
    clients: [],
    configuration: null,
    policies: [],
    files: [],
    edgeProcessing: [],
    cloudProcessing: [],
    execution: { command: null, attempt: null, lastError: null, mode: 'MOCK' },
    bootCounter: 9,
    bootId: 'boot_x',
    sequence: 1,
    reportedAt: '2026-10-23T00:00:00.000Z',
  };
  const payload = change(base);
  return { payload, keyId: device.keyId, signature: mockSign(device.secret, payload) };
}

describe('client reports: the platform checks', () => {
  test('only a registered device may report; then the report becomes the latest', () => {
    const { sys, log } = setup(false);
    fails(() => sys((c) => reportNow(c, 'SIM-021')), 'DEVICE_NOT_REGISTERED');
    const { e, sys: sys2, log: log2 } = setup();
    assert.equal(sys2((c) => reportNow(c, 'SIM-021')), 'ACCEPTED');
    const latest = log2()!.latest!;
    assert.equal(latest.payload.resourceId, 'SIM-021');
    assert.equal(latest.payload.configuration?.digest, e.getState().resolvedConfigs[e.getState().resources['SIM-021']!.appliedConfigId!]!.digest);
    assert.equal(log(), undefined);
  });

  test('a resent report changes nothing; other content under the same number is refused', () => {
    const { sys, log } = setup();
    sys((c) => reportNow(c, 'SIM-021'));
    sys((c) => reportNow(c, 'SIM-021'));
    const before = JSON.stringify(log());
    assert.equal(sys((c) => sendFault(c, 'SIM-021', 'REPLAY')), 'REPLAYED');
    assert.equal(JSON.stringify(log()), before);
    fails(() => sys((c) => sendFault(c, 'SIM-021', 'SEQUENCE_CONFLICT')), 'REPORT_SEQUENCE_CONFLICT');
    assert.equal(JSON.stringify(log()), before);
  });

  test('a changed report fails its signature; another boot id under the same counter is refused', () => {
    const { sys, log } = setup();
    sys((c) => reportNow(c, 'SIM-021'));
    const before = JSON.stringify(log());
    fails(() => sys((c) => sendFault(c, 'SIM-021', 'TAMPER')), 'SIGNATURE_INVALID');
    fails(() => sys((c) => sendFault(c, 'SIM-021', 'BOOT_CONFLICT')), 'REPORT_BOOT_CONFLICT');
    assert.equal(JSON.stringify(log()), before);
  });

  test('order comes from boot counter and sequence, never the clock: an older report only joins the history', () => {
    const { sys, log } = setup();
    sys((c) => reportNow(c, 'SIM-021'));
    assert.equal(sys((c) => sendFault(c, 'SIM-021', 'OUT_OF_ORDER')), 'STALE');
    const l = log()!;
    assert.equal(l.latest!.sequence, 3);
    assert.deepEqual(
      l.history.map((h) => [h.sequence, h.result]),
      [
        [2, 'STALE'],
        [1, 'ACCEPTED'],
      ],
    );
  });

  test('a restart starts a new boot that is newer than every report of the old one', () => {
    const { sys, log } = setup();
    sys((c) => reportNow(c, 'SIM-021'));
    sys((c) => reportNow(c, 'SIM-021'));
    sys((c) => restartClient(c, 'SIM-021'));
    const l = log()!;
    assert.deepEqual([l.latest!.bootCounter, l.latest!.sequence], [2, 1]);
    assert.equal(Object.keys(l.boots).length, 2);
  });

  test('identity, format and size are checked', () => {
    const { e } = setup();
    fails(() => e.run(null, (c) => acceptClientReport(c, craft(e, (p) => ({ ...p, uvid: 'SIM-099' })))), 'REPORT_IDENTITY_MISMATCH');
    fails(() => e.run(null, (c) => acceptClientReport(c, craft(e, (p) => ({ ...p, schemaVersion: 2 })))), 'REPORT_SCHEMA_UNSUPPORTED');
    const many = Array.from({ length: 257 }, (_, i) => ({ id: `p${i}`, version: 'v1', status: 'CONFIGURED' }));
    fails(() => e.run(null, (c) => acceptClientReport(c, craft(e, (p) => ({ ...p, policies: many })))), 'REPORT_TOO_LARGE');
    assert.equal(e.run(null, (c) => acceptClientReport(c, craft(e, (p) => p))), 'ACCEPTED');
  });

  test('the history is capped', () => {
    const { sys, log } = setup();
    for (let i = 0; i < REPORT_HISTORY_LIMIT + 5; i++) sys((c) => reportNow(c, 'SIM-021'));
    assert.equal(log()!.history.length, REPORT_HISTORY_LIMIT);
    assert.equal(log()!.latest!.sequence, REPORT_HISTORY_LIMIT + 5);
  });
});

describe('client reports: the vehicle side', () => {
  test('offline, reports wait in the queue; reconnected, they are sent and leave the queue', () => {
    const { e, sys, log } = setup();
    sys((c) => reportNow(c, 'SIM-021'));
    sys((c) => setAgent(c, 'SIM-021', { online: false }));
    sys((c) => upgradeClient(c, 'SIM-021', '2.4.0'));
    assert.equal(sys((c) => reportNow(c, 'SIM-021')), 'QUEUED');
    assert.equal(e.getState().devices['SIM-021']!.outbox.length, 1);
    assert.equal(log()!.latest!.payload.clients[0]!.version, '2.3.0');
    sys((c) => setAgent(c, 'SIM-021', { online: true }));
    assert.deepEqual(sys((c) => flushOutbox(c, 'SIM-021')), { sent: 1, waiting: 0 });
    assert.equal(log()!.latest!.payload.clients[0]!.version, '2.4.0');
    assert.equal(log()!.history.length, 1);
  });

  test('a refused queued report keeps its refusal and never stops receipts', () => {
    const { e, sys } = setup(false);
    const feature = Object.values(e.getState().features).find((f) => f.name === 'brake_monitor')!;
    const group = Object.values(e.getState().vehicleGroups).find((g) => g.name === '制动研发车组')!;
    e.run('brake_tester', (c) => dispatchFeature(c, feature.id, { commitId: feature.headCommitId!, vehicleGroupIds: [group.id] }));
    for (const id of ['SIM-021', 'VEH-001']) sys((c) => setAgent(c, id, { autoAck: true }));
    sys((c) => tick(c));
    const s = e.getState();
    assert.ok(s.receipts.some((r) => r.resourceId === 'SIM-021' && r.result === 'APPLIED'), 'the receipt went through');
    assert.equal(s.devices['SIM-021']!.outbox[0]?.lastError, 'DEVICE_NOT_REGISTERED');
    assert.equal(s.clientReports['SIM-021'], undefined);
  });

  test('a report never completes an OTA, changes ownership or sets the software version', () => {
    const { e, sys } = setup();
    const pick = () => {
      const s = e.getState();
      return JSON.stringify([s.deployments, s.receipts, s.workspaceResources, s.groupMembers, s.resources['SIM-021']!.appliedConfigId, s.resources['SIM-021']!.integrationVersion]);
    };
    const before = pick();
    sys((c) => reportNow(c, 'SIM-021'));
    sys((c) => restartClient(c, 'SIM-021'));
    sys((c) => sendFault(c, 'SIM-021', 'OUT_OF_ORDER'));
    assert.equal(pick(), before);
  });
});

describe('client reports: who reads them', () => {
  test('in a workspace that uses the vehicle, or through vehicle resources', () => {
    const { e, sys, actor } = setup();
    sys((c) => reportNow(c, 'SIM-021'));
    const s = e.getState();
    assert.ok(clientReportView(s, actor('business'), 'SIM-021', 'team-brake')?.latest);
    assert.equal(clientReportView(s, actor('business'), 'SIM-021', null), null, 'not through the registry');
    assert.equal(clientReportView(s, actor('steering'), 'SIM-021', 'team-steering'), null, 'not from a workspace without the vehicle');
    assert.equal(clientReportView(s, actor('dispatch_operator'), 'SIM-021', 'team-brake'), null, 'not for dispatch-only testers');
    assert.ok(clientReportView(s, actor('resource'), 'SIM-021', null)?.latest);
    const view = clientReportView(s, actor('resource'), 'SIM-021', null)!;
    assert.equal(view.comparison?.configuration.same, true);
    assert.equal(view.comparison?.software.same, true);
  });

  test('only the simulator reads the simulated devices’ storage', () => {
    const dir = new URL('../src/', import.meta.url);
    const readers: string[] = [];
    const walk = (sub: string) => {
      for (const entry of readdirSync(new URL(sub, dir), { withFileTypes: true })) {
        const path = `${sub}${entry.name}`;
        if (entry.isDirectory()) walk(`${path}/`);
        else if (/\.tsx?$/.test(entry.name) && /\.devices\b/.test(readFileSync(new URL(path, dir), 'utf8'))) readers.push(path);
      }
    };
    walk('');
    assert.deepEqual(readers.sort(), ['engine/migrate.ts', 'engine/simulator.ts'].sort());
  });
});
