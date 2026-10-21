import { PlusOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Table, Tag, Typography } from 'antd';
import { useState } from 'react';
import { useCan, useRun } from '../../app/hooks.ts';
import { useEngineState } from '../../app/store.ts';
import { Hint, Mono } from '../../components/common.tsx';
import { MAX_CAPTURE_WINDOW_SECONDS } from '../../domain/config.ts';
import { parseTrigger } from '../../domain/trigger.ts';
import { EDITABLE_STAGES, putPolicy, removePolicy } from '../../engine/config.ts';
import { resolveFiles } from '../../engine/snapshots.ts';
import type { Feature } from '../../engine/types.ts';
import { useI18n } from '../../i18n/i18n.tsx';

export function PoliciesTab({ feature }: { feature: Feature }) {
  const state = useEngineState();
  const { L } = useI18n();
  const can = useCan();
  const run = useRun();
  const group = state.groups[feature.groupId]!;
  const canEdit = EDITABLE_STAGES.includes(feature.stage) && can('feature.edit', { workspaceId: feature.workspaceId, groupId: group.id, scope: group.domain });
  const [editing, setEditing] = useState<string | null | 'new'>(null);
  const [form] = Form.useForm();
  const trigger: string = Form.useWatch('trigger', form) ?? '';
  const parsed = trigger ? parseTrigger(trigger) : null;

  const files = resolveFiles(state, feature.draft);
  const nameOf = (key: string) => files[key]?.name ?? key;
  const policies = Object.entries(feature.draft.policies);
  const prefix = `${group.code}.`;

  const open = (policyId: string | 'new') => {
    if (policyId === 'new') form.setFieldsValue({ suffix: '', name: '', trigger: '', captures: [], preSeconds: 10, postSeconds: 20, priority: 'NORMAL' });
    else {
      const p = feature.draft.policies[policyId]!;
      form.setFieldsValue({ suffix: policyId.slice(prefix.length), ...p });
    }
    setEditing(policyId);
  };

  return (
    <Card
      title={L('业务采集策略', 'Collection policies')}
      extra={
        canEdit && (
          <Button icon={<PlusOutlined />} onClick={() => open('new')} disabled={Object.keys(files).length === 0}>
            {L('添加策略', 'Add policy')}
          </Button>
        )
      }
    >
      <Hint>
        {L(
          `策略在触发条件满足时采集所选文件，前后窗口合计不超过 ${MAX_CAPTURE_WINDOW_SECONDS} 秒。策略 ID 以本组代码 ${prefix} 开头。`,
          `A policy captures the selected files when its trigger fires; the window before and after is at most ${MAX_CAPTURE_WINDOW_SECONDS} s in total. Policy ids start with the group code prefix ${prefix}`,
        )}
      </Hint>
      <Table
        rowKey={([id]) => id}
        dataSource={policies}
        pagination={false}
        locale={{ emptyText: L('还没有策略', 'No policies yet') }}
        columns={[
          { title: 'ID', render: (_, [id]) => <Mono>{id}</Mono> },
          { title: L('名称', 'Name'), render: (_, [, p]) => p.name },
          { title: L('触发条件', 'Trigger'), render: (_, [, p]) => <Mono>{p.trigger}</Mono> },
          { title: L('采集文件', 'Captures'), render: (_, [, p]) => p.captures.map((k) => <Tag key={k}>{nameOf(k)}</Tag>) },
          { title: L('窗口（前 / 后）', 'Window (pre / post)'), render: (_, [, p]) => `${p.preSeconds}s / ${p.postSeconds}s` },
          {
            title: '',
            render: (_, [id]) =>
              canEdit && (
                <Space size={0}>
                  <Button type="link" size="small" onClick={() => open(id)}>
                    {L('编辑', 'Edit')}
                  </Button>
                  <Popconfirm title={L('删除该策略？', 'Delete this policy?')} onConfirm={() => run((c) => removePolicy(c, feature.id, id), L('已删除', 'Deleted'))}>
                    <Button type="link" size="small" danger>
                      {L('删除', 'Delete')}
                    </Button>
                  </Popconfirm>
                </Space>
              ),
          },
        ]}
      />
      <Modal
        open={editing !== null}
        width={620}
        title={editing === 'new' ? L('添加策略', 'Add policy') : L('编辑策略', 'Edit policy')}
        okText={L('保存到草稿', 'Save to draft')}
        onCancel={() => setEditing(null)}
        onOk={() =>
          form.validateFields().then((v) => {
            const id = editing === 'new' ? `${prefix}${v.suffix}` : editing!;
            const ok = run(
              (c) => putPolicy(c, feature.id, id, { name: v.name, trigger: v.trigger, captures: v.captures, preSeconds: v.preSeconds, postSeconds: v.postSeconds, priority: v.priority }),
              L('已保存到草稿', 'Saved to draft'),
            );
            if (ok !== undefined) setEditing(null);
          })
        }
      >
        <Form form={form} name="policy" layout="vertical">
          <Form.Item label={L('策略 ID', 'Policy id')} required>
            <Space.Compact style={{ width: '100%' }}>
              <Space.Addon>{prefix}</Space.Addon>
              <Form.Item
                name="suffix"
                noStyle
                rules={[
                  { required: true, message: L('请填写策略 ID', 'Enter the policy id') },
                  { pattern: /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/, message: L('小写字母、数字和下划线，以点分段', 'Lowercase letters, digits and underscores, in dot-separated parts') },
                ]}
              >
                <Input disabled={editing !== 'new'} placeholder="hard_braking" />
              </Form.Item>
            </Space.Compact>
          </Form.Item>
          <Form.Item name="name" label={L('名称', 'Name')} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item
            name="trigger"
            label={L('触发条件', 'Trigger')}
            rules={[{ required: true }]}
            extra={L('支持比较（> >= < <= == !=）、AND / OR / NOT 与括号，例如 brake_pressure > 80 AND vehicle_speed > 30', 'Comparisons (> >= < <= == !=), AND / OR / NOT and parentheses, e.g. brake_pressure > 80 AND vehicle_speed > 30')}
          >
            <Input.TextArea rows={2} className="kz-mono" />
          </Form.Item>
          {parsed && (
            <Alert
              style={{ marginBottom: 12 }}
              type={parsed.ok ? 'success' : 'error'}
              showIcon
              title={
                parsed.ok
                  ? `${L('信号', 'Signals')}: ${parsed.signals.join(', ')}`
                  : `${parsed.error.message} @ ${parsed.error.position}`
              }
            />
          )}
          <Form.Item name="captures" label={L('采集文件', 'Captured files')} rules={[{ required: true }]}>
            <Select mode="multiple" options={Object.keys(files).map((k) => ({ value: k, label: nameOf(k) + (k in feature.draft.references ? L('（引用）', ' (reference)') : '') }))} />
          </Form.Item>
          <Space>
            <Form.Item name="preSeconds" label={L('触发前（秒）', 'Before (s)')} rules={[{ required: true }]}>
              <InputNumber min={0} max={MAX_CAPTURE_WINDOW_SECONDS} />
            </Form.Item>
            <Form.Item name="postSeconds" label={L('触发后（秒）', 'After (s)')} rules={[{ required: true }]}>
              <InputNumber min={0} max={MAX_CAPTURE_WINDOW_SECONDS} />
            </Form.Item>
            <Form.Item name="priority" label={L('优先级', 'Priority')}>
              <Select style={{ width: 120 }} options={['LOW', 'NORMAL', 'HIGH'].map((p) => ({ value: p, label: p }))} />
            </Form.Item>
          </Space>
          <Typography.Text type="secondary">{L('保存只更新草稿，不产生版本；提交时才生成不可变版本。', 'Saving only updates the draft; immutable versions are created on submit.')}</Typography.Text>
        </Form>
      </Modal>
    </Card>
  );
}
