// 变更环境: vehicle resources move a vehicle between development, testing and production once
// everything in flight is finished. The dialog shows what still stands in the way, live.

import { Alert, Input, Modal, Select, Space, Table, Typography } from 'antd';
import { useState } from 'react';
import { useCan, useRun } from '../app/hooks.ts';
import { useEngineState } from '../app/store.ts';
import { ENVS } from '../domain/vocabulary.ts';
import type { Env } from '../domain/vocabulary.ts';
import { environmentHistory, environmentMoveProblems, setResourceEnvironment } from '../engine/environment.ts';
import { useI18n } from '../i18n/i18n.tsx';
import { issueLabel } from '../i18n/issues.ts';
import { ENV_LABELS } from '../i18n/vocab.ts';
import { EnvTag, Hint, when } from './common.tsx';

export function EnvironmentModal({ resourceId, onClose }: { resourceId: string | null; onClose: () => void }) {
  const state = useEngineState();
  const can = useCan();
  const run = useRun();
  const { L, B } = useI18n();
  const [to, setTo] = useState<Env | undefined>();
  const [reason, setReason] = useState('');
  const r = resourceId ? state.resources[resourceId] : undefined;
  if (!r) return <Modal open={false} />;
  const close = () => (setTo(undefined), setReason(''), onClose());
  const problems = to ? environmentMoveProblems(state, r, to) : [];
  const allowed = (e: Env) => can('resource.manage', { scope: r.pool, env: e });
  const history = environmentHistory(state, r.id);
  return (
    <Modal
      open
      width={680}
      title={`${L('变更环境', 'Change environment')} · ${r.id}`}
      okText={L('变更', 'Move')}
      okButtonProps={{ disabled: !to || problems.length > 0 || !reason.trim() }}
      onCancel={close}
      onOk={() => {
        if (to && run((c) => setResourceEnvironment(c, r.id, { env: to, reason }), L('已变更环境', 'Environment changed')) !== undefined) close();
      }}
    >
      <Hint>
        {L(
          '环境是车辆的使用边界，不随软件版本、车辆组或业务组变化。变更前须结束车辆组、下发与 OTA、预约、借用、运行中的仿真和处理中的事件；转入量产时车上必须运行适用于其软件的正式策略集。整车软件与已生效配置都不变。',
          'The environment is where a vehicle may be used; it never follows software, groups or business groups. Before a move, vehicle groups, dispatches and rollouts, reservations, loans, running simulations and events in processing must end; to enter production the vehicle must run a formal policy set for its software. Its software and applied configuration stay.',
        )}
      </Hint>
      <Space orientation="vertical" size={12} style={{ width: '100%' }}>
        <Space>
          <Typography.Text>{L('当前环境', 'Now')}</Typography.Text>
          <EnvTag env={r.env} />
          <Typography.Text>→</Typography.Text>
          <Select
            style={{ width: 180 }}
            placeholder={L('目标环境', 'Target environment')}
            value={to}
            onChange={setTo}
            options={ENVS.filter((e) => e !== r.env).map((e) => ({ value: e, label: B(ENV_LABELS[e]), disabled: !allowed(e) || !allowed(r.env) }))}
          />
        </Space>
        {to && (problems.length ? (
          <Alert type="warning" showIcon title={L('现在还不能变更', 'Not movable yet')} description={problems.map((p) => <div key={p}>{B(issueLabel(p), p)}</div>)} />
        ) : (
          <Alert type="success" showIcon title={L('可以变更', 'Ready to move')} />
        ))}
        <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={L('原因，例如：转入整车联调', 'Reason, e.g. joins whole-vehicle integration')} />
        {history.length > 0 && (
          <Table
            rowKey="id"
            size="small"
            pagination={false}
            dataSource={history}
            columns={[
              { title: L('变更', 'Move'), render: (_, x) => <Space size={4}><EnvTag env={x.from} />→<EnvTag env={x.to} /></Space> },
              { title: L('原因', 'Reason'), dataIndex: 'reason' },
              { title: L('执行人', 'By'), render: (_, x) => `${state.accounts[x.by]?.displayName ?? x.by} · ${when(x.at)}` },
            ]}
          />
        )}
      </Space>
    </Modal>
  );
}
