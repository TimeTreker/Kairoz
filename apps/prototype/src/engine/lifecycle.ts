// Archiving and restoring (归档与恢复) workspaces, business groups and organization units. An
// archive needs everything in flight finished first: Features, candidates, merge previews,
// running instances, reservations, loans and dispatches. Nothing is deleted: vehicles, history,
// published configurations and events keep pointing at what they referenced. An archived
// workspace is closed to every action until platform operations restore it.

import { authorize } from '../domain/authz.ts';
import { conflict, rule } from '../domain/errors.ts';
import { newId } from '../domain/ids.ts';
import type { Ctx } from './engine.ts';
import { membersOf } from './fleet.ts';
import { getGroup, getUnit, getWorkspace } from './org.ts';
import type { LifecycleEvent, State } from './types.ts';

const OPEN_FEATURE = ['DRAFT', 'SUBMITTED', 'DCL_READY', 'TESTING', 'VERIFIED'];
const OPEN_CANDIDATE = ['CANDIDATE', 'TESTING', 'VERIFIED'];
const OPEN_PLAN = ['READY', 'CONFLICT', 'BLOCKED'];

function record(ctx: Ctx, kind: LifecycleEvent['kind'], object: LifecycleEvent['object'], objectId: string, reason: string): void {
  ctx.s.lifecycleEvents.push({ id: newId('lc'), seq: ctx.seq(), kind, object, objectId, reason, by: ctx.user().username, at: ctx.now });
}

function reasonOf(reason: string): string {
  if (!reason.trim()) throw rule('REASON_REQUIRED', 'give a reason');
  return reason.trim();
}

/** What keeps a workspace from being archived (empty when nothing does). */
export function workspaceArchiveProblems(s: State, workspaceId: string): string[] {
  const ws = s.workspaces[workspaceId];
  if (!ws) return [];
  const problems: string[] = [];
  for (const other of Object.values(s.workspaces)) {
    if (other.status === 'ACTIVE' && other.id !== ws.id && other.sourceWorkspaceIds.includes(ws.id)) problems.push(`workspace ${other.name} takes it as a source`);
  }
  for (const f of Object.values(s.features)) {
    if (f.workspaceId === ws.id && OPEN_FEATURE.includes(f.stage)) problems.push(`Feature ${f.name} is in stage ${f.stage}`);
  }
  for (const c of Object.values(s.candidates)) {
    if ((c.workspaceId === ws.id || c.testWorkspaceId === ws.id) && OPEN_CANDIDATE.includes(c.status)) problems.push(`candidate ${c.label} is open`);
  }
  for (const p of Object.values(s.mergePlans)) {
    if (p.workspaceId === ws.id && OPEN_PLAN.includes(p.status)) problems.push(`merge preview ${p.id} is open`);
  }
  for (const vg of Object.values(s.vehicleGroups)) {
    if (vg.workspaceId === ws.id && vg.status === 'ACTIVE' && membersOf(s, vg.id).length) problems.push(`vehicle group ${vg.name} has vehicles`);
  }
  for (const rid of s.workspaceResources[ws.id] ?? []) {
    const r = s.resources[rid];
    if (!r) continue;
    if (r.instance === 'RUNNING' && !r.personal && r.homeWorkspaceId === ws.id) problems.push(`simulation ${r.id} is running`);
    if (r.reservation) problems.push(`${r.id} is reserved`);
  }
  for (const r of Object.values(s.resources)) {
    if (r.personal && r.homeWorkspaceId === ws.id && r.status !== 'RETIRED') problems.push(`personal simulation ${r.id} of ${r.personal.owner} is in use`);
  }
  for (const l of Object.values(s.loans)) {
    if ((l.status === 'REQUESTED' || l.status === 'APPROVED') && (l.workspaceId === ws.id || l.lenders.some((x) => x.workspaceId === ws.id))) problems.push(`the loan of ${l.resourceId} is open`);
  }
  for (const d of Object.values(s.deployments)) {
    if (d.workspaceId === ws.id && (d.status === 'PENDING' || d.status === 'PAUSED')) problems.push(`dispatch ${d.id} is not finished`);
  }
  return problems;
}

/** The workspace's admin or platform operations archive a workspace whose work is all finished. */
export function archiveWorkspace(ctx: Ctx, workspaceId: string, reason: string): void {
  const ws = getWorkspace(ctx.s, workspaceId);
  const target = { type: 'workspace' as const, id: ws.id, workspaceId: ws.id };
  ctx.allow(authorize(ctx.user().grants, 'workspace.manage', target).ok ? 'workspace.manage' : 'workspace.archive', target);
  if (ws.status !== 'ACTIVE') throw conflict('ALREADY_ARCHIVED', `${ws.name} is already archived`);
  const note = reasonOf(reason);
  const problems = workspaceArchiveProblems(ctx.s, ws.id);
  if (problems.length) throw rule('ARCHIVE_BLOCKED', 'finish what is in flight first', { issues: problems });
  ws.status = 'ARCHIVED';
  record(ctx, 'ARCHIVED', 'WORKSPACE', ws.id, note);
}

/** What keeps an archived workspace from coming back (empty when nothing does). */
export function workspaceRestoreProblems(s: State, workspaceId: string): string[] {
  const ws = s.workspaces[workspaceId];
  if (!ws) return [];
  const problems: string[] = [];
  if (s.orgUnits[ws.orgUnitId]?.status !== 'ACTIVE') problems.push(`organization unit ${s.orgUnits[ws.orgUnitId]?.name ?? ws.orgUnitId} is archived`);
  // An archived business group may stay with the workspace: it stays archived, with no new Feature.
  for (const src of ws.sourceWorkspaceIds) if (s.workspaces[src]?.status !== 'ACTIVE') problems.push(`source workspace ${s.workspaces[src]?.name ?? src} is archived`);
  return problems;
}

/** Platform operations restore a workspace whose organization unit and sources still stand. */
export function restoreWorkspace(ctx: Ctx, workspaceId: string, reason: string): void {
  const ws = getWorkspace(ctx.s, workspaceId);
  ctx.allow('workspace.manage', { type: 'workspace', id: ws.id, workspaceId: ws.id });
  if (ws.status === 'ACTIVE') throw conflict('NOT_ARCHIVED', `${ws.name} is not archived`);
  const note = reasonOf(reason);
  const problems = workspaceRestoreProblems(ctx.s, ws.id);
  if (problems.length) throw rule('RESTORE_BLOCKED', 'what the workspace stands on is archived', { issues: problems });
  ws.status = 'ACTIVE';
  record(ctx, 'RESTORED', 'WORKSPACE', ws.id, note);
}

/** Workspaces that hold the business group, archived ones included. */
export function workspacesOfGroup(s: State, groupId: string): string[] {
  return Object.values(s.workspaces)
    .filter((w) => w.groupIds.includes(groupId))
    .map((w) => w.id)
    .sort();
}

/** What keeps a business group from being archived (empty when nothing does). */
export function groupArchiveProblems(s: State, groupId: string): string[] {
  const problems: string[] = [];
  for (const f of Object.values(s.features)) {
    if (f.groupId === groupId && OPEN_FEATURE.includes(f.stage)) problems.push(`Feature ${f.name} is in stage ${f.stage}`);
  }
  for (const vg of Object.values(s.vehicleGroups)) {
    if (vg.groupId === groupId && vg.status === 'ACTIVE' && membersOf(s, vg.id).length) problems.push(`vehicle group ${vg.name} has vehicles`);
  }
  for (const r of Object.values(s.resources)) {
    if (r.personal?.groupId === groupId && r.status !== 'RETIRED') problems.push(`personal simulation ${r.id} of ${r.personal.owner} is in use`);
  }
  for (const d of Object.values(s.deployments)) {
    if (d.groupId === groupId && (d.status === 'PENDING' || d.status === 'PAUSED')) problems.push(`dispatch ${d.id} is not finished`);
  }
  for (const l of Object.values(s.loans)) {
    if ((l.status === 'REQUESTED' || l.status === 'APPROVED') && s.vehicleGroups[l.vehicleGroupId]?.groupId === groupId) problems.push(`the loan of ${l.resourceId} is open`);
  }
  return problems;
}

/**
 * A business group is archived by the admin of every workspace that holds it, or by platform
 * operations. Its files, policies and commits stay; no new Feature starts in it.
 */
export function archiveGroup(ctx: Ctx, groupId: string, reason: string): void {
  const g = getGroup(ctx.s, groupId);
  const holders = workspacesOfGroup(ctx.s, g.id);
  const asOps = authorize(ctx.user().grants, 'org.manage', {}).ok;
  // An archived holder refuses its admin's archive (WORKSPACE_ARCHIVED): platform operations decide then.
  if (asOps || holders.length === 0) ctx.allow('org.manage', { type: 'group', id: g.id });
  else for (const ws of holders) ctx.allow('group.archive', { type: 'group', id: g.id, workspaceId: ws });
  if (g.status !== 'ACTIVE') throw conflict('ALREADY_ARCHIVED', `${g.name} is already archived`);
  const note = reasonOf(reason);
  const problems = groupArchiveProblems(ctx.s, g.id);
  if (problems.length) throw rule('ARCHIVE_BLOCKED', 'finish what is in flight first', { issues: problems });
  g.status = 'ARCHIVED';
  record(ctx, 'ARCHIVED', 'GROUP', g.id, note);
}

/** What keeps an organization unit from being archived (empty when nothing does). */
export function unitArchiveProblems(s: State, unitId: string): string[] {
  const problems: string[] = [];
  for (const u of Object.values(s.orgUnits)) if (u.parentId === unitId && u.status === 'ACTIVE') problems.push(`unit ${u.name} is active`);
  for (const g of Object.values(s.groups)) if (g.orgUnitId === unitId && g.status === 'ACTIVE') problems.push(`group ${g.name} is active`);
  for (const w of Object.values(s.workspaces)) if (w.orgUnitId === unitId && w.status === 'ACTIVE') problems.push(`workspace ${w.name} is active`);
  return problems;
}

/** Platform operations archive a unit with nothing active under it. Directory units follow the directory. */
export function archiveOrgUnit(ctx: Ctx, unitId: string, reason: string): void {
  const unit = getUnit(ctx.s, unitId);
  ctx.allow('org.manage', { type: 'orgUnit', id: unit.id });
  if (unit.source === 'DIRECTORY') throw rule('DIRECTORY_MANAGED', 'this unit mirrors the company directory; change it there');
  if (unit.status !== 'ACTIVE') throw conflict('ALREADY_ARCHIVED', `${unit.name} is already archived`);
  const note = reasonOf(reason);
  const problems = unitArchiveProblems(ctx.s, unit.id);
  if (problems.length) throw rule('ARCHIVE_BLOCKED', 'archive what is under it first', { issues: problems });
  unit.status = 'ARCHIVED';
  record(ctx, 'ARCHIVED', 'ORG_UNIT', unit.id, note);
}

/** The archive and restore history of one object, newest first. */
export function lifecycleOf(s: State, objectId: string): LifecycleEvent[] {
  return s.lifecycleEvents.filter((e) => e.objectId === objectId).sort((a, b) => b.seq - a.seq);
}

