// The simulator's auto-run: every two seconds the vehicles and services take one step, on whatever
// page is open. Kept here, not in the simulator page, so the header can show it is on and stop it.

import { useSyncExternalStore } from 'react';
import { tick } from '../engine/simulator.ts';
import { engine } from './store.ts';

let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();

export function setAutoRun(on: boolean): void {
  if (on && !timer) {
    timer = setInterval(() => {
      try {
        engine.run(null, (c) => tick(c));
      } catch {
        // A step that cannot run now is tried again on the next one.
      }
    }, 2000);
  }
  if (!on && timer) {
    clearInterval(timer);
    timer = undefined;
  }
  for (const l of listeners) l();
}

export function useAutoRun(): boolean {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => void listeners.delete(l)),
    () => timer !== undefined,
  );
}
