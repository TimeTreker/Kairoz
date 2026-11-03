// Browser-side wiring of the engine: persistence in localStorage, the signed-in account and
// current workspace, and React hooks. Each browser keeps its own copy of the platform.

import { useCallback, useSyncExternalStore } from 'react';
import type { Ctx } from '../engine/engine.ts';
import { Engine } from '../engine/engine.ts';
import { migrate, unreadableReason } from '../engine/migrate.ts';
import { cleanState, demoState } from '../engine/seed.ts';
import { STATE_SCHEMA } from '../engine/types.ts';
import type { State } from '../engine/types.ts';

const STATE_KEY = 'kairoz.state.v1';
const SESSION_KEY = 'kairoz.session.v1';

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Writes to the browser's storage; false when it is unavailable or full (the prototype still works in this tab). */
function safeSet(key: string, value: string | null): boolean {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/**
 * What went wrong with this browser's saved platform, shown as a banner. SAVE_FAILED: storage is
 * unavailable or full, so the attempted change was not committed. UNREADABLE_SAVE: the saved
 * state could not be read (a newer version, or damaged); it is kept aside and the demo was loaded.
 */
export type StorageProblem = { kind: 'SAVE_FAILED' } | { kind: 'UNREADABLE_SAVE'; reason: 'NOT_STATE' | 'TOO_OLD' | 'NEWER' | 'DAMAGED'; raw: string };
let storageProblem: StorageProblem | null = null;
const problemListeners = new Set<() => void>();
function setStorageProblem(p: StorageProblem | null): void {
  storageProblem = p;
  for (const l of problemListeners) l();
}
export function useStorageProblem(): StorageProblem | null {
  return useSyncExternalStore(
    useCallback((l: () => void) => {
      problemListeners.add(l);
      return () => problemListeners.delete(l);
    }, []),
    () => storageProblem,
  );
}
export function dismissStorageProblem(): void {
  setStorageProblem(null);
}

const UNREADABLE_KEY = 'kairoz.state.unreadable.v1';

function loadState(writable: boolean): State {
  const raw = safeGet(STATE_KEY);
  if (raw) {
    let reason: 'NOT_STATE' | 'TOO_OLD' | 'NEWER' | 'DAMAGED' = 'DAMAGED';
    try {
      const parsed = JSON.parse(raw) as { schema?: unknown };
      const upgraded = parsed.schema !== STATE_SCHEMA;
      reason = unreadableReason(parsed) ?? 'DAMAGED';
      const state = migrate(parsed);
      if (state) {
        if (upgraded && writable) safeSet(STATE_KEY, JSON.stringify(state));
        return state;
      }
    } catch {
      // Not JSON, or a migration failed: damaged.
    }
    // Keep what could not be read, so nothing is lost by loading the demo instead.
    if (writable) safeSet(UNREADABLE_KEY, raw);
    storageProblem = { kind: 'UNREADABLE_SAVE', reason, raw };
  }
  // Save a fresh demo at once, so its ids (and links to them) survive a reload.
  const fresh = demoState();
  if (writable && !safeSet(STATE_KEY, JSON.stringify(fresh)) && !storageProblem) {
    storageProblem = { kind: 'SAVE_FAILED' };
  }
  return fresh;
}

export let engine: Engine;
let savedState: string | null;

function withStateLock<R>(operation: () => R): Promise<R> {
  if (!navigator.locks) return Promise.reject(new Error('This browser cannot safely coordinate prototype writes across tabs.'));
  return navigator.locks.request(STATE_KEY, operation);
}

export async function initializeStore(): Promise<void> {
  const initialize = (writable: boolean) => {
    engine = new Engine(loadState(writable));
    savedState = safeGet(STATE_KEY);
  };
  if (navigator.locks) await withStateLock(() => initialize(true));
  else initialize(false);
}

function refreshState(): void {
  const raw = localStorage.getItem(STATE_KEY);
  if (!raw || raw === savedState) return;
  const state = migrate(JSON.parse(raw));
  if (!state) throw new Error('The saved prototype state could not be read. Reload before editing.');
  savedState = raw;
  engine.replace(state);
}

function saveState(state: State): void {
  const raw = JSON.stringify(state);
  if (!safeSet(STATE_KEY, raw)) {
    setStorageProblem({ kind: 'SAVE_FAILED' });
    throw new Error('The change could not be saved to browser storage.');
  }
  savedState = raw;
  engine.replace(state);
  if (storageProblem?.kind === 'SAVE_FAILED') setStorageProblem(null);
}

/** Re-read, authorize, execute and persist under one origin-wide lock. */
export function runOperation<R>(username: string | null, operation: (ctx: Ctx) => R): Promise<R> {
  return withStateLock(() => {
    refreshState();
    const initial = engine.getState();
    const transaction = new Engine(initial);
    try {
      return transaction.run(username, operation);
    } finally {
      // Denied operations can also change state by recording an audit entry.
      if (transaction.getState() !== initial) saveState(transaction.getState());
    }
  });
}

window.addEventListener('storage', (e) => {
  if (!engine || e.key !== STATE_KEY) return;
  try {
    // A queued event may describe an older write. Always read the current snapshot.
    refreshState();
  } catch {
    // Keep the last readable snapshot visible. A write will fail until the save is readable.
  }
});

export function useEngineState(): State {
  return useSyncExternalStore(engine.subscribe, engine.getState);
}

// ---------------------------------------------------------------------------
// Session: who is signed in and which workspace is current
// ---------------------------------------------------------------------------

export interface Session {
  username: string | null;
  workspaceId: string | null;
}

let session: Session = (() => {
  try {
    return { username: null, workspaceId: null, ...(JSON.parse(safeGet(SESSION_KEY) ?? '{}') as Partial<Session>) };
  } catch {
    return { username: null, workspaceId: null };
  }
})();
const sessionListeners = new Set<() => void>();

const LAST_WORKSPACE_KEY = 'kairoz.lastWorkspace.v1';

/** The workspace each account last worked in, in this browser. */
export function lastWorkspaceOf(username: string): string | null {
  try {
    return (JSON.parse(safeGet(LAST_WORKSPACE_KEY) ?? '{}') as Record<string, string>)[username] ?? null;
  } catch {
    return null;
  }
}

export function setSession(next: Partial<Session>): void {
  session = { ...session, ...next };
  safeSet(SESSION_KEY, JSON.stringify(session));
  if (session.username && session.workspaceId && next.workspaceId) {
    try {
      const all = JSON.parse(safeGet(LAST_WORKSPACE_KEY) ?? '{}') as Record<string, string>;
      safeSet(LAST_WORKSPACE_KEY, JSON.stringify({ ...all, [session.username]: session.workspaceId }));
    } catch {
      safeSet(LAST_WORKSPACE_KEY, JSON.stringify({ [session.username]: session.workspaceId }));
    }
  }
  for (const l of sessionListeners) l();
}

export function useSession(): Session {
  return useSyncExternalStore(
    useCallback((l: () => void) => {
      sessionListeners.add(l);
      return () => sessionListeners.delete(l);
    }, []),
    () => session,
  );
}

export async function resetPlatform(kind: 'demo' | 'clean'): Promise<void> {
  await withStateLock(() => saveState(kind === 'demo' ? demoState() : cleanState()));
  safeSet(LAST_WORKSPACE_KEY, null);
  setSession({ username: null, workspaceId: null });
}

export function exportState(): string {
  return JSON.stringify(engine.getState(), null, 2);
}

export type StateText = { state: State } | { problem: 'JSON' | 'NOT_STATE' | 'TOO_OLD' | 'NEWER' };

/** Reads an exported state (as text), at the current schema. */
export function readStateText(json: string): StateText {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { problem: 'JSON' };
  }
  const reason = unreadableReason(parsed);
  if (reason) return { problem: reason };
  const state = migrate(parsed);
  return state ? { state } : { problem: 'NOT_STATE' };
}

/** Replaces this browser's platform with an imported one; everyone signs in again. */
export async function importState(state: State): Promise<void> {
  await withStateLock(() => saveState(state));
  safeSet(LAST_WORKSPACE_KEY, null);
  setSession({ username: null, workspaceId: null });
}
