// The world a script plays in: one engine, the accounts acting in it, and the objects scenes hand
// to each other. Scenes act only through engine operations as the named accounts (or as the
// simulator for vehicles and external services), exactly like the pages do.

import assert from 'node:assert/strict';
import { DomainError } from '../src/domain/errors.ts';
import type { Actor, Ctx } from '../src/engine/engine.ts';
import { Engine } from '../src/engine/engine.ts';
import type { State } from '../src/engine/types.ts';

/** A requirement of the scene that the prototype does not implement yet. */
export class GapError extends Error {}

/** A scene (or part) that cannot run in a browser-only prototype, e.g. server deployment. */
export class NotApplicableError extends Error {}

export class World {
  readonly engine: Engine;
  readonly notes: string[] = [];
  /** Objects named by earlier scenes: feature ids, commit ids, plan ids … */
  readonly ref: Record<string, string>;

  constructor(state: State, ref: Record<string, string> = {}) {
    this.engine = new Engine(state);
    this.ref = { ...ref };
  }

  get s(): State {
    return this.engine.getState();
  }

  /** Runs an operation as an account, as its page would. */
  as<R>(username: string, op: (c: Ctx) => R): R {
    return this.engine.run(username, op);
  }

  /** Runs as the simulator: vehicles, receipts, external services. */
  sys<R>(op: (c: Ctx) => R): R {
    return this.engine.run(null, op);
  }

  actor(username: string): Actor {
    const a = this.s.accounts[username];
    assert.ok(a, `account ${username} exists`);
    return { username, displayName: a.displayName, grants: a.grants };
  }

  /** Expects the call to be refused with `code`; nothing but the audit trail may change. */
  fails(code: string, fn: () => unknown): DomainError {
    const before = this.s;
    try {
      fn();
    } catch (e) {
      if (e instanceof DomainError && e.code === code) {
        // A refused operation is discarded; immer keeps untouched collections identical.
        for (const key of Object.keys(before) as (keyof State)[]) {
          if (key !== 'audit' && key !== 'seq') assert.equal(this.s[key], before[key], `${code}: ${String(key)} must not change`);
        }
        return e;
      }
      throw new Error(`expected ${code}, got ${e instanceof DomainError ? `${e.code}: ${e.message}` : String(e)}`);
    }
    throw new Error(`expected ${code}, but it succeeded`);
  }

  denied(username: string, op: (c: Ctx) => unknown): DomainError {
    return this.fails('FORBIDDEN', () => this.as(username, op));
  }

  check(cond: unknown, message: string): void {
    assert.ok(cond, message);
  }

  eq<T>(actual: T, expected: T, message: string): void {
    assert.deepEqual(actual, expected, message);
  }

  note(message: string): void {
    this.notes.push(message);
  }

  gap(feature: string): never {
    throw new GapError(feature);
  }

  notApplicable(reason: string): never {
    throw new NotApplicableError(reason);
  }

  /** A copy of this world for a side branch (支线); the original continues unchanged. */
  fork(): World {
    return new World(this.s, this.ref);
  }
}

export type SceneRun = (w: World) => void;

export interface SceneSpec {
  /** Scenes that must have passed first; otherwise this one is BLOCKED. */
  needs?: string[];
  /** Run on a copy of the world as it was after this scene (side branches). */
  forkAfter?: string;
  run: SceneRun;
}

export const sha = (seed: string): string => {
  let h = 0n;
  for (const ch of seed) h = (h * 131n + BigInt(ch.codePointAt(0)!)) % (1n << 256n);
  return `sha256:${h.toString(16).padStart(64, '0').slice(-64)}`;
};
