import { Button, Card, Input, Modal, Radio, Space, Table, Tag, Typography } from 'antd';
import { useState } from 'react';
import { useActor, useRun } from '../app/hooks.ts';
import { navigate } from '../app/router.ts';
import { useEngineState } from '../app/store.ts';
import { Hint, Mono, PageHeader, when } from '../components/common.tsx';
import { displayName, reviewOverlap } from '../engine/config.ts';
import { intakeQueue } from '../engine/intake.ts';
import { useI18n } from '../i18n/i18n.tsx';

export function IntakePage() {
  const state = useEngineState();
  const actor = useActor()!;
  const { L } = useI18n();
  const run = useRun();
  const q = intakeQueue(state, actor);
  const [deciding, setDeciding] = useState<string | null>(null);
  const [decision, setDecision] = useState<'DISTINCT' | 'DUPLICATE'>('DISTINCT');
  const [note, setNote] = useState('');
  const src = (key: string) => {
    const d = state.dataItems[key];
    return d ? `${d.source.unit}:${d.source.directory}/${d.source.pattern}` : key;
  };

  return (
    <div className="kz-page">
      <PageHeader title={L('DCL 接入队列', 'DCL intake queue')} subtitle={L('按你的 DCL 授权过滤：待审核的敏感文件与待判定的来源重叠。', 'Filtered by your DCL grants: sensitive files to review and overlapping sources to decide.')} />
      <Space orientation="vertical" size={16} style={{ width: '100%' }}>
        <Card title={L('待敏感审核的 Feature', 'Features awaiting sensitive review')}>
          <Table
            rowKey={(r) => r.feature.id}
            pagination={false}
            dataSource={q.features}
            locale={{ emptyText: L('没有待审核的 Feature', 'Nothing to review') }}
            onRow={(r) => ({ onClick: () => navigate(`features/${r.feature.id}/intake`), style: { cursor: 'pointer' } })}
            columns={[
              { title: L('提交', 'Commit'), render: (_, r) => <Mono>{displayName(state, r.feature.headCommitId!)}</Mono> },
              { title: L('工作区', 'Workspace'), render: (_, r) => state.workspaces[r.feature.workspaceId]?.name },
              {
                title: L('待审核文件', 'Files to review'),
                render: (_, r) =>
                  r.reviews.map((i) => (
                    <Tag key={i.dataKey} color={i.status === 'REJECTED' ? 'red' : i.status === 'APPROVED' ? 'green' : 'orange'}>
                      {state.fileSpecVersions[Object.values(state.fileSpecVersions).find((v) => v.dataKey === i.dataKey)?.id ?? '']?.content.name ?? i.dataKey}
                    </Tag>
                  )),
              },
              { title: L('提交时间', 'Submitted'), render: (_, r) => when(r.feature.updatedAt) },
            ]}
          />
        </Card>
        <Card title={L('来源重叠待判定', 'Overlapping sources to decide')}>
          <Hint>{L('同一域控、同一目录下匹配规则有交集的来源。判定为“不同数据”后可继续提交；判定为“重复”则归档，由业务方改用已有数据。', 'Sources in the same unit and directory whose patterns intersect. “Distinct” lets the submit proceed; “Duplicate” archives it so the business uses the existing data.')}</Hint>
          <Table
            rowKey={(r) => r.item.dataKey}
            pagination={false}
            dataSource={q.overlaps}
            locale={{ emptyText: L('没有待判定的重叠', 'No overlaps to decide') }}
            columns={[
              { title: L('新登记来源', 'New source'), render: (_, r) => <Mono>{src(r.item.dataKey)}</Mono> },
              { title: L('登记分组', 'Group'), render: (_, r) => state.groups[r.item.ownerGroupId]?.name },
              {
                title: L('与之重叠', 'Overlaps with'),
                render: (_, r) => (
                  <Space orientation="vertical" size={0}>
                    {r.item.overlapSuspects.map((k) => (
                      <span key={k}>
                        <Mono>{src(k)}</Mono> <Typography.Text type="secondary">({state.groups[state.dataItems[k]?.ownerGroupId ?? '']?.name})</Typography.Text>
                      </span>
                    ))}
                  </Space>
                ),
              },
              {
                title: '',
                render: (_, r) => (
                  <Button size="small" onClick={() => (setDeciding(r.item.dataKey), setNote(''), setDecision('DISTINCT'))}>
                    {L('判定', 'Decide')}
                  </Button>
                ),
              },
            ]}
          />
        </Card>
      </Space>
      <Modal
        open={deciding !== null}
        title={L('判定来源重叠', 'Decide overlap')}
        onCancel={() => setDeciding(null)}
        onOk={() => {
          if (run((c) => reviewOverlap(c, deciding!, { decision, note }), L('已判定', 'Decided')) !== undefined) setDeciding(null);
        }}
      >
        <Radio.Group value={decision} onChange={(e) => setDecision(e.target.value)} style={{ marginBottom: 12 }}>
          <Radio value="DISTINCT">{L('不同数据，保留', 'Distinct data, keep')}</Radio>
          <Radio value="DUPLICATE">{L('重复，归档', 'Duplicate, archive')}</Radio>
        </Radio.Group>
        <Input.TextArea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={L('判定说明', 'Explanation')} />
      </Modal>
    </div>
  );
}
