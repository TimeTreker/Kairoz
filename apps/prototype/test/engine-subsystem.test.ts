import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { simpleFeature, verifyFeatureOn } from '../acceptance/helpers.ts';
import { World } from '../acceptance/world.ts';
import { commitSnapshot } from '../src/engine/snapshots.ts';
import * as integ from '../src/engine/integration.ts';
import * as rel from '../src/engine/release.ts';
import { demoState } from '../src/engine/seed.ts';
import { sendReceipt } from '../src/engine/simulator.ts';
import { createAccount, replaceGrants } from '../src/engine/identity.ts';
import { updateWorkspace } from '../src/engine/org.ts';
import type { Env } from '../src/domain/vocabulary.ts';
import * as v from '../src/engine/validation.ts';

const groupId = (w: World, name: string) => Object.values(w.s.vehicleGroups).find((g) => g.name === name)!.id;

/** A Verified Feature of an ADC or CDC team: one text log and one policy. */
function verified(w: World, team: 'adc-parking' | 'adc-system' | 'cdc-hmi', name: string, policy: string, post = 20): string {
  const t = {
    'adc-parking': { dev: 'adc_parking', tester: 'adc_parking_tester', code: 'adc.parking', unit: 'ADC', vg: '泊车研发车组' },
    'adc-system': { dev: 'adc_system', tester: 'adc_system_tester', code: 'adc.system', unit: 'ADC', vg: '系统应用研发车组' },
    'cdc-hmi': { dev: 'cdc_hmi', tester: 'cdc_hmi_tester', code: 'cdc.hmi', unit: 'CDC', vg: 'HMI 研发车组' },
  }[team];
  const { featureId } = simpleFeature(w, t.dev, {
    workspaceId: `team-${team}`,
    groupId: team,
    name,
    unit: t.unit,
    directory: `/data/${team}`,
    pattern: `${name}.log`,
    fileName: `${name} 日志`,
    policyId: `${t.code}.${policy}`,
    policyName: name,
    trigger: 'vehicle_speed > 10',
    post,
  });
  verifyFeatureOn(w, t.tester, featureId, [groupId(w, t.vg)]);
  return featureId;
}

/** A domain merge through publication: preview, DCL confirmation, freeze, domain test, publish. */
function publishDomain(w: World, domain: 'ADC' | 'CDC', featureIds: string[]): string {
  const ws = `x89-${domain.toLowerCase()}-integration`;
  const integrator = `${domain.toLowerCase()}_integrator`;
  const plan = w.as(integrator, (c) => integ.previewMerge(c, { workspaceId: ws, featureIds }));
  assert.equal(w.s.mergePlans[plan]!.status, 'READY', JSON.stringify(w.s.mergePlans[plan]!.issues));
  w.as('dcl', (c) => integ.confirmProcessing(c, plan, { note: `${domain} 处理集合` }));
  const cand = w.as(integrator, (c) => integ.freezeCandidate(c, plan, { label: `${domain}-C${Object.keys(w.s.candidates).length}` }));
  const d = w.as(integrator, (c) => v.dispatchCandidate(c, cand, { vehicleGroupIds: [groupId(w, `${domain} 域集成测试车组`)] }));
  const vehicles = w.s.deployments[d]!.targets.map((t) => t.resourceId).sort((a, b) => (a.startsWith('SIM') ? -1 : b.startsWith('SIM') ? 1 : 0));
  for (const r of vehicles) w.sys((c) => sendReceipt(c, d, r, 'APPLIED'));
  for (const r of vehicles) w.as(integrator, (c) => v.recordCandidateTest(c, cand, { resourceId: r, result: 'PASS', summary: '子系统回归' }));
  w.as(integrator, (c) => v.verifyCandidate(c, cand));
  return w.as(integrator, (c) => integ.publishSubsystem(c, cand, { notes: `${domain} 子系统` }));
}

describe('subsystem integration', () => {
  test('a domain merge takes only its domain’s Features, and is tested in its own workspace', () => {
    const w = new World(demoState());
    const parking = verified(w, 'adc-parking', 'parking_one', 'p1');
    const hmi = verified(w, 'cdc-hmi', 'hmi_one', 'h1');
    assert.deepEqual(
      integ.verifiedSources(w.s, 'x89-adc-integration').map((f) => f.id),
      [parking],
    );
    // The CDC Feature is not even among the ADC workspace's sources.
    w.fails('SOURCE_NOT_ALLOWED', () => w.as('adc_integrator', (c) => integ.previewMerge(c, { workspaceId: 'x89-adc-integration', featureIds: [hmi] })));
    // The whole vehicle cannot collect ADC Features directly any more.
    assert.equal(integ.verifiedSources(w.s, 'x89-project').some((f) => f.id === parking), false);
    // An account with a domain scope gets nothing from a Vehicle merge, and the other way round.
    w.denied('adc_integrator', (c) => integ.previewMerge(c, { workspaceId: 'x89-adc-integration', featureIds: [parking], scope: 'CDC' }));
    const ss = publishDomain(w, 'ADC', [parking]);
    const r = w.s.subsystemReleases[ss]!;
    assert.equal(r.label, 'ADC-S1');
    assert.equal(w.s.candidates[r.candidateId]!.testWorkspaceId, 'x89-adc-integration');
    assert.deepEqual(Object.keys(r.groups), ['adc-parking']);
    assert.deepEqual(r.features.map((f) => f.featureId), [parking]);
  });

  test('a merge scope must be one the workspace integrates', () => {
    const w = new World(demoState());
    w.as('admin', (c) =>
      createAccount(c, { username: 'cdc_in_adc', displayName: '临时', grants: [{ role: 'CONFIG_INTEGRATOR', workspaces: ['x89-adc-integration'], groups: [], scopes: ['CDC'], envs: ['testing'], dispatchOnly: false }] }),
    );
    w.fails('SCOPE_OUTSIDE_WORKSPACE', () => w.as('cdc_in_adc', (c) => integ.previewMerge(c, { workspaceId: 'x89-adc-integration', featureIds: [], scope: 'CDC' })));
  });

  test('a cross-domain Feature is refused by name', () => {
    const w = new World(demoState());
    // Give the ADC workspace a CDC team as source too, so the Feature is reachable but outside the domain.
    w.as('admin', (c) => updateWorkspace(c, 'x89-adc-integration', { sourceWorkspaceIds: ['team-adc-parking', 'team-adc-system', 'team-cdc-hmi'] }));
    const hmi = verified(w, 'cdc-hmi', 'hmi_one', 'h1');
    w.fails('CROSS_DOMAIN_SOURCE', () => w.as('adc_integrator', (c) => integ.previewMerge(c, { workspaceId: 'x89-adc-integration', featureIds: [hmi] })));
  });

  test('publishing never touches releases: no DCL version, no production target, no new baseline', () => {
    const w = new World(demoState());
    const before = { latest: integ.latestRelease(w.s, 'X89')!.id, next: rel.nextDclVersion(w.s, 'X89'), releases: Object.keys(w.s.releases).length };
    const ss = publishDomain(w, 'ADC', [verified(w, 'adc-parking', 'parking_one', 'p1')]);
    assert.deepEqual({ latest: integ.latestRelease(w.s, 'X89')!.id, next: rel.nextDclVersion(w.s, 'X89'), releases: Object.keys(w.s.releases).length }, before);
    assert.equal(rel.releaseFor(w.s, w.s.resources['VEH-201']!).release?.id, before.latest, 'production still resolves to the formal release');
    // Neither the release account nor the domain account can promote a subsystem candidate.
    const cand = w.s.subsystemReleases[ss]!.candidateId;
    w.fails('SUBSYSTEM_CANDIDATE', () => w.as('release', (c) => rel.promoteCandidate(c, cand, { dclVersion: '1.1.0', vehicleIntegrationVersions: ['1.0'] })));
    w.fails('SUBSYSTEM_CANDIDATE', () => w.as('adc_integrator', (c) => rel.promoteCandidate(c, cand, { dclVersion: '1.1.0', vehicleIntegrationVersions: ['1.0'] })));
  });

  test('a domain release grant, even in the project and in production, cannot promote the whole vehicle', () => {
    const w = new World(demoState());
    const ss = publishDomain(w, 'ADC', [verified(w, 'adc-parking', 'parking_one', 'p1')]);
    const grants = w.s.accounts['adc_integrator']!.grants.map((g) => ({
      role: g.role,
      workspaces: g.role === 'CONFIG_RELEASE' ? [...g.workspaces, 'x89-project'] : g.workspaces,
      groups: g.groups,
      scopes: g.scopes,
      envs: g.role === 'CONFIG_RELEASE' ? (['development', 'testing', 'production'] as Env[]) : g.envs,
      dispatchOnly: g.dispatchOnly,
    }));
    w.as('admin', (c) => replaceGrants(c, 'adc_integrator', grants));
    const plan = w.as('integrator', (c) => integ.previewMerge(c, { workspaceId: 'x89-project', featureIds: [], subsystemReleaseIds: [ss] }));
    w.as('dcl', (c) => integ.confirmProcessing(c, plan, { note: '整车' }));
    const cand = w.as('integrator', (c) => integ.freezeCandidate(c, plan, { label: 'X89-C2' }));
    // The candidate is whole-vehicle; the grant's scope is ADC, so no single grant covers it.
    w.denied('adc_integrator', (c) => rel.promoteCandidate(c, cand, { dclVersion: '1.1.0', vehicleIntegrationVersions: ['1.0'] }));
    // The release account cannot publish a subsystem: its grant is not in the domain workspace.
    w.denied('release', (c) => integ.publishSubsystem(c, w.s.subsystemReleases[ss]!.candidateId));
  });

  test('a later subsystem release contains the earlier one', () => {
    const w = new World(demoState());
    const s1 = publishDomain(w, 'ADC', [verified(w, 'adc-parking', 'parking_one', 'p1')]);
    const s2 = publishDomain(w, 'ADC', [verified(w, 'adc-system', 'system_one', 's1')]);
    const r2 = w.s.subsystemReleases[s2]!;
    assert.equal(w.s.subsystemReleases[s1]!.status, 'SUPERSEDED');
    assert.equal(r2.label, 'ADC-S2');
    assert.equal(r2.supersedesId, s1);
    assert.deepEqual(Object.keys(r2.groups).sort(), ['adc-parking', 'adc-system']);
    assert.equal(r2.features.length, 2);
    assert.ok(commitSnapshot(w.s, r2.groups['adc-parking']!).policies['adc.parking.p1'], 'S1’s policy is in S2');
  });

  test('the whole vehicle merges subsystem releases with chassis Features and releases them', () => {
    const w = new World(demoState());
    const adc = publishDomain(w, 'ADC', [verified(w, 'adc-parking', 'parking_one', 'p1')]);
    const cdc = publishDomain(w, 'CDC', [verified(w, 'cdc-hmi', 'hmi_one', 'h1')]);
    assert.deepEqual(integ.collectibleSubsystems(w.s, 'x89-project').map((r) => r.label), ['ADC-S1', 'CDC-S1']);
    const steering = Object.values(w.s.features).find((f) => f.name === 'steering_return_rate')!.id;
    const plan = w.as('integrator', (c) => integ.previewMerge(c, { workspaceId: 'x89-project', featureIds: [steering], subsystemReleaseIds: [adc, cdc] }));
    const p = w.s.mergePlans[plan]!;
    assert.equal(p.status, 'READY', JSON.stringify(p.issues));
    assert.deepEqual(Object.keys(p.merged).sort(), ['adc-parking', 'cdc-hmi', 'steering']);
    w.as('dcl', (c) => integ.confirmProcessing(c, plan, { note: '整车' }));
    const cand = w.as('integrator', (c) => integ.freezeCandidate(c, plan, { label: 'X89-C2' }));
    // Unchanged subsystem content keeps the subsystem's commits.
    assert.equal(w.s.candidates[cand]!.groups['adc-parking'], w.s.subsystemReleases[adc]!.groups['adc-parking']);
    assert.equal(w.s.subsystemReleases[adc]!.status, 'INTEGRATING');
    assert.deepEqual(integ.collectibleSubsystems(w.s, 'x89-project'), [], 'an open candidate takes them out of collection');
    // Cancelling gives them back.
    w.as('integrator', (c) => integ.cancelCandidate(c, cand, { reason: '重来' }));
    assert.equal(w.s.subsystemReleases[adc]!.status, 'ACTIVE');
  });

  test('promoting the whole vehicle closes the subsystem releases and archives their Features', () => {
    const w = new World(demoState());
    const parking = verified(w, 'adc-parking', 'parking_one', 'p1');
    const adc = publishDomain(w, 'ADC', [parking]);
    const plan = w.as('integrator', (c) => integ.previewMerge(c, { workspaceId: 'x89-project', featureIds: [], subsystemReleaseIds: [adc] }));
    w.as('dcl', (c) => integ.confirmProcessing(c, plan, { note: '整车' }));
    const cand = w.as('integrator', (c) => integ.freezeCandidate(c, plan, { label: 'X89-C2' }));
    const vg = groupId(w, 'X89 集成测试车组');
    const d = w.as('integration_tester', (c) => v.dispatchCandidate(c, cand, { vehicleGroupIds: [vg] }));
    for (const r of ['SIM-101', 'VEH-031']) w.sys((c) => sendReceipt(c, d, r, 'APPLIED'));
    for (const r of ['SIM-101', 'VEH-031']) w.as('integration_tester', (c) => v.recordCandidateTest(c, cand, { resourceId: r, result: 'PASS', summary: '整车回归' }));
    w.as('integration_tester', (c) => v.verifyCandidate(c, cand));
    w.as('release', (c) => rel.promoteCandidate(c, cand, { dclVersion: '1.1.0', vehicleIntegrationVersions: ['1.0'] }));
    assert.equal(w.s.subsystemReleases[adc]!.status, 'INTEGRATED');
    assert.equal(w.s.features[parking]!.stage, 'ARCHIVED');
    assert.equal(integ.latestRelease(w.s, 'X89')!.dclVersion, '1.1.0');
  });
});
