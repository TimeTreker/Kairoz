// The notification center in the header (通知中心) and its texts. Items are the account's current
// matters in the workspace, recomputed on every change; opening one checks it is still current
// and still visible to the account. Marking read changes nothing but the account's own marks.

import { BellOutlined } from '@ant-design/icons';
import { App, Badge, Button, Empty, Popover, Space, Typography } from 'antd';
import { useMemo, useState } from 'react';
import { useActor, useRun, useWorkspace } from '../app/hooks.ts';
import { navigate } from '../app/router.ts';
import { engine, useEngineState } from '../app/store.ts';
import { markNotificationsRead, notificationsFor, readIds } from '../engine/notifications.ts';
import type { Notification, NotificationKind } from '../engine/notifications.ts';
import type { State } from '../engine/types.ts';
import { useI18n } from '../i18n/i18n.tsx';
import type { Bilingual } from '../i18n/i18n.tsx';
import { CHANGE_OUTCOME_LABELS, STAGE_LABELS, setName } from '../i18n/vocab.ts';
import { when } from './common.tsx';

/** What a notification is about, for its tag and the filter. */
export const NOTIFICATION_CATEGORY: Record<NotificationKind, string> = {
  FEATURE_RETURNED: 'FEATURE',
  FEATURE_STAGE: 'FEATURE',
  REFERENCE_REQUEST: 'FEATURE',
  SOFTWARE_CHANGE: 'VEHICLE',
  FEATURE_TO_TEST: 'TEST',
  DISPATCH_FAILED: 'TEST',
  TEST_REQUEST_DECIDED: 'TEST',
  TEST_REQUEST_PENDING: 'TEST',
  VEHICLE_MAINTENANCE: 'VEHICLE',
  INTAKE_REVIEW: 'INTAKE',
  OVERLAP_REVIEW: 'INTAKE',
  PROCESSING_CONFIRM: 'INTEGRATION',
  FEATURE_COLLECTIBLE: 'INTEGRATION',
  MERGE_BLOCKED: 'INTEGRATION',
  CANDIDATE_TO_TEST: 'INTEGRATION',
  CHECK_TO_TEST: 'INTEGRATION',
  CANDIDATE_TO_RELEASE: 'RELEASE',
  CHECK_TO_CONFIRM: 'RELEASE',
  EMERGENCY_STOP: 'RELEASE',
  ROLLOUT_PAUSED: 'RELEASE',
  PRODUCTION_BLOCKED: 'RELEASE',
  UNRECORDED_SOFTWARE: 'VEHICLE',
  GROUP_MISMATCH: 'VEHICLE',
  SOFTWARE_UPDATE: 'VEHICLE',
  LOAN_TO_AGREE: 'VEHICLE',
  LOAN_TO_APPROVE: 'VEHICLE',
  EXTENSION_TO_APPROVE: 'VEHICLE',
  LOAN_DECIDED: 'VEHICLE',
  LOAN_OVERDUE: 'VEHICLE',
  LOAN_ENDED: 'VEHICLE',
  LOAN_RECALLED: 'VEHICLE',
  GRANT_REVIEW: 'ORG',
  ORPHANED_UNIT: 'ORG',
};

export function useCategoryLabels(): Record<string, string> {
  const { L } = useI18n();
  return {
    FEATURE: L('研发', 'Development'),
    TEST: L('验证', 'Testing'),
    INTAKE: L('接入', 'Intake'),
    INTEGRATION: L('集成', 'Integration'),
    RELEASE: L('发布', 'Release'),
    VEHICLE: L('车辆', 'Vehicles'),
    ORG: L('组织与授权', 'Organization'),
  };
}

/** The title and body of a notification in the current language. */
export function useNotificationText() {
  const state = useEngineState();
  const { L, B } = useI18n();
  return (n: Notification): { title: string; body: string } => {
    const s = n.subject;
    const d = n.detail ?? '';
    const stage = (code: string) => B(STAGE_LABELS[code] as Bilingual | undefined, code);
    switch (n.kind) {
      case 'FEATURE_RETURNED':
        return { title: L(`${s} 需要修改`, `${s} needs changes`), body: d };
      case 'FEATURE_STAGE': {
        const body: Record<string, string> = {
          SUBMITTED: L('提交已固定，等待 DCL 接入。', 'The commit is fixed and waits for DCL intake.'),
          DCL_READY: L('配置已就绪，可安排车辆验证。', 'The configuration is ready for vehicle testing.'),
          TESTING: L('当前提交正在验证。', 'The head commit is being tested.'),
          VERIFIED: L('当前提交已通过验证，可交付集成。', 'The head commit is verified and ready for integration.'),
          INTEGRATED: L('已集成进策略集。', 'Integrated into a policy set.'),
        };
        return { title: `${s} · ${stage(d)}`, body: body[d] ?? '' };
      }
      case 'REFERENCE_REQUEST':
        return { title: L(`${s} 申请引用本组文件`, `${s} asks to reference your file`), body: state.dataItems[d]?.dataCode ?? d };
      case 'SOFTWARE_CHANGE': {
        const [versions, outcome] = d.split(' · ');
        return { title: L(`${s} 整车软件已变化`, `${s} runs new software`), body: `${versions} · ${B(CHANGE_OUTCOME_LABELS[outcome ?? ''] as Bilingual | undefined, outcome ?? '')}` };
      }
      case 'FEATURE_TO_TEST':
        return d === 'TESTING'
          ? { title: L(`${s} 等待验证结果`, `${s} waits for test results`), body: L('先仿真后实车登记结果，再确认 Verified。', 'Record results, simulation first, then confirm Verified.') }
          : { title: L(`${s} 可下发验证`, `${s} can be dispatched for testing`), body: L('按车辆组下发当前固定提交。', 'Dispatch the head commit to vehicle groups.') };
      case 'DISPATCH_FAILED':
        return { title: L(`${s} 下发失败`, `${s} dispatch failed`), body: L(`应用失败的车辆：${d}`, `Vehicles that failed to apply: ${d}`) };
      case 'TEST_REQUEST_DECIDED':
        return d === 'APPROVED'
          ? { title: L(`${s} 的团队测试申请已批准`, `Team test request for ${s} approved`), body: L('可执行一次已批准的下发。', 'You can execute the approved dispatch once.') }
          : { title: L(`${s} 的团队测试申请被驳回`, `Team test request for ${s} rejected`), body: L('查看驳回说明后重新申请。', 'See the note, then request again.') };
      case 'TEST_REQUEST_PENDING':
        return { title: L(`${s} 的团队测试申请待审批`, `Team test request for ${s} to decide`), body: L(`申请人：${d}`, `Requested by ${d}`) };
      case 'VEHICLE_MAINTENANCE':
        return { title: L(`${s} 正在维护`, `${s} is in maintenance`), body: L('暂不安排研发、测试或镜像切换。', 'Do not plan development, tests or image changes on it.') };
      case 'INTAKE_REVIEW':
        return { title: L(`${s} 等待接入检查`, `${s} waits for intake`), body: L(`分组 ${d}：检查敏感数据与处理绑定。`, `Group ${d}: check sensitive data and processing bindings.`) };
      case 'OVERLAP_REVIEW':
        return { title: L(`${s} 的来源与其他文件重叠`, `${s} overlaps another source`), body: L('判定为不同数据或重复。', 'Decide whether it is distinct data or a duplicate.') };
      case 'PROCESSING_CONFIRM':
        return { title: L('合并预览等待确认最终处理集合', 'A merge preview waits for the processing confirmation'), body: s };
      case 'FEATURE_COLLECTIBLE':
        return { title: L(`${s} 可进入集成`, `${s} can be collected`), body: L(`分组 ${d} 的已验证提交。`, `Verified commit of group ${d}.`) };
      case 'MERGE_BLOCKED':
        return { title: L('合并预览存在阻塞', 'A merge preview is blocked'), body: L('冻结候选前需由所属团队修复、提交并重新验证。', 'The owning teams fix, commit and re-verify before a candidate can be frozen.') };
      case 'CANDIDATE_TO_TEST':
        return { title: L(`集成候选 ${s} 等待验证`, `Candidate ${s} waits for testing`), body: L('只使用测试环境的集成车辆。', 'Testing-environment integration vehicles only.') };
      case 'CHECK_TO_TEST':
        return { title: L(`${s} 适用性测试待进行`, `Applicability test for ${s} to run`), body: d ? B(setName(d)) : '' };
      case 'CANDIDATE_TO_RELEASE':
        return { title: L(`集成候选 ${s} 等待发布`, `Candidate ${s} waits for release`), body: L('检查独立测试证据和发布门禁。', 'Check the test evidence and the release gates.') };
      case 'CHECK_TO_CONFIRM':
        return { title: L(`${s} 适用性待确认`, `Applicability of ${s} to confirm`), body: d ? B(setName(d)) : '' };
      case 'EMERGENCY_STOP':
        return d === 'REQUESTED'
          ? { title: L(`${s} 紧急停用待批准`, `Emergency stop of ${s} to decide`), body: L('由另一名配置发布批准或驳回。', 'Another config release person approves or rejects it.') }
          : { title: d === 'APPROVED' ? L(`${s} 紧急停用已批准`, `Emergency stop of ${s} approved`) : L(`${s} 紧急停用被驳回`, `Emergency stop of ${s} rejected`), body: '' };
      case 'ROLLOUT_PAUSED':
        return { title: L(`OTA ${s} 已暂停`, `Rollout ${s} paused`), body: d };
      case 'PRODUCTION_BLOCKED':
        return { title: L(`量产车 ${s} 被阻止`, `Production vehicle ${s} is blocked`), body: L(`软件 ${d} 没有适用的策略集。`, `No policy set applies to software ${d}.`) };
      case 'UNRECORDED_SOFTWARE':
        return { title: L(`${s} 上报了未登记的软件版本`, `${s} reported an unrecorded software version`), body: L(`先登记 ${d}，再确认。`, `Record ${d}, then confirm it.`) };
      case 'GROUP_MISMATCH': {
        const [group, outcome] = d.split(' · ');
        return {
          title: L(`${s} 与车辆组的发布不匹配`, `${s} does not fit what ${group} runs`),
          body: `${B(CHANGE_OUTCOME_LABELS[outcome ?? ''] as Bilingual | undefined, outcome ?? '')} · ${L('修改策略并下发，或更新车辆整车版本', 'adapt the policies and dispatch, or update the vehicle’s software')}`,
        };
      }
      case 'SOFTWARE_UPDATE': {
        const [version, status] = d.split(' · ');
        return status === 'FAILED'
          ? { title: L(`${s} 整车软件更新失败`, `Software update of ${s} failed`), body: L(`未能更新到 ${version}，车辆保持原版本。`, `It did not move to ${version}; it keeps its software.`) }
          : { title: L(`${s} 已更新到 ${version}`, `${s} updated to ${version}`), body: L('车辆重启上报后，按车辆组的发布推送配置。', 'After its restart report, the group’s publication is pushed if it fits.') };
      }
      case 'LOAN_TO_AGREE':
        return { title: L(`${d} 申请借用 ${s}`, `${d} asks to borrow ${s}`), body: L('同意后由车辆资源批准；批准时车辆离开本工作区的车辆组。', 'Vehicle resources approve after you agree; the vehicle then leaves your vehicle group.') };
      case 'LOAN_TO_APPROVE':
        return { title: L(`${s} 借用待审批`, `Loan of ${s} to approve`), body: L(`借用方：${d}`, `Borrower: ${d}`) };
      case 'EXTENSION_TO_APPROVE':
        return { title: L(`${s} 借用延期待审批`, `Loan extension of ${s} to decide`), body: L(`延期至 ${d}`, `Until ${d}`) };
      case 'LOAN_DECIDED': {
        const text: Record<string, [string, string]> = {
          APPROVED: [L(`${s} 借用已批准`, `Loan of ${s} approved`), L('车辆已加入申请的车辆组。', 'The vehicle joined the vehicle group you asked for.')],
          REJECTED: [L(`${s} 借用未批准`, `Loan of ${s} rejected`), L('查看说明后可重新申请。', 'See the note; you can ask again.')],
          EXTENSION_APPROVED: [L(`${s} 借用延期已批准`, `Loan extension of ${s} approved`), ''],
          EXTENSION_REJECTED: [L(`${s} 借用延期未批准`, `Loan extension of ${s} rejected`), L('请按原日期归还。', 'Return it by the current last day.')],
        };
        const [title, body] = text[d] ?? [s, d];
        return { title, body };
      }
      case 'LOAN_OVERDUE':
        return { title: L(`${s} 借用已到期`, `Loan of ${s} is overdue`), body: L(`最后一天 ${d}；不能再下发，请延期或归还。`, `Last day ${d}; nothing new is dispatched to it. Extend or return it.`) };
      case 'LOAN_ENDED': {
        const [status, versions] = d.split(' · ');
        return {
          title: status === 'RECALLED' ? L(`${s} 已被车辆资源收回`, `${s} was recalled by vehicle resources`) : L(`${s} 已归还`, `${s} was returned`),
          body: L(`整车软件 ${versions}；需要时重新加入车辆组。`, `Software ${versions}; add it to a vehicle group again when needed.`),
        };
      }
      case 'LOAN_RECALLED':
        return { title: L(`借用的 ${s} 已被收回`, `Borrowed ${s} was recalled`), body: d };
      case 'GRANT_REVIEW':
        return { title: L(`${s} 调岗后待复核授权`, `Grants of ${s} to review after a move`), body: d };
      case 'ORPHANED_UNIT':
        return { title: L(`${s} 的组织节点已失效`, `The org unit of ${s} is gone`), body: L('请重新挂靠。', 'Re-attach it.') };
    }
  };
}

/** The account's notifications in the current workspace, with read marks and actions. */
export function useNotifications() {
  const state = useEngineState();
  const actor = useActor();
  const { workspace } = useWorkspace();
  const run = useRun();
  const { message } = App.useApp();
  const { L } = useI18n();
  const items = useMemo(() => (actor && workspace ? notificationsFor(state, actor, workspace.id) : []), [state, actor, workspace]);
  const read = useMemo(() => (actor && workspace ? readIds(state, actor.username, workspace.id) : new Set<string>()), [state, actor, workspace]);
  const unread = items.filter((n) => !read.has(n.id));
  const markRead = (ids: string[]) => workspace && ids.length > 0 && run((c) => markNotificationsRead(c, workspace.id, ids));
  /** Opens the object only if the item is still current and visible to the account. */
  const open = (n: Notification) => {
    if (!actor || !workspace) return;
    let current: Notification[] = [];
    try {
      current = engine.read(actor.username, (s: State, a) => notificationsFor(s, a, workspace.id));
    } catch {
      current = [];
    }
    if (!current.some((x) => x.id === n.id)) {
      message.warning(L('该通知已失效：状态已变化或已无权限，不能打开。', 'This notification is out of date: the state changed or access was removed, so it cannot be opened.'));
      return;
    }
    markRead([n.id]);
    navigate(n.link);
  };
  return { items, read, unread, markRead, open };
}

function NotificationRow({ n, read, onOpen, onRead }: { n: Notification; read: boolean; onOpen: () => void; onRead?: () => void }) {
  const text = useNotificationText()(n);
  const categories = useCategoryLabels();
  const { L } = useI18n();
  return (
    <div className={`kz-notification${read ? '' : ' unread'}`} style={{ display: 'flex', gap: 8, padding: '8px 4px', borderBottom: '1px solid #f0f2f5', alignItems: 'flex-start' }}>
      <Badge status={n.severity === 'WARNING' ? 'warning' : read ? 'default' : 'processing'} style={{ marginTop: 6 }} />
      <div style={{ flex: 1, cursor: 'pointer', minWidth: 0 }} onClick={onOpen}>
        <Typography.Text strong={!read}>{text.title}</Typography.Text>
        {text.body && (
          <div>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {text.body}
            </Typography.Text>
          </div>
        )}
        <div>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {categories[NOTIFICATION_CATEGORY[n.kind]]}
            {n.at ? ` · ${when(n.at)}` : ''}
            {read ? ` · ${L('已读', 'read')}` : ''}
          </Typography.Text>
        </div>
      </div>
      {!read && onRead && (
        <Button type="link" size="small" onClick={onRead}>
          {L('标记已读', 'Mark read')}
        </Button>
      )}
    </div>
  );
}

/** The bell in the header: unread count, the latest items, all read, and the full list. */
export function NotificationBell() {
  const { L } = useI18n();
  const { items, read, unread, markRead, open } = useNotifications();
  const [visible, setVisible] = useState(false);
  const shown = [...items.filter((n) => !read.has(n.id)), ...items.filter((n) => read.has(n.id))].slice(0, 8);
  const content = (
    <div style={{ width: 380, maxWidth: '80vw' }}>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 4 }}>
        <Typography.Text strong>{L('通知', 'Notifications')}</Typography.Text>
        <Button type="link" size="small" disabled={unread.length === 0} onClick={() => markRead(unread.map((n) => n.id))}>
          {L('全部已读', 'Mark all read')}
        </Button>
      </Space>
      {shown.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={L('当前没有事项', 'Nothing right now')} />
      ) : (
        shown.map((n) => <NotificationRow key={n.id} n={n} read={read.has(n.id)} onOpen={() => (setVisible(false), open(n))} onRead={() => markRead([n.id])} />)
      )}
      <Button type="link" block onClick={() => (setVisible(false), navigate('notifications'))}>
        {L('查看全部', 'See all')} {items.length > shown.length ? `(${items.length})` : ''}
      </Button>
    </div>
  );
  return (
    <Popover trigger="click" placement="bottomRight" open={visible} onOpenChange={setVisible} content={content}>
      <Badge count={unread.length} size="small" offset={[-2, 2]}>
        <Button type="text" icon={<BellOutlined />} aria-label={L('通知中心', 'Notification center')} />
      </Badge>
    </Popover>
  );
}

/** The full list for the notifications page. */
export function NotificationList({ filter, category }: { filter: 'all' | 'unread'; category: string }) {
  const { L } = useI18n();
  const { items, read, markRead, open } = useNotifications();
  const list = items.filter((n) => (filter === 'all' || !read.has(n.id)) && (category === 'ALL' || NOTIFICATION_CATEGORY[n.kind] === category));
  if (list.length === 0) return <Empty description={filter === 'unread' ? L('没有未读事项', 'No unread items') : L('当前没有事项', 'Nothing right now')} />;
  return (
    <div>
      {list.map((n) => (
        <NotificationRow key={n.id} n={n} read={read.has(n.id)} onOpen={() => open(n)} onRead={() => markRead([n.id])} />
      ))}
    </div>
  );
}
