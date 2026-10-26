import { PlusOutlined } from '@ant-design/icons';
import { Button, Card, Form, Input, Modal, Select, Table, Typography } from 'antd';
import { useState } from 'react';
import { useActor, useCan, useRun, useWorkspace } from '../app/hooks.ts';
import { navigate } from '../app/router.ts';
import { useEngineState } from '../app/store.ts';
import { Hint, Mono, PageHeader, StageTag, when } from '../components/common.tsx';
import { PatchedTag, patchTargetLabel } from '../components/patch.tsx';
import { createFeature, displayName, mainlineRelease, visibleFeatures } from '../engine/config.ts';
import { patchTargets } from '../engine/release.ts';
import { useI18n } from '../i18n/i18n.tsx';

export function FeaturesPage() {
  const state = useEngineState();
  const actor = useActor()!;
  const { workspace } = useWorkspace();
  const { L } = useI18n();
  const can = useCan();
  const run = useRun();
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();

  if (!workspace) return <div className="kz-page">{L('没有可用工作区', 'No workspace available')}</div>;
  const features = visibleFeatures(state, actor, workspace.id);
  const base = mainlineRelease(state, workspace.vehicleModelId);
  // Besides the mainline, a Feature may start on an older set some software still runs (a fix for a patch).
  const olderBases = patchTargets(state, workspace.vehicleModelId);
  const creatable = workspace.groupIds
    .map((g) => state.groups[g]!)
    .filter((g) => g.purpose === 'DEV' && can('feature.create', { workspaceId: workspace.id, groupId: g.id, scope: g.domain }));

  return (
    <div className="kz-page">
      <PageHeader
        title={L('研发 Feature', 'Features')}
        subtitle={L('Feature 维护本组的文件列表与采集策略；提交产生不可变版本，测试与集成都固定在提交上。', 'A Feature maintains the group’s file list and policies; submits create immutable versions that tests and integration pin to.')}
        extra={
          creatable.length > 0 && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
              {L('创建 Feature', 'New Feature')}
            </Button>
          )
        }
      />
      <Card>
        <Table
          rowKey="id"
          dataSource={features}
          pagination={{ pageSize: 20, hideOnSinglePage: true }}
          onRow={(f) => ({ onClick: () => navigate(`features/${f.id}`), style: { cursor: 'pointer' } })}
          locale={{ emptyText: L('本工作区暂无可见的 Feature', 'No visible Features in this workspace') }}
          columns={[
            { title: L('名称', 'Name'), render: (_, f) => <Mono>{f.name}</Mono> },
            { title: L('业务分组', 'Group'), render: (_, f) => state.groups[f.groupId]?.name },
            {
              title: L('阶段', 'Stage'),
              render: (_, f) => (
                <>
                  <StageTag stage={f.stage} />
                  <PatchedTag feature={f} />
                </>
              ),
            },
            {
              title: L('最新提交', 'Head commit'),
              render: (_, f) => (f.headCommitId ? <Mono>{displayName(state, f.headCommitId)}</Mono> : <Typography.Text type="secondary">{L('未提交', 'Not submitted')}</Typography.Text>),
            },
            {
              title: L('文件 / 引用 / 策略', 'Files / refs / policies'),
              render: (_, f) => `${Object.keys(f.draft.files).length} / ${Object.keys(f.draft.references).length} / ${Object.keys(f.draft.policies).length}`,
            },
            { title: L('更新时间', 'Updated'), render: (_, f) => when(f.updatedAt) },
          ]}
        />
      </Card>
      <Modal
        open={open}
        title={L('创建 Feature', 'New Feature')}
        onCancel={() => setOpen(false)}
        onOk={() =>
          form.validateFields().then((v) => {
            const id = run((c) => createFeature(c, { workspaceId: workspace.id, groupId: v.groupId, name: v.name, description: v.description, baseReleaseId: v.baseReleaseId || null }), L('已创建', 'Created'));
            if (id) {
              setOpen(false);
              form.resetFields();
              navigate(`features/${id}`);
            }
          })
        }
      >
        <Hint>
          {base
            ? L(`新 Feature 默认基于 ${workspace.vehicleModelId} 的主线策略集 ${base.dclVersion}，继承其中本分组的文件与策略。修复某个软件版本仍在用的旧策略集时，选它作为基线，之后由配置集成做同软件版本补丁。`, `A new Feature builds on ${workspace.vehicleModelId}’s mainline policy set, ${base.dclVersion}, by default and inherits the group’s files and policies from it. To fix an older set some software still runs, start on that set; integration then makes a same-software patch.`)
            : L('新 Feature 从本车型的初始研发配置开始（尚无策略集，为空）。', 'A new Feature starts from the vehicle model’s initial development configuration (no policy set yet, so it is empty).')}
        </Hint>
        <Form form={form} name="feature" layout="vertical" initialValues={{ groupId: creatable[0]?.id, baseReleaseId: '' }}>
          <Form.Item name="groupId" label={L('业务分组', 'Business group')} rules={[{ required: true }]}>
            <Select options={creatable.map((g) => ({ value: g.id, label: `${g.name} (${g.code})` }))} />
          </Form.Item>
          {base && olderBases.length > 0 && (
            <Form.Item name="baseReleaseId" label={L('基线', 'Base')}>
              <Select
                options={[
                  { value: '', label: L(`主线：策略集 ${base.dclVersion}`, `Mainline: policy set ${base.dclVersion}`) },
                  ...olderBases.map((r) => ({ value: r.id, label: patchTargetLabel(state, r, L) })),
                ]}
              />
            </Form.Item>
          )}
          <Form.Item name="name" label={L('名称（小写字母、数字、_、-）', 'Name (lower-case letters, digits, _ or -)')} rules={[{ required: true, pattern: /^[a-z][a-z0-9_-]{2,45}$/ }]}>
            <Input placeholder="guided_brake_v2" />
          </Form.Item>
          <Form.Item name="description" label={L('说明', 'Description')}>
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
