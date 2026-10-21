// Three-way merge of a group's configuration. Each source is compared with its own base, and its
// changes are applied onto the target ("ours"). A different base alone is never a conflict; only
// the same item or field changed in different ways is.

import { canonicalJson } from './canonical.ts';
import type { GroupConfig } from './config.ts';

export interface MergeSource {
  featureId: string;
  base: GroupConfig;
  theirs: GroupConfig;
}

export interface FieldConflict {
  section: 'files' | 'policies' | 'references';
  key: string;
  /** '*' when the whole item conflicts. */
  field: string;
  base: unknown;
  ours: unknown;
  theirs: unknown;
  featureIds: string[];
}

export interface GroupMergeResult {
  merged: GroupConfig;
  conflicts: FieldConflict[];
}

/** Derived fields are recomputed after a merge and never conflict on their own. */
const DERIVED_FIELDS = new Set(['requiresReview']);
/** Fields that DCL engineering owns (processing binding); everything else is business-owned. */
export const PROCESSING_FIELDS = new Set(['templateId', 'format', 'schema', 'edgePipelineId', 'cloudPipelineId']);

const eq = (a: unknown, b: unknown) => canonicalJson(a ?? null) === canonicalJson(b ?? null);
const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));

export function mergeGroup(ours: GroupConfig, sources: MergeSource[]): GroupMergeResult {
  const merged = clone(ours);
  const conflicts: FieldConflict[] = [];
  /** Which source last changed an item or field, to name both sides of a conflict. */
  const writers = new Map<string, string>();
  const writer = (path: string) => writers.get(path);
  const conflict = (c: Omit<FieldConflict, 'featureIds'>, featureId: string, path: string) => {
    const previous = writer(path);
    conflicts.push({ ...c, featureIds: previous && previous !== featureId ? [previous, featureId] : [featureId] });
  };

  for (const src of sources) {
    for (const section of ['files', 'policies'] as const) {
      const base = src.base[section] as unknown as Record<string, Record<string, unknown>>;
      const theirs = src.theirs[section] as unknown as Record<string, Record<string, unknown>>;
      const result = merged[section] as unknown as Record<string, Record<string, unknown>>;
      for (const key of [...new Set([...Object.keys(base), ...Object.keys(theirs)])].sort()) {
        const b = base[key];
        const t = theirs[key];
        const r = result[key];
        const itemPath = `${section}:${key}`;
        if (eq(b, t)) continue; // this source did not touch it
        if (b === undefined) {
          // Added by the source.
          if (r === undefined) {
            result[key] = clone(t!);
            writers.set(itemPath, src.featureId);
          } else if (!eq(r, t)) {
            conflict({ section, key, field: '*', base: undefined, ours: r, theirs: t }, src.featureId, itemPath);
          }
          continue;
        }
        if (t === undefined) {
          // Removed by the source.
          if (r === undefined) continue;
          if (eq(r, b)) {
            delete result[key];
            writers.set(itemPath, src.featureId);
          } else {
            conflict({ section, key, field: '*', base: b, ours: r, theirs: undefined }, src.featureId, itemPath);
          }
          continue;
        }
        // Changed by the source: merge field by field.
        if (r === undefined) {
          conflict({ section, key, field: '*', base: b, ours: undefined, theirs: t }, src.featureId, itemPath);
          continue;
        }
        for (const field of [...new Set([...Object.keys(b), ...Object.keys(t)])].sort()) {
          if (DERIVED_FIELDS.has(field) || eq(b[field], t[field])) continue;
          const fieldPath = `${itemPath}:${field}`;
          if (eq(r[field], b[field])) {
            r[field] = clone(t[field]);
            writers.set(fieldPath, src.featureId);
          } else if (!eq(r[field], t[field])) {
            conflict({ section, key, field, base: b[field], ours: r[field], theirs: t[field] }, src.featureId, fieldPath);
          }
        }
      }
    }
    // References are pins to an immutable version: a scalar per data key.
    const base = src.base.references;
    const theirs = src.theirs.references;
    for (const key of [...new Set([...Object.keys(base), ...Object.keys(theirs)])].sort()) {
      const b = base[key];
      const t = theirs[key];
      if (b === t) continue;
      const r = merged.references[key];
      const path = `references:${key}`;
      if (r === b) {
        if (t === undefined) delete merged.references[key];
        else merged.references[key] = t;
        writers.set(path, src.featureId);
      } else if (r !== t) {
        conflict({ section: 'references', key, field: '*', base: b, ours: r, theirs: t }, src.featureId, path);
      }
    }
  }
  return { merged, conflicts };
}
