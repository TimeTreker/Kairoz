// 多车型独立发布 (MM01–MM08, N01) on the demo installation: a second vehicle model, X90, gets its own
// project, team workspace, vehicles and software, starts from its own empty initial configuration,
// and integrates, tests, releases and rolls out its own policy set 1.0.0 for its own software 1.0,
// while X89's 1.0, its sets, vehicles and history stay exactly as they were.

import { createAccount } from '../src/engine/identity.ts';
import * as fleet from '../src/engine/fleet.ts';
import { versionHistory } from '../src/engine/history.ts';
import * as integ from '../src/engine/integration.ts';
import { createOrgUnit, createProject, createWorkspace } from '../src/engine/org.ts';
import * as ota from '../src/engine/ota.ts';
import * as rel from '../src/engine/release.ts';
import { demoState } from '../src/engine/seed.ts';
import { sendReceipt } from '../src/engine/simulator.ts';
import type { State } from '../src/engine/types.ts';
import * as v from '../src/engine/validation.ts';
import { answerAll, carRuns, plmPublish, simpleFeature, tspCar, verifyFeatureOn } from './helpers.ts';
import type { SceneSpec, World } from './world.ts';

export const start = (): State => demoState();

const DEV_TEST = ['development', 'testing'] as const;
const releasesOf = (w: World, model: string) => rel.releasesOf(w.s, model).map((r) => r.dclVersion).sort();
const grant = (role: string, workspaces: string[], extra: { groups?: string[]; scopes?: string[]; envs?: readonly string[] } = {}) =>
  ({ role, workspaces, groups: extra.groups ?? [], scopes: extra.scopes ?? [], envs: [...(extra.envs ?? DEV_TEST)], dispatchOnly: false }) as never;
/** What X89 looks like from the outside: its sets, the set in effect for each version, its vehicles' configurations. */
const x89Picture = (w: World) =>
  JSON.stringify({
    sets: rel.releasesOf(w.s, 'X89').map((r) => [r.dclVersion, rel.applicableVersions(w.s, r)]),
    inEffect: ['1.0', '1.1'].map((v) => rel.setInEffect(w.s, 'X89', v)?.dclVersion ?? null),
    vehicles: Object.values(w.s.resources).filter((r) => r.vehicleModelId === 'X89').map((r) => [r.id, r.integrationVersion, r.appliedConfigId]),
    history: versionHistory(w.s, 'X89', '1.0').map((e) => [e.kind, e.at]),
  });

export const scenes: Record<string, SceneSpec> = {
  MM01: {
    run: (w) => {
      w.ref.x89 = x89Picture(w);
      w.eq(releasesOf(w, 'X90'), [], 'X90 has no policy set yet');
      w.as('admin', (c) => createProject(c, { id: 'x90', name: 'X90 项目', vehicleModelId: 'X90' }));
      w.as('admin', (c) => createOrgUnit(c, { id: 'x90-integration-test', name: 'X90 集成测试组', parentId: 'x90' }));
      w.as('admin', (c) =>
        createWorkspace(c, { id: 'team-brake-x90', name: '制动团队 X90 工作区', kind: 'TEAM', orgUnitId: 'brake-team', vehicleModelId: 'X90', groupIds: ['brake'], scopes: ['Chassis'], sourceWorkspaceIds: [] }),
      );
      w.as('admin', (c) =>
        createWorkspace(c, { id: 'x90-project', name: 'X90 项目研发', kind: 'PROJECT', orgUnitId: 'x90', vehicleModelId: 'X90', groupIds: ['brake'], scopes: ['Vehicle', 'Chassis'], sourceWorkspaceIds: ['team-brake-x90'] }),
      );
      w.as('admin', (c) =>
        createWorkspace(c, { id: 'x90-integration', name: 'X90 集成测试', kind: 'INTEGRATION', orgUnitId: 'x90-integration-test', vehicleModelId: 'X90', groupIds: [], scopes: ['Vehicle'], sourceWorkspaceIds: ['x90-project'] }),
      );
      w.eq([w.s.workspaces['team-brake-x90']!.vehicleModelId, w.s.workspaces['x90-project']!.vehicleModelId], ['X90', 'X90'], 'the workspaces show their model');
      for (const [username, name, grants] of [
        ['x90_business', '许晨', [grant('BUSINESS_DEV', ['team-brake-x90'], { groups: ['brake'] })]],
        ['x90_tester', '许测', [grant('BUSINESS_TEST', ['team-brake-x90'], { groups: ['brake'] })]],
        ['x90_admin', '许管', [grant('WORKSPACE_ADMIN', ['team-brake-x90', 'x90-project', 'x90-integration'], { envs: ['development', 'testing', 'production'] })]],
        ['x90_integrator', '许集', [grant('CONFIG_INTEGRATOR', ['x90-project', 'x90-integration'], { scopes: ['Vehicle'] })]],
        ['x90_integration_tester', '许验', [grant('INTEGRATION_TEST', ['x90-integration'], { scopes: ['Vehicle'], envs: ['testing'] })]],
        ['x90_release', '许发', [grant('CONFIG_RELEASE', ['x90-project', 'x90-integration'], { scopes: ['Vehicle'], envs: ['development', 'testing', 'production'] })]],
      ] as const) {
        w.as('admin', (c) => createAccount(c, { username, displayName: name, grants: [...grants] }));
      }
    },
  },
  MM02: {
    needs: ['MM01'],
    run: (w) => {
      // X90's own software and images; its first physical car's software is still unknown.
      plmPublish(w.engine, 'X90', '1.0');
      w.check(w.s.softwareVersions['X90::1.0'] && w.s.softwareVersions['X89::1.0'], 'X90 1.0 and X89 1.0 are two versions');
      w.as('dcl', (c) => fleet.registerImage(c, { id: 'x90-dev-sim', vehicleModelId: 'X90', integrationVersion: null, build: 'x90-dev', digest: 'sha256:mock-x90-dev', simulator: 'SimOne 3' }));
      w.as('dcl', (c) => fleet.registerImage(c, { id: 'x90-1.0-sim', vehicleModelId: 'X90', integrationVersion: '1.0', build: 'x90-1.0.0', digest: 'sha256:mock-x90-1-0', simulator: 'SimOne 3' }));
      w.as('x90_admin', (c) => fleet.createSimulation(c, { id: 'SIM-901', workspaceId: 'team-brake-x90', imageId: 'x90-dev-sim', env: 'development', pool: 'Chassis' }));
      tspCar(w.engine, 'LSDEMX90000000901', 'X90');
      w.as('resource', (c) => fleet.registerPhysical(c, { id: 'VEH-901', vin: 'LSDEMX90000000901', vehicleModelId: 'X90', env: 'development', pool: 'Chassis' }));
      w.eq(w.s.resources['VEH-901']!.integrationVersion, null, 'the first X90 car starts with unknown software');
      w.as('x90_admin', (c) => fleet.addWorkspaceVehicle(c, 'team-brake-x90', 'VEH-901'));
      w.ref.devGroup = w.as('x90_admin', (c) => fleet.createVehicleGroup(c, { workspaceId: 'team-brake-x90', groupId: 'brake', name: 'X90 制动研发车组', purpose: 'DEV', env: 'development' }));
      for (const r of ['SIM-901', 'VEH-901']) w.as('x90_admin', (c) => fleet.addGroupMember(c, w.ref.devGroup!, r, 'X90 首车研发'));
      w.fails('IMAGE_MODEL_MISMATCH', () => w.as('x90_admin', (c) => fleet.createSimulation(c, { id: 'SIM-902', workspaceId: 'team-brake-x90', imageId: 'x89-1.0-sim', env: 'development', pool: 'Chassis' })));
    },
  },
  MM03: {
    needs: ['MM02'],
    run: (w) => {
      // The first X90 Feature starts on X90's empty initial configuration, not on any X89 set.
      const f = simpleFeature(w, 'x90_business', {
        workspaceId: 'team-brake-x90',
        groupId: 'brake',
        name: 'x90_brake_first',
        unit: 'CHASSIS',
        directory: '/var/log/x90',
        pattern: 'brake.log',
        fileName: 'X90 制动日志',
        policyId: 'chassis.brake.x90_hard',
        policyName: 'X90 急刹车',
        trigger: 'brake_pressure > 85',
      });
      w.ref.feature = f.featureId;
      w.eq(w.s.features[f.featureId]!.baseReleaseId, null, 'it builds on X90’s initial configuration');
      w.eq(w.s.features[f.featureId]!.stage, 'DCL_READY', 'ordinary content is ready to test at once');
      // Both kinds of test: simulation first, then the physical car of unknown software.
      verifyFeatureOn(w, 'x90_tester', f.featureId, [w.ref.devGroup!]);
      w.eq(w.s.features[f.featureId]!.stage, 'VERIFIED', 'simulation and physical tests passed');
    },
  },
  MM04: {
    needs: ['MM03'],
    run: (w) => {
      const sources = integ.verifiedSources(w.s, 'x90-project', 'Vehicle').map((f) => f.name);
      w.eq(sources, ['x90_brake_first'], 'only X90 Features can be collected for X90');
      w.fails('SOURCE_NOT_ALLOWED', () => w.as('x90_integrator', (c) => integ.previewMerge(c, { workspaceId: 'x90-project', featureIds: [Object.values(w.s.features).find((f) => f.name === 'brake_monitor')!.id] })));
      const plan = w.as('x90_integrator', (c) => integ.previewMerge(c, { workspaceId: 'x90-project', featureIds: [w.ref.feature!] }));
      w.eq(w.s.mergePlans[plan]!.targetReleaseId, null, 'X90’s first integration targets its initial configuration');
      w.as('dcl', (c) => integ.confirmProcessing(c, plan, { note: 'X90 首次集成' }));
      w.ref.candidate = w.as('x90_integrator', (c) => integ.freezeCandidate(c, plan, { label: 'X90-C1' }));
      w.eq(w.s.candidates[w.ref.candidate!]!.testWorkspaceId, 'x90-integration', 'tested in X90’s own integration workspace');
    },
  },
  MM05: {
    needs: ['MM04'],
    run: (w) => {
      w.as('x90_admin', (c) => fleet.createSimulation(c, { id: 'SIM-911', workspaceId: 'x90-integration', imageId: 'x90-1.0-sim', env: 'testing', pool: 'Vehicle' }));
      tspCar(w.engine, 'LSDEMX90000000911', 'X90');
      w.as('resource', (c) => fleet.registerPhysical(c, { id: 'VEH-911', vin: 'LSDEMX90000000911', vehicleModelId: 'X90', env: 'testing', pool: 'Vehicle' }));
      carRuns(w.engine, 'VEH-911', '1.0');
      w.as('x90_admin', (c) => fleet.addWorkspaceVehicle(c, 'x90-integration', 'VEH-911'));
      const d = w.as('x90_integration_tester', (c) => v.dispatchCandidate(c, w.ref.candidate!, { resourceIds: ['SIM-911', 'VEH-911'] }));
      answerAll(w, d);
      for (const r of ['SIM-911', 'VEH-911']) w.as('x90_integration_tester', (c) => v.recordCandidateTest(c, w.ref.candidate!, { resourceId: r, result: 'PASS', summary: 'X90 集成通过' }));
      w.as('x90_integration_tester', (c) => v.verifyCandidate(c, w.ref.candidate!));
      w.eq(w.s.candidates[w.ref.candidate!]!.status, 'VERIFIED', 'X90’s candidate is verified on X90 1.0');
    },
  },
  MM06: {
    needs: ['MM05'],
    run: (w) => {
      w.eq(rel.nextDclVersion(w.s, 'X90'), '1.0.0', 'X90 numbers its own sets from 1.0.0');
      // 1.1 is an X89 version: X90 has none, so an X90 set cannot list it.
      w.fails('UNKNOWN_SOFTWARE_VERSION', () => w.as('x90_release', (c) => rel.promoteCandidate(c, w.ref.candidate!, { dclVersion: '1.0.0', vehicleIntegrationVersions: ['1.1'] })));
      w.ref.release = w.as('x90_release', (c) => rel.promoteCandidate(c, w.ref.candidate!, { dclVersion: '1.0.0', vehicleIntegrationVersions: ['1.0'] }));
      w.eq(releasesOf(w, 'X90'), ['1.0.0'], 'X90 has its policy set 1.0.0');
      w.eq(rel.setInEffect(w.s, 'X90', '1.0')?.id, w.ref.release, 'in effect for X90 1.0');
      w.eq(x89Picture(w), w.ref.x89, 'X89’s sets, versions, vehicles and history are unchanged');
      w.check(rel.setInEffect(w.s, 'X89', '1.0')?.id !== w.ref.release, 'X89 1.0 keeps its own set 1.0.0');
    },
  },
  MM07: {
    needs: ['MM06'],
    run: (w) => {
      // Two production X90 cars on 1.0: a gray first wave that fails once, is retried, then expanded.
      for (const id of ['VEH-921', 'VEH-922']) {
        tspCar(w.engine, `LSDEMX90000000${id.slice(4)}`, 'X90', { expectedVersion: '1.0' });
        w.as('resource', (c) => fleet.registerPhysical(c, { id, vin: `LSDEMX90000000${id.slice(4)}`, vehicleModelId: 'X90', env: 'production', pool: 'Vehicle' }));
        carRuns(w.engine, id, '1.0');
        w.as('x90_admin', (c) => fleet.addWorkspaceVehicle(c, 'x90-project', id));
      }
      const group = w.as('x90_release', (c) => fleet.createVehicleGroup(c, { workspaceId: 'x90-project', groupId: null, name: 'X90 量产车组', purpose: 'PRODUCTION', env: 'production' }));
      for (const id of ['VEH-921', 'VEH-922']) w.as('x90_release', (c) => fleet.addGroupMember(c, group, id, '量产配置 OTA'));
      const x89Set = rel.setInEffect(w.s, 'X89', '1.0')!.id;
      w.fails('MODEL_MISMATCH', () => w.as('x90_release', (c) => ota.createOta(c, { releaseId: x89Set, vehicleGroupIds: [group], firstWave: ['VEH-921'] })));
      const d = w.as('x90_release', (c) => ota.createOta(c, { releaseId: w.ref.release!, vehicleGroupIds: [group], firstWave: ['VEH-921'] }));
      w.sys((c) => sendReceipt(c, d, 'VEH-921', 'FAILED', 'flash timeout'));
      w.eq(w.s.deployments[d]!.status, 'PAUSED', 'the failure pauses the rollout');
      w.as('x90_release', (c) => ota.resumeOta(c, d));
      w.sys((c) => sendReceipt(c, d, 'VEH-921', 'APPLIED'));
      w.as('x90_release', (c) => ota.expandOta(c, d, 'ALL'));
      w.sys((c) => sendReceipt(c, d, 'VEH-922', 'APPLIED'));
      w.eq(w.s.deployments[d]!.status, 'COMPLETED', 'both X90 cars run X90 1.0.0');
      w.eq(w.s.deployments[d]!.targets.find((t) => t.resourceId === 'VEH-921')!.history.map((h) => h.status), ['FAILED'], 'the failed attempt is kept');
      w.eq(x89Picture(w), w.ref.x89, 'X89 is still untouched');
    },
  },
  MM08: {
    needs: ['MM07'],
    run: (w) => {
      // Each model's history tells only its own story.
      const x90 = versionHistory(w.s, 'X90', '1.0');
      w.check(x90.some((e) => e.kind === 'PUBLISHED' && e.releaseId === w.ref.release), 'X90 1.0’s history shows the release of X90 1.0.0');
      w.check(x90.some((e) => e.kind === 'OTA_COMPLETED'), 'and its rollout');
      w.check(x90.every((e) => !e.releaseId || w.s.releases[e.releaseId]!.vehicleModelId === 'X90'), 'with no X89 set in it');
      w.check(versionHistory(w.s, 'X89', '1.0').every((e) => !e.releaseId || w.s.releases[e.releaseId]!.vehicleModelId === 'X89'), 'X89 1.0’s history has no X90 set');
    },
  },
  N01: {
    needs: ['MM02'],
    run: (w) => {
      // Nothing crosses models: sources, vehicles, software, images, candidates.
      w.fails('SOURCE_MODEL_MISMATCH', () =>
        w.as('admin', (c) => createWorkspace(c, { id: 'x90-mixed', name: 'X90 混合', kind: 'PROJECT', orgUnitId: 'x90', vehicleModelId: 'X90', groupIds: ['brake'], scopes: ['Vehicle'], sourceWorkspaceIds: ['team-brake'] })),
      );
      // An X90 car reporting 1.1 (only X89 has it) does not take X89's 1.1: it waits for PLM to publish X90 1.1.
      const before = w.s.resources['VEH-901']!.integrationVersion;
      carRuns(w.engine, 'VEH-901', '1.1');
      w.eq(w.s.resources['VEH-901']!.integrationVersion, before, 'X89 1.1 is not X90 1.1');
      w.fails('VEHICLE_NOT_ASSIGNABLE', () => w.as('x90_admin', (c) => fleet.addWorkspaceVehicle(c, 'team-brake-x90', 'VEH-001')));
      w.denied('x90_tester', (c) => v.recordFeatureTest(c, Object.values(w.s.features).find((f) => f.name === 'brake_monitor')!.id, { commitId: 'x', resourceId: 'VEH-001', result: 'PASS', summary: '' }));
    },
  },
};
