// 车端故障与恢复 (DF01–DF05, N01) on the demo installation: the brake group's vehicles play the
// faults of the v0.13 mock while the brake tester dispatches. A corrupt or wrongly signed package
// and an interrupted apply answer failed and keep the previous configuration; a lost receipt
// leaves the platform waiting while the vehicle runs the new configuration, and the resent
// receipt is confirmed once. A receipt that comes back after the dispatch was cancelled confirms
// nothing: the platform never takes what it dispatched for what the vehicle runs.

import { clientReportView } from '../src/engine/client-report.ts';
import { deliveryState } from '../src/engine/delivery.ts';
import { demoState } from '../src/engine/seed.ts';
import { FAULT_ERRORS, reportNow, resendReceipts, sendReceipt, setAgent, tick } from '../src/engine/simulator.ts';
import type { State } from '../src/engine/types.ts';
import * as v from '../src/engine/validation.ts';
import type { SceneSpec, World } from './world.ts';

export const start = (): State => demoState();

const feature = (w: World, name: string) => Object.values(w.s.features).find((f) => f.name === name)!;
const brakeGroup = (w: World) => Object.values(w.s.vehicleGroups).find((g) => g.name === '制动研发车组')!.id;
const dispatch = (w: World, name: string) => {
  const f = feature(w, name);
  const [d] = w.as('brake_tester', (c) => v.dispatchFeature(c, f.id, { commitId: f.headCommitId!, vehicleGroupIds: [brakeGroup(w)] }));
  return d!;
};
const target = (w: World, d: string, rid: string) => w.s.deployments[d]!.targets.find((t) => t.resourceId === rid)!;
const applied = (w: World, rid: string) => w.s.resources[rid]!.appliedConfigId;

export const scenes: Record<string, SceneSpec> = {
  DF01: {
    run: (w) => {
      const before = [applied(w, 'VEH-001'), applied(w, 'SIM-021')];
      // The brake group's vehicles answer on each simulator step.
      w.sys((c) => {
        setAgent(c, 'VEH-001', { autoAck: true, fault: 'CHECKSUM' });
        setAgent(c, 'SIM-021', { autoAck: true, fault: 'SIGNATURE' });
      });
      const d = dispatch(w, 'guided_brake');
      w.ref.failed = d;
      w.sys((c) => tick(c));
      w.eq([target(w, d, 'VEH-001').error, target(w, d, 'SIM-021').error], [FAULT_ERRORS.CHECKSUM, FAULT_ERRORS.SIGNATURE], 'each vehicle says why');
      w.eq([applied(w, 'VEH-001'), applied(w, 'SIM-021')], before, 'nothing installed: both keep their configuration');
      const f = feature(w, 'guided_brake');
      w.fails('NOT_APPLIED', () => w.as('brake_tester', (c) => v.recordFeatureTest(c, f.id, { commitId: f.headCommitId!, resourceId: 'SIM-021', result: 'PASS', summary: '仿真通过' })));
    },
  },
  DF02: {
    needs: ['DF01'],
    run: (w) => {
      w.sys((c) => {
        setAgent(c, 'VEH-001', { fault: 'NONE' });
        setAgent(c, 'SIM-021', { fault: 'NONE' });
      });
      const d = dispatch(w, 'guided_brake');
      w.sys((c) => tick(c));
      w.eq(w.s.deployments[d]!.status, 'COMPLETED', 'applied on both');
      w.eq(w.s.deployments[w.ref.failed!]!.targets.map((t) => t.status), ['FAILED', 'FAILED'], 'the failed dispatch keeps its reasons');
    },
  },
  DF03: {
    needs: ['DF02'],
    run: (w) => {
      const before = applied(w, 'VEH-001');
      w.sys((c) => setAgent(c, 'VEH-001', { fault: 'APPLY_INTERRUPTED' }));
      const d = dispatch(w, 'brake_monitor');
      w.ref.interrupted = d;
      w.sys((c) => tick(c));
      w.eq(target(w, d, 'VEH-001').error, FAULT_ERRORS.APPLY_INTERRUPTED, 'the vehicle restored its previous configuration');
      w.eq(applied(w, 'VEH-001'), before, 'it still runs guided_brake');
      w.eq(target(w, d, 'SIM-021').status, 'APPLIED', 'the other vehicle applied');
    },
  },
  DF04: {
    needs: ['DF03'],
    run: (w) => {
      const before = applied(w, 'VEH-001');
      w.sys((c) => setAgent(c, 'VEH-001', { fault: 'DROP_RECEIPT' }));
      const d = dispatch(w, 'brake_monitor');
      w.ref.lost = d;
      w.sys((c) => tick(c));
      w.eq(deliveryState(target(w, d, 'VEH-001')), 'PUSHED', 'the platform waits for the receipt');
      w.eq(applied(w, 'VEH-001'), before, 'only a receipt changes what the platform records');
      w.sys((c) => reportNow(c, 'VEH-001'));
      w.eq(clientReportView(w.s, w.actor('resource'), 'VEH-001', null)!.comparison!.configuration.same, false, 'the client reports what the vehicle really runs');
      w.sys((c) => tick(c));
      w.eq(deliveryState(target(w, d, 'VEH-001')), 'PUSHED', 'still losing receipts: nothing is applied twice');
      w.sys((c) => setAgent(c, 'VEH-001', { fault: 'NONE' }));
      w.sys((c) => tick(c));
      w.eq(target(w, d, 'VEH-001').status, 'APPLIED', 'the resent receipt is confirmed');
      w.eq(applied(w, 'VEH-001'), w.s.deployments[d]!.resolvedConfigId, 'the platform records brake_monitor');
      w.eq(w.s.receipts.filter((r) => r.deploymentId === d && r.resourceId === 'VEH-001').length, 1, 'once');
    },
  },
  DF05: {
    needs: ['DF04'],
    run: (w) => {
      const before = applied(w, 'VEH-001');
      w.sys((c) => setAgent(c, 'VEH-001', { fault: 'DROP_RECEIPT' }));
      const d = dispatch(w, 'guided_brake');
      w.sys((c) => tick(c));
      w.as('brake_tester', (c) => v.cancelDeployment(c, d, '回执迟迟未到，取消后重新下发'));
      w.sys((c) => setAgent(c, 'VEH-001', { fault: 'NONE' }));
      w.sys((c) => tick(c));
      w.eq(applied(w, 'VEH-001'), before, 'a cancelled dispatch confirms nothing');
      w.sys((c) => reportNow(c, 'VEH-001'));
      w.eq(clientReportView(w.s, w.actor('resource'), 'VEH-001', null)!.comparison!.configuration.same, false, 'the vehicle still runs guided_brake: the report shows it');
      const again = dispatch(w, 'guided_brake');
      w.sys((c) => tick(c));
      w.eq(target(w, again, 'VEH-001').status, 'APPLIED', 'a new dispatch brings them back in line');
      w.sys((c) => reportNow(c, 'VEH-001'));
      w.eq(clientReportView(w.s, w.actor('resource'), 'VEH-001', null)!.comparison!.configuration.same, true, 'the platform and the vehicle agree');
    },
  },
  N01: {
    needs: ['DF04'],
    run: (w) => {
      w.fails('RECEIPT_CONFLICT', () => w.sys((c) => sendReceipt(c, w.ref.interrupted!, 'VEH-001', 'APPLIED')));
      w.eq(w.sys((c) => resendReceipts(c, 'VEH-001')), { sent: 0, waiting: 0 }, 'a confirmed receipt is not sent again');
      w.eq(w.sys((c) => sendReceipt(c, w.ref.lost!, 'VEH-001', 'APPLIED')), 'REPLAYED', 'a duplicate receipt is ignored');
    },
  },
};
