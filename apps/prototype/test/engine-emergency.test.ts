import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { answerAll } from '../acceptance/helpers.ts';
import { World } from '../acceptance/world.ts';
import { decideEmergencyStop, requestEmergencyStop } from '../src/engine/emergency.ts';
import { capturablePolicies } from '../src/engine/events.ts';
import * as integ from '../src/engine/integration.ts';
import { createOta } from '../src/engine/ota.ts';
import * as rel from '../src/engine/release.ts';
import { demoState } from '../src/engine/seed.ts';
import * as v from '../src/engine/validation.ts';

const groupId = (w: World, name: string) => Object.values(w.s.vehicleGroups).find((g) => g.name === name)!.id;
const set = (w: World, version: string) => Object.values(w.s.releases).find((r) => r.dclVersion === version)!;

/** steering_return_rate integrated as policy set 1.0.1 for software 1.0: angle_jump and return_rate. */
function promoteNext(w: World): void {
  const steering = Object.values(w.s.features).find((f) => f.name === 'steering_return_rate')!;
  const plan = w.as('integrator', (c) => integ.previewMerge(c, { workspaceId: 'x89-project', featureIds: [steering.id] }));
  w.as('dcl', (c) => integ.confirmProcessing(c, plan, { note: '' }));
  const cand = w.as('integrator', (c) => integ.freezeCandidate(c, plan, { label: 'X89-C2' }));
  answerAll(w, w.as('integration_tester', (c) => v.dispatchCandidate(c, cand, { vehicleGroupIds: [groupId(w, 'X89 集成测试车组')] })));
  for (const r of ['SIM-101', 'VEH-031']) w.as('integration_tester', (c) => v.recordCandidateTest(c, cand, { resourceId: r, result: 'PASS', summary: 'ok' }));
  w.as('integration_tester', (c) => v.verifyCandidate(c, cand));
  w.as('release', (c) => rel.promoteCandidate(c, cand, { dclVersion: '1.0.1', vehicleIntegrationVersions: ['1.0'] }));
}

describe('emergency stop of one policy', () => {
  test('one person asks, another decides; the new set drops the policy for the versions the source served', () => {
    const w = new World(demoState());
    promoteNext(w);
    const source = set(w, '1.0.1');

    // Release can ask, but never decide its own request.
    const own = w.as('release', (c) => requestEmergencyStop(c, { releaseId: source.id, policyId: 'chassis.steering.return_rate', reason: '回正策略误触发' }));
    w.fails('SELF_APPROVAL', () => w.as('release', (c) => decideEmergencyStop(c, own, { decision: 'APPROVED', note: '自批' })));

    // Only a set in effect can be stopped; a policy must be in the set; one open request per policy.
    w.fails('SET_NOT_IN_EFFECT', () => w.as('dcl', (c) => requestEmergencyStop(c, { releaseId: set(w, '1.0.0').id, policyId: 'chassis.steering.angle_jump', reason: 'x' })));
    w.fails('POLICY_NOT_IN_SET', () => w.as('dcl', (c) => requestEmergencyStop(c, { releaseId: source.id, policyId: 'chassis.brake.monitor', reason: 'x' })));
    w.denied('business', (c) => requestEmergencyStop(c, { releaseId: source.id, policyId: 'chassis.steering.angle_jump', reason: 'x' }));
    const stop = w.as('dcl', (c) => requestEmergencyStop(c, { releaseId: source.id, policyId: 'chassis.steering.angle_jump', reason: '转角突变策略占满上传带宽' }));
    w.fails('STOP_PENDING', () => w.as('release', (c) => requestEmergencyStop(c, { releaseId: source.id, policyId: 'chassis.steering.angle_jump', reason: 'again' })));
    w.denied('dcl', (c) => decideEmergencyStop(c, stop, { decision: 'APPROVED', note: '同意' }));

    const id = w.as('release', (c) => decideEmergencyStop(c, stop, { decision: 'APPROVED', note: '值班批准紧急停用' }))!;
    const next = w.s.releases[id]!;
    assert.equal(next.dclVersion, '1.0.2');
    assert.deepEqual(next.vehicleIntegrationVersions, ['1.0']);
    assert.deepEqual(next.emergency, { stopId: stop, sourceReleaseId: source.id, policyId: 'chassis.steering.angle_jump' });
    assert.equal(next.candidateId, null);
    const steering = w.s.commits[next.groups['steering']!]!;
    assert.deepEqual(Object.keys(steering.policies), ['chassis.steering.return_rate']);
    assert.equal(steering.parentCommitId, source.groups['steering']);
    assert.equal(w.s.emergencyStops[stop]!.status, 'APPROVED');
    assert.equal(rel.setInEffect(w.s, 'X89', '1.0')!.id, id);
    assert.deepEqual(rel.releaseDiff(w.s, source.id, id).policies.map((p) => [p.policyId, p.from, p.to]), [['chassis.steering.angle_jump', 2, null]]);

    // It reaches vehicles only by configuration OTA, like any set.
    assert.notEqual(w.s.resources['VEH-201']!.appliedConfigId, next.resolvedConfigId);
    answerAll(w, w.as('release', (c) => createOta(c, { releaseId: id, vehicleGroupIds: [groupId(w, 'X89 量产车组')], firstWave: 'ALL' })));
    assert.deepEqual(capturablePolicies(w.s, 'VEH-201').map((p) => p.policyId), ['chassis.steering.return_rate']);
  });
});
