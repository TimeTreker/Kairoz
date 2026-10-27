// Borrowing (借用) pages: the catalog a workspace borrows from, its borrowed and lent vehicles, and
// vehicle resources' approvals. The catalog shows what is needed to choose a vehicle; its
// configuration, client reports and test results stay hidden until a loan is approved.

import { Alert, Button, Card, Form, Input, Modal, Select, Space, Table, Tabs, Tag, Tooltip, Typography } from 'antd';
import { useState } from 'react';
import { useActor, useCan, useRun, useWorkspace } from '../app/hooks.ts';
import { useEngineState } from '../app/store.ts';
import { addDays, todayOf } from '../engine/clock.ts';
import { activeLoanOf } from '../engine/fleet.ts';
import {
  MAX_LOAN_DAYS,
  answerLoanAsLender,
  approvalProblems,
  borrowedBy,
  decideExtension,
  decideLoan,
  isOverdue,
  lentBy,
  loanCatalog,
  managedLoans,
  recallLoan,
  requestExtension,
  requestLoan,
  returnLoan,
  withdrawLoan,
} from '../engine/loans.ts';
import type { CatalogEntry } from '../engine/loans.ts';
import type { Loan, State } from '../engine/types.ts';
import { ENVS } from '../domain/vocabulary.ts';
import { useI18n } from '../i18n/i18n.tsx';
import { issueLabel } from '../i18n/issues.ts';
import { EXTENSION_STATUS_LABELS, LENDER_DECISION_LABELS, LOAN_STATUS_COLORS, LOAN_STATUS_LABELS, RESOURCE_STATUS_LABELS, RESOURCE_TYPE_LABELS } from '../i18n/vocab.ts';
import { EnvTag, Hint, Mono, day, when } from './common.tsx';

/** A loan's state as people read it: who it waits for, or overdue. */
export function loanState(s: State, l: Loan): string {
  if (l.status === 'REQUESTED') return l.lenders.some((x) => x.decision !== 'AGREED') ? 'TO_AGREE' : 'TO_APPROVE';
  return isOverdue(s, l) ? 'OVERDUE' : l.status;
}

export function LoanStatusTag({ loan }: { loan: Loan }) {
  const state = useEngineState();
  const { B } = useI18n();
  const st = loanState(state, loan);
  const ext = loan.extensions.find((x) => x.status === 'PENDING');
  return (
    <Space size={4} wrap>
      <Tag color={LOAN_STATUS_COLORS[st]}>{B(LOAN_STATUS_LABELS[st])}</Tag>
      {ext && <Tag color="gold">{`${B(EXTENSION_STATUS_LABELS.PENDING)} → ${ext.dueDate}`}</Tag>}
    </Space>
  );
}

/** The loan tag of a vehicle row in a workspace: borrowed here, or lent to another workspace. */
export function LoanVehicleTag({ resourceId, workspaceId }: { resourceId: string; workspaceId: string }) {
  const state = useEngineState();
  const { L } = useI18n();
  const l = activeLoanOf(state, resourceId);
  if (!l) return null;
  const overdue = isOverdue(state, l);
  if (l.workspaceId === workspaceId) {
    return (
      <Tooltip title={l.purpose}>
        <Tag color={overdue ? 'red' : 'geekblue'}>{overdue ? L(`借用已到期 · ${day(l.dueDate)}`, `Loan overdue · ${day(l.dueDate)}`) : L(`借用 · 至 ${day(l.dueDate)}`, `Borrowed · until ${day(l.dueDate)}`)}</Tag>
      </Tooltip>
    );
  }
  const borrower = state.workspaces[l.workspaceId]?.name ?? l.workspaceId;
  return <Tag>{L(`借出至 ${borrower} · 至 ${day(l.dueDate)}`, `Lent to ${borrower} · until ${day(l.dueDate)}`)}</Tag>;
}

const wsName = (s: State, id: string) => s.workspaces[id]?.name ?? id;

function NoteModal({ title, required, placeholder, onOk, onClose }: { title: string; required: boolean; placeholder: string; onOk: (note: string) => boolean; onClose: () => void }) {
  const [note, setNote] = useState('');
  return (
    <Modal open title={title} okButtonProps={{ disabled: required && !note.trim() }} onCancel={onClose} onOk={() => onOk(note) && onClose()}>
      <Input.TextArea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder={placeholder} />
    </Modal>
  );
}

function RequestModal({ workspaceId, entry, onClose }: { workspaceId: string; entry: CatalogEntry; onClose: () => void }) {
  const state = useEngineState();
  const run = useRun();
  const { L } = useI18n();
  const [form] = Form.useForm();
  const today = todayOf(state);
  const groups = Object.values(state.vehicleGroups).filter((g) => g.workspaceId === workspaceId && g.status === 'ACTIVE' && g.purpose !== 'PRODUCTION' && g.env === entry.env);
  return (
    <Modal
      open
      title={`${L('申请借用', 'Ask to borrow')} · ${entry.resourceId}`}
      okText={L('提交申请', 'Send request')}
      onCancel={onClose}
      onOk={() =>
        form.validateFields().then((v) => {
          if (run((c) => requestLoan(c, { workspaceId, resourceId: entry.resourceId, ...v }), L('已提交借用申请', 'Loan requested')) !== undefined) onClose();
        })
      }
    >
      <Hint>
        {entry.usedBy.length
          ? L(`先由 ${entry.usedBy.map((w) => wsName(state, w)).join('、')} 同意，再由车辆资源批准。批准后车辆离开对方的车辆组，加入下面选择的车辆组。`, `${entry.usedBy.map((w) => wsName(state, w)).join(', ')} agree first, then vehicle resources approve. The vehicle then leaves their vehicle group and joins the one chosen below.`)
          : L('没有工作区在使用这辆车，由车辆资源批准。批准后车辆加入下面选择的车辆组。', 'No workspace uses this vehicle; vehicle resources approve. It then joins the vehicle group chosen below.')}
      </Hint>
      <Form form={form} name="loan" layout="vertical" initialValues={{ vehicleGroupId: groups[0]?.id, dueDate: addDays(today, 7), purpose: '' }}>
        <Form.Item name="vehicleGroupId" label={L('加入本工作区的车辆组', 'Joins this vehicle group')} rules={[{ required: true }]}>
          <Select options={groups.map((g) => ({ value: g.id, label: g.name }))} notFoundContent={L('本工作区没有与该车环境相同的研发或测试车辆组', 'No development or testing vehicle group in the vehicle’s environment')} />
        </Form.Item>
        <Form.Item name="dueDate" label={L(`最后一天（${MAX_LOAN_DAYS} 天内）`, `Last day (within ${MAX_LOAN_DAYS} days)`)} rules={[{ required: true }]}>
          <Input type="date" min={addDays(today, 1)} max={addDays(today, MAX_LOAN_DAYS)} style={{ width: 180 }} />
        </Form.Item>
        <Form.Item name="purpose" label={L('用途', 'Purpose')} rules={[{ required: true }]}>
          <Input placeholder={L('例如：AEB 联合制动验证', 'e.g. joint AEB brake validation')} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

function CatalogModal({ workspaceId, onClose }: { workspaceId: string; onClose: () => void }) {
  const state = useEngineState();
  const { L, B } = useI18n();
  const [asking, setAsking] = useState<CatalogEntry | null>(null);
  const catalog = loanCatalog(state, workspaceId);
  return (
    <Modal open width={1000} title={L('借用目录', 'Borrowing catalog')} footer={null} onCancel={onClose}>
      <Hint>
        {L(
          '只显示选车需要的信息：类型、环境、资源池、整车软件、状态和使用方。车辆上的配置、客户端上报和测试结果包含其他分组的数据，批准后才能看到。量产车和个人仿真不能借。',
          'Only what is needed to choose a vehicle: type, environment, pool, software, status and who uses it. Its configuration, client reports and test results carry other groups’ data and show only after approval. Production vehicles and personal simulations are never lent.',
        )}
      </Hint>
      <Table
        rowKey="resourceId"
        size="small"
        pagination={{ pageSize: 10, hideOnSinglePage: true }}
        dataSource={catalog}
        scroll={{ x: 'max-content' }}
        locale={{ emptyText: L('没有可借的车辆', 'No vehicles to borrow') }}
        columns={[
          {
            title: L('车辆', 'Vehicle'),
            render: (_, e) => (
              <Space orientation="vertical" size={0}>
                <Mono>{e.resourceId}</Mono>
                <Typography.Text type="secondary">{e.displayName}</Typography.Text>
              </Space>
            ),
          },
          { title: L('类型', 'Type'), render: (_, e) => B(RESOURCE_TYPE_LABELS[e.type]) },
          { title: L('环境 / 资源池', 'Env / pool'), render: (_, e) => <Space size={4}><EnvTag env={e.env} /><span>{e.pool}</span></Space> },
          {
            title: L('整车软件', 'Software'),
            render: (_, e) =>
              e.softwareStatus === 'PARTIAL_FAILURE' ? <Tag color="red">{L('部分域控失败', 'Partial controller failure')}</Tag> : e.integrationVersion ? e.integrationVersion : <Typography.Text type="secondary">{L('未知', 'Unknown')}</Typography.Text>,
          },
          { title: L('状态', 'Status'), render: (_, e) => B(RESOURCE_STATUS_LABELS[e.status]) },
          { title: L('使用方', 'Used by'), render: (_, e) => (e.usedBy.length ? e.usedBy.map((w) => <Tag key={w}>{wsName(state, w)}</Tag>) : '—') },
          {
            title: L('可借情况', 'Availability'),
            render: (_, e) => (
              <Space size={4} wrap>
                {e.lentTo && <Tag color="orange">{L(`已借给 ${wsName(state, e.lentTo.workspaceId)} · 至 ${e.lentTo.dueDate}`, `Lent to ${wsName(state, e.lentTo.workspaceId)} · until ${e.lentTo.dueDate}`)}</Tag>}
                {e.direct && <Tag color="green">{L('本资源池，可直接加入', 'Own pool: add it directly')}</Tag>}
                {e.openLoanId && <Tag color="processing">{L('已申请', 'Requested')}</Tag>}
                {!e.lentTo && !e.direct && !e.openLoanId && e.status === 'AVAILABLE' && <Tag>{L('可申请', 'Can be asked for')}</Tag>}
              </Space>
            ),
          },
          {
            title: '',
            render: (_, e) => {
              // A loan cannot start now: already asked, lent elsewhere, not available, or simply addable.
              const why = e.openLoanId
                ? L('已申请', 'Already asked for')
                : e.lentTo
                  ? L('已借给其他工作区，归还后再申请', 'Lent to another workspace; ask after it is returned')
                  : e.status !== 'AVAILABLE'
                    ? L('车辆不可用', 'The vehicle is not available')
                    : e.direct
                      ? L('本资源池且无人使用：在“工作区车辆”中直接加入', 'Own pool and unused: add it under Workspace vehicles')
                      : null;
              return (
                <Tooltip title={why}>
                  <Button size="small" type="primary" disabled={!!why} onClick={() => setAsking(e)}>
                    {L('申请借用', 'Ask to borrow')}
                  </Button>
                </Tooltip>
              );
            },
          },
        ]}
      />
      {asking && <RequestModal workspaceId={workspaceId} entry={asking} onClose={() => setAsking(null)} />}
    </Modal>
  );
}

function ExtendModal({ loan, onClose }: { loan: Loan; onClose: () => void }) {
  const state = useEngineState();
  const run = useRun();
  const { L } = useI18n();
  const today = todayOf(state);
  const from = loan.dueDate > today ? loan.dueDate : today;
  const [dueDate, setDueDate] = useState(addDays(from, 7));
  const [reason, setReason] = useState('');
  return (
    <Modal
      open
      title={`${L('申请延期', 'Ask for more time')} · ${loan.resourceId}`}
      onCancel={onClose}
      onOk={() => {
        if (run((c) => requestExtension(c, loan.id, { dueDate, reason }), L('已申请延期', 'Extension requested')) !== undefined) onClose();
      }}
    >
      <Space orientation="vertical" style={{ width: '100%' }}>
        <Typography.Text type="secondary">{L(`当前最后一天：${loan.dueDate}`, `Current last day: ${loan.dueDate}`)}</Typography.Text>
        <Input type="date" value={dueDate} min={addDays(from, 1)} max={addDays(today, MAX_LOAN_DAYS)} onChange={(e) => setDueDate(e.target.value)} style={{ width: 180 }} />
        <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={L('原因，例如：联合验证还需一周', 'Reason, e.g. the joint test needs another week')} />
      </Space>
    </Modal>
  );
}

function BorrowedCard({ workspaceId }: { workspaceId: string }) {
  const state = useEngineState();
  const run = useRun();
  const { L, B } = useI18n();
  const can = useCan();
  const [catalog, setCatalog] = useState(false);
  const [extending, setExtending] = useState<Loan | null>(null);
  const [returning, setReturning] = useState<Loan | null>(null);
  const loans = borrowedBy(state, workspaceId);
  const mine = (l: Loan) => {
    const r = state.resources[l.resourceId]!;
    return can('loan.request', { workspaceId, scope: r.pool, env: r.env });
  };
  return (
    <Card
      title={L('借入', 'Borrowed')}
      extra={
        <Button type="primary" onClick={() => setCatalog(true)}>
          {L('借用车辆', 'Borrow a vehicle')}
        </Button>
      }
    >
      <Hint>{L('借来的车辆加入申请的车辆组；车辆上报后，如果匹配，云端推送已下发给该组的配置。到期后不能再下发，请延期或归还。', 'A borrowed vehicle joins the vehicle group asked for; when it reports and fits, the cloud pushes what was dispatched to that group. Once overdue nothing new is dispatched: extend or return it.')}</Hint>
      <Table
        rowKey="id"
        size="small"
        pagination={{ pageSize: 10, hideOnSinglePage: true }}
        dataSource={loans}
        scroll={{ x: 'max-content' }}
        locale={{ emptyText: L('没有借入的车辆', 'Nothing borrowed') }}
        columns={[
          { title: L('车辆', 'Vehicle'), render: (_, l) => <Mono>{l.resourceId}</Mono> },
          { title: L('车辆组', 'Vehicle group'), render: (_, l) => state.vehicleGroups[l.vehicleGroupId]?.name ?? '—' },
          { title: L('最后一天', 'Last day'), render: (_, l) => <Typography.Text type={isOverdue(state, l) ? 'danger' : undefined}>{day(l.dueDate)}</Typography.Text> },
          { title: L('状态', 'Status'), render: (_, l) => <LoanStatusTag loan={l} /> },
          {
            title: L('使用方意见', 'Lenders'),
            render: (_, l) =>
              l.lenders.length
                ? l.lenders.map((x) => (
                    <Tooltip key={x.workspaceId} title={x.note ?? undefined}>
                      <Tag color={x.decision === 'AGREED' ? 'green' : x.decision === 'DECLINED' ? 'red' : 'default'}>{`${wsName(state, x.workspaceId)} · ${B(LENDER_DECISION_LABELS[x.decision])}`}</Tag>
                    </Tooltip>
                  ))
                : '—',
          },
          { title: L('用途 / 说明', 'Purpose / note'), render: (_, l) => [l.purpose, l.decisionNote, l.endNote].filter(Boolean).join(' · ') },
          {
            title: '',
            render: (_, l) => (
              <Space size={0}>
                {l.status === 'REQUESTED' && mine(l) && (
                  <Button type="link" size="small" onClick={() => run((c) => withdrawLoan(c, l.id), L('已撤回', 'Withdrawn'))}>
                    {L('撤回', 'Withdraw')}
                  </Button>
                )}
                {l.status === 'APPROVED' && mine(l) && !l.extensions.some((x) => x.status === 'PENDING') && (
                  <Button type="link" size="small" onClick={() => setExtending(l)}>
                    {L('申请延期', 'Extend')}
                  </Button>
                )}
                {l.status === 'APPROVED' && mine(l) && (
                  <Button type="link" size="small" danger onClick={() => setReturning(l)}>
                    {L('归还', 'Return')}
                  </Button>
                )}
              </Space>
            ),
          },
        ]}
      />
      {catalog && <CatalogModal workspaceId={workspaceId} onClose={() => setCatalog(false)} />}
      {extending && <ExtendModal loan={extending} onClose={() => setExtending(null)} />}
      <Modal
        open={!!returning}
        title={`${L('归还', 'Return')} · ${returning?.resourceId}`}
        okText={L('归还', 'Return')}
        onCancel={() => setReturning(null)}
        onOk={() => {
          if (returning && run((c) => returnLoan(c, returning.id), L('已归还', 'Returned')) !== undefined) setReturning(null);
        }}
      >
        <Typography.Paragraph>
          {L('车辆离开本工作区和车辆组。车上的配置和整车软件保持不变；借出方需要时自行重新入组。车辆须没有待回执的下发，仿真实例须已停止。', 'The vehicle leaves this workspace and its vehicle group. Its configuration and software stay as they are; the lenders put it back into a group themselves. Nothing may wait for a receipt, and a simulation must be stopped.')}
        </Typography.Paragraph>
      </Modal>
    </Card>
  );
}

function LentCard({ workspaceId }: { workspaceId: string }) {
  const state = useEngineState();
  const run = useRun();
  const can = useCan();
  const { L, B } = useI18n();
  const [declining, setDeclining] = useState<Loan | null>(null);
  const loans = lentBy(state, workspaceId);
  const mayAnswer = (l: Loan) => {
    const r = state.resources[l.resourceId]!;
    return l.status === 'REQUESTED' && l.lenders.some((x) => x.workspaceId === workspaceId && x.decision === 'PENDING') && can('loan.lend', { workspaceId, scope: r.pool, env: r.env });
  };
  return (
    <Card title={L('借出', 'Lent')}>
      <Hint>{L('其他工作区借用本工作区在用的车辆时，先由本工作区同意。批准后车辆离开本工作区的车辆组，借用期间只有借用方使用；归还后需要时重新入组。', 'When another workspace asks for a vehicle this workspace uses, this workspace agrees first. On approval it leaves your vehicle group and only the borrower uses it; after the return, add it to a group again when needed.')}</Hint>
      <Table
        rowKey="id"
        size="small"
        pagination={{ pageSize: 10, hideOnSinglePage: true }}
        dataSource={loans}
        scroll={{ x: 'max-content' }}
        locale={{ emptyText: L('没有借出的车辆', 'Nothing lent') }}
        columns={[
          { title: L('车辆', 'Vehicle'), render: (_, l) => <Mono>{l.resourceId}</Mono> },
          { title: L('借用方', 'Borrower'), render: (_, l) => wsName(state, l.workspaceId) },
          { title: L('用途', 'Purpose'), dataIndex: 'purpose' },
          { title: L('最后一天', 'Last day'), dataIndex: 'dueDate' },
          { title: L('状态', 'Status'), render: (_, l) => <LoanStatusTag loan={l} /> },
          {
            title: L('整车软件', 'Software'),
            render: (_, l) => (l.status === 'RETURNED' || l.status === 'RECALLED' ? `${l.softwareAtStart ?? '—'} → ${l.softwareAtEnd ?? '—'}` : '—'),
          },
          {
            title: L('本工作区意见', 'Our answer'),
            render: (_, l) => {
              const mine = l.lenders.find((x) => x.workspaceId === workspaceId);
              if (mayAnswer(l)) {
                return (
                  <Space size={0}>
                    <Button type="link" size="small" onClick={() => run((c) => answerLoanAsLender(c, l.id, { workspaceId, agree: true }), L('已同意借出', 'Agreed'))}>
                      {L('同意', 'Agree')}
                    </Button>
                    <Button type="link" size="small" danger onClick={() => setDeclining(l)}>
                      {L('不同意', 'Decline')}
                    </Button>
                  </Space>
                );
              }
              return mine ? B(LENDER_DECISION_LABELS[mine.decision]) : '—';
            },
          },
        ]}
      />
      {declining && (
        <NoteModal
          title={`${L('不同意借出', 'Decline')} · ${declining.resourceId}`}
          required
          placeholder={L('原因，例如：本周路测在用', 'Reason, e.g. on road tests this week')}
          onClose={() => setDeclining(null)}
          onOk={(note) => run((c) => answerLoanAsLender(c, declining.id, { workspaceId, agree: false, note }), L('已答复', 'Answered')) !== undefined}
        />
      )}
    </Card>
  );
}

function ApprovalsCard() {
  const state = useEngineState();
  const actor = useActor()!;
  const run = useRun();
  const { L, B } = useI18n();
  const [rejecting, setRejecting] = useState<Loan | null>(null);
  const [recalling, setRecalling] = useState<Loan | null>(null);
  const loans = managedLoans(state, actor);
  const requested = loans.filter((l) => l.status === 'REQUESTED');
  const active = loans.filter((l) => l.status === 'APPROVED');
  const ended = loans.filter((l) => l.status !== 'REQUESTED' && l.status !== 'APPROVED');
  const base = [
    { title: L('车辆', 'Vehicle'), render: (_: unknown, l: Loan) => <Mono>{l.resourceId}</Mono> },
    { title: L('借用方', 'Borrower'), render: (_: unknown, l: Loan) => `${wsName(state, l.workspaceId)} · ${state.vehicleGroups[l.vehicleGroupId]?.name ?? '—'}` },
    { title: L('用途', 'Purpose'), dataIndex: 'purpose' },
    { title: L('最后一天', 'Last day'), render: (_: unknown, l: Loan) => <Typography.Text type={isOverdue(state, l) ? 'danger' : undefined}>{day(l.dueDate)}</Typography.Text> },
    { title: L('状态', 'Status'), render: (_: unknown, l: Loan) => <LoanStatusTag loan={l} /> },
  ];
  return (
    <Card title={L('借用审批（车辆资源）', 'Loan approvals (vehicle resources)')}>
      <Tabs
        size="small"
        items={[
          {
            key: 'requested',
            label: `${L('待审批', 'To decide')} · ${requested.length}`,
            children: (
              <Table
                rowKey="id"
                size="small"
                pagination={false}
                dataSource={requested}
                scroll={{ x: 'max-content' }}
                locale={{ emptyText: L('没有待审批的借用', 'No loans to decide') }}
                columns={[
                  ...base,
                  {
                    title: L('检查', 'Checks'),
                    render: (_: unknown, l: Loan) => {
                      const problems = approvalProblems(state, l);
                      return problems.length ? problems.map((p) => <div key={p}><Typography.Text type="warning">{B(issueLabel(p), p)}</Typography.Text></div>) : <Tag color="green">{L('可以借出', 'Can be lent')}</Tag>;
                    },
                  },
                  {
                    title: '',
                    render: (_: unknown, l: Loan) => (
                      <Space size={0}>
                        <Tooltip title={l.requestedBy === actor.username ? L('不能审批自己的申请', 'Nobody decides their own request') : undefined}>
                          <Button type="link" size="small" disabled={approvalProblems(state, l).length > 0 || l.requestedBy === actor.username} onClick={() => run((c) => decideLoan(c, l.id, { approve: true }), L('已批准借用', 'Loan approved'))}>
                            {L('批准', 'Approve')}
                          </Button>
                        </Tooltip>
                        <Button type="link" size="small" danger disabled={l.requestedBy === actor.username} onClick={() => setRejecting(l)}>
                          {L('驳回', 'Reject')}
                        </Button>
                      </Space>
                    ),
                  },
                ]}
              />
            ),
          },
          {
            key: 'active',
            label: `${L('借出中', 'On loan')} · ${active.length}`,
            children: (
              <Table
                rowKey="id"
                size="small"
                pagination={false}
                dataSource={active}
                scroll={{ x: 'max-content' }}
                locale={{ emptyText: L('没有借出中的车辆', 'Nothing on loan') }}
                columns={[
                  ...base,
                  {
                    title: '',
                    render: (_: unknown, l: Loan) => {
                      const ext = l.extensions.find((x) => x.status === 'PENDING');
                      return (
                        <Space size={0} wrap>
                          {ext && (
                            <Tooltip title={ext.reason}>
                              <Button type="link" size="small" onClick={() => run((c) => decideExtension(c, l.id, true), L('已批准延期', 'Extension approved'))}>
                                {L(`批准延期至 ${ext.dueDate}`, `Extend to ${ext.dueDate}`)}
                              </Button>
                            </Tooltip>
                          )}
                          {ext && (
                            <Button type="link" size="small" onClick={() => run((c) => decideExtension(c, l.id, false), L('已驳回延期', 'Extension rejected'))}>
                              {L('驳回延期', 'Reject extension')}
                            </Button>
                          )}
                          <Button type="link" size="small" danger onClick={() => setRecalling(l)}>
                            {L('收回', 'Recall')}
                          </Button>
                        </Space>
                      );
                    },
                  },
                ]}
              />
            ),
          },
          {
            key: 'ended',
            label: `${L('历史', 'History')} · ${ended.length}`,
            children: (
              <Table
                rowKey="id"
                size="small"
                pagination={{ pageSize: 10, hideOnSinglePage: true }}
                dataSource={ended}
                scroll={{ x: 'max-content' }}
                columns={[
                  ...base,
                  { title: L('说明', 'Note'), render: (_: unknown, l: Loan) => [l.decisionNote, l.endNote].filter(Boolean).join(' · ') || '—' },
                  { title: L('结束', 'Ended'), render: (_: unknown, l: Loan) => (l.endedAt ? `${state.accounts[l.endedBy ?? '']?.displayName ?? l.endedBy} · ${when(l.endedAt)}` : l.decidedAt ? when(l.decidedAt) : '—') },
                ]}
              />
            ),
          },
        ]}
      />
      {rejecting && (
        <NoteModal
          title={`${L('驳回借用', 'Reject loan')} · ${rejecting.resourceId}`}
          required
          placeholder={L('原因', 'Reason')}
          onClose={() => setRejecting(null)}
          onOk={(note) => run((c) => decideLoan(c, rejecting.id, { approve: false, note }), L('已驳回', 'Rejected')) !== undefined}
        />
      )}
      {recalling && (
        <NoteModal
          title={`${L('收回车辆', 'Recall vehicle')} · ${recalling.resourceId}`}
          required
          placeholder={L('原因，例如：到期未还、需要年检', 'Reason, e.g. overdue, due for inspection')}
          onClose={() => setRecalling(null)}
          onOk={(note) => run((c) => recallLoan(c, recalling.id, note), L('已收回', 'Recalled')) !== undefined}
        />
      )}
    </Card>
  );
}

/** The 借用 tab: a workspace admin borrows and lends; vehicle resources approve. */
export function LoansPanel() {
  const actor = useActor()!;
  const can = useCan();
  const { workspace } = useWorkspace();
  const { L } = useI18n();
  if (!workspace) return null;
  const admin = ENVS.some((env) => can('loan.request', { workspaceId: workspace.id, env }));
  const resources = actor.grants.some((g) => g.role === 'VEHICLE_RESOURCE');
  return (
    <Space orientation="vertical" size={16} style={{ width: '100%' }}>
      {!admin && !resources && <Alert type="info" showIcon title={L('借用由工作区管理员申请、车辆资源审批。', 'Workspace admins ask for loans; vehicle resources approve them.')} />}
      {admin && <BorrowedCard workspaceId={workspace.id} />}
      {admin && <LentCard workspaceId={workspace.id} />}
      {resources && <ApprovalsCard />}
    </Space>
  );
}
