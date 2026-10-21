// Browser-side wiring of the engine: persistence in localStorage, the signed-in account and
// current workspace, and React hooks. Each browser keeps its own copy of the platform.

import { useCallback, useSyncExternalStore } from 'react';
import { Engine } from '../engine/engine.ts';
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

function safeSet(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Storage may be unavailable (private mode); the prototype still works for this tab.
  }
}

function loadState(): State {
  const raw = safeGet(STATE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as State;
      if (parsed.schema === STATE_SCHEMA) return parsed;
    } catch {
      // Fall through to a fresh demo.
    }
  }
  // Save a fresh demo at once, so its ids (and links to them) survive a reload.
  const fresh = demoState();
  safeSet(STATE_KEY, JSON.stringify(fresh));
  return fresh;
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
function persist(state: State): void {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => safeSet(STATE_KEY, JSON.stringify(state)), 150);
}

export const engine = new Engine(loadState(), persist);

// Tabs of one browser share the saved platform. When another tab saves, follow it, so an older
// tab never writes stale data back (and a tab signed in as a disabled account drops to sign-in).
window.addEventListener('storage', (e) => {
  if (e.key !== STATE_KEY || !e.newValue) return;
  try {
    const parsed = JSON.parse(e.newValue) as State;
    if (parsed.schema === STATE_SCHEMA) engine.replace(parsed);
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

export function setSession(next: Partial<Session>): void {
  session = { ...session, ...next };
  safeSet(SESSION_KEY, JSON.stringify(session));
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
  setSession({ username: null, workspaceId: null });
}

export function exportState(): string {
  return JSON.stringify(engine.getState(), null, 2);
}

export function importState(json: string): void {
  const parsed = JSON.parse(json) as State;
  if (parsed.schema !== STATE_SCHEMA) throw new Error(`unsupported state schema ${parsed.schema}`);
  engine.replace(parsed);
  setSession({ username: null, workspaceId: null });
}
