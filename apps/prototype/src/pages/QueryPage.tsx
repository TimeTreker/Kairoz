// Data query (数据查询): after-sales lookup by vehicle and event, and training data selection
// without vehicle identity. Both read only what the current grants cover in this workspace.

import { Alert, Button, Card, Collapse, Descriptions, Drawer, Flex, Form, Input, Select, Space, Table, Tabs, Tag, Typography } from 'antd';
import { useState } from 'react';
import { useActor, useCan, useRun, useWorkspace } from '../app/hooks.ts';
import { navigate } from '../app/router.ts';
import { useEngineState } from '../app/store.ts';
import { EnvTag, Hint, LabelTag, Mono, PageHeader, when } from '../components/common.tsx';
import { displayName } from '../engine/config.ts';
import { aftersalesQuery, eventTarget, exportManifest, reprocessEvent, trainingQuery } from '../engine/events.ts';
import type { AftersalesFilter, TrainingFilter } from '../engine/events.ts';
import type { CollectionEvent, State } from '../engine/types.ts';
import { useI18n } from '../i18n/i18n.tsx';
import { EVENT_ORIGIN_LABELS, EVENT_STATUS_COLORS, EVENT_STATUS_LABELS, FILE_PROCESS_LABELS, FILE_TYPE_LABELS, QUALITY_LABELS, TRAINING_BLOCKER_LABELS, TRAINING_USE_LABELS } from '../i18n/vocab.ts';

const pipelineName = (s: State, id: string) => {
  const p = s.pipelines[id];
  return p ? `${p.code}@${p.version}` : id;
};

const kb = (bytes: number) => (bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.round(bytes / 1000)} KB`);

export function QueryPage({ tab = 'aftersales' }: { tab?: string }) {
  const { L } = useI18n();
  const { workspace } = useWorkspace();
  if (!workspace) return null;
  return (
    <div className="kz-page">
      <PageHeader title={L('数据查询', 'Data query')} subtitle={L(`${workspace.name} · 仅限当前授权范围`, `${workspace.name} · within your current grants`)} />
      <Tabs
        activeKey={tab}
        onChange={(k) => navigate(`query/${k}`)}
        items={[
          { key: 'aftersales', label: L('售后查询', 'After-sales'), children: <AftersalesTab workspaceId={workspace.id} /> },
          { key: 'training', label: L('训练数据查询', 'Training data'), children: <TrainingTab workspaceId={workspace.id} /> },
        ]}
      />
    </div>
  );
}

function AftersalesTab({ workspaceId }: { workspaceId: string }) {
  const state = useEngineState();
  const actor = useActor()!;
  const { L, B } = useI18n();
  const [filter, setFilter] = useState<AftersalesFilter>({ status: 'ALL' });
  const [open, setOpen] = useState<string | null>(null);
  const results = aftersalesQuery(state, actor, workspaceId, filter);
  const event = open ? state.events[open] : undefined;

  return (
    <Card>
      <Hint>
        {L(
          '按车辆（VIN / UVID / 车牌 / 编号）与事件定位，可组合策略、时间与处理状态。查询条件只能缩小范围，不能越过工作区、业务分组与环境授权。',
          'Find data by vehicle (VIN / UVID / plate / id) and event, combined with policy, time and processing status. Filters only narrow; they never reach past workspace, group or environment grants.',
        )}
      </Hint>
      <Form layout="inline" name="aftersales" initialValues={filter} onValuesChange={(_, all) => setFilter(all as AftersalesFilter)} style={{ rowGap: 8, marginBottom: 16 }}>
        <Form.Item name="vehicle" label={L('车辆', 'Vehicle')}>
          <Input allowClear placeholder="VIN / UVID / 沪A… / VEH-201" style={{ width: 210 }} />
        </Form.Item>
        <Form.Item name="event" label={L('事件', 'Event')}>
          <Input allowClear placeholder={L('事件 ID 或名称', 'Event id or name')} style={{ width: 170 }} />
        </Form.Item>
        <Form.Item name="policy" label={L('策略', 'Policy')}>
          <Input allowClear placeholder="chassis.steering…" style={{ width: 190 }} />
        </Form.Item>
        <Form.Item name="from" label={L('从', 'From')}>
          <Input type="date" style={{ width: 150 }} />
        </Form.Item>
        <Form.Item name="to" label={L('到', 'To')}>
          <Input type="date" style={{ width: 150 }} />
        </Form.Item>
        <Form.Item name="status" label={L('处理状态', 'Status')}>
          <Select
            style={{ width: 140 }}
            options={[{ value: 'ALL', label: L('全部', 'All') }, ...Object.keys(EVENT_STATUS_LABELS).map((k) => ({ value: k, label: B(EVENT_STATUS_LABELS[k]) }))]}
          />
        </Form.Item>
      </Form>
      <Table
        rowKey="id"
        size="small"
        dataSource={results}
        pagination={{ pageSize: 10, hideOnSinglePage: true }}
        scroll={{ x: 'max-content' }}
        locale={{ emptyText: L('没有授权范围内的匹配事件', 'No matching events within your grants') }}
        onRow={(e) => ({ onClick: () => setOpen(e.id), style: { cursor: 'pointer' } })}
        columns={[
          {
            title: L('车辆', 'Vehicle'),
            render: (_, e) => (
              <Space orientation="vertical" size={0}>
                <Mono>{e.resourceId}</Mono>
                <Typography.Text type="secondary">{[e.licensePlate, e.vin].filter(Boolean).join(' · ')}</Typography.Text>
              </Space>
            ),
          },
          {
            title: L('事件', 'Event'),
            render: (_, e) => (
              <Space orientation="vertical" size={0}>
                <span>{e.policyName}</span>
                <Mono>{e.id.slice(0, 16)}…</Mono>
              </Space>
            ),
          },
          { title: L('时间', 'When'), render: (_, e) => when(e.occurredAt) },
          { title: L('采集文件', 'Files'), render: (_, e) => e.files.length },
          { title: L('处理状态', 'Status'), render: (_, e) => <LabelTag map={EVENT_STATUS_LABELS} value={e.status} color={EVENT_STATUS_COLORS[e.status]} /> },
          { title: L('失败原因', 'Failure'), render: (_, e) => (e.failure ? <Typography.Text type="danger">{e.failure}</Typography.Text> : '—') },
          { title: L('来源', 'Origin'), render: (_, e) => <LabelTag map={EVENT_ORIGIN_LABELS} value={e.origin} /> },
        ]}
      />
      <Drawer open={!!event} size="large" title={event ? `${event.policyName} · ${event.resourceId}` : ''} onClose={() => setOpen(null)}>
        {event && <EventDetail event={event} />}
      </Drawer>
    </Card>
  );
}

function EventDetail({ event: e }: { event: CollectionEvent }) {
  const state = useEngineState();
  const { L, B } = useI18n();
  const can = useCan();
  const run = useRun();
  const release = e.releaseId ? state.releases[e.releaseId] : undefined;
  const policyVersion = state.policyVersions[e.policyVersionId];
  return (
    <Space orientation="vertical" size={16} style={{ width: '100%' }}>
      {e.status === 'FAILED' && (
        <Alert
          type="error"
          showIcon
          title={e.failure}
          action={
            can('event.reprocess', eventTarget(state, e)) && (
              <Button size="small" onClick={() => run((c) => reprocessEvent(c, e.id), L('已重新提交处理，固定版本不变', 'Reprocessing with the same pinned versions'))}>
                {L('重新处理', 'Reprocess')}
              </Button>
            )
          }
        />
      )}
      <Descriptions size="small" column={2} bordered>
        <Descriptions.Item label={L('车辆', 'Vehicle')}><Mono>{e.resourceId}</Mono></Descriptions.Item>
        <Descriptions.Item label="VIN / UVID">{e.vin ?? e.uvid ?? '—'}</Descriptions.Item>
        <Descriptions.Item label={L('车牌', 'Plate')}>{e.licensePlate ?? '—'}</Descriptions.Item>
        <Descriptions.Item label={L('车型 / 环境', 'Model / env')}>
          {e.vehicleModelId} <EnvTag env={e.env} />
        </Descriptions.Item>
        <Descriptions.Item label={L('实际整车版本', 'Vehicle software')}>{e.integrationVersion ?? L('未知', 'unknown')}</Descriptions.Item>
        <Descriptions.Item label={L('发生时间', 'Occurred')}>{when(e.occurredAt)}</Descriptions.Item>
        <Descriptions.Item label={L('策略', 'Policy')} span={2}>
          <Mono>{e.policyId}</Mono> · {e.policyName}
        </Descriptions.Item>
        <Descriptions.Item label={L('触发条件', 'Trigger')} span={2}><Mono>{e.trigger}</Mono></Descriptions.Item>
        <Descriptions.Item label={L('采集窗口', 'Window')}>{`${e.preSeconds}s / ${e.postSeconds}s`}</Descriptions.Item>
        <Descriptions.Item label={L('质量 / 用途', 'Quality / use')}>
          <Space size={4}>
            <LabelTag map={QUALITY_LABELS} value={e.quality} />
            <LabelTag map={TRAINING_USE_LABELS} value={e.trainingUse} />
          </Space>
        </Descriptions.Item>
      </Descriptions>
      <Table
        rowKey="dataKey"
        size="small"
        pagination={false}
        dataSource={e.files}
        scroll={{ x: 'max-content' }}
        columns={[
          {
            title: L('文件', 'File'),
            render: (_, f) => (
              <Space orientation="vertical" size={0}>
                <span>{f.name}</span>
                <Mono>{f.dataKey}</Mono>
              </Space>
            ),
          },
          { title: L('类型 / 格式', 'Type / format'), render: (_, f) => `${B(FILE_TYPE_LABELS[f.fileType], f.fileType)} · ${f.format}` },
          { title: L('车端', 'Edge'), render: (_, f) => <LabelTag map={FILE_PROCESS_LABELS} value={f.edgeStatus} color={f.edgeStatus === 'UPLOADED' ? 'green' : undefined} /> },
          { title: L('云端', 'Cloud'), render: (_, f) => <LabelTag map={FILE_PROCESS_LABELS} value={f.cloudStatus} color={f.cloudStatus === 'DONE' ? 'green' : f.cloudStatus === 'PARSER_FAILED' ? 'red' : undefined} /> },
          { title: L('大小', 'Size'), render: (_, f) => kb(f.sizeBytes) },
          { title: L('保留', 'Retention'), render: (_, f) => L(`${f.retentionDays} 天`, `${f.retentionDays} d`) },
        ]}
      />
      <Collapse
        items={[
          {
            key: 'snapshot',
            label: L('配置快照（事件发生时）', 'Configuration snapshot (at capture)'),
            children: (
              <Descriptions size="small" column={1}>
                <Descriptions.Item label={L('车辆配置', 'Vehicle configuration')}><Mono>{e.configLabel}</Mono></Descriptions.Item>
                <Descriptions.Item label={L('正式版本', 'Release')}>{release ? `DCL ${release.dclVersion}` : L('非正式配置（研发 / 候选）', 'not a formal release (development / candidate)')}</Descriptions.Item>
                <Descriptions.Item label={L('分组提交', 'Group commit')}><Mono>{displayName(state, e.commitId)}</Mono></Descriptions.Item>
                <Descriptions.Item label={L('策略版本', 'Policy version')}><Mono>{`${e.policyId} v${policyVersion?.version ?? '?'}`}</Mono></Descriptions.Item>
                {e.files.map((f) => (
                  <Descriptions.Item key={f.dataKey} label={f.name}>
                    <Mono>{`v${state.fileSpecVersions[f.fileSpecVersionId]?.version ?? '?'} · ${f.schema} · ${pipelineName(state, f.edgePipelineId)} → ${pipelineName(state, f.cloudPipelineId)}`}</Mono>
                  </Descriptions.Item>
                ))}
                <Descriptions.Item label={L('处理次数', 'Processing runs')}>{e.processingAttempts}</Descriptions.Item>
              </Descriptions>
            ),
          },
        ]}
      />
    </Space>
  );
}

function TrainingTab({ workspaceId }: { workspaceId: string }) {
  const state = useEngineState();
  const actor = useActor()!;
  const { L, B } = useI18n();
  const run = useRun();
  const [filter, setFilter] = useState<TrainingFilter>({ quality: 'ALL', availability: 'SELECTABLE' });
  const [selected, setSelected] = useState<string[]>([]);
  const results = trainingQuery(state, actor, workspaceId, filter);
  const chosen = selected.filter((id) => results.some((r) => r.eventId === id && r.blockers.length === 0));

  const download = () => {
    const manifest = run((c) => exportManifest(c, chosen), L(`已导出 ${chosen.length} 条数据清单`, `Exported a manifest of ${chosen.length}`));
    if (!manifest) return;
    const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kairoz-data-manifest-${manifest.generatedAt.slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card>
      <Hint>
        {L(
          '可选用条件：处理完成、捕获文件完整、质量 A/B、允许训练用途。未知不等于通过。结果与导出清单不含车辆编号、VIN、车牌、UVID 或整车版本；清单是采集平台的交付物，不在这里管理训练数据集。',
          'Selectable: processed, all captured files complete, quality A/B, training use allowed. Unknown never counts as passed. Results and manifests carry no vehicle id, VIN, plate, UVID or vehicle software; the manifest is the platform’s deliverable, not a dataset managed here.',
        )}
      </Hint>
      <Form layout="inline" name="training" initialValues={filter} onValuesChange={(_, all) => setFilter(all as TrainingFilter)} style={{ rowGap: 8, marginBottom: 16 }}>
        <Form.Item name="policy" label={L('策略', 'Policy')}>
          <Input allowClear placeholder="chassis.steering…" style={{ width: 190 }} />
        </Form.Item>
        <Form.Item name="scenario" label={L('场景', 'Scenario')}>
          <Input allowClear placeholder={L('例如 转角突变', 'e.g. 转角突变')} style={{ width: 160 }} />
        </Form.Item>
        <Form.Item name="from" label={L('从', 'From')}>
          <Input type="date" style={{ width: 150 }} />
        </Form.Item>
        <Form.Item name="to" label={L('到', 'To')}>
          <Input type="date" style={{ width: 150 }} />
        </Form.Item>
        <Form.Item name="quality" label={L('质量', 'Quality')}>
          <Select style={{ width: 110 }} options={[{ value: 'ALL', label: L('全部', 'All') }, ...['A', 'B', 'C', 'UNKNOWN'].map((q) => ({ value: q, label: B(QUALITY_LABELS[q]) }))]} />
        </Form.Item>
        <Form.Item name="availability" label={L('数据可用性', 'Availability')}>
          <Select
            style={{ width: 150 }}
            options={[
              { value: 'SELECTABLE', label: L('仅可选用', 'Selectable only') },
              { value: 'ALL', label: L('全部（含原因）', 'All (with reasons)') },
            ]}
          />
        </Form.Item>
      </Form>
      <Flex justify="space-between" align="center" style={{ marginBottom: 8 }}>
        <Typography.Text type="secondary">{L(`${results.length} 条结果，已选 ${chosen.length} 条`, `${results.length} results, ${chosen.length} selected`)}</Typography.Text>
        <Button type="primary" disabled={chosen.length === 0} onClick={download}>
          {L('导出数据清单（JSON）', 'Export manifest (JSON)')}
        </Button>
      </Flex>
      <Table
        rowKey="eventId"
        size="small"
        dataSource={results}
        pagination={{ pageSize: 10, hideOnSinglePage: true }}
        scroll={{ x: 'max-content' }}
        rowSelection={{ selectedRowKeys: chosen, onChange: (keys) => setSelected(keys as string[]), getCheckboxProps: (t) => ({ disabled: t.blockers.length > 0 }) }}
        locale={{ emptyText: L('没有授权范围内的可选用数据', 'No selectable data within your grants') }}
        columns={[
          { title: L('事件', 'Event'), render: (_, t) => <Mono>{`${t.eventId.slice(0, 16)}…`}</Mono> },
          { title: L('场景 / 策略', 'Scenario / policy'), render: (_, t) => <Space orientation="vertical" size={0}><span>{t.scenario}</span><Mono>{t.policyId}</Mono></Space> },
          { title: L('车型 / 环境', 'Model / env'), render: (_, t) => <Space size={4}>{t.vehicleModelId}<EnvTag env={t.env} /></Space> },
          { title: L('时间', 'When'), render: (_, t) => when(t.occurredAt) },
          { title: L('质量', 'Quality'), render: (_, t) => <LabelTag map={QUALITY_LABELS} value={t.quality} color={t.quality === 'A' || t.quality === 'B' ? 'green' : undefined} /> },
          { title: L('用途', 'Use'), render: (_, t) => <LabelTag map={TRAINING_USE_LABELS} value={t.trainingUse} color={t.trainingUse === 'ALLOWED' ? 'green' : undefined} /> },
          { title: L('文件', 'Files'), dataIndex: 'fileCount' },
          { title: L('处理', 'Processing'), render: (_, t) => <LabelTag map={EVENT_STATUS_LABELS} value={t.status} color={EVENT_STATUS_COLORS[t.status]} /> },
          {
            title: L('不可选用原因', 'Why not selectable'),
            render: (_, t) =>
              t.blockers.length ? (
                t.blockers.map((b) => (
                  <Tag key={b} color="orange">
                    {B(TRAINING_BLOCKER_LABELS[b], b)}
                  </Tag>
                ))
              ) : (
                <Tag color="green">{L('可选用', 'selectable')}</Tag>
              ),
          },
        ]}
      />
    </Card>
  );
}
