// Integration versions (集成版本): integration calls for target whole-vehicle integration versions
// (集成征集), where integration asks every module for its DCL policy version, checks the list is
// complete, sends it to integration testing round by round and has the passing round released;
// and the release history (发布记录) of every software version and policy set of the model.

import { Alert, Button, Card, Checkbox, Col, Descriptions, Empty, Flex, Form, Input, Modal, Radio, Row, Segmented, Select, Space, Steps, Table, Tabs, Tag, Timeline, Tooltip, Typography } from 'antd';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { useCan, useCanOpen, useRun, useWorkspace } from '../app/hooks.ts';
import { navigate } from '../app/router.ts';
import { useEngineState } from '../app/store.ts';
import { Hint, LabelTag, Mono, PageHeader, when } from '../components/common.tsx';
import { LineTag } from '../components/patch.tsx';
import { PromoteModal } from '../components/promote.tsx';
import { callPhase, callsOf, closeUnchanged, cancelCall, defaultModules, excludeModule, isOverdueCall, isStale, moduleName, openCall, openRound, previewCall, remindModules, retargetCall, returnModules, submitDomain, submitGroup, waitingModules } from '../engine/calls.ts';
import type { CallPhase } from '../engine/calls.ts';
import { displayName } from '../engine/config.ts';
import { releaseHistory, setsOverTime, softwareVersionsOf, vehiclesOnVersion, vehiclesRunning, versionHistory } from '../engine/history.ts';
import type { HistoryEntry } from '../engine/history.ts';
import { collectibleSubsystems, defaultScope, isMergeWorkspace, verifiedSources } from '../engine/integration.ts';
import { applicableVersions, releasesOf, setInEffect, versionsInEffect } from '../engine/release.ts';
import type { CallModule, IntegrationCall, State } from '../engine/types.ts';
import { useI18n } from '../i18n/i18n.tsx';
import {
  CALL_MODULE_STATUS_COLORS,
  CALL_MODULE_STATUS_LABELS,
  CALL_PHASE_COLORS,
  CALL_PHASE_LABELS,
  CANDIDATE_STATUS_LABELS,
  PLAN_STATUS_LABELS,
  ROUND_OUTCOME_LABELS,
  SOFTWARE_STATUS_LABELS,
  setName,
} from '../i18n/vocab.ts';

export function VersionsPage({ tab = 'calls', id, sub }: { tab?: string; id?: string; sub?: string }) {
  const { L } = useI18n();
  const { workspace } = useWorkspace();
  if (!workspace) return <div className="kz-page"><Empty /></div>;
  return (
    <div className="kz-page">
      <PageHeader
        title={L('集成版本', 'Integration versions')}
        subtitle={L(`${workspace.vehicleModelId} · 整车集成版本按车型各自征集、测试和发布`, `${workspace.vehicleModelId} · whole-vehicle integration versions are called, tested and released per vehicle model`)}
      />
      <Tabs
        activeKey={tab}
        onChange={(k) => navigate(`versions/${k}`)}
        items={[
          { key: 'calls', label: L('集成征集', 'Integration calls'), children: id ? <CallDetail callId={id} /> : <CallList /> },
          { key: 'history', label: L('发布记录', 'Release history'), children: <HistoryTab view={id === 'set' ? 'set' : 'version'} selected={sub} /> },
        ]}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------

function PhaseTag({ phase }: { phase: CallPhase }) {
  return <LabelTag map={CALL_PHASE_LABELS} value={phase} color={CALL_PHASE_COLORS[phase]} />;
}

function scopeText(L: (zh: string, en: string) => string, scope: string): string {
  return scope === 'Vehicle' ? L('整车', 'Whole vehicle') : L(`${scope} 子系统`, `${scope} subsystem`);
}

function CallList() {
  const state = useEngineState();
  const { L, B } = useI18n();
  const can = useCan();
  const { workspace } = useWorkspace();
  const [opening, setOpening] = useState(false);
  const ws = workspace!;
  const scope = defaultScope(ws);
  const mine = waitingModules(state, ws.id);
  const canOpen = isMergeWorkspace(state, ws.id) && can('call.manage', { workspaceId: ws.id, scope });
  const list = callsOf(state, ws.vehicleModelId).filter((c) => c.scope === 'Vehicle' || c.workspaceId === ws.id || c.modules.some((m) => m.workspaceId === ws.id));
  return (
    <Space orientation="vertical" size={16} style={{ width: '100%' }}>
      <Hint>
        {L(
          '像整车软件集成一样发布整车集成版本：集成管理员为目标版本发起征集，叶子模块（业务组）由本组研发提交已验证的版本，上层模块（域集成）由域工作区管理员或配置集成提交子系统发布；收齐后合并、经 DCL 处理确认送测，每一轮是一个测试集成版本；通过的一轮由配置发布发布为策略集，并记录与目标整车集成版本的对应关系。',
          'Whole-vehicle integration versions are released the way vehicle software is integrated: integration opens a call for a target version; leaf modules (business groups) submit their Verified version through their developers, upper modules (domain integration) submit their subsystem release through the domain workspace’s admin or integration; the complete list is merged, confirmed by DCL and sent to testing, each round a test integration version; configuration release publishes the passing round as a policy set related to the target version.',
        )}
      </Hint>
      {mine.length > 0 && (
        <Alert
          type="warning"
          showIcon
          title={L(`本工作区有 ${mine.length} 个模块待提交`, `${mine.length} module(s) of this workspace to submit`)}
          description={
            <Space orientation="vertical" size={2}>
              {mine.map(({ call, module: m }) => (
                <a key={`${call.id}-${m.key}`} onClick={() => navigate(`versions/calls/${call.id}`)}>
                  {`${call.title} · ${moduleName(state, m)} · ${B(CALL_MODULE_STATUS_LABELS[m.status])}`}
                </a>
              ))}
            </Space>
          }
        />
      )}
      <Card
        title={L('集成征集', 'Integration calls')}
        extra={canOpen && <Button type="primary" onClick={() => setOpening(true)}>{scope === 'Vehicle' ? L('发起集成征集', 'Open a call') : L('开子征集', 'Open a domain call')}</Button>}
      >
        <Table
          rowKey="id"
          size="small"
          pagination={false}
          scroll={{ x: 'max-content' }}
          dataSource={list}
          locale={{ emptyText: L('还没有集成征集', 'No integration calls yet') }}
          onRow={(c) => ({ onClick: () => navigate(`versions/calls/${c.id}`), style: { cursor: 'pointer' } })}
          columns={[
            {
              title: L('目标整车集成版本', 'Target version'),
              render: (_, c) => (
                <Space size={4} wrap>
                  <a>{c.title}</a>
                  {c.scope !== 'Vehicle' && <Tag color="purple">{scopeText(L, c.scope)}</Tag>}
                </Space>
              ),
            },
            { title: L('阶段', 'Phase'), render: (_, c) => <PhaseTag phase={callPhase(state, c)} /> },
            {
              title: L('收齐', 'Answered'),
              render: (_, c) => {
                const taking = c.modules.filter((m) => m.status !== 'EXCLUDED');
                const answered = taking.filter((m) => m.status === 'SUBMITTED' || m.status === 'NO_CHANGE');
                return `${answered.length}/${taking.length}`;
              },
            },
            { title: L('轮次', 'Rounds'), render: (_, c) => c.rounds.filter((r) => r.candidateId).length || '—' },
            { title: L('截止', 'Due'), render: (_, c) => (c.dueDate ? <Typography.Text type={isOverdueCall(state, c) ? 'danger' : undefined}>{c.dueDate}</Typography.Text> : '—') },
            { title: L('发起', 'Opened'), render: (_, c) => `${state.accounts[c.createdBy]?.displayName ?? c.createdBy} · ${when(c.createdAt)}` },
          ]}
        />
      </Card>
      {opening && <OpenCallModal onClose={() => setOpening(false)} />}
    </Space>
  );
}

function OpenCallModal({ onClose, parentCallId }: { onClose: () => void; parentCallId?: string }) {
  const state = useEngineState();
  const { L } = useI18n();
  const run = useRun();
  const { workspace } = useWorkspace();
  const parentCall = parentCallId ? state.integrationCalls[parentCallId] : undefined;
  const ws = parentCall ? state.workspaces[parentCall.modules.find((m) => m.kind === 'DOMAIN' && m.workspaceId === workspace?.id)?.workspaceId ?? workspace!.id]! : workspace!;
  const scope = defaultScope(ws);
  const domain = scope !== 'Vehicle';
  const parents = callsOf(state, ws.vehicleModelId).filter(
    (c) => c.scope === 'Vehicle' && c.status === 'OPEN' && c.modules.some((m) => m.kind === 'DOMAIN' && m.domain === scope && m.workspaceId === ws.id),
  );
  const modules = defaultModules(state, ws.id, scope);
  const recorded = softwareVersionsOf(state, ws.vehicleModelId).filter((v) => v.status === 'RECORDED');
  const [form] = Form.useForm<{ targetVersion: string; title: string; baseVersion: string; dueDate: string; parentCallId: string; modules: string[] }>();
  return (
    <Modal
      open
      title={domain ? L('开子征集', 'Open a domain call') : L('发起集成征集', 'Open an integration call')}
      okText={L('发起', 'Open')}
      onCancel={onClose}
      onOk={() =>
        form.validateFields().then((v) => {
          const id = run(
            (c) =>
              openCall(c, {
                workspaceId: ws.id,
                scope,
                targetVersion: v.targetVersion,
                title: v.title,
                baseVersion: v.baseVersion ?? null,
                dueDate: v.dueDate || null,
                parentCallId: domain ? v.parentCallId : null,
                exclude: modules.map((m) => m.key).filter((k) => !(v.modules ?? []).includes(k)),
              }),
            L('已发起；各模块会收到待提交的通知', 'Opened; every module is asked to submit'),
          );
          if (id !== undefined) {
            onClose();
            navigate(`versions/calls/${id}`);
          }
        })
      }
    >
      <Form form={form} name="open-call" layout="vertical" initialValues={{ baseVersion: recorded[0]?.version, modules: modules.map((m) => m.key), parentCallId: parentCallId ?? parents[0]?.id }}>
        {domain ? (
          <Form.Item name="parentCallId" label={L('响应的整车征集', 'Whole-vehicle call answered')} rules={[{ required: true }]} extra={L('目标版本跟随整车征集；子征集发布的子系统发布会自动提交给整车征集。', 'The target follows the whole-vehicle call; the subsystem release it publishes is submitted to that call by itself.')}>
            <Select options={parents.map((c) => ({ value: c.id, label: c.title }))} placeholder={L('没有在征集本域的整车征集', 'No whole-vehicle call collects this domain')} />
          </Form.Item>
        ) : (
          <>
            <Form.Item
              name="targetVersion"
              label={L('目标整车集成版本', 'Target whole-vehicle integration version')}
              rules={[{ required: true }]}
              extra={L('软件还没有发布时，平台建一个规划版本；第一轮送测前可以改名，送测后固定。', 'If the software is not released yet, the platform plans the version; it can change until the first round is sent to testing.')}
            >
              <Input placeholder={L('例如 1.2', 'e.g. 1.2')} />
            </Form.Item>
            <Form.Item name="title" label={L('名称（可选）', 'Name (optional)')}>
              <Input placeholder={L('默认：车型 + 版本，例如 X89 1.2', 'Default: model and version, e.g. X89 1.2')} />
            </Form.Item>
            <Form.Item name="baseVersion" label={L('基线软件版本', 'Base software version')} extra={L('规划版本的软件清单（信号与数据源）先从这里复制。', 'The planned version’s manifest (signals and sources) is copied from it.')}>
              <Select allowClear options={recorded.map((v) => ({ value: v.version, label: `${v.vehicleModelId} ${v.version}` }))} />
            </Form.Item>
          </>
        )}
        <Form.Item name="dueDate" label={L('截止日期（可选）', 'Due date (optional)')}>
          <Input type="date" />
        </Form.Item>
        <Form.Item name="modules" label={L('参加的模块', 'Modules taking part')} rules={[{ required: true, type: 'array', min: 1 }]}>
          <Checkbox.Group>
            <Space orientation="vertical">
              {modules.map((m) => (
                <Checkbox key={m.key} value={m.key}>
                  <ModuleName module={m} />
                </Checkbox>
              ))}
            </Space>
          </Checkbox.Group>
        </Form.Item>
      </Form>
    </Modal>
  );
}

function ModuleName({ module: m }: { module: Pick<CallModule, 'kind' | 'groupId' | 'domain' | 'workspaceId'> }) {
  const state = useEngineState();
  const { L } = useI18n();
  return (
    <Space size={4} wrap>
      {m.kind === 'GROUP' ? (
        <>
          <Mono>{state.groups[m.groupId!]?.code}</Mono>
          <span>{state.groups[m.groupId!]?.name}</span>
          <Tag>{L('叶子 · 业务组', 'leaf · group')}</Tag>
        </>
      ) : (
        <>
          <span>{state.workspaces[m.workspaceId]?.name ?? m.domain}</span>
          <Tag color="purple">{L(`上层 · ${m.domain} 域集成`, `upper · ${m.domain} domain`)}</Tag>
        </>
      )}
    </Space>
  );
}

const PHASE_STEP: Record<CallPhase, number> = { COLLECTING: 0, COMPLETE: 1, MERGING: 2, TESTING: 2, PASSED: 3, RELEASED: 4, CANCELLED: 0, NO_CHANGE: 1 };

function CallDetail({ callId }: { callId: string }) {
  const state = useEngineState();
  const { L, B } = useI18n();
  const can = useCan();
  const canOpen = useCanOpen();
  const run = useRun();
  const [promoting, setPromoting] = useState(false);
  const [submitting, setSubmitting] = useState<CallModule | null>(null);
  const [asking, setAsking] = useState<{ kind: 'return' | 'exclude' | 'cancel' | 'retarget'; module?: CallModule } | null>(null);
  const [childFor, setChildFor] = useState<string | null>(null);
  const call = state.integrationCalls[callId];
  if (!call) return <Empty description={L('没有这个集成征集', 'No such integration call')} />;
  const phase = callPhase(state, call);
  const open = call.status === 'OPEN';
  const manage = open && can('call.manage', { workspaceId: call.workspaceId, scope: call.scope });
  const merge = open && can('merge.manage', { workspaceId: call.workspaceId, scope: call.scope });
  const round = openRound(state, call);
  const candidate = round?.candidateId ? state.candidates[round.candidateId] : undefined;
  const sv = call.scope === 'Vehicle' ? state.softwareVersions[`${call.vehicleModelId}::${call.targetVersion}`] : undefined;
  const parent = call.parentCallId ? state.integrationCalls[call.parentCallId] : undefined;
  const children = Object.values(state.integrationCalls).filter((c) => c.parentCallId === call.id);
  const waiting = call.modules.filter((m) => m.status === 'WAITING' || m.status === 'RETURNED');
  const allUnchanged = call.modules.every((m) => m.status === 'NO_CHANGE' || m.status === 'EXCLUDED');
  const inTest = round?.candidateId ? (state.candidates[round.candidateId]?.label ?? null) : null;
  const canSubmit = (m: CallModule) =>
    open && m.status !== 'EXCLUDED' && (m.kind === 'GROUP' ? can('call.submitGroup', { workspaceId: m.workspaceId, groupId: m.groupId! }) : can('call.submitDomain', { workspaceId: m.workspaceId, scope: m.domain! }));

  const steps = [L('征集', 'Call'), L('收齐', 'Complete'), L('送测', 'Testing'), L('测试通过', 'Passed'), L('发布', 'Released')];
  return (
    <Space orientation="vertical" size={16} style={{ width: '100%' }}>
      <a onClick={() => navigate('versions/calls')}>{L('← 全部集成征集', '← All integration calls')}</a>
      <Card
        title={
          <Space size={8} wrap>
            <span>{call.title}</span>
            <PhaseTag phase={phase} />
            {call.scope !== 'Vehicle' && <Tag color="purple">{scopeText(L, call.scope)}</Tag>}
          </Space>
        }
        extra={
          call.scope === 'Vehicle' && (
            <Button size="small" onClick={() => navigate(`versions/history/version/${call.targetVersion}`)}>
              {L('发布记录', 'Release history')}
            </Button>
          )
        }
      >
        <Steps
          size="small"
          current={PHASE_STEP[phase]}
          status={phase === 'CANCELLED' ? 'error' : phase === 'RELEASED' || phase === 'NO_CHANGE' ? 'finish' : 'process'}
          items={steps.map((title) => ({ title }))}
          style={{ marginBottom: 16 }}
        />
        <Descriptions size="small" column={{ xs: 1, md: 2 }} bordered>
          <Descriptions.Item label={L('目标整车集成版本', 'Target version')}>
            <Space size={4} wrap>
              <Mono>{`${call.vehicleModelId} ${call.targetVersion}`}</Mono>
              {sv && <Tag color={sv.status === 'PLANNED' ? 'gold' : 'green'}>{B(SOFTWARE_STATUS_LABELS[sv.status])}</Tag>}
            </Space>
          </Descriptions.Item>
          <Descriptions.Item label={L('范围', 'Scope')}>{scopeText(L, call.scope)}</Descriptions.Item>
          <Descriptions.Item label={L('发起', 'Opened')}>{`${state.accounts[call.createdBy]?.displayName ?? call.createdBy} · ${when(call.createdAt)} · ${state.workspaces[call.workspaceId]?.name}`}</Descriptions.Item>
          <Descriptions.Item label={L('截止', 'Due')}>
            {call.dueDate ? <Typography.Text type={isOverdueCall(state, call) ? 'danger' : undefined}>{call.dueDate}</Typography.Text> : '—'}
          </Descriptions.Item>
          {call.baseVersion && <Descriptions.Item label={L('基线软件版本', 'Base software')}>{`${call.vehicleModelId} ${call.baseVersion}`}</Descriptions.Item>}
          {parent && (
            <Descriptions.Item label={L('响应的整车征集', 'Answers')}>
              <a onClick={() => navigate(`versions/calls/${parent.id}`)}>{parent.title}</a>
            </Descriptions.Item>
          )}
          {children.length > 0 && (
            <Descriptions.Item label={L('子征集', 'Domain calls')}>
              <Space size={4} wrap>
                {children.map((c) => (
                  <a key={c.id} onClick={() => navigate(`versions/calls/${c.id}`)}>
                    {c.title} · {B(CALL_PHASE_LABELS[callPhase(state, c)])}
                  </a>
                ))}
              </Space>
            </Descriptions.Item>
          )}
          {call.releaseId && (
            <Descriptions.Item label={L('发布结果', 'Result')}>
              {L(
                `${B(setName(state.releases[call.releaseId]!.dclVersion))} ↔ 整车集成版本 ${call.vehicleModelId} ${call.targetVersion}`,
                `${B(setName(state.releases[call.releaseId]!.dclVersion))} ↔ integration version ${call.vehicleModelId} ${call.targetVersion}`,
              )}
            </Descriptions.Item>
          )}
          {call.releaseId && sv?.dclModule && (
            <Descriptions.Item label={L('OTA 包内配置模块', 'DCL module in the OTA package')}>
              {L(`${B(setName(state.releases[sv.dclModule.releaseId]!.dclVersion))}：刷 ${call.vehicleModelId} ${call.targetVersion} 的量产车随软件生效，不依赖网络`, `${B(setName(state.releases[sv.dclModule.releaseId]!.dclVersion))}: production vehicles flashed with ${call.vehicleModelId} ${call.targetVersion} run it with the software, no network needed`)}
            </Descriptions.Item>
          )}
          {call.subsystemReleaseId && <Descriptions.Item label={L('发布结果', 'Result')}>{state.subsystemReleases[call.subsystemReleaseId]?.label}</Descriptions.Item>}
          {call.note && <Descriptions.Item label={L('说明', 'Note')}>{call.note}</Descriptions.Item>}
        </Descriptions>
        <Flex gap={8} wrap style={{ marginTop: 16 }}>
          {manage && waiting.length > 0 && (
            <Button onClick={() => run((c) => remindModules(c, call.id), L(`已催办 ${waiting.length} 个模块`, `Reminded ${waiting.length} module(s)`))}>{L('催办未提交的模块', 'Remind modules')}</Button>
          )}
          {merge && phase === 'COMPLETE' && (
            <Button
              type="primary"
              onClick={() => {
                if (run((c) => previewCall(c, call.id), L('已生成集成预览，等待 DCL 确认处理', 'Merge previewed; DCL confirms the processing set next')) !== undefined) navigate('integration/merge');
              }}
            >
              {L('收齐，生成集成预览', 'Complete: preview the merge')}
            </Button>
          )}
          {phase === 'MERGING' && canOpen('integration') && (
            <Button onClick={() => navigate('integration/merge')}>{L('去处理集成预览', 'Open the merge preview')}</Button>
          )}
          {candidate && canOpen('integration') && (
            <Button onClick={() => navigate(`integration/${candidate.id}`)}>{L(`查看测试集成版本 ${candidate.label}`, `Open test integration version ${candidate.label}`)}</Button>
          )}
          {phase === 'PASSED' && call.scope === 'Vehicle' && candidate && can('release.promote', { workspaceId: candidate.workspaceId, scope: 'Vehicle' }) && (
            <Button type="primary" onClick={() => setPromoting(true)}>{L('发布', 'Release')}</Button>
          )}
          {manage && allUnchanged && phase !== 'MERGING' && (
            <Button onClick={() => run((c) => closeUnchanged(c, call.id), L('已按"本次无变更"结束', 'Closed with no change'))}>{L('按"本次无变更"结束', 'Close: no change')}</Button>
          )}
          {manage && call.scope === 'Vehicle' && !call.rounds.some((r) => r.candidateId) && <Button onClick={() => setAsking({ kind: 'retarget' })}>{L('修改目标版本', 'Change the target')}</Button>}
          {manage && (
            <Button danger onClick={() => setAsking({ kind: 'cancel' })}>
              {L('取消征集', 'Cancel the call')}
            </Button>
          )}
        </Flex>
      </Card>

      <Card title={L('模块清单', 'Modules')}>
        <Hint>{L('叶子模块由本组业务研发提交；上层模块由域工作区管理员或配置集成提交，也可以先开子征集收集本域各组。', 'Leaf modules are submitted by the group’s developers; upper modules by the domain workspace’s admin or integration, who may first open a domain call for its groups.')}</Hint>
        <Table
          rowKey="key"
          size="small"
          pagination={false}
          scroll={{ x: 'max-content' }}
          dataSource={call.modules}
          expandable={{
            rowExpandable: (m) => m.history.length > 0,
            expandedRowRender: (m) => (
              <Timeline
                items={m.history.map((e) => ({
                  color: e.kind === 'RETURNED' ? 'red' : e.kind === 'SUBMITTED' ? 'green' : 'gray',
                  content: (
                    <span>
                      <LabelTag map={CALL_MODULE_STATUS_LABELS} value={e.kind} color={CALL_MODULE_STATUS_COLORS[e.kind]} />
                      {submissionText(state, e)} {e.note && <Typography.Text type="secondary">{e.note}</Typography.Text>} · {state.accounts[e.by]?.displayName ?? e.by} · {when(e.at)}
                    </span>
                  ),
                }))}
              />
            ),
          }}
          columns={[
            { title: L('模块', 'Module'), render: (_, m) => <ModuleName module={m} /> },
            {
              title: L('提交方', 'Submitted by'),
              render: (_, m) => (
                <Space orientation="vertical" size={0}>
                  <span>{state.workspaces[m.workspaceId]?.name}</span>
                  <Typography.Text type="secondary">{m.kind === 'GROUP' ? L('本组业务研发', 'the group’s developers') : L('域工作区管理员或配置集成', 'domain admin or integration')}</Typography.Text>
                </Space>
              ),
            },
            {
              title: L('状态', 'Status'),
              render: (_, m) => (
                <Space size={4} wrap>
                  <LabelTag map={CALL_MODULE_STATUS_LABELS} value={m.status} color={CALL_MODULE_STATUS_COLORS[m.status]} />
                  {isStale(state, m) && <Tag color="red">{L('提交已失效，需重新提交', 'changed since: submit again')}</Tag>}
                  {m.remindedAt && (m.status === 'WAITING' || m.status === 'RETURNED') && <Tooltip title={when(m.remindedAt)}><Tag color="orange">{L('已催办', 'reminded')}</Tag></Tooltip>}
                </Space>
              ),
            },
            {
              title: L('提交内容', 'Submission'),
              render: (_, m) => (
                <Space orientation="vertical" size={0}>
                  <span>{m.status === 'NO_CHANGE' ? L('本次无变更（沿用目标策略集中的版本）', 'no change (keeps the target set’s version)') : submissionText(state, m) || '—'}</span>
                  {m.note && <Typography.Text type="secondary">{m.note}</Typography.Text>}
                </Space>
              ),
            },
            { title: L('时间', 'When'), render: (_, m) => (m.at ? `${state.accounts[m.by ?? '']?.displayName ?? m.by} · ${when(m.at)}` : '—') },
            {
              title: '',
              render: (_, m) => {
                const child = children.find((c) => c.scope === m.domain && c.status === 'OPEN');
                return (
                  <Space size={0} wrap>
                    {canSubmit(m) && (
                      <Tooltip title={inTest ? L(`${inTest} 正在测试，提交已锁定；要改动请集成管理员退回`, `${inTest} is being tested and submissions are locked; the integration admin sends modules back to change them`) : undefined}>
                        <Button type="link" size="small" disabled={!!inTest} onClick={() => setSubmitting(m)}>
                          {m.status === 'SUBMITTED' || m.status === 'NO_CHANGE' ? L('重新提交', 'Submit again') : L('提交', 'Submit')}
                        </Button>
                      </Tooltip>
                    )}
                    {m.kind === 'DOMAIN' && open && !child && can('call.manage', { workspaceId: m.workspaceId, scope: m.domain! }) && m.status !== 'EXCLUDED' && (
                      <Button type="link" size="small" onClick={() => setChildFor(m.workspaceId)}>
                        {L('开子征集', 'Open a domain call')}
                      </Button>
                    )}
                    {child && (
                      <Button type="link" size="small" onClick={() => navigate(`versions/calls/${child.id}`)}>
                        {L('子征集', 'Domain call')}
                      </Button>
                    )}
                    {manage && (m.status === 'SUBMITTED' || m.status === 'NO_CHANGE') && (
                      <Button type="link" size="small" danger onClick={() => setAsking({ kind: 'return', module: m })}>
                        {L('退回', 'Send back')}
                      </Button>
                    )}
                    {manage && m.status !== 'EXCLUDED' && (
                      <Button type="link" size="small" onClick={() => setAsking({ kind: 'exclude', module: m })}>
                        {L('不参加', 'Leave out')}
                      </Button>
                    )}
                  </Space>
                );
              },
            },
          ]}
        />
      </Card>

      <Card title={L('测试集成版本（轮次）', 'Test integration versions (rounds)')}>
        <Table
          rowKey="planId"
          size="small"
          pagination={false}
          scroll={{ x: 'max-content' }}
          dataSource={call.rounds.map((r, i) => ({ ...r, index: i }))}
          locale={{ emptyText: L('收齐后生成集成预览，DCL 确认后送测，就是第一轮测试集成版本。', 'Once complete, the merge is previewed, confirmed by DCL and sent to testing: the first test integration version.') }}
          columns={[
            {
              title: L('轮次', 'Round'),
              render: (_, r) => {
                const c = r.candidateId ? state.candidates[r.candidateId] : undefined;
                return c ? (canOpen('integration') ? <a onClick={() => navigate(`integration/${c.id}`)}><Mono>{c.label}</Mono></a> : <Mono>{c.label}</Mono>) : <Typography.Text type="secondary">{L('集成预览', 'Merge preview')}</Typography.Text>;
              },
            },
            { title: L('预览', 'Preview'), render: (_, r) => <LabelTag map={PLAN_STATUS_LABELS} value={state.mergePlans[r.planId]?.status ?? '—'} /> },
            { title: L('测试', 'Testing'), render: (_, r) => (r.candidateId ? <LabelTag map={CANDIDATE_STATUS_LABELS} value={state.candidates[r.candidateId]!.status} /> : '—') },
            { title: L('结果', 'Outcome'), render: (_, r) => <LabelTag map={ROUND_OUTCOME_LABELS} value={r.outcome} color={r.outcome === 'RELEASED' ? 'green' : r.outcome === 'CANCELLED' ? 'default' : 'processing'} /> },
            { title: L('原因', 'Reason'), render: (_, r) => (r.reason === 'previewed again' ? L('重新生成了预览', 'previewed again') : r.reason) || '—' },
            { title: L('时间', 'When'), render: (_, r) => `${state.accounts[r.by]?.displayName ?? r.by} · ${when(r.at)}${r.closedAt ? ` → ${when(r.closedAt)}` : ''}` },
          ]}
        />
      </Card>

      {promoting && candidate && <PromoteModal candidate={candidate} onClose={() => setPromoting(false)} />}
      {submitting && <SubmitModal call={call} module={submitting} onClose={() => setSubmitting(null)} />}
      {childFor && <OpenChildModal call={call} workspaceId={childFor} onClose={() => setChildFor(null)} />}
      {asking && <AskModal call={call} ask={asking} onClose={() => setAsking(null)} />}
    </Space>
  );
}

/** What a module (or one of its steps) submitted, by name. */
function submissionText(s: State, x: { featureId: string | null; commitId: string | null; subsystemReleaseId: string | null }): string {
  if (x.featureId) return `${s.features[x.featureId]?.name ?? x.featureId}${x.commitId && s.commits[x.commitId] ? ` · r${String(s.commits[x.commitId]!.sequence).padStart(3, '0')}` : ''}`;
  if (x.subsystemReleaseId) return s.subsystemReleases[x.subsystemReleaseId]?.label ?? x.subsystemReleaseId;
  return '';
}

function SubmitModal({ call, module: m, onClose }: { call: IntegrationCall; module: CallModule; onClose: () => void }) {
  const state = useEngineState();
  const { L } = useI18n();
  const run = useRun();
  const features = m.kind === 'GROUP' ? verifiedSources(state, call.workspaceId, call.scope).filter((f) => f.groupId === m.groupId) : [];
  const subsystems = m.kind === 'DOMAIN' ? collectibleSubsystems(state, call.workspaceId).filter((r) => r.workspaceId === m.workspaceId && r.domain === m.domain) : [];
  const options = m.kind === 'GROUP' ? features.map((f) => ({ value: f.id, label: `${f.name} · ${displayName(state, f.headCommitId!)}` })) : subsystems.map((r) => ({ value: r.id, label: `${r.label} · ${when(r.publishedAt)}` }));
  const [mode, setMode] = useState<'version' | 'none'>(options.length ? 'version' : 'none');
  const [choice, setChoice] = useState<string | undefined>(options[0]?.value);
  const [note, setNote] = useState('');
  const submit = () => {
    const chosen = mode === 'version' ? (choice ?? null) : null;
    const ok = run(
      (c) => (m.kind === 'GROUP' ? submitGroup(c, call.id, m.groupId!, { featureId: chosen, note }) : submitDomain(c, call.id, m.domain!, { subsystemReleaseId: chosen, note })),
      L('已提交', 'Submitted'),
    );
    if (ok !== undefined) onClose();
  };
  return (
    <Modal open title={`${L('提交到', 'Submit to')} ${call.title} · ${moduleName(state, m)}`} okText={L('提交', 'Submit')} okButtonProps={{ disabled: mode === 'version' && !choice }} onOk={submit} onCancel={onClose}>
      <Space orientation="vertical" size={12} style={{ width: '100%' }}>
        {options.length === 0 && (
          <Alert
            type="info"
            showIcon
            title={m.kind === 'GROUP' ? L('本组没有已验证、可收集的 Feature；有改动请先在研发 Feature 里完成验证。', 'The group has no Verified Feature to collect; finish verifying a change under Features first.') : L('本域没有可提交的子系统发布；有改动请先完成子系统集成并发布，或开子征集。', 'The domain has no active subsystem release; integrate and publish one first, or open a domain call.')}
          />
        )}
        <Radio.Group value={mode} onChange={(e) => setMode(e.target.value)}>
          <Space orientation="vertical">
            <Radio value="version" disabled={options.length === 0}>
              {m.kind === 'GROUP' ? L('提交已验证的 Feature', 'A Verified Feature') : L('提交子系统发布', 'A subsystem release')}
            </Radio>
            <Radio value="none">{L('本次无变更（沿用目标策略集中的版本）', 'No change (keep the target set’s version)')}</Radio>
          </Space>
        </Radio.Group>
        {mode === 'version' && options.length > 0 && <Select style={{ width: '100%' }} value={choice} onChange={setChoice} options={options} />}
        <Input.TextArea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={L('说明（可选）', 'Note (optional)')} />
      </Space>
    </Modal>
  );
}

function OpenChildModal({ call, workspaceId, onClose }: { call: IntegrationCall; workspaceId: string; onClose: () => void }) {
  const state = useEngineState();
  const { L } = useI18n();
  const run = useRun();
  const ws = state.workspaces[workspaceId]!;
  const scope = defaultScope(ws);
  const modules = defaultModules(state, ws.id, scope);
  const [chosen, setChosen] = useState<string[]>(modules.map((m) => m.key));
  return (
    <Modal
      open
      title={`${L('开子征集', 'Open a domain call')} · ${ws.name}`}
      okText={L('发起', 'Open')}
      okButtonProps={{ disabled: chosen.length === 0 }}
      onCancel={onClose}
      onOk={() => {
        const id = run((c) => openCall(c, { workspaceId: ws.id, scope, parentCallId: call.id, exclude: modules.map((m) => m.key).filter((k) => !chosen.includes(k)) }), L('已开子征集', 'Domain call opened'));
        if (id !== undefined) {
          onClose();
          navigate(`versions/calls/${id}`);
        }
      }}
    >
      <Hint>{L(`为 ${call.title} 收集 ${scope} 域各组的版本；集成测试通过后发布子系统发布，会自动提交给整车征集。`, `Collects the ${scope} groups’ versions for ${call.title}; the subsystem release published after testing is submitted to the whole-vehicle call by itself.`)}</Hint>
      <Checkbox.Group value={chosen} onChange={(v) => setChosen(v as string[])}>
        <Space orientation="vertical">
          {modules.map((m) => (
            <Checkbox key={m.key} value={m.key}>
              <ModuleName module={m} />
            </Checkbox>
          ))}
        </Space>
      </Checkbox.Group>
    </Modal>
  );
}

function AskModal({ call, ask, onClose }: { call: IntegrationCall; ask: { kind: 'return' | 'exclude' | 'cancel' | 'retarget'; module?: CallModule }; onClose: () => void }) {
  const state = useEngineState();
  const { L } = useI18n();
  const run = useRun();
  const [text, setText] = useState(ask.kind === 'retarget' ? call.targetVersion : '');
  const name = ask.module ? moduleName(state, ask.module) : '';
  const titles = {
    return: L(`退回 ${name}`, `Send ${name} back`),
    exclude: L(`${name} 本次不参加`, `Leave ${name} out`),
    cancel: L('取消征集', 'Cancel the call'),
    retarget: L('修改目标版本', 'Change the target version'),
  };
  const done = {
    return: L('已退回；当前一轮已取消', 'Sent back; the running round was cancelled'),
    exclude: L('已设为不参加', 'Left out'),
    cancel: L('已取消征集', 'Call cancelled'),
    retarget: L('目标版本已修改', 'Target changed'),
  };
  const submit = () => {
    const ok = run((c) => {
      if (ask.kind === 'return') return returnModules(c, call.id, [ask.module!.key], text);
      if (ask.kind === 'exclude') return excludeModule(c, call.id, ask.module!.key, text);
      if (ask.kind === 'cancel') return cancelCall(c, call.id, text);
      return retargetCall(c, call.id, text);
    }, done[ask.kind]);
    if (ok !== undefined) onClose();
  };
  return (
    <Modal open title={titles[ask.kind]} okButtonProps={{ danger: ask.kind !== 'retarget', disabled: !text.trim() }} onOk={submit} onCancel={onClose}>
      {(ask.kind === 'return' || ask.kind === 'exclude') && openRound(state, call)?.candidateId && (
        <Alert type="warning" showIcon style={{ marginBottom: 12 }} title={L('当前一轮的测试集成版本会被取消，下一轮合并新的记录。', 'The running test integration version is cancelled; the next round merges what the call then records.')} />
      )}
      <Input.TextArea
        rows={ask.kind === 'retarget' ? 1 : 3}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={ask.kind === 'retarget' ? L('例如 1.3', 'e.g. 1.3') : ask.kind === 'return' ? L('要改什么，例如：回正误触发偏多，请收紧阈值', 'What must change, e.g. too many false triggers') : L('原因', 'Reason')}
      />
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Release history
// ---------------------------------------------------------------------------

function HistoryTab({ view, selected }: { view: 'version' | 'set'; selected?: string }) {
  const { L } = useI18n();
  return (
    <Space orientation="vertical" size={16} style={{ width: '100%' }}>
      <Hint>
        {L(
          '每一条都来自平台保存的记录：集成征集与各轮测试、策略集发布、适用关系与适用性确认、紧急停用、配置 OTA 的每一步和车辆软件变化。时间线标出每一步之后生效的是哪个策略集。',
          'Every line comes from the platform’s records: integration calls and their rounds, policy set releases, applicability records and checks, emergency stops, every step of configuration OTA, and vehicle software changes. The timeline marks which set is in effect after each step.',
        )}
      </Hint>
      <Segmented
        value={view}
        onChange={(v) => navigate(`versions/history/${v}`)}
        options={[
          { value: 'version', label: L('按整车集成版本', 'By integration version') },
          { value: 'set', label: L('按策略集', 'By policy set') },
        ]}
      />
      {view === 'version' ? <VersionHistory selected={selected} /> : <SetHistory selected={selected} />}
    </Space>
  );
}

function VersionHistory({ selected }: { selected?: string }) {
  const state = useEngineState();
  const { L, B } = useI18n();
  const { workspace } = useWorkspace();
  const model = workspace!.vehicleModelId;
  const versions = softwareVersionsOf(state, model);
  const current = versions.find((v) => v.version === selected) ?? versions[0];
  if (!current) return <Empty description={L('该车型还没有整车集成版本', 'This model has no integration versions yet')} />;
  const entries = versionHistory(state, model, current.version);
  const vehicles = vehiclesOnVersion(state, model, current.version);
  const inEffect = setInEffect(state, model, current.version);
  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} lg={9}>
        <Card size="small" title={L('整车集成版本', 'Integration versions')}>
          <Table
            rowKey="version"
            size="small"
            pagination={false}
            dataSource={versions}
            rowClassName={(v) => (v.version === current.version ? 'kz-row-selected' : '')}
            onRow={(v) => ({ onClick: () => navigate(`versions/history/version/${v.version}`), style: { cursor: 'pointer' } })}
            columns={[
              {
                title: L('版本', 'Version'),
                render: (_, v) => (
                  <Space size={4}>
                    <Mono>{`${model} ${v.version}`}</Mono>
                    {v.status === 'PLANNED' && <Tag color="gold">{B(SOFTWARE_STATUS_LABELS.PLANNED)}</Tag>}
                  </Space>
                ),
              },
              {
                title: L('生效策略集', 'Set in effect'),
                render: (_, v) => {
                  const set = setInEffect(state, model, v.version);
                  return set ? B(setName(set.dclVersion)) : <Typography.Text type="secondary">{L('无', 'none')}</Typography.Text>;
                },
              },
            ]}
          />
        </Card>
      </Col>
      <Col xs={24} lg={15}>
        <Card size="small" title={L(`${model} ${current.version} 的发布记录`, `Release history of ${model} ${current.version}`)}>
          <Descriptions size="small" column={1} bordered style={{ marginBottom: 16 }}>
            <Descriptions.Item label={L('状态', 'Status')}>
              <Space size={4} wrap>
                <Tag color={current.status === 'PLANNED' ? 'gold' : 'green'}>{B(SOFTWARE_STATUS_LABELS[current.status])}</Tag>
                {current.callId && state.integrationCalls[current.callId] && (
                  <a onClick={() => navigate(`versions/calls/${current.callId}`)}>{L(`集成征集 ${state.integrationCalls[current.callId]!.title}`, `Integration call ${state.integrationCalls[current.callId]!.title}`)}</a>
                )}
                {current.status === 'RECORDED' && !current.callId && current.source && <Typography.Text type="secondary">{current.source}</Typography.Text>}
              </Space>
            </Descriptions.Item>
            <Descriptions.Item label={L('当前生效策略集', 'Set in effect now')}>{inEffect ? B(setName(inEffect.dclVersion)) : L('无', 'none')}</Descriptions.Item>
            <Descriptions.Item label={L('OTA 包内配置模块', 'DCL module in the OTA package')}>
              {current.dclModule ? (
                <Space size={4} wrap>
                  <Tag color={current.dclModule.releaseId === inEffect?.id ? 'green' : 'orange'}>{B(setName(state.releases[current.dclModule.releaseId]!.dclVersion))}</Tag>
                  {current.dclModule.releaseId !== inEffect?.id && <Typography.Text type="warning">{L('不是当前生效的策略集：新刷的车会先跑包内版本，再由配置 OTA 补到最新', 'Not the set in effect: newly flashed vehicles start on it and get the newest by configuration OTA')}</Typography.Text>}
                </Space>
              ) : (
                <Typography.Text type="secondary">{L('无：刷这个版本的车要等云端推送配置', 'None: vehicles flashed with it wait for a cloud push')}</Typography.Text>
              )}
            </Descriptions.Item>
            <Descriptions.Item label={L('先后生效', 'Sets over time')}>
              {setsOverTime(entries).length ? setsOverTime(entries).map((id, i) => <Tag key={i}>{id ? B(setName(state.releases[id]!.dclVersion)) : L('（无）', '(none)')}</Tag>) : '—'}
            </Descriptions.Item>
            <Descriptions.Item label={L('运行此版本的车辆', 'Vehicles on it')}>
              {vehicles.length
                ? (['production', 'testing', 'development'] as const)
                    .map((env) => [env, vehicles.filter((r) => r.env === env)] as const)
                    .filter(([, list]) => list.length)
                    .map(([env, list]) => (
                      <Tooltip key={env} title={list.map((r) => r.id).join(', ')}>
                        <Tag color={env === 'production' ? 'red' : env === 'testing' ? 'gold' : 'geekblue'}>{`${env === 'production' ? L('量产', 'Production') : env === 'testing' ? L('测试', 'Testing') : L('研发', 'Development')} ${list.length}`}</Tag>
                      </Tooltip>
                    ))
                : '—'}
            </Descriptions.Item>
          </Descriptions>
          <HistoryTimeline entries={entries} showEffect />
        </Card>
      </Col>
    </Row>
  );
}

function SetHistory({ selected }: { selected?: string }) {
  const state = useEngineState();
  const { L, B } = useI18n();
  const { workspace } = useWorkspace();
  const model = workspace!.vehicleModelId;
  const releases = releasesOf(state, model);
  const current = releases.find((r) => r.id === selected) ?? releases[0];
  if (!current) return <Empty description={L('该车型还没有发布策略集', 'This model has no policy sets yet')} />;
  const candidate = current.candidateId ? state.candidates[current.candidateId] : undefined;
  const call = candidate?.callId ? state.integrationCalls[candidate.callId] : undefined;
  const running = vehiclesRunning(state, current);
  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} lg={9}>
        <Card size="small" title={L('DCL 策略集版本', 'DCL policy sets')}>
          <Table
            rowKey="id"
            size="small"
            pagination={false}
            dataSource={releases}
            rowClassName={(r) => (r.id === current.id ? 'kz-row-selected' : '')}
            onRow={(r) => ({ onClick: () => navigate(`versions/history/set/${r.id}`), style: { cursor: 'pointer' } })}
            columns={[
              { title: L('策略集', 'Policy set'), render: (_, r) => <Space size={4}><Mono>{r.dclVersion}</Mono><LineTag release={r} /></Space> },
              { title: L('生效于', 'In effect for'), render: (_, r) => versionsInEffect(state, r).map((v) => <Tag key={v}>{v}</Tag>) },
            ]}
          />
        </Card>
      </Col>
      <Col xs={24} lg={15}>
        <Card size="small" title={L(`${B(setName(current.dclVersion))} 的发布记录`, `Release history of ${B(setName(current.dclVersion))}`)}>
          <Descriptions size="small" column={1} bordered style={{ marginBottom: 16 }}>
            <Descriptions.Item label={L('发布', 'Published')}>{`${state.accounts[current.publishedBy]?.displayName ?? current.publishedBy} · ${when(current.publishedAt)}`}{current.notes && ` · ${current.notes}`}</Descriptions.Item>
            <Descriptions.Item label={L('来源', 'From')}>
              <Space size={4} wrap>
                {candidate ? <Mono>{candidate.label}</Mono> : current.emergency ? L('紧急停用', 'Emergency stop') : '—'}
                {call && <a onClick={() => navigate(`versions/calls/${call.id}`)}>{L(`集成征集 ${call.title}`, `Integration call ${call.title}`)}</a>}
              </Space>
            </Descriptions.Item>
            <Descriptions.Item label={L('发布时列入', 'Listed when published')}>{current.vehicleIntegrationVersions.map((v) => <Tag key={v}>{`${model} ${v}`}</Tag>)}</Descriptions.Item>
            <Descriptions.Item label={L('现在适用 / 生效', 'Applies / in effect now')}>
              {applicableVersions(state, current).map((v) => (
                <Tag key={v} color={versionsInEffect(state, current).includes(v) ? 'green' : undefined}>{`${model} ${v}`}</Tag>
              ))}
            </Descriptions.Item>
            <Descriptions.Item label={L('运行它的车辆', 'Vehicles running it')}>{running.length ? running.map((r) => r.id).join(', ') : '—'}</Descriptions.Item>
          </Descriptions>
          <HistoryTimeline entries={releaseHistory(state, current.id)} />
        </Card>
      </Col>
    </Row>
  );
}

const ENTRY_COLORS: Record<string, string> = {
  PUBLISHED: 'green',
  PATCHED: 'purple',
  IN_EFFECT: 'green',
  SUPERSEDED: 'gray',
  APPLICABILITY_ADDED: 'blue',
  APPLICABILITY_WITHDRAWN: 'red',
  EMERGENCY_REQUESTED: 'red',
  EMERGENCY_APPROVED: 'red',
  MODULE_RETURNED: 'red',
  ROUND_CANCELLED: 'red',
  ROUND_PASSED: 'green',
  CALL_CANCELLED: 'red',
  OTA_AUTO_PAUSED: 'red',
  OTA_DROPPED: 'orange',
  OTA_PAUSED: 'orange',
  OTA_ROLLED_BACK: 'orange',
  OTA_CANCELLED: 'gray',
  OTA_COMPLETED: 'green',
};

function HistoryTimeline({ entries, showEffect = false }: { entries: HistoryEntry[]; showEffect?: boolean }) {
  const state = useEngineState();
  const { L, B } = useI18n();
  const text = useEntryText();
  if (entries.length === 0) return <Empty description={L('还没有记录', 'No records yet')} />;
  return (
    <Timeline
      items={entries.map((e) => ({
        key: e.key,
        color: ENTRY_COLORS[e.kind] ?? 'blue',
        content: (
          <Space orientation="vertical" size={0}>
            <span>{text(e)}</span>
            <Space size={4} wrap>
              <Typography.Text type="secondary">{`${e.by ? (state.accounts[e.by]?.displayName ?? e.by) : L('平台', 'Platform')} · ${when(e.at)}`}</Typography.Text>
              {showEffect && e.changed && (
                <Tag color={e.inEffect ? 'green' : 'red'}>{e.inEffect ? L(`此后生效：${B(setName(state.releases[e.inEffect]!.dclVersion))}`, `Then in effect: ${B(setName(state.releases[e.inEffect]!.dclVersion))}`) : L('此后没有生效的策略集', 'Then no set in effect')}</Tag>
              )}
            </Space>
          </Space>
        ),
      }))}
    />
  );
}

/** The sentence for a history entry in the current language. */
function useEntryText(): (e: HistoryEntry) => ReactNode {
  const state = useEngineState();
  const { L, B } = useI18n();
  const { workspace } = useWorkspace();
  const set = (id: string | null) => (id && state.releases[id] ? B(setName(state.releases[id]!.dclVersion)) : '—');
  const mod = (key: string | null) => {
    if (!key) return '';
    return key.startsWith('domain:') ? key.slice(7) : (state.groups[key]?.code ?? key);
  };
  const cars = (ids: string[]) => (ids.length ? ids.join(', ') : '');
  return (e) => {
    const v = e.version ? `${workspace?.vehicleModelId ?? ''} ${e.version}`.trim() : '';
    const reason = e.reason ? `：${e.reason}` : '';
    const reasonEn = e.reason ? `: ${e.reason}` : '';
    switch (e.kind) {
      case 'CALL_OPENED':
        return L(`发起集成征集「${e.reason}」`, `Integration call “${e.reason}” opened`);
      case 'SOFTWARE_PLANNED':
        return L(`规划整车集成版本 ${v}（软件尚未发布）`, `Integration version ${v} planned (software not released)`);
      case 'SOFTWARE_RECORDED':
        return e.callId ? L(`生成整车集成版本 ${v}（集成征集发布）`, `Integration version ${v} recorded by the call’s release`) : L(`登记整车集成版本 ${v}${reason}`, `Integration version ${v} recorded${reasonEn}`);
      case 'MODULE_SUBMITTED':
        return L(`${mod(e.module)} 提交 ${submissionText(state, { featureId: e.featureId, commitId: null, subsystemReleaseId: e.subsystemReleaseId })}${reason}`, `${mod(e.module)} submitted ${submissionText(state, { featureId: e.featureId, commitId: null, subsystemReleaseId: e.subsystemReleaseId })}${reasonEn}`);
      case 'MODULE_NO_CHANGE':
        return L(`${mod(e.module)} 本次无变更${reason}`, `${mod(e.module)}: no change${reasonEn}`);
      case 'MODULE_RETURNED':
        return L(`${mod(e.module)} 被退回${reason}`, `${mod(e.module)} sent back${reasonEn}`);
      case 'MODULE_EXCLUDED':
        return L(`${mod(e.module)} 不参加${reason}`, `${mod(e.module)} left out${reasonEn}`);
      case 'ROUND_FROZEN':
        return L(`送测：测试集成版本 ${e.reason}`, `Sent to testing: test integration version ${e.reason}`);
      case 'ROUND_PASSED':
        return L(`${e.reason} 集成测试通过`, `${e.reason} passed integration testing`);
      case 'ROUND_CANCELLED':
        return e.reason === 'previewed again' ? L('本轮取消：重新生成了预览', 'Round cancelled: previewed again') : L(`本轮取消${reason}`, `Round cancelled${reasonEn}`);
      case 'CALL_CANCELLED':
        return L(`集成征集取消${reason}`, `Integration call cancelled${reasonEn}`);
      case 'CALL_NO_CHANGE':
        return L(`集成征集按"本次无变更"结束${reason}`, `Integration call closed with no change${reasonEn}`);
      case 'PUBLISHED': {
        const r = e.releaseId ? state.releases[e.releaseId] : undefined;
        const listed = r ? r.vehicleIntegrationVersions.join(', ') : '';
        return r?.emergency
          ? L(`发布紧急停用后的 ${set(e.releaseId)}（停用 ${r.emergency.policyId}），列入 ${listed}`, `${set(e.releaseId)} published without ${r.emergency.policyId} (emergency stop), listed for ${listed}`)
          : L(`发布 ${set(e.releaseId)}，列入 ${listed}${reason}`, `${set(e.releaseId)} published for ${listed}${reasonEn}`);
      }
      case 'PATCHED':
        return L(`发布补丁 ${set(e.releaseId)}`, `Patch ${set(e.releaseId)} published`);
      case 'CHECK_OPENED':
        return e.by ? L(`开启适用性确认：${set(e.releaseId)} 用于 ${v}`, `Applicability check opened: ${set(e.releaseId)} for ${v}`) : L(`登记软件后自动开启适用性确认：${set(e.releaseId)} 用于 ${v}`, `Applicability check opened on recording: ${set(e.releaseId)} for ${v}`);
      case 'CHECK_VERIFIED':
        return L(`适用性测试通过：${set(e.releaseId)} 用于 ${v}`, `Applicability verified: ${set(e.releaseId)} for ${v}`);
      case 'CHECK_CONFIRMED':
        return L(`确认适用：${set(e.releaseId)} 用于 ${v}${reason}`, `Applicability confirmed: ${set(e.releaseId)} for ${v}${reasonEn}`);
      case 'CHECK_CANCELLED':
        return L(`适用性确认取消${reason}`, `Applicability check cancelled${reasonEn}`);
      case 'CHECK_SUPERSEDED':
        return L('适用性确认被更新的确认取代', 'Applicability check superseded');
      case 'APPLICABILITY_ADDED':
        return L(`${set(e.releaseId)} 追加适用 ${v}`, `${set(e.releaseId)} added for ${v}`);
      case 'APPLICABILITY_WITHDRAWN':
        return L(`${set(e.releaseId)} 撤销适用 ${v}${reason}`, `${set(e.releaseId)} withdrawn from ${v}${reasonEn}`);
      case 'IN_EFFECT':
        return L(`成为 ${v} 的生效策略集`, `Became the set in effect for ${v}`);
      case 'SUPERSEDED':
        return e.releaseId ? L(`${v} 改由 ${set(e.releaseId)} 生效`, `${set(e.releaseId)} took ${v} over`) : L(`${v} 不再有生效的策略集`, `${v} has no set in effect any more`);
      case 'EMERGENCY_REQUESTED':
        return L(`申请紧急停用${reason}`, `Emergency stop requested${reasonEn}`);
      case 'EMERGENCY_APPROVED':
        return L(`紧急停用已批准，生成 ${set(e.releaseId)}`, `Emergency stop approved: ${set(e.releaseId)}`);
      case 'EMERGENCY_REJECTED':
        return L(`紧急停用未批准${reason}`, `Emergency stop rejected${reasonEn}`);
      case 'OTA_STARTED': {
        const d = e.deploymentId ? state.deployments[e.deploymentId] : undefined;
        return d?.rollbackOf
          ? L(`回滚到 ${set(e.releaseId)}：${cars(e.resourceIds)}${reason}`, `Rolled back to ${set(e.releaseId)}: ${cars(e.resourceIds)}${reasonEn}`)
          : L(`配置 OTA 下发 ${set(e.releaseId)}，首批 ${cars(e.resourceIds) || '—'}`, `Configuration OTA of ${set(e.releaseId)} started, first wave ${cars(e.resourceIds) || '—'}`);
      }
      case 'OTA_EXPANDED':
        return L(`配置 OTA 扩大到 ${cars(e.resourceIds)}`, `Configuration OTA expanded to ${cars(e.resourceIds)}`);
      case 'OTA_PAUSED':
        return L(`配置 OTA 暂停${reason}`, `Configuration OTA paused${reasonEn}`);
      case 'OTA_AUTO_PAUSED':
        return L(`配置 OTA 因车辆失败自动暂停：${cars(e.resourceIds)}`, `Configuration OTA paused by failed vehicles: ${cars(e.resourceIds)}`);
      case 'OTA_RESUMED':
        return e.resourceIds.length ? L(`配置 OTA 恢复，重试 ${cars(e.resourceIds)}`, `Configuration OTA resumed, retrying ${cars(e.resourceIds)}`) : L('配置 OTA 恢复', 'Configuration OTA resumed');
      case 'OTA_COMPLETED':
        return L(`配置 OTA 完成（${set(e.releaseId)}）`, `Configuration OTA of ${set(e.releaseId)} finished`);
      case 'OTA_CANCELLED':
        return L(`配置 OTA 取消${reason}`, `Configuration OTA cancelled${reasonEn}`);
      case 'OTA_ROLLED_BACK':
        return L(`配置 OTA 回滚${reason}`, `Configuration OTA rolled back${reasonEn}`);
      case 'OTA_DROPPED':
        return L(`${cars(e.resourceIds)} 的软件换到 ${e.reason ?? '未知'}，退出本次配置 OTA`, `${cars(e.resourceIds)} moved to software ${e.reason ?? 'unknown'} and left the rollout`);
      case 'VEHICLE_ARRIVED':
        return e.releaseId
          ? L(`${cars(e.resourceIds)} 的软件从 ${e.reason ?? '—'} 换到 ${v}，随 OTA 包生效 ${set(e.releaseId)}`, `${cars(e.resourceIds)} moved from ${e.reason ?? '—'} to ${v}, running ${set(e.releaseId)} from the OTA package`)
          : L(`${cars(e.resourceIds)} 的软件从 ${e.reason ?? '—'} 换到 ${v}`, `${cars(e.resourceIds)} moved from ${e.reason ?? '—'} to ${v}`);
      case 'MODULE_EXPORTED':
        return L(`${set(e.releaseId)} 导出为 ${v} 的 OTA 包内配置模块`, `${set(e.releaseId)} exported as the DCL module of ${v}’s OTA package`);
      case 'VEHICLE_LEFT':
        return L(`${cars(e.resourceIds)} 的软件换到 ${e.reason}`, `${cars(e.resourceIds)} moved to ${e.reason}`);
      default:
        return e.kind;
    }
  };
}
