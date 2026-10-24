// The platform clock: real time plus the simulated offset (模拟时间), so loans can run out in a
// browser session. It only moves forward.

import type { State } from './types.ts';

export const DAY_MS = 86_400_000;

/** The platform's current time for `s`. */
export function nowOf(s: Pick<State, 'clockOffsetMs'>): string {
  return new Date(Date.now() + (s.clockOffsetMs ?? 0)).toISOString();
}

/** The platform's current date (YYYY-MM-DD, UTC). */
export function todayOf(s: Pick<State, 'clockOffsetMs'>): string {
  return nowOf(s).slice(0, 10);
}

/** The date `days` after `date` (YYYY-MM-DD). */
export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
}
