import { PlusOutlined } from '@ant-design/icons';
import { Button, Card, Checkbox, Form, Input, InputNumber, Modal, Select, Space, Table, Tabs, Tag } from 'antd';
import { useState } from 'react';
import { useCan, useRun } from '../app/hooks.ts';
import { navigate } from '../app/router.ts';
import { useEngineState } from '../app/store.ts';
import { BudgetLine, BudgetModal, HoldTag, PauseButton, UsageMeter } from '../components/budget.tsx';
import { Hint, Mono, PageHeader, when } from '../components/common.tsx';
import { TechnicalChanges } from '../components/technical.tsx';
import type { Budget } from '../domain/budget.ts';
import { FILE_TYPES, PRIVACY_LEVELS, typeAlwaysRequiresReview } from '../domain/file-types.ts';
import type { FileType } from '../domain/file-types.ts';
import { budgetOf, modelBudget, setModelBudget, setVehicleBudget } from '../engine/budget.ts';
import { createPipeline, createTemplate, currentTemplate } from '../engine/processing.ts';
import { useI18n } from '../i18n/i18n.tsx';
import { BUDGET_SOURCE_LABELS, FILE_TYPE_LABELS } from '../i18n/vocab.ts';

export function ProcessingPage({ tab = 'templates' }: { tab?: string }) {
  const state = useEngineState();
  const { L, B } = useI18n();
  const can = useCan();
  const run = useRun();
  const canManage = can('processing.manage', { workspaceId: '*', groupId: '*' });
  const [pipelineOpen, setPipelineOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [pf] = Form.useForm();
  const [tf] = Form.useForm();
  const templateType = Form.useWatch('fileType', tf) as FileType | undefined;
  const reviewForced = !!templateType && typeAlwaysRequiresReview(templateType);
  const pipelines = Object.values(state.pipelines).sort((a, b) => a.code.localeCompare(b.code) || a.version - b.version);
  const templates = FILE_TYPES.map((t) => ({ fileType: t, template: currentTemplate(state, t) }));

  return (
    <div className="kz-page">
      <PageHeader
        title={L('处理目录', 'Processing catalog')}
        subtitle={L('DCL 工程维护：车端 / 云端处理的不可变版本，以及每类文件的默认绑定模板。', 'Maintained by DCL engineering: immutable Edge/Cloud processing versions and the default binding per file type.')}
      />
      <Tabs
        activeKey={tab}
        onChange={(k) => navigate(`processing/${k}`)}
        items={[
          {
            key: 'templates',
            label: L('默认模板', 'Default templates'),
            children: (
              <Card extra={canManage && <Button icon={<PlusOutlined />} onClick={() => (tf.resetFields(), setTemplateOpen(true))}>{L('发布模板版本', 'Publish template version')}</Button>}>
                <Hint>{L('业务添加文件时按类型取当前模板；之后模板升级不会让已有文件的绑定漂移。敏感类型和未知类型的模板强制需要审核。', 'Adding a file takes the current template for its type; later upgrades never move existing bindings. Sensitive and unknown types always require review.')}</Hint>
                <Table
                  rowKey="fileType"
                  pagination={false}
                  dataSource={templates}
                  columns={[
                    { title: L('文件类型', 'File type'), render: (_, r) => B(FILE_TYPE_LABELS[r.fileType]) },
                    { title: L('当前模板', 'Current template'), render: (_, r) => (r.template ? <Mono>{r.template.id}</Mono> : <Tag color="red">{L('未发布（添加文件会被阻止）', 'None (adding files is blocked)')}</Tag>) },
                    { title: 'Format / Schema', render: (_, r) => r.template && <Mono>{`${r.template.format} / ${r.template.schema}`}</Mono> },
                    { title: 'Edge / Cloud', render: (_, r) => r.template && <Space orientation="vertical" size={0}><Mono>{r.template.edgePipelineId}</Mono><Mono>{r.template.cloudPipelineId}</Mono></Space> },
                    { title: L('审核 / 隐私 / 保留', 'Review / privacy / retention'), render: (_, r) => r.template && `${r.template.requiresReview ? L('需审核', 'review') : L('无需审核', 'no review')} · ${r.template.defaultPrivacy} · ${r.template.defaultRetentionDays}${L(' 天', 'd')}` },
                  ]}
                />
              </Card>
            ),
          },
          {
            key: 'pipelines',
            label: L('处理版本', 'Pipelines'),
            children: (
              <Card extra={canManage && <Button icon={<PlusOutlined />} onClick={() => (pf.resetFields(), setPipelineOpen(true))}>{L('发布处理版本', 'Publish pipeline version')}</Button>}>
                <Table
                  rowKey="id"
                  pagination={{ pageSize: 20, hideOnSinglePage: true }}
                  dataSource={pipelines}
                  columns={[
                    { title: 'ID', render: (_, p) => <Mono>{p.id}</Mono> },
                    { title: L('侧', 'Side'), render: (_, p) => <Tag color={p.side === 'EDGE' ? 'geekblue' : 'purple'}>{p.side}</Tag> },
                    { title: L('名称', 'Name'), dataIndex: 'name' },
                    { title: 'Formats', render: (_, p) => p.formats.join(', ') },
                    { title: L('步骤', 'Steps'), render: (_, p) => p.steps.join(' → ') },
                    { title: L('能力', 'Capability'), dataIndex: 'capability' },
                    { title: L('发布', 'Published'), render: (_, p) => `${state.accounts[p.createdBy]?.displayName ?? p.createdBy} · ${when(p.createdAt)}` },
                  ]}
                />
              </Card>
            ),
          },
          { key: 'technical', label: L('技术变更', 'Technical changes'), children: <TechnicalChanges /> },
          { key: 'budget', label: L('资源预算', 'Collection budgets'), children: <BudgetTab /> },
        ]}
      />
      <Modal
        open={pipelineOpen}
        title={L('发布处理版本', 'Publish a pipeline version')}
        onCancel={() => setPipelineOpen(false)}
        onOk={() =>
          pf.validateFields().then((v) => {
            const id = run((c) => createPipeline(c, { ...v, formats: v.formats, steps: v.steps, schemas: v.schemas }), L('已发布', 'Published'));
            if (id) setPipelineOpen(false);
          })
        }
      >
        <Hint>{L('同一 code 再次发布会生成下一个不可变版本；一个 code 只属于车端或云端。', 'Publishing an existing code creates its next immutable version; a code belongs to one side only.')}</Hint>
        <Form form={pf} name="pipeline" layout="vertical" initialValues={{ side: 'CLOUD', capability: 'Parse' }}>
          <Form.Item name="code" label="Code" rules={[{ required: true }]}>
            <Input placeholder="chassis-parser" />
          </Form.Item>
          <Form.Item name="side" label={L('侧', 'Side')}>
            <Select options={[{ value: 'EDGE', label: 'EDGE' }, { value: 'CLOUD', label: 'CLOUD' }]} />
          </Form.Item>
          <Form.Item name="name" label={L('名称', 'Name')} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="formats" label="Formats" rules={[{ required: true }]}>
            <Select mode="tags" placeholder={L('输入后回车，例如 binary', 'Type and press Enter, e.g. binary')} />
          </Form.Item>
          <Form.Item name="schemas" label={L('Schemas（留空 = 任意）', 'Schemas (blank = any)')}>
            <Select mode="tags" />
          </Form.Item>
          <Form.Item name="steps" label={L('步骤', 'Steps')} rules={[{ required: true }]}>
            <Select mode="tags" placeholder={L('按执行顺序输入，例如 Receive、Parse', 'In order, e.g. Receive, Parse')} />
          </Form.Item>
          <Form.Item name="capability" label={L('能力', 'Capability')}>
            <Select options={['RawStorage', 'Parse', 'Desensitize', 'Index'].map((c) => ({ value: c, label: c }))} />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        open={templateOpen}
        title={L('发布模板版本', 'Publish a template version')}
        onCancel={() => setTemplateOpen(false)}
        onOk={() =>
          tf.validateFields().then((v) => {
            const id = run((c) => createTemplate(c, v), L('已发布', 'Published'));
            if (id) setTemplateOpen(false);
          })
        }
      >
        <Form form={tf} name="template" layout="vertical" initialValues={{ defaultRetentionDays: 30 }}>
          <Form.Item name="fileType" label={L('文件类型', 'File type')} rules={[{ required: true }]}>
            <Select options={FILE_TYPES.map((t) => ({ value: t, label: B(FILE_TYPE_LABELS[t]) }))} />
          </Form.Item>
          <Space>
            <Form.Item name="format" label="Format" rules={[{ required: true }]}>
              <Input />
            </Form.Item>
            <Form.Item name="schema" label="Schema" rules={[{ required: true }]}>
              <Input />
            </Form.Item>
          </Space>
          <Form.Item name="edgePipelineId" label={L('车端处理', 'Edge pipeline')} rules={[{ required: true }]}>
            <Select options={pipelines.filter((p) => p.side === 'EDGE').map((p) => ({ value: p.id, label: p.id }))} />
          </Form.Item>
          <Form.Item name="cloudPipelineId" label={L('云端处理', 'Cloud pipeline')} rules={[{ required: true }]}>
            <Select options={pipelines.filter((p) => p.side === 'CLOUD').map((p) => ({ value: p.id, label: p.id }))} />
          </Form.Item>
          <Space>
            <Form.Item name="defaultPrivacy" label={L('默认隐私', 'Default privacy')}>
              <Select allowClear style={{ width: 120 }} options={PRIVACY_LEVELS.map((p) => ({ value: p, label: p }))} />
            </Form.Item>
            <Form.Item name="defaultRetentionDays" label={L('默认保留天数', 'Default retention')} rules={[{ required: true }]}>
              <InputNumber min={1} />
            </Form.Item>
          </Space>
          {reviewForced ? (
            <Form.Item extra={L('敏感与未知类型始终需要审核，不能关闭。', 'Sensitive and unknown types always require review; it cannot be turned off.')}>
              <Checkbox checked disabled>
                {L('要求敏感审核', 'Require sensitive review')}
              </Checkbox>
            </Form.Item>
          ) : (
            <Form.Item name="requiresReview" valuePropName="checked">
              <Checkbox>{L('要求敏感审核', 'Require sensitive review')}</Checkbox>
            </Form.Item>
          )}
        </Form>
      </Modal>
    </div>
  );
}

/** Resource protection (资源保护): DCL engineering's collection budgets and each vehicle's hour. */
function BudgetTab() {
  const state = useEngineState();
  const { L, B } = useI18n();
  const can = useCan();
  const run = useRun();
  const canManage = can('budget.manage', { workspaceId: '*' });
  const [editing, setEditing] = useState<{ kind: 'model' | 'vehicle'; id: string } | null>(null);
  const [vehicleChoice, setVehicleChoice] = useState<string | undefined>();
  const models = Object.values(state.vehicleModels);
  const overrides = Object.entries(state.collectionBudgets.vehicles);
  // Vehicles that can fire: those running a confirmed configuration.
  const vehicles = Object.values(state.resources).filter((r) => r.appliedConfigId && !r.personal && r.status !== 'RETIRED').sort((a, b) => a.id.localeCompare(b.id));
  const initial: Budget | null = editing ? (editing.kind === 'model' ? modelBudget(state, editing.id).budget : budgetOf(state, editing.id).budget) : null;
  const save = (b: Budget) =>
    run((c) => (editing!.kind === 'model' ? setModelBudget(c, editing!.id, b) : setVehicleBudget(c, editing!.id, b)), L('预算已保存，下一次触发起生效', 'Budget saved; it applies from the next trigger')) !== undefined;
  return (
    <Space orientation="vertical" size={16} style={{ width: '100%' }}>
      <Card title={L('车型采集预算', 'Collection budget per vehicle model')}>
        <Hint>
          {L(
            'DCL 工程负责资源保护：每个车型一份预算，车端代理按滚动一小时核算 CPU、存储写入、上传与车端缓存，并限制单策略的触发次数（洪峰抑制）。高优先级（核心、售后）采集超预算仍然采集；其他采集超出 CPU、存储或缓存时不保留，超出上传时排队。合并时 DCL 按此预算检查每条策略。',
            'DCL engineering owns resource protection: one budget per vehicle model. The vehicle agent counts a rolling hour of CPU, storage writes, upload and its buffer, and limits each policy’s triggers (flood suppression). HIGH-priority (core, after-sales) captures are collected even over budget; others are dropped over CPU, storage or the buffer, and wait over upload. At merge DCL checks every policy against this budget.',
          )}
        </Hint>
        <Table
          rowKey="id"
          size="small"
          pagination={false}
          dataSource={models}
          columns={[
            { title: L('车型', 'Model'), render: (_, m) => <Mono>{m.id}</Mono> },
            {
              title: L('预算', 'Budget'),
              render: (_, m) => {
                const { budget, source } = modelBudget(state, m.id);
                return (
                  <Space size={4} wrap>
                    <BudgetLine budget={budget} />
                    <Tag>{B(BUDGET_SOURCE_LABELS[source]!)}</Tag>
                  </Space>
                );
              },
            },
            { title: '', render: (_, m) => canManage && <Button size="small" onClick={() => setEditing({ kind: 'model', id: m.id })}>{L('设置预算', 'Set budget')}</Button> },
          ]}
        />
      </Card>
      <Card
        title={`${L('车辆单独预算', 'Vehicle overrides')} · ${overrides.length}`}
        extra={
          canManage && (
            <Space>
              <Select
                style={{ width: 200 }}
                placeholder={L('选择车辆', 'Vehicle')}
                value={vehicleChoice}
                onChange={setVehicleChoice}
                options={Object.values(state.resources).filter((r) => !r.personal && !state.collectionBudgets.vehicles[r.id]).map((r) => ({ value: r.id, label: r.id }))}
              />
              <Button disabled={!vehicleChoice} onClick={() => setEditing({ kind: 'vehicle', id: vehicleChoice! })}>
                {L('单独设置', 'Set override')}
              </Button>
            </Space>
          )
        }
      >
        <Hint>{L('台架或测试车可以有自己的预算，代替车型预算。', 'A bench or test car can have its own budget instead of its model’s.')}</Hint>
        <Table
          rowKey={([id]) => id}
          size="small"
          pagination={false}
          dataSource={overrides}
          locale={{ emptyText: L('没有单独预算', 'No overrides') }}
          columns={[
            { title: L('车辆', 'Vehicle'), render: (_, [id]) => <Mono>{id}</Mono> },
            { title: L('预算', 'Budget'), render: (_, [, b]) => <BudgetLine budget={b} /> },
            {
              title: '',
              render: (_, [id]) =>
                canManage && (
                  <Space size={0}>
                    <Button type="link" size="small" onClick={() => setEditing({ kind: 'vehicle', id })}>
                      {L('修改', 'Edit')}
                    </Button>
                    <Button type="link" size="small" danger onClick={() => run((c) => setVehicleBudget(c, id, null), L('已改回车型预算', 'Back on the model budget'))}>
                      {L('清除', 'Clear')}
                    </Button>
                  </Space>
                ),
            },
          ]}
        />
      </Card>
      <Card title={L('车辆近一小时的采集', 'Each vehicle’s last hour')}>
        <Hint>{L('按平台时间（含模拟推进）滚动一小时。排队的采集在预算允许时由车端上传；未保留与洪峰抑制的采集没有数据，不进入数据查询。', 'A rolling hour on the platform clock (simulated time included). Waiting captures upload when the budget allows; dropped and suppressed captures carry no data and never reach the data query.')}</Hint>
        <Table
          rowKey="id"
          size="small"
          pagination={{ pageSize: 10, hideOnSinglePage: true }}
          dataSource={vehicles}
          columns={[
            {
              title: L('车辆', 'Vehicle'),
              render: (_, r) => (
                <Space size={4}>
                  <Mono>{r.id}</Mono>
                  <HoldTag resourceId={r.id} />
                </Space>
              ),
            },
            { title: L('预算来源', 'Budget'), render: (_, r) => B(BUDGET_SOURCE_LABELS[budgetOf(state, r.id).source]!) },
            { title: L('本小时', 'This hour'), render: (_, r) => <UsageMeter resourceId={r.id} /> },
            { title: '', render: (_, r) => <PauseButton resourceId={r.id} /> },
          ]}
        />
      </Card>
      {editing && initial && (
        <BudgetModal
          open
          title={editing.kind === 'model' ? L(`${editing.id} 车型预算`, `${editing.id} model budget`) : L(`${editing.id} 单独预算`, `${editing.id} override`)}
          initial={initial}
          onClose={() => setEditing(null)}
          onSave={save}
        />
      )}
    </Space>
  );
}
