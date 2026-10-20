// Reading committed configuration back into the GroupConfig shape used by drafts.

import type { Db } from '../../db/pool.ts';
import { many } from '../../db/pool.ts';
import { emptyConfig } from '../../domain/config.ts';
import type { FileSpecContent, GroupConfig } from '../../domain/config.ts';

/** The configuration a commit captured: owned files by content, references by pinned version. */
export async function commitSnapshot(db: Db, commitId: string): Promise<GroupConfig> {
  const entries = await many<{ data_key: string; version_id: string; content: FileSpecContent; owned: boolean }>(
    db,
    `SELECT e.data_key, e.file_spec_version_id AS version_id, v.content, d.owner_group_id = c.group_id AS owned
     FROM commits c
       JOIN manifest_entries e ON e.manifest_version_id = c.manifest_version_id
       JOIN file_spec_versions v ON v.id = e.file_spec_version_id
       JOIN data_items d ON d.data_key = e.data_key
     WHERE c.id = $1`,
    [commitId],
  );
  const policies = await many<{ policy_id: string; content: GroupConfig['policies'][string] }>(
    db,
    `SELECT cp.policy_id, v.content FROM commit_policies cp JOIN policy_versions v ON v.id = cp.policy_version_id
     WHERE cp.commit_id = $1`,
    [commitId],
  );
  const config = emptyConfig();
  for (const e of entries) {
    if (e.owned) config.files[e.data_key] = e.content;
    else config.references[e.data_key] = e.version_id;
  }
  for (const p of policies) config.policies[p.policy_id] = p.content;
  return config;
}

export interface ReferencedVersion {
  id: string;
  dataKey: string;
  version: number;
  digest: string;
  ownerGroupId: string;
  content: FileSpecContent;
}

export async function referencedVersions(db: Db, versionIds: string[]): Promise<Map<string, ReferencedVersion>> {
  const rows = await many<{ id: string; data_key: string; version: number; digest: string; owner_group_id: string; content: FileSpecContent }>(
    db,
    `SELECT v.id, v.data_key, v.version, v.digest, d.owner_group_id, v.content
     FROM file_spec_versions v JOIN data_items d ON d.data_key = v.data_key
     WHERE v.id = ANY($1::uuid[])`,
    [versionIds],
  );
  return new Map(
    rows.map((r) => [
      r.id,
      { id: r.id, dataKey: r.data_key, version: r.version, digest: r.digest, ownerGroupId: r.owner_group_id, content: r.content },
    ]),
  );
}

/** Every file the configuration collects, owned or referenced, with its content. */
export async function resolveFiles(db: Db, config: GroupConfig): Promise<Record<string, FileSpecContent>> {
  const files: Record<string, FileSpecContent> = { ...config.files };
  const versions = await referencedVersions(db, Object.values(config.references));
  for (const [dataKey, versionId] of Object.entries(config.references)) {
    const v = versions.get(versionId);
    if (v && v.dataKey === dataKey) files[dataKey] = v.content;
  }
  return files;
}

/**
 * The owner's current definition of a data item: the version in the owner group's most recent
 * commit that contains it. Versions are content-addressed and reused, so the highest version
 * number is not necessarily the current definition.
 */
export async function latestCommittedVersion(db: Db, dataKey: string): Promise<ReferencedVersion | undefined> {
  const row = await many<{ id: string }>(
    db,
    `SELECT e.file_spec_version_id AS id
     FROM data_items d
       JOIN commits c ON c.group_id = d.owner_group_id
       JOIN manifest_entries e ON e.manifest_version_id = c.manifest_version_id AND e.data_key = d.data_key
     WHERE d.data_key = $1
     ORDER BY c.created_at DESC, c.id DESC LIMIT 1`,
    [dataKey],
  );
  if (!row[0]) return undefined;
  return (await referencedVersions(db, [row[0].id])).get(row[0].id);
}
