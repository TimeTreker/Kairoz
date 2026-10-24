// The platform engine: every operation runs as one transaction on an immer draft of the
// state. A thrown error discards the draft, so a failed operation never leaves partial changes.
// Allowed decisions are audited with the change; denials are audited separately.

import { produce } from 'immer';
import type { Draft } from 'immer';
import { authorize } from '../domain/authz.ts';
import type { Action, AuthzTarget, Grant } from '../domain/authz.ts';
import { ForbiddenError, unauthenticated } from '../domain/errors.ts';
import { newId } from '../domain/ids.ts';
import { nowOf } from './clock.ts';
import { grantsOf } from './identity.ts';
import type { AuditEvent, State } from './types.ts';

export const AUDIT_LIMIT = 3000;

export interface Actor {
  username: string;
  displayName: string;
  grants: Grant[];
}

export type AllowTarget = AuthzTarget & { type: string; id?: string };

export interface Ctx {
  /** The mutable draft. Only valid during the operation. */
  s: Draft<State>;
  /** null for simulated external systems (vehicles, simulators), which never call allow(). */
  actor: Actor | null;
  now: string;
  /** Next value of the global ordering counter. */
  seq(): number;
  /** Authorizes with the single-grant rule and records the decision. Throws ForbiddenError. */
  allow(action: Action, target: AllowTarget): Grant;
  /** The acting user; throws for system contexts. */
  user(): Actor;
}

function pushAudit(s: Draft<State>, event: Omit<AuditEvent, 'id' | 'seq'>): void {
  s.seq += 1;
  s.audit.push({ id: newId('au'), seq: s.seq, ...event });
  if (s.audit.length > AUDIT_LIMIT) s.audit.splice(0, s.audit.length - AUDIT_LIMIT);
}

/** Copies a result out of the draft so it stays readable after the transaction. */
function detach<R>(value: R): R {
  return value === undefined || value === null || typeof value !== 'object' ? value : (JSON.parse(JSON.stringify(value)) as R);
}

export class Engine {
  private state: State;
  private readonly listeners = new Set<() => void>();
  private readonly onCommit: ((state: State) => void) | undefined;

  constructor(initial: State, onCommit?: (state: State) => void) {
    this.state = initial;
    this.onCommit = onCommit;
  }

  getState = (): State => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Replaces the whole state (reset, import). */
  replace(state: State): void {
    this.commit(state);
  }

  private commit(next: State): void {
    if (next === this.state) return;
    this.state = next;
    this.onCommit?.(next);
    for (const l of this.listeners) l();
  }

  /**
   * Runs one operation as `username` (or as an external system when null). Returns the
   * operation's result, detached from the draft.
   */
  run<R>(username: string | null, operation: (ctx: Ctx) => R): R {
    const now = nowOf(this.state);
    let result: R | undefined;
    try {
      const next = produce(this.state, (s) => {
        let actor: Actor | null = null;
        if (username !== null) {
          const account = s.accounts[username];
          if (!account || account.status !== 'ACTIVE') throw unauthenticated('the account is not active; sign in again');
          actor = { username: account.username, displayName: account.displayName, grants: grantsOf(s, account) as Grant[] };
        }
        const ctx: Ctx = {
          s,
          actor,
          now,
          seq: () => ++s.seq,
          user: () => {
            if (!actor) throw new Error('this operation needs a signed-in user');
            return actor;
          },
          allow: (action, target) => {
            if (!actor) throw new Error(`system context cannot authorize ${action}`);
            const decision = authorize(actor.grants, action, target);
            const { type, id, ...scope } = target;
            if (!decision.ok) throw new ForbiddenError(action, decision.reason, { type, id, ...scope });
            pushAudit(s, {
              at: now,
              username: actor.username,
              role: decision.grant.role,
              grantId: decision.grant.id,
              action,
              outcome: 'ALLOWED',
              reason: null,
              targetType: type,
              targetId: id ?? null,
              workspaceId: target.workspaceId ?? null,
            });
            return decision.grant;
          },
        };
        result = detach(operation(ctx));
      });
      this.commit(next);
      return result as R;
    } catch (e) {
      if (e instanceof ForbiddenError && username !== null) {
        const target = e.target as { type?: string; id?: string; workspaceId?: string };
        this.commit(
          produce(this.state, (s) => {
            pushAudit(s, {
              at: now,
              username,
              role: null,
              grantId: null,
              action: e.action,
              outcome: 'DENIED',
              reason: e.reason,
              targetType: target.type ?? null,
              targetId: target.id ?? null,
              workspaceId: target.workspaceId ?? null,
            });
          }),
        );
      }
      throw e;
    }
  }

  /** Read-only access as a user (no audit, no changes). */
  read<R>(username: string, query: (state: State, actor: Actor) => R): R {
    const account = this.state.accounts[username];
    if (!account || account.status !== 'ACTIVE') throw unauthenticated('the account is not active; sign in again');
    return query(this.state, { username: account.username, displayName: account.displayName, grants: grantsOf(this.state, account) });
  }
}
