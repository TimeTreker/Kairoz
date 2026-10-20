// Configuration content owned by one business group: its file list and its collection policies.
// A Feature edits a full working copy (draft); submitting it creates immutable versions.
// The file list may also hold read-only references to other groups' files, pinned to one of
// their immutable FileSpec versions; the definition stays with its owner.

import { canonicalJson } from './canonical.ts';
import type { DataSource } from './data-source.ts';
import { rule } from './errors.ts';
import type { FileType, Privacy } from './file-types.ts';
import { parseTrigger } from './trigger.ts';

export const PRIORITIES = ['LOW', 'NORMAL', 'HIGH'] as const;
export type Priority = (typeof PRIORITIES)[number];

/** Maximum capture window around a trigger (pre + post), in seconds. */
export const MAX_CAPTURE_WINDOW_SECONDS = 120;

/** One file in a group's file list, including its fixed processing binding. */
export interface FileSpecContent {
  name: string;
  source: DataSource;
  fileType: FileType;
  purpose: string;
  privacy: Privacy;
  retentionDays: number;
  contentTags: string[];
  priority: Priority;
  templateId: string;
  format: string;
  schema: string;
  edgePipelineId: string;
  cloudPipelineId: string;
  requiresReview: boolean;
}

export interface PolicyContent {
  name: string;
  trigger: string;
  /** data_keys captured when the trigger fires; sorted and unique. */
  captures: string[];
  preSeconds: number;
  postSeconds: number;
  priority: Priority;
}

export interface GroupConfig {
  /** Files this group owns and defines. */
  files: Record<string, FileSpecContent>;
  policies: Record<string, PolicyContent>;
  /** Other groups' files used read-only: data_key -> pinned file_spec_versions.id. */
  references: Record<string, string>;
}

export function emptyConfig(): GroupConfig {
  return { files: {}, policies: {}, references: {} };
}

/** Tolerates stored drafts written before a section existed. */
export function normalizeConfig(raw: Partial<GroupConfig>): GroupConfig {
  return { files: raw.files ?? {}, policies: raw.policies ?? {}, references: raw.references ?? {} };
}

/** Keys a policy may capture: owned files and referenced files. */
export function capturableKeys(config: GroupConfig): Set<string> {
  return new Set([...Object.keys(config.files), ...Object.keys(config.references)]);
}

export function normalizeTags(tags: readonly string[]): string[] {
  return [...new Set(tags.map((t) => t.trim().toLowerCase()).filter((t) => t.length > 0))].sort();
}

export function normalizePolicy(input: PolicyContent): PolicyContent {
  return {
    name: input.name.trim(),
    trigger: input.trigger.trim(),
    captures: [...new Set(input.captures)].sort(),
    preSeconds: input.preSeconds,
    postSeconds: input.postSeconds,
    priority: input.priority,
  };
}

/** Policy ids are namespaced by the owning group's code, e.g. `chassis.brake.hard_braking`. */
export function assertPolicyIdForGroup(policyId: string, groupCode: string): void {
  const prefix = `${groupCode}.`;
  const local = policyId.startsWith(prefix) ? policyId.slice(prefix.length) : '';
  if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/.test(local)) {
    throw rule('INVALID_POLICY_ID', `policy id must look like ${prefix}<name>`, { policyId, expectedPrefix: prefix });
  }
}

/** Problems that make a policy invalid within the given file list. */
export function policyIssues(policy: PolicyContent, availableDataKeys: ReadonlySet<string>): string[] {
  const issues: string[] = [];
  if (policy.name.length === 0) issues.push('name is required');
  const parsed = parseTrigger(policy.trigger);
  if (!parsed.ok) issues.push(`trigger: ${parsed.error.message} at ${parsed.error.position}`);
  if (policy.captures.length === 0) issues.push('captures at least one file');
  for (const key of policy.captures) {
    if (!availableDataKeys.has(key)) issues.push(`captures ${key}, which is not in the file list`);
  }
  const window = policy.preSeconds + policy.postSeconds;
  if (
    !Number.isInteger(policy.preSeconds) ||
    !Number.isInteger(policy.postSeconds) ||
    policy.preSeconds < 0 ||
    policy.postSeconds < 0 ||
    window > MAX_CAPTURE_WINDOW_SECONDS
  ) {
    issues.push(`capture window must be whole seconds, 0..${MAX_CAPTURE_WINDOW_SECONDS} in total`);
  }
  return issues;
}

export interface ItemChange {
  key: string;
  fields: string[];
}

export interface SectionDiff {
  added: string[];
  removed: string[];
  changed: ItemChange[];
}

export interface ConfigDiff {
  files: SectionDiff;
  policies: SectionDiff;
  /** A changed reference means the pinned version moved. */
  references: SectionDiff;
  empty: boolean;
}

function diffSection<T extends object>(from: Record<string, T>, to: Record<string, T>): SectionDiff {
  const added = Object.keys(to).filter((k) => !(k in from)).sort();
  const removed = Object.keys(from).filter((k) => !(k in to)).sort();
  const changed: ItemChange[] = [];
  for (const key of Object.keys(to).sort()) {
    const before = from[key] as Record<string, unknown> | undefined;
    const after = to[key] as Record<string, unknown>;
    if (!before) continue;
    const fields = [...new Set([...Object.keys(before), ...Object.keys(after)])]
      .filter((f) => canonicalJson(before[f] ?? null) !== canonicalJson(after[f] ?? null))
      .sort();
    if (fields.length > 0) changed.push({ key, fields });
  }
  return { added, removed, changed };
}

function diffPins(from: Record<string, string>, to: Record<string, string>): SectionDiff {
  return {
    added: Object.keys(to).filter((k) => !(k in from)).sort(),
    removed: Object.keys(from).filter((k) => !(k in to)).sort(),
    changed: Object.keys(to)
      .filter((k) => k in from && from[k] !== to[k])
      .sort()
      .map((key) => ({ key, fields: ['version'] })),
  };
}

export function diffConfig(from: GroupConfig, to: GroupConfig): ConfigDiff {
  const files = diffSection(from.files, to.files);
  const policies = diffSection(from.policies, to.policies);
  const references = diffPins(from.references, to.references);
  const empty = [files, policies, references].every(
    (s) => s.added.length === 0 && s.removed.length === 0 && s.changed.length === 0,
  );
  return { files, policies, references, empty };
}

export function sameConfig(a: GroupConfig, b: GroupConfig): boolean {
  return canonicalJson(a) === canonicalJson(b);
}
