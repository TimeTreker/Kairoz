// The vehicle simulator: plays the vehicles and simulators. It is a prototype tool, clearly
// separate from the product's role pages, which never fabricate results themselves.

import { App, Alert, Button, Card, Checkbox, Select, Space, Switch, Table, Tag, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { useErrorText } from '../app/hooks.ts';
import { engine, useEngineState } from '../app/store.ts';
import { EnvTag, LabelTag, Mono, PageHeader, when } from '../components/common.tsx';
import type { Ctx } from '../engine/engine.ts';
import { advanceEvent, assessEvent, capturablePolicies, captureEvent, setFailParse } from '../engine/events.ts';
import type { Quality, TrainingUse } from '../engine/types.ts';
import { pendingForVehicles, sendReceipt, setAgent, tick } from '../engine/simulator.ts';
import { useI18n } from '../i18n/i18n.tsx';
import { EVENT_STATUS_COLORS, EVENT_STATUS_LABELS, QUALITY_LABELS, RESOURCE_TYPE_LABELS, TRAINING_USE_LABELS } from '../i18n/vocab.ts';

let autoTimer: ReturnType<typeof setInterval> | undefined;

export function SimulatorPage() {
  const state = useEngineState();
  const { L, B } = useI18n();
  const { message } = App.useApp();
  const errorText = useErrorText();
  const [auto, setAuto] = useState(autoTimer !== undefined);

  const system = <R,>(op: (c: Ctx) => R, ok?: string) => {
    try {
      const r = engine.run(null, op);
      if (ok) message.success(ok);
      return r;
    } catch (e) {
      message.error(errorText(e));
      return undefined;
    }
  };

  useEffect(() => {
    if (auto && !autoTimer) autoTimer = setInterval(() => engine.run(null, (c) => tick(c)), 2000);
    if (!auto && autoTimer) {
      clearInterval(autoTimer);
      autoTimer = undefined;
    }
  }, [auto]);

  const pending = pendingForVehicles(state);
  const vehicles = Object.values(state.resources).sort((a, b) => a.id.localeCompare(b.id));
  const running = vehicles.filter((r) => r.appliedConfigId);
  const [vehicle, setVehicle] = useState<string | undefined>(undefined);
  const [policy, setPolicy] = useState<string | undefined>(undefined);
  const [failParse, setFailParseNext] = useState(false);
  const policies = vehicle ? capturablePolicies(state, vehicle) : [];
  const events = Object.values(state.events)
    .sort((a, b) => b.seq - a.seq)
    .slice(0, 15);

  return (
    <div className="kz-page">
      <div className="kz-sim-banner" style={{ padding: '10px 14px', borderRadius: 8, marginBottom: 16 }}>
        <Typography.Text strong>{L('模拟区 · 仅原型', 'Simulation zone · prototype only')}</Typography.Text>
        <Typography.Text>
          {' '}
          {L('这里扮演车端 Agent 与仿真器，向平台发送回执。真实系统中回执由设备签名，平台验证签名。', 'This plays the on-vehicle agents and simulators, sending receipts to the platform. In the real system receipts are device-signed and verified.')}
        </Typography.Text>
      </div>
      <PageHeader
        title={L('车辆模拟器', 'Vehicle simulator')}
        extra={
          <Space>
            <Typography.Text>{L('自动运行（每 2 秒）', 'Run automatically (every 2 s)')}</Typography.Text>
            <Switch checked={auto} onChange={setAuto} />
            <Button onClick={() => system((c) => tick(c), L('已执行一步', 'Stepped'))}>{L('执行一步', 'Step once')}</Button>
          </Space>
        }
      />
      <Space orientation="vertical" size={16} style={{ width: '100%' }}>
        <Card title={`${L('等待车辆回执的配置', 'Configurations awaiting a vehicle receipt')} · ${pending.length}`}>
          {pending.length === 0 && <Alert type="info" showIcon title={L('没有等待回执的配置。在 Feature 的“下发与测试”中下发后会出现在这里。', 'Nothing is waiting. Dispatch from a Feature’s “Dispatch & tests” tab.')} />}
          {pending.length > 0 && (
            <Table
              rowKey={(p) => `${p.deployment.id}/${p.target.resourceId}`}
              pagination={false}
              dataSource={pending}
              columns={[
                { title: L('车辆', 'Vehicle'), render: (_, p) => <Mono>{p.target.resourceId}</Mono> },
                { title: L('配置', 'Configuration'), render: (_, p) => <Mono>{state.resolvedConfigs[p.deployment.resolvedConfigId]?.label}</Mono> },
                { title: L('下发', 'Dispatch'), render: (_, p) => <Mono>{p.deployment.id}</Mono> },
                { title: L('尝试', 'Attempt'), render: (_, p) => p.target.attempt },
                { title: L('下发时间', 'Since'), render: (_, p) => when(p.deployment.createdAt) },
                {
                  title: '',
                  render: (_, p) => {
                    const online = state.resources[p.target.resourceId]!.agent.online;
                    return (
                      <Space>
                        <Button size="small" type="primary" disabled={!online} onClick={() => system((c) => sendReceipt(c, p.deployment.id, p.target.resourceId, 'APPLIED'), L('车辆已回执：应用成功', 'Receipt sent: applied'))}>
                          {L('回执：应用成功', 'Receipt: applied')}
                        </Button>
                        <Button size="small" danger disabled={!online} onClick={() => system((c) => sendReceipt(c, p.deployment.id, p.target.resourceId, 'FAILED', 'simulated apply failure'), L('车辆已回执：失败', 'Receipt sent: failed'))}>
                          {L('回执：失败', 'Receipt: failed')}
                        </Button>
                        {!online && <Tag>{L('离线', 'offline')}</Tag>}
                      </Space>
                    );
                  },
                },
              ]}
            />
          )}
        </Card>
        <Card title={L('车端 Agent', 'On-vehicle agents')}>
          <Table
            rowKey="id"
            pagination={{ pageSize: 20, hideOnSinglePage: true }}
            dataSource={vehicles}
            columns={[
              { title: L('车辆', 'Vehicle'), render: (_, r) => <Mono>{r.id}</Mono> },
              { title: L('类型', 'Type'), render: (_, r) => B(RESOURCE_TYPE_LABELS[r.type]) },
              { title: L('环境', 'Env'), render: (_, r) => <EnvTag env={r.env} /> },
              { title: L('在线', 'Online'), render: (_, r) => <Switch size="small" checked={r.agent.online} onChange={(v) => system((c) => setAgent(c, r.id, { online: v }))} /> },
              { title: L('自动回执', 'Auto receipt'), render: (_, r) => <Switch size="small" checked={r.agent.autoAck} onChange={(v) => system((c) => setAgent(c, r.id, { autoAck: v }))} /> },
              { title: L('下一次应用失败', 'Fail next apply'), render: (_, r) => <Switch size="small" checked={r.agent.failNext} onChange={(v) => system((c) => setAgent(c, r.id, { failNext: v }))} /> },
              { title: L('已生效配置', 'Applied'), render: (_, r) => <Mono>{r.appliedConfigId ? state.resolvedConfigs[r.appliedConfigId]?.label : '—'}</Mono> },
            ]}
          />
        </Card>
        <Card title={L('采集事件：车端触发与云端处理', 'Collection events: vehicle triggers and cloud processing')}>
          <Typography.Paragraph type="secondary">
            {L(
              '车辆按已生效配置中的策略触发事件，只采集该策略的 capture 文件；之后车端上传、云端按固定的处理版本解析。质量检查与训练用途授权在这里扮演外部服务，新事件默认“未知 / 待确认”。',
              'A vehicle fires a policy of its applied configuration and captures only that policy’s files; then the edge uploads and the cloud parses with the pinned processing versions. Quality checks and training-use authorization are played here as external services; new events start as unknown / unconfirmed.',
            )}
          </Typography.Paragraph>
          <Space wrap style={{ marginBottom: 12 }}>
            <Select
              style={{ width: 220 }}
              placeholder={L('选择车辆', 'Vehicle')}
              value={vehicle}
              onChange={(v) => (setVehicle(v), setPolicy(undefined))}
              options={running.map((r) => ({ value: r.id, label: `${r.id} · ${state.resolvedConfigs[r.appliedConfigId!]?.label}` }))}
            />
            <Select
              style={{ width: 260 }}
              placeholder={L('选择策略', 'Policy')}
              value={policy}
              onChange={setPolicy}
              options={policies.map((p) => ({ value: p.policyId, label: `${p.policyId} · ${p.name}` }))}
            />
            <Checkbox checked={failParse} onChange={(e) => setFailParseNext(e.target.checked)}>
              {L('云端解析将失败', 'Cloud parsing will fail')}
            </Checkbox>
            <Button type="primary" disabled={!vehicle || !policy} onClick={() => system((c) => captureEvent(c, { resourceId: vehicle!, policyId: policy!, failParse }), L('事件已触发，开始上传', 'Event fired; uploading'))}>
              {L('触发事件', 'Fire event')}
            </Button>
          </Space>
          <Table
            rowKey="id"
            size="small"
            pagination={false}
            dataSource={events}
            scroll={{ x: 'max-content' }}
            locale={{ emptyText: L('还没有事件', 'No events yet') }}
            columns={[
              { title: L('事件', 'Event'), render: (_, e) => <Mono>{`${e.id.slice(0, 14)}…`}</Mono> },
              { title: L('车辆', 'Vehicle'), render: (_, e) => <Mono>{e.resourceId}</Mono> },
              { title: L('策略', 'Policy'), render: (_, e) => e.policyName },
              { title: L('时间', 'When'), render: (_, e) => when(e.occurredAt) },
              { title: L('处理', 'Processing'), render: (_, e) => <LabelTag map={EVENT_STATUS_LABELS} value={e.status} color={EVENT_STATUS_COLORS[e.status]} /> },
              {
                title: L('解析将失败', 'Parse fails'),
                render: (_, e) => (e.status === 'UPLOADING' || e.status === 'PROCESSING' ? <Switch size="small" checked={e.failParse} onChange={(v) => system((c) => setFailParse(c, e.id, v))} /> : '—'),
              },
              {
                title: '',
                render: (_, e) =>
                  (e.status === 'UPLOADING' || e.status === 'PROCESSING') && (
                    <Button size="small" onClick={() => system((c) => advanceEvent(c, e.id))}>
                      {L('推进一步', 'Advance')}
                    </Button>
                  ),
              },
              {
                title: L('质量检查（外部）', 'Quality check (external)'),
                render: (_, e) => (
                  <Select
                    size="small"
                    style={{ width: 96 }}
                    value={e.quality}
                    onChange={(v: Quality) => system((c) => assessEvent(c, e.id, { quality: v }))}
                    options={['A', 'B', 'C', 'UNKNOWN'].map((q) => ({ value: q, label: B(QUALITY_LABELS[q]) }))}
                  />
                ),
              },
              {
                title: L('用途授权（外部）', 'Use authorization (external)'),
                render: (_, e) => (
                  <Select
                    size="small"
                    style={{ width: 128 }}
                    value={e.trainingUse}
                    onChange={(v: TrainingUse) => system((c) => assessEvent(c, e.id, { trainingUse: v }))}
                    options={['ALLOWED', 'DENIED', 'UNCONFIRMED'].map((u) => ({ value: u, label: B(TRAINING_USE_LABELS[u]) }))}
                  />
                ),
              },
            ]}
          />
        </Card>
      </Space>
    </div>
  );
}
