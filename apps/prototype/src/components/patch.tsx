// The mainline (主线) and same-software patches (补丁): how integration, release and Features show
// which line a preview, candidate, set or Feature is on.

import { Space, Tag, Tooltip } from 'antd';
import { useEngineState } from '../app/store.ts';
import { patchesOf, versionsInEffect } from '../engine/release.ts';
import type { Feature, MergePatch, Release, State } from '../engine/types.ts';
import { useI18n } from '../i18n/i18n.tsx';
import { setName } from '../i18n/vocab.ts';

/** The set a preview or candidate merges onto: the mainline head, or the older set a patch fixes. */
export function TargetSet({ targetReleaseId, patch }: { targetReleaseId: string | null; patch: MergePatch | null }) {
  const state = useEngineState();
  const { L, B } = useI18n();
  const release = targetReleaseId ? state.releases[targetReleaseId] : undefined;
  if (!release) return <>{L('无（首次集成）', 'none (first integration)')}</>;
  return (
    <Space size={4} wrap>
      {B(setName(release.dclVersion))}
      {patch ? (
        <Tag color="purple">{L(`补丁 · 软件 ${patch.versions.join('、')}`, `patch · software ${patch.versions.join(', ')}`)}</Tag>
      ) : (
        <Tag>{L('主线', 'mainline')}</Tag>
      )}
    </Space>
  );
}

/** Where a published set sits: on the mainline, or a patch of an older set. */
export function LineTag({ release }: { release: Release }) {
  const state = useEngineState();
  const { L } = useI18n();
  const of = release.patchOf ? state.releases[release.patchOf] : undefined;
  if (!release.patchOf) return <Tag>{L('主线', 'mainline')}</Tag>;
  return <Tag color="purple">{L(`补丁 · 基于 ${of?.dclVersion ?? '?'}`, `patch of ${of?.dclVersion ?? '?'}`)}</Tag>;
}

/** A Feature released in a same-software patch: it still has to reach the mainline, or be closed for it. */
export function PatchedTag({ feature }: { feature: Feature }) {
  const state = useEngineState();
  const { L } = useI18n();
  const patch = patchesOf(state, feature).at(-1);
  if (!patch) return null;
  const done = feature.stage === 'ARCHIVED';
  return (
    <Tooltip
      title={
        done
          ? undefined
          : L(
              '同软件版本补丁里的修复也要合入主线，否则下一个主线版本会缺少它。配置集成在主线合并中收集它，或写明理由“不合入主线”。',
              'A fix released in a same-software patch must reach the mainline too, or the next mainline set lacks it. Integration collects it in a mainline merge, or closes it for the mainline with a reason.',
            )
      }
    >
      <Tag color="purple">
        {done ? L(`已进入补丁 ${patch.dclVersion}`, `In patch ${patch.dclVersion}`) : L(`已进入补丁 ${patch.dclVersion} · 待合入主线`, `In patch ${patch.dclVersion} · mainline pending`)}
      </Tag>
    </Tooltip>
  );
}

/** A patch target as an option: the set and the software versions it is in effect for. */
export function patchTargetLabel(state: State, release: Release, L: (zh: string, en: string) => string): string {
  const versions = versionsInEffect(state, release);
  return L(`策略集 ${release.dclVersion} · 软件 ${versions.join('、')} 在用`, `Policy set ${release.dclVersion} · in effect for ${versions.join(', ')}`);
}
