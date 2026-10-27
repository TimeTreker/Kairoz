// Organization (组织): vehicle models, projects, the team and project trees, business groups,
// and workspaces. The workspace kind alone decides which tree a workspace belongs to.

import type { Draft } from 'immer';
import { conflict, notFound, rule } from '../domain/errors.ts';
import { GROUP_CODE, newId, SLUG, VEHICLE_MODEL_ID } from '../domain/ids.ts';
import { WILDCARD } from '../domain/vocabulary.ts';
import type { Domain, GroupPurpose, Scope, WorkspaceKind } from '../domain/vocabulary.ts';
import type { Actor, Ctx } from './engine.ts';
import type { OrgUnit, State, Workspace } from './types.ts';

type S = Draft<State> | State;

function assertSlug(kind: string, id: string): void {
  if (!SLUG.test(id)) throw rule('INVALID_ID', `${kind} id must match ${SLUG.source}`, { id });
}

export function getUnit(s: S, id: string): OrgUnit {
  const unit = s.orgUnits[id];
  if (!unit) throw notFound('organization unit', id);
  return unit;
}

export function getWorkspace(s: S, id: string): Workspace {
  const ws = s.workspaces[id];
  if (!ws) throw notFound('workspace', id);
  return ws;
}

export function getGroup(s: S, id: string) {
  const group = s.groups[id];
  if (!group) throw notFound('group', id);
  return group;
}

/** Ancestor chain from the root down to (and including) `unitId`; stops on a cycle. */
export function unitPath(s: S, unitId: string): OrgUnit[] {
  const path: OrgUnit[] = [];
  const seen = new Set<string>();
  let current: OrgUnit | undefined = s.orgUnits[unitId];
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.unshift(current);
    current = current.parentId ? s.orgUnits[current.parentId] : undefined;
  }
  return path;
}

/** True if `unitId` is `ancestorId` or lies beneath it. */
export function unitWithin(s: S, unitId: string, ancestorId: string): boolean {
  return unitPath(s, unitId).some((u) => u.id === ancestorId);
}

export function createVehicleModel(ctx: Ctx, input: { id: string; name: string }): string {
  ctx.allow('org.manage', { type: 'vehicleModel', id: input.id });
  if (!VEHICLE_MODEL_ID.test(input.id)) throw rule('INVALID_ID', `vehicle model id must match ${VEHICLE_MODEL_ID.source}`);
  if (ctx.s.vehicleModels[input.id]) throw conflict('ID_TAKEN', `vehicle model ${input.id} already exists`);
  ctx.s.vehicleModels[input.id] = { id: input.id, name: input.name.trim() || input.id, status: 'ACTIVE' };
  return input.id;
}

/** Creates the project and the root of its own organization tree (same id). */
export function createProject(ctx: Ctx, input: { id: string; name: string; vehicleModelId?: string | null }): string {
  ctx.allow('org.manage', { type: 'project', id: input.id });
  assertSlug('project', input.id);
  if (ctx.s.projects[input.id] || ctx.s.orgUnits[input.id]) throw conflict('ID_TAKEN', `${input.id} already exists`);
  if (input.vehicleModelId && !ctx.s.vehicleModels[input.vehicleModelId]) throw notFound('vehicle model', input.vehicleModelId);
  ctx.s.projects[input.id] = { id: input.id, name: input.name, vehicleModelId: input.vehicleModelId ?? null, status: 'ESTABLISHED' };
  ctx.s.orgUnits[input.id] = { id: input.id, kind: 'PROJECT', projectId: input.id, parentId: null, name: input.name, status: 'ACTIVE', source: 'PLATFORM', externalId: null };
  return input.id;
}

export function createOrgUnit(ctx: Ctx, input: { id: string; name: string; parentId?: string | null }): string {
  ctx.allow('org.manage', { type: 'orgUnit', id: input.id });
  assertSlug('organization unit', input.id);
  if (ctx.s.orgUnits[input.id]) throw conflict('ID_TAKEN', `organization unit ${input.id} already exists`);
  let kind: 'TEAM' | 'PROJECT' = 'TEAM';
  let projectId: string | null = null;
  if (input.parentId) {
    const parent = getUnit(ctx.s, input.parentId);
    if (parent.source === 'DIRECTORY') throw rule('DIRECTORY_MANAGED', 'the team tree here mirrors the company directory; change it there');
    if (parent.status !== 'ACTIVE') throw rule('PARENT_ARCHIVED', `parent ${parent.id} is archived`);
    kind = parent.kind;
    projectId = parent.projectId;
  }
  ctx.s.orgUnits[input.id] = { id: input.id, kind, projectId, parentId: input.parentId ?? null, name: input.name, status: 'ACTIVE', source: 'PLATFORM', externalId: null };
  return input.id;
}

/** Rename and/or move. Moves stay within one tree, never create cycles or break TEAM workspaces. */
export function updateOrgUnit(ctx: Ctx, id: string, input: { name?: string; parentId?: string | null }): void {
  ctx.allow('org.manage', { type: 'orgUnit', id });
  const unit = getUnit(ctx.s, id);
  if (unit.source === 'DIRECTORY') throw rule('DIRECTORY_MANAGED', 'this unit mirrors the company directory; change it there');
  if (input.name !== undefined && input.name !== unit.name) {
    noteChange(ctx, 'RENAMED', 'ORG_UNIT', id, unit.name, input.name);
    unit.name = input.name;
  }
  if (input.parentId !== undefined && input.parentId !== unit.parentId) {
    const before = unitPath(ctx.s, id).map((u) => u.name).join(' / ');
    if (unit.kind === 'PROJECT' && unit.parentId === null) throw rule('PROJECT_ROOT_FIXED', 'a project root cannot be moved');
    if (input.parentId === null) {
      if (unit.kind === 'PROJECT') throw rule('PARENT_REQUIRED', 'project units need a parent');
    } else {
      const parent = getUnit(ctx.s, input.parentId);
      if (parent.kind !== unit.kind || parent.projectId !== unit.projectId) {
        throw rule('CROSS_TREE_MOVE', 'a unit can only move within its own organization tree');
      }
      if (parent.status !== 'ACTIVE') throw rule('PARENT_ARCHIVED', `parent ${parent.id} is archived`);
      if (unitWithin(ctx.s, parent.id, id)) throw rule('ORG_CYCLE', 'a unit cannot move beneath itself');
    }
    unit.parentId = input.parentId;
    assertTeamWorkspacesIntact(ctx.s);
    // Ids stay; the record keeps where the unit sat before.
    noteChange(ctx, 'MOVED', 'ORG_UNIT', id, before, unitPath(ctx.s, id).map((u) => u.name).join(' / '));
  }
}

/** A change of name, place or sources, kept with what it was before. */
function noteChange(ctx: Ctx, kind: 'RENAMED' | 'MOVED' | 'SOURCES_CHANGED', object: 'WORKSPACE' | 'ORG_UNIT', objectId: string, before: string, after: string): void {
  ctx.s.lifecycleEvents.push({ id: newId('lc'), seq: ctx.seq(), kind, object, objectId, reason: '', by: ctx.user().username, at: ctx.now, before, after });
}

/**
 * What a source workspace still takes part in, in this merge workspace: open merge previews and
 * candidates holding its Features, and open integration calls collecting from it.
 */
export function sourceInUse(s: State, workspaceId: string, sourceId: string): string[] {
  const problems: string[] = [];
  const fromSource = (featureIds: string[]) => featureIds.some((f) => s.features[f]?.workspaceId === sourceId);
  for (const p of Object.values(s.mergePlans)) {
    if (p.workspaceId === workspaceId && ['READY', 'CONFLICT', 'BLOCKED'].includes(p.status) && fromSource(p.sources.map((x) => x.featureId))) problems.push(`merge preview ${p.id} is open`);
  }
  for (const c of Object.values(s.candidates)) {
    if (c.workspaceId === workspaceId && ['CANDIDATE', 'TESTING', 'VERIFIED'].includes(c.status) && fromSource(c.sources.map((x) => x.featureId))) problems.push(`candidate ${c.label} is open`);
  }
  for (const c of Object.values(s.integrationCalls)) {
    if (c.workspaceId === workspaceId && c.status === 'OPEN' && c.modules.some((m) => m.workspaceId === sourceId && m.status !== 'EXCLUDED')) problems.push(`integration call ${c.title} is open`);
  }
  return problems;
}

/**
 * Re-attaches a workspace to another org unit, e.g. after its directory department was merged away.
 * A team's business groups that sat on its old unit move with it; codes, data keys and grants stay.
 */
export function moveWorkspaceUnit(ctx: Ctx, workspaceId: string, orgUnitId: string): void {
  ctx.allow('workspace.manage', { type: 'workspace', id: workspaceId, workspaceId });
  const ws = getWorkspace(ctx.s, workspaceId);
  const unit = getUnit(ctx.s, orgUnitId);
  if (unit.status !== 'ACTIVE') throw rule('UNIT_ARCHIVED', `organization unit ${unit.id} is archived`);
  if (ws.kind === 'TEAM' ? unit.kind !== 'TEAM' : unit.kind !== 'PROJECT' || unit.projectId !== ws.projectId) {
    throw rule('WORKSPACE_TREE_MISMATCH', 'the unit is in another organization tree than the workspace');
  }
  const old = ws.orgUnitId;
  if (ws.kind === 'TEAM') {
    for (const g of ws.groupIds) {
      const group = ctx.s.groups[g]!;
      if (group.orgUnitId === old) group.orgUnitId = unit.id;
    }
  }
  ws.orgUnitId = unit.id;
  checkMembership(ctx.s, ws, ws, ws.groupIds);
  assertTeamWorkspacesIntact(ctx.s);
}

/** Re-attaches a business group to another unit of the same tree. Its code and data keys never change. */
export function moveGroupUnit(ctx: Ctx, groupId: string, orgUnitId: string): void {
  ctx.allow('org.manage', { type: 'group', id: groupId });
  const group = getGroup(ctx.s, groupId);
  const unit = getUnit(ctx.s, orgUnitId);
  if (unit.status !== 'ACTIVE') throw rule('UNIT_ARCHIVED', `organization unit ${unit.id} is archived`);
  const current = ctx.s.orgUnits[group.orgUnitId];
  if (current && (current.kind !== unit.kind || current.projectId !== unit.projectId)) throw rule('CROSS_TREE_MOVE', 'a group can only move within its own organization tree');
  group.orgUnitId = unit.id;
  assertTeamWorkspacesIntact(ctx.s);
}

/** Workspaces and business groups whose org unit no longer exists (组织节点已失效). */
export function orphanedOrgObjects(s: State): { workspaces: string[]; groups: string[] } {
  const gone = (unitId: string) => s.orgUnits[unitId]?.status !== 'ACTIVE';
  return {
    workspaces: Object.values(s.workspaces)
      .filter((w) => w.status === 'ACTIVE' && gone(w.orgUnitId))
      .map((w) => w.id),
    groups: Object.values(s.groups)
      .filter((g) => g.status === 'ACTIVE' && gone(g.orgUnitId))
      .map((g) => g.id),
  };
}

/** A TEAM workspace only holds groups of its own team. */
function assertTeamWorkspacesIntact(s: Draft<State>): void {
  const broken = Object.values(s.workspaces).flatMap((w) =>
    w.kind === 'TEAM'
      ? w.groupIds.filter((g) => !unitWithin(s, getGroup(s, g).orgUnitId, w.orgUnitId)).map((groupId) => ({ workspaceId: w.id, groupId }))
      : [],
  );
  if (broken.length) {
    throw rule('GROUP_OUTSIDE_TEAM', 'the change would leave team workspaces with groups outside their team', { memberships: broken });
  }
}

function assertGroupUnitFitsWorkspace(workspace: Pick<Workspace, 'kind' | 'projectId'>, unit: OrgUnit): void {
  if (workspace.kind === 'TEAM' ? unit.kind !== 'TEAM' : unit.kind !== 'PROJECT' || unit.projectId !== workspace.projectId) {
    throw rule('GROUP_TREE_MISMATCH', `group unit ${unit.id} does not belong to the workspace's organization tree`);
  }
}

export interface GroupInput {
  id: string;
  code: string;
  name: string;
  domain: Domain;
  purpose: GroupPurpose;
  orgUnitId: string;
  /** Create on behalf of this workspace; the new group joins it. Required for workspace admins. */
  workspaceId?: string;
}

export function createGroup(ctx: Ctx, input: GroupInput): string {
  let delegated = false;
  if (input.workspaceId === undefined) {
    ctx.allow('org.manage', { type: 'group', id: input.id });
  } else {
    delegated = ctx.allow('group.create', { type: 'group', id: input.id, workspaceId: input.workspaceId }).role === 'WORKSPACE_ADMIN';
  }
  assertSlug('group', input.id);
  if (!GROUP_CODE.test(input.code)) throw rule('INVALID_GROUP_CODE', `group code must match ${GROUP_CODE.source}`);
  if (ctx.s.groups[input.id]) throw conflict('ID_TAKEN', `group ${input.id} already exists`);
  const groups = Object.values(ctx.s.groups);
  if (groups.some((g) => g.code === input.code)) throw conflict('GROUP_CODE_TAKEN', `group code ${input.code} is already used`);
  const nested = groups.find((g) => input.code.startsWith(`${g.code}.`) || g.code.startsWith(`${input.code}.`));
  if (nested) throw conflict('GROUP_CODE_NESTED', `group code ${input.code} would nest with ${nested.code}`, { code: nested.code });
  const unit = getUnit(ctx.s, input.orgUnitId);
  if (unit.status !== 'ACTIVE') throw rule('UNIT_ARCHIVED', `organization unit ${unit.id} is archived`);
  const workspace = input.workspaceId === undefined ? undefined : getWorkspace(ctx.s, input.workspaceId);
  if (workspace) {
    if (workspace.status !== 'ACTIVE') throw rule('WORKSPACE_ARCHIVED', `workspace ${workspace.id} is archived`);
    assertGroupUnitFitsWorkspace(workspace, unit);
    if ((workspace.kind === 'TEAM' || delegated) && !unitWithin(ctx.s, unit.id, workspace.orgUnitId)) {
      throw rule('UNIT_OUTSIDE_WORKSPACE', 'the group must belong to the workspace organization unit or below it');
    }
    if (delegated && !workspace.scopes.includes(input.domain)) {
      throw rule('DOMAIN_OUTSIDE_WORKSPACE', `domain ${input.domain} is not in the workspace scopes`, { scopes: workspace.scopes });
    }
  }
  ctx.s.groups[input.id] = {
    id: input.id,
    code: input.code,
    name: input.name,
    domain: input.domain,
    purpose: input.purpose,
    orgUnitId: unit.id,
    status: 'ACTIVE',
  };
  if (workspace) workspace.groupIds.push(input.id);
  return input.id;
}

interface Membership {
  groupIds: string[];
  scopes: Scope[];
  sourceWorkspaceIds: string[];
}

/** `held` are the groups the workspace already holds: an archived one may stay, never be added. */
function checkMembership(s: Draft<State>, workspace: Pick<Workspace, 'id' | 'kind' | 'orgUnitId' | 'projectId' | 'vehicleModelId'>, m: Membership, held: string[] = []): void {
  const unique = (xs: string[]) => new Set(xs).size === xs.length;
  if (!unique(m.groupIds) || !unique(m.scopes) || !unique(m.sourceWorkspaceIds)) {
    throw rule('DUPLICATE_MEMBERS', 'groups, scopes and sources must not contain duplicates');
  }
  for (const groupId of m.groupIds) {
    const group = getGroup(s, groupId);
    if (group.status !== 'ACTIVE' && !held.includes(groupId)) throw rule('GROUP_ARCHIVED', `group ${groupId} is archived`);
    const unit = getUnit(s, group.orgUnitId);
    // Project and integration workspaces integrate the configurations of team groups as well as
    // their own; team workspaces hold only groups of their own team.
    if (workspace.kind === 'TEAM') {
      assertGroupUnitFitsWorkspace(workspace, unit);
      if (!unitWithin(s, unit.id, workspace.orgUnitId)) throw rule('GROUP_OUTSIDE_TEAM', `group ${groupId} is not part of the workspace's team`);
    } else if (unit.kind === 'PROJECT' && unit.projectId !== workspace.projectId) {
      throw rule('GROUP_TREE_MISMATCH', `group unit ${unit.id} belongs to another project`);
    }
  }
  if (workspace.kind === 'TEAM' && m.sourceWorkspaceIds.length > 0) {
    throw rule('TEAM_HAS_NO_SOURCES', 'team workspaces maintain their own changes and take no sources');
  }
  for (const sourceId of m.sourceWorkspaceIds) {
    if (sourceId === workspace.id) throw rule('SELF_SOURCE', 'a workspace cannot be its own source');
    const source = getWorkspace(s, sourceId);
    if (source.status !== 'ACTIVE') throw rule('SOURCE_ARCHIVED', `source workspace ${sourceId} is archived`);
    if (source.vehicleModelId !== workspace.vehicleModelId) {
      throw rule('SOURCE_MODEL_MISMATCH', `source workspace ${sourceId} is for vehicle model ${source.vehicleModelId}`);
    }
  }
}

export interface WorkspaceInput extends Membership {
  id: string;
  name: string;
  kind: WorkspaceKind;
  orgUnitId: string;
  vehicleModelId: string;
}

export function createWorkspace(ctx: Ctx, input: WorkspaceInput): string {
  ctx.allow('workspace.manage', { type: 'workspace', id: input.id });
  assertSlug('workspace', input.id);
  if (ctx.s.workspaces[input.id]) throw conflict('ID_TAKEN', `workspace ${input.id} already exists`);
  const unit = getUnit(ctx.s, input.orgUnitId);
  if (unit.status !== 'ACTIVE') throw rule('UNIT_ARCHIVED', `organization unit ${unit.id} is archived`);
  if (input.kind === 'TEAM' && unit.kind !== 'TEAM') throw rule('WORKSPACE_TREE_MISMATCH', 'a TEAM workspace must sit on a team unit');
  if (input.kind !== 'TEAM') {
    if (unit.kind !== 'PROJECT') throw rule('WORKSPACE_TREE_MISMATCH', `a ${input.kind} workspace must sit on a project unit`);
    if (ctx.s.projects[unit.projectId!]?.status !== 'ESTABLISHED') {
      throw rule('PROJECT_NOT_ESTABLISHED', `project ${unit.projectId} is not established`);
    }
  }
  const model = ctx.s.vehicleModels[input.vehicleModelId];
  if (!model) throw notFound('vehicle model', input.vehicleModelId);
  if (model.status !== 'ACTIVE') throw rule('VEHICLE_MODEL_RETIRED', `vehicle model ${model.id} is retired`);
  const draft = { id: input.id, kind: input.kind, orgUnitId: unit.id, projectId: unit.projectId, vehicleModelId: input.vehicleModelId };
  checkMembership(ctx.s, draft, input);
  ctx.s.workspaces[input.id] = {
    ...draft,
    name: input.name,
    status: 'ACTIVE',
    groupIds: [...input.groupIds],
    scopes: [...input.scopes],
    sourceWorkspaceIds: [...input.sourceWorkspaceIds],
  };
  return input.id;
}

export function updateWorkspace(ctx: Ctx, id: string, input: Partial<Membership> & { name?: string }): void {
  ctx.allow('workspace.manage', { type: 'workspace', id, workspaceId: id });
  const ws = getWorkspace(ctx.s, id);
  if (ws.status !== 'ACTIVE') throw rule('WORKSPACE_ARCHIVED', `workspace ${id} is archived`);
  const next: Membership = {
    groupIds: input.groupIds ?? ws.groupIds,
    scopes: input.scopes ?? ws.scopes,
    sourceWorkspaceIds: input.sourceWorkspaceIds ?? ws.sourceWorkspaceIds,
  };
  checkMembership(ctx.s, ws, next, ws.groupIds);
  const removed = ws.groupIds.filter((g) => !next.groupIds.includes(g));
  const busy = removed.filter((g) => Object.values(ctx.s.features).some((f) => f.workspaceId === id && f.groupId === g));
  if (busy.length) throw rule('GROUP_IN_USE', 'groups with features in this workspace cannot be removed', { groupIds: busy });
  // A source taken away mid-integration would leave previews, candidates or calls built on it.
  const droppedSources = ws.sourceWorkspaceIds.filter((w) => !next.sourceWorkspaceIds.includes(w));
  const inUse = droppedSources.flatMap((w) => sourceInUse(ctx.s, id, w).map((p) => `${ctx.s.workspaces[w]?.name ?? w}: ${p}`));
  if (inUse.length) throw rule('SOURCE_IN_USE', 'a source still takes part in an unfinished integration', { issues: inUse });
  const sourceNames = (ids: string[]) => ids.map((w) => ctx.s.workspaces[w]?.name ?? w).join('、') || '—';
  if (sourceNames(ws.sourceWorkspaceIds) !== sourceNames(next.sourceWorkspaceIds)) noteChange(ctx, 'SOURCES_CHANGED', 'WORKSPACE', id, sourceNames(ws.sourceWorkspaceIds), sourceNames(next.sourceWorkspaceIds));
  ws.groupIds = [...next.groupIds];
  ws.scopes = [...next.scopes];
  ws.sourceWorkspaceIds = [...next.sourceWorkspaceIds];
  if (input.name !== undefined) ws.name = input.name;
}

/** Platform operations see every workspace; others the active workspaces their grants cover. */
export function visibleWorkspaces(state: State, actor: Actor): Workspace[] {
  const all = Object.values(state.workspaces).sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
  if (actor.grants.some((g) => g.role === 'PLATFORM_OPS')) return all;
  if (actor.grants.some((g) => g.workspaces.includes(WILDCARD))) return all.filter((w) => w.status === 'ACTIVE');
  const granted = new Set(actor.grants.flatMap((g) => g.workspaces));
  return all.filter((w) => w.status === 'ACTIVE' && granted.has(w.id));
}
