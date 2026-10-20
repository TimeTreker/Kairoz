// Each test file gets its own Postgres schema inside the test database, migrated from scratch.

import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { buildApp } from '../src/app.ts';
import type { Config } from '../src/config.ts';
import { migrate } from '../src/db/migrate.ts';
import { createPool } from '../src/db/pool.ts';
import { bootstrap } from '../src/modules/identity/service.ts';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://kairoz:kairoz@127.0.0.1:55432/kairoz_test';

export interface Response<T = any> {
  status: number;
  body: T;
  headers: Record<string, unknown>;
}

export class Client {
  readonly app: FastifyInstance;
  readonly token: string | undefined;

  constructor(app: FastifyInstance, token?: string) {
    this.app = app;
    this.token = token;
  }

  async request<T = any>(method: string, url: string, body?: unknown, headers: Record<string, string> = {}): Promise<Response<T>> {
    const res = await this.app.inject({
      method: method as 'GET',
      url,
      headers: {
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
    });
    return { status: res.statusCode, body: (res.body ? res.json() : undefined) as T, headers: res.headers };
  }

  get<T = any>(url: string) {
    return this.request<T>('GET', url);
  }
  post<T = any>(url: string, body: unknown = {}, headers?: Record<string, string>) {
    return this.request<T>('POST', url, body, headers);
  }
  patch<T = any>(url: string, body: unknown) {
    return this.request<T>('PATCH', url, body);
  }
  put<T = any>(url: string, body: unknown) {
    return this.request<T>('PUT', url, body);
  }
  delete<T = any>(url: string) {
    return this.request<T>('DELETE', url);
  }
}

export interface TestApp {
  app: FastifyInstance;
  pool: pg.Pool;
  anonymous: Client;
  login(username: string): Promise<Client>;
  close(): Promise<void>;
}

export async function startTestApp(overrides: Partial<Config> = {}): Promise<TestApp> {
  const schema = `t_${randomBytes(6).toString('hex')}`;
  const admin = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await admin.connect();
  await admin.query(`CREATE SCHEMA ${schema}`);
  await admin.end();

  const pool = createPool({ connectionString: TEST_DATABASE_URL, schema, max: 5 });
  await migrate(pool);
  await bootstrap(pool);
  const config: Config = {
    databaseUrl: TEST_DATABASE_URL,
    port: 0,
    host: '127.0.0.1',
    authMode: 'dev-username',
    sessionTtlMs: 3600_000,
    logLevel: 'silent',
    ...overrides,
  };
  const app = buildApp({ pool, config, logger: false });
  await app.ready();
  const anonymous = new Client(app);
  return {
    app,
    pool,
    anonymous,
    async login(username) {
      const res = await anonymous.post('/api/v1/auth/dev-login', { username });
      if (res.status !== 200) throw new Error(`login ${username} failed: ${JSON.stringify(res.body)}`);
      return new Client(app, res.body.token);
    },
    async close() {
      await app.close();
      await pool.query(`DROP SCHEMA ${schema} CASCADE`);
      await pool.end();
    },
  };
}

/** Asserts the status and returns the body; on failure shows the error payload. */
export function ok<T>(res: Response<T>, status = 200): T {
  if (res.status !== status) {
    throw new Error(`expected ${status}, got ${res.status}: ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

export function expectError(res: Response, status: number, code: string): any {
  if (res.status !== status || res.body?.error?.code !== code) {
    throw new Error(`expected ${status} ${code}, got ${res.status}: ${JSON.stringify(res.body)}`);
  }
  return res.body.error;
}

export const ALL_ENVS = ['development', 'testing', 'production'];

/**
 * A small organization: company -> chassis -> brake / steering teams, vehicle model X89, one DEV
 * group and TEAM workspace per team, and accounts for business development, DCL engineering and
 * workspace administration.
 */
export async function brakeWorld(t: TestApp) {
  const admin = await t.login('admin');
  ok(await admin.post('/api/v1/vehicle-models', { id: 'X89', name: 'X89' }), 201);
  ok(await admin.post('/api/v1/org-units', { id: 'company', name: '公司' }), 201);
  ok(await admin.post('/api/v1/org-units', { id: 'chassis', name: '底盘部门', parentId: 'company' }), 201);
  ok(await admin.post('/api/v1/org-units', { id: 'brake-team', name: '制动团队', parentId: 'chassis' }), 201);
  ok(await admin.post('/api/v1/org-units', { id: 'steering-team', name: '转向团队', parentId: 'chassis' }), 201);
  for (const [id, code, name, unit] of [
    ['brake', 'chassis.brake', '制动组', 'brake-team'],
    ['steering', 'chassis.steering', '转向组', 'steering-team'],
  ] as const) {
    ok(await admin.post('/api/v1/groups', { id, code, name, domain: 'Chassis', purpose: 'DEV', orgUnitId: unit }), 201);
    ok(
      await admin.post('/api/v1/workspaces', {
        id: `team-${id}`,
        name: `${name}工作区`,
        kind: 'TEAM',
        orgUnitId: unit,
        vehicleModelId: 'X89',
        groupIds: [id],
        scopes: ['Chassis'],
      }),
      201,
    );
  }
  const account = (username: string, displayName: string, grants: unknown[]) =>
    admin.post('/api/v1/accounts', { username, displayName, grants });
  ok(
    await account('business', '陈明', [
      { role: 'BUSINESS_DEV', workspaces: ['team-brake'], groups: ['brake'], envs: ['development', 'testing'] },
    ]),
    201,
  );
  ok(
    await account('steering', '吴泽宇', [
      { role: 'BUSINESS_DEV', workspaces: ['team-steering'], groups: ['steering'], envs: ['development', 'testing'] },
    ]),
    201,
  );
  ok(await account('dcl', '林书涵', [{ role: 'DCL_ENGINEER', workspaces: ['*'], groups: ['*'], envs: ALL_ENVS }]), 201);
  ok(
    await account('workspace_manager', '周工', [
      { role: 'WORKSPACE_ADMIN', workspaces: ['team-brake'], envs: ['development', 'testing'] },
    ]),
    201,
  );
  return { admin };
}

/** DCL publishes RawStorage pipelines and a default template for each file type. */
export async function publishTemplates(dcl: Client, types: { fileType: string; format: string }[]) {
  for (const { fileType, format } of types) {
    const code = fileType.replaceAll('_', '-');
    const edge = ok(
      await dcl.post('/api/v1/processing/pipelines', {
        code: `edge-${code}`,
        side: 'EDGE',
        name: `${fileType} edge`,
        formats: [format],
        steps: ['Locate', 'Snapshot', 'Compress', 'Encrypt', 'Upload'],
      }),
      201,
    );
    const cloud = ok(
      await dcl.post('/api/v1/processing/pipelines', {
        code: `cloud-${code}`,
        side: 'CLOUD',
        name: `${fileType} cloud`,
        formats: [format],
        steps: ['Receive', 'Checksum', 'Decrypt', 'RawStore', 'Index'],
      }),
      201,
    );
    ok(
      await dcl.post('/api/v1/processing/templates', {
        fileType,
        format,
        schema: `opaque-${code}@1`,
        edgePipelineId: edge.id,
        cloudPipelineId: cloud.id,
        defaultRetentionDays: 30,
      }),
      201,
    );
  }
}
