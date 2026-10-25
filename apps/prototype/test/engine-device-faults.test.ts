import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { World } from '../acceptance/world.ts';
import { clientReportView } from '../src/engine/client-report.ts';
import { deliveryState } from '../src/engine/delivery.ts';
import { migrate } from '../src/engine/migrate.ts';
import { demoState } from '../src/engine/seed.ts';
import { FAULT_ERRORS, reportNow, resendReceipts, sendReceipt, setAgent, tick } from '../src/engine/simulator.ts';
import * as v from '../src/engine/validation.ts';

const feature = (w: World, name: string) => Object.values(w.s.features).find((f) => f.name === name)!;
const brakeGroup = (w: World) => Object.values(w.s.vehicleGroups).find((g) => g.name === '制动研发车组')!.id;
const dispatch = (w: World, name: string) => {
  const f = feature(w, name);
  const [d] = w.as('brake_tester', (c) => v.dispatchFeature(c, f.id, { commitId: f.headCommitId!, vehicleGroupIds: [brakeGroup(w)] }));
  return d!;
};
const target = (w: World, d: string, rid: string) => w.s.deployments[d]!.targets.find((t) => t.resourceId === rid)!;

/** The brake group's two vehicles answer automatically. */
function brakeWorld(): World {
  const w = new World(demoState());
  w.sys((c) => {
    setAgent(c, 'SIM-021', { autoAck: true });
    setAgent(c, 'VEH-001', { autoAck: true });
  });
  return w;
}

describe('device faults', () => {
  test('a corrupt or wrongly signed package is refused on the vehicle: failed, the previous configuration stays', () => {
    const w = brakeWorld();
    const before = { sim: w.s.resources['SIM-021']!.appliedConfigId, veh: w.s.resources['VEH-001']!.appliedConfigId };
    w.sys((c) => {
      setAgent(c, 'VEH-001', { fault: 'CHECKSUM' });
      setAgent(c, 'SIM-021', { fault: 'SIGNATURE' });
    });
    const d = dispatch(w, 'guided_brake');
    w.sys((c) => tick(c));
    assert.deepEqual([target(w, d, 'VEH-001').error, target(w, d, 'SIM-021').error], [FAULT_ERRORS.CHECKSUM, FAULT_ERRORS.SIGNATURE]);
    assert.deepEqual({ sim: w.s.resources['SIM-021']!.appliedConfigId, veh: w.s.resources['VEH-001']!.appliedConfigId }, before);
    // The fault lasts until it is cleared; then a new dispatch applies.
    w.sys((c) => {
      setAgent(c, 'VEH-001', { fault: 'NONE' });
      setAgent(c, 'SIM-021', { fault: 'NONE' });
    });
    const again = dispatch(w, 'guided_brake');
    w.sys((c) => tick(c));
    assert.equal(w.s.deployments[again]!.status, 'COMPLETED');
  });

  test('an interrupted apply restores the previous configuration; the failed attempt is never turned into a success', () => {
    const w = brakeWorld();
    const before = w.s.resources['VEH-001']!.appliedConfigId;
    w.sys((c) => setAgent(c, 'VEH-001', { fault: 'APPLY_INTERRUPTED' }));
    const d = dispatch(w, 'guided_brake');
    w.sys((c) => tick(c));
    assert.equal(target(w, d, 'VEH-001').error, FAULT_ERRORS.APPLY_INTERRUPTED);
    assert.equal(w.s.resources['VEH-001']!.appliedConfigId, before);
    w.fails('RECEIPT_CONFLICT', () => w.sys((c) => sendReceipt(c, d, 'VEH-001', 'APPLIED')));
  });

  test('a lost receipt: the vehicle runs the new configuration, the platform waits; resent, it is confirmed once', () => {
    const w = brakeWorld();
    const before = w.s.resources['VEH-001']!.appliedConfigId;
    w.sys((c) => setAgent(c, 'VEH-001', { fault: 'DROP_RECEIPT' }));
    const d = dispatch(w, 'guided_brake');
    const config = w.s.deployments[d]!.resolvedConfigId;
    w.sys((c) => tick(c));
    assert.equal(deliveryState(target(w, d, 'VEH-001')), 'PUSHED', 'the platform still waits for the receipt');
    assert.equal(w.s.resources['VEH-001']!.appliedConfigId, before, 'the platform records only what a receipt confirmed');
    assert.equal(w.s.devices['VEH-001']!.config, config, 'the vehicle runs what it applied');
    // The client reports what the vehicle really runs: the platform sees the difference.
    w.sys((c) => reportNow(c, 'VEH-001'));
    const view = clientReportView(w.s, w.actor('resource'), 'VEH-001', null)!;
    assert.equal(view.comparison!.configuration.same, false);
    // Still losing receipts: another step neither applies again nor sends.
    w.sys((c) => tick(c));
    assert.equal(w.s.devices['VEH-001']!.unsent.length, 1);
    w.sys((c) => setAgent(c, 'VEH-001', { fault: 'NONE' }));
    w.sys((c) => tick(c));
    assert.equal(target(w, d, 'VEH-001').status, 'APPLIED');
    assert.equal(w.s.resources['VEH-001']!.appliedConfigId, config);
    assert.equal(w.s.receipts.filter((r) => r.deploymentId === d && r.resourceId === 'VEH-001').length, 1, 'confirmed once');
    assert.deepEqual([w.s.devices['VEH-001']!.config, w.s.devices['VEH-001']!.unsent], [null, []]);
    assert.deepEqual(w.sys((c) => resendReceipts(c, 'VEH-001')), { sent: 0, waiting: 0 });
  });

  test('a receipt that arrives after the dispatch was cancelled is dropped; the vehicle keeps what it runs until a new dispatch', () => {
    const w = brakeWorld();
    w.sys((c) => setAgent(c, 'VEH-001', { fault: 'DROP_RECEIPT' }));
    const before = w.s.resources['VEH-001']!.appliedConfigId;
    const d = dispatch(w, 'guided_brake');
    w.sys((c) => tick(c));
    w.as('brake_tester', (c) => v.cancelDeployment(c, d, '回执未到，取消重来'));
    w.sys((c) => setAgent(c, 'VEH-001', { fault: 'NONE' }));
    w.sys((c) => tick(c));
    assert.deepEqual(w.s.devices['VEH-001']!.unsent, [], 'the platform moved on: the receipt is dropped');
    assert.equal(w.s.resources['VEH-001']!.appliedConfigId, before, 'a cancelled dispatch confirms nothing');
    assert.equal(w.s.devices['VEH-001']!.config, w.s.deployments[d]!.resolvedConfigId);
    const again = dispatch(w, 'guided_brake');
    w.sys((c) => tick(c));
    assert.equal(target(w, again, 'VEH-001').status, 'APPLIED');
    assert.equal(w.s.devices['VEH-001']!.config, null, 'the platform and the vehicle agree again');
  });

  test('a schema 14 save: fail-next becomes a lasting interrupted apply; devices gain empty receipts', () => {
    const s = JSON.parse(JSON.stringify(demoState())) as Record<string, any>;
    s.schema = 14;
    for (const r of Object.values(s.resources) as any[]) {
      r.agent.failNext = r.id === 'VEH-001';
      delete r.agent.fault;
    }
    for (const d of Object.values(s.devices) as any[]) {
      delete d.config;
      delete d.unsent;
    }
    const migrated = migrate(s)!;
    assert.equal(migrated.resources['VEH-001']!.agent.fault, 'APPLY_INTERRUPTED');
    assert.equal(migrated.resources['SIM-021']!.agent.fault, 'NONE');
    assert.ok(Object.values(migrated.resources).every((r) => !('failNext' in r.agent)));
    assert.ok(Object.values(migrated.devices).every((d) => d.config === null && d.unsent.length === 0));
  });
});
