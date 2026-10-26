// Collection budgets (资源预算) and emergency collection pauses (紧急停采): the budget form, a
// vehicle's hourly usage, the resource-protection check of a merge, and the pause controls.

import { Button, Form, Input, InputNumber, Modal, Space, Table, Tag, Tooltip, Typography } from 'antd';
import { useState } from 'react';
import { useCan, useRun } from '../app/hooks.ts';
import { useEngineState } from '../app/store.ts';
import { BUDGET_FIELDS } from '../domain/budget.ts';
import type { Budget } from '../domain/budget.ts';
import { budgetOf, resourceCheck, usageOf } from '../engine/budget.ts';
import { holdOf, pauseCollection, resumeCollection } from '../engine/collection-hold.ts';
import { simulationWorkspace } from '../engine/fleet.ts';
import type { MergePlan } from '../engine/types.ts';
import { useI18n } from '../i18n/i18n.tsx';
import { BUDGET_DIMENSION_LABELS, BUDGET_SOURCE_LABELS, HOLD_STATE_COLORS, HOLD_STATE_LABELS, POLICY_BUDGET_COLORS, POLICY_BUDGET_LABELS } from '../i18n/vocab.ts';
import { Hint, LabelTag, Mono, when } from './common.tsx';

/** Field labels and units of a budget, in form order. */
export function useBudgetFields() {
  const { L } = useI18n();
  return {
    cpuSecondsPerHour: { label: L('CPU（秒 / 小时）', 'CPU (s per hour)'), unit: 's' },
    memoryMb: { label: L('车端缓存（MB）', 'Vehicle buffer (MB)'), unit: 'MB' },
    ioMbPerHour: { label: L('存储写入（MB / 小时）', 'Storage writes (MB per hour)'), unit: 'MB' },
    networkMbPerHour: { label: L('上传（MB / 小时）', 'Upload (MB per hour)'), unit: 'MB' },
    triggersPerPolicyPerHour: { label: L('单策略触发上限（次 / 小时）', 'Triggers per policy (per hour)'), unit: '' },
  } satisfies Record<(typeof BUDGET_FIELDS)[number], { label: string; unit: string }>;
}

/** One line of a budget: CPU 300 s · buffer 512 MB · … */
export function BudgetLine({ budget }: { budget: Budget }) {
  const { L } = useI18n();
  return (
    <Typography.Text>
      {L(
        `CPU ${budget.cpuSecondsPerHour} 秒/时 · 缓存 ${budget.memoryMb} MB · 存储 ${budget.ioMbPerHour} MB/时 · 上传 ${budget.networkMbPerHour} MB/时 · 每策略 ${budget.triggersPerPolicyPerHour} 次/时`,
        `CPU ${budget.cpuSecondsPerHour} s/h · buffer ${budget.memoryMb} MB · storage ${budget.ioMbPerHour} MB/h · upload ${budget.networkMbPerHour} MB/h · ${budget.triggersPerPolicyPerHour} triggers per policy/h`,
      )}
    </Typography.Text>
  );
}

/** Edits a budget; `onSave` runs the engine operation and says whether it succeeded. */
export function BudgetModal({ title, initial, open, onClose, onSave }: { title: string; initial: Budget; open: boolean; onClose: () => void; onSave: (b: Budget) => boolean }) {
  const { L } = useI18n();
  const fields = useBudgetFields();
  const [form] = Form.useForm<Budget>();
  return (
    <Modal
      open={open}
      destroyOnHidden
      title={title}
      onCancel={onClose}
      onOk={() => form.validateFields().then((v) => onSave(v) && onClose())}
    >
      <Hint>{L('车端代理按滚动的一小时核算。高优先级采集超预算仍然采集；其他采集超出 CPU、存储或缓存时不保留，超出上传时排队到预算允许。', 'The vehicle agent counts a rolling hour. HIGH-priority captures are collected even over budget; others are dropped over CPU, storage or the buffer, and wait over upload until the budget allows.')}</Hint>
      <Form form={form} layout="vertical" initialValues={initial} preserve={false}>
        {BUDGET_FIELDS.map((k) => (
          <Form.Item key={k} name={k} label={fields[k].label} rules={[{ required: true }]}>
            <InputNumber min={k === 'triggersPerPolicyPerHour' ? 1 : 0.1} precision={k === 'triggersPerPolicyPerHour' ? 0 : 1} style={{ width: 200 }} />
          </Form.Item>
        ))}
      </Form>
    </Modal>
  );
}

/** A vehicle's collection in the rolling hour against its budget. */
export function UsageMeter({ resourceId }: { resourceId: string }) {
  const state = useEngineState();
  const { L, B } = useI18n();
  const { budget, source } = budgetOf(state, resourceId);
  const u = usageOf(state, resourceId);
  const part = (label: string, used: number, max: number, unit: string) => (
    <Tag color={used > max ? 'red' : used > max * 0.8 ? 'gold' : undefined} style={{ marginInlineEnd: 4 }}>{`${label} ${used}/${max}${unit}`}</Tag>
  );
  return (
    <Space size={0} wrap>
      <Tooltip title={B(BUDGET_SOURCE_LABELS[source]!)}>
        <span>
          {part('CPU', u.cpuSec, budget.cpuSecondsPerHour, ' s')}
          {part(L('存储', 'Storage'), u.ioMb, budget.ioMbPerHour, ' MB')}
          {part(L('上传', 'Upload'), u.networkMb, budget.networkMbPerHour, ' MB')}
          {part(L('缓存', 'Buffer'), u.bufferMb, budget.memoryMb, ' MB')}
        </span>
      </Tooltip>
      {u.held > 0 && <Tag color="gold">{L(`排队 ${u.held}`, `${u.held} waiting`)}</Tag>}
      {u.dropped > 0 && <Tag color="volcano">{L(`未保留 ${u.dropped}`, `${u.dropped} dropped`)}</Tag>}
      {u.suppressed > 0 && <Tag>{L(`抑制 ${u.suppressed}`, `${u.suppressed} suppressed`)}</Tag>}
    </Space>
  );
}

/** Resource protection (资源保护) of a merge preview: each policy's capture against the model budget. */
export function ResourceCheck({ plan }: { plan: MergePlan }) {
  const state = useEngineState();
  const { L, B } = useI18n();
  const check = resourceCheck(state, plan);
  if (check.policies.length === 0) return null;
  return (
    <>
      <Typography.Title level={5}>{L('资源保护', 'Resource protection')}</Typography.Title>
      <Hint>
        {L('每条策略一次采集的成本（按文件类型的名义速率乘以采集窗口估算）对照车型预算：', 'Each policy’s cost per capture (nominal rate of its file types over the window) against the model budget: ')}
        <BudgetLine budget={check.budget} /> · {B(BUDGET_SOURCE_LABELS[check.source]!)}
        {L('。真实 CPU 与内存需要台架验证。', '. Real CPU and memory figures need a bench.')}
      </Hint>
      <Table
        rowKey={(p) => `${p.groupId}/${p.policyId}`}
        size="small"
        pagination={false}
        style={{ marginBottom: 16 }}
        dataSource={check.policies}
        columns={[
          { title: L('策略', 'Policy'), render: (_, p) => <Mono>{p.policyId}</Mono> },
          { title: L('优先级', 'Priority'), dataIndex: 'priority' },
          { title: L('窗口', 'Window'), render: (_, p) => `${p.windowSeconds} s` },
          { title: L('单次成本', 'Per capture'), render: (_, p) => `${p.cost.memoryMb} MB · CPU ${p.cost.cpuSec} s` },
          {
            title: L('结论', 'Result'),
            render: (_, p) => (
              <Space size={4} wrap>
                <LabelTag map={POLICY_BUDGET_LABELS} value={p.status} color={POLICY_BUDGET_COLORS[p.status]} />
                {p.dimensions.map((d) => (
                  <Tag key={d}>{B(BUDGET_DIMENSION_LABELS[d]!)}</Tag>
                ))}
              </Space>
            ),
          },
        ]}
      />
    </>
  );
}

/** The vehicle's collection pause, when there is one. */
export function HoldTag({ resourceId }: { resourceId: string }) {
  const state = useEngineState();
  const h = holdOf(state, resourceId);
  if (!h || h.state === 'ACTIVE') return null;
  const last = h.history.at(-1)!;
  return (
    <Tooltip title={`${state.accounts[last.by]?.displayName ?? last.by} · ${when(last.at)} · ${last.reason}`}>
      <span>
        <LabelTag map={HOLD_STATE_LABELS} value={h.state} color={HOLD_STATE_COLORS[h.state]} />
      </span>
    </Tooltip>
  );
}

/** Pause or resume a vehicle's collection, for DCL engineering or release in the vehicle's environment. */
export function PauseButton({ resourceId }: { resourceId: string }) {
  const state = useEngineState();
  const { L } = useI18n();
  const can = useCan();
  const run = useRun();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const r = state.resources[resourceId];
  if (!r || !can('collection.pause', { workspaceId: simulationWorkspace(state, r) ?? undefined, env: r.env })) return null;
  const h = holdOf(state, resourceId);
  const paused = !!h && h.state !== 'ACTIVE';
  if (h?.state === 'PAUSING' || h?.state === 'RESUMING') return null;
  return (
    <>
      <Button type="link" size="small" danger={!paused} onClick={() => (setReason(''), setOpen(true))}>
        {paused ? L('恢复采集', 'Resume collection') : L('暂停采集', 'Pause collection')}
      </Button>
      <Modal
        open={open}
        title={`${paused ? L('恢复采集', 'Resume collection') : L('紧急暂停采集', 'Pause collection now')} · ${resourceId}`}
        okButtonProps={{ disabled: !reason.trim(), danger: !paused }}
        okText={paused ? L('恢复', 'Resume') : L('暂停', 'Pause')}
        onCancel={() => setOpen(false)}
        onOk={() => {
          const ok = run((c) => (paused ? resumeCollection(c, resourceId, { reason }) : pauseCollection(c, resourceId, { reason })), paused ? L('已请求恢复，等待车辆确认', 'Resume asked; waiting for the vehicle') : L('已请求暂停，车辆立即拒绝新的触发', 'Pause asked; the vehicle refuses new triggers at once'));
          if (ok !== undefined) setOpen(false);
        }}
      >
        <Hint>
          {paused
            ? L('车辆确认后恢复采集；暂停期间丢弃的采集不会补回。', 'Collection resumes once the vehicle confirms; captures dropped while paused do not come back.')
            : L('暂停立即生效：车辆不再接受新的触发；车辆确认后，仍在车上的采集被丢弃，已上传的保留。不改变策略集，长期停用某条策略请用“紧急停用”。', 'The pause takes effect at once: the vehicle accepts no new triggers; once it confirms, captures still on it are dropped, uploaded ones stay. No policy set changes; to stop a policy for good use an emergency stop.')}
        </Hint>
        <Input.TextArea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={L('原因', 'Reason')} />
      </Modal>
    </>
  );
}
