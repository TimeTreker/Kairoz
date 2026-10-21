// Where a file comes from on the vehicle. The exact source identifies a data item; overlapping
// glob patterns are not decided automatically and go to DCL review.

import { rule } from './errors.ts';

export interface DataSource {
  /** Domain controller / ECU, stored upper-case, e.g. `ADC`. */
  unit: string;
  /** Absolute directory without trailing slash, e.g. `/var/log/brake`. */
  directory: string;
  /** File name glob within the directory; `*` and `?` are wildcards. */
  pattern: string;
}

const UNIT = /^[A-Z][A-Z0-9_-]{0,31}$/;
const PATTERN = /^[A-Za-z0-9._*?-]{1,128}$/;
const SEGMENT = /^[A-Za-z0-9._-]+$/;

export function normalizeSource(input: { unit: string; directory: string; pattern: string }): DataSource {
  const unit = input.unit.trim().toUpperCase();
  if (!UNIT.test(unit)) throw rule('INVALID_SOURCE', `invalid source unit: ${input.unit}`);

  const raw = input.directory.trim();
  if (!raw.startsWith('/')) throw rule('INVALID_SOURCE', 'source directory must be absolute');
  const segments = raw.split('/').filter((s) => s.length > 0);
  for (const s of segments) {
    if (s === '.' || s === '..' || !SEGMENT.test(s)) throw rule('INVALID_SOURCE', `invalid directory segment: ${s}`);
  }
  const directory = `/${segments.join('/')}`;

  const pattern = input.pattern.trim();
  if (!PATTERN.test(pattern)) throw rule('INVALID_SOURCE', `invalid file pattern: ${input.pattern}`);
  return { unit, directory, pattern };
}

export function sameSource(a: DataSource, b: DataSource): boolean {
  return a.unit === b.unit && a.directory === b.directory && a.pattern === b.pattern;
}

/** True if some file name matches both globs (`*` any run, `?` one character). */
export function globsIntersect(a: string, b: string): boolean {
  const memo = new Map<number, boolean>();
  const width = b.length + 1;
  const visit = (i: number, j: number): boolean => {
    const key = i * width + j;
    const cached = memo.get(key);
    if (cached !== undefined) return cached;
    let result: boolean;
    if (i === a.length && j === b.length) {
      result = true;
    } else if (i < a.length && a[i] === '*') {
      // a's star matches nothing, or absorbs b's next symbol.
      result = visit(i + 1, j) || (j < b.length && visit(i, j + 1));
    } else if (j < b.length && b[j] === '*') {
      result = visit(i, j + 1) || (i < a.length && visit(i + 1, j));
    } else if (i < a.length && j < b.length) {
      const x = a[i];
      const y = b[j];
      result = (x === '?' || y === '?' || x === y) && visit(i + 1, j + 1);
    } else {
      result = false;
    }
    memo.set(key, result);
    return result;
  };
  return visit(0, 0);
}

/** Different patterns in the same unit and directory that can match the same file. */
export function sourcesOverlap(a: DataSource, b: DataSource): boolean {
  return a.unit === b.unit && a.directory === b.directory && a.pattern !== b.pattern && globsIntersect(a.pattern, b.pattern);
}

/** Readable code stem: `<group code>.<pattern without extension>`, e.g. `chassis.brake.brake.debug`. */
export function dataCodeStem(groupCode: string, pattern: string): string {
  const stem = pattern
    .replace(/\.[^.*?]+$/, '')
    .replace(/[^a-zA-Z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .toLowerCase();
  const safe = /^[a-z]/.test(stem) ? stem : stem ? `d.${stem}` : 'data';
  return `${groupCode}.${safe}`;
}
