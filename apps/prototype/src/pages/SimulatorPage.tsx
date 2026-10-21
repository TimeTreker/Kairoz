// The vehicle simulator: plays the vehicles and simulators. It is a prototype tool, clearly
// separate from the product's role pages, which never fabricate results themselves.

import { App, Alert, Button, Card, Space, Switch, Table, Tag, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { useErrorText } from '../app/hooks.ts';
import { engine, useEngineState } from '../app/store.ts';
import { EnvTag, Mono, PageHeader, when } from '../components/common.tsx';
import type { Ctx } from '../engine/engine.ts';
import { pendingForVehicles, sendReceipt, setAgent, tick } from '../engine/simulator.ts';
import { useI18n } from '../i18n/i18n.tsx';
import { RESOURCE_TYPE_LABELS } from '../i18n/vocab.ts';

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
          {pending.length === 0 && <Alert type="info" showIcon message={L('没有等待回执的配置。在 Feature 的“下发与测试”中下发后会出现在这里。', 'Nothing is waiting. Dispatch from a Feature’s “Dispatch & tests” tab.')} />}
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
      </Space>
    </div>
  );
}
