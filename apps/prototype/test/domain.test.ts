import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { authorize, canReadGroupConfig, grantIssues } from '../src/domain/authz.ts';
import type { Grant } from '../src/domain/authz.ts';
import { canonicalJson, digestOf } from '../src/domain/canonical.ts';
import { diffConfig, emptyConfig, policyIssues } from '../src/domain/config.ts';
import type { PolicyContent } from '../src/domain/config.ts';
import { dataCodeStem, globsIntersect, normalizeSource, sourcesOverlap } from '../src/domain/data-source.ts';
import { DomainError } from '../src/domain/errors.ts';
import { assertNotDowngraded, inferFileType, mayMatchSensitiveFiles, requiresSensitiveReview } from '../src/domain/file-types.ts';
import { newId } from '../src/domain/ids.ts';
import { parseTrigger } from '../src/domain/trigger.ts';

const grant = (g: Partial<Grant> & Pick<Grant, 'role'>): Grant => ({
  id: g.id ?? `g-${Math.random()}`,
  role: g.role,
  workspaces: g.workspaces ?? ['team-brake'],
  groups: g.groups ?? [],
  scopes: g.scopes ?? [],
  envs: g.envs ?? ['development'],
  dispatchOnly: g.dispatchOnly ?? false,
});

describe('authorize: single complete grant', () => {
  const target = { workspaceId: 'team-brake', groupId: 'brake', env: 'development' as const };

  test('allows when one grant covers every dimension', () => {
    const g = grant({ role: 'BUSINESS_DEV', groups: ['brake'] });
    const result = authorize([g], 'feature.create', target);
    assert.equal(result.ok, true);
    assert.equal(result.ok && result.grant.id, g.id);
  });

  test('never combines two partial grants', () => {
    // One grant has the group in the wrong workspace; the other has the workspace for another group.
    const grants = [
      grant({ role: 'BUSINESS_DEV', workspaces: ['team-steering'], groups: ['brake'] }),
      grant({ role: 'BUSINESS_DEV', workspaces: ['team-brake'], groups: ['steering'] }),
    ];
    assert.deepEqual(authorize(grants, 'feature.create', target), { ok: false, reason: 'NO_SINGLE_GRANT' });
  });

  test('environment must be in the same grant', () => {
    const grants = [
      grant({ role: 'BUSINESS_DEV', groups: ['brake'], envs: ['testing'] }),
      grant({ role: 'BUSINESS_DEV', groups: ['steering'], envs: ['development'] }),
    ];
    assert.deepEqual(authorize(grants, 'feature.create', target), { ok: false, reason: 'NO_SINGLE_GRANT' });
  });

  test('reports the dimension no grant satisfies', () => {
    assert.deepEqual(authorize([grant({ role: 'BUSINESS_DEV', groups: ['steering'] })], 'feature.create', target), {
      ok: false,
      reason: 'GROUP_NOT_GRANTED',
    });
    assert.deepEqual(authorize([grant({ role: 'BUSINESS_DEV', groups: ['brake'], workspaces: ['x'] })], 'feature.create', target), {
      ok: false,
      reason: 'WORKSPACE_NOT_GRANTED',
    });
    assert.deepEqual(authorize([grant({ role: 'BUSINESS_TEST', groups: ['brake'] })], 'feature.create', target), {
      ok: false,
      reason: 'ROLE_NOT_GRANTED',
    });
  });

  test('platform-wide actions need every environment in the same grant', () => {
    const devOnly = grant({ role: 'PLATFORM_OPS', workspaces: ['*'], envs: ['development'] });
    assert.deepEqual(authorize([devOnly], 'account.manage', {}), { ok: false, reason: 'ENV_NOT_GRANTED' });
    const full = grant({ role: 'PLATFORM_OPS', workspaces: ['*'], envs: ['development', 'testing', 'production'] });
    assert.equal(authorize([devOnly, full], 'account.manage', {}).ok, true);
  });

  test('a "*" target demands a wildcard grant', () => {
    const narrow = grant({ role: 'DCL_ENGINEER', workspaces: ['*'], groups: ['brake'], envs: ['development', 'testing', 'production'] });
    assert.deepEqual(authorize([narrow], 'processing.manage', { workspaceId: '*', groupId: '*' }), { ok: false, reason: 'GROUP_NOT_GRANTED' });
  });

  test('wildcards cover any workspace or group', () => {
    const g = grant({ role: 'DCL_ENGINEER', workspaces: ['*'], groups: ['*'] });
    assert.equal(authorize([g], 'dataItem.reviewOverlap', { groupId: 'anything' }).ok, true);
  });

  test('scoped roles are checked on scope, not group', () => {
    const integrator = grant({ role: 'CONFIG_INTEGRATOR', scopes: ['Chassis'] });
    assert.equal(authorize([integrator], 'feature.create', target).ok, false);
    assert.equal(canReadGroupConfig([integrator], { groupId: 'brake', domain: 'Chassis' }), true);
    assert.equal(canReadGroupConfig([integrator], { groupId: 'hmi', domain: 'HMI' }), false);
  });

  test('the whole-vehicle scope may read every group configuration', () => {
    const integrator = grant({ role: 'CONFIG_INTEGRATOR', scopes: ['Vehicle'] });
    assert.equal(canReadGroupConfig([integrator], { groupId: 'hmi', domain: 'HMI' }), true);
  });

  test('platform operations cannot read business configuration', () => {
    const ops = grant({ role: 'PLATFORM_OPS', workspaces: ['*'], envs: ['development', 'testing', 'production'] });
    assert.equal(canReadGroupConfig([ops], { groupId: 'brake', domain: 'Chassis' }), false);
  });
});

describe('grantIssues', () => {
  const base = { workspaces: ['team-brake'], groups: [], scopes: [], envs: ['development'] };
  test('grouped roles need groups and reject scopes', () => {
    assert.deepEqual(grantIssues({ ...base, role: 'BUSINESS_DEV' }), ['BUSINESS_DEV requires at least one group']);
    assert.ok(grantIssues({ ...base, role: 'BUSINESS_DEV', groups: ['brake'], scopes: ['Chassis'] }).includes('BUSINESS_DEV does not take scopes'));
  });
  test('scoped roles need valid scopes', () => {
    assert.deepEqual(grantIssues({ ...base, role: 'CONFIG_RELEASE', scopes: ['Moon'] }), ['unknown scope Moon']);
  });
  test('platform operations are platform-wide', () => {
    assert.ok(grantIssues({ ...base, role: 'PLATFORM_OPS' })[0]?.includes('workspaces must be ["*"]'));
    assert.deepEqual(grantIssues({ ...base, role: 'PLATFORM_OPS', workspaces: ['*'] }), []);
  });
  test('envs must be known and present', () => {
    assert.deepEqual(grantIssues({ ...base, role: 'WORKSPACE_ADMIN', envs: [] }), ['envs must not be empty']);
    assert.deepEqual(grantIssues({ ...base, role: 'WORKSPACE_ADMIN', envs: ['staging'] }), ['unknown env staging']);
  });
});

describe('trigger expressions', () => {
  test('accepts comparisons, boolean operators and parentheses', () => {
    const r = parseTrigger('brake_pressure > 80 AND (vehicle_speed >= 30 || abs.active) and not door.open');
    assert.equal(r.ok, true);
    assert.deepEqual(r.ok && r.signals, ['abs.active', 'brake_pressure', 'door.open', 'vehicle_speed']);
  });
  test('accepts negative numbers and strings', () => {
    assert.equal(parseTrigger('accel_x < -3.5').ok, true);
    assert.equal(parseTrigger("gear == 'R'").ok, true);
    assert.equal(parseTrigger('speed > 5 AND -3 > accel').ok, true);
    assert.equal(parseTrigger('NOT -1 == dir').ok, true);
  });
  test('comparisons take signals or literals with matching operators', () => {
    for (const bad of ['(a OR b) > speed', 'true > speed', '"abc" > speed', 'speed > 1e999']) {
      assert.equal(parseTrigger(bad).ok, false, bad);
    }
    assert.equal(parseTrigger('door.open == true').ok, true);
  });
  test('nesting depth is bounded instead of overflowing the stack', () => {
    assert.equal(parseTrigger(`${'('.repeat(10)}a${')'.repeat(10)}`).ok, true);
    const deep = parseTrigger(`${'('.repeat(1999)}a`);
    assert.equal(deep.ok, false);
    assert.match(!deep.ok ? deep.error.message : '', /nesting/);
    assert.equal(parseTrigger(`${'NOT '.repeat(500)}a`).ok, false);
  });
  test('rejects malformed expressions with a position', () => {
    for (const bad of ['', 'a >', 'a > > 3', '(a > 1', '3 > 1', 'a - 1', 'AND a', 'a > 1 b', '80']) {
      const r = parseTrigger(bad);
      assert.equal(r.ok, false, bad);
    }
    const r = parseTrigger('speed > 30 AND');
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.error.position, 14);
  });
});

describe('data sources', () => {
  test('normalizes unit and directory', () => {
    assert.deepEqual(normalizeSource({ unit: ' adc ', directory: '/var//log/brake/', pattern: 'brake_*.pb' }), {
      unit: 'ADC',
      directory: '/var/log/brake',
      pattern: 'brake_*.pb',
    });
  });
  test('rejects relative or traversing directories and slashes in patterns', () => {
    for (const s of [
      { unit: 'ADC', directory: 'var/log', pattern: 'a.log' },
      { unit: 'ADC', directory: '/var/../etc', pattern: 'a.log' },
      { unit: 'ADC', directory: '/var/log', pattern: 'x/a.log' },
    ]) {
      assert.throws(() => normalizeSource(s), DomainError);
    }
  });
  test('glob intersection', () => {
    assert.equal(globsIntersect('*.pb', 'brake_*.pb'), true);
    assert.equal(globsIntersect('brake_*.pb', 'brake_debug.pb'), true);
    assert.equal(globsIntersect('a*', '*b'), true);
    assert.equal(globsIntersect('*.log', '*.pb'), false);
    assert.equal(globsIntersect('brake_?.log', 'brake_12.log'), false);
    assert.equal(globsIntersect('brake_?.log', 'brake_1.log'), true);
  });
  test('overlap needs the same unit and directory', () => {
    const a = { unit: 'ADC', directory: '/log', pattern: '*.pb' };
    assert.equal(sourcesOverlap(a, { ...a, pattern: 'x.pb' }), true);
    assert.equal(sourcesOverlap(a, { ...a, directory: '/other', pattern: 'x.pb' }), false);
    assert.equal(sourcesOverlap(a, a), false);
  });
  test('data code stems', () => {
    assert.equal(dataCodeStem('chassis.brake', 'brake_debug.pb'), 'chassis.brake.brake.debug');
    assert.equal(dataCodeStem('chassis.brake', '*.pb'), 'chassis.brake.data');
    assert.equal(dataCodeStem('chassis.brake', '2024_trace.log'), 'chassis.brake.d.2024.trace');
  });
});

describe('file types and review', () => {
  test('inference and no downgrade of sensitive sources', () => {
    assert.equal(inferFileType('front_*.mp4'), 'camera_video');
    assert.equal(inferFileType('gnss_track.jsonl'), 'gnss');
    assert.throws(() => assertNotDowngraded('front_*.mp4', 'text_log'), /SENSITIVE|cannot/);
    assert.doesNotThrow(() => assertNotDowngraded('brake.log', 'bin_log'));
  });
  test('review is required for sensitive types, P2/P3 and sensitive tags', () => {
    const base = { fileType: 'text_log' as const, privacy: 'P1' as const, contentTags: [], templateRequiresReview: false, pattern: 'a.log' };
    assert.equal(requiresSensitiveReview(base), false);
    assert.equal(requiresSensitiveReview({ ...base, privacy: 'P2' }), true);
    assert.equal(requiresSensitiveReview({ ...base, contentTags: ['location'] }), true);
    assert.equal(requiresSensitiveReview({ ...base, fileType: 'unknown' }), true);
    assert.equal(requiresSensitiveReview({ ...base, fileType: 'bin_log', pattern: 'front_*.mp?' }), true);
  });
  test('wildcard patterns that could match sensitive files are detected', () => {
    assert.equal(mayMatchSensitiveFiles('front_*.mp?'), true);
    assert.equal(mayMatchSensitiveFiles('*'), true);
    assert.equal(mayMatchSensitiveFiles('CAM_*.JPG'), true);
    assert.equal(mayMatchSensitiveFiles('*.log'), false);
    assert.equal(mayMatchSensitiveFiles('brake_debug.pb'), false);
  });
});

describe('canonical digests and diffs', () => {
  test('key order does not change the digest', () => {
    assert.equal(canonicalJson({ b: 1, a: [2, { d: 3, c: 4 }] }), '{"a":[2,{"c":4,"d":3}],"b":1}');
    assert.equal(digestOf({ a: 1, b: 2 }), digestOf({ b: 2, a: 1 }));
  });
  test('diff lists added, removed and changed fields', () => {
    const policy: PolicyContent = { name: 'p', trigger: 'a > 1', captures: ['dk_1'], preSeconds: 5, postSeconds: 5, priority: 'NORMAL' };
    const from = { ...emptyConfig(), policies: { 'g.a': policy, 'g.b': policy } };
    const to = { ...emptyConfig(), policies: { 'g.a': { ...policy, postSeconds: 10 }, 'g.c': policy } };
    const d = diffConfig(from, to);
    assert.deepEqual(d.policies, { added: ['g.c'], removed: ['g.b'], changed: [{ key: 'g.a', fields: ['postSeconds'] }] });
    assert.equal(d.empty, false);
    assert.equal(diffConfig(to, to).empty, true);
  });
  test('policy issues', () => {
    const p: PolicyContent = { name: 'p', trigger: 'a > 1', captures: ['dk_1'], preSeconds: 100, postSeconds: 30, priority: 'NORMAL' };
    const issues = policyIssues(p, new Set());
    assert.ok(issues.some((i) => i.includes('not in the file list')));
    assert.ok(issues.some((i) => i.includes('capture window')));
  });
});

test('ids are prefixed and time-sortable', () => {
  const a = newId('ft');
  const b = newId('ft');
  assert.match(a, /^ft_[0-9a-z]{26}$/);
  assert.ok(a.slice(3, 13) <= b.slice(3, 13));
});
