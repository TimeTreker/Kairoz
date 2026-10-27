// Archiving and restoring workspaces, business groups and organization units: the dialog lists
// what still stands in the way, live, and records the reason with the archive history.

import { Alert, Input, Modal, Space, Table, Typography } from 'antd';
import { useState } from 'react';
import { useRun } from '../app/hooks.ts';
import { useEngineState } from '../app/store.ts';
import {
  archiveGroup,
  archiveOrgUnit,
  archiveWorkspace,
  groupArchiveProblems,
  lifecycleOf,
  restoreWorkspace,
  unitArchiveProblems,
  workspaceArchiveProblems,
  workspaceRestoreProblems,
} from '../engine/lifecycle.ts';
import { useI18n } from '../i18n/i18n.tsx';
import { issueLabel } from '../i18n/issues.ts';
import { LIFECYCLE_KIND_LABELS } from '../i18n/vocab.ts';
import { Hint, when } from './common.tsx';

export type LifecycleTarget = { object: 'workspace' | 'group' | 'unit'; action: 'archive' | 'restore'; id: string };

export function LifecycleModal({ target, onClose }: { target: LifecycleTarget | null; onClose: () => void }) {
  const state = useEngineState();
  const run = useRun();
  const { L, B } = useI18n();
  const [reason, setReason] = useState('');
  if (!target) return <Modal open={false} />;
  const close = () => (setReason(''), onClose());
  const name =
    target.object === 'workspace' ? state.workspaces[target.id]?.name : target.object === 'group' ? state.groups[target.id]?.name : state.orgUnits[target.id]?.name;
  const restore = target.action === 'restore';
  const problems = restore
    ? workspaceRestoreProblems(state, target.id)
    : target.object === 'workspace'
      ? workspaceArchiveProblems(state, target.id)
      : target.object === 'group'
        ? groupArchiveProblems(state, target.id)
        : unitArchiveProblems(state, target.id);
  const what = { workspace: L('工作区', 'workspace'), group: L('业务分组', 'business group'), unit: L('组织节点', 'organization unit') }[target.object];
  const history = lifecycleOf(state, target.id);
  const submit = () => {
    const ok = run(
      (c) =>
        restore
          ? restoreWorkspace(c, target.id, reason)
          : target.object === 'workspace'
            ? archiveWorkspace(c, target.id, reason)
            : target.object === 'group'
              ? archiveGroup(c, target.id, reason)
              : archiveOrgUnit(c, target.id, reason),
      restore ? L('已恢复', 'Restored') : L('已归档', 'Archived'),
    );
    if (ok !== undefined) close();
  };
  return (
    <Modal
      open
      title={`${restore ? L('恢复', 'Restore') : L('归档', 'Archive')} ${what} · ${name ?? target.id}`}
      okText={restore ? L('恢复', 'Restore') : L('归档', 'Archive')}
      okButtonProps={{ danger: !restore, disabled: problems.length > 0 || !reason.trim() }}
      onCancel={close}
      onOk={submit}
    >
      <Hint>
        {restore
          ? L('恢复后按已有授权重新开放，已归档的业务分组仍为已归档；归档与恢复都保留在历史中。', 'Once restored it opens again under the grants that already exist; archived business groups stay archived. Archive and restore both stay in the history.')
          : target.object === 'workspace'
            ? L('归档后工作区从入口消失，平台拒绝其中的任何操作，直到平台运维恢复。车辆归属、历史配置与事件都不删除。', 'Once archived the workspace leaves every switcher and the platform refuses any action in it until platform operations restore it. Vehicles, past configurations and events are kept.')
            : target.object === 'group'
              ? L('归档后不能再在该分组新建 Feature，也不能加入其他工作区；文件、策略与提交都保留。', 'Once archived no new Feature starts in the group and no workspace takes it on; its files, policies and commits are kept.')
              : L('归档前下级节点、业务分组与工作区须先归档；历史保留。', 'Units, groups and workspaces under it are archived first; history is kept.')}
      </Hint>
      <Space orientation="vertical" size={12} style={{ width: '100%' }}>
        {problems.length > 0 ? (
          <Alert type="warning" showIcon title={restore ? L('现在不能恢复', 'Cannot restore yet') : L('请先结束这些事项', 'Finish these first')} description={problems.map((p) => <div key={p}>{B(issueLabel(p), p)}</div>)} />
        ) : (
          <Alert type="success" showIcon title={restore ? L('可以恢复', 'Ready to restore') : L('可以归档', 'Ready to archive')} />
        )}
        <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={L('原因', 'Reason')} />
        {history.length > 0 && (
          <Table
            rowKey="id"
            size="small"
            pagination={false}
            dataSource={history}
            columns={[
              { title: L('操作', 'Action'), render: (_, x) => B(LIFECYCLE_KIND_LABELS[x.kind]) },
              { title: L('原因', 'Reason'), render: (_, x) => (x.before !== undefined ? `${x.before} → ${x.after}` : x.reason) },
              { title: L('执行人', 'By'), render: (_, x) => <Typography.Text>{`${state.accounts[x.by]?.displayName ?? x.by} · ${when(x.at)}`}</Typography.Text> },
            ]}
          />
        )}
      </Space>
    </Modal>
  );
}
