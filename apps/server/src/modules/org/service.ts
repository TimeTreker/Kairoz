import type { Db } from '../../db/pool.ts';
import { many, one } from '../../db/pool.ts';
import { conflict, notFound, revisionConflict, rule } from '../../domain/errors.ts';
import { GROUP_CODE, SLUG, VEHICLE_MODEL_ID } from '../../domain/ids.ts';
import { WILDCARD } from '../../domain/vocabulary.ts';
import type { Domain, GroupPurpose, Scope, WorkspaceKind } from '../../domain/vocabulary.ts';
import type { ReadCtx, WriteCtx } from '../../http/context.ts';

function assertSlug(kind: string, id: string): void {
  if (!SLUG.test(id)) throw rule('INVALID_ID', `${kind} id must match ${SLUG.source}`, { id });
}

async function assertIdFree(db: Db, table: string, id: string, entity: string): Promise<void> {
  if (await one(db, `SELECT 1 FROM ${table} WHERE id = $1`, [id])) {
    throw conflict('ID_TAKEN', `${entity} ${id} already exists`, { id });
  }
}

// ---------------------------------------------------------------------------
// Vehicle models (车型)
// ---------------------------------------------------------------------------

interface VehicleModelRow {
  id: string;
  name: string;
  status: string;
  created_at: Date;
}

const vehicleModelView = (r: VehicleModelRow) => ({ id: r.id, name: r.name, status: r.status, createdAt: r.created_at.toISOString() });

export async function listVehicleModels(db: Db) {
  return (await many<VehicleModelRow>(db, 'SELECT * FROM vehicle_models ORDER BY id')).map(vehicleModelView);
}

export async function createVehicleModel(ctx: WriteCtx, input: { id: string; name: string }) {
  ctx.allow('org.manage', { type: 'vehicleModel', id: input.id });
  if (!VEHICLE_MODEL_ID.test(input.id)) throw rule('INVALID_ID', `vehicle model id must match ${VEHICLE_MODEL_ID.source}`);
  await assertIdFree(ctx.db, 'vehicle_models', input.id, 'vehicle model');
  const row = await one<VehicleModelRow>(
    ctx.db,
    'INSERT INTO vehicle_models (id, name, created_by) VALUES ($1, $2, $3) RETURNING *',
    [input.id, input.name, ctx.actor.username],
  );
  return vehicleModelView(row!);
}

async function requireActiveVehicleModel(db: Db, id: string): Promise<void> {
  const row = await one<{ status: string }>(db, 'SELECT status FROM vehicle_models WHERE id = $1', [id]);
  if (!row) throw notFound('vehicle model', id);
  if (row.status !== 'ACTIVE') throw rule('VEHICLE_MODEL_RETIRED', `vehicle model ${id} is retired`);
}

// ---------------------------------------------------------------------------
// Projects and organization units
// ---------------------------------------------------------------------------

interface ProjectRow {
  id: string;
  name: string;
  vehicle_model_id: string | null;
  status: string;
  created_at: Date;
}

const projectView = (r: ProjectRow) => ({
  id: r.id,
  name: r.name,
  vehicleModelId: r.vehicle_model_id,
  status: r.status,
  rootUnitId: r.id,
  createdAt: r.created_at.toISOString(),
});

export async function listProjects(db: Db) {
  return (await many<ProjectRow>(db, 'SELECT * FROM projects ORDER BY id')).map(projectView);
}

/** Creates the project and the root of its own organization tree (same id). */
export async function createProject(ctx: WriteCtx, input: { id: string; name: string; vehicleModelId?: string }) {
  ctx.allow('org.manage', { type: 'project', id: input.id });
  assertSlug('project', input.id);
  await assertIdFree(ctx.db, 'projects', input.id, 'project');
  await assertIdFree(ctx.db, 'org_units', input.id, 'organization unit');
  if (input.vehicleModelId) await requireActiveVehicleModel(ctx.db, input.vehicleModelId);
  const row = await one<ProjectRow>(
    ctx.db,
    'INSERT INTO projects (id, name, vehicle_model_id, created_by) VALUES ($1, $2, $3, $4) RETURNING *',
    [input.id, input.name, input.vehicleModelId ?? null, ctx.actor.username],
  );
  await ctx.db.query(
    "INSERT INTO org_units (id, kind, project_id, parent_id, name, created_by) VALUES ($1, 'PROJECT', $1, NULL, $2, $3)",
    [input.id, input.name, ctx.actor.username],
  );
  return projectView(row!);
}

interface OrgUnitRow {
  id: string;
  kind: 'TEAM' | 'PROJECT';
  project_id: string | null;
  parent_id: string | null;
  name: string;
  status: string;
  revision: number;
}

const orgUnitView = (r: OrgUnitRow) => ({
  id: r.id,
  kind: r.kind,
  projectId: r.project_id,
  parentId: r.parent_id,
  name: r.name,
  status: r.status,
  revision: r.revision,
});

export async function listOrgUnits(db: Db, filter: { kind?: 'TEAM' | 'PROJECT'; projectId?: string }) {
  const rows = await many<OrgUnitRow>(
    db,
    `SELECT * FROM org_units
     WHERE ($1::text IS NULL OR kind = $1) AND ($2::text IS NULL OR project_id = $2)
     ORDER BY kind, project_id NULLS FIRST, id`,
    [filter.kind ?? null, filter.projectId ?? null],
  );
  return rows.map(orgUnitView);
}

async function getOrgUnit(db: Db, id: string, lock = false): Promise<OrgUnitRow> {
  const row = await one<OrgUnitRow>(db, `SELECT * FROM org_units WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [id]);
  if (!row) throw notFound('organization unit', id);
  return row;
}

/** Ancestor chain from the root down to (and including) `unitId`. */
export async function unitPath(db: Db, unitId: string): Promise<{ id: string; name: string }[]> {
  const rows = await many<{ id: string; name: string; depth: number }>(
    db,
    `WITH RECURSIVE chain AS (
       SELECT id, name, parent_id, 0 AS depth FROM org_units WHERE id = $1
       UNION ALL
       SELECT u.id, u.name, u.parent_id, c.depth + 1 FROM org_units u JOIN chain c ON u.id = c.parent_id
     ) CYCLE id SET is_cycle USING visited
     SELECT id, name, depth FROM chain WHERE NOT is_cycle ORDER BY depth DESC`,
    [unitId],
  );
  return rows.map((r) => ({ id: r.id, name: r.name }));
}

/** True if `unitId` is `ancestorId` or lies beneath it. */
export async function unitWithin(db: Db, unitId: string, ancestorId: string): Promise<boolean> {
  return (await unitPath(db, unitId)).some((u) => u.id === ancestorId);
}

export async function createOrgUnit(ctx: WriteCtx, input: { id: string; name: string; parentId?: string }) {
  ctx.allow('org.manage', { type: 'orgUnit', id: input.id });
  assertSlug('organization unit', input.id);
  await assertIdFree(ctx.db, 'org_units', input.id, 'organization unit');
  let kind: 'TEAM' | 'PROJECT' = 'TEAM';
  let projectId: string | null = null;
  if (input.parentId) {
    const parent = await getOrgUnit(ctx.db, input.parentId);
    if (parent.status !== 'ACTIVE') throw rule('PARENT_ARCHIVED', `parent ${parent.id} is archived`);
    kind = parent.kind;
    projectId = parent.project_id;
  }
  const row = await one<OrgUnitRow>(
    ctx.db,
    `INSERT INTO org_units (id, kind, project_id, parent_id, name, created_by)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [input.id, kind, projectId, input.parentId ?? null, input.name, ctx.actor.username],
  );
  return orgUnitView(row!);
}

/** Rename and/or move. Moves stay within one tree, never create cycles, never target archived parents. */
export async function updateOrgUnit(
  ctx: WriteCtx,
  id: string,
  input: { expectedRevision: number; name?: string; parentId?: string | null },
) {
  ctx.allow('org.manage', { type: 'orgUnit', id });
  const current = await getOrgUnit(ctx.db, id);
  // One move at a time per tree: concurrent moves could otherwise each pass the cycle check.
  await ctx.db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`kairoz.orgtree.${current.kind}.${current.project_id ?? ''}`]);
  const unit = await getOrgUnit(ctx.db, id, true);
  if (unit.revision !== input.expectedRevision) throw revisionConflict('organization unit', id, unit.revision);
  let parentId = unit.parent_id;
  if (input.parentId !== undefined && input.parentId !== unit.parent_id) {
    if (unit.kind === 'PROJECT' && unit.parent_id === null) throw rule('PROJECT_ROOT_FIXED', 'a project root cannot be moved');
    if (input.parentId === null) {
      if (unit.kind === 'PROJECT') throw rule('PARENT_REQUIRED', 'project units need a parent');
    } else {
      const parent = await getOrgUnit(ctx.db, input.parentId);
      if (parent.kind !== unit.kind || parent.project_id !== unit.project_id) {
        throw rule('CROSS_TREE_MOVE', 'a unit can only move within its own organization tree');
      }
      if (parent.status !== 'ACTIVE') throw rule('PARENT_ARCHIVED', `parent ${parent.id} is archived`);
      if (await unitWithin(ctx.db, parent.id, id)) throw rule('ORG_CYCLE', 'a unit cannot move beneath itself');
    }
    parentId = input.parentId;
  }
  const row = await one<OrgUnitRow>(
    ctx.db,
    `UPDATE org_units SET name = $2, parent_id = $3, revision = revision + 1, updated_at = now()
     WHERE id = $1 RETURNING *`,
    [id, input.name ?? unit.name, parentId],
  );
  if (parentId !== unit.parent_id) await assertTeamWorkspacesIntact(ctx.db);
  return orgUnitView(row!);
}

/** Rejects (and so rolls back) a change that leaves a TEAM workspace with a group outside its team. */
async function assertTeamWorkspacesIntact(db: Db): Promise<void> {
  const broken = await many<{ workspace_id: string; group_id: string }>(
    db,
    `WITH RECURSIVE ancestry AS (
       SELECT g.id AS group_id, g.org_unit_id AS unit_id FROM business_groups g
       UNION ALL
       SELECT a.group_id, u.parent_id FROM ancestry a JOIN org_units u ON u.id = a.unit_id WHERE u.parent_id IS NOT NULL
     ) CYCLE unit_id SET is_cycle USING visited
     SELECT wg.workspace_id, wg.group_id
     FROM workspace_groups wg JOIN workspaces w ON w.id = wg.workspace_id
     WHERE w.kind = 'TEAM'
       AND NOT EXISTS (SELECT 1 FROM ancestry a WHERE a.group_id = wg.group_id AND a.unit_id = w.org_unit_id)
     ORDER BY 1, 2`,
  );
  if (broken.length > 0) {
    throw rule('GROUP_OUTSIDE_TEAM', 'the change would leave team workspaces with groups outside their team', {
      memberships: broken.map((b) => ({ workspaceId: b.workspace_id, groupId: b.group_id })),
    });
  }
}

// ---------------------------------------------------------------------------
// Business groups (业务分组)
// ---------------------------------------------------------------------------

interface GroupRow {
  id: string;
  code: string;
  name: string;
  domain: Domain;
  purpose: GroupPurpose;
  org_unit_id: string;
  status: string;
  created_at: Date;
}

export interface GroupView {
  id: string;
  code: string;
  name: string;
  domain: Domain;
  purpose: GroupPurpose;
  orgUnitId: string;
  status: string;
}

const groupView = (r: GroupRow): GroupView => ({
  id: r.id,
  code: r.code,
  name: r.name,
  domain: r.domain,
  purpose: r.purpose,
  orgUnitId: r.org_unit_id,
  status: r.status,
});

export async function listGroups(db: Db) {
  return (await many<GroupRow>(db, 'SELECT * FROM business_groups ORDER BY code')).map(groupView);
}

export async function getGroup(db: Db, id: string): Promise<GroupView> {
  const row = await one<GroupRow>(db, 'SELECT * FROM business_groups WHERE id = $1', [id]);
  if (!row) throw notFound('group', id);
  return groupView(row);
}

export interface CreateGroupInput {
  id: string;
  code: string;
  name: string;
  domain: Domain;
  purpose: GroupPurpose;
  orgUnitId: string;
  /** Create on behalf of this workspace; the new group joins it. Required for workspace admins. */
  workspaceId?: string;
}

export async function createGroup(ctx: WriteCtx, input: CreateGroupInput): Promise<GroupView> {
  let workspace: WorkspaceRow | undefined;
  let delegated = false;
  if (input.workspaceId === undefined) {
    ctx.allow('org.manage', { type: 'group', id: input.id });
  } else {
    delegated = ctx.allow('group.create', { type: 'group', id: input.id, workspaceId: input.workspaceId }).role === 'WORKSPACE_ADMIN';
    workspace = await getWorkspaceRow(ctx.db, input.workspaceId, 'update');
    if (workspace.status !== 'ACTIVE') throw rule('WORKSPACE_ARCHIVED', `workspace ${workspace.id} is archived`);
  }
  assertSlug('group', input.id);
  if (!GROUP_CODE.test(input.code)) throw rule('INVALID_GROUP_CODE', `group code must match ${GROUP_CODE.source}`);
  await assertIdFree(ctx.db, 'business_groups', input.id, 'group');
  if (await one(ctx.db, 'SELECT 1 FROM business_groups WHERE code = $1', [input.code])) {
    throw conflict('GROUP_CODE_TAKEN', `group code ${input.code} is already used`);
  }
  const nested = await one<{ code: string }>(
    ctx.db,
    "SELECT code FROM business_groups WHERE starts_with($1, code || '.') OR starts_with(code, $1 || '.') LIMIT 1",
    [input.code],
  );
  if (nested) {
    throw conflict('GROUP_CODE_NESTED', `group code ${input.code} would nest with ${nested.code}; codes namespace policy ids`, {
      code: nested.code,
    });
  }
  const unit = await getOrgUnit(ctx.db, input.orgUnitId);
  if (unit.status !== 'ACTIVE') throw rule('UNIT_ARCHIVED', `organization unit ${unit.id} is archived`);
  if (workspace) {
    assertGroupUnitFitsWorkspace(workspace, unit);
    // A TEAM workspace only holds its own team's groups (as checkMembership enforces), and
    // delegated creation never reaches outside the workspace's unit.
    if ((workspace.kind === 'TEAM' || delegated) && !(await unitWithin(ctx.db, unit.id, workspace.org_unit_id))) {
      throw rule('UNIT_OUTSIDE_WORKSPACE', 'the group must belong to the workspace organization unit or below it');
    }
    if (delegated) {
      // Delegated creation is further limited to the workspace's domains.
      const scopes = await workspaceScopes(ctx.db, workspace.id);
      if (!scopes.includes(input.domain)) {
        throw rule('DOMAIN_OUTSIDE_WORKSPACE', `domain ${input.domain} is not in the workspace scopes`, { scopes });
      }
    }
  }

  const row = await one<GroupRow>(
    ctx.db,
    `INSERT INTO business_groups (id, code, name, domain, purpose, org_unit_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [input.id, input.code, input.name, input.domain, input.purpose, input.orgUnitId, ctx.actor.username],
  );
  if (workspace) {
    await ctx.db.query('INSERT INTO workspace_groups (workspace_id, group_id) VALUES ($1, $2)', [workspace.id, input.id]);
    await ctx.db.query('UPDATE workspaces SET revision = revision + 1, updated_at = now() WHERE id = $1', [workspace.id]);
  }
  return groupView(row!);
}

// ---------------------------------------------------------------------------
// Workspaces (工作区)
// ---------------------------------------------------------------------------

interface WorkspaceRow {
  id: string;
  name: string;
  kind: WorkspaceKind;
  org_unit_id: string;
  project_id: string | null;
  vehicle_model_id: string;
  status: string;
  revision: number;
  created_at: Date;
  updated_at: Date;
}

type LockMode = false | 'share' | 'update';
const LOCK_SQL = { share: ' FOR SHARE', update: ' FOR UPDATE' } as const;

async function getWorkspaceRow(db: Db, id: string, lock: LockMode = false): Promise<WorkspaceRow> {
  const row = await one<WorkspaceRow>(db, `SELECT * FROM workspaces WHERE id = $1${lock ? LOCK_SQL[lock] : ''}`, [id]);
  if (!row) throw notFound('workspace', id);
  return row;
}

async function workspaceScopes(db: Db, id: string): Promise<Scope[]> {
  return (await many<{ scope: Scope }>(db, 'SELECT scope FROM workspace_scopes WHERE workspace_id = $1 ORDER BY scope', [id])).map(
    (r) => r.scope,
  );
}

/** TEAM workspaces use team-tree groups beneath their unit; project workspaces use their project's groups. */
function assertGroupUnitFitsWorkspace(workspace: Pick<WorkspaceRow, 'kind' | 'project_id'>, unit: OrgUnitRow): void {
  if (workspace.kind === 'TEAM' ? unit.kind !== 'TEAM' : unit.kind !== 'PROJECT' || unit.project_id !== workspace.project_id) {
    throw rule('GROUP_TREE_MISMATCH', `group unit ${unit.id} does not belong to the workspace's organization tree`);
  }
}

export interface WorkspaceView {
  id: string;
  name: string;
  kind: WorkspaceKind;
  orgUnitId: string;
  orgPath: { id: string; name: string }[];
  projectId: string | null;
  vehicleModelId: string;
  status: string;
  revision: number;
  groupIds: string[];
  scopes: Scope[];
  sourceWorkspaceIds: string[];
}

async function workspaceView(db: Db, row: WorkspaceRow): Promise<WorkspaceView> {
  const groupIds = (
    await many<{ group_id: string }>(db, 'SELECT group_id FROM workspace_groups WHERE workspace_id = $1 ORDER BY group_id', [row.id])
  ).map((r) => r.group_id);
  const sources = (
    await many<{ source_workspace_id: string }>(
      db,
      'SELECT source_workspace_id FROM workspace_sources WHERE workspace_id = $1 ORDER BY source_workspace_id',
      [row.id],
    )
  ).map((r) => r.source_workspace_id);
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    orgUnitId: row.org_unit_id,
    orgPath: await unitPath(db, row.org_unit_id),
    projectId: row.project_id,
    vehicleModelId: row.vehicle_model_id,
    status: row.status,
    revision: row.revision,
    groupIds,
    scopes: await workspaceScopes(db, row.id),
    sourceWorkspaceIds: sources,
  };
}

function isPlatformOps(ctx: ReadCtx): boolean {
  return ctx.actor.grants.some((g) => g.role === 'PLATFORM_OPS');
}

function grantedWorkspaceIds(ctx: ReadCtx): Set<string> | 'all' {
  if (ctx.actor.grants.some((g) => g.workspaces.includes(WILDCARD))) return 'all';
  return new Set(ctx.actor.grants.flatMap((g) => g.workspaces));
}

/** Platform operations see every workspace; others see the active workspaces their grants cover. */
export async function listWorkspaces(ctx: ReadCtx): Promise<WorkspaceView[]> {
  const rows = await many<WorkspaceRow>(ctx.db, 'SELECT * FROM workspaces ORDER BY kind, id');
  const granted = grantedWorkspaceIds(ctx);
  const visible = isPlatformOps(ctx)
    ? rows
    : rows.filter((w) => w.status === 'ACTIVE' && (granted === 'all' || granted.has(w.id)));
  return Promise.all(visible.map((w) => workspaceView(ctx.db, w)));
}

export async function getWorkspace(ctx: ReadCtx, id: string): Promise<WorkspaceView> {
  const row = await getWorkspaceRow(ctx.db, id);
  const granted = grantedWorkspaceIds(ctx);
  const visible = isPlatformOps(ctx) || (row.status === 'ACTIVE' && (granted === 'all' || granted.has(id)));
  if (!visible) throw notFound('workspace', id);
  return workspaceView(ctx.db, row);
}

interface WorkspaceMembership {
  groupIds: string[];
  scopes: Scope[];
  sourceWorkspaceIds: string[];
}

async function checkMembership(
  db: Db,
  workspace: Pick<WorkspaceRow, 'id' | 'kind' | 'org_unit_id' | 'project_id' | 'vehicle_model_id'>,
  m: WorkspaceMembership,
): Promise<void> {
  const unique = (xs: string[]) => new Set(xs).size === xs.length;
  if (!unique(m.groupIds) || !unique(m.scopes) || !unique(m.sourceWorkspaceIds)) {
    throw rule('DUPLICATE_MEMBERS', 'groups, scopes and sources must not contain duplicates');
  }
  for (const groupId of m.groupIds) {
    const group = await one<GroupRow>(db, 'SELECT * FROM business_groups WHERE id = $1', [groupId]);
    if (!group) throw notFound('group', groupId);
    if (group.status !== 'ACTIVE') throw rule('GROUP_ARCHIVED', `group ${groupId} is archived`);
    const unit = await getOrgUnit(db, group.org_unit_id);
    assertGroupUnitFitsWorkspace(workspace, unit);
    if (workspace.kind === 'TEAM' && !(await unitWithin(db, unit.id, workspace.org_unit_id))) {
      throw rule('GROUP_OUTSIDE_TEAM', `group ${groupId} is not part of the workspace's team`);
    }
  }
  if (workspace.kind === 'TEAM' && m.sourceWorkspaceIds.length > 0) {
    throw rule('TEAM_HAS_NO_SOURCES', 'team workspaces maintain their own changes and take no sources');
  }
  for (const sourceId of m.sourceWorkspaceIds) {
    if (sourceId === workspace.id) throw rule('SELF_SOURCE', 'a workspace cannot be its own source');
    const source = await getWorkspaceRow(db, sourceId);
    if (source.status !== 'ACTIVE') throw rule('SOURCE_ARCHIVED', `source workspace ${sourceId} is archived`);
    if (source.vehicle_model_id !== workspace.vehicle_model_id) {
      throw rule('SOURCE_MODEL_MISMATCH', `source workspace ${sourceId} is for vehicle model ${source.vehicle_model_id}`);
    }
  }
}

async function writeMembership(db: Db, workspaceId: string, m: WorkspaceMembership): Promise<void> {
  await db.query('DELETE FROM workspace_groups WHERE workspace_id = $1', [workspaceId]);
  await db.query('DELETE FROM workspace_scopes WHERE workspace_id = $1', [workspaceId]);
  await db.query('DELETE FROM workspace_sources WHERE workspace_id = $1', [workspaceId]);
  await db.query('INSERT INTO workspace_groups (workspace_id, group_id) SELECT $1, unnest($2::text[])', [workspaceId, m.groupIds]);
  await db.query('INSERT INTO workspace_scopes (workspace_id, scope) SELECT $1, unnest($2::text[])', [workspaceId, m.scopes]);
  await db.query('INSERT INTO workspace_sources (workspace_id, source_workspace_id) SELECT $1, unnest($2::text[])', [
    workspaceId,
    m.sourceWorkspaceIds,
  ]);
}

export interface CreateWorkspaceInput extends WorkspaceMembership {
  id: string;
  name: string;
  kind: WorkspaceKind;
  orgUnitId: string;
  vehicleModelId: string;
}

export async function createWorkspace(ctx: WriteCtx, input: CreateWorkspaceInput): Promise<WorkspaceView> {
  ctx.allow('workspace.manage', { type: 'workspace', id: input.id });
  assertSlug('workspace', input.id);
  await assertIdFree(ctx.db, 'workspaces', input.id, 'workspace');
  const unit = await getOrgUnit(ctx.db, input.orgUnitId);
  if (unit.status !== 'ACTIVE') throw rule('UNIT_ARCHIVED', `organization unit ${unit.id} is archived`);
  // The workspace kind alone decides which organization tree it belongs to.
  if (input.kind === 'TEAM' && unit.kind !== 'TEAM') {
    throw rule('WORKSPACE_TREE_MISMATCH', 'a TEAM workspace must sit on a team organization unit');
  }
  if (input.kind !== 'TEAM') {
    if (unit.kind !== 'PROJECT') throw rule('WORKSPACE_TREE_MISMATCH', `a ${input.kind} workspace must sit on a project unit`);
    const project = await one<{ status: string }>(ctx.db, 'SELECT status FROM projects WHERE id = $1', [unit.project_id]);
    if (project?.status !== 'ESTABLISHED') throw rule('PROJECT_NOT_ESTABLISHED', `project ${unit.project_id} is not established`);
  }
  await requireActiveVehicleModel(ctx.db, input.vehicleModelId);
  const draft = {
    id: input.id,
    kind: input.kind,
    org_unit_id: unit.id,
    project_id: unit.project_id,
    vehicle_model_id: input.vehicleModelId,
  };
  await checkMembership(ctx.db, draft, input);
  const row = await one<WorkspaceRow>(
    ctx.db,
    `INSERT INTO workspaces (id, name, kind, org_unit_id, project_id, vehicle_model_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [input.id, input.name, input.kind, unit.id, unit.project_id, input.vehicleModelId, ctx.actor.username],
  );
  await writeMembership(ctx.db, input.id, input);
  return workspaceView(ctx.db, row!);
}

export interface UpdateWorkspaceInput extends Partial<WorkspaceMembership> {
  expectedRevision: number;
  name?: string;
}

export async function updateWorkspace(ctx: WriteCtx, id: string, input: UpdateWorkspaceInput): Promise<WorkspaceView> {
  ctx.allow('workspace.manage', { type: 'workspace', id, workspaceId: id });
  const row = await getWorkspaceRow(ctx.db, id, 'update');
  if (row.revision !== input.expectedRevision) throw revisionConflict('workspace', id, row.revision);
  if (row.status !== 'ACTIVE') throw rule('WORKSPACE_ARCHIVED', `workspace ${id} is archived`);
  const current = await workspaceView(ctx.db, row);
  const next: WorkspaceMembership = {
    groupIds: input.groupIds ?? current.groupIds,
    scopes: input.scopes ?? current.scopes,
    sourceWorkspaceIds: input.sourceWorkspaceIds ?? current.sourceWorkspaceIds,
  };
  await checkMembership(ctx.db, row, next);
  const removedGroups = current.groupIds.filter((g) => !next.groupIds.includes(g));
  if (removedGroups.length > 0) {
    const busy = await many<{ group_id: string }>(
      ctx.db,
      'SELECT DISTINCT group_id FROM features WHERE workspace_id = $1 AND group_id = ANY($2)',
      [id, removedGroups],
    );
    if (busy.length > 0) {
      throw rule('GROUP_IN_USE', 'groups with features in this workspace cannot be removed', {
        groupIds: busy.map((b) => b.group_id),
      });
    }
  }
  await writeMembership(ctx.db, id, next);
  const updated = await one<WorkspaceRow>(
    ctx.db,
    'UPDATE workspaces SET name = $2, revision = revision + 1, updated_at = now() WHERE id = $1 RETURNING *',
    [id, input.name ?? row.name],
  );
  return workspaceView(ctx.db, updated!);
}

/** Internal lookup used by other modules (no visibility filtering). */
export async function workspaceForAction(db: Db, id: string, lock: LockMode = false) {
  const row = await getWorkspaceRow(db, id, lock);
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    projectId: row.project_id,
    vehicleModelId: row.vehicle_model_id,
    groupIds: (
      await many<{ group_id: string }>(db, 'SELECT group_id FROM workspace_groups WHERE workspace_id = $1', [row.id])
    ).map((r) => r.group_id),
  };
}
