// The simulator's auto-run: every two seconds the vehicles and services take one step, on whatever
// page is open. Kept here, not in the simulator page, so the header can show it is on and stop it.

import { useSyncExternalStore } from 'react';
import { tick } from '../engine/simulator.ts';
import { engine } from './store.ts';

let timer: ReturnType<typeof setInterval> | undefined;
let failures = 0;
const listeners = new Set<() => void>();

/** Consecutive failed steps after which auto-run stops, so the header never shows a run that is stuck. */
const MAX_FAILURES = 5;

export function setAutoRun(on: boolean): void {
  if (on && !timer) {
    failures = 0;
    timer = setInterval(() => {
      try {
        engine.run(null, (c) => tick(c));
        failures = 0;
      } catch (e) {
        // A step that cannot run now is tried again on the next one, a few times.
        console.warn('simulator step failed', e);
        if (++failures >= MAX_FAILURES) setAutoRun(false);
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
