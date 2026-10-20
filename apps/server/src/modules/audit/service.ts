import type { Db } from '../../db/pool.ts';
import { many } from '../../db/pool.ts';

export interface AuditEntry {
  action: string;
  outcome: 'ALLOWED' | 'DENIED';
  reason?: string;
  role?: string;
  grantId?: string;
  targetType?: string;
  targetId?: string;
  workspaceId?: string;
  details?: unknown;
}

export async function writeAudit(db: Db, username: string | null, requestId: string, entries: readonly AuditEntry[]): Promise<void> {
  for (const e of entries) {
    await db.query(
      `INSERT INTO audit_events
         (username, role, grant_id, action, outcome, reason, target_type, target_id, workspace_id, request_id, details)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        username,
        e.role ?? null,
        e.grantId ?? null,
        e.action,
        e.outcome,
        e.reason ?? null,
        e.targetType ?? null,
        e.targetId ?? null,
        e.workspaceId ?? null,
        requestId,
        e.details === undefined ? null : JSON.stringify(e.details),
      ],
    );
  }
}

export interface AuditQuery {
  username?: string;
  action?: string;
  targetType?: string;
  targetId?: string;
  limit: number;
  beforeId?: string;
}

export async function listAudit(db: Db, q: AuditQuery) {
  const where: string[] = [];
  const values: unknown[] = [];
  const add = (sql: string, value: unknown) => {
    values.push(value);
    where.push(sql.replace('?', `$${values.length}`));
  };
  if (q.username) add('username = ?', q.username);
  if (q.action) add('action = ?', q.action);
  if (q.targetType) add('target_type = ?', q.targetType);
  if (q.targetId) add('target_id = ?', q.targetId);
  if (q.beforeId) add('id < ?', q.beforeId);
  values.push(q.limit);
  const rows = await many<{
    id: string;
    occurred_at: Date;
    username: string | null;
    role: string | null;
    grant_id: string | null;
    action: string;
    outcome: string;
    reason: string | null;
    target_type: string | null;
    target_id: string | null;
    workspace_id: string | null;
    request_id: string | null;
    details: unknown;
  }>(
    db,
    `SELECT * FROM audit_events ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY id DESC LIMIT $${values.length}`,
    values,
  );
  return rows.map((r) => ({
    id: r.id,
    occurredAt: r.occurred_at.toISOString(),
    username: r.username,
    role: r.role,
    grantId: r.grant_id,
    action: r.action,
    outcome: r.outcome,
    reason: r.reason,
    targetType: r.target_type,
    targetId: r.target_id,
    workspaceId: r.workspace_id,
    requestId: r.request_id,
    details: r.details,
  }));
}
