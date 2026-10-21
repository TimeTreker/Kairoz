// 数据使用 · 售后与训练 (U01–U02) on the demo installation, as the brake developer 陈明.

import * as ev from '../src/engine/events.ts';
import { demoState } from '../src/engine/seed.ts';
import type { State } from '../src/engine/types.ts';
import type { SceneSpec } from './world.ts';

export const start = (): State => demoState();

export const scenes: Record<string, SceneSpec> = {
  U01: {
    run: (w) => {
      const me = w.actor('business');
      const byVehicle = ev.aftersalesQuery(w.s, me, 'team-brake', { vehicle: 'VEH-001' });
      w.check(byVehicle.length > 0, 'events of VEH-001 in the brake team');
      w.check(byVehicle.every((e) => e.resourceId === 'VEH-001' && e.vehicleModelId === 'X89' && e.groupId === 'brake'), 'vehicle, model, policy and event of this group only');
      const diag = ev.aftersalesQuery(w.s, me, 'team-brake', { event: '处理失败诊断' });
      w.check(diag.length > 0 && diag.every((e) => e.policyName.includes('处理失败诊断')), 'only the matching event');
      const failed = diag.find((e) => e.status === 'FAILED');
      if (!failed) throw new Error('a failed event to inspect');
      w.check(failed.failure?.startsWith('ParserFailure') && failed.files.every((f) => f.edgeStatus === 'UPLOADED' && f.cloudStatus === 'PARSER_FAILED'), 'files with edge and cloud status and the ParserFailure');
      w.check(w.s.policyVersions[failed.policyVersionId]?.policyId === failed.policyId, 'the policy version comes from the event snapshot');
      w.check(failed.files.every((f) => !('usedByCommits' in f)), 'files carry no “used by commits” field');
      w.eq(ev.aftersalesQuery(w.s, me, 'team-brake', { vehicle: 'VEH-002' }).length, 0, 'an unauthorized vehicle shows nothing');
      w.ref.failedEvent = failed.id;
    },
  },
  U02: {
    run: (w) => {
      const me = w.actor('business');
      const records = ev.trainingQuery(w.s, me, 'team-brake', { policy: 'brake.monitor', scenario: '急刹车', quality: 'A' });
      w.check(records.length > 0, 'selectable data for the scenario');
      for (const key of ['resourceId', 'vin', 'uvid', 'licensePlate', 'integrationVersion']) w.check(!(key in records[0]!), `no ${key} in training results`);
      const manifest = w.as('business', (c) => ev.exportManifest(c, records.map((r) => r.eventId)));
      const text = JSON.stringify(manifest);
      w.check(manifest.items.every((i) => i.policyId.includes('brake.monitor') && i.files.length > 0), 'events, policy, scenario and files in the manifest');
      w.check(!/VEH-|LSDEM/.test(text), 'no vehicle identity in the manifest');
      const all = ev.trainingQuery(w.s, me, 'team-brake', { availability: 'ALL' });
      const blocked = all.filter((r) => r.blockers.length > 0);
      w.check(blocked.some((r) => r.status === 'FAILED') && blocked.some((r) => r.quality === 'UNKNOWN' || r.trainingUse === 'UNCONFIRMED'), 'failed, unknown-quality and unconfirmed records show their reasons');
      w.fails('NOT_SELECTABLE', () => w.as('business', (c) => ev.exportManifest(c, [blocked[0]!.eventId])));
    },
  },
};
