// Borrowing (借用). A workspace uses, for a limited time, a vehicle it cannot simply add: one of
// another pool, or one another workspace uses. Its workspace admin asks with a vehicle group the
// car will join and a last day. Workspaces using the car agree first, then vehicle resources
// approve: the car leaves the lender's group and joins the borrower's, where it follows what was
// dispatched to the group. Ownership, pool and environment never change. Once overdue, nothing new
// is dispatched to it; the borrower asks for more time or returns it, or vehicle resources recall
// it. The platform never ends a loan by itself. A returned car keeps its configuration and
// software, and its lenders put it back into a group themselves.

import type { Draft } from 'immer';
import { authorize } from '../domain/authz.ts';
import { conflict, notFound, rule } from '../domain/errors.ts';
import { newId } from '../domain/ids.ts';
import { addDays, todayOf } from './clock.ts';
import type { Actor, Ctx } from './engine.ts';
import { activeLoanOf, assertIdle, assignableVehicles, getResource, isOverdue, joinGroup, leaveGroup, openOtaOf, pendingDeploymentOf, pendingImageChangeOf, pendingSoftwareUpdateOf } from './fleet.ts';
import { getWorkspace } from './org.ts';
import type { Loan, Resource, State, Workspace } from './types.ts';

/** The longest loan, and the longest extension from today. */
export const MAX_LOAN_DAYS = 90;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function getLoan(s: State, id: string): Loan {
  const l = s.loans[id];
  if (!l) throw notFound('loan', id);
  return l;
}

/** Workspaces other than `except` that use the vehicle now; an archived workspace uses nothing. */
export function usersOf(s: State, resourceId: string, except?: string): string[] {
  return Object.keys(s.workspaceResources)
    .filter((ws) => ws !== except && s.workspaces[ws]?.status !== 'ARCHIVED' && (s.workspaceResources[ws] ?? []).includes(resourceId))
    .sort();
}

/** Production vehicles and personal simulations are never lent; nor are retired ones. */
function lendable(r: Resource, ws: Workspace): boolean {
  return r.env !== 'production' && !r.personal && r.status !== 'RETIRED' && r.vehicleModelId === ws.vehicleModelId;
}

function validDueDate(s: State, date: string, after: string): boolean {
  return DATE.test(date) && !Number.isNaN(Date.parse(date)) && date > after && date <= addDays(todayOf(s), MAX_LOAN_DAYS);
}

export interface CatalogEntry {
  resourceId: string;
  displayName: string;
  type: Resource['type'];
  env: Resource['env'];
  pool: Resource['pool'];
  status: Resource['status'];
  integrationVersion: string | null;
  softwareStatus: Resource['softwareStatus'];
  /** Workspaces using the vehicle; each agrees before vehicle resources approve. */
  usedBy: string[];
  /** The workspace it is lent to now, and its last day. */
  lentTo: { workspaceId: string; dueDate: string } | null;
  /** The workspace could add it directly (its own pool, nobody uses it); no loan needed. */
  direct: boolean;
  /** This workspace's open request or loan of it. */
  openLoanId: string | null;
}

/**
 * Vehicles a workspace could borrow: what it needs to choose one and nothing more. Configuration,
 * client reports and test results carry other groups' data and stay hidden until a loan is approved.
 */
export function loanCatalog(s: State, workspaceId: string): CatalogEntry[] {
  const ws = s.workspaces[workspaceId];
  if (!ws) return [];
  const mine = new Set(s.workspaceResources[workspaceId] ?? []);
  const assignable = new Set(assignableVehicles(s, workspaceId).map((r) => r.id));
  return Object.values(s.resources)
    .filter((r) => !mine.has(r.id) && lendable(r, ws))
    .map((r) => {
      const usedBy = usersOf(s, r.id, workspaceId);
      const lent = activeLoanOf(s, r.id);
      const open = Object.values(s.loans).find((l) => l.resourceId === r.id && l.workspaceId === workspaceId && (l.status === 'REQUESTED' || l.status === 'APPROVED'));
      return {
        resourceId: r.id,
        displayName: r.displayName,
        type: r.type,
        env: r.env,
        pool: r.pool,
        status: r.status,
        integrationVersion: r.integrationVersion,
        softwareStatus: r.softwareStatus,
        usedBy,
        lentTo: lent ? { workspaceId: lent.workspaceId, dueDate: lent.dueDate } : null,
        direct: assignable.has(r.id) && usedBy.length === 0,
        openLoanId: open?.id ?? null,
      };
    })
    .sort((a, b) => (a.type === b.type ? a.resourceId.localeCompare(b.resourceId) : a.type === 'PHYSICAL' ? -1 : 1));
}

/** Asking, withdrawing, extending and returning belong to the borrowing workspace's admin. */
function allowBorrower(ctx: Ctx, l: Pick<Loan, 'id' | 'workspaceId'>, r: Resource) {
  return ctx.allow('loan.request', { type: 'loan', id: l.id, workspaceId: l.workspaceId, scope: r.pool, env: r.env });
}

function allowResources(ctx: Ctx, l: Pick<Loan, 'id'>, r: Resource) {
  return ctx.allow('resource.manage', { type: 'loan', id: l.id, scope: r.pool, env: r.env });
}

/** The borrowing workspace's admin asks for a vehicle, for one of its vehicle groups, until a last day. */
export function requestLoan(ctx: Ctx, input: { workspaceId: string; resourceId: string; vehicleGroupId: string; dueDate: string; purpose: string }): string {
  const ws = getWorkspace(ctx.s, input.workspaceId);
  const r = getResource(ctx.s, input.resourceId);
  ctx.allow('loan.request', { type: 'loan', id: r.id, workspaceId: ws.id, scope: r.pool, env: r.env });
  if (!lendable(r, ws)) throw rule('LOAN_NOT_LENDABLE', `${r.id} cannot be lent: production vehicles, personal simulations, retired vehicles and other models never are`);
  if ((ctx.s.workspaceResources[ws.id] ?? []).includes(r.id)) throw rule('ALREADY_IN_WORKSPACE', `${r.id} is already a vehicle of ${ws.name}`);
  if (usersOf(ctx.s, r.id, ws.id).length === 0 && assignableVehicles(ctx.s, ws.id).some((x) => x.id === r.id)) {
    throw rule('LOAN_NOT_NEEDED', `${r.id} is in ${ws.name}'s pools and nobody uses it; add it directly`);
  }
  if (Object.values(ctx.s.loans).some((l) => l.resourceId === r.id && l.workspaceId === ws.id && (l.status === 'REQUESTED' || l.status === 'APPROVED'))) {
    throw conflict('LOAN_OPEN', `${ws.name} already has an open loan of ${r.id}`);
  }
  const g = ctx.s.vehicleGroups[input.vehicleGroupId];
  if (!g || g.workspaceId !== ws.id || g.status !== 'ACTIVE' || g.purpose === 'PRODUCTION' || g.env !== r.env) {
    throw rule('LOAN_TARGET_GROUP', `choose an active ${r.env} development or testing vehicle group of ${ws.name}`);
  }
  if (!validDueDate(ctx.s, input.dueDate, todayOf(ctx.s))) throw rule('INVALID_DUE_DATE', `the last day is after today and at most ${MAX_LOAN_DAYS} days ahead`);
  if (!input.purpose.trim()) throw rule('LOAN_PURPOSE_REQUIRED', 'say what the vehicle is borrowed for');
  const id = newId('ln');
  ctx.s.loans[id] = {
    id,
    seq: ctx.seq(),
    resourceId: r.id,
    workspaceId: ws.id,
    vehicleGroupId: g.id,
    purpose: input.purpose.trim(),
    dueDate: input.dueDate,
    status: 'REQUESTED',
    lenders: usersOf(ctx.s, r.id, ws.id).map((workspaceId) => ({ workspaceId, decision: 'PENDING' as const, by: null, at: null, note: null })),
    requestedBy: ctx.user().username,
    requestedAt: ctx.now,
    decidedBy: null,
    decidedAt: null,
    decisionNote: null,
    extensions: [],
    leftGroupId: null,
    softwareAtStart: null,
    softwareAtEnd: null,
    endedBy: null,
    endedAt: null,
    endNote: null,
  };
  return id;
}

/** The borrower withdraws a request nobody has decided. */
export function withdrawLoan(ctx: Ctx, loanId: string): void {
  const l = getLoan(ctx.s, loanId) as Draft<Loan>;
  allowBorrower(ctx, l, getResource(ctx.s, l.resourceId));
  if (l.status !== 'REQUESTED') throw rule('LOAN_NOT_PENDING', 'the loan request is no longer open');
  l.status = 'WITHDRAWN';
  l.endedBy = ctx.user().username;
  l.endedAt = ctx.now;
}

/** A workspace using the vehicle agrees to lend it, or declines (which ends the request). */
export function answerLoanAsLender(ctx: Ctx, loanId: string, input: { workspaceId: string; agree: boolean; note?: string }): void {
  const l = getLoan(ctx.s, loanId) as Draft<Loan>;
  const r = getResource(ctx.s, l.resourceId);
  const lender = l.lenders.find((x) => x.workspaceId === input.workspaceId);
  if (!lender) throw notFound('lender', input.workspaceId);
  ctx.allow('loan.lend', { type: 'loan', id: l.id, workspaceId: lender.workspaceId, scope: r.pool, env: r.env });
  if (l.status !== 'REQUESTED') throw rule('LOAN_NOT_PENDING', 'the loan request is no longer open');
  if (lender.decision !== 'PENDING') throw conflict('ALREADY_ANSWERED', `${lender.workspaceId} already answered`);
  const note = input.note?.trim() ?? '';
  if (!input.agree && !note) throw rule('REASON_REQUIRED', 'say why the vehicle cannot be lent');
  lender.decision = input.agree ? 'AGREED' : 'DECLINED';
  lender.by = ctx.user().username;
  lender.at = ctx.now;
  lender.note = note || null;
  if (!input.agree) {
    l.status = 'REJECTED';
    l.decidedBy = ctx.user().username;
    l.decidedAt = ctx.now;
    l.decisionNote = note;
  }
}

/** What stops vehicle resources from approving the loan now (empty when nothing does). */
export function approvalProblems(s: State, l: Loan): string[] {
  const r = s.resources[l.resourceId]!;
  const problems: string[] = [];
  const waiting = l.lenders.filter((x) => x.decision !== 'AGREED').map((x) => s.workspaces[x.workspaceId]?.name ?? x.workspaceId);
  if (waiting.length) problems.push(`waiting for ${waiting.join(', ')} to agree`);
  if ((s.workspaceResources[l.workspaceId] ?? []).includes(r.id)) problems.push('already a vehicle of the borrowing workspace');
  const late = usersOf(s, r.id, l.workspaceId).filter((ws) => !l.lenders.some((x) => x.workspaceId === ws));
  if (late.length) problems.push(`${late.map((ws) => s.workspaces[ws]?.name ?? ws).join(', ')} started using the vehicle after the request; ask again`);
  if (r.status !== 'AVAILABLE') problems.push(`vehicle is ${r.status.toLowerCase()}`);
  const lent = activeLoanOf(s, r.id);
  if (lent) problems.push(`lent to ${s.workspaces[lent.workspaceId]?.name ?? lent.workspaceId} until ${lent.dueDate}`);
  const pending = pendingDeploymentOf(s, r.id) ?? openOtaOf(s, r.id);
  if (pending) problems.push(`waiting for deployment ${pending}`);
  if (pendingImageChangeOf(s, r.id)) problems.push('waiting for an image change');
  if (pendingSoftwareUpdateOf(s, r.id)) problems.push('waiting for a software update');
  if (r.instance === 'RUNNING') problems.push('simulation running; stop the instance first');
  if (r.reservation) problems.push(`reserved for ${r.reservation.purpose}; release it first`);
  const g = s.vehicleGroups[l.vehicleGroupId];
  const closed = !!g && (s.workspaces[g.workspaceId]?.status !== 'ACTIVE' || (g.groupId !== null && s.groups[g.groupId]?.status !== 'ACTIVE'));
  if (!g || g.status !== 'ACTIVE' || g.env !== r.env || closed) problems.push('the vehicle group asked for is no longer available');
  return problems;
}

/**
 * Vehicle resources decide. Approving moves the car out of a lender's vehicle group and into the
 * borrower's workspace and group, where it waits to follow what was dispatched there.
 */
export function decideLoan(ctx: Ctx, loanId: string, input: { approve: boolean; note?: string }): void {
  const l = getLoan(ctx.s, loanId) as Draft<Loan>;
  const r = getResource(ctx.s, l.resourceId);
  allowResources(ctx, l, r);
  if (l.status !== 'REQUESTED') throw rule('LOAN_NOT_PENDING', 'the loan request is no longer open');
  if (l.requestedBy === ctx.user().username) throw rule('SELF_APPROVAL', 'nobody decides their own request');
  const note = input.note?.trim() ?? '';
  if (!input.approve) {
    if (!note) throw rule('REASON_REQUIRED', 'say why the loan is rejected');
    l.status = 'REJECTED';
  } else {
    if (l.lenders.some((x) => x.decision !== 'AGREED')) throw rule('LENDER_NOT_AGREED', 'every workspace using the vehicle agrees first');
    const problems = approvalProblems(ctx.s, l);
    if (problems.length) throw rule('LOAN_NOT_APPROVABLE', 'the vehicle cannot be lent now', { issues: problems.map((p) => `${r.id}: ${p}`) });
    const borrower = getWorkspace(ctx.s, l.workspaceId);
    const current = ctx.s.groupMembers[r.id];
    if (current) {
      leaveGroup(ctx, current, r.id, borrower.name, 'LENT_OUT');
      l.leftGroupId = current;
    }
    ctx.s.workspaceResources[l.workspaceId] = [...(ctx.s.workspaceResources[l.workspaceId] ?? []), r.id];
    joinGroup(ctx, ctx.s.vehicleGroups[l.vehicleGroupId]!, r.id, l.purpose, 'BORROWED_IN');
    l.status = 'APPROVED';
    l.softwareAtStart = r.integrationVersion;
  }
  l.decidedBy = ctx.user().username;
  l.decidedAt = ctx.now;
  l.decisionNote = note || null;
}

/** The borrower asks for a later last day. */
export function requestExtension(ctx: Ctx, loanId: string, input: { dueDate: string; reason: string }): void {
  const l = getLoan(ctx.s, loanId) as Draft<Loan>;
  allowBorrower(ctx, l, getResource(ctx.s, l.resourceId));
  if (l.status !== 'APPROVED') throw rule('LOAN_NOT_ACTIVE', 'the loan is not active');
  if (l.extensions.some((x) => x.status === 'PENDING')) throw conflict('EXTENSION_PENDING', 'an extension is already waiting for vehicle resources');
  if (!validDueDate(ctx.s, input.dueDate, l.dueDate > todayOf(ctx.s) ? l.dueDate : todayOf(ctx.s))) {
    throw rule('INVALID_DUE_DATE', `the new last day is after the current one and today, and at most ${MAX_LOAN_DAYS} days ahead`);
  }
  if (!input.reason.trim()) throw rule('REASON_REQUIRED', 'say why the vehicle is needed longer');
  l.extensions.push({ dueDate: input.dueDate, reason: input.reason.trim(), status: 'PENDING', requestedBy: ctx.user().username, requestedAt: ctx.now, decidedBy: null, decidedAt: null });
}

/** Vehicle resources approve or reject the pending extension. */
export function decideExtension(ctx: Ctx, loanId: string, approve: boolean): void {
  const l = getLoan(ctx.s, loanId) as Draft<Loan>;
  allowResources(ctx, l, getResource(ctx.s, l.resourceId));
  const ext = l.extensions.find((x) => x.status === 'PENDING');
  if (l.status !== 'APPROVED' || !ext) throw rule('NO_EXTENSION_PENDING', 'no extension is waiting');
  if (ext.requestedBy === ctx.user().username) throw rule('SELF_APPROVAL', 'nobody decides their own request');
  // Time may have passed since the request: an extension to a day already gone extends nothing.
  if (approve && ext.dueDate <= todayOf(ctx.s)) throw rule('INVALID_DUE_DATE', 'the extension’s last day has passed; ask for a later one');
  ext.status = approve ? 'APPROVED' : 'REJECTED';
  ext.decidedBy = ctx.user().username;
  ext.decidedAt = ctx.now;
  if (approve) l.dueDate = ext.dueDate;
}

/** The car leaves the borrower's group and workspace; its configuration and software stay. */
function endLoan(ctx: Ctx, l: Draft<Loan>, status: 'RETURNED' | 'RECALLED', note: string | null): void {
  const r = ctx.s.resources[l.resourceId]!;
  assertIdle(ctx.s, r.id);
  if (r.instance === 'RUNNING') throw rule('SIMULATION_RUNNING', `${r.id} is running; stop the instance first`);
  const vg = ctx.s.groupMembers[r.id];
  if (vg && ctx.s.vehicleGroups[vg]?.workspaceId === l.workspaceId) leaveGroup(ctx, vg, r.id, note, status === 'RETURNED' ? 'LOAN_RETURNED' : 'LOAN_RECALLED');
  r.reservation = null;
  ctx.s.workspaceResources[l.workspaceId] = (ctx.s.workspaceResources[l.workspaceId] ?? []).filter((id) => id !== r.id);
  for (const x of l.extensions) if (x.status === 'PENDING') x.status = 'REJECTED';
  l.status = status;
  l.softwareAtEnd = r.integrationVersion;
  l.endedBy = ctx.user().username;
  l.endedAt = ctx.now;
  l.endNote = note;
}

/** The borrower returns the vehicle (归还). */
export function returnLoan(ctx: Ctx, loanId: string): void {
  const l = getLoan(ctx.s, loanId) as Draft<Loan>;
  allowBorrower(ctx, l, getResource(ctx.s, l.resourceId));
  if (l.status !== 'APPROVED') throw rule('LOAN_NOT_ACTIVE', 'the loan is not active');
  endLoan(ctx, l, 'RETURNED', null);
}

/** Vehicle resources take the vehicle back (收回), e.g. when it is overdue or needed for maintenance. */
export function recallLoan(ctx: Ctx, loanId: string, reason: string): void {
  const l = getLoan(ctx.s, loanId) as Draft<Loan>;
  allowResources(ctx, l, getResource(ctx.s, l.resourceId));
  if (l.status !== 'APPROVED') throw rule('LOAN_NOT_ACTIVE', 'the loan is not active');
  if (!reason.trim()) throw rule('REASON_REQUIRED', 'say why the vehicle is recalled');
  endLoan(ctx, l, 'RECALLED', reason.trim());
}

/** Loans in which the workspace borrows, newest first. */
export function borrowedBy(s: State, workspaceId: string): Loan[] {
  return Object.values(s.loans)
    .filter((l) => l.workspaceId === workspaceId)
    .sort((a, b) => b.seq - a.seq);
}

/** Loans of vehicles the workspace uses (or used when they were requested), newest first. */
export function lentBy(s: State, workspaceId: string): Loan[] {
  return Object.values(s.loans)
    .filter((l) => l.lenders.some((x) => x.workspaceId === workspaceId))
    .sort((a, b) => b.seq - a.seq);
}

/** Requests waiting for this workspace's agreement, for an account that manages its vehicles. */
export function loansToAgree(s: State, actor: Actor, workspaceId: string): Loan[] {
  return lentBy(s, workspaceId).filter((l) => {
    const r = s.resources[l.resourceId]!;
    return (
      l.status === 'REQUESTED' &&
      l.lenders.some((x) => x.workspaceId === workspaceId && x.decision === 'PENDING') &&
      authorize(actor.grants, 'loan.lend', { workspaceId, scope: r.pool, env: r.env }).ok
    );
  });
}

/** Loans of vehicles vehicle resources manage (by pool and environment), newest first. */
export function managedLoans(s: State, actor: Actor): Loan[] {
  return Object.values(s.loans)
    .filter((l) => {
      const r = s.resources[l.resourceId]!;
      return authorize(actor.grants, 'resource.manage', { scope: r.pool, env: r.env }).ok;
    })
    .sort((a, b) => b.seq - a.seq);
}

/** Requests every lender agreed to, waiting for vehicle resources. */
export function loansToApprove(s: State, actor: Actor): Loan[] {
  return managedLoans(s, actor).filter((l) => l.status === 'REQUESTED' && l.lenders.every((x) => x.decision === 'AGREED'));
}

export { isOverdue };
