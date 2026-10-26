// After-sales requests (售后回捞): ask a vehicle of the workspace to capture one of the group's
// policies now, and follow the workspace's requests until the data is in the query.

import { Button, Card, Input, Select, Space, Table, Typography } from 'antd';
import { useState } from 'react';
import { useActor, useCan, useRun } from '../app/hooks.ts';
import { useEngineState } from '../app/store.ts';
import { cancelCaptureRequest, captureRequestsFor, requestAfterSalesCapture } from '../engine/aftersales.ts';
import { capturablePolicies } from '../engine/events.ts';
import { workspaceVehicles } from '../engine/fleet.ts';
import { useI18n } from '../i18n/i18n.tsx';
import { CAPTURE_REQUEST_COLORS, CAPTURE_REQUEST_LABELS, CAPTURE_SOURCE_COLORS, CAPTURE_SOURCE_LABELS, EVENT_STATUS_COLORS, EVENT_STATUS_LABELS } from '../i18n/vocab.ts';
import { Hint, LabelTag, Mono, when } from './common.tsx';

export function CaptureSourceTag({ source }: { source: string }) {
  return <LabelTag map={CAPTURE_SOURCE_LABELS} value={source} color={CAPTURE_SOURCE_COLORS[source]} />;
}

export function AfterSalesRequests({ workspaceId }: { workspaceId: string }) {
  const state = useEngineState();
  const actor = useActor()!;
  const { L } = useI18n();
  const can = useCan();
  const run = useRun();
  const [vehicle, setVehicle] = useState<string | undefined>();
  const [policy, setPolicy] = useState<string | undefined>();
  const [reason, setReason] = useState('');
  // Vehicles of the workspace running a confirmed configuration, and the policies the actor may ask for.
  const vehicles = workspaceVehicles(state, workspaceId).filter((r) => r.appliedConfigId && !r.personal && r.status !== 'RETIRED');
  const r = vehicle ? state.resources[vehicle] : undefined;
  const policies = r ? capturablePolicies(state, r.id).filter((p) => can('event.requestCapture', { workspaceId, groupId: p.groupId, env: r.env })) : [];
  const requests = captureRequestsFor(state, actor, workspaceId);
  const canAsk = vehicles.some((x) => capturablePolicies(state, x.id).some((p) => can('event.requestCapture', { workspaceId, groupId: p.groupId, env: x.env })));
  if (!canAsk && requests.length === 0) return null;
  return (
    <Card size="small" title={L('售后回捞：请求车辆现在采集', 'After-sales: ask a vehicle to capture now')}>
      <Hint>
        {L(
          '为客户案例请求车辆立即采集本组的一条策略。车辆在下次连线时执行，作为核心业务优先采集（超预算仍采集）；同一车辆上的 Grader 周期采集延后，售后先走。数据处理完成后出现在下方查询中。',
          'Ask a vehicle to capture one of your group’s policies now for a customer case. The vehicle runs it on its next connection as core business, first and even over budget; the grader’s periodic captures on that vehicle wait until after-sales is done. Once processed, the data shows in the query below.',
        )}
      </Hint>
      {canAsk && (
        <Space wrap style={{ marginBottom: 12 }}>
          <Select style={{ width: 160 }} placeholder={L('车辆', 'Vehicle')} value={vehicle} onChange={(v) => (setVehicle(v), setPolicy(undefined))} options={vehicles.map((x) => ({ value: x.id, label: x.id }))} />
          <Select style={{ width: 260 }} placeholder={L('策略', 'Policy')} value={policy} onChange={setPolicy} options={policies.map((p) => ({ value: p.policyId, label: `${p.policyId} · ${p.name}` }))} />
          <Input style={{ width: 240 }} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={L('客户案例 / 原因', 'Customer case / reason')} />
          <Button
            type="primary"
            disabled={!vehicle || !policy || !reason.trim()}
            onClick={() => {
              if (run((c) => requestAfterSalesCapture(c, { workspaceId, resourceId: vehicle!, policyId: policy!, reason }), L('已请求，车辆下次连线时采集', 'Requested; the vehicle captures on its next connection')) !== undefined) setReason('');
            }}
          >
            {L('请求采集', 'Request capture')}
          </Button>
        </Space>
      )}
      <Table
        rowKey="id"
        size="small"
        pagination={{ pageSize: 5, hideOnSinglePage: true }}
        dataSource={requests}
        locale={{ emptyText: L('还没有售后请求', 'No after-sales requests yet') }}
        columns={[
          { title: L('车辆', 'Vehicle'), render: (_, q) => <Mono>{q.resourceId}</Mono> },
          { title: L('策略', 'Policy'), render: (_, q) => <Mono>{q.policyId}</Mono> },
          { title: L('原因', 'Reason'), dataIndex: 'reason' },
          { title: L('请求', 'Asked'), render: (_, q) => `${state.accounts[q.requestedBy]?.displayName ?? q.requestedBy} · ${when(q.requestedAt)}` },
          { title: L('状态', 'Status'), render: (_, q) => <LabelTag map={CAPTURE_REQUEST_LABELS} value={q.status} color={CAPTURE_REQUEST_COLORS[q.status]} /> },
          {
            title: L('采集', 'Capture'),
            render: (_, q) => {
              const e = q.eventId ? state.events[q.eventId] : undefined;
              return e ? (
                <Space size={4}>
                  <Mono>{`${e.id.slice(0, 12)}…`}</Mono>
                  <LabelTag map={EVENT_STATUS_LABELS} value={e.status} color={EVENT_STATUS_COLORS[e.status]} />
                </Space>
              ) : (
                <Typography.Text type="secondary">—</Typography.Text>
              );
            },
          },
          {
            title: '',
            render: (_, q) =>
              q.status === 'PENDING' && (
                <Button type="link" size="small" danger onClick={() => run((c) => cancelCaptureRequest(c, q.id), L('已取消', 'Cancelled'))}>
                  {L('取消', 'Cancel')}
                </Button>
              ),
          },
        ]}
      />
    </Card>
  );
}
