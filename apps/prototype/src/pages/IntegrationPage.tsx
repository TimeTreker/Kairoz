// Configuration integration (配置集成): collect Verified Features of a project, preview the
// three-way merge, have DCL confirm the final processing set, freeze a candidate, and test the
// candidate independently in the integration workspace.

import { Alert, Badge, Button, Card, Descriptions, Empty, Flex, Input, Modal, Segmented, Space, Steps, Table, Tabs, Tag, Typography } from 'antd';
import { useState } from 'react';
import { useCan, useRun, useWorkspace } from '../app/hooks.ts';
import { navigate } from '../app/router.ts';
import { setSession, useEngineState } from '../app/store.ts';
import { DiffView } from '../components/DiffView.tsx';
import { ApplicabilityChecks } from '../components/applicability.tsx';
import { Hint, LabelTag, Mono, PageHeader, ShortId, StageTag, when } from '../components/common.tsx';
import { DeploymentsTable, DispatchModal, RecordTestModal, TargetsTable } from '../components/testing.tsx';
import { WILDCARD } from '../domain/vocabulary.ts';
import type { Scope } from '../domain/vocabulary.ts';
import { displayName } from '../engine/config.ts';
import { ungroupedVehicles, vehicleGroupsOf } from '../engine/fleet.ts';
import {
  cancelCandidate,
  collectibleSubsystems,
  confirmProcessing,
  currentSubsystem,
  defaultScope,
  freezeCandidate,
  isCollectible,
  isConfirmed,
  isMergeWorkspace,
  latestRelease,
  planGroups,
  previewMerge,
  processingSummary,
  publishSubsystem,
  verifiedSources,
} from '../engine/integration.ts';
import type { Candidate, MergeConflict, MergePlan, State, SubsystemRef, SubsystemRelease } from '../engine/types.ts';
import { cancelDeployment, candidateTestStatus, candidateVehicleProblems, candidateVerifyBlockers, deploymentsOf, dispatchCandidate, recordCandidateTest, verifyCandidate } from '../engine/validation.ts';
import { useI18n } from '../i18n/i18n.tsx';
import { issueLabel } from '../i18n/issues.ts';
import {
  CANDIDATE_STATUS_COLORS,
  CANDIDATE_STATUS_LABELS,
  CONFLICT_OWNER_LABELS,
  FILE_TYPE_LABELS,
  GROUP_CHANGE_COLORS,
  GROUP_CHANGE_LABELS,
  MERGE_SECTION_LABELS,
  PLAN_STATUS_COLORS,
  PLAN_STATUS_LABELS,
  REVIEW_STATUS_LABELS,
  SUBSYSTEM_STATUS_LABELS,
  setName,
} from '../i18n/vocab.ts';

/** The project workspace integration works on, from the current project or integration workspace. */
function projectOf(s: State, workspaceId: string | undefined): string | undefined {
  const ws = workspaceId ? s.workspaces[workspaceId] : undefined;
  if (!ws) return undefined;
  if (isMergeWorkspace(s, ws.id)) return ws.id;
  if (ws.kind === 'INTEGRATION') return ws.sourceWorkspaceIds.find((id) => s.workspaces[id]?.kind === 'PROJECT');
  return undefined;
}

/** A compact rendering of a conflicting value: a whole policy shows its trigger, a whole file its source. */
const short = (v: unknown) => {
  if (v === undefined || v === null) return '—';
  const item = v as { trigger?: string; source?: { unit: string; directory: string; pattern: string } };
  const text =
    typeof v === 'string'
      ? v
      : typeof item.trigger === 'string'
        ? item.trigger
        : item.source
          ? `${item.source.unit} ${item.source.directory}/${item.source.pattern}`
          : JSON.stringify(v);
  return text.length > 60 ? `${text.slice(0, 60)}…` : text;
};

/** A ready preview waits for DCL to confirm its processing set before it can be frozen. */
const planStatus = (s: State, p: MergePlan) => (p.status === 'READY' && !isConfirmed(s, p) ? 'AWAITING_DCL' : p.status);

/** The pinned pipeline version, e.g. default-edge-text-log@1. */
const pipelineName = (s: State, id: string) => {
  const p = s.pipelines[id];
  return p ? `${p.code}@${p.version}` : id;
};

function dataName(s: State, key: string): string {
  return (
    Object.values(s.fileSpecVersions)
      .filter((v) => v.dataKey === key)
      .sort((a, b) => b.version - a.version)[0]?.content.name ?? key
  );
}

/** The names of what went into a merge: Features, then subsystem releases. */
function sourceNames(s: State, x: { sources: { featureId: string }[]; subsystems: SubsystemRef[] }): string[] {
  return [...x.sources.map((f) => s.features[f.featureId]?.name ?? f.featureId), ...x.subsystems.map((r) => s.subsystemReleases[r.subsystemReleaseId]?.label ?? r.subsystemReleaseId)];
}

/** Whether a merge input is still what the preview pinned: an active release (or, inside its own domain, one in a whole-vehicle candidate). */
function subsystemUsable(s: State, plan: MergePlan, ref: SubsystemRef): boolean {
  const r = s.subsystemReleases[ref.subsystemReleaseId];
  return plan.scope === 'Vehicle' ? r?.status === 'ACTIVE' : r?.status === 'ACTIVE' || r?.status === 'INTEGRATING';
}

/** Subsystem releases a workspace shows: its own, or those of its source domain workspaces. */
function subsystemReleasesOf(s: State, workspaceId: string): SubsystemRelease[] {
  const ws = s.workspaces[workspaceId];
  if (!ws) return [];
  return Object.values(s.subsystemReleases)
    .filter((r) => r.workspaceId === ws.id || ws.sourceWorkspaceIds.includes(r.workspaceId))
    .sort((a, b) => a.domain.localeCompare(b.domain) || b.sequence - a.sequence);
}

export function IntegrationPage({ candidateId }: { candidateId?: string }) {
  const state = useEngineState();
  const { L, B } = useI18n();
  const { workspace, access } = useWorkspace();
  const can = useCan();
  const projectId = projectOf(state, workspace?.id);
  // A test-only integration workspace opens on its candidates; a merge workspace on merging.
  const [tab, setTab] = useState<string>(candidateId || (workspace?.kind === 'INTEGRATION' && !isMergeWorkspace(state, workspace.id)) ? 'candidates' : 'merge');

  if (!projectId) {
    // DCL works across projects: list previews waiting for its confirmation.
    const waiting = Object.values(state.mergePlans).filter((p) => p.status === 'READY' && !isConfirmed(state, p));
    return (
      <div className="kz-page">
        <PageHeader title={L('配置集成', 'Integration')} />
        <Alert type="info" showIcon style={{ marginBottom: 16 }} title={L('配置集成在项目工作区或集成测试工作区中进行，请在顶部切换工作区。', 'Integration happens in a project or integration workspace; switch workspace at the top.')} />
        {can('merge.confirmProcessing', {}) && (
          <Card title={L('等待 DCL 确认的处理集合', 'Processing sets awaiting DCL confirmation')}>
            {waiting.length === 0 && <Typography.Text type="secondary">{L('没有等待确认的合并预览。', 'No merge preview is waiting.')}</Typography.Text>}
            {waiting.map((p) => (
              <Flex key={p.id} justify="space-between" align="center" style={{ padding: '8px 0', borderBottom: '1px solid #f0f0f0' }}>
                <Space>
                  <Typography.Text>{state.workspaces[p.workspaceId]?.name}</Typography.Text>
                  <Mono>{p.id}</Mono>
                  <Typography.Text type="secondary">{when(p.createdAt)}</Typography.Text>
                </Space>
                {access.some((a) => a.workspaceId === p.workspaceId) && (
                  <Button size="small" onClick={() => setSession({ workspaceId: p.workspaceId })}>
                    {L('进入该工作区', 'Open workspace')}
                  </Button>
                )}
              </Flex>
            ))}
          </Card>
        )}
      </div>
    );
  }

  const project = state.workspaces[projectId]!;
  const release = latestRelease(state, project.vehicleModelId);
  const domainOnly = !project.scopes.includes('Vehicle');
  const subsystems = subsystemReleasesOf(state, projectId);
  const openChecks = Object.values(state.applicabilityChecks).filter((c) => c.testWorkspaceId === workspace?.id && ['OPEN', 'TESTING'].includes(c.status)).length;
  return (
    <div className="kz-page">
      <PageHeader
        title={L('配置集成', 'Integration')}
        subtitle={`${project.name} · ${project.vehicleModelId}${domainOnly ? ` · ${L('子系统集成', 'Subsystem integration')} ${project.scopes.join(', ')}` : ''} · ${L('目标策略集', 'Target set')}: ${release ? B(setName(release.dclVersion)) : L('无（首次集成）', 'none (first integration)')}`}
      />
      <Tabs
        activeKey={tab}
        onChange={(k) => {
          setTab(k);
          if (candidateId) navigate('integration');
        }}
        items={[
          { key: 'merge', label: L('合并与处理确认', 'Merge & processing'), children: <MergeTab projectId={projectId} onCandidate={(id) => (setTab('candidates'), navigate(`integration/${id}`))} /> },
          { key: 'candidates', label: L('集成候选', 'Candidates'), children: <CandidatesTab projectId={projectId} candidateId={candidateId} /> },
          ...(domainOnly || subsystems.length
            ? [{ key: 'subsystems', label: `${L('子系统发布', 'Subsystem releases')} · ${subsystems.length}`, children: <SubsystemsTab releases={subsystems} /> }]
            : []),
          // The whole-vehicle integration workspace also tests unchanged sets on new software.
          ...(workspace?.kind === 'INTEGRATION' && workspace.scopes.includes('Vehicle')
            ? [
                {
                  key: 'applicability',
                  label: (
                    <Badge count={openChecks} size="small" offset={[8, 0]}>
                      {L('适用性测试', 'Applicability tests')}
                    </Badge>
                  ),
                  children: (
                    <Card title={L('策略集在新软件版本上的适用性测试', 'Testing unchanged policy sets on new software versions')}>
                      <Hint>
                        {L(
                          '策略集内容不变，只验证它能否在新的整车软件版本上运行：向运行该软件的测试车下发、先仿真后实车登记结果并确认验证，再由配置发布确认适用。',
                          'The set’s content is unchanged; the test shows whether it runs on a new whole-vehicle software version: send it to testing vehicles running that software, record results (simulation first) and verify; configuration release then confirms applicability.',
                        )}
                      </Hint>
                      <ApplicabilityChecks modelId={project.vehicleModelId} testWorkspaceId={workspace.id} />
                    </Card>
                  ),
                },
              ]
            : []),
        ]}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Merge preview and DCL confirmation
// ---------------------------------------------------------------------------

function MergeTab({ projectId, onCandidate }: { projectId: string; onCandidate: (id: string) => void }) {
  const state = useEngineState();
  const { L, B } = useI18n();
  const can = useCan();
  const run = useRun();
  const ws = state.workspaces[projectId]!;
  // A workspace may integrate several scopes (the whole vehicle, or one domain as a subsystem).
  const scopeOptions = ws.scopes.filter((sc) => can('merge.manage', { workspaceId: projectId, scope: sc }) || Object.values(state.mergePlans).some((p) => p.workspaceId === projectId && p.scope === sc));
  const [scopeChoice, setScope] = useState<Scope | null>(null);
  const scope: Scope = scopeChoice && scopeOptions.includes(scopeChoice) ? scopeChoice : scopeOptions.includes(defaultScope(ws)) ? defaultScope(ws) : (scopeOptions[0] ?? defaultScope(ws));
  const sources = verifiedSources(state, projectId, scope);
  const [selected, setSelected] = useState<string[]>([]);
  const [selectedSubs, setSelectedSubs] = useState<string[]>([]);
  const canMerge = can('merge.manage', { workspaceId: projectId, scope });
  const plans = Object.values(state.mergePlans).filter((p) => p.workspaceId === projectId && p.scope === scope);
  const current = plans.at(-1);
  const chosen = selected.filter((id) => sources.some((f) => f.id === id));
  const subsystems = scope === 'Vehicle' ? collectibleSubsystems(state, projectId) : [];
  const chosenSubs = selectedSubs.filter((id) => subsystems.some((r) => r.id === id));
  const chain = scope === 'Vehicle' ? undefined : currentSubsystem(state, ws.vehicleModelId, scope);
  const count = chosen.length + chosenSubs.length;

  return (
    <Space orientation="vertical" size={16} style={{ width: '100%' }}>
      {scopeOptions.length > 1 && (
        <Space>
          <Typography.Text type="secondary">{L('集成范围', 'Integration scope')}</Typography.Text>
          <Segmented
            value={scope}
            onChange={(v) => setScope(v as Scope)}
            options={scopeOptions.map((sc) => ({ value: sc, label: sc === 'Vehicle' ? L('整车', 'Whole vehicle') : L(`${sc} 子系统`, `${sc} subsystem`) }))}
          />
        </Space>
      )}
      {scope !== 'Vehicle' && (
        <Alert
          type="info"
          showIcon
          title={L(`${scope} 子系统集成：只收集 ${scope} 域业务分组的 Verified Feature，候选在本域集成工作区测试，通过后由本域配置发布为子系统发布，供整车集成收集。`, `${scope} subsystem integration: only Verified Features of ${scope} business groups; the candidate is tested in this domain workspace and then published by the domain as a subsystem release for whole-vehicle integration.`)}
          description={
            chain
              ? L(`本次合并会自动包含 ${chain.label}（${SUBSYSTEM_STATUS_LABELS[chain.status]!.zh}），新的子系统发布包含它的全部内容。`, `The merge includes ${chain.label} (${SUBSYSTEM_STATUS_LABELS[chain.status]!.en}) by itself, so the new subsystem release contains all of it.`)
              : L('本域还没有子系统发布：首次子系统集成以当前正式版本为目标。', 'The domain has no subsystem release yet: the first one builds on the current formal release.')
          }
        />
      )}
      <Card
        title={`${scope === 'Vehicle' ? L('可集成的 Verified Feature', 'Verified Features to integrate') : L(`${scope} 域可集成的 Verified Feature`, `${scope} Verified Features to integrate`)} · ${sources.length}`}
        extra={
          canMerge && (
            <Button
              type="primary"
              disabled={scope === 'Vehicle' ? count === 0 : chosen.length === 0}
              onClick={() => run((c) => previewMerge(c, { workspaceId: projectId, featureIds: chosen, subsystemReleaseIds: chosenSubs, scope }), L('已生成合并预览', 'Merge previewed'))}
            >
              {L(`预览合并（${count}）`, `Preview merge (${count})`)}
            </Button>
          )
        }
      >
        <Hint>
          {L(
            '只收集来源工作区中当前提交已 Verified 的 Feature。每个 Feature 以自己的基线做三方合并到目标版本上；基线不同本身不是冲突，只有同一项或同一字段被改成不同的值才是冲突。',
            'Only Features whose head commit is Verified, from the source workspaces. Each Feature is merged three-way from its own base onto the target; a different base alone is never a conflict, only the same item or field changed differently is.',
          )}
        </Hint>
        <Table
          rowKey="id"
          size="small"
          pagination={false}
          dataSource={sources}
          rowSelection={canMerge ? { selectedRowKeys: chosen, onChange: (keys) => setSelected(keys as string[]) } : undefined}
          locale={{ emptyText: L('暂无 Verified Feature', 'No Verified Features yet') }}
          columns={[
            { title: 'Feature', render: (_, f) => <a onClick={() => navigate(`features/${f.id}`)}><Mono>{f.name}</Mono></a> },
            { title: L('业务分组', 'Group'), render: (_, f) => <Mono>{state.groups[f.groupId]?.code}</Mono> },
            { title: L('工作区', 'Workspace'), render: (_, f) => state.workspaces[f.workspaceId]?.name },
            { title: L('提交', 'Commit'), render: (_, f) => <Mono>{displayName(state, f.headCommitId!)}</Mono> },
            { title: L('基线', 'Base'), render: (_, f) => (f.baseReleaseId ? B(setName(state.releases[f.baseReleaseId]!.dclVersion)) : L('无', 'none')) },
          ]}
        />
      </Card>
      {scope === 'Vehicle' && (subsystems.length > 0 || ws.sourceWorkspaceIds.some((id) => state.workspaces[id]?.kind === 'INTEGRATION')) && (
        <Card title={`${L('可集成的子系统发布', 'Subsystem releases to integrate')} · ${subsystems.length}`}>
          <Hint>
            {L(
              '各域先做子系统集成并发布；整车集成按域收集最新的子系统发布，与其他 Feature 一起三方合并。子系统发布不是正式版本，也不会下发给量产车。',
              'Domains integrate and publish their subsystems first; whole-vehicle integration collects each domain’s newest subsystem release and merges it three-way with other Features. A subsystem release is not a formal release and never goes to production vehicles.',
            )}
          </Hint>
          <Table
            rowKey="id"
            size="small"
            pagination={false}
            dataSource={subsystems}
            rowSelection={canMerge ? { selectedRowKeys: chosenSubs, onChange: (keys) => setSelectedSubs(keys as string[]) } : undefined}
            locale={{ emptyText: L('暂无可集成的子系统发布', 'No subsystem release to integrate') }}
            columns={[
              { title: L('子系统发布', 'Subsystem release'), render: (_, r) => <Mono>{r.label}</Mono> },
              { title: L('域', 'Domain'), dataIndex: 'domain' },
              { title: L('变更分组', 'Changed groups'), render: (_, r) => <Mono>{Object.keys(r.groups).map((g) => state.groups[g]?.code ?? g).join(', ')}</Mono> },
              { title: L('包含 Feature', 'Features'), render: (_, r) => r.features.map((f) => state.features[f.featureId]?.name).join(', ') },
              { title: L('基线', 'Base'), render: (_, r) => (r.baseReleaseId ? B(setName(state.releases[r.baseReleaseId]!.dclVersion)) : L('无', 'none')) },
              { title: L('发布', 'Published'), render: (_, r) => `${state.accounts[r.publishedBy]?.displayName} · ${when(r.publishedAt)}` },
            ]}
          />
        </Card>
      )}
      {current ? <PlanCard plan={current} onCandidate={onCandidate} /> : <Card><Empty description={L('还没有合并预览', 'No merge preview yet')} /></Card>}
      {plans.length > 1 && (
        <Card size="small" title={L('历史预览', 'Earlier previews')}>
          <Table
            rowKey="id"
            size="small"
            pagination={{ pageSize: 5, hideOnSinglePage: true }}
            dataSource={plans.slice(0, -1).reverse()}
            columns={[
              { title: L('预览', 'Preview'), render: (_, p) => <Mono>{p.id}</Mono> },
              { title: L('状态', 'Status'), render: (_, p) => <LabelTag map={PLAN_STATUS_LABELS} value={planStatus(state, p)} color={PLAN_STATUS_COLORS[planStatus(state, p)]} /> },
              { title: L('来源', 'Sources'), render: (_, p) => sourceNames(state, p).join(', ') },
              { title: L('冲突 / 问题', 'Conflicts / issues'), render: (_, p) => `${p.conflicts.length} / ${p.issues.length}` },
              { title: L('时间', 'When'), render: (_, p) => when(p.createdAt) },
            ]}
          />
        </Card>
      )}
    </Space>
  );
}

function PlanCard({ plan, onCandidate }: { plan: MergePlan; onCandidate: (id: string) => void }) {
  const state = useEngineState();
  const { L, B } = useI18n();
  const can = useCan();
  const run = useRun();
  const [confirming, setConfirming] = useState(false);
  const [freezing, setFreezing] = useState(false);
  const [note, setNote] = useState('');
  const [label, setLabel] = useState('');
  const confirmed = isConfirmed(state, plan);
  const status = planStatus(state, plan);
  const confirmation = state.processingConfirmations.find((c) => c.mergePlanId === plan.id && c.digest === plan.digest);
  const groups = Object.keys(plan.merged);
  const canConfirm = can('merge.confirmProcessing', { workspaceId: plan.workspaceId, groupId: groups.length === 1 ? groups[0]! : WILDCARD });
  const canMerge = can('merge.manage', { workspaceId: plan.workspaceId, scope: plan.scope });
  const candidate = Object.values(state.candidates).find((c) => c.mergePlanId === plan.id);
  const lines = processingSummary(state, plan);
  const release = plan.targetReleaseId ? state.releases[plan.targetReleaseId] : undefined;
  const step = plan.status === 'FROZEN' ? 3 : confirmed ? 2 : plan.status === 'READY' ? 1 : 0;
  const unreviewed = lines.filter((l) => l.requiresReview && l.review?.status !== 'APPROVED');
  const sameLine = Object.values(state.candidates).filter((c) => c.workspaceId === plan.workspaceId && c.scope === plan.scope).length + 1;
  const nextLabel = plan.scope === 'Vehicle' ? `${plan.vehicleModelId}-C${sameLine}` : `${plan.vehicleModelId}-${plan.scope}-C${sameLine}`;
  // A preview is pinned to its source commits; a newer head (or a lost verification) makes it stale.
  const staleSources = ['READY', 'CONFLICT', 'BLOCKED'].includes(plan.status)
    ? plan.sources.filter((x) => {
        const f = state.features[x.featureId];
        return !f || f.headCommitId !== x.commitId || !isCollectible(state, f);
      })
    : [];
  const staleSubsystems = ['READY', 'CONFLICT', 'BLOCKED'].includes(plan.status) ? plan.subsystems.filter((x) => !subsystemUsable(state, plan, x)) : [];

  return (
    <Card
      title={
        <Space>
          {L('合并预览', 'Merge preview')}
          <Mono>{plan.id}</Mono>
          <LabelTag map={PLAN_STATUS_LABELS} value={status} color={PLAN_STATUS_COLORS[status]} />
        </Space>
      }
      extra={
        <Space>
          {plan.status === 'READY' && staleSources.length === 0 && staleSubsystems.length === 0 && !confirmed && canConfirm && (
            <Button type="primary" onClick={() => (setNote(''), setConfirming(true))}>
              {L('确认处理集合', 'Confirm processing set')}
            </Button>
          )}
          {plan.status === 'READY' && staleSources.length === 0 && staleSubsystems.length === 0 && confirmed && canMerge && (
            <Button type="primary" onClick={() => (setLabel(nextLabel), setFreezing(true))}>
              {L('冻结为集成候选', 'Freeze as candidate')}
            </Button>
          )}
          {candidate && <Button onClick={() => onCandidate(candidate.id)}>{L(`查看候选 ${candidate.label}`, `Open candidate ${candidate.label}`)}</Button>}
        </Space>
      }
    >
      <Steps
        size="small"
        current={step}
        status={plan.status === 'CONFLICT' || plan.status === 'BLOCKED' ? 'error' : undefined}
        style={{ marginBottom: 16 }}
        items={[
          { title: L('合并预览', 'Preview') },
          { title: L('DCL 确认处理集合', 'DCL confirms processing') },
          { title: L('冻结候选', 'Freeze candidate') },
        ]}
      />
      <Descriptions size="small" column={{ xs: 1, md: 2 }} style={{ marginBottom: 12 }}>
        <Descriptions.Item label={L('目标策略集', 'Target set')}>{release ? B(setName(release.dclVersion)) : L('无（首次集成）', 'none (first integration)')}</Descriptions.Item>
        <Descriptions.Item label={L('预览摘要', 'Digest')}><ShortId value={plan.digest} /></Descriptions.Item>
        <Descriptions.Item label={L('预览人', 'By')}>{`${state.accounts[plan.createdBy]?.displayName} · ${when(plan.createdAt)}`}</Descriptions.Item>
        <Descriptions.Item label={L('DCL 确认', 'DCL confirmation')}>
          {confirmation ? `${state.accounts[confirmation.confirmedBy]?.displayName} · ${when(confirmation.createdAt)}${confirmation.note ? ` · ${confirmation.note}` : ''}` : L('未确认', 'not yet')}
        </Descriptions.Item>
        <Descriptions.Item label={L('来源', 'Sources')} span={2}>
          <Space wrap>
            {plan.subsystems.map((x) => (
              <Tag key={x.subsystemReleaseId} color="geekblue">
                {state.subsystemReleases[x.subsystemReleaseId]?.label} · {L('子系统发布', 'subsystem release')}
              </Tag>
            ))}
            {plan.sources.map((x) => (
              <Tag key={x.featureId}>
                {state.features[x.featureId]?.name} · {displayName(state, x.commitId)}
              </Tag>
            ))}
          </Space>
        </Descriptions.Item>
      </Descriptions>

      {staleSubsystems.length > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          title={L('子系统发布已变化，此预览已过期；请重新预览合并。', 'A subsystem release changed since this preview; preview the merge again.')}
          description={staleSubsystems
            .map((x) => {
              const r = state.subsystemReleases[x.subsystemReleaseId];
              return `${r?.label ?? x.subsystemReleaseId}: ${r ? B(SUBSYSTEM_STATUS_LABELS[r.status]!) : '—'}`;
            })
            .join(L('；', '; '))}
        />
      )}
      {staleSources.length > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          title={L('来源已变化，此预览已过期；请重新预览合并。', 'Sources changed since this preview; preview the merge again.')}
          description={staleSources
            .map((x) => {
              const f = state.features[x.featureId];
              return `${f?.name ?? x.featureId}: ${displayName(state, x.commitId)} → ${f?.headCommitId ? displayName(state, f.headCommitId) : '—'}`;
            })
            .join('；')}
        />
      )}
      {plan.conflicts.length > 0 && <ConflictsTable conflicts={plan.conflicts} />}
      {plan.issues.length > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          title={L('合并后的完整集合有问题，修正来源 Feature 后重新预览', 'The merged set has problems; fix the source Features and preview again')}
          description={
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {plan.issues.map((i) => (
                <li key={i}>{B(issueLabel(i), i)}</li>
              ))}
            </ul>
          }
        />
      )}
      {plan.status === 'READY' && !confirmed && (
        <Alert
          type={unreviewed.length ? 'warning' : 'info'}
          showIcon
          style={{ marginBottom: 12 }}
          title={
            unreviewed.length
              ? L(`有 ${unreviewed.length} 个敏感文件的合并结果未获批准，DCL 无法确认`, `${unreviewed.length} sensitive file(s) lack an approval of the merged content; DCL cannot confirm`)
              : L('等待 DCL 工程确认最终处理集合（格式、Schema、边缘与云端处理）', 'Waiting for DCL engineering to confirm the final processing set (format, schema, edge and cloud processing)')
          }
        />
      )}

      {groups.length > 0 && plan.status !== 'CONFLICT' && (
        <>
          <Typography.Title level={5}>{L('相对目标版本的变化', 'Changes against the target')}</Typography.Title>
          <Table
            rowKey="groupId"
            size="small"
            pagination={false}
            style={{ marginBottom: 16 }}
            dataSource={planGroups(state, plan)}
            expandable={{
              rowExpandable: (g) => !g.diff.empty,
              expandedRowRender: (g) => <DiffView diff={g.diff} nameOf={(k) => plan.merged[g.groupId]?.files[k]?.name ?? dataName(state, k)} />,
            }}
            columns={[
              { title: L('业务分组', 'Group'), render: (_, g) => <Mono>{state.groups[g.groupId]?.code ?? g.groupId}</Mono> },
              { title: L('变化', 'Change'), render: (_, g) => <LabelTag map={GROUP_CHANGE_LABELS} value={g.change} color={GROUP_CHANGE_COLORS[g.change]} /> },
              {
                title: L('条目', 'Items'),
                render: (_, g) => {
                  const n = (k: 'added' | 'changed' | 'removed') => g.diff.files[k].length + g.diff.policies[k].length + g.diff.references[k].length;
                  return <Mono>{`+${n('added')}  ~${n('changed')}  −${n('removed')}  =${g.inherited}`}</Mono>;
                },
              },
            ]}
          />
          <Typography.Title level={5}>{L('最终处理集合', 'Final processing set')}</Typography.Title>
          <Table
            rowKey={(l) => `${l.groupId}/${l.dataKey}`}
            size="small"
            pagination={false}
            dataSource={lines}
            columns={[
              { title: L('分组', 'Group'), render: (_, l) => <Mono>{state.groups[l.groupId]?.code}</Mono> },
              { title: L('文件', 'File'), render: (_, l) => (l.owned ? l.name : <Space size={4}>{l.name}<Tag>{L('引用', 'reference')}</Tag></Space>) },
              { title: L('类型', 'Type'), render: (_, l) => B(FILE_TYPE_LABELS[l.fileType], l.fileType) },
              { title: L('格式 / Schema', 'Format / schema'), render: (_, l) => <Mono>{`${l.format} · ${l.schema}`}</Mono> },
              { title: L('边缘 / 云端处理', 'Edge / cloud'), render: (_, l) => <Mono>{`${pipelineName(state, l.edgePipelineId)} → ${pipelineName(state, l.cloudPipelineId)}`}</Mono> },
              {
                title: L('敏感审核', 'Sensitive review'),
                render: (_, l) => (!l.requiresReview ? <Typography.Text type="secondary">{L('不需要', 'not needed')}</Typography.Text> : <LabelTag map={REVIEW_STATUS_LABELS} value={l.review?.status ?? 'PENDING'} color={l.review?.status === 'APPROVED' ? 'green' : 'orange'} />),
              },
            ]}
          />
        </>
      )}

      <Modal
        open={confirming}
        title={L('确认最终处理集合', 'Confirm the final processing set')}
        okText={L('确认', 'Confirm')}
        onCancel={() => setConfirming(false)}
        onOk={() => {
          if (run((c) => confirmProcessing(c, plan.id, { note }), L('已确认处理集合', 'Processing set confirmed')) !== undefined) setConfirming(false);
        }}
      >
        <Hint>
          {L(
            '确认绑定在本次预览的摘要上：来源或目标变化后需要重新预览并重新确认。敏感文件须以合并后的内容获得批准。',
            'The confirmation binds to this preview’s digest: any change of sources or target needs a new preview and a new confirmation. Sensitive files need an approval of the merged content.',
          )}
        </Hint>
        <Input.TextArea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={L('说明（可选）', 'Note (optional)')} />
      </Modal>
      <Modal
        open={freezing}
        title={L('冻结为集成候选', 'Freeze as candidate')}
        okText={L('冻结', 'Freeze')}
        onCancel={() => setFreezing(false)}
        onOk={() => {
          const id = run((c) => freezeCandidate(c, plan.id, { label }), L('已冻结候选，交给集成测试', 'Candidate frozen; handed to integration testing'));
          if (id !== undefined) {
            setFreezing(false);
            onCandidate(id);
          }
        }}
      >
        <Hint>
          {L(
            plan.scope === 'Vehicle'
              ? '冻结后生成不可变的合并提交与完整车辆配置；来源 Feature 进入“已集成”。候选的测试从零开始，不继承各 Feature 的测试结果。'
              : '冻结后生成本域的子系统候选，在本域集成工作区测试；通过后由本域配置发布为子系统发布。候选的测试从零开始，不继承各 Feature 的测试结果。',
            plan.scope === 'Vehicle'
              ? 'Freezing creates immutable merge commits and a complete vehicle configuration; the source Features become Integrated. Candidate tests start from zero and inherit no Feature results.'
              : 'Freezing creates the domain’s subsystem candidate, tested in this domain workspace and then published by the domain as a subsystem release. Candidate tests start from zero and inherit no Feature results.',
          )}
        </Hint>
        <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={L('候选名称', 'Candidate name')} />
      </Modal>
    </Card>
  );
}

function ConflictsTable({ conflicts }: { conflicts: MergeConflict[] }) {
  const state = useEngineState();
  const { L, B } = useI18n();
  const nameOf = (c: MergeConflict) => {
    if (c.section === 'policies') return c.key;
    const content = [c.ours, c.theirs, c.base].find((v) => v && typeof v === 'object') as { name?: string } | undefined;
    return content?.name ?? dataName(state, c.key);
  };
  return (
    <div style={{ marginBottom: 16 }}>
      <Alert
        type="error"
        showIcon
        style={{ marginBottom: 8 }}
        title={L(`${conflicts.length} 处冲突`, `${conflicts.length} conflict(s)`)}
        description={L(
          '冲突由所属方解决：业务字段由来源 Feature 修改后重新验证；处理字段（格式、Schema、处理链）由 DCL 调整绑定。配置集成不直接改写内容。',
          'Owners resolve conflicts: business fields in a source Feature, which is then verified again; processing fields (format, schema, pipelines) by DCL changing the binding. Integration never rewrites content itself.',
        )}
      />
      <Table
        rowKey={(c) => `${c.groupId}/${c.section}/${c.key}/${c.field}`}
        size="small"
        pagination={false}
        scroll={{ x: 'max-content' }}
        dataSource={conflicts}
        columns={[
          { title: L('分组', 'Group'), render: (_, c) => <Mono>{state.groups[c.groupId]?.code}</Mono> },
          { title: L('对象', 'Item'), render: (_, c) => <Space size={4} style={{ whiteSpace: 'nowrap' }}><Tag>{B(MERGE_SECTION_LABELS[c.section])}</Tag><Mono>{nameOf(c)}</Mono></Space> },
          { title: L('字段', 'Field'), render: (_, c) => <Mono>{c.field === '*' ? L('整项', 'whole item') : c.field}</Mono> },
          { title: L('基线', 'Base'), render: (_, c) => <Mono>{short(c.base)}</Mono> },
          { title: L('目标 / 先合入', 'Target / merged first'), render: (_, c) => <Mono>{short(c.ours)}</Mono> },
          { title: L('来源', 'Source'), render: (_, c) => <Mono>{short(c.theirs)}</Mono> },
          { title: L('涉及来源', 'Sources'), render: (_, c) => [...c.subsystemReleaseIds.map((id) => state.subsystemReleases[id]?.label), ...c.featureIds.map((id) => state.features[id]?.name)].join(' ↔ ') },
          { title: L('解决方', 'Owner'), render: (_, c) => <LabelTag map={CONFLICT_OWNER_LABELS} value={c.owner} color={c.owner === 'DCL' ? 'purple' : 'blue'} /> },
        ]}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Candidates
// ---------------------------------------------------------------------------

function CandidatesTab({ projectId, candidateId }: { projectId: string; candidateId?: string }) {
  const state = useEngineState();
  const { L } = useI18n();
  const candidates = Object.values(state.candidates)
    .filter((c) => c.workspaceId === projectId)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const selected = candidateId ? state.candidates[candidateId] : undefined;
  return (
    <Space orientation="vertical" size={16} style={{ width: '100%' }}>
      <Card title={L('集成候选', 'Candidates')}>
        <Table
          rowKey="id"
          size="small"
          pagination={false}
          dataSource={candidates}
          locale={{ emptyText: L('还没有冻结的候选', 'No frozen candidates yet') }}
          onRow={(c) => ({ onClick: () => navigate(`integration/${c.id}`), style: { cursor: 'pointer', background: c.id === candidateId ? '#f0f5ff' : undefined } })}
          columns={[
            { title: L('候选', 'Candidate'), render: (_, c) => <Mono>{c.label}</Mono> },
            { title: L('状态', 'Status'), render: (_, c) => <LabelTag map={CANDIDATE_STATUS_LABELS} value={c.status} color={CANDIDATE_STATUS_COLORS[c.status]} /> },
            { title: L('范围', 'Scope'), render: (_, c) => (c.scope === 'Vehicle' ? L('整车', 'Whole vehicle') : L(`${c.scope} 子系统`, `${c.scope} subsystem`)) },
            { title: L('来源', 'Sources'), render: (_, c) => sourceNames(state, c).join(', ') },
            { title: L('冻结', 'Frozen'), render: (_, c) => `${state.accounts[c.createdBy]?.displayName} · ${when(c.createdAt)}` },
          ]}
        />
      </Card>
      {selected && <CandidateDetail candidate={selected} />}
    </Space>
  );
}

function CandidateDetail({ candidate: c }: { candidate: Candidate }) {
  const state = useEngineState();
  const { L, B } = useI18n();
  const can = useCan();
  const run = useRun();
  const [dispatching, setDispatching] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [notes, setNotes] = useState('');
  const open = ['CANDIDATE', 'TESTING', 'VERIFIED'].includes(c.status);
  const target = { workspaceId: c.testWorkspaceId, scope: c.scope };
  const subsystem = c.scope !== 'Vehicle';
  const published = Object.values(state.subsystemReleases).find((r) => r.candidateId === c.id);
  const canPublish = subsystem && c.status === 'VERIFIED' && can('subsystem.publish', { workspaceId: c.workspaceId, scope: c.scope });
  const subsystemCommits = new Map(c.subsystems.flatMap((x) => Object.values(x.groups).map((commitId) => [commitId, state.subsystemReleases[x.subsystemReleaseId]?.label ?? ''] as const)));
  const vehicleGroups = vehicleGroupsOf(state, c.testWorkspaceId).filter((g) => g.status === 'ACTIVE' && g.purpose === 'TEST' && g.env === 'testing');
  const ungrouped = ungroupedVehicles(state, c.testWorkspaceId)
    .filter((r) => r.env === 'testing')
    .map((r) => {
      const problems = candidateVehicleProblems(state, c, r.id);
      const blocked = problems.some((p) => p.endsWith('software version unknown'))
        ? L('非首版候选需要已确认整车版本的车辆', 'a candidate on a release needs vehicles with known software')
        : problems.length
          ? problems.map((p) => B(issueLabel(p), p)).join(L('；', '; '))
          : undefined;
      return { id: r.id, label: `${r.id} · ${r.type === 'SIMULATION' ? L('仿真', 'simulation') : L('实车', 'physical')} · ${r.integrationVersion ?? L('整车版本未知', 'software unknown')}`, blocked };
    });
  const canDispatch = open && can('candidate.dispatch', target);
  const canVerify = c.status === 'TESTING' && can('candidate.verify', target);
  const canCancel = open && can('merge.manage', { workspaceId: c.workspaceId, scope: c.scope });
  const status = candidateTestStatus(state, c);
  const blockers = candidateVerifyBlockers(state, c);
  const resolved = state.resolvedConfigs[c.resolvedConfigId];
  const release = c.targetReleaseId ? state.releases[c.targetReleaseId] : undefined;
  const sourceCommits = new Set(c.sources.map((x) => x.commitId));

  return (
    <>
      <Card
        title={
          <Space>
            {L('候选', 'Candidate')} <Mono>{c.label}</Mono>
            <LabelTag map={CANDIDATE_STATUS_LABELS} value={c.status} color={CANDIDATE_STATUS_COLORS[c.status]} />
          </Space>
        }
        extra={
          canCancel && (
            <Button danger onClick={() => (setReason(''), setCancelling(true))}>
              {L('取消候选', 'Cancel candidate')}
            </Button>
          )
        }
      >
        <Descriptions size="small" column={{ xs: 1, md: 2 }}>
          <Descriptions.Item label={L('目标策略集', 'Target set')}>{release ? B(setName(release.dclVersion)) : L('无（首次集成）', 'none (first integration)')}</Descriptions.Item>
          <Descriptions.Item label={L('集成测试工作区', 'Integration workspace')}>{state.workspaces[c.testWorkspaceId]?.name}</Descriptions.Item>
          <Descriptions.Item label={L('完整车辆配置', 'Vehicle configuration')}>
            <Space size={4}>
              <Mono>{resolved?.label}</Mono>
              <ShortId value={resolved?.digest} />
            </Space>
          </Descriptions.Item>
          <Descriptions.Item label={L('验证', 'Verified')}>{c.verifiedBy ? `${state.accounts[c.verifiedBy]?.displayName} · ${when(c.verifiedAt!)}` : '—'}</Descriptions.Item>
        </Descriptions>
        <Table
          rowKey="groupId"
          size="small"
          pagination={false}
          style={{ marginTop: 12 }}
          dataSource={Object.entries(c.groups).map(([groupId, commitId]) => ({ groupId, commitId }))}
          columns={[
            { title: L('业务分组', 'Group'), render: (_, r) => <Mono>{state.groups[r.groupId]?.code}</Mono> },
            { title: L('提交', 'Commit'), render: (_, r) => <Mono>{displayName(state, r.commitId)}</Mono> },
            {
              title: L('来源', 'Origin'),
              render: (_, r) =>
                release?.groups[r.groupId] === r.commitId ? (
                  <Tag>{L('沿用目标版本', 'from target')}</Tag>
                ) : subsystemCommits.has(r.commitId) ? (
                  <Tag color="geekblue">{L(`子系统发布 ${subsystemCommits.get(r.commitId)}`, `subsystem ${subsystemCommits.get(r.commitId)}`)}</Tag>
                ) : sourceCommits.has(r.commitId) ? (
                  <Tag color="blue">{L('来源 Feature 提交', 'source commit')}</Tag>
                ) : (
                  <Tag color="purple">{L('合并提交', 'merge commit')}</Tag>
                ),
            },
          ]}
        />
        <Typography.Paragraph style={{ marginTop: 12, marginBottom: 0 }}>
          <Space wrap>
            {c.subsystems.map((x) => (
              <Tag key={x.subsystemReleaseId} color="geekblue">
                {state.subsystemReleases[x.subsystemReleaseId]?.label}
              </Tag>
            ))}
            {c.sources.map((x) => {
              const f = state.features[x.featureId];
              return (
                <Tag key={x.featureId} style={{ cursor: 'pointer' }} onClick={() => navigate(`features/${x.featureId}`)}>
                  {f?.name} {f && <StageTag stage={f.stage} />}
                </Tag>
              );
            })}
          </Space>
        </Typography.Paragraph>
      </Card>

      <Card
        title={L('集成测试', 'Integration tests')}
        extra={
          <Space>
            {canDispatch && (
              <Button type="primary" onClick={() => setDispatching(true)}>
                {L('下发到集成测试车组', 'Dispatch to test groups')}
              </Button>
            )}
            {canVerify && (
              <Button disabled={blockers.length > 0} onClick={() => run((cx) => verifyCandidate(cx, c.id), subsystem ? L('集成测试已确认，可由本域发布为子系统发布', 'Verified; the domain can publish it as a subsystem release') : L('集成测试已确认，可交给配置发布', 'Verified; ready for release'))}>
                {L('确认集成验证通过', 'Confirm Verified')}
              </Button>
            )}
          </Space>
        }
      >
        <Hint>
          {L(
            '集成测试独立于各 Feature 的测试：候选下发到集成测试工作区的测试车辆组，先仿真再实车，全部目标通过后由集成测试确认。',
            'Integration testing is independent of Feature tests: the candidate goes to the integration workspace’s testing vehicle groups, simulation first, then physical; integration testing confirms once every target passes.',
          )}
        </Hint>
        {c.status === 'TESTING' && blockers.length > 0 && <Alert type="warning" showIcon style={{ marginBottom: 12 }} title={L('尚不能确认', 'Not verifiable yet')} description={blockers.map((x) => B(issueLabel(x), x)).join(L('；', '; '))} />}
        {c.status === 'VERIFIED' && !subsystem && <Alert type="success" showIcon style={{ marginBottom: 12 }} title={L('候选已通过集成验证，可由配置发布推广为正式版本。', 'The candidate is verified and can be promoted to a release by configuration release.')} />}
        {c.status === 'VERIFIED' && subsystem && (
          <Alert
            type="success"
            showIcon
            style={{ marginBottom: 12 }}
            title={L('子系统候选已通过集成验证，可由本域配置发布为子系统发布，供整车集成收集。', 'The subsystem candidate is verified; the domain can publish it as a subsystem release for whole-vehicle integration.')}
            action={
              canPublish && (
                <Button type="primary" size="small" onClick={() => (setNotes(''), setPublishing(true))}>
                  {L('发布子系统', 'Publish subsystem')}
                </Button>
              )
            }
          />
        )}
        {published && (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            title={L(`已发布为子系统发布 ${published.label}`, `Published as subsystem release ${published.label}`)}
            description={B(SUBSYSTEM_STATUS_LABELS[published.status]!)}
          />
        )}
        <TargetsTable
          status={status}
          action={(t) =>
            c.status === 'TESTING' &&
            t.applied &&
            can('candidate.recordTest', { ...target, env: state.resources[t.resourceId]!.env }) && (
              <Button size="small" onClick={() => setTesting(t.resourceId)}>
                {L('登记结果', 'Record result')}
              </Button>
            )
          }
        />
      </Card>

      <Card title={L('下发记录', 'Dispatches')}>
        <DeploymentsTable
          deployments={deploymentsOf(state, c.id)}
          canCancel={() => can('candidate.dispatch', target)}
          onCancel={(d) => run((cx) => cancelDeployment(cx, d.id, L('手动取消', 'Cancelled manually')), L('已取消', 'Cancelled'))}
        />
      </Card>

      <DispatchModal
        open={dispatching}
        groups={vehicleGroups}
        vehicles={ungrouped}
        emptyText={L('集成测试工作区没有测试车辆；请联系车辆资源或工作区管理员。', 'The integration workspace has no testing vehicles; ask vehicle resources or its admin.')}
        onClose={() => setDispatching(false)}
        onDispatch={(ids, _goal, direct) => run((cx) => dispatchCandidate(cx, c.id, { vehicleGroupIds: ids, resourceIds: direct }), L('已下发，等待车辆回执', 'Dispatched; waiting for vehicle receipts')) !== undefined}
      />
      <RecordTestModal resourceId={testing} onClose={() => setTesting(null)} onRecord={(v) => run((cx) => recordCandidateTest(cx, c.id, { resourceId: testing!, ...v }), L('已登记', 'Recorded')) !== undefined} />
      <Modal
        open={publishing}
        title={L(`发布子系统 · ${c.label}`, `Publish subsystem · ${c.label}`)}
        okText={L('发布子系统', 'Publish subsystem')}
        onCancel={() => setPublishing(false)}
        onOk={() => {
          if (run((cx) => publishSubsystem(cx, c.id, { notes }), L('已发布子系统，可供整车集成收集', 'Subsystem published; whole-vehicle integration can collect it')) !== undefined) setPublishing(false);
        }}
      >
        <Hint>
          {L(
            '子系统发布是整车集成的输入：它不是 DCL 策略集版本，不列适用整车软件版本，也不会下发给量产车。本域之前未纳入正式版本的子系统发布会被它替代，它包含其全部内容。',
            'A subsystem release is an input to whole-vehicle integration: not a DCL policy set version, no software versions, never sent to production vehicles. It replaces the domain’s earlier subsystem release not yet in a formal release, and contains all of it.',
          )}
        </Hint>
        <Input.TextArea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={L('发布说明（可选）', 'Notes (optional)')} />
      </Modal>
      <Modal
        open={cancelling}
        title={L('取消候选', 'Cancel candidate')}
        okText={L('取消候选', 'Cancel candidate')}
        okButtonProps={{ danger: true }}
        onCancel={() => setCancelling(false)}
        onOk={() => {
          if (run((cx) => cancelCandidate(cx, c.id, { reason }), L('已取消候选，来源 Feature 恢复为 Verified', 'Cancelled; source Features are Verified again')) !== undefined) setCancelling(false);
        }}
      >
        <Input.TextArea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={L('原因', 'Reason')} />
      </Modal>
    </>
  );
}

// ---------------------------------------------------------------------------
// Subsystem releases
// ---------------------------------------------------------------------------

function SubsystemsTab({ releases }: { releases: SubsystemRelease[] }) {
  const state = useEngineState();
  const { L, B } = useI18n();
  return (
    <Card title={L('子系统发布', 'Subsystem releases')}>
      <Hint>
        {L(
          '子系统发布由各域在子系统集成后发布，是整车集成的输入。新的子系统发布包含本域之前尚未纳入正式版本的子系统发布。',
          'Domains publish subsystem releases after subsystem integration, as inputs to whole-vehicle integration. A new one contains the domain’s earlier subsystem release not yet in a formal release.',
        )}
      </Hint>
      <Table
        rowKey="id"
        size="small"
        pagination={false}
        dataSource={releases}
        locale={{ emptyText: L('还没有子系统发布', 'No subsystem release yet') }}
        columns={[
          { title: L('子系统发布', 'Subsystem release'), render: (_, r) => <Mono>{r.label}</Mono> },
          { title: L('状态', 'Status'), render: (_, r) => <LabelTag map={SUBSYSTEM_STATUS_LABELS} value={r.status} color={r.status === 'ACTIVE' ? 'green' : r.status === 'INTEGRATING' ? 'processing' : undefined} /> },
          { title: L('变更分组', 'Changed groups'), render: (_, r) => <Mono>{Object.keys(r.groups).map((g) => state.groups[g]?.code ?? g).join(', ')}</Mono> },
          { title: L('包含 Feature', 'Features'), render: (_, r) => r.features.map((f) => state.features[f.featureId]?.name).join(', ') },
          { title: L('基线', 'Base'), render: (_, r) => (r.baseReleaseId ? B(setName(state.releases[r.baseReleaseId]!.dclVersion)) : L('无', 'none')) },
          { title: L('替代', 'Replaces'), render: (_, r) => (r.supersedesId ? state.subsystemReleases[r.supersedesId]?.label : '—') },
          { title: L('候选', 'Candidate'), render: (_, r) => <a onClick={() => navigate(`integration/${r.candidateId}`)}><Mono>{state.candidates[r.candidateId]?.label}</Mono></a> },
          { title: L('发布', 'Published'), render: (_, r) => `${state.accounts[r.publishedBy]?.displayName} · ${when(r.publishedAt)}${r.notes ? ` · ${r.notes}` : ''}` },
        ]}
      />
    </Card>
  );
}
