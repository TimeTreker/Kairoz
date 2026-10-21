import { Button, Card, Input, Modal, Popconfirm, Select, Space, Table, Tabs, Tag, Typography } from 'antd';
import { useState } from 'react';
import { useActor, useCan, useRun, useWorkspace } from '../app/hooks.ts';
import { useEngineState } from '../app/store.ts';
import { Hint, LabelTag, Mono, PageHeader, when } from '../components/common.tsx';
import { canReadGroupConfig } from '../domain/authz.ts';
import { visibleSuspects } from '../engine/config.ts';
import { decideReference, referenceCatalog, referenceRequestsFor, requestReference, revokeReference } from '../engine/references.ts';
import { latestCommittedVersion } from '../engine/snapshots.ts';
import { useI18n } from '../i18n/i18n.tsx';
import { DATA_STATUS_LABELS, REFERENCE_STATUS_LABELS } from '../i18n/vocab.ts';

export function DataCatalogPage() {
  const state = useEngineState();
  const actor = useActor()!;
  const { workspace } = useWorkspace();
  const { L } = useI18n();
  const can = useCan();
  const run = useRun();
  const readable = (workspace?.groupIds ?? [])
    .map((g) => state.groups[g]!)
    .filter((g) => canReadGroupConfig(actor.grants, { groupId: g.id, domain: g.domain, workspaceId: workspace!.id }));
  const [groupId, setGroupId] = useState<string | undefined>(undefined);
  const group = state.groups[groupId ?? readable[0]?.id ?? ''];
  const [asking, setAsking] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<{ id: string; action: 'APPROVED' | 'REJECTED' | 'REVOKE' } | null>(null);
  const [reason, setReason] = useState('');

  if (!workspace || !group) {
    return (
      <div className="kz-page">
        <PageHeader title={L('数据目录与引用', 'Data & references')} />
        <Typography.Text type="secondary">{L('当前工作区没有可查看的业务分组。', 'No readable business group in this workspace.')}</Typography.Text>
      </div>
    );
  }
  const own = Object.values(state.dataItems).filter((d) => d.ownerGroupId === group.id);
  const catalog = referenceCatalog(state, group.id);
  const canRequest = can('reference.request', { groupId: group.id, scope: group.domain });
  const canDecide = can('reference.decide', { groupId: group.id });
  const incoming = referenceRequestsFor(state, actor, group.id, 'owner');
  const outgoing = referenceRequestsFor(state, actor, group.id, 'reader');
  const latestName = (key: string) =>
    latestCommittedVersion(state, key)?.content.name ??
    Object.values(state.features).flatMap((f) => (f.draft.files[key] ? [f.draft.files[key]!.name] : []))[0] ??
    key;

  return (
    <div className="kz-page">
      <PageHeader
        title={L('数据目录与引用', 'Data & references')}
        subtitle={L('本组登记的数据身份、其他分组可引用的数据，以及跨组只读引用的申请与授权。', 'The group’s data identities, other groups’ referable data, and read-only reference requests.')}
        extra={<Select value={group.id} style={{ minWidth: 220 }} onChange={setGroupId} options={readable.map((g) => ({ value: g.id, label: `${g.name} (${g.code})` }))} />}
      />
      <Tabs
        items={[
          {
            key: 'own',
            label: L('本组数据', 'Own data'),
            children: (
              <Card>
                <Hint>{L('data_key 是平台生成的稳定身份，不由路径或文件名推导；名称可以修改，身份不变。', 'data_key is a stable platform-generated identity, never derived from paths or names; names may change, identity does not.')}</Hint>
                <Table
                  rowKey="dataKey"
                  dataSource={own}
                  pagination={{ pageSize: 20, hideOnSinglePage: true }}
                  columns={[
                    { title: L('名称', 'Name'), render: (_, d) => latestName(d.dataKey) },
                    { title: L('代码', 'Code'), render: (_, d) => <Mono>{d.dataCode}</Mono> },
                    { title: 'data_key', render: (_, d) => <Mono>{d.dataKey}</Mono> },
                    { title: L('来源', 'Source'), render: (_, d) => <Mono>{`${d.source.unit}:${d.source.directory}/${d.source.pattern}`}</Mono> },
                    {
                      title: L('状态', 'Status'),
                      render: (_, d) => (
                        <Space size={4}>
                          <LabelTag map={DATA_STATUS_LABELS} value={d.status} />
                          {visibleSuspects(state, group.id, d.overlapSuspects).overlapsOtherGroups && <Tag color="orange">{L('与其他分组重叠', 'Overlaps another group')}</Tag>}
                        </Space>
                      ),
                    },
                    { title: L('当前版本', 'Current version'), render: (_, d) => (latestCommittedVersion(state, d.dataKey) ? `v${latestCommittedVersion(state, d.dataKey)!.version}` : '—') },
                  ]}
                />
              </Card>
            ),
          },
          {
            key: 'catalog',
            label: L('可引用数据', 'Referable data'),
            children: (
              <Card>
                <Hint>{L('未获授权时只显示名称、所属分组和状态；来源、代码与处理定义保持隐藏。', 'Without a grant only name, owner and status are shown; source, code and processing stay hidden.')}</Hint>
                <Table
                  rowKey="dataKey"
                  dataSource={catalog}
                  pagination={{ pageSize: 20, hideOnSinglePage: true }}
                  columns={[
                    { title: L('名称', 'Name'), dataIndex: 'name' },
                    { title: L('所属分组', 'Owner'), render: (_, c) => state.groups[c.ownerGroupId]?.name },
                    { title: L('授权', 'Access'), render: (_, c) => <LabelTag map={REFERENCE_STATUS_LABELS} value={c.access} color={c.access === 'APPROVED' ? 'green' : c.access === 'PENDING' ? 'orange' : undefined} /> },
                    { title: L('代码 / 版本', 'Code / version'), render: (_, c) => (c.dataCode ? <Space><Mono>{c.dataCode}</Mono><span>v{c.latestVersion}</span></Space> : <Typography.Text type="secondary">{L('隐藏', 'hidden')}</Typography.Text>) },
                    {
                      title: '',
                      render: (_, c) =>
                        canRequest &&
                        (c.access === 'NONE' || c.access === 'REJECTED' || c.access === 'REVOKED') && (
                          <Button size="small" onClick={() => (setAsking(c.dataKey), setReason(''))}>
                            {L('申请只读引用', 'Request reference')}
                          </Button>
                        ),
                    },
                  ]}
                />
              </Card>
            ),
          },
          {
            key: 'requests',
            label: L('引用申请', 'Reference requests'),
            children: (
              <Space orientation="vertical" size={16} style={{ width: '100%' }}>
                <Card title={L('其他分组申请使用本组数据', 'Requests for this group’s data')}>
                  <Table
                    rowKey="id"
                    pagination={false}
                    dataSource={incoming}
                    locale={{ emptyText: L('没有申请', 'No requests') }}
                    columns={[
                      { title: L('数据', 'Data'), render: (_, r) => latestName(r.dataKey) },
                      { title: L('申请分组', 'Requested by'), render: (_, r) => `${state.groups[r.readerGroupId]?.name} · ${state.accounts[r.requestedBy]?.displayName}` },
                      { title: L('理由', 'Reason'), dataIndex: 'requestReason' },
                      { title: L('状态', 'Status'), render: (_, r) => <LabelTag map={REFERENCE_STATUS_LABELS} value={r.status} /> },
                      { title: L('时间', 'Time'), render: (_, r) => when(r.createdAt) },
                      {
                        title: '',
                        render: (_, r) =>
                          canDecide && (
                            <Space size={0}>
                              {r.status === 'PENDING' && (
                                <>
                                  <Button type="link" size="small" onClick={() => (setDeciding({ id: r.id, action: 'APPROVED' }), setReason(''))}>
                                    {L('批准', 'Approve')}
                                  </Button>
                                  <Button type="link" size="small" danger onClick={() => (setDeciding({ id: r.id, action: 'REJECTED' }), setReason(''))}>
                                    {L('拒绝', 'Reject')}
                                  </Button>
                                </>
                              )}
                              {r.status === 'APPROVED' && (
                                <Popconfirm title={L('撤销后读取方的新提交将被阻止', 'The reader’s new submits will be blocked')} onConfirm={() => (setDeciding({ id: r.id, action: 'REVOKE' }), setReason(''))}>
                                  <Button type="link" size="small" danger>
                                    {L('撤销', 'Revoke')}
                                  </Button>
                                </Popconfirm>
                              )}
                            </Space>
                          ),
                      },
                    ]}
                  />
                </Card>
                <Card title={L('本组提出的申请', 'Requests made by this group')}>
                  <Table
                    rowKey="id"
                    pagination={false}
                    dataSource={outgoing}
                    locale={{ emptyText: L('没有申请', 'No requests') }}
                    columns={[
                      { title: L('数据', 'Data'), render: (_, r) => catalog.find((c) => c.dataKey === r.dataKey)?.name ?? r.dataKey },
                      { title: L('所属分组', 'Owner'), render: (_, r) => state.groups[state.dataItems[r.dataKey]?.ownerGroupId ?? '']?.name },
                      { title: L('状态', 'Status'), render: (_, r) => <LabelTag map={REFERENCE_STATUS_LABELS} value={r.status} /> },
                      { title: L('答复', 'Answer'), render: (_, r) => r.decisionReason ?? '—' },
                    ]}
                  />
                </Card>
              </Space>
            ),
          },
        ]}
      />
      <Modal
        open={asking !== null}
        title={L('申请只读引用', 'Request a read-only reference')}
        onCancel={() => setAsking(null)}
        onOk={() => {
          if (run((c) => requestReference(c, { dataKey: asking!, readerGroupId: group.id, reason }), L('已提交申请', 'Requested')) !== undefined) setAsking(null);
        }}
      >
        <Input.TextArea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={L('为什么需要这份数据', 'Why the data is needed')} />
      </Modal>
      <Modal
        open={deciding !== null}
        title={deciding?.action === 'REVOKE' ? L('撤销引用', 'Revoke reference') : deciding?.action === 'APPROVED' ? L('批准引用', 'Approve reference') : L('拒绝引用', 'Reject reference')}
        onCancel={() => setDeciding(null)}
        onOk={() => {
          const d = deciding!;
          const ok =
            d.action === 'REVOKE'
              ? run((c) => revokeReference(c, d.id, { reason }), L('已撤销', 'Revoked'))
              : run((c) => decideReference(c, d.id, { decision: d.action as 'APPROVED' | 'REJECTED', reason }), L('已处理', 'Done'));
          if (ok !== undefined) setDeciding(null);
        }}
      >
        <Input.TextArea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={L('说明（拒绝和撤销必填）', 'Reason (required to reject or revoke)')} />
      </Modal>
    </div>
  );
}
