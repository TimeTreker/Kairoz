// 整车软件版本变化 (VC01–VC06, N01) on the demo installation: vehicles report new whole-vehicle
// software; the team sees what it means for its files and policies and decides: confirm, fix,
// publish again or start a Feature on the new base. The simulator plays the cars and their OTA.

import * as ap from '../src/engine/applicability.ts';
import * as config from '../src/engine/config.ts';
import { decideEmergencyStop, requestEmergencyStop } from '../src/engine/emergency.ts';
import * as fleet from '../src/engine/fleet.ts';
import { setInEffect } from '../src/engine/release.ts';
import { demoState } from '../src/engine/seed.ts';
import * as sw from '../src/engine/sim-software.ts';
import { reportNow, simulateSoftwareOta } from '../src/engine/simulator.ts';
import * as sc from '../src/engine/software-change.ts';
import type { State } from '../src/engine/types.ts';
import * as v from '../src/engine/validation.ts';
import { answerAll, plmPublish } from './helpers.ts';
import type { SceneSpec, World } from './world.ts';

export const start = (): State => demoState();

const feature = (w: World, name: string) => Object.values(w.s.features).find((f) => f.name === name)!;
const set = (w: World, version: string) => Object.values(w.s.releases).find((r) => r.dclVersion === version)!;
const group = (w: World, name: string) => Object.values(w.s.vehicleGroups).find((g) => g.name === name)!.id;
const latest = (w: World, rid: string) => Object.values(w.s.softwareChanges).filter((c) => c.resourceId === rid).sort((a, b) => b.seq - a.seq)[0]!;
const assess = (w: World, rid: string) => sc.assessSoftwareChange(w.s, latest(w, rid).id);

/** The car is flashed outside the platform; its next signed report tells the platform. */
function ota(w: World, rid: string, version: string): void {
  w.sys((c) => simulateSoftwareOta(c, rid, version));
  w.sys((c) => reportNow(c, rid));
}

function publishBrake(w: World, commitId: string): void {
  const f = feature(w, 'brake_monitor');
  for (const d of w.as('brake_tester', (c) => v.dispatchFeature(c, f.id, { commitId, vehicleGroupIds: [group(w, '制动研发车组')] }))) answerAll(w, d);
}

export const scenes: Record<string, SceneSpec> = {
  VC01: {
    run: (w) => {
      const check = w.as('release', (c) => ap.openApplicabilityCheck(c, { releaseId: set(w, '1.0.0').id, version: '1.1' }));
      w.as('integration_admin', (c) => fleet.stopSimulation(c, 'SIM-101'));
      const change = w.as('integration_admin', (c) => sw.switchImage(c, 'SIM-101', 'x89-1.1-sim'));
      w.sys((c) => sw.answerImageChange(c, change, 'APPLIED'));
      w.as('integration_admin', (c) => fleet.startSimulation(c, 'SIM-101'));
      w.as('resource', (c) => fleet.confirmIntegration(c, 'VEH-031', { version: '1.1', source: 'DIP 上报' }));
      answerAll(w, w.as('integration_tester', (c) => ap.dispatchApplicability(c, check, { vehicleGroupIds: [group(w, 'X89 集成测试车组')] })));
      for (const r of ['SIM-101', 'VEH-031']) w.as('integration_tester', (c) => ap.recordApplicabilityTest(c, check, { resourceId: r, result: 'PASS', summary: '1.1 采集回归通过' }));
      w.as('integration_tester', (c) => ap.verifyApplicability(c, check));
      w.as('release', (c) => ap.confirmApplicability(c, check, { note: '1.1 与 1.0 采集一致' }));
      w.eq(setInEffect(w.s, 'X89', '1.1')?.dclVersion, '1.0.0', 'policy set 1.0.0 now serves 1.0 and 1.1');
    },
  },
  VC02: {
    needs: ['VC01'],
    run: (w) => {
      ota(w, 'VEH-001', '1.1');
      const c = latest(w, 'VEH-001');
      w.eq([w.s.resources['VEH-001']!.integrationVersion, c.fromVersion, c.toVersion, c.source], ['1.1', '1.0', '1.1', 'CLIENT_REPORT'], 'learned from the signed report');
      const a = assess(w, 'VEH-001');
      w.eq([a.outcome, a.baseChanged], ['NONE', false], 'same set, files and policies OK: nothing to change');
      w.eq(sc.softwareChangesFor(w.s, w.actor('business'), 'team-brake').map((x) => x.id), [c.id], 'the brake team is told');
      w.as('business', (x) => sc.acknowledgeSoftwareChange(x, c.id));
      w.eq(feature(w, 'brake_monitor').stage, 'VERIFIED', 'no branch, nothing republished');
      const car = v.featureTestStatus(w.s, feature(w, 'brake_monitor')).find((t) => t.resourceId === 'VEH-001')!;
      w.eq([car.latest?.result, car.latest?.integrationVersion], ['PASS', '1.0'], 'the result from 1.0 still counts');
    },
  },
  VC03: {
    needs: ['VC02'],
    run: (w) => {
      ota(w, 'VEH-001', '1.3');
      const u = latest(w, 'VEH-001');
      w.eq([u.status, w.s.resources['VEH-001']!.integrationVersion], ['UNRECORDED', '1.1'], 'an unknown version waits; the record stays');
      w.eq(sc.unrecordedReports(w.s, w.actor('resource')).map((x) => x.id), [u.id], 'vehicle resources get the to-do');
      const base = w.s.softwareVersions['X89::1.0']!.manifest!;
      const manifest = { signals: base.signals, sources: [...base.sources.filter((s) => !(s.unit === 'ADC' && s.directory === '/var/log')), { unit: 'ADC', directory: '/var/log/chassis' }] };
      plmPublish(w.engine, 'X89', '1.3', { manifest });
      w.as('resource', (c) => fleet.confirmIntegration(c, 'VEH-001', { version: '1.3', source: '客户端上报' }));
      w.eq(w.s.softwareChanges[u.id]!.status, 'RESOLVED', 'the report is resolved');
      const a = assess(w, 'VEH-001');
      w.eq(a.outcome, 'NO_BASE', 'no policy set applies to 1.3');
      w.eq(a.files.map((f) => [f.name, f.status]), [['制动监测日志', 'SOURCE_MISSING']], 'level 1: the log directory is gone');
      w.eq(a.policies.map((p) => [p.policyId, p.status]), [['chassis.brake.failure_diag', 'MISSING'], ['chassis.brake.monitor', 'MISSING']], 'level 2: both policies capture it');
    },
  },
  VC04: {
    needs: ['VC03'],
    run: (w) => {
      w.as('workspace_manager', (c) => fleet.setGroupBase(c, group(w, '制动研发车组'), set(w, '1.0.0').id));
      const change = latest(w, 'VEH-001').id;
      w.eq(sc.assessSoftwareChange(w.s, change).outcome, 'FIX', 'with an explicit base the team must fix its files and policies');
      const f = feature(w, 'brake_monitor');
      const old = Object.keys(f.draft.files)[0]!;
      const moved = w.as('business', (c) =>
        config.addFile(c, f.id, { source: { unit: 'ADC', directory: '/var/log/chassis/brake', pattern: 'monitor.log' }, name: '制动监测日志（新路径）', purpose: '急刹车与故障诊断' }),
      );
      for (const [id, p] of Object.entries(feature(w, 'brake_monitor').draft.policies)) w.as('business', (c) => config.putPolicy(c, f.id, id, { ...p, captures: [moved] }));
      w.as('business', (c) => config.removeFile(c, f.id, old));
      const commitId = w.as('business', (c) => config.submitFeature(c, f.id, { message: '日志目录随 1.3 迁移' })).commitId;
      publishBrake(w, commitId);
      w.eq(sc.assessSoftwareChange(w.s, change).outcome, 'NONE', 'after the fix and the publish nothing is left');
      w.as('business', (c) => sc.acknowledgeSoftwareChange(c, change));
      w.ref.r002 = commitId;
    },
  },
  VC05: {
    needs: ['VC04'],
    run: (w) => {
      const stop = w.as('dcl', (c) => requestEmergencyStop(c, { releaseId: set(w, '1.0.0').id, policyId: 'chassis.steering.angle_jump', reason: '误触发过多' }));
      w.as('release', (c) => decideEmergencyStop(c, stop, { decision: 'APPROVED', note: '同意' }));
      w.as('workspace_manager', (c) => fleet.setGroupBase(c, group(w, '制动研发车组'), null));
      ota(w, 'VEH-001', '1.1');
      const a = assess(w, 'VEH-001');
      w.eq([a.outcome, a.runningBaseId, a.newBaseId, a.changedGroups], ['REPUBLISH', set(w, '1.0.0').id, set(w, '1.0.1').id, ['chassis.steering']], 'the base changed, not the brake content');
      publishBrake(w, w.ref.r002!);
      w.eq(sc.assessSoftwareChange(w.s, a.change.id).outcome, 'NONE', 'published again on the new base');
      w.as('brake_tester', (c) => sc.acknowledgeSoftwareChange(c, a.change.id));
    },
  },
  VC06: {
    needs: ['VC05'],
    run: (w) => {
      ota(w, 'VEH-003', '1.1');
      const a = assess(w, 'VEH-003');
      w.eq([a.outcome, a.conflict, a.newBaseId], ['NEW_FEATURE', true, set(w, '1.0.1').id], 'the new base changed the steering group');
      w.eq(sc.softwareChangesFor(w.s, w.actor('steering'), 'team-steering').map((x) => x.id), [a.change.id], 'the steering team is told');
      const f2 = w.as('steering', (c) => config.createFeature(c, { workspaceId: 'team-steering', groupId: 'steering', name: 'steering_return_rate_v2', baseReleaseId: set(w, '1.0.1').id }));
      w.eq(w.s.features[f2]!.baseReleaseId, set(w, '1.0.1').id, 'a Feature on the new base');
      w.check(!('chassis.steering.angle_jump' in w.s.features[f2]!.draft.policies), 'it starts without the stopped policy');
      w.as('steering', (c) => sc.acknowledgeSoftwareChange(c, a.change.id));
    },
  },
  N01: {
    needs: ['VC06'],
    run: (w) => {
      w.denied('steering', (c) => sc.acknowledgeSoftwareChange(c, latest(w, 'VEH-001').id));
      ota(w, 'VEH-201', '1.1');
      w.eq(assess(w, 'VEH-201').outcome, 'PRODUCTION', 'production cars follow the set in effect');
      w.eq(sc.softwareChangesFor(w.s, w.actor('release'), 'x89-project'), [], 'no team notice for production');
      w.fails('SIMULATION_SOFTWARE_FROM_IMAGE', () => w.sys((c) => simulateSoftwareOta(c, 'SIM-021', '1.1')));
    },
  },
};
