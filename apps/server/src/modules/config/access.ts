import { canReadGroupConfig } from '../../domain/authz.ts';
import { ForbiddenError } from '../../domain/errors.ts';
import type { ReadCtx } from '../../http/context.ts';
import type { GroupView } from '../org/service.ts';

/** Reading a group's configuration content; with a workspace, the same grant must cover it. */
export function assertCanRead(ctx: ReadCtx, group: GroupView, workspaceId?: string): void {
  const target = { groupId: group.id, domain: group.domain, ...(workspaceId !== undefined ? { workspaceId } : {}) };
  if (!canReadGroupConfig(ctx.actor.grants, target)) {
    throw new ForbiddenError('config.read', 'NOT_VISIBLE', { type: 'group', id: group.id, ...target });
  }
}
