// Dispatch and test building blocks shared by Feature validation and integration candidates.

import { Button, Checkbox, Form, Input, Modal, Radio, Select, Space, Table, Tag, Tooltip, Typography } from 'antd';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { navigate } from '../app/router.ts';
import { useEngineState } from '../app/store.ts';
import { deliveryState } from '../engine/delivery.ts';
import { membersOf } from '../engine/fleet.ts';
import type { Deployment, DeploymentTarget, VehicleGroup } from '../engine/types.ts';
import type { TargetStatus } from '../engine/validation.ts';
import { useI18n } from '../i18n/i18n.tsx';
import { issueLabel } from '../i18n/issues.ts';
import { DELIVERY_STATE_COLORS, DELIVERY_STATE_LABELS, DEPLOYMENT_STATUS_LABELS, DEPLOYMENT_TRIGGER_LABELS, RESOURCE_TYPE_LABELS } from '../i18n/vocab.ts';
import { EnvTag, Hint, LabelTag, Mono, configName, when } from './common.tsx';

/** Test targets of one version with their apply state and latest result. */
export function TargetsTable({ status, action }: { status: TargetStatus[]; action: (t: TargetStatus) => ReactNode }) {
  const state = useEngineState();
  const { L, B } = useI18n();
  return (
    <Table
      rowKey="resourceId"
      pagination={false}
      dataSource={status}
      locale={{ emptyText: L('尚未下发', 'Not dispatched yet') }}
      columns={[
        { title: L('车辆', 'Vehicle'), render: (_, t) => <Mono>{t.resourceId}</Mono> },
        { title: L('类型', 'Type'), render: (_, t) => B(RESOURCE_TYPE_LABELS[state.resources[t.resourceId]!.type]) },
        { title: L('环境', 'Env'), render: (_, t) => <EnvTag env={state.resources[t.resourceId]!.env} /> },
        {
          title: L('配置', 'Configuration'),
          render: (_, t) => {
            if (t.applied) return <Tag color="success">{L('已生效', 'Applied')}</Tag>;
            // Not applied yet: show where its latest dispatch is (not pushed, pushed, failed).
            const target = state.deployments[t.deploymentId]?.targets.find((x) => x.resourceId === t.resourceId);
            return target ? <DeliveryTag target={target} /> : <Tag color="processing">{L('未确认生效', 'Not confirmed')}</Tag>;
          },
        },
        {
          title: L('最新结果', 'Latest result'),
          render: (_, t) =>
            t.latest ? (
              <Space orientation="vertical" size={0}>
                <Tag color={t.latest.result === 'PASS' ? 'green' : 'red'}>{t.latest.result}</Tag>
                <Typography.Text type="secondary">
                  {t.latest.summary} · {state.accounts[t.latest.tester]?.displayName} · {when(t.latest.createdAt)}
                </Typography.Text>
                {t.latest.integrationVersion !== state.resources[t.resourceId]!.integrationVersion && (
                  // Kept because the base is the same and every policy still runs on the new software.
                  <Typography.Text type="secondary">
                    {L(`在 ${t.latest.integrationVersion ?? '—'} 上测试，车辆现为 ${state.resources[t.resourceId]!.integrationVersion ?? '—'}`, `Tested on ${t.latest.integrationVersion ?? '—'}; the vehicle now runs ${state.resources[t.resourceId]!.integrationVersion ?? '—'}`)}
                  </Typography.Text>
                )}
              </Space>
            ) : t.stale ? (
              // A result from earlier software is history: the vehicle runs another image or version now.
              <Space orientation="vertical" size={0}>
                <Tag color="gold">
                  {state.resources[t.resourceId]!.type === 'SIMULATION' ? L('镜像已变化，需重新测试', 'Image changed; test again') : L('整车软件已变化，需重新测试', 'Software changed; test again')}
                </Tag>
                <Typography.Text type="secondary">
                  {L('之前', 'Earlier')}: {t.stale.result} · {t.stale.imageId ?? t.stale.integrationVersion ?? '—'} · {when(t.stale.createdAt)}
                </Typography.Text>
              </Space>
            ) : (
              '—'
            ),
        },
        { title: '', render: (_, t) => action(t) },
      ]}
    />
  );
}

/** A target's delivery: dispatched (cloud configuration set), pushed to the vehicle, or answered. */
export function DeliveryTag({ target }: { target: Pick<DeploymentTarget, 'status' | 'pushedAt'> }) {
  const { L, B } = useI18n();
  const st = deliveryState(target);
  const tip =
    st === 'NOT_PUSHED'
      ? L('云端配置已设置；车辆上线（上报）时才推送。', 'The cloud configuration is set; it is pushed when the vehicle comes on and reports.')
      : st === 'PUSHED'
        ? L('已推送到车辆，等待车辆回执。', 'Pushed to the vehicle; waiting for its receipt.')
        : undefined;
  return (
    <Tooltip title={tip}>
      <Tag color={DELIVERY_STATE_COLORS[st]}>{B(DELIVERY_STATE_LABELS[st])}</Tag>
    </Tooltip>
  );
}

/** Dispatches with their frozen member targets. */
export function DeploymentsTable({ deployments, canCancel, onCancel }: { deployments: Deployment[]; canCancel: (d: Deployment) => boolean; onCancel: (d: Deployment) => void }) {
  const state = useEngineState();
  const { L, B } = useI18n();
  // Every dispatch shows its vehicles, including ones added while the page is open, unless collapsed.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  return (
    <Table
      rowKey="id"
      pagination={false}
      dataSource={deployments}
      locale={{ emptyText: L('没有下发', 'No dispatches') }}
      expandable={{
        expandedRowKeys: deployments.filter((d) => !collapsed.has(d.id)).map((d) => d.id),
        onExpand: (open, d) =>
          setCollapsed((c) => {
            const next = new Set(c);
            if (open) next.delete(d.id);
            else next.add(d.id);
            return next;
          }),
        expandedRowRender: (d) => (
          <Table
            rowKey="resourceId"
            size="small"
            pagination={false}
            dataSource={d.targets}
            columns={[
              { title: L('车辆', 'Vehicle'), render: (_, t) => <Mono>{t.resourceId}</Mono> },
              { title: L('车辆组', 'Group'), render: (_, t) => (t.vehicleGroupId ? state.vehicleGroups[t.vehicleGroupId]?.name : <Tag>{L('直投', 'direct')}</Tag>) },
              { title: L('尝试', 'Attempt'), dataIndex: 'attempt' },
              { title: L('状态', 'Status'), render: (_, t) => <DeliveryTag target={t} /> },
              { title: L('错误', 'Error'), render: (_, t) => (t.error ? B(issueLabel(t.error), t.error) : '—') },
              { title: L('更新', 'Updated'), render: (_, t) => when(t.updatedAt) },
            ]}
          />
        ),
      }}
      columns={[
        { title: L('下发', 'Dispatch'), render: (_, d) => <Mono>{d.id}</Mono> },
        { title: L('配置', 'Configuration'), render: (_, d) => <Mono>{B(configName(state, d.resolvedConfigId))}</Mono> },
        { title: L('环境', 'Env'), render: (_, d) => <EnvTag env={d.env} /> },
        { title: L('状态', 'Status'), render: (_, d) => <LabelTag map={DEPLOYMENT_STATUS_LABELS} value={d.status} /> },
        {
          title: L('下发人', 'By'),
          render: (_, d) => (
            <Space size={4} wrap>
              {d.trigger === 'GROUP_FOLLOW' && (
                <Tooltip title={L('车辆加入车辆组或更新整车软件后上报，云端推送了已下发给车辆组的配置。', 'The vehicle joined the group or had its software updated; on its report the cloud pushed what was dispatched to the group.')}>
                  <Tag color="cyan">{B(DEPLOYMENT_TRIGGER_LABELS.GROUP_FOLLOW)}</Tag>
                </Tooltip>
              )}
              <span>{`${state.accounts[d.dispatchedBy]?.displayName ?? d.dispatchedBy} · ${when(d.createdAt)}`}</span>
            </Space>
          ),
        },
        {
          title: '',
          render: (_, d) => (
            <Space size={0}>
              {d.status === 'PENDING' && canCancel(d) && (
                <Button type="link" size="small" danger onClick={() => onCancel(d)}>
                  {L('取消', 'Cancel')}
                </Button>
              )}
              {d.status === 'PENDING' && (
                <Button type="link" size="small" onClick={() => navigate('simulator')}>
                  {L('去车辆模拟器回执', 'Answer in simulator')}
                </Button>
              )}
            </Space>
          ),
        },
      ]}
    />
  );
}

/** Chooses vehicle groups to dispatch to. `onDispatch` returns whether it succeeded. */
export function DispatchModal({
  open,
  groups,
  vehicles = [],
  switchable = [],
  emptyText,
  request = false,
  onClose,
  onDispatch,
}: {
  open: boolean;
  groups: VehicleGroup[];
  /** Vehicles that route through no group and may be chosen one by one; `blocked` says why one cannot. */
  vehicles?: { id: string; label: string; blocked?: string }[];
  /** Base policies of other business groups that may be switched off for this dispatch. */
  switchable?: { policyId: string; group: string }[];
  emptyText: string;
  /** Ask for an approved team test instead of dispatching. */
  request?: boolean;
  onClose: () => void;
  onDispatch: (vehicleGroupIds: string[], goal: string, resourceIds: string[], disabledPolicies: string[]) => boolean;
}) {
  const state = useEngineState();
  const { L } = useI18n();
  const [chosen, setChosen] = useState<string[]>([]);
  const [direct, setDirect] = useState<string[]>([]);
  const [disabled, setDisabled] = useState<string[]>([]);
  const [goal, setGoal] = useState('');
  useEffect(() => {
    if (open) {
      setChosen([]);
      setDirect([]);
      setDisabled([]);
      setGoal('');
    }
  }, [open]);
  return (
    <Modal
      open={open}
      title={request ? L('申请团队测试', 'Request a team test') : groups.length === 0 && vehicles.length > 0 ? L('下发到车辆', 'Dispatch to vehicles') : L('按车辆组下发', 'Dispatch to vehicle groups')}
      okText={request ? L('提交申请', 'Submit request') : L('下发', 'Dispatch')}
      onCancel={onClose}
      onOk={() => onDispatch(chosen, goal, direct, disabled) && onClose()}
    >
      <Hint>
        {request
          ? L(
              '这些车辆组的下发需要工作区管理员批准。申请绑定当前固定提交与车辆清单；批准后由你执行一次。',
              'Dispatches to these groups need the workspace admin’s approval. The request binds the fixed commit and the vehicle list; once approved you execute it once.',
            )
          : L(
              '平台一次性校验全部成员的授权、环境、车型与占用；任一失败则整体拒绝。成功后冻结成员快照。',
              'Every member’s authorization, environment, model and occupancy is checked at once; any failure rejects the whole dispatch. The member list is then frozen.',
            )}
      </Hint>
      <Checkbox.Group value={chosen} onChange={(v) => setChosen(v as string[])} style={{ width: '100%' }}>
        <Space orientation="vertical">
          {groups.map((g) => (
            <Checkbox key={g.id} value={g.id}>
              {g.name} · {membersOf(state, g.id).join(', ') || L('无车辆', 'no vehicles')} <EnvTag env={g.env} />
            </Checkbox>
          ))}
        </Space>
      </Checkbox.Group>
      {vehicles.length > 0 && (
        <>
          <Typography.Paragraph strong style={{ marginTop: 12, marginBottom: 4 }}>
            {L('未归组的车辆（可直接选择）', 'Ungrouped vehicles (chosen directly)')}
          </Typography.Paragraph>
          <Checkbox.Group value={direct} onChange={(v) => setDirect(v as string[])}>
            <Space orientation="vertical">
              {vehicles.map((r) => (
                <Checkbox key={r.id} value={r.id} disabled={!!r.blocked}>
                  {r.label}
                  {r.blocked && (
                    <Typography.Text type="warning" style={{ marginLeft: 8 }}>
                      {r.blocked}
                    </Typography.Text>
                  )}
                </Checkbox>
              ))}
            </Space>
          </Checkbox.Group>
        </>
      )}
      {groups.length === 0 && vehicles.length === 0 && <Typography.Text type="secondary">{emptyText}</Typography.Text>}
      {switchable.length > 0 && (
        <>
          <Typography.Paragraph strong style={{ marginTop: 12, marginBottom: 4 }}>
            {L('关闭其他分组的策略（可选）', 'Switch off other groups’ policies (optional)')}
          </Typography.Paragraph>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 4 }}>
            {L(
              '每辆车运行它的基线（软件版本当前适用的策略集，或车辆组的显式基线）加本分组提交。可关闭基线中其他分组的策略以减少干扰；开关随本次发布记录，测试证据绑定实际运行的组合。',
              'Each vehicle runs its base (the set in effect for its software, or the group’s explicit base) plus this group’s commit. Other groups’ base policies can be switched off to reduce noise; the switches are recorded with this publish and test evidence binds to the combination actually run.',
            )}
          </Typography.Paragraph>
          <Select
            mode="multiple"
            style={{ width: '100%' }}
            value={disabled}
            onChange={setDisabled}
            placeholder={L('不关闭', 'Keep all on')}
            options={switchable.map((p) => ({ value: p.policyId, label: `${p.policyId} · ${p.group}` }))}
          />
        </>
      )}
      {request && <Input.TextArea style={{ marginTop: 12 }} rows={2} value={goal} onChange={(e) => setGoal(e.target.value)} placeholder={L('测试目标', 'What the test should show')} />}
    </Modal>
  );
}

export interface TestResultInput {
  result: 'PASS' | 'FAIL';
  summary: string;
  evidenceUri?: string;
}

/** Records one test result for a vehicle. `onRecord` returns whether it succeeded. */
export function RecordTestModal({ resourceId, onClose, onRecord }: { resourceId: string | null; onClose: () => void; onRecord: (input: TestResultInput) => boolean }) {
  const { L } = useI18n();
  const [form] = Form.useForm<TestResultInput>();
  useEffect(() => {
    if (resourceId) form.resetFields();
  }, [resourceId, form]);
  return (
    <Modal
      open={resourceId !== null}
      title={`${L('登记测试结果', 'Record a test result')} · ${resourceId}`}
      onCancel={onClose}
      onOk={() => form.validateFields().then((v) => onRecord(v) && onClose())}
    >
      <Form form={form} name="test-run" layout="vertical" initialValues={{ result: 'PASS' }}>
        <Form.Item name="result" label={L('结果', 'Result')}>
          <Radio.Group options={[{ value: 'PASS', label: 'PASS' }, { value: 'FAIL', label: 'FAIL' }]} />
        </Form.Item>
        <Form.Item name="summary" label={L('测试说明', 'What was tested')} rules={[{ required: true }]}>
          <Input.TextArea rows={2} />
        </Form.Item>
        <Form.Item name="evidenceUri" label={L('证据链接（可选）', 'Evidence link (optional)')}>
          <Input placeholder="https://…" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
