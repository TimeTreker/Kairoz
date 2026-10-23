import { App } from 'antd';
import { useCallback, useMemo } from 'react';
import { authorize, canOpenPage } from '../domain/authz.ts';
import type { Action, AuthzTarget } from '../domain/authz.ts';
import { DomainError, ForbiddenError } from '../domain/errors.ts';
import type { Actor, Ctx } from '../engine/engine.ts';
import { workspaceAccess } from '../engine/identity.ts';
import { useI18n } from '../i18n/i18n.tsx';
import { issueLabel } from '../i18n/issues.ts';
import { DENY_REASON_LABELS, ERROR_LABELS } from '../i18n/vocab.ts';
import { engine, setSession, useEngineState, useSession } from './store.ts';

/** The signed-in account as an engine actor, or null. */
export function useActor(): Actor | null {
  const state = useEngineState();
  const { username } = useSession();
  return useMemo(() => {
    const account = username ? state.accounts[username] : undefined;
    if (!account || account.status !== 'ACTIVE') return null;
    return { username: account.username, displayName: account.displayName, grants: account.grants };
  }, [state, username]);
}

/** The current workspace, falling back to the first one the actor can use. */
export function useWorkspace() {
  const state = useEngineState();
  const actor = useActor();
  const { workspaceId } = useSession();
  return useMemo(() => {
    if (!actor) return { access: [], workspace: null, roles: [] };
    const access = workspaceAccess(state, actor);
    const chosen = access.find((a) => a.workspaceId === workspaceId) ?? access[0];
    return { access, workspace: chosen ? state.workspaces[chosen.workspaceId]! : null, roles: chosen?.roles ?? [] };
  }, [state, actor, workspaceId]);
}

export function useErrorText() {
  const { L, B } = useI18n();
  return useCallback(
    (e: unknown): string => {
      if (e instanceof DomainError) {
        let text = B(ERROR_LABELS[e.code], e.message);
        if (e instanceof ForbiddenError) text += L('：', ': ') + B(DENY_REASON_LABELS[e.reason], e.reason);
        const details = e.details as { issues?: unknown[] } | undefined;
        if (details?.issues?.length) {
          const one = (line: string) => B(issueLabel(line), line);
          const lines = details.issues.map((i) =>
            typeof i === 'string' ? one(i) : `${(i as { key?: string }).key ?? ''}${L('：', ': ')}${((i as { problems?: string[] }).problems ?? []).map(one).join(L('；', '; '))}`,
          );
          text += ` — ${lines.join(' | ')}`;
        }
        return text;
      }
      return e instanceof Error ? e.message : String(e);
    },
    [L, B],
  );
}

/** What `run` returns on success: the operation's result, or `true` for an operation without one. */
type Ran<R> = R extends void ? true : R;

/**
 * Runs an engine operation as the signed-in user. Shows `success` (if given) and returns the
 * result on success — `true` when the operation returns nothing, so callers can close a dialog on
 * `!== undefined`. Shows a localized error and returns undefined on failure.
 */
export function useRun() {
  const { message } = App.useApp();
  const { username } = useSession();
  const errorText = useErrorText();
  return useCallback(
    <R,>(operation: (ctx: Ctx) => R, success?: string): Ran<R> | undefined => {
      try {
        const result = engine.run(username, operation);
        if (success) message.success(success);
        return (result === undefined ? true : result) as Ran<R>;
      } catch (e) {
        if (e instanceof DomainError && e.code === 'UNAUTHENTICATED') setSession({ username: null });
        message.error({ content: errorText(e), duration: 6 });
        return undefined;
      }
    },
    [username, message, errorText],
  );
}

/** Whether the actor holds one grant allowing `action` on `target` (for showing controls). */
export function useCan() {
  const actor = useActor();
  return useCallback(
    (action: Action, target: AuthzTarget) => {
      if (!actor) return false;
      try {
        return authorize(actor.grants, action, target).ok;
      } catch {
        return false;
      }
    },
    [actor],
  );
}

/** Whether the actor may open a page in the current workspace: menu entries and the page guard. */
export function useCanOpen() {
  const actor = useActor();
  const { workspace } = useWorkspace();
  return useCallback((page: string) => !!actor && canOpenPage(actor.grants, page, workspace?.id ?? null), [actor, workspace]);
}
