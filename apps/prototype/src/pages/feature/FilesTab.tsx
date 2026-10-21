import { PlusOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Table, Tag, Typography } from 'antd';
import { useState } from 'react';
import { useCan, useRun } from '../../app/hooks.ts';
import { useEngineState } from '../../app/store.ts';
import { Hint, LabelTag, Mono } from '../../components/common.tsx';
import type { FileSpecContent } from '../../domain/config.ts';
import { FILE_TYPES, inferFileType, PRIVACY_LEVELS } from '../../domain/file-types.ts';
import { addFile, EDITABLE_STAGES, putReference, removeFile, removeReference, updateFile, visibleSuspects } from '../../engine/config.ts';
import { setBinding } from '../../engine/intake.ts';
import { referenceCatalog } from '../../engine/references.ts';
import { latestCommittedVersion } from '../../engine/snapshots.ts';
import type { Feature } from '../../engine/types.ts';
import { useI18n } from '../../i18n/i18n.tsx';
import { DATA_STATUS_LABELS, FILE_TYPE_LABELS } from '../../i18n/vocab.ts';

type FileForm = {
  unit: string;
  directory: string;
  pattern: string;
  name: string;
  purpose: string;
  fileType?: string;
  privacy?: string;
  retentionDays?: number;
  contentTags?: string[];
  priority?: string;
};

export function FilesTab({ feature }: { feature: Feature }) {
  const state = useEngineState();
  const { L, B } = useI18n();
  const can = useCan();
  const run = useRun();
  const group = state.groups[feature.groupId]!;
  const target = { workspaceId: feature.workspaceId, groupId: group.id, scope: group.domain };
  const editable = EDITABLE_STAGES.includes(feature.stage);
  const canEdit = editable && can('feature.edit', target);
  const canBind = editable && can('feature.editBinding', target);

  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [binding, setBindingKey] = useState<string | null>(null);
  const [referencing, setReferencing] = useState(false);
  const [form] = Form.useForm<FileForm>();
  const [bindForm] = Form.useForm();
  const pattern = Form.useWatch('pattern', form);

  const files = Object.entries(feature.draft.files);
  const references = Object.entries(feature.draft.references);
  const catalog = referenceCatalog(state, group.id).filter((c) => c.access === 'APPROVED' && !(c.dataKey in feature.draft.references));

  const openEdit = (key: string) => {
    const spec = feature.draft.files[key]!;
    form.setFieldsValue({
      unit: spec.source.unit,
      directory: spec.source.directory,
      pattern: spec.source.pattern,
      name: spec.name,
      purpose: spec.purpose,
      fileType: spec.fileType,
      privacy: spec.privacy,
      retentionDays: spec.retentionDays,
      contentTags: spec.contentTags,
      priority: spec.priority,
    });
    setEditing(key);
  };

  const saveFile = () =>
    form.validateFields().then((v) => {
      const attrs = {
        name: v.name,
        purpose: v.purpose,
        ...(v.fileType ? { fileType: v.fileType as FileSpecContent['fileType'] } : {}),
        ...(v.privacy ? { privacy: v.privacy as FileSpecContent['privacy'] } : {}),
        ...(v.retentionDays ? { retentionDays: v.retentionDays } : {}),
        ...(v.contentTags ? { contentTags: v.contentTags } : {}),
        ...(v.priority ? { priority: v.priority as FileSpecContent['priority'] } : {}),
      };
      const ok = editing
        ? run((c) => updateFile(c, feature.id, editing, attrs), L('已保存到草稿', 'Saved to draft'))
        : run((c) => addFile(c, feature.id, { ...attrs, source: { unit: v.unit, directory: v.directory, pattern: v.pattern } }), L('已加入草稿', 'Added to draft'));
      if (ok !== undefined) {
        setAdding(false);
        setEditing(null);
        form.resetFields();
      }
    });

  const openBinding = (key: string) => {
    const spec = feature.draft.files[key]!;
    bindForm.setFieldsValue({ format: spec.format, schema: spec.schema, edgePipelineId: spec.edgePipelineId, cloudPipelineId: spec.cloudPipelineId, reason: '' });
    setBindingKey(key);
  };
  const pipelines = Object.values(state.pipelines);

  return (
    <Space orientation="vertical" size={16} style={{ width: '100%' }}>
      <Card
        title={L('本组文件列表', 'Own file list')}
        extra={
          canEdit && (
            <Button icon={<PlusOutlined />} onClick={() => (form.resetFields(), setAdding(true))}>
              {L('添加文件', 'Add file')}
            </Button>
          )
        }
      >
        <Hint>{L('业务方填写来源、用途与敏感信息；平台生成稳定的 data_key，并按文件类型固定 DCL 发布的车端 / 云端处理绑定。', 'The business enters source, purpose and sensitivity; the platform generates a stable data_key and fixes the Edge/Cloud binding DCL published for the file type.')}</Hint>
        <Table
          rowKey={([k]) => k}
          dataSource={files}
          pagination={false}
          scroll={{ x: 1100 }}
          locale={{ emptyText: L('草稿中还没有文件', 'No files in the draft yet') }}
          columns={[
            {
              title: L('文件', 'File'),
              render: (_, [key, spec]) => {
                const item = state.dataItems[key];
                const suspects = item ? visibleSuspects(state, group.id, item.overlapSuspects) : null;
                return (
                  <div>
                    <Typography.Text strong>{spec.name}</Typography.Text>
                    <div>
                      <Mono>{item?.dataCode}</Mono>
                    </div>
                    <Space size={4} wrap>
                      {item && <LabelTag map={DATA_STATUS_LABELS} value={item.status} color={item.status === 'REVIEW' ? 'orange' : item.status === 'ACTIVE' ? 'green' : 'default'} />}
                      {suspects?.overlapsOtherGroups && <Tag color="orange">{L('与其他分组来源重叠', 'Overlaps another group')}</Tag>}
                    </Space>
                  </div>
                );
              },
            },
            { title: L('来源', 'Source'), render: (_, [, spec]) => <Mono>{`${spec.source.unit}:${spec.source.directory}/${spec.source.pattern}`}</Mono> },
            { title: L('类型', 'Type'), render: (_, [, spec]) => B(FILE_TYPE_LABELS[spec.fileType]) },
            { title: L('隐私 / 保留', 'Privacy / retention'), render: (_, [, spec]) => `${spec.privacy} · ${spec.retentionDays}${L(' 天', 'd')}` },
            {
              title: L('敏感审核', 'Review'),
              render: (_, [, spec]) => (spec.requiresReview ? <Tag color="volcano">{L('需审核', 'Required')}</Tag> : <Tag>{L('不需要', 'No')}</Tag>),
            },
            {
              title: L('处理绑定', 'Binding'),
              render: (_, [, spec]) => (
                <div>
                  <div>
                    <Typography.Text type="secondary">Edge </Typography.Text>
                    <Mono>{spec.edgePipelineId}</Mono>
                  </div>
                  <div>
                    <Typography.Text type="secondary">Cloud </Typography.Text>
                    <Mono>{spec.cloudPipelineId}</Mono>
                  </div>
                </div>
              ),
            },
            {
              title: '',
              fixed: 'right',
              render: (_, [key]) => (
                <Space size={0}>
                  {canEdit && (
                    <Button type="link" size="small" onClick={() => openEdit(key)}>
                      {L('编辑', 'Edit')}
                    </Button>
                  )}
                  {canEdit && (
                    <Popconfirm title={L('从草稿移除该文件？', 'Remove this file from the draft?')} onConfirm={() => run((c) => removeFile(c, feature.id, key), L('已移除', 'Removed'))}>
                      <Button type="link" size="small" danger>
                        {L('移除', 'Remove')}
                      </Button>
                    </Popconfirm>
                  )}
                  {canBind && (
                    <Button type="link" size="small" onClick={() => openBinding(key)}>
                      {L('调整绑定', 'Binding')}
                    </Button>
                  )}
                </Space>
              ),
            },
          ]}
        />
      </Card>

      <Card
        title={L('只读引用（其他分组的文件）', 'Read-only references (other groups’ files)')}
        extra={
          canEdit && (
            <Button icon={<PlusOutlined />} onClick={() => setReferencing(true)} disabled={catalog.length === 0}>
              {L('添加引用', 'Add reference')}
            </Button>
          )
        }
      >
        <Hint>{L('引用固定对方当前已提交的定义版本；对方之后修改不影响本引用，可手动更新。定义仍由所属分组维护。', 'A reference pins the owner’s current committed definition; later owner changes do not move it until you re-pin. The owner keeps the definition.')}</Hint>
        <Table
          rowKey={([k]) => k}
          dataSource={references}
          pagination={false}
          locale={{ emptyText: L('没有引用', 'No references') }}
          columns={[
            {
              title: L('文件', 'File'),
              render: (_, [key, versionId]) => (
                <div>
                  <Typography.Text strong>{state.fileSpecVersions[versionId]?.content.name}</Typography.Text>
                  <div>
                    <Mono>{state.dataItems[key]?.dataCode}</Mono>
                  </div>
                </div>
              ),
            },
            { title: L('所属分组', 'Owner'), render: (_, [key]) => state.groups[state.dataItems[key]?.ownerGroupId ?? '']?.name },
            {
              title: L('固定版本', 'Pinned version'),
              render: (_, [key, versionId]) => {
                const pinned = state.fileSpecVersions[versionId];
                const latest = latestCommittedVersion(state, key);
                return (
                  <Space>
                    <span>v{pinned?.version}</span>
                    {latest && latest.id !== versionId && <Tag color="blue">{L(`对方当前 v${latest.version}`, `owner now v${latest.version}`)}</Tag>}
                  </Space>
                );
              },
            },
            {
              title: '',
              render: (_, [key, versionId]) => {
                const latest = latestCommittedVersion(state, key);
                return (
                  canEdit && (
                    <Space size={0}>
                      {latest && latest.id !== versionId && (
                        <Button type="link" size="small" onClick={() => run((c) => putReference(c, feature.id, key), L('已更新引用', 'Re-pinned'))}>
                          {L('更新到当前版本', 'Re-pin')}
                        </Button>
                      )}
                      <Button type="link" size="small" danger onClick={() => run((c) => removeReference(c, feature.id, key), L('已移除', 'Removed'))}>
                        {L('移除', 'Remove')}
                      </Button>
                    </Space>
                  )
                );
              },
            },
          ]}
        />
      </Card>

      <Modal
        open={adding || editing !== null}
        width={640}
        title={editing ? L('编辑文件', 'Edit file') : L('添加文件', 'Add file')}
        onCancel={() => (setAdding(false), setEditing(null))}
        onOk={saveFile}
        okText={L('保存到草稿', 'Save to draft')}
      >
        <Form form={form} name="file" layout="vertical">
          <Space.Compact block>
            <Form.Item name="unit" label={L('域控', 'Unit')} rules={[{ required: true }]} style={{ width: '25%' }}>
              <Input placeholder="ADC" disabled={!!editing} />
            </Form.Item>
            <Form.Item name="directory" label={L('目录', 'Directory')} rules={[{ required: true }]} style={{ width: '45%' }}>
              <Input placeholder="/var/log/brake" disabled={!!editing} />
            </Form.Item>
            <Form.Item name="pattern" label={L('文件匹配规则', 'File pattern')} rules={[{ required: true }]} style={{ width: '30%' }}>
              <Input placeholder="brake_*.pb" disabled={!!editing} />
            </Form.Item>
          </Space.Compact>
          <Form.Item name="name" label={L('数据名称', 'Data name')} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="purpose" label={L('用途', 'Purpose')} rules={[{ required: true }]}>
            <Input.TextArea rows={2} />
          </Form.Item>
          <Space wrap>
            <Form.Item name="fileType" label={L('文件类型（留空自动识别）', 'File type (blank: inferred)')}>
              <Select
                allowClear
                style={{ width: 220 }}
                placeholder={pattern ? B(FILE_TYPE_LABELS[inferFileType(pattern)]) : ''}
                options={FILE_TYPES.map((t) => ({ value: t, label: B(FILE_TYPE_LABELS[t]) }))}
              />
            </Form.Item>
            <Form.Item name="privacy" label={L('隐私等级', 'Privacy')}>
              <Select allowClear style={{ width: 120 }} options={PRIVACY_LEVELS.map((p) => ({ value: p, label: p }))} />
            </Form.Item>
            <Form.Item name="retentionDays" label={L('保留天数', 'Retention (days)')}>
              <InputNumber min={1} max={3650} />
            </Form.Item>
            <Form.Item name="priority" label={L('优先级', 'Priority')}>
              <Select allowClear style={{ width: 120 }} options={['LOW', 'NORMAL', 'HIGH'].map((p) => ({ value: p, label: p }))} />
            </Form.Item>
          </Space>
          <Form.Item name="contentTags" label={L('内容标签（location / identity / image / voice / sensitive 会触发审核）', 'Content tags (location / identity / image / voice / sensitive require review)')}>
            <Select mode="tags" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={binding !== null}
        title={L('调整处理绑定（DCL 工程）', 'Adjust processing binding (DCL)')}
        onCancel={() => setBindingKey(null)}
        onOk={() =>
          bindForm.validateFields().then((v) => {
            if (run((c) => setBinding(c, feature.id, binding!, v), L('已调整，Feature 回到草稿', 'Changed; the Feature is back in Draft')) !== undefined) setBindingKey(null);
          })
        }
      >
        <Alert type="info" showIcon style={{ marginBottom: 12 }} message={L('调整后 Feature 回到草稿，由业务方重新提交。', 'The Feature returns to Draft and the business resubmits.')} />
        <Form form={bindForm} name="binding" layout="vertical">
          <Space>
            <Form.Item name="format" label="Format" rules={[{ required: true }]}>
              <Input />
            </Form.Item>
            <Form.Item name="schema" label="Schema" rules={[{ required: true }]}>
              <Input />
            </Form.Item>
          </Space>
          <Form.Item name="edgePipelineId" label={L('车端处理', 'Edge pipeline')} rules={[{ required: true }]}>
            <Select options={pipelines.filter((p) => p.side === 'EDGE').map((p) => ({ value: p.id, label: `${p.id} · ${p.formats.join(',')}` }))} />
          </Form.Item>
          <Form.Item name="cloudPipelineId" label={L('云端处理', 'Cloud pipeline')} rules={[{ required: true }]}>
            <Select options={pipelines.filter((p) => p.side === 'CLOUD').map((p) => ({ value: p.id, label: `${p.id} · ${p.formats.join(',')} · ${p.capability}` }))} />
          </Form.Item>
          <Form.Item name="reason" label={L('原因（会作为反馈给业务方）', 'Reason (sent to the authors)')} rules={[{ required: true }]}>
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal open={referencing} title={L('添加只读引用', 'Add a read-only reference')} footer={null} onCancel={() => setReferencing(false)}>
        <Hint>{L('只列出已获授权的数据。在“数据目录与引用”中申请其他数据。', 'Only granted data is listed. Request other data under “Data & references”.')}</Hint>
        <Table
          rowKey="dataKey"
          size="small"
          pagination={false}
          dataSource={catalog}
          columns={[
            { title: L('名称', 'Name'), dataIndex: 'name' },
            { title: L('所属分组', 'Owner'), render: (_, c) => state.groups[c.ownerGroupId]?.name },
            { title: L('版本', 'Version'), render: (_, c) => `v${c.latestVersion}` },
            {
              title: '',
              render: (_, c) => (
                <Button
                  size="small"
                  type="primary"
                  onClick={() => {
                    if (run((ctx) => putReference(ctx, feature.id, c.dataKey), L('已引用', 'Referenced')) !== undefined) setReferencing(false);
                  }}
                >
                  {L('引用', 'Reference')}
                </Button>
              ),
            },
          ]}
        />
      </Modal>
    </Space>
  );
}
