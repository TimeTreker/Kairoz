// The vehicle simulator: plays the vehicles and simulators. It is a prototype tool, clearly
// separate from the product's role pages, which never fabricate results themselves.

import { App, Alert, Button, Card, Checkbox, Dropdown, Select, Space, Switch, Table, Tag, Tooltip, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { useErrorText } from '../app/hooks.ts';
import { engine, useEngineState } from '../app/store.ts';
import { EnvTag, LabelTag, Mono, PageHeader, configName, when } from '../components/common.tsx';
import { CompanyDirectoryCard } from '../components/company-directory.tsx';
import type { Ctx } from '../engine/engine.ts';
import { advanceEvent, assessEvent, capturablePolicies, captureEvent, deliverCallback, receiveChunk, setFailParse } from '../engine/events.ts';
import type { Quality, TrainingUse } from '../engine/types.ts';
import { deviceSummary, flushOutbox, pendingForVehicles, reportNow, restartClient, sendFault, sendReceipt, setAgent, tick, upgradeClient } from '../engine/simulator.ts';
import type { ReportFault } from '../engine/simulator.ts';
import { useI18n } from '../i18n/i18n.tsx';
import { ERROR_LABELS, EVENT_STATUS_COLORS, EVENT_STATUS_LABELS, QUALITY_LABELS, REPORT_RESULT_LABELS, RESOURCE_TYPE_LABELS, TRAINING_USE_LABELS } from '../i18n/vocab.ts';

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
                { title: L('配置', 'Configuration'), render: (_, p) => <Mono>{B(configName(state, p.deployment.resolvedConfigId))}</Mono> },
                { title: L('下发', 'Dispatch'), render: (_, p) => <Mono>{p.deployment.id}</Mono> },
                { title: L('尝试', 'Attempt'), render: (_, p) => p.target.attempt },
                { title: L('本次尝试开始', 'Attempt since'), render: (_, p) => when(p.target.updatedAt) },
                {
                  title: '',
                  render: (_, p) => {
                    const vehicle = state.resources[p.target.resourceId]!;
                    const online = vehicle.agent.online && vehicle.instance !== 'STOPPED';
                    if (p.held) {
                      return (
                        <Tooltip title={L('暂停期间车辆保持已确认的配置；配置发布恢复 OTA 后再回执。', 'While paused the vehicle keeps its confirmed configuration; it reports once Release resumes the rollout.')}>
                          <Tag color="orange">{L('OTA 已暂停，恢复后回执', 'Rollout paused; receipt after resume')}</Tag>
                        </Tooltip>
                      );
                    }
                    return (
                      <Space>
                        <Button size="small" type="primary" disabled={!online} onClick={() => system((c) => sendReceipt(c, p.deployment.id, p.target.resourceId, 'APPLIED'), L('车辆已回执：应用成功', 'Receipt sent: applied'))}>
                          {L('回执：应用成功', 'Receipt: applied')}
                        </Button>
                        <Button size="small" danger disabled={!online} onClick={() => system((c) => sendReceipt(c, p.deployment.id, p.target.resourceId, 'FAILED', 'simulated apply failure'), L('车辆已回执：失败', 'Receipt sent: failed'))}>
                          {L('回执：失败', 'Receipt: failed')}
                        </Button>
                        {!vehicle.agent.online && <Tag>{L('离线', 'offline')}</Tag>}
                        {vehicle.instance === 'STOPPED' && <Tag>{L('实例已停止', 'instance stopped')}</Tag>}
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
              { title: L('已生效配置', 'Applied'), render: (_, r) => <Mono>{B(configName(state, r.appliedConfigId))}</Mono> },
              {
                title: (
                  <Tooltip title={L('客户端上报实际运行的内容；离线时暂存，恢复连接后补报。签名为 Mock。', 'The client reports what it actually runs; offline, reports wait and are sent on reconnect. Signatures are mock.')}>
                    {L('DCL 客户端', 'DCL client')}
                  </Tooltip>
                ),
                render: (_, r) => {
                  const d = deviceSummary(state, r.id);
                  const stopped = r.instance === 'STOPPED';
                  const result = (x: string) => (REPORT_RESULT_LABELS[x] ? B(REPORT_RESULT_LABELS[x]!) : x);
                  const fault = (f: ReportFault) => {
                    const out = system((c) => sendFault(c, r.id, f));
                    if (out !== undefined) message.info(result(out));
                  };
                  const next = d ? d.clientVersion.replace(/^(\d+)\.(\d+)\..*$/, (_m, a: string, b: string) => `${a}.${Number(b) + 1}.0`) : '2.4.0';
                  return (
                    <Space size={4} wrap>
                      {d && (
                        <Typography.Text type="secondary">
                          v{d.clientVersion} · {L(`启动 ${d.bootCounter} / 序号 ${d.sequence}`, `boot ${d.bootCounter} / seq ${d.sequence}`)}
                        </Typography.Text>
                      )}
                      {d && d.queued > 0 && (
                        <Tooltip title={d.lastError ? B(ERROR_LABELS[d.lastError] ?? { zh: d.lastError, en: d.lastError }) : L('等待恢复连接', 'Waiting for a connection')}>
                          <Tag color={d.lastError ? 'red' : 'gold'}>{L(`待补报 ${d.queued}`, `${d.queued} queued`)}</Tag>
                        </Tooltip>
                      )}
                      <Button
                        size="small"
                        disabled={stopped}
                        onClick={() => {
                          const out = system((c) => reportNow(c, r.id));
                          if (out !== undefined) message.success(result(out));
                        }}
                      >
                        {L('上报', 'Report')}
                      </Button>
                      <Button
                        size="small"
                        disabled={stopped}
                        onClick={() => {
                          const out = system((c) => restartClient(c, r.id));
                          if (out !== undefined) message.success(`${L('已重启客户端', 'Client restarted')} · ${result(out)}`);
                        }}
                      >
                        {L('重启客户端', 'Restart client')}
                      </Button>
                      {d && d.queued > 0 && (
                        <Button
                          size="small"
                          disabled={stopped}
                          onClick={() => {
                            const out = system((c) => flushOutbox(c, r.id));
                            if (out) message.info(L(`已补报 ${out.sent} 份，仍待 ${out.waiting} 份`, `Sent ${out.sent}; ${out.waiting} still queued`));
                          }}
                        >
                          {L('补报', 'Send queued')}
                        </Button>
                      )}
                      <Dropdown
                        disabled={stopped}
                        menu={{
                          items: [
                            { key: 'upgrade', label: L(`升级客户端到 ${next}`, `Upgrade client to ${next}`) },
                            { type: 'divider' },
                            { key: 'REPLAY', label: L('重放上一份上报', 'Resend the last report'), disabled: !d?.hasSent },
                            { key: 'SEQUENCE_CONFLICT', label: L('同序号发送不同内容', 'Same sequence, other content'), disabled: !d?.hasSent },
                            { key: 'TAMPER', label: L('篡改签名后的上报', 'Tamper with a signed report') },
                            { key: 'BOOT_CONFLICT', label: L('同一启动计数换启动 ID', 'Same boot counter, other boot id') },
                            { key: 'OUT_OF_ORDER', label: L('两份上报乱序到达', 'Two reports arrive out of order') },
                          ],
                          onClick: ({ key }) => {
                            if (key === 'upgrade') system((c) => upgradeClient(c, r.id, next), L(`客户端已升级到 ${next}，下一次上报会带上新版本`, `Client upgraded to ${next}; the next report carries it`));
                            else fault(key as ReportFault);
                          },
                        }}
                      >
                        <Button size="small">{L('更多', 'More')}</Button>
                      </Dropdown>
                    </Space>
                  );
                },
              },
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
              options={running.map((r) => ({ value: r.id, label: `${r.id} · ${B(configName(state, r.appliedConfigId))}` }))}
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
                render: (_, e) => {
                  const f = e.files[0];
                  const chunk = f?.chunks[0];
                  return (
                    <Space size={0} wrap>
                      {(e.status === 'UPLOADING' || e.status === 'PROCESSING') && (
                        <Button size="small" onClick={() => system((c) => advanceEvent(c, e.id))}>
                          {L('推进一步', 'Advance')}
                        </Button>
                      )}
                      {f && chunk && (
                        <Button type="link" size="small" onClick={() => system((c) => receiveChunk(c, e.id, f.dataKey, 0, chunk.sha256), L('分片已重传（幂等）', 'Chunk resent (idempotent)'))}>
                          {L('重传分片', 'Resend chunk')}
                        </Button>
                      )}
                      {f && chunk && (
                        <Button type="link" size="small" danger onClick={() => system((c) => receiveChunk(c, e.id, f.dataKey, 0, 'sha256:tampered'))}>
                          {L('篡改校验', 'Tamper checksum')}
                        </Button>
                      )}
                      {e.status === 'DONE' && (
                        <Button type="link" size="small" onClick={() => system((c) => deliverCallback(c, e.id), L('回调已发送（重复会去重）', 'Callback sent (duplicates are ignored)'))}>
                          {L('重复回调', 'Repeat callback')}
                        </Button>
                      )}
                    </Space>
                  );
                },
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
        <CompanyDirectoryCard />
      </Space>
    </div>
  );
}
