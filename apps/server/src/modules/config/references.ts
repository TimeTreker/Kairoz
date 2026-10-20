// Cross-group read-only references. A group may use another group's committed file definition
// once the owner (or platform operations) approves; the definition and its ownership never move.
// Revocation stops new references and new submits; existing commits stay as they were.

import type { Db } from '../../db/pool.ts';
import { many, one } from '../../db/pool.ts';
import { authorize, canReadGroupConfig } from '../../domain/authz.ts';
import type { FileSpecContent } from '../../domain/config.ts';
import { conflict, ForbiddenError, notFound, rule } from '../../domain/errors.ts';
import type { ReadCtx, WriteCtx } from '../../http/context.ts';
import { getGroup, workspaceForAction } from '../org/service.ts';
import { assertCanRead } from './access.ts';
import { lockIntake } from './approvals.ts';
import { addFeedback } from './feedback.ts';

/** Lateral subquery: the owner group's current definition of `d.data_key` (see latestCommittedVersion). */
const CURRENT_DEFINITION = `
  SELECT v.id, v.version, v.content FROM commits c
    JOIN manifest_entries e ON e.manifest_version_id = c.manifest_version_id AND e.data_key = d.data_key
    JOIN file_spec_versions v ON v.id = e.file_spec_version_id
  WHERE c.group_id = d.owner_group_id
  ORDER BY c.created_at DESC, c.id DESC LIMIT 1`;

export type ReferenceStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'REVOKED';

/** True if `readerGroupId` holds an approved reference to `dataKey`. */
export async function approvedReference(db: Db, dataKey: string, readerGroupId: string, lockForShare: boolean): Promise<boolean> {
  const row = await one(
    db,
    `SELECT id FROM reference_requests WHERE data_key = $1 AND reader_group_id = $2 AND status = 'APPROVED'${
      lockForShare ? ' FOR SHARE' : ''
    }`,
    [dataKey, readerGroupId],
  );
  return row !== undefined;
}

interface RequestRow {
  id: string;
  data_key: string;
  reader_group_id: string;
  owner_group_id: string;
  status: ReferenceStatus;
  request_reason: string;
  decision_reason: string | null;
  requested_by: string;
  decided_by: string | null;
  created_at: Date;
  decided_at: Date | null;
  name: string | null;
}

const REQUEST_SELECT = `
  SELECT r.*, d.owner_group_id, cur.content ->> 'name' AS name
  FROM reference_requests r
    JOIN data_items d ON d.data_key = r.data_key
    LEFT JOIN LATERAL (${CURRENT_DEFINITION}) cur ON true`;

function requestView(r: RequestRow) {
  return {
    id: r.id,
    dataKey: r.data_key,
    name: r.name,
    ownerGroupId: r.owner_group_id,
    readerGroupId: r.reader_group_id,
    status: r.status,
    requestReason: r.request_reason,
    decisionReason: r.decision_reason,
    requestedBy: r.requested_by,
    decidedBy: r.decided_by,
    createdAt: r.created_at.toISOString(),
    decidedAt: r.decided_at?.toISOString() ?? null,
  };
}

async function getRequest(db: Db, id: string, lock = false): Promise<RequestRow> {
  const row = await one<RequestRow>(db, `${REQUEST_SELECT} WHERE r.id = $1${lock ? ' FOR UPDATE OF r' : ''}`, [id]);
  if (!row) throw notFound('reference request', id);
  return row;
}

/**
 * Other groups' committed data items as seen by `groupId`. Without an approved reference only
 * the name, owner group and status are shown; source, code and processing stay hidden.
 */
export async function referenceCatalog(ctx: ReadCtx, workspaceId: string, groupId: string) {
  const group = await getGroup(ctx.db, groupId);
  assertCanRead(ctx, group, workspaceId);
  const workspace = await workspaceForAction(ctx.db, workspaceId);
  if (!workspace.groupIds.includes(groupId)) throw notFound('group in workspace', groupId);
  const rows = await many<{
    data_key: string;
    data_code: string;
    owner_group_id: string;
    owner_group_name: string;
    status: string;
    version_id: string;
    version: number;
    content: FileSpecContent;
    access: ReferenceStatus | null;
  }>(
    ctx.db,
    `SELECT d.data_key, d.data_code, d.owner_group_id, g.name AS owner_group_name, d.status,
            v.id AS version_id, v.version, v.content,
            (SELECT r.status FROM reference_requests r
              WHERE r.data_key = d.data_key AND r.reader_group_id = $1
              ORDER BY r.created_at DESC, r.id DESC LIMIT 1) AS access
     FROM data_items d
       JOIN business_groups g ON g.id = d.owner_group_id
       JOIN LATERAL (${CURRENT_DEFINITION}) v ON true
     WHERE d.owner_group_id <> $1 AND d.status = 'ACTIVE'
     ORDER BY g.name, v.content ->> 'name', d.data_key`,
    [groupId],
  );
  return rows.map((r) => {
    const base = {
      dataKey: r.data_key,
      name: r.content.name,
      ownerGroupId: r.owner_group_id,
      ownerGroupName: r.owner_group_name,
      status: r.status,
      access: r.access ?? 'NONE',
    };
    return r.access === 'APPROVED'
      ? { ...base, dataCode: r.data_code, latestVersion: { id: r.version_id, version: r.version }, content: r.content }
      : base;
  });
}

export async function requestReference(ctx: WriteCtx, input: { dataKey: string; readerGroupId: string; reason: string }) {
  const reader = await getGroup(ctx.db, input.readerGroupId);
  ctx.allow('reference.request', { type: 'referenceRequest', groupId: reader.id, scope: reader.domain });
  if (reader.purpose !== 'DEV') throw rule('TEST_GROUP_CANNOT_OWN_CONFIG', 'test groups do not maintain configuration');
  const item = await one<{ owner_group_id: string; status: string }>(
    ctx.db,
    'SELECT owner_group_id, status FROM data_items WHERE data_key = $1',
    [input.dataKey],
  );
  if (!item) throw notFound('data item', input.dataKey);
  if (item.owner_group_id === reader.id) throw rule('OWN_DATA_ITEM', 'a group does not need a reference to its own data');
  if (item.status !== 'ACTIVE') throw rule('NOT_COMMITTED', 'only committed data items can be referenced');
  if (input.reason.trim().length === 0) throw rule('REASON_REQUIRED', 'explain why the data is needed');
  const open = await one<{ status: string }>(
    ctx.db,
    "SELECT status FROM reference_requests WHERE data_key = $1 AND reader_group_id = $2 AND status IN ('PENDING', 'APPROVED')",
    [input.dataKey, reader.id],
  );
  if (open) throw conflict('REFERENCE_ALREADY_OPEN', `a reference request is already ${open.status.toLowerCase()}`);
  const created = await one<{ id: string }>(
    ctx.db,
    `INSERT INTO reference_requests (data_key, reader_group_id, status, request_reason, requested_by)
     VALUES ($1, $2, 'PENDING', $3, $4) RETURNING id`,
    [input.dataKey, reader.id, input.reason.trim(), ctx.actor.username],
  );
  return requestView(await getRequest(ctx.db, created!.id));
}

/** Requests concerning a group, as owner or as reader. Metadata only; no source or definition. */
export async function listReferenceRequests(
  ctx: ReadCtx,
  filter: { groupId: string; side: 'owner' | 'reader'; status?: ReferenceStatus },
) {
  const group = await getGroup(ctx.db, filter.groupId);
  const visible =
    canReadGroupConfig(ctx.actor.grants, { groupId: group.id, domain: group.domain }) ||
    ctx.actor.grants.some((g) => g.role === 'PLATFORM_OPS');
  if (!visible) throw new ForbiddenError('reference.list', 'NOT_VISIBLE', { type: 'group', id: group.id });
  const column = filter.side === 'owner' ? 'd.owner_group_id' : 'r.reader_group_id';
  const rows = await many<RequestRow>(
    ctx.db,
    `${REQUEST_SELECT} WHERE ${column} = $1 AND ($2::text IS NULL OR r.status = $2) ORDER BY r.created_at DESC, r.id DESC`,
    [group.id, filter.status ?? null],
  );
  return rows.map(requestView);
}

/** The owner group decides; otherwise platform operations with a platform-wide grant may. */
async function lockForDecision(ctx: WriteCtx, id: string, options: { intake?: boolean } = {}): Promise<RequestRow> {
  const unlocked = await getRequest(ctx.db, id);
  const target = { type: 'referenceRequest', id, groupId: unlocked.owner_group_id };
  const asAdministrator =
    !authorize(ctx.actor.grants, 'reference.decide', target).ok && ctx.actor.grants.some((g) => g.role === 'PLATFORM_OPS');
  ctx.allow(asAdministrator ? 'reference.administer' : 'reference.decide', target);
  // Revocation changes what the reader may submit, so it serializes with the reader's submits.
  if (options.intake) await lockIntake(ctx.db, unlocked.reader_group_id);
  return getRequest(ctx.db, id, true);
}

export async function decideReference(ctx: WriteCtx, id: string, input: { decision: 'APPROVED' | 'REJECTED'; reason: string }) {
  const request = await lockForDecision(ctx, id);
  if (request.status !== 'PENDING') throw rule('NOT_PENDING', `the request is already ${request.status.toLowerCase()}`);
  if (input.decision === 'REJECTED' && input.reason.trim().length === 0) throw rule('REASON_REQUIRED', 'explain the rejection');
  await ctx.db.query(
    `UPDATE reference_requests SET status = $2, decision_reason = $3, decided_by = $4, decided_at = now() WHERE id = $1`,
    [id, input.decision, input.reason.trim() || null, ctx.actor.username],
  );
  return requestView(await getRequest(ctx.db, id));
}

/**
 * Revokes an approved reference. Reader Features whose submitted head uses it go back to DRAFT
 * with feedback; their commits stay as they were.
 */
export async function revokeReference(ctx: WriteCtx, id: string, input: { reason: string }) {
  const request = await lockForDecision(ctx, id, { intake: true });
  if (request.status !== 'APPROVED') throw rule('NOT_APPROVED', 'only an approved reference can be revoked');
  if (input.reason.trim().length === 0) throw rule('REASON_REQUIRED', 'explain the revocation');
  await ctx.db.query(
    `UPDATE reference_requests SET status = 'REVOKED', decision_reason = $2, decided_by = $3, decided_at = now() WHERE id = $1`,
    [id, input.reason.trim(), ctx.actor.username],
  );
  const affected = await many<{ id: string; head_commit_id: string }>(
    ctx.db,
    `SELECT f.id, f.head_commit_id FROM features f
       JOIN commits c ON c.id = f.head_commit_id
       JOIN manifest_entries e ON e.manifest_version_id = c.manifest_version_id
     WHERE f.group_id = $1 AND e.data_key = $2 AND f.stage IN ('SUBMITTED', 'DCL_READY')
     ORDER BY f.id
     FOR UPDATE OF f`,
    [request.reader_group_id, request.data_key],
  );
  for (const f of affected) {
    await ctx.db.query("UPDATE features SET stage = 'DRAFT', revision = revision + 1, updated_at = now() WHERE id = $1", [f.id]);
    await addFeedback(ctx.db, {
      featureId: f.id,
      commitId: f.head_commit_id,
      kind: 'REFERENCE_REVOKED',
      dataKey: request.data_key,
      reason: input.reason.trim(),
      author: ctx.actor.username,
    });
  }
  return { ...requestView(await getRequest(ctx.db, id)), returnedFeatureIds: affected.map((f) => f.id) };
}
