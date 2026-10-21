// Reading committed configuration back into the GroupConfig shape used by drafts.

import { emptyConfig } from '../domain/config.ts';
import type { FileSpecContent, GroupConfig } from '../domain/config.ts';
import { notFound } from '../domain/errors.ts';
import type { FileSpecVersion, State } from './types.ts';

/** The configuration a commit captured: owned files by content, references by pinned version. */
export function commitSnapshot(s: State, commitId: string): GroupConfig {
  const commit = s.commits[commitId];
  if (!commit) throw notFound('commit', commitId);
  const manifest = s.manifestVersions[commit.manifestVersionId]!;
  const config = emptyConfig();
  for (const e of manifest.entries) {
    const version = s.fileSpecVersions[e.fileSpecVersionId]!;
    if (s.dataItems[e.dataKey]?.ownerGroupId === commit.groupId) config.files[e.dataKey] = version.content;
    else config.references[e.dataKey] = version.id;
  }
  for (const [policyId, versionId] of Object.entries(commit.policies)) config.policies[policyId] = s.policyVersions[versionId]!.content;
  return config;
}

/** Every file the configuration collects, owned or referenced, with its content. */
export function resolveFiles(s: State, config: GroupConfig): Record<string, FileSpecContent> {
  const files: Record<string, FileSpecContent> = { ...config.files };
  for (const [dataKey, versionId] of Object.entries(config.references)) {
    const v = s.fileSpecVersions[versionId];
    if (v && v.dataKey === dataKey) files[dataKey] = v.content;
  }
  return files;
}

/**
 * The owner's current definition of a data item: the version in the owner group's most recent
 * commit that contains it. Versions are content-addressed and reused, so the highest version
 * number is not necessarily the current definition.
 */
export function latestCommittedVersion(s: State, dataKey: string): FileSpecVersion | undefined {
  const owner = s.dataItems[dataKey]?.ownerGroupId;
  if (!owner) return undefined;
  const commits = Object.values(s.commits)
    .filter((c) => c.groupId === owner)
    .sort((a, b) => b.seq - a.seq);
  for (const c of commits) {
    const entry = s.manifestVersions[c.manifestVersionId]!.entries.find((e) => e.dataKey === dataKey);
    if (entry) return s.fileSpecVersions[entry.fileSpecVersionId];
  }
  return undefined;
}
