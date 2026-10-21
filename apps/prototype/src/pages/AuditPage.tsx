import { Card, Input, Select, Space, Table, Tag } from 'antd';
import { useState } from 'react';
import { useEngineState } from '../app/store.ts';
import { Mono, PageHeader, RoleTag, when } from '../components/common.tsx';
import { useI18n } from '../i18n/i18n.tsx';
import { DENY_REASON_LABELS } from '../i18n/vocab.ts';

export function AuditPage() {
  const state = useEngineState();
  const { L, B } = useI18n();
  const [outcome, setOutcome] = useState<string | undefined>();
  const [text, setText] = useState('');
  const rows = [...state.audit]
    .reverse()
    .filter((e) => !outcome || e.outcome === outcome)
    .filter((e) => !text || `${e.username} ${e.action} ${e.targetId} ${e.workspaceId}`.toLowerCase().includes(text.toLowerCase()));
  return (
    <div className="kz-page">
      <PageHeader
        title={L('审计日志', 'Audit log')}
        subtitle={L('每次授权决定都会记录：允许时记录生效的那一条授权；拒绝时记录原因。', 'Every authorization decision is recorded: the grant that allowed it, or why it was denied.')}
        extra={
          <Space>
            <Select allowClear placeholder={L('结果', 'Outcome')} style={{ width: 140 }} value={outcome} onChange={setOutcome} options={[{ value: 'ALLOWED', label: L('允许', 'Allowed') }, { value: 'DENIED', label: L('拒绝', 'Denied') }]} />
            <Input.Search allowClear placeholder={L('账号 / 操作 / 对象', 'Account / action / target')} onSearch={setText} style={{ width: 260 }} />
          </Space>
        }
      />
      <Card>
        <Table
          rowKey="id"
          dataSource={rows}
          size="small"
          pagination={{ pageSize: 30 }}
          columns={[
            { title: L('时间', 'Time'), render: (_, e) => when(e.at) },
            { title: L('账号', 'Account'), render: (_, e) => state.accounts[e.username ?? '']?.displayName ?? e.username },
            { title: L('角色', 'Role'), render: (_, e) => (e.role ? <RoleTag role={e.role} /> : '—') },
            { title: L('操作', 'Action'), render: (_, e) => <Mono>{e.action}</Mono> },
            { title: L('对象', 'Target'), render: (_, e) => <Mono>{[e.targetType, e.targetId].filter(Boolean).join(':')}</Mono> },
            { title: L('工作区', 'Workspace'), render: (_, e) => e.workspaceId ?? '—' },
            {
              title: L('结果', 'Outcome'),
              render: (_, e) =>
                e.outcome === 'ALLOWED' ? <Tag color="green">{L('允许', 'Allowed')}</Tag> : <Tag color="red">{L('拒绝', 'Denied')}：{B(DENY_REASON_LABELS[e.reason ?? ''], e.reason ?? '')}</Tag>,
            },
          ]}
        />
      </Card>
    </div>
  );
}
