// A vehicle's whole-vehicle software change and what it means for its group's configuration:
// the base, the files and the policies that depend on them, with the next step for each outcome.
// The platform never creates a branch or publishes by itself; the team decides here.

import { Alert, Button, Card, Descriptions, Drawer, Input, Modal, Space, Table, Tag, Typography } from 'antd';
import { useState } from 'react';
import { useCan, useRun } from '../app/hooks.ts';
import { navigate } from '../app/router.ts';
import { useEngineState } from '../app/store.ts';
import { diffConfig } from '../domain/config.ts';
import { baseConfig, createFeature } from '../engine/config.ts';
import { acknowledgeSoftwareChange, assessSoftwareChange, softwareChangeTarget } from '../engine/software-change.ts';
import { commitSnapshot, resolveFiles } from '../engine/snapshots.ts';
import type { State } from '../engine/types.ts';
import { useI18n } from '../i18n/i18n.tsx';
import { issueLabel } from '../i18n/issues.ts';
import { CHANGE_OUTCOME_COLORS, CHANGE_OUTCOME_LABELS, FILE_CHECK_LABELS, POLICY_CHECK_LABELS, SOFTWARE_SOURCE_LABELS, setName } from '../i18n/vocab.ts';
import { DiffView } from './DiffView.tsx';
import { Hint, Mono, when } from './common.tsx';

function baseName(s: State, id: string | null, L: (zh: string, en: string) => string, B: (b: { zh: string; en: string }) => string): string {
  return id ? B(setName(s.releases[id]?.dclVersion ?? id)) : L('初始研发配置', 'Initial configuration');
}

/** The tag for a change's outcome, as rows and lists show it. */
export function OutcomeTag({ changeId }: { changeId: string }) {
  const state = useEngineState();
  const { B } = useI18n();
  const outcome = assessSoftwareChange(state, changeId).outcome;
  return <Tag color={CHANGE_OUTCOME_COLORS[outcome]}>{B(CHANGE_OUTCOME_LABELS[outcome])}</Tag>;
}

export function SoftwareChangeDrawer({ changeId, onClose }: { changeId: string | null; onClose: () => void }) {
  const state = useEngineState();
  const can = useCan();
  const run = useRun();
  const { L, B } = useI18n();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  if (!changeId || !state.softwareChanges[changeId]) return <Drawer open={false} onClose={onClose} />;
  const a = assessSoftwareChange(state, changeId);
  const c = a.change;
  const r = state.resources[c.resourceId]!;
  const feature = a.featureId ? state.features[a.featureId] : undefined;
  const target = softwareChangeTarget(state, c);
  const canAct = !!target && can('feature.dispatch', target);
  const canCreate = !!feature && can('feature.create', { workspaceId: feature.workspaceId, groupId: feature.groupId });
  const explain: Record<string, string> = {
    NONE: L('新旧版本使用同一个策略集，本组文件与策略在新软件上都可运行。确认即可，不需要新建分支或重新下发；车上的测试结果继续有效。', 'Both versions use the same policy set and the group’s files and policies all run on the new software. Just confirm: no new branch and no republish; the vehicle’s test results still count.'),
    FIX: L('本组有文件或策略在新软件上不可用。请在原 Feature 中先改文件、再改依赖它的策略，提交后下发到车辆组并重新测试。', 'Some of the group’s files or policies do not work on the new software. In the Feature, fix the files first and then the policies that depend on them; commit, publish to the group and test again.'),
    REPUBLISH: L('新软件对应另一个策略集，但没有改动本组内容。请重新下发同一提交；车辆运行的组合变了，需要重新测试。', 'The new software takes another policy set that leaves the group’s content alone. Publish the same commit again; the combination changed, so test again.'),
    NEW_FEATURE: a.integrated
      ? L('新软件对应的策略集改动了本组内容。本 Feature 已集成；后续修改请在新基线上新建 Feature。', 'The new software’s policy set changed this group. This Feature is already integrated; make further changes in a Feature on the new base.')
      : L('新软件对应的策略集改动了本组内容。请在新基线上新建 Feature，按下方列出的本 Feature 的修改重做，再提交、下发和测试。', 'The new software’s policy set changed this group. Start a Feature on the new base, redo this Feature’s changes listed below, then commit, publish and test.'),
    NO_BASE: L('新软件还没有适用的策略集。等待适用性确认，或由工作区管理员为车辆组指定显式基线；车辆保持已生效配置。', 'No policy set applies to the new software yet. Wait for the applicability check, or have the workspace admin give the group an explicit base; the vehicle keeps its applied configuration.'),
    CANNOT_CHECK: L('新软件没有登记软件清单，无法逐条检查；请车辆资源补录清单。', 'The new software has no recorded manifest, so nothing can be checked; ask vehicle resources to record it.'),
    PRODUCTION: L('量产车没有 Feature：按新软件版本当前适用的策略集运行，没有适用策略集时由配置发布处理。', 'Production cars run no Features: they take the set in effect for the new software, and config release handles versions without one.'),
    NOT_PUBLISHED: L('车辆组没有发布 Feature，没有需要检查的本组内容。', 'Nothing is published to the vehicle’s group, so there is nothing of a team to check.'),
    UNRECORDED: L('车辆上报的版本平台尚未登记；车辆资源登记该版本并确认后再检查。', 'The platform has not recorded the reported version; vehicle resources record and confirm it first.'),
  };
  const before = feature ? baseConfig(state, feature) : null;
  const after = feature && a.commitId ? commitSnapshot(state, a.commitId) : null;
  const changes = before && after ? diffConfig(before, after) : null;
  const names = { ...(before ? resolveFiles(state, before) : {}), ...(after ? resolveFiles(state, after) : {}) };
  const fileName = (k: string) => names[k]?.name ?? state.dataItems[k]?.dataCode ?? k;

  return (
    <Drawer open size={820} title={`${L('整车软件版本变化', 'Vehicle software change')} · ${r.id}`} onClose={onClose}
      extra={
        canAct && !c.acknowledgedBy && c.status === 'APPLIED' && (
          <Button type="primary" onClick={() => run((x) => acknowledgeSoftwareChange(x, c.id), L('已确认', 'Confirmed'))}>
            {L('确认', 'Confirm')}
          </Button>
        )
      }
    >
      <Space orientation="vertical" size={16} style={{ width: '100%' }}>
        <Descriptions size="small" column={{ xs: 1, sm: 1, md: 2 }} bordered>
          <Descriptions.Item label={L('版本', 'Version')}>
            <Mono>{`${c.fromVersion ?? '—'} → ${c.toVersion}`}</Mono>
          </Descriptions.Item>
          <Descriptions.Item label={L('来源', 'Source')}>
            {B(SOFTWARE_SOURCE_LABELS[c.source])} · {when(c.at)}
          </Descriptions.Item>
          <Descriptions.Item label={L('车辆组', 'Vehicle group')}>{a.vehicleGroupId ? state.vehicleGroups[a.vehicleGroupId]?.name : '—'}</Descriptions.Item>
          <Descriptions.Item label={L('发布的 Feature', 'Published Feature')}>{feature ? `${feature.name} · r${String(state.commits[a.commitId!]?.sequence ?? 0).padStart(3, '0')}` : '—'}</Descriptions.Item>
          <Descriptions.Item label={L('确认', 'Confirmed')} span="filled">
            {c.acknowledgedBy ? `${state.accounts[c.acknowledgedBy]?.displayName ?? c.acknowledgedBy} · ${when(c.acknowledgedAt)}` : L('未确认', 'Not yet')}
          </Descriptions.Item>
        </Descriptions>

        <Alert type={a.outcome === 'NONE' ? 'success' : ['FIX', 'REPUBLISH', 'CANNOT_CHECK'].includes(a.outcome) ? 'warning' : ['NEW_FEATURE', 'NO_BASE'].includes(a.outcome) ? 'error' : 'info'} showIcon title={B(CHANGE_OUTCOME_LABELS[a.outcome])} description={explain[a.outcome]}
          action={
            feature && (
              <Space orientation="vertical">
                {(a.outcome === 'FIX' || a.outcome === 'REPUBLISH') && (
                  <Button size="small" onClick={() => navigate(`features/${feature.id}`)}>
                    {a.outcome === 'FIX' ? L('打开 Feature', 'Open the Feature') : L('去重新下发', 'Publish again')}
                  </Button>
                )}
                {a.outcome === 'NEW_FEATURE' && canCreate && a.newBaseId && (
                  <Button size="small" type="primary" onClick={() => (setName(`${feature.name}_v2`), setNaming(true))}>
                    {L('在新基线上新建 Feature', 'Start a Feature on the new base')}
                  </Button>
                )}
              </Space>
            )
          }
        />

        {a.vehicleGroupId && feature && (
          <>
            <Card size="small" title={L('基线', 'Base')}>
              <Space orientation="vertical">
                <span>
                  {L('车上配置的基线', 'Base the vehicle runs')}
                  {L('：', ': ')}
                  {baseName(state, a.runningBaseId, L, B)} → {L('新软件对应的基线', 'base for the new software')}
                  {L('：', ': ')}
                  {a.baseProblem ? <Typography.Text type="danger"> {B(issueLabel(a.baseProblem), a.baseProblem)}</Typography.Text> : ` ${baseName(state, a.newBaseId, L, B)}`}
                </span>
                {a.baseChanged && a.changedGroups.length > 0 && (
                  <span>
                    {L('有变化的业务分组', 'Groups that changed')}
                    {L('：', ': ')}
                    {a.changedGroups.map((g) => <Tag key={g}>{g}</Tag>)}
                  </span>
                )}
              </Space>
            </Card>

            <Card size="small" title={L('文件（第一层）', 'Files (level 1)')}>
              <Hint>{L('检查本组文件与引用文件：新软件是否仍提供它的来源目录；引用的其他分组文件在新基线中是否变化。', 'Checks the group’s own and referenced files: does the new software still provide each source directory, and did a referenced file of another group change in the new base?')}</Hint>
              <Table
                rowKey="dataKey"
                size="small"
                pagination={false}
                dataSource={a.files}
                scroll={{ x: 'max-content' }}
                columns={[
                  { title: L('文件', 'File'), render: (_, f) => f.name },
                  { title: L('类型', 'Kind'), render: (_, f) => (f.owned ? L('本组', 'Own') : L('引用', 'Reference')) },
                  { title: L('来源', 'Source'), render: (_, f) => <Mono>{f.source}</Mono> },
                  { title: L('状态', 'Status'), render: (_, f) => <Tag color={f.status === 'OK' ? 'green' : 'red'}>{B(FILE_CHECK_LABELS[f.status])}</Tag> },
                ]}
              />
            </Card>

            <Card size="small" title={L('策略（第二层）', 'Policies (level 2)')}>
              <Hint>{L('检查每条策略的触发信号是否仍在新软件中，以及它采集的文件在第一层是否有问题。', 'Checks each policy: are its trigger signals still in the new software, and did any file it captures fail level 1?')}</Hint>
              <Table
                rowKey="policyId"
                size="small"
                pagination={false}
                dataSource={a.policies}
                scroll={{ x: 'max-content' }}
                columns={[
                  { title: L('策略', 'Policy'), render: (_, p) => <Mono>{p.policyId}</Mono> },
                  { title: L('名称', 'Name'), dataIndex: 'name' },
                  { title: L('状态', 'Status'), render: (_, p) => <Tag color={p.status === 'OK' ? 'green' : p.status === 'UNKNOWN' ? 'default' : 'red'}>{B(POLICY_CHECK_LABELS[p.status])}</Tag> },
                  {
                    title: L('问题', 'Problems'),
                    render: (_, p) =>
                      [
                        ...p.missingSignals.map((x) => `${L('缺少信号', 'missing signal')} ${x}`),
                        ...p.problemFiles.map((x) => `${L('文件有问题', 'file problem')}${L('：', ': ')}${x}`),
                      ].join(L('；', '; ')) || '—',
                  },
                ]}
              />
            </Card>

            {a.outcome === 'NEW_FEATURE' && !a.integrated && changes && (
              <Card size="small" title={L('本 Feature 相对基线的修改（在新 Feature 中重做）', 'This Feature’s changes against its base (redo them in the new Feature)')}>
                <DiffView diff={changes} nameOf={fileName} />
              </Card>
            )}
          </>
        )}
      </Space>
      <Modal
        open={naming}
        title={L('在新基线上新建 Feature', 'Start a Feature on the new base')}
        okText={L('创建', 'Create')}
        onCancel={() => setNaming(false)}
        onOk={() => {
          const id = feature && run((x) => createFeature(x, { workspaceId: feature.workspaceId, groupId: feature.groupId, name, baseReleaseId: a.newBaseId }), L('已在新基线上新建 Feature', 'Feature started on the new base'));
          if (id) {
            setNaming(false);
            onClose();
            navigate(`features/${id}`);
          }
        }}
      >
        <Typography.Paragraph type="secondary">
          {L('基线', 'Base')}
          {L('：', ': ')}
          {baseName(state, a.newBaseId, L, B)}
        </Typography.Paragraph>
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </Modal>
    </Drawer>
  );
}
