import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { answerAll } from '../acceptance/helpers.ts';
import { World } from '../acceptance/world.ts';
import * as config from '../src/engine/config.ts';
import * as fleet from '../src/engine/fleet.ts';
import { answerConfigRequest } from '../src/engine/ota.ts';
import * as ps from '../src/engine/personal-sim.ts';
import { demoState } from '../src/engine/seed.ts';
import * as sw from '../src/engine/sim-software.ts';
import * as v from '../src/engine/validation.ts';

const BRAKE = { module: 'brake', repository: 'https://github.com/example/brake', ref: 'main' };
const monitor = (w: World) => Object.values(w.s.features).find((f) => f.name === 'brake_monitor')!;
const groupId = (w: World, name: string) => Object.values(w.s.vehicleGroups).find((g) => g.name === name)!.id;

/** A personal simulation on software 1.0 running the brake_monitor draft. */
function personal(w: World): string {
  const id = w.as('business', (c) => ps.createPersonalSim(c, { workspaceId: 'team-brake', groupId: 'brake', imageId: 'x89-1.0-sim' }));
  answerAll(w, w.as('business', (c) => ps.configurePersonalSim(c, id, { featureId: monitor(w).id })));
  return id;
}

describe('simulation software', () => {
  test('a module build makes a derived image without touching what runs', () => {
    const w = new World(demoState());
    const id = personal(w);
    for (const [code, input] of [
      ['INVALID_REPOSITORY', { ...BRAKE, repository: 'file:///etc/passwd' }],
      ['INVALID_REPOSITORY', { ...BRAKE, repository: 'https://evil.test/repo' }],
      ['INVALID_REPOSITORY', { ...BRAKE, repository: 'https://github.com/example/repo?token=x' }],
      ['UNKNOWN_MODULE', { ...BRAKE, module: 'shell' }],
      ['INVALID_REF', { ...BRAKE, ref: 'main; rm -rf /' }],
    ] as const) {
      w.fails(code, () => w.as('business', (c) => sw.requestBuild(c, id, input)));
    }
    const b = w.as('business', (c) => sw.requestBuild(c, id, BRAKE));
    w.fails('BUILD_OPEN', () => w.as('business', (c) => sw.requestBuild(c, id, BRAKE)));
    const image = w.sys((c) => sw.completeBuild(c, b, 'PASS'))!;
    const built = w.s.softwareBuilds[b]!;
    assert.deepEqual([built.status, built.resolvedCommit], ['BUILT', `mock-commit:${b}`]);
    const derived = w.s.images[image]!;
    assert.deepEqual([derived.integrationVersion, derived.derived?.fromImageId, Object.keys(derived.derived!.modules)], ['1.0', 'x89-1.0-sim', ['brake']]);
    assert.equal(w.s.resources[id]!.imageId, 'x89-1.0-sim', 'still runs its image');
    assert.ok(!sw.catalogImages(w.s, 'X89').some((i) => i.id === image), 'derived images are not in the catalog');
    w.fails('IMAGE_NOT_IN_CATALOG', () => w.as('business', (c) => ps.createPersonalSim(c, { workspaceId: 'team-brake', groupId: 'brake', imageId: image })));
    // A 40-hex commit is recorded as given; a failed build changes nothing.
    w.as('business', (c) => sw.cancelBuild(c, id, b));
    const b2 = w.as('business', (c) => sw.requestBuild(c, id, { ...BRAKE, ref: 'a'.repeat(40) }));
    w.sys((c) => sw.completeBuild(c, b2, 'FAIL'));
    assert.equal(w.s.softwareBuilds[b2]!.status, 'BUILD_FAILED');
    const b3 = w.as('business', (c) => sw.requestBuild(c, id, { ...BRAKE, ref: 'A'.repeat(40) }));
    w.sys((c) => sw.completeBuild(c, b3, 'PASS'));
    assert.equal(w.s.softwareBuilds[b3]!.resolvedCommit, 'a'.repeat(40));
  });

  test('deploying needs a stopped, idle instance; only the provider’s answer changes the image', () => {
    const w = new World(demoState());
    const id = personal(w);
    w.as('business', (c) => ps.recordPersonalTest(c, id, { result: 'PASS', note: 'on 1.0' }));
    const b = w.as('business', (c) => sw.requestBuild(c, id, BRAKE));
    const image = w.sys((c) => sw.completeBuild(c, b, 'PASS'))!;
    w.fails('SIMULATION_RUNNING', () => w.as('business', (c) => sw.deployBuild(c, id, b)));
    w.as('business', (c) => fleet.stopSimulation(c, id));
    const applied = w.s.resources[id]!.appliedConfigId;
    const failed = w.as('business', (c) => sw.deployBuild(c, id, b));
    w.fails('IMAGE_CHANGE_PENDING', () => w.as('business', (c) => sw.switchImage(c, id, 'x89-1.1-sim')));
    w.sys((c) => sw.answerImageChange(c, failed, 'FAILED'));
    assert.deepEqual([w.s.resources[id]!.imageId, w.s.resources[id]!.appliedConfigId], ['x89-1.0-sim', applied], 'a failure keeps image and configuration');
    const ok = w.as('business', (c) => sw.deployBuild(c, id, b));
    w.sys((c) => sw.answerImageChange(c, ok, 'APPLIED'));
    const r = w.s.resources[id]!;
    assert.deepEqual([r.imageId, r.integrationVersion, r.appliedConfigId], [image, '1.0', null], 'derived image, source version kept, configuration cleared');
    assert.equal(ps.personalTestsOf(w.s, monitor(w).id)[0]!.imageCurrent, false, 'the earlier self-test is history');
    w.fails('BUILD_NOT_DEPLOYABLE', () => w.as('business', (c) => sw.deployBuild(c, id, b)));

    // Roll back once.
    const back = w.as('business', (c) => sw.rollbackImage(c, id));
    w.sys((c) => sw.answerImageChange(c, back, 'APPLIED'));
    assert.equal(w.s.resources[id]!.imageId, 'x89-1.0-sim');
    w.fails('NOTHING_TO_ROLL_BACK', () => w.as('business', (c) => sw.rollbackImage(c, id)));
  });

  test('a build goes stale when the image changes underneath it', () => {
    const w = new World(demoState());
    const id = personal(w);
    w.as('business', (c) => fleet.stopSimulation(c, id));
    const b = w.as('business', (c) => sw.requestBuild(c, id, BRAKE));
    w.sys((c) => sw.completeBuild(c, b, 'PASS'));
    const sw11 = w.as('business', (c) => sw.switchImage(c, id, 'x89-1.1-sim'));
    w.sys((c) => sw.answerImageChange(c, sw11, 'APPLIED'));
    assert.equal(w.s.resources[id]!.integrationVersion, '1.1');
    w.fails('STALE_BUILD', () => w.as('business', (c) => sw.deployBuild(c, id, b)));
    w.fails('SAME_IMAGE', () => w.as('business', (c) => sw.switchImage(c, id, 'x89-1.1-sim')));
  });

  test('who changes images, and where derived images may run', () => {
    const w = new World(demoState());
    const id = personal(w);
    w.fails('PERSONAL_SIM_OWNER', () => w.as('brake_tester', (c) => sw.requestBuild(c, id, BRAKE)));
    w.denied('business', (c) => sw.switchImage(c, 'SIM-021', 'x89-1.1-sim'));
    w.denied('integration_tester', (c) => sw.switchImage(c, 'SIM-101', 'x89-1.1-sim'));
    w.fails('DERIVED_DEVELOPMENT_ONLY', () => w.as('integration_admin', (c) => sw.requestBuild(c, 'SIM-101', BRAKE)));
    // A shared development simulation: the workspace admin changes it; its base follows the software.
    w.as('workspace_manager', (c) => fleet.stopSimulation(c, 'SIM-021'));
    const change = w.as('workspace_manager', (c) => sw.switchImage(c, 'SIM-021', 'x89-1.1-sim'));
    w.sys((c) => sw.answerImageChange(c, change, 'APPLIED'));
    assert.equal(w.s.resources['SIM-021']!.appliedConfigId, null);
    assert.equal(answerConfigRequest(w.s, 'SIM-021').reason, 'NO_BASE', 'no policy set applies to 1.1 in the demo');
    assert.equal(monitor(w).stage, 'VERIFIED', 'verified stays verified');
    // A rollback undoes a switch as well.
    const back = w.as('workspace_manager', (c) => sw.rollbackImage(c, 'SIM-021'));
    w.sys((c) => sw.answerImageChange(c, back, 'APPLIED'));
    assert.equal(w.s.resources['SIM-021']!.integrationVersion, '1.0');
    assert.equal(answerConfigRequest(w.s, 'SIM-021').reason, 'GROUP_TARGET');
  });

  test('a result from an earlier image stops counting until the vehicle is tested again', () => {
    const w = new World(demoState());
    const f = monitor(w);
    const p = f.draft.policies['chassis.brake.monitor']!;
    w.as('business', (c) => config.putPolicy(c, f.id, 'chassis.brake.monitor', { ...p, trigger: 'brake_pressure > 85' }));
    const commitId = w.as('business', (c) => config.submitFeature(c, f.id, {})).commitId;
    const vg = groupId(w, '制动研发车组');
    const dispatch = () => {
      for (const d of w.as('brake_tester', (c) => v.dispatchFeature(c, f.id, { commitId, vehicleGroupIds: [vg] }))) answerAll(w, d);
    };
    dispatch();
    w.as('brake_tester', (c) => v.recordFeatureTest(c, f.id, { commitId, resourceId: 'SIM-021', result: 'PASS', summary: 'sim' }));
    // The admin rebuilds a module on SIM-021 and deploys it: same source version, another image.
    const b = w.as('workspace_manager', (c) => sw.requestBuild(c, 'SIM-021', { ...BRAKE, module: 'perception' }));
    w.sys((c) => sw.completeBuild(c, b, 'PASS'));
    w.as('workspace_manager', (c) => fleet.stopSimulation(c, 'SIM-021'));
    const ch = w.as('workspace_manager', (c) => sw.deployBuild(c, 'SIM-021', b));
    w.sys((c) => sw.answerImageChange(c, ch, 'APPLIED'));
    w.as('workspace_manager', (c) => fleet.startSimulation(c, 'SIM-021'));
    assert.equal(w.s.resources['SIM-021']!.integrationVersion, '1.0');
    const sim = v.featureTestStatus(w.s, monitor(w)).find((t) => t.resourceId === 'SIM-021')!;
    assert.deepEqual([sim.latest, sim.stale?.result], [null, 'PASS']);
    assert.ok(v.verifyBlockers(w.s, monitor(w)).includes('SIM-021 runs another image since its test; test it again'));
    w.fails('SIMULATION_FIRST', () => w.as('brake_tester', (c) => v.recordFeatureTest(c, f.id, { commitId, resourceId: 'VEH-001', result: 'PASS', summary: 'car' })));
    dispatch();
    w.as('brake_tester', (c) => v.recordFeatureTest(c, f.id, { commitId, resourceId: 'SIM-021', result: 'PASS', summary: 'sim again' }));
    w.as('brake_tester', (c) => v.recordFeatureTest(c, f.id, { commitId, resourceId: 'VEH-001', result: 'PASS', summary: 'car' }));
    w.as('brake_tester', (c) => v.verifyFeature(c, f.id));
    assert.equal(monitor(w).stage, 'VERIFIED');
  });
});
