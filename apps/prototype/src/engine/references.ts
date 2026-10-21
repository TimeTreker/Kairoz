// Cross-group read-only references. A group may use another group's committed file definition
// once the owner (or platform operations) approves; the definition and its ownership never move.
// Revocation stops new references and new submits, and returns reader Features in intake.

import { authorize, canReadGroupConfig } from '../domain/authz.ts';
import { conflict, ForbiddenError, notFound, rule } from '../domain/errors.ts';
import { newId } from '../domain/ids.ts';
import type { Actor, Ctx } from './engine.ts';
import { getGroup } from './org.ts';
import { commitSnapshot, latestCommittedVersion } from './snapshots.ts';
import type { ReferenceRequest, State } from './types.ts';

export function approvedReference(s: State, dataKey: string, readerGroupId: string): boolean {
  return Object.values(s.referenceRequests).some((r) => r.dataKey === dataKey && r.readerGroupId === readerGroupId && r.status === 'APPROVED');
}

export interface CatalogEntry {
  dataKey: string;
  name: string;
  ownerGroupId: string;
  status: string;
  access: ReferenceRequest['status'] | 'NONE';
  /** Only with an approved reference. */
  dataCode?: string;
  latestVersionId?: string;
  latestVersion?: number;
}

/** Other groups' committed data as `groupId` sees it: without a grant, only name, owner and status. */
export function referenceCatalog(s: State, groupId: string): CatalogEntry[] {
  const entries: CatalogEntry[] = [];
  for (const item of Object.values(s.dataItems)) {
    if (item.ownerGroupId === groupId || item.status !== 'ACTIVE') continue;
    const current = latestCommittedVersion(s, item.dataKey);
    if (!current) continue;
    const requests = Object.values(s.referenceRequests)
      .filter((r) => r.dataKey === item.dataKey && r.readerGroupId === groupId)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    const access = requests[0]?.status ?? 'NONE';
    const entry: CatalogEntry = { dataKey: item.dataKey, name: current.content.name, ownerGroupId: item.ownerGroupId, status: item.status, access };
    if (access === 'APPROVED') {
      entry.dataCode = item.dataCode;
      entry.latestVersionId = current.id;
      entry.latestVersion = current.version;
    }
    entries.push(entry);
  }
  return entries.sort((a, b) => a.ownerGroupId.localeCompare(b.ownerGroupId) || a.name.localeCompare(b.name));
}

export function requestReference(ctx: Ctx, input: { dataKey: string; readerGroupId: string; reason: string }): string {
  const reader = getGroup(ctx.s, input.readerGroupId);
  ctx.allow('reference.request', { type: 'referenceRequest', groupId: reader.id, scope: reader.domain });
  if (reader.purpose !== 'DEV') throw rule('TEST_GROUP_CANNOT_OWN_CONFIG', 'test groups do not maintain configuration');
  const item = ctx.s.dataItems[input.dataKey];
  if (!item) throw notFound('data item', input.dataKey);
  if (item.ownerGroupId === reader.id) throw rule('OWN_DATA_ITEM', 'a group does not need a reference to its own data');
  if (item.status !== 'ACTIVE') throw rule('NOT_COMMITTED', 'only committed data items can be referenced');
  if (!input.reason.trim()) throw rule('REASON_REQUIRED', 'explain why the data is needed');
  const open = Object.values(ctx.s.referenceRequests).find(
    (r) => r.dataKey === input.dataKey && r.readerGroupId === reader.id && (r.status === 'PENDING' || r.status === 'APPROVED'),
  );
  if (open) throw conflict('REFERENCE_ALREADY_OPEN', `a reference request is already ${open.status.toLowerCase()}`);
  const id = newId('rr');
  ctx.s.referenceRequests[id] = {
    id,
    dataKey: input.dataKey,
    readerGroupId: reader.id,
    status: 'PENDING',
    requestReason: input.reason.trim(),
    decisionReason: null,
    requestedBy: ctx.user().username,
    decidedBy: null,
    createdAt: ctx.now,
    decidedAt: null,
  };
  return id;
}

/** Requests concerning a group, as owner or reader. Metadata only. */
export function referenceRequestsFor(s: State, actor: Actor, groupId: string, side: 'owner' | 'reader'): ReferenceRequest[] {
  const group = s.groups[groupId];
  if (!group) return [];
  const visible =
    canReadGroupConfig(actor.grants, { groupId: group.id, domain: group.domain }) || actor.grants.some((g) => g.role === 'PLATFORM_OPS');
  if (!visible) return [];
  return Object.values(s.referenceRequests)
    .filter((r) => (side === 'owner' ? s.dataItems[r.dataKey]?.ownerGroupId === groupId : r.readerGroupId === groupId))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/** The owner group decides; otherwise platform operations with a platform-wide grant may. */
function authorizeDecision(ctx: Ctx, id: string): ReferenceRequest {
  const request = ctx.s.referenceRequests[id];
  if (!request) throw notFound('reference request', id);
  const target = { type: 'referenceRequest', id, groupId: ctx.s.dataItems[request.dataKey]!.ownerGroupId };
  const actor = ctx.user();
  const asAdministrator = !authorize(actor.grants, 'reference.decide', target).ok && actor.grants.some((g) => g.role === 'PLATFORM_OPS');
  ctx.allow(asAdministrator ? 'reference.administer' : 'reference.decide', target);
  return request;
}

export function decideReference(ctx: Ctx, id: string, input: { decision: 'APPROVED' | 'REJECTED'; reason: string }): void {
  const request = authorizeDecision(ctx, id);
  if (request.status !== 'PENDING') throw rule('NOT_PENDING', `the request is already ${request.status.toLowerCase()}`);
  if (input.decision === 'REJECTED' && !input.reason.trim()) throw rule('REASON_REQUIRED', 'explain the rejection');
  request.status = input.decision;
  request.decisionReason = input.reason.trim() || null;
  request.decidedBy = ctx.user().username;
  request.decidedAt = ctx.now;
}

/** Revokes an approved reference; reader Features in intake that use it go back to DRAFT. Returns their ids. */
export function revokeReference(ctx: Ctx, id: string, input: { reason: string }): string[] {
  const request = authorizeDecision(ctx, id);
  if (request.status !== 'APPROVED') throw rule('NOT_APPROVED', 'only an approved reference can be revoked');
  if (!input.reason.trim()) throw rule('REASON_REQUIRED', 'explain the revocation');
  request.status = 'REVOKED';
  request.decisionReason = input.reason.trim();
  request.decidedBy = ctx.user().username;
  request.decidedAt = ctx.now;
  const returned: string[] = [];
  for (const f of Object.values(ctx.s.features)) {
    if (f.groupId !== request.readerGroupId || !f.headCommitId) continue;
    if (!['SUBMITTED', 'DCL_READY', 'TESTING', 'VERIFIED'].includes(f.stage)) continue;
    if (!(request.dataKey in commitSnapshot(ctx.s, f.headCommitId).references)) continue;
    f.stage = 'DRAFT';
    f.updatedAt = ctx.now;
    ctx.s.feedback.push({
      id: newId('fb'),
      featureId: f.id,
      commitId: f.headCommitId,
      kind: 'REFERENCE_REVOKED',
      dataKey: request.dataKey,
      reason: input.reason.trim(),
      author: ctx.user().username,
      createdAt: ctx.now,
    });
    returned.push(f.id);
  }
  return returned;
}

export function assertReferenceVisible(s: State, actor: Actor, groupId: string): void {
  const group = getGroup(s, groupId);
  if (!canReadGroupConfig(actor.grants, { groupId: group.id, domain: group.domain })) {
    throw new ForbiddenError('reference.list', 'NOT_VISIBLE', { type: 'group', id: groupId });
  }
}
