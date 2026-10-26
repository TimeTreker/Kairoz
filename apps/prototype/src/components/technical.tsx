// DCL technical changes (技术变更): DCL's own branch of one business group that only changes
// processing bindings. The tag that marks them, and the list and form in the processing catalog.

import { PlusOutlined } from '@ant-design/icons';
import { Button, Card, Form, Input, Modal, Select, Table, Tag, Tooltip } from 'antd';
import { useState } from 'react';
import { useActor, useCan, useRun } from '../app/hooks.ts';
import { navigate } from '../app/router.ts';
import { setSession, useEngineState } from '../app/store.ts';
import { canReadFeature, createTechnicalChange, displayName, mainlineRelease } from '../engine/config.ts';
import { patchTargets } from '../engine/release.ts';
import type { Feature } from '../engine/types.ts';
import { useI18n } from '../i18n/i18n.tsx';
import { setName } from '../i18n/vocab.ts';
import { Hint, Mono, StageTag, when } from './common.tsx';
import { patchTargetLabel } from './patch.tsx';

export function TechnicalTag({ feature }: { feature: Pick<Feature, 'kind'> }) {
  const { L } = useI18n();
  if (feature.kind !== 'TECHNICAL') return null;
  return (
    <Tooltip title={L('DCL 工程自有的技术分支：只调整处理绑定，由本组测试验证后照常集成发布。', 'DCL engineering’s own branch: it only changes processing bindings, is verified by the group’s testers and integrated as usual.')}>
      <Tag color="geekblue">{L('DCL 技术变更', 'DCL technical change')}</Tag>
    </Tooltip>
  );
}

/** DCL's technical changes, and opening a new one on a group's team workspace. */
export function TechnicalChanges() {
  const state = useEngineState();
  const actor = useActor()!;
  const { L, B } = useI18n();
  const can = useCan();
  const run = useRun();
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<{ target: string; name: string; baseReleaseId: string; description?: string }>();
  // Where a technical change can live: a development group in a team workspace DCL may change.
  const targets = Object.values(state.workspaces)
    .filter((ws) => ws.kind === 'TEAM' && ws.status === 'ACTIVE')
    .flatMap((ws) =>
      ws.groupIds
        .map((g) => state.groups[g]!)
        .filter((g) => g && g.purpose === 'DEV' && g.status === 'ACTIVE' && can('technical.manage', { workspaceId: ws.id, groupId: g.id, scope: g.domain }))
        .map((g) => ({ value: `${ws.id}/${g.id}`, label: `${ws.name} · ${g.name} (${g.code})`, ws })),
    );
  const changes = Object.values(state.features)
    .filter((f) => f.kind === 'TECHNICAL' && canReadFeature(state, actor, f))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const chosen = Form.useWatch('target', form);
  const ws = chosen ? state.workspaces[chosen.split('/')[0]!] : undefined;
  const mainline = ws ? mainlineRelease(state, ws.vehicleModelId) : undefined;
  const older = ws ? patchTargets(state, ws.vehicleModelId) : [];
  const openFeature = (f: Feature) => {
    setSession({ workspaceId: f.workspaceId });
    navigate(`features/${f.id}`);
  };
  return (
    <Card
      title={`${L('DCL 技术变更', 'DCL technical changes')} · ${changes.length}`}
      extra={
        targets.length > 0 && (
          <Button icon={<PlusOutlined />} onClick={() => (form.resetFields(), setOpen(true))}>
            {L('新建技术变更', 'New technical change')}
          </Button>
        )
      }
    >
      <Hint>
        {L(
          'DCL 的技术修复（例如换用新的车端 / 云端处理版本）不能直接改已发布的策略集：在业务分组上开技术分支，只调整处理绑定，DCL 自己提交；由该组的测试先仿真后实车验证，再由配置集成合并、集成测试、配置发布。',
          'DCL’s technical fixes (say a new edge or cloud processing version) never change a released set directly: open a technical branch on the business group that only changes processing bindings and submit it yourself; the group’s testers verify it (simulation first), then integration merges, tests and releases it.',
        )}
      </Hint>
      <Table
        rowKey="id"
        size="small"
        pagination={{ pageSize: 10, hideOnSinglePage: true }}
        dataSource={changes}
        locale={{ emptyText: L('还没有技术变更', 'No technical changes yet') }}
        onRow={(f) => ({ onClick: () => openFeature(f), style: { cursor: 'pointer' } })}
        columns={[
          { title: L('名称', 'Name'), render: (_, f) => <Mono>{f.name}</Mono> },
          { title: L('业务分组', 'Group'), render: (_, f) => <Mono>{state.groups[f.groupId]?.code}</Mono> },
          { title: L('工作区', 'Workspace'), render: (_, f) => state.workspaces[f.workspaceId]?.name },
          { title: L('基线', 'Base'), render: (_, f) => (f.baseReleaseId ? B(setName(state.releases[f.baseReleaseId]!.dclVersion)) : L('无', 'none')) },
          { title: L('阶段', 'Stage'), render: (_, f) => <StageTag stage={f.stage} /> },
          { title: L('最新提交', 'Head commit'), render: (_, f) => (f.headCommitId ? <Mono>{displayName(state, f.headCommitId)}</Mono> : '—') },
          { title: L('更新', 'Updated'), render: (_, f) => when(f.updatedAt) },
        ]}
      />
      <Modal
        open={open}
        title={L('新建技术变更', 'New technical change')}
        onCancel={() => setOpen(false)}
        onOk={() =>
          form.validateFields().then((v) => {
            const [workspaceId, groupId] = v.target.split('/') as [string, string];
            const id = run((c) => createTechnicalChange(c, { workspaceId, groupId, name: v.name, description: v.description, baseReleaseId: v.baseReleaseId || null }), L('已新建技术变更，调整处理绑定后提交', 'Technical change opened; rebind and submit it'));
            if (id) {
              setOpen(false);
              setSession({ workspaceId });
              navigate(`features/${id}`);
            }
          })
        }
      >
        <Form form={form} layout="vertical" initialValues={{ baseReleaseId: '' }}>
          <Form.Item name="target" label={L('业务分组（所在团队工作区）', 'Business group (team workspace)')} rules={[{ required: true }]}>
            <Select options={targets.map((t) => ({ value: t.value, label: t.label }))} />
          </Form.Item>
          <Form.Item name="name" label={L('名称（小写字母、数字、_、-）', 'Name (lower-case letters, digits, _ or -)')} rules={[{ required: true, pattern: /^[a-z][a-z0-9_-]{2,45}$/ }]}>
            <Input placeholder="bin_log_edge_v2" />
          </Form.Item>
          {mainline && (
            <Form.Item name="baseReleaseId" label={L('基线', 'Base')}>
              <Select options={[{ value: '', label: L(`主线：策略集 ${mainline.dclVersion}`, `Mainline: policy set ${mainline.dclVersion}`) }, ...older.map((r) => ({ value: r.id, label: patchTargetLabel(state, r, L) }))]} />
            </Form.Item>
          )}
          <Form.Item name="description" label={L('说明', 'Description')}>
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
