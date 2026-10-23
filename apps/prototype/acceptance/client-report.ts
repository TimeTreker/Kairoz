// 客户端状态上报 · 车辆资源与 DCL 联调 (R01–R05) on the demo installation. The vehicle's DCL client
// is played by the simulator; signatures are mock.

import { clientReportView, registerDeviceKey } from '../src/engine/client-report.ts';
import { registerPhysical } from '../src/engine/fleet.ts';
import { demoState } from '../src/engine/seed.ts';
import { devicePublicKey, flushOutbox, provisionDevice, reportNow, restartClient, sendFault, setAgent, upgradeClient } from '../src/engine/simulator.ts';
import type { State } from '../src/engine/types.ts';
import type { SceneSpec } from './world.ts';

export const start = (): State => demoState();

const view = (w: Parameters<SceneSpec['run']>[0], id = 'SIM-021') => clientReportView(w.s, w.actor('resource'), id, null)!;

export const scenes: Record<string, SceneSpec> = {
  R01: {
    run: (w) => {
      const v = view(w);
      w.check(v.deviceKey !== null, 'SIM-021 has a registered device key');
      const latest = v.latest!.payload;
      w.eq(latest.vehicleIntegrationVersion, w.s.resources['SIM-021']!.integrationVersion, 'the actual software version is reported');
      w.check(latest.clients.some((c) => c.id === 'dcl-client' && c.version), 'the DCL client version is reported');
      w.check(latest.configuration !== null && latest.files.length > 0 && latest.edgeProcessing.length > 0 && latest.cloudProcessing.length > 0, 'configuration, files and processing references are reported');
      w.eq([v.comparison!.configuration.same, v.comparison!.software.same], [true, true], 'the report matches the platform record');
      w.check(v.history.length > 0 && v.history.some((h) => h.bootCounter < v.latest!.bootCounter), 'the history includes the boot before the restart');
      w.eq(clientReportView(w.s, w.actor('business'), 'SIM-021', 'team-brake')?.latest?.digest, v.latest!.digest, 'the brake team sees it in its workspace');
      w.eq(clientReportView(w.s, w.actor('steering'), 'SIM-021', 'team-steering'), null, 'another team does not');
    },
  },
  R02: {
    needs: ['R01'],
    run: (w) => {
      const before = view(w).latest!.digest;
      w.sys((c) => setAgent(c, 'SIM-021', { online: false }));
      w.sys((c) => upgradeClient(c, 'SIM-021', '2.4.0'));
      w.eq(w.sys((c) => reportNow(c, 'SIM-021')), 'QUEUED', 'the report waits while offline');
      w.eq(w.s.devices['SIM-021']!.outbox.length, 1, 'one queued snapshot');
      w.eq(view(w).latest!.digest, before, 'no new report reached the platform');
    },
  },
  R03: {
    needs: ['R02'],
    run: (w) => {
      const history = view(w).history.length;
      w.sys((c) => setAgent(c, 'SIM-021', { online: true }));
      w.eq(w.sys((c) => flushOutbox(c, 'SIM-021')), { sent: 1, waiting: 0 }, 'the queued snapshot is sent');
      const v = view(w);
      w.eq(v.latest!.payload.clients[0]!.version, '2.4.0', 'the latest shows the new client');
      w.eq(v.history.length, history + 1, 'the previous latest moved to the history');
    },
  },
  R04: {
    run: (w) => {
      w.as('resource', (c) => registerPhysical(c, { id: 'VEH-098', vin: 'LSDEMX89000000098', vehicleModelId: 'X89', env: 'development', pool: 'Chassis', displayName: '上报演练车 098' }));
      w.fails('DEVICE_NOT_REGISTERED', () => w.sys((c) => reportNow(c, 'VEH-098')));
      const key = w.sys((c) => {
        provisionDevice(c, 'VEH-098');
        return devicePublicKey(c.s, 'VEH-098')!;
      });
      w.as('resource', (c) => registerDeviceKey(c, 'VEH-098', key));
      w.eq(w.sys((c) => reportNow(c, 'VEH-098')), 'ACCEPTED', 'a registered device reports');
      w.fails('SIGNATURE_INVALID', () => w.sys((c) => sendFault(c, 'VEH-098', 'TAMPER')));
      w.fails('INVALID_DEVICE_KEY', () => w.as('resource', (c) => registerDeviceKey(c, 'VEH-098', { keyId: 'k', publicKey: 'not-a-key' })));
    },
  },
  R05: {
    needs: ['R03'],
    run: (w) => {
      const before = view(w);
      w.eq(w.sys((c) => sendFault(c, 'SIM-021', 'REPLAY')), 'REPLAYED', 'a resend is recognised');
      w.eq(view(w).history.length, before.history.length, 'and adds no history');
      w.fails('REPORT_SEQUENCE_CONFLICT', () => w.sys((c) => sendFault(c, 'SIM-021', 'SEQUENCE_CONFLICT')));
      w.fails('REPORT_BOOT_CONFLICT', () => w.sys((c) => sendFault(c, 'SIM-021', 'BOOT_CONFLICT')));
      w.eq(w.sys((c) => sendFault(c, 'SIM-021', 'OUT_OF_ORDER')), 'STALE', 'the older of two reversed reports only joins the history');
      const mid = view(w).latest!;
      w.check(mid.sequence > before.latest!.sequence && view(w).history[0]!.result === 'STALE', 'the newer one stays the latest');
      w.sys((c) => restartClient(c, 'SIM-021'));
      const after = view(w).latest!;
      w.eq([after.bootCounter, after.sequence], [mid.bootCounter + 1, 1], 'a restart starts the next boot at sequence 1');
    },
  },
};
