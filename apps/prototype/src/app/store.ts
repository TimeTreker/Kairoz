// Browser-side wiring of the engine: persistence in localStorage, the signed-in account and
// current workspace, and React hooks. Each browser keeps its own copy of the platform.

import { useCallback, useSyncExternalStore } from 'react';
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
 * unavailable or full, so changes last only until the page is closed. UNREADABLE_SAVE: the saved
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

function loadState(): State {
  const raw = safeGet(STATE_KEY);
  if (raw) {
    let reason: 'NOT_STATE' | 'TOO_OLD' | 'NEWER' | 'DAMAGED' = 'DAMAGED';
    try {
      const parsed = JSON.parse(raw) as { schema?: unknown };
      const upgraded = parsed.schema !== STATE_SCHEMA;
      reason = unreadableReason(parsed) ?? 'DAMAGED';
      const state = migrate(parsed);
      if (state) {
        if (upgraded) safeSet(STATE_KEY, JSON.stringify(state));
        return state;
      }
    } catch {
      // Not JSON, or a migration failed: damaged.
    }
    // Keep what could not be read, so nothing is lost by loading the demo instead.
    safeSet(UNREADABLE_KEY, raw);
    storageProblem = { kind: 'UNREADABLE_SAVE', reason, raw };
  }
  // Save a fresh demo at once, so its ids (and links to them) survive a reload.
  const fresh = demoState();
  safeSet(STATE_KEY, JSON.stringify(fresh));
  return fresh;
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
function persist(state: State): void {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const saved = safeSet(STATE_KEY, JSON.stringify(state));
    if (!saved && storageProblem?.kind !== 'SAVE_FAILED') setStorageProblem({ kind: 'SAVE_FAILED' });
    if (saved && storageProblem?.kind === 'SAVE_FAILED') setStorageProblem(null);
  }, 150);
}

export const engine = new Engine(loadState(), persist);

// Tabs of one browser share the saved platform. When another tab saves, follow it, so an older
// tab never writes stale data back (and a tab signed in as a disabled account drops to sign-in).
window.addEventListener('storage', (e) => {
  if (e.key !== STATE_KEY || !e.newValue) return;
  try {
    const state = migrate(JSON.parse(e.newValue));
    if (state) engine.replace(state);
  } catch {
    // Ignore a save this version cannot read.
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

export function resetPlatform(kind: 'demo' | 'clean'): void {
  engine.replace(kind === 'demo' ? demoState() : cleanState());
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
export function importState(state: State): void {
  engine.replace(state);
  safeSet(LAST_WORKSPACE_KEY, null);
  setSession({ username: null, workspaceId: null });
}
