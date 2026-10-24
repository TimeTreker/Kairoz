// A vehicle's client state (客户端状态): what its DCL client last reported it runs, compared with
// the platform's own record, and the report history. Diagnostic only.

import { Alert, Descriptions, Drawer, Empty, Space, Table, Tag, Tooltip, Typography } from 'antd';
import { useActor } from '../app/hooks.ts';
import { useEngineState } from '../app/store.ts';
import type { VersionItem } from '../domain/client-report.ts';
import { clientReportView } from '../engine/client-report.ts';
import type { StoredReport } from '../engine/types.ts';
import { useI18n } from '../i18n/i18n.tsx';
import { CLIENT_ITEM_STATUS_LABELS, REPORT_RESULT_LABELS, setName } from '../i18n/vocab.ts';
import { LabelTag, Mono, ShortId, configName, when } from './common.tsx';

/** Same or different from the platform's record; a difference is shown, never acted on. */
function Match({ same }: { same: boolean }) {
  const { L } = useI18n();
  return same ? <Tag color="green">{L('与平台记录一致', 'Matches the platform')}</Tag> : <Tag color="orange">{L('与平台记录不同（仅诊断）', 'Differs from the platform (diagnostic only)')}</Tag>;
}

function Items({ items, empty }: { items: VersionItem[]; empty: string }) {
  const { L } = useI18n();
  return (
    <Table
      size="small"
      rowKey="id"
      pagination={false}
      dataSource={items}
      locale={{ emptyText: empty }}
      columns={[
        { title: 'ID', render: (_, i) => <Mono>{i.id}</Mono> },
        { title: L('版本', 'Version'), render: (_, i) => i.version ?? <Typography.Text type="secondary">{L('未知', 'unknown')}</Typography.Text> },
        { title: L('状态', 'Status'), render: (_, i) => (CLIENT_ITEM_STATUS_LABELS[i.status] ? <LabelTag map={CLIENT_ITEM_STATUS_LABELS} value={i.status} /> : i.status) },
      ]}
    />
  );
}

export function ClientReportDrawer({ resourceId, workspaceId, onClose }: { resourceId: string | null; workspaceId: string | null; onClose: () => void }) {
  const state = useEngineState();
  const actor = useActor();
  const { L, B } = useI18n();
  const view = resourceId && actor ? clientReportView(state, actor, resourceId, workspaceId) : null;
  const reportedReleaseId = view?.latest?.payload.configuration?.releaseId;
  const reportedSet = reportedReleaseId ? state.releases[reportedReleaseId] : undefined;
  const latest = view?.latest?.payload;
  return (
    <Drawer open={resourceId !== null} size="large" title={resourceId ? `${resourceId} · ${L('客户端状态', 'Client state')}` : ''} onClose={onClose}>
      {!view ? (
        <Empty description={L('无权查看此车辆的客户端状态', 'You may not see this vehicle’s client state')} />
      ) : (
        <Space orientation="vertical" size={16} style={{ width: '100%' }}>
          <Alert
            type="info"
            showIcon
            title={L(
              '车端 DCL 客户端上报它实际运行的内容。上报只用于诊断：不会完成 OTA、不改变车辆归属，也不会更新平台记录的整车版本。签名为 Mock，非真实设备认证。',
              'The vehicle’s DCL client reports what it actually runs. Reports are diagnostic only: they never complete an OTA, change ownership or update the recorded software version. Signatures are mock, not real device authentication.',
            )}
          />
          <Descriptions size="small" column={1} bordered>
            <Descriptions.Item label={L('设备密钥', 'Device key')}>
              {view.deviceKey ? (
                <Space wrap>
                  <Mono>{view.deviceKey.keyId}</Mono>
                  <ShortId value={view.deviceKey.publicKey} size={22} />
                  <Typography.Text type="secondary">
                    {state.accounts[view.deviceKey.registeredBy]?.displayName ?? view.deviceKey.registeredBy} · {when(view.deviceKey.registeredAt)}
                  </Typography.Text>
                </Space>
              ) : (
                <Tag color="red">{L('未登记：设备不能上报', 'Not registered: the device cannot report')}</Tag>
              )}
            </Descriptions.Item>
          </Descriptions>
          {!latest || !view.latest || !view.comparison ? (
            <Empty description={L('还没有收到客户端上报', 'No client report received yet')} />
          ) : (
            <>
              <Descriptions size="small" column={1} bordered title={L('最新上报', 'Latest report')}>
                <Descriptions.Item label={L('启动 / 序号', 'Boot / sequence')}>
                  <Space>
                    <span>
                      {L(`第 ${latest.bootCounter} 次启动 · 序号 ${latest.sequence}`, `boot ${latest.bootCounter} · sequence ${latest.sequence}`)}
                    </span>
                    <ShortId value={latest.bootId} size={14} />
                  </Space>
                </Descriptions.Item>
                <Descriptions.Item label={L('时间', 'Time')}>
                  {L('客户端', 'client')} {when(latest.reportedAt)} · {L('平台接收', 'received')} {when(view.latest.receivedAt)}
                </Descriptions.Item>
                <Descriptions.Item label={L('实际整车版本', 'Actual software')}>
                  <Space wrap>
                    <span>{latest.vehicleIntegrationVersion ?? L('未知', 'unknown')}</span>
                    <Match same={view.comparison.software.same} />
                    {!view.comparison.software.same && (
                      <Typography.Text type="secondary">
                        {L('平台记录', 'platform')}: {view.comparison.software.recorded ?? L('未知', 'unknown')}
                      </Typography.Text>
                    )}
                  </Space>
                </Descriptions.Item>
                <Descriptions.Item label={L('DCL 客户端', 'DCL client')}>
                  {latest.clients.map((c) => (
                    <Tag key={c.id}>
                      {c.id} {c.version} ({c.build}) · {CLIENT_ITEM_STATUS_LABELS[c.status] ? B(CLIENT_ITEM_STATUS_LABELS[c.status]!) : c.status}
                    </Tag>
                  ))}
                </Descriptions.Item>
                <Descriptions.Item label={L('已生效配置', 'Applied configuration')}>
                  <Space wrap>
                    <Mono>{reportedSet ? B(setName(reportedSet.dclVersion)) : (view.comparison.configuration.reportedLabel ?? '—')}</Mono>
                    <ShortId value={view.comparison.configuration.reported} size={16} />
                    <Match same={view.comparison.configuration.same} />
                    {!view.comparison.configuration.same && (
                      <Typography.Text type="secondary">
                        {L('平台记录', 'platform')}: {B(configName(state, state.resources[view.resourceId]?.appliedConfigId))}
                      </Typography.Text>
                    )}
                  </Space>
                </Descriptions.Item>
                <Descriptions.Item label={L('执行', 'Execution')}>
                  {latest.execution.command ? (
                    <Space wrap>
                      <ShortId value={latest.execution.command} size={18} />
                      <span>{L(`第 ${latest.execution.attempt} 次尝试`, `attempt ${latest.execution.attempt}`)}</span>
                      {latest.execution.lastError && <Tag color="red">{latest.execution.lastError}</Tag>}
                      <Tag>{latest.execution.mode}</Tag>
                    </Space>
                  ) : (
                    <Typography.Text type="secondary">{L('没有执行记录', 'No execution yet')}</Typography.Text>
                  )}
                </Descriptions.Item>
                <Descriptions.Item label={L('车端 / 云端处理', 'Edge / cloud processing')}>
                  <Space orientation="vertical" size={2}>
                    <span>{latest.edgeProcessing.join(', ') || '—'}</span>
                    <Tooltip title={L('配置引用的云端处理版本，不代表车端证明云端正在执行', 'Cloud versions the configuration names; not proof the cloud runs them')}>
                      <Typography.Text type="secondary">{latest.cloudProcessing.join(', ') || '—'}</Typography.Text>
                    </Tooltip>
                  </Space>
                </Descriptions.Item>
              </Descriptions>
              <Typography.Title level={5} style={{ margin: 0 }}>
                {L('域控', 'Controllers')}
              </Typography.Title>
              <Items items={latest.domains} empty={L('没有域控信息', 'No controllers')} />
              <Typography.Title level={5} style={{ margin: 0 }}>
                <Tooltip title={L('“已配置”表示配置包含该策略，不代表业务节点已回执应用', '“Configured” means the configuration contains it, not that a business node applied it')}>
                  {L('策略', 'Policies')}
                </Tooltip>
              </Typography.Title>
              <Items items={latest.policies} empty={L('没有策略', 'No policies')} />
              <Typography.Title level={5} style={{ margin: 0 }}>
                {L('文件', 'Files')}
              </Typography.Title>
              <Items items={latest.files} empty={L('没有文件', 'No files')} />
            </>
          )}
          <Typography.Title level={5} style={{ margin: 0 }}>
            {L('上报历史', 'Report history')} · {view.history.length}
          </Typography.Title>
          <Table<StoredReport>
            size="small"
            rowKey={(h) => `${h.bootCounter}/${h.sequence}`}
            pagination={{ pageSize: 10, hideOnSinglePage: true }}
            dataSource={view.history}
            locale={{ emptyText: L('没有更早的上报', 'No earlier reports') }}
            columns={[
              { title: L('启动 / 序号', 'Boot / sequence'), render: (_, h) => `${h.bootCounter} / ${h.sequence}` },
              { title: L('客户端时间', 'Client time'), render: (_, h) => when(h.payload.reportedAt) },
              { title: L('平台接收', 'Received'), render: (_, h) => when(h.receivedAt) },
              { title: L('结果', 'Result'), render: (_, h) => <LabelTag map={REPORT_RESULT_LABELS} value={h.result} color={h.result === 'STALE' ? 'gold' : undefined} /> },
              { title: L('客户端版本', 'Client version'), render: (_, h) => h.payload.clients[0]?.version ?? '—' },
              { title: L('配置', 'Configuration'), render: (_, h) => <Mono>{h.payload.configuration?.version ?? '—'}</Mono> },
            ]}
          />
        </Space>
      )}
    </Drawer>
  );
}
