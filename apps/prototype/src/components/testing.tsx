// Dispatch and test building blocks shared by Feature validation and integration candidates.

import { Button, Checkbox, Form, Input, Modal, Radio, Space, Table, Tag, Typography } from 'antd';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { navigate } from '../app/router.ts';
import { useEngineState } from '../app/store.ts';
import { membersOf } from '../engine/fleet.ts';
import type { Deployment, VehicleGroup } from '../engine/types.ts';
import type { TargetStatus } from '../engine/validation.ts';
import { useI18n } from '../i18n/i18n.tsx';
import { DEPLOYMENT_STATUS_LABELS, RESOURCE_TYPE_LABELS, TARGET_STATUS_COLORS, TARGET_STATUS_LABELS } from '../i18n/vocab.ts';
import { EnvTag, Hint, LabelTag, Mono, when } from './common.tsx';

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
          render: (_, t) => (t.applied ? <Tag color="success">{L('已生效', 'Applied')}</Tag> : <Tag color="processing">{L('未确认生效', 'Not confirmed')}</Tag>),
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

/** Dispatches with their frozen member targets. */
export function DeploymentsTable({ deployments, canCancel, onCancel }: { deployments: Deployment[]; canCancel: (d: Deployment) => boolean; onCancel: (d: Deployment) => void }) {
  const state = useEngineState();
  const { L, B } = useI18n();
  return (
    <Table
      rowKey="id"
      pagination={false}
      dataSource={deployments}
      locale={{ emptyText: L('没有下发', 'No dispatches') }}
      expandable={{
        defaultExpandAllRows: true,
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
              { title: L('状态', 'Status'), render: (_, t) => <Tag color={TARGET_STATUS_COLORS[t.status]}>{B(TARGET_STATUS_LABELS[t.status])}</Tag> },
              { title: L('错误', 'Error'), render: (_, t) => t.error ?? '—' },
              { title: L('更新', 'Updated'), render: (_, t) => when(t.updatedAt) },
            ]}
          />
        ),
      }}
      columns={[
        { title: L('下发', 'Dispatch'), render: (_, d) => <Mono>{d.id}</Mono> },
        { title: L('配置', 'Configuration'), render: (_, d) => <Mono>{state.resolvedConfigs[d.resolvedConfigId]?.label}</Mono> },
        { title: L('环境', 'Env'), render: (_, d) => <EnvTag env={d.env} /> },
        { title: L('状态', 'Status'), render: (_, d) => <LabelTag map={DEPLOYMENT_STATUS_LABELS} value={d.status} /> },
        { title: L('下发人', 'By'), render: (_, d) => `${state.accounts[d.dispatchedBy]?.displayName} · ${when(d.createdAt)}` },
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
  emptyText,
  request = false,
  onClose,
  onDispatch,
}: {
  open: boolean;
  groups: VehicleGroup[];
  /** Vehicles that route through no group and may be chosen one by one; `blocked` says why one cannot. */
  vehicles?: { id: string; label: string; blocked?: string }[];
  emptyText: string;
  /** Ask for an approved team test instead of dispatching. */
  request?: boolean;
  onClose: () => void;
  onDispatch: (vehicleGroupIds: string[], goal: string, resourceIds: string[]) => boolean;
}) {
  const state = useEngineState();
  const { L } = useI18n();
  const [chosen, setChosen] = useState<string[]>([]);
  const [direct, setDirect] = useState<string[]>([]);
  const [goal, setGoal] = useState('');
  useEffect(() => {
    if (open) {
      setChosen([]);
      setDirect([]);
      setGoal('');
    }
  }, [open]);
  return (
    <Modal
      open={open}
      title={request ? L('申请团队测试', 'Request a team test') : groups.length === 0 && vehicles.length > 0 ? L('下发到车辆', 'Dispatch to vehicles') : L('按车辆组下发', 'Dispatch to vehicle groups')}
      okText={request ? L('提交申请', 'Submit request') : L('下发', 'Dispatch')}
      onCancel={onClose}
      onOk={() => onDispatch(chosen, goal, direct) && onClose()}
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
