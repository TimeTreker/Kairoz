import { Alert, Button, Card, Checkbox, Form, Input, Modal, Radio, Space, Table, Tag, Typography } from 'antd';
import { useState } from 'react';
import { useCan, useRun } from '../../app/hooks.ts';
import { navigate } from '../../app/router.ts';
import { useEngineState } from '../../app/store.ts';
import { EnvTag, Hint, LabelTag, Mono, when } from '../../components/common.tsx';
import { displayName } from '../../engine/config.ts';
import { membersOf, vehicleGroupsOf } from '../../engine/fleet.ts';
import type { Feature } from '../../engine/types.ts';
import { cancelDeployment, deploymentsOf, dispatchFeature, featureTestStatus, recordFeatureTest, verifyBlockers, verifyFeature } from '../../engine/validation.ts';
import { useI18n } from '../../i18n/i18n.tsx';
import { DEPLOYMENT_STATUS_LABELS, RESOURCE_TYPE_LABELS, TARGET_STATUS_COLORS, TARGET_STATUS_LABELS } from '../../i18n/vocab.ts';

export function ValidationTab({ feature }: { feature: Feature }) {
  const state = useEngineState();
  const { L, B } = useI18n();
  const can = useCan();
  const run = useRun();
  const [dispatching, setDispatching] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]);
  const [testing, setTesting] = useState<string | null>(null);
  const [form] = Form.useForm();
  const group = state.groups[feature.groupId]!;
  const target = (env: 'development' | 'testing') => ({ workspaceId: feature.workspaceId, groupId: group.id, scope: group.domain, env });

  const dispatchable = ['DCL_READY', 'TESTING', 'VERIFIED'].includes(feature.stage);
  const vehicleGroups = vehicleGroupsOf(state, feature.workspaceId).filter((g) => g.status === 'ACTIVE' && g.groupId === feature.groupId && g.purpose !== 'PRODUCTION');
  const canDispatch = dispatchable && vehicleGroups.some((g) => can('feature.dispatch', target(g.env as 'development')));
  const status = featureTestStatus(state, feature);
  const blockers = verifyBlockers(state, feature);
  const canVerify = feature.stage === 'TESTING' && can('feature.verify', { workspaceId: feature.workspaceId, groupId: group.id });
  const deployments = deploymentsOf(state, feature.id);

  return (
    <Space orientation="vertical" size={16} style={{ width: '100%' }}>
      <Card
        title={L('验证目标（当前提交）', 'Test targets (head commit)')}
        extra={
          <Space>
            {canDispatch && (
              <Button type="primary" onClick={() => (setChosen([]), setDispatching(true))}>
                {L('按车辆组下发', 'Dispatch to vehicle groups')}
              </Button>
            )}
            {canVerify && (
              <Button disabled={blockers.length > 0} onClick={() => run((c) => verifyFeature(c, feature.id), L('已确认 Verified，可交给配置集成', 'Verified; ready for integration'))}>
                {L('确认 Verified', 'Confirm Verified')}
              </Button>
            )}
          </Space>
        }
      >
        <Hint>
          {L(
            '测试固定在当前提交：先仿真再实车；车辆确认应用（回执成功）后才能登记结果。新提交需要重新下发和验证，旧结果不能验证新内容。',
            'Tests pin to the head commit: simulation first, then physical; results are recorded only after the vehicle confirms applying it. A new commit needs a new dispatch; old results never verify new content.',
          )}
        </Hint>
        {feature.headCommitId && <Typography.Paragraph><Mono>{displayName(state, feature.headCommitId)}</Mono></Typography.Paragraph>}
        {!dispatchable && <Alert type="info" showIcon message={L('Feature 达到 DCL Ready 后才能下发。', 'Dispatch becomes available once the Feature is DCL Ready.')} />}
        {feature.stage === 'TESTING' && blockers.length > 0 && (
          <Alert type="warning" showIcon style={{ marginBottom: 12 }} message={L('尚不能确认 Verified', 'Not verifiable yet')} description={blockers.join('；')} />
        )}
        {feature.stage === 'VERIFIED' && <Alert type="success" showIcon style={{ marginBottom: 12 }} message={L('当前提交已验证，可由配置集成收集。', 'The head commit is verified and can be collected by integration.')} />}
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
            {
              title: '',
              render: (_, t) =>
                feature.stage === 'TESTING' &&
                t.applied &&
                can('feature.recordTest', target(state.resources[t.resourceId]!.env as 'development')) && (
                  <Button size="small" onClick={() => (form.resetFields(), setTesting(t.resourceId))}>
                    {L('登记结果', 'Record result')}
                  </Button>
                ),
            },
          ]}
        />
      </Card>

      <Card title={L('下发记录', 'Dispatches')}>
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
                  { title: L('车辆组', 'Group'), render: (_, t) => state.vehicleGroups[t.vehicleGroupId ?? '']?.name },
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
                  {d.status === 'PENDING' && can('feature.dispatch', target(d.env as 'development')) && (
                    <Button type="link" size="small" danger onClick={() => run((c) => cancelDeployment(c, d.id, L('手动取消', 'Cancelled manually')), L('已取消', 'Cancelled'))}>
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
      </Card>

      <Modal
        open={dispatching}
        title={L('按车辆组下发', 'Dispatch to vehicle groups')}
        okText={L('下发', 'Dispatch')}
        onCancel={() => setDispatching(false)}
        onOk={() => {
          if (run((c) => dispatchFeature(c, feature.id, { commitId: feature.headCommitId!, vehicleGroupIds: chosen }), L('已下发，等待车辆回执', 'Dispatched; waiting for vehicle receipts')) !== undefined) setDispatching(false);
        }}
      >
        <Hint>{L('平台一次性校验全部成员的授权、环境、车型与占用；任一失败则整体拒绝。成功后冻结成员快照。', 'Every member’s authorization, environment, model and occupancy is checked at once; any failure rejects the whole dispatch. The member list is then frozen.')}</Hint>
        <Checkbox.Group value={chosen} onChange={(v) => setChosen(v as string[])} style={{ width: '100%' }}>
          <Space orientation="vertical">
            {vehicleGroups.map((g) => (
              <Checkbox key={g.id} value={g.id}>
                {g.name} · {membersOf(state, g.id).join(', ') || L('无车辆', 'no vehicles')} <EnvTag env={g.env} />
              </Checkbox>
            ))}
          </Space>
        </Checkbox.Group>
        {vehicleGroups.length === 0 && <Typography.Text type="secondary">{L('本工作区没有服务该分组的车辆组；请联系工作区管理员。', 'No vehicle group serves this group here; ask the workspace admin.')}</Typography.Text>}
      </Modal>

      <Modal
        open={testing !== null}
        title={`${L('登记测试结果', 'Record a test result')} · ${testing}`}
        onCancel={() => setTesting(null)}
        onOk={() =>
          form.validateFields().then((v) => {
            const ok = run(
              (c) => recordFeatureTest(c, feature.id, { commitId: feature.headCommitId!, resourceId: testing!, result: v.result, summary: v.summary, evidenceUri: v.evidenceUri }),
              L('已登记', 'Recorded'),
            );
            if (ok !== undefined) setTesting(null);
          })
        }
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
    </Space>
  );
}
