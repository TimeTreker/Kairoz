import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { ALL_ENVS, brakeWorld, expectError, ok, startTestApp } from './helpers.ts';
import type { Client, TestApp } from './helpers.ts';

describe('identity and accounts', () => {
  let t: TestApp;
  let admin: Client;

  before(async () => {
    t = await startTestApp();
    ({ admin } = await brakeWorld(t));
  });
  after(() => t.close());

  test('a clean installation has exactly one administrator', async () => {
    const fresh = await startTestApp();
    try {
      const a = await fresh.login('admin');
      const accounts = ok(await a.get('/api/v1/accounts'));
      assert.deepEqual(
        accounts.map((x: any) => x.username),
        ['admin'],
      );
      assert.deepEqual(accounts[0].grants[0].envs, ALL_ENVS);
    } finally {
      await fresh.close();
    }
  });

  test('requests without a valid session are rejected', async () => {
    expectError(await t.anonymous.get('/api/v1/me'), 401, 'UNAUTHENTICATED');
    const res = await t.anonymous.request('GET', '/api/v1/me', undefined, { authorization: 'Bearer nonsense' });
    expectError(res, 401, 'UNAUTHENTICATED');
  });

  test('unknown or disabled accounts cannot log in', async () => {
    expectError(await t.anonymous.post('/api/v1/auth/dev-login', { username: 'nobody' }), 422, 'LOGIN_REJECTED');
  });

  test('username login can be switched off', async () => {
    const strict = await startTestApp({ authMode: 'disabled' });
    try {
      expectError(await strict.anonymous.post('/api/v1/auth/dev-login', { username: 'admin' }), 403, 'LOGIN_MODE_DISABLED');
    } finally {
      await strict.close();
    }
  });

  test('me lists the workspaces and roles the grants cover', async () => {
    const business = await t.login('business');
    const me = ok(await business.get('/api/v1/me'));
    assert.equal(me.account.displayName, '陈明');
    assert.deepEqual(me.workspaces, [{ workspaceId: 'team-brake', name: '制动组工作区', kind: 'TEAM', roles: ['BUSINESS_DEV'] }]);
  });

  test('only platform operations manage accounts', async () => {
    const business = await t.login('business');
    expectError(await business.get('/api/v1/accounts'), 403, 'FORBIDDEN');
    const res = await business.post('/api/v1/accounts', { username: 'mallory', displayName: 'M', grants: [] });
    const error = expectError(res, 403, 'FORBIDDEN');
    assert.equal(error.details.reason, 'ROLE_NOT_GRANTED');
    // The denial is audited even though its transaction rolled back.
    const audit = ok(await admin.get('/api/v1/audit?action=account.manage&username=business'));
    assert.equal(audit[0].outcome, 'DENIED');
  });

  test('grants are validated structurally and against existing objects', async () => {
    const bad = await admin.post('/api/v1/accounts', {
      username: 'tester_one',
      displayName: '测试',
      grants: [{ role: 'BUSINESS_TEST', workspaces: ['team-brake'], envs: ['development'] }],
    });
    assert.deepEqual(expectError(bad, 422, 'INVALID_GRANTS').details.grants[0].issues, ['BUSINESS_TEST requires at least one group']);

    const unknown = await admin.post('/api/v1/accounts', {
      username: 'tester_one',
      displayName: '测试',
      grants: [{ role: 'BUSINESS_TEST', workspaces: ['team-nowhere'], groups: ['brake'], envs: ['development'] }],
    });
    assert.deepEqual(expectError(unknown, 422, 'UNKNOWN_GRANT_REFERENCE').details.workspaces, ['team-nowhere']);
  });

  test('changing grants ends existing sessions', async () => {
    ok(
      await admin.post('/api/v1/accounts', {
        username: 'temp_dev',
        displayName: '临时',
        grants: [{ role: 'BUSINESS_DEV', workspaces: ['team-brake'], groups: ['brake'], envs: ['development'] }],
      }),
      201,
    );
    const temp = await t.login('temp_dev');
    ok(await temp.get('/api/v1/me'));
    const account = ok(await admin.get('/api/v1/accounts')).find((a: any) => a.username === 'temp_dev');
    ok(
      await admin.put('/api/v1/accounts/temp_dev/grants', {
        expectedRevision: account.revision,
        grants: [{ role: 'BUSINESS_DEV', workspaces: ['team-brake'], groups: ['brake'], envs: ['testing'] }],
      }),
    );
    expectError(await temp.get('/api/v1/me'), 401, 'UNAUTHENTICATED');
    const again = await t.login('temp_dev');
    assert.deepEqual(ok(await again.get('/api/v1/me')).account.grants[0].envs, ['testing']);
  });

  test('disabling an account ends its sessions and blocks login', async () => {
    const steering = await t.login('steering');
    const account = ok(await admin.get('/api/v1/accounts')).find((a: any) => a.username === 'steering');
    ok(await admin.patch('/api/v1/accounts/steering', { expectedRevision: account.revision, status: 'DISABLED' }));
    expectError(await steering.get('/api/v1/me'), 401, 'UNAUTHENTICATED');
    expectError(await t.anonymous.post('/api/v1/auth/dev-login', { username: 'steering' }), 422, 'LOGIN_REJECTED');
    ok(await admin.patch('/api/v1/accounts/steering', { expectedRevision: account.revision + 1, status: 'ACTIVE' }));
  });

  test('a stale revision is rejected instead of overwriting', async () => {
    const account = ok(await admin.get('/api/v1/accounts')).find((a: any) => a.username === 'dcl');
    ok(await admin.patch('/api/v1/accounts/dcl', { expectedRevision: account.revision, displayName: '林书涵（DCL）' }));
    const stale = await admin.patch('/api/v1/accounts/dcl', { expectedRevision: account.revision, displayName: '覆盖' });
    assert.equal(expectError(stale, 409, 'REVISION_CONFLICT').details.currentRevision, account.revision + 1);
  });

  test('the last full administrator cannot be removed', async () => {
    const account = ok(await admin.get('/api/v1/accounts')).find((a: any) => a.username === 'admin');
    expectError(await admin.patch('/api/v1/accounts/admin', { expectedRevision: account.revision, status: 'DISABLED' }), 422, 'LAST_ADMINISTRATOR');
    const narrowed = await admin.put('/api/v1/accounts/admin/grants', {
      expectedRevision: account.revision,
      grants: [{ role: 'PLATFORM_OPS', workspaces: ['*'], envs: ['development'] }],
    });
    expectError(narrowed, 422, 'LAST_ADMINISTRATOR');
    // Nothing changed: the admin session still works.
    ok(await admin.get('/api/v1/me'));
  });

  test('idempotent replay returns the committed result; a reused key with other content is rejected', async () => {
    const key = 'create-acct-0001';
    const body = {
      username: 'idem_user',
      displayName: '幂等',
      grants: [{ role: 'BUSINESS_DEV', workspaces: ['team-brake'], groups: ['brake'], envs: ['development'] }],
    };
    const first = await admin.post('/api/v1/accounts', body, { 'idempotency-key': key });
    ok(first, 201);
    const replay = await admin.post('/api/v1/accounts', body, { 'idempotency-key': key });
    ok(replay, 201);
    assert.equal(replay.headers['idempotent-replayed'], 'true');
    assert.deepEqual(replay.body, first.body);
    const other = await admin.post('/api/v1/accounts', { ...body, displayName: '不同' }, { 'idempotency-key': key });
    expectError(other, 422, 'IDEMPOTENCY_KEY_REUSED');
    // Without a key the duplicate is a real conflict.
    expectError(await admin.post('/api/v1/accounts', body), 409, 'ACCOUNT_EXISTS');
  });

  test('logout ends the session', async () => {
    const dcl = await t.login('dcl');
    assert.equal((await dcl.post('/api/v1/auth/logout')).status, 204);
    expectError(await dcl.get('/api/v1/me'), 401, 'UNAUTHENTICATED');
  });
});
