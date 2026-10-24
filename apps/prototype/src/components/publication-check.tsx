// What a vehicle group published, checked on one vehicle's software: the base, the files (level 1)
// and the policies that depend on them (level 2). Shared by software changes, vehicles that do not
// fit their group, and the preview of a software update.

import { Card, Input, Modal, Space, Table, Tag, Typography } from 'antd';
import { useState } from 'react';
import { useRun } from '../app/hooks.ts';
import { navigate } from '../app/router.ts';
import { useEngineState } from '../app/store.ts';
import { diffConfig } from '../domain/config.ts';
import { baseConfig, createFeature } from '../engine/config.ts';
import type { PublicationCheck } from '../engine/software-change.ts';
import { commitSnapshot, resolveFiles } from '../engine/snapshots.ts';
import type { Feature, State } from '../engine/types.ts';
import { useI18n } from '../i18n/i18n.tsx';
import { issueLabel } from '../i18n/issues.ts';
import { CHANGE_OUTCOME_COLORS, CHANGE_OUTCOME_LABELS, FILE_CHECK_LABELS, POLICY_CHECK_LABELS, setName } from '../i18n/vocab.ts';
import { DiffView } from './DiffView.tsx';
import { Hint, Mono } from './common.tsx';

export function baseName(s: State, id: string | null, L: (zh: string, en: string) => string, B: (b: { zh: string; en: string }) => string): string {
  return id ? B(setName(s.releases[id]?.dclVersion ?? id)) : L('初始研发配置', 'Initial configuration');
}

export function CheckOutcomeTag({ check }: { check: Pick<PublicationCheck, 'outcome'> }) {
  const { B } = useI18n();
  return <Tag color={CHANGE_OUTCOME_COLORS[check.outcome]}>{B(CHANGE_OUTCOME_LABELS[check.outcome])}</Tag>;
}

/** Alert type for an outcome. */
export const outcomeAlert = (outcome: string): 'success' | 'warning' | 'error' | 'info' =>
  outcome === 'NONE' ? 'success' : ['FIX', 'REPUBLISH', 'CANNOT_CHECK', 'UNKNOWN_SOFTWARE'].includes(outcome) ? 'warning' : ['NEW_FEATURE', 'NO_BASE'].includes(outcome) ? 'error' : 'info';

/** The base, files and policies cards. `running` and `target` name the two sides of the base line. */
export function CheckCards({ check, running, target }: { check: PublicationCheck; running: string; target: string }) {
  const state = useEngineState();
  const { L, B } = useI18n();
  return (
    <>
      <Card size="small" title={L('基线', 'Base')}>
        <Space orientation="vertical">
          <span>
            {running}
            {L('：', ': ')}
            {baseName(state, check.runningBaseId, L, B)} → {target}
            {L('：', ': ')}
            {check.baseProblem ? <Typography.Text type="danger"> {B(issueLabel(check.baseProblem), check.baseProblem)}</Typography.Text> : ` ${baseName(state, check.newBaseId, L, B)}`}
          </span>
          {check.baseChanged && check.changedGroups.length > 0 && (
            <span>
              {L('有变化的业务分组', 'Groups that changed')}
              {L('：', ': ')}
              {check.changedGroups.map((g) => (
                <Tag key={g}>{g}</Tag>
              ))}
            </span>
          )}
        </Space>
      </Card>

      <Card size="small" title={L('文件（第一层）', 'Files (level 1)')}>
        <Hint>{L('检查本组文件与引用文件：该软件是否仍提供它的来源目录；引用的其他分组文件在新基线中是否变化。', 'Checks the group’s own and referenced files: does the software still provide each source directory, and did a referenced file of another group change in the new base?')}</Hint>
        <Table
          rowKey="dataKey"
          size="small"
          pagination={false}
          dataSource={check.files}
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
        <Hint>{L('检查每条策略的触发信号是否仍在该软件中，以及它采集的文件在第一层是否有问题。', 'Checks each policy: are its trigger signals in the software, and did any file it captures fail level 1?')}</Hint>
        <Table
          rowKey="policyId"
          size="small"
          pagination={false}
          dataSource={check.policies}
          scroll={{ x: 'max-content' }}
          columns={[
            { title: L('策略', 'Policy'), render: (_, p) => <Mono>{p.policyId}</Mono> },
            { title: L('名称', 'Name'), dataIndex: 'name' },
            { title: L('状态', 'Status'), render: (_, p) => <Tag color={p.status === 'OK' ? 'green' : p.status === 'UNKNOWN' ? 'default' : 'red'}>{B(POLICY_CHECK_LABELS[p.status])}</Tag> },
            {
              title: L('问题', 'Problems'),
              render: (_, p) =>
                [...p.missingSignals.map((x) => `${L('缺少信号', 'missing signal')} ${x}`), ...p.problemFiles.map((x) => `${L('文件有问题', 'file problem')}${L('：', ': ')}${x}`)].join(L('；', '; ')) || '—',
            },
          ]}
        />
      </Card>
    </>
  );
}

/** A Feature's changes against its base, to redo in a Feature on the new base. */
export function ChangesToRedo({ feature, commitId }: { feature: Feature; commitId: string }) {
  const state = useEngineState();
  const { L } = useI18n();
  const before = baseConfig(state, feature);
  const after = commitSnapshot(state, commitId);
  const names = { ...resolveFiles(state, before), ...resolveFiles(state, after) };
  return (
    <Card size="small" title={L('本 Feature 相对基线的修改（在新 Feature 中重做）', 'This Feature’s changes against its base (redo them in the new Feature)')}>
      <DiffView diff={diffConfig(before, after)} nameOf={(k) => names[k]?.name ?? state.dataItems[k]?.dataCode ?? k} />
    </Card>
  );
}

/** Starts a Feature of the same business group on another base, then opens it. */
export function NewFeatureOnBaseModal({ feature, baseId, open, onClose, onCreated }: { feature: Feature; baseId: string | null; open: boolean; onClose: () => void; onCreated?: () => void }) {
  const state = useEngineState();
  const run = useRun();
  const { L, B } = useI18n();
  const [name, setNameValue] = useState(`${feature.name}_v2`);
  return (
    <Modal
      open={open}
      title={L('在新基线上新建 Feature', 'Start a Feature on the new base')}
      okText={L('创建', 'Create')}
      onCancel={onClose}
      onOk={() => {
        const id = run((x) => createFeature(x, { workspaceId: feature.workspaceId, groupId: feature.groupId, name, baseReleaseId: baseId }), L('已在新基线上新建 Feature', 'Feature started on the new base'));
        if (id) {
          onClose();
          onCreated?.();
          navigate(`features/${id}`);
        }
      }}
    >
      <Typography.Paragraph type="secondary">
        {L('基线', 'Base')}
        {L('：', ': ')}
        {baseName(state, baseId, L, B)}
      </Typography.Paragraph>
      <Input value={name} onChange={(e) => setNameValue(e.target.value)} />
    </Modal>
  );
}
