import { Card, Descriptions, Space, Table, Tag, Timeline, Typography } from 'antd';
import { useEngineState } from '../../app/store.ts';
import { DiffView } from '../../components/DiffView.tsx';
import { Mono, ShortId, when } from '../../components/common.tsx';
import { commitChanges, displayName, featureChanges } from '../../engine/config.ts';
import { resolveFiles } from '../../engine/snapshots.ts';
import type { Feature } from '../../engine/types.ts';
import { useI18n } from '../../i18n/i18n.tsx';
import { FEEDBACK_LABELS } from '../../i18n/vocab.ts';

export function useNameOf(feature: Feature) {
  const state = useEngineState();
  const files = resolveFiles(state, feature.draft);
  return (key: string) =>
    files[key]?.name ??
    Object.values(state.fileSpecVersions)
      .filter((v) => v.dataKey === key)
      .sort((a, b) => b.version - a.version)[0]?.content.name ??
    key;
}

export function ChangesTab({ feature }: { feature: Feature }) {
  const state = useEngineState();
  const { L } = useI18n();
  const nameOf = useNameOf(feature);
  const changes = featureChanges(state, feature);
  return (
    <Space orientation="vertical" size={16} style={{ width: '100%' }}>
      <Card title={L('相对最新提交（未提交的修改）', 'Since the head commit (unsubmitted)')}>
        <DiffView diff={changes.sinceHead} nameOf={nameOf} />
      </Card>
      <Card title={L('相对基线（本 Feature 的全部变更）', 'Since the base (everything this Feature changes)')}>
        <DiffView diff={changes.sinceBase} nameOf={nameOf} />
      </Card>
    </Space>
  );
}

export function CommitsTab({ feature }: { feature: Feature }) {
  const state = useEngineState();
  const { L } = useI18n();
  const nameOf = useNameOf(feature);
  const commits = Object.values(state.commits)
    .filter((c) => c.featureId === feature.id)
    .sort((a, b) => b.sequence - a.sequence);
  return (
    <Card>
      <Table
        rowKey="id"
        dataSource={commits}
        pagination={false}
        locale={{ emptyText: L('还没有提交', 'No commits yet') }}
        expandable={{
          expandedRowRender: (c) => {
            const manifest = state.manifestVersions[c.manifestVersionId]!;
            return (
              <Space orientation="vertical" style={{ width: '100%' }}>
                <DiffView diff={commitChanges(state, c.id)} nameOf={nameOf} />
                <Descriptions size="small" column={1} bordered>
                  <Descriptions.Item label={L('文件列表版本', 'File list version')}>
                    v{manifest.version} <ShortId value={manifest.digest} size={20} />
                  </Descriptions.Item>
                  {manifest.entries.map((e) => {
                    const v = state.fileSpecVersions[e.fileSpecVersionId]!;
                    const owned = state.dataItems[e.dataKey]?.ownerGroupId === c.groupId;
                    return (
                      <Descriptions.Item key={e.dataKey} label={v.content.name}>
                        FileSpec v{v.version} {!owned && <Tag>{L('引用', 'reference')}</Tag>} <ShortId value={v.digest} size={20} />
                      </Descriptions.Item>
                    );
                  })}
                  {Object.entries(c.policies).map(([pid, vid]) => (
                    <Descriptions.Item key={pid} label={<Mono>{pid}</Mono>}>
                      Policy v{state.policyVersions[vid]!.version} <ShortId value={state.policyVersions[vid]!.digest} size={20} />
                    </Descriptions.Item>
                  ))}
                </Descriptions>
              </Space>
            );
          },
        }}
        columns={[
          { title: L('提交', 'Commit'), render: (_, c) => <Mono>{displayName(state, c.id)}</Mono> },
          { title: L('说明', 'Message'), dataIndex: 'message' },
          { title: L('作者', 'Author'), render: (_, c) => state.accounts[c.author]?.displayName ?? c.author },
          { title: L('时间', 'Time'), render: (_, c) => when(c.createdAt) },
          { title: L('摘要', 'Digest'), render: (_, c) => <ShortId value={c.digest} size={18} /> },
        ]}
      />
    </Card>
  );
}

export function FeedbackTimeline({ feature }: { feature: Feature }) {
  const state = useEngineState();
  const { L, B } = useI18n();
  const items = state.feedback.filter((f) => f.featureId === feature.id).reverse();
  if (items.length === 0) return <Typography.Text type="secondary">{L('暂无反馈', 'No feedback')}</Typography.Text>;
  return (
    <Timeline
      items={items.map((f) => ({
        color: f.kind === 'BINDING_CHANGED' ? 'blue' : 'red',
        children: (
          <div>
            <Tag>{B(FEEDBACK_LABELS[f.kind])}</Tag>
            <Typography.Text>{f.reason}</Typography.Text>
            <div>
              <Typography.Text type="secondary">
                {state.accounts[f.author]?.displayName ?? f.author} · {when(f.createdAt)}
                {f.commitId ? ` · ${displayName(state, f.commitId)}` : ''}
              </Typography.Text>
            </div>
          </div>
        ),
      }))}
    />
  );
}
