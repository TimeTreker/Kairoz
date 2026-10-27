import { Badge, Button, Card, Col, Flex, Row, Space, Statistic, Typography } from 'antd';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { useActor, useCan, useCanOpen, useWorkspace } from '../app/hooks.ts';
import { LifecycleModal } from '../components/lifecycle.tsx';
import type { LifecycleTarget } from '../components/lifecycle.tsx';
import { WorkspaceGroups } from '../components/workspace-groups.tsx';
import { navigate } from '../app/router.ts';
import { setSession, useEngineState } from '../app/store.ts';
import { LabelTag, Mono, RoleTag, StageTag, day, when } from '../components/common.tsx';
import { HoldTag } from '../components/budget.tsx';
import { PatchedTag } from '../components/patch.tsx';
import { authorize } from '../domain/authz.ts';
import { usageOf } from '../engine/budget.ts';
import { mainlineRelease, visibleFeatures } from '../engine/config.ts';
import { intakeQueue } from '../engine/intake.ts';
import { isConfirmed, isMergeWorkspace, verifiedSources } from '../engine/integration.ts';
import { blockedProductionVehicles } from '../engine/applicability.ts';
import { emergencyStopsOf } from '../engine/emergency.ts';
import { orphanedOrgObjects } from '../engine/org.ts';
import { PERSONAL_SIM_QUOTA, personalPending, personalSimsOf } from '../engine/personal-sim.ts';
import { softwareChangesFor, unrecordedReports } from '../engine/software-change.ts';
import { OutcomeTag, SoftwareChangeDrawer } from '../components/software-change.tsx';
import { LoanStatusTag } from '../components/loans.tsx';
import { CheckOutcomeTag } from '../components/publication-check.tsx';
import { GroupFitDrawer } from '../components/vehicle-software.tsx';
import { mismatchesFor } from '../engine/delivery.ts';
import { borrowedBy, loansToAgree, managedLoans } from '../engine/loans.ts';
import { otaRollouts } from '../engine/ota.ts';
import { patchesOf, releaseFor } from '../engine/release.ts';
import { isOverdue, managedResources, pendingDeploymentOf, vehicleGroupsOf, workspaceVehicles } from '../engine/fleet.ts';
import { referenceRequestsFor } from '../engine/references.ts';
import { candidateTestStatus, featureTestStatus, testRequestsOf } from '../engine/validation.ts';
import type { Feature } from '../engine/types.ts';
import { useI18n } from '../i18n/i18n.tsx';
import { CANDIDATE_STATUS_COLORS, CANDIDATE_STATUS_LABELS, CHECK_STATUS_COLORS, CHECK_STATUS_LABELS, FEEDBACK_LABELS, setName } from '../i18n/vocab.ts';

function Row2({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <Flex justify="space-between" align="center" onClick={onClick} style={{ cursor: 'pointer', padding: '8px 0', borderBottom: '1px solid #f0f0f0' }}>
      {children}
    </Flex>
  );
}

function FeatureList({ items, empty }: { items: Feature[]; empty: string }) {
  if (items.length === 0) return <Typography.Text type="secondary">{empty}</Typography.Text>;
  return (
    <div>
      {items.map((f) => (
        <Row2 key={f.id} onClick={() => navigate(`features/${f.id}`)}>
          <Mono>{f.name}</Mono>
          <StageTag stage={f.stage} />
        </Row2>
      ))}
    </div>
  );
}

export function WorkbenchPage() {
  const state = useEngineState();
  const actor = useActor()!;
  const canOpen = useCanOpen();
  const { workspace, roles, access } = useWorkspace();
  const { L, B } = useI18n();
  const cards: ReactNode[] = [];
  const [changeOf, setChangeOf] = useState<string | null>(null);
  const [fitOfId, setFitOf] = useState<string | null>(null);
  const [lifecycle, setLifecycle] = useState<LifecycleTarget | null>(null);
  const can = useCan();
  const features = workspace ? visibleFeatures(state, actor, workspace.id) : [];

  if (roles.includes('BUSINESS_DEV') && workspace) {
    const mine = features.filter((f) => f.kind === 'BUSINESS' && authorize(actor.grants, 'feature.edit', { workspaceId: f.workspaceId, groupId: f.groupId }).ok);
    const returned = mine.filter((f) => f.stage === 'DRAFT' && state.feedback.some((x) => x.featureId === f.id && x.commitId === f.headCommitId));
    const ownedGroups = workspace.groupIds.filter((g) => authorize(actor.grants, 'reference.decide', { groupId: g }).ok);
    const pendingRefs = ownedGroups.flatMap((g) => referenceRequestsFor(state, actor, g, 'owner').filter((r) => r.status === 'PENDING'));
    cards.push(
      <Card key="dev" title={<RoleTag role="BUSINESS_DEV" />} extra={<Button size="small" onClick={() => navigate('features')}>{L('全部 Feature', 'All Features')}</Button>}>
        <Row gutter={16} style={{ marginBottom: 12 }}>
          <Col span={8}><Statistic title={L('草稿', 'Drafts')} value={mine.filter((f) => f.stage === 'DRAFT').length} /></Col>
          <Col span={8}><Statistic title={L('待 DCL 审核', 'In DCL review')} value={mine.filter((f) => f.stage === 'SUBMITTED').length} /></Col>
          <Col span={8}><Statistic title="DCL Ready" value={mine.filter((f) => f.stage === 'DCL_READY').length} /></Col>
        </Row>
        {returned.length > 0 && (
          <>
            <Typography.Text strong>{L('需要处理的反馈', 'Feedback to handle')}</Typography.Text>
            {returned.map((f) => {
              const fb = state.feedback.filter((x) => x.featureId === f.id && x.commitId === f.headCommitId).at(-1)!;
              return (
                <Row2 key={f.id} onClick={() => navigate(`features/${f.id}`)}>
                  <Space orientation="vertical" size={0}>
                    <Mono>{f.name}</Mono>
                    <Typography.Text type="danger">
                      {B(FEEDBACK_LABELS[fb.kind])}: {fb.reason}
                    </Typography.Text>
                  </Space>
                </Row2>
              );
            })}
          </>
        )}
        {pendingRefs.length > 0 && (
          <Button type="link" onClick={() => navigate('data/requests')}>
            <Badge count={pendingRefs.length} size="small" offset={[10, 0]}>
              {L('待本组决定的引用申请', 'Reference requests awaiting your group')}
            </Badge>
          </Button>
        )}
      </Card>,
    );
  }
  if (roles.includes('BUSINESS_TEST') && workspace) {
    const testing = features.filter((f) => f.stage === 'TESTING');
    const waiting = testing.filter((f) => featureTestStatus(state, f).some((t) => !t.applied));
    cards.push(
      <Card key="test" title={<RoleTag role="BUSINESS_TEST" />}>
        <Row gutter={16} style={{ marginBottom: 12 }}>
          <Col span={8}><Statistic title={L('待下发', 'To dispatch')} value={features.filter((f) => f.stage === 'DCL_READY').length} /></Col>
          <Col span={8}><Statistic title={L('测试中', 'Testing')} value={testing.length} /></Col>
          <Col span={8}><Statistic title={L('等待车辆回执', 'Awaiting receipts')} value={waiting.length} /></Col>
        </Row>
        <FeatureList items={features.filter((f) => ['DCL_READY', 'TESTING'].includes(f.stage))} empty={L('暂无待测 Feature', 'Nothing to test')} />
      </Card>,
    );
  }
  const personalGroups = workspace
    ? workspace.groupIds.filter((id) => {
        const g = state.groups[id];
        return !!g && authorize(actor.grants, 'personalSim.use', { workspaceId: workspace.id, groupId: g.id, scope: g.domain, env: 'development' }).ok;
      })
    : [];
  if (personalGroups.length > 0 && workspace) {
    const sims = personalSimsOf(state, actor.username, workspace.id).filter((r) => r.status !== 'RETIRED');
    const latest = Object.values(state.personalTests)
      .filter((t) => t.owner === actor.username && t.workspaceId === workspace.id)
      .sort((a, b) => b.seq - a.seq)[0];
    cards.push(
      <Card key="personal" title={L('我的研发仿真', 'My simulations')} extra={<Button size="small" onClick={() => navigate('fleet/personal')}>{L('打开', 'Open')}</Button>}>
        <Row gutter={16} style={{ marginBottom: 12 }}>
          <Col span={8}><Statistic title={L('个人仿真', 'Personal simulations')} value={sims.length} suffix={`/ ${PERSONAL_SIM_QUOTA}`} /></Col>
          <Col span={8}><Statistic title={L('等待回执', 'Awaiting receipt')} value={sims.filter((r) => personalPending(state, r.id)).length} /></Col>
          <Col span={8}><Statistic title={L('最近自测', 'Latest self-test')} value={latest?.result ?? '—'} /></Col>
        </Row>
        <Typography.Text type="secondary">
          {L('在自己的仿真上运行本组 Feature 草稿、试触发并自测；不计入团队测试。', 'Run your group’s Feature drafts on your own simulations, fire trials and self-test; never team evidence.')}
        </Typography.Text>
      </Card>,
    );
  }
  const misfits = workspace ? mismatchesFor(state, actor, workspace.id) : [];
  if (misfits.length > 0) {
    cards.push(
      <Card key="misfits" title={L('车辆与车辆组的配置不匹配', 'Vehicles that do not fit their group')}>
        <Typography.Paragraph type="secondary">
          {L('这些车辆加入车辆组或更新了整车软件，但车辆组已下发的配置不适合它们的软件，云端不会推送。修改策略并下发，或更新车辆的整车版本。', 'These vehicles joined a group or had their software updated, but what was dispatched to the group does not fit their software, so nothing is pushed. Adapt the policies and dispatch, or update the vehicle’s software.')}
        </Typography.Paragraph>
        {misfits.map((f) => (
          <Row2 key={f.resourceId} onClick={() => setFitOf(f.resourceId)}>
            <Space>
              <Mono>{f.resourceId}</Mono>
              <span>{state.vehicleGroups[f.vehicleGroupId]?.name}</span>
            </Space>
            <CheckOutcomeTag check={f.check} />
          </Row2>
        ))}
      </Card>,
    );
  }
  const changes = workspace ? softwareChangesFor(state, actor, workspace.id) : [];
  if (changes.length > 0) {
    cards.push(
      <Card key="software" title={L('车辆软件已变化', 'Vehicle software changed')}>
        <Typography.Paragraph type="secondary">
          {L('车辆组中的实车上报了新的整车软件版本。逐辆查看对本组文件与策略的影响并确认。', 'Vehicles of your groups report new whole-vehicle software. Check what it means for the group’s files and policies, vehicle by vehicle, and confirm.')}
        </Typography.Paragraph>
        {changes.map((c) => (
          <Row2 key={c.id} onClick={() => setChangeOf(c.id)}>
            <Space>
              <Mono>{c.resourceId}</Mono>
              <span>{`${c.fromVersion ?? '—'} → ${c.toVersion}`}</span>
            </Space>
            <OutcomeTag changeId={c.id} />
          </Row2>
        ))}
      </Card>,
    );
  }
  if (roles.includes('WORKSPACE_ADMIN') && workspace) {
    const vehicles = workspaceVehicles(state, workspace.id);
    cards.push(
      <Card key="wa" title={<RoleTag role="WORKSPACE_ADMIN" />} extra={<Button size="small" onClick={() => navigate('fleet')}>{L('车辆与车辆组', 'Vehicles & groups')}</Button>}>
        <Row gutter={16}>
          <Col span={8}><Statistic title={L('工作区车辆', 'Vehicles')} value={vehicles.length} /></Col>
          <Col span={8}><Statistic title={L('未分组', 'Ungrouped')} value={vehicles.filter((r) => !state.groupMembers[r.id]).length} /></Col>
          <Col span={8}><Statistic title={L('车辆组', 'Vehicle groups')} value={vehicleGroupsOf(state, workspace.id).filter((g) => g.status === 'ACTIVE').length} /></Col>
        </Row>
        {testRequestsOf(state, workspace.id).some((r) => r.status === 'PENDING') && (
          <Button type="link" style={{ paddingLeft: 0, marginTop: 8 }} onClick={() => navigate('fleet/groups')}>
            <Badge count={testRequestsOf(state, workspace.id).filter((r) => r.status === 'PENDING').length} size="small" offset={[10, 0]}>
              {L('待审批的团队测试申请', 'Team test requests to decide')}
            </Badge>
          </Button>
        )}
        {loansToAgree(state, actor, workspace.id).map((l) => (
          <Row2 key={l.id} onClick={() => navigate('fleet/loans')}>
            <Space>
              <Typography.Text type="warning">{L('借用待同意', 'Loan to agree')}</Typography.Text>
              <Mono>{l.resourceId}</Mono>
            </Space>
            <Typography.Text type="secondary">{state.workspaces[l.workspaceId]?.name}</Typography.Text>
          </Row2>
        ))}
        {borrowedBy(state, workspace.id)
          .filter((l) => l.status === 'APPROVED' || l.status === 'REQUESTED')
          .map((l) => (
            <Row2 key={l.id} onClick={() => navigate('fleet/loans')}>
              <Space>
                <span>{L('借入', 'Borrowed')}</span>
                <Mono>{l.resourceId}</Mono>
                <span>{L(`至 ${day(l.dueDate)}`, `until ${day(l.dueDate)}`)}</span>
              </Space>
              <LoanStatusTag loan={l} />
            </Row2>
          ))}
        <WorkspaceGroups workspaceId={workspace.id} onArchive={setLifecycle} />
        {can('workspace.archive', { workspaceId: workspace.id }) && (
          <Button type="link" danger size="small" style={{ paddingLeft: 0, marginTop: 8 }} onClick={() => setLifecycle({ object: 'workspace', action: 'archive', id: workspace.id })}>
            {L('归档本工作区…', 'Archive this workspace…')}
          </Button>
        )}
      </Card>,
    );
  }
  if (roles.includes('CONFIG_INTEGRATOR') && workspace && isMergeWorkspace(state, workspace.id)) {
    const plans = Object.values(state.mergePlans).filter((p) => p.workspaceId === workspace.id);
    const latest = plans.at(-1);
    const openCandidates = Object.values(state.candidates).filter((c) => c.workspaceId === workspace.id && ['CANDIDATE', 'TESTING', 'VERIFIED'].includes(c.status));
    // Fixes released in a same-software patch still have to reach the mainline.
    const patched = verifiedSources(state, workspace.id, 'Vehicle').filter((f) => patchesOf(state, f).length > 0);
    cards.push(
      <Card key="ci" title={<RoleTag role="CONFIG_INTEGRATOR" />} extra={<Button size="small" onClick={() => navigate('integration')}>{L('配置集成', 'Integration')}</Button>}>
        <Row gutter={16} style={{ marginBottom: 12 }}>
          <Col span={8}><Statistic title={L('可集成的 Verified', 'Verified to integrate')} value={verifiedSources(state, workspace.id).length} suffix={patched.length ? <Typography.Text type="secondary" style={{ fontSize: 12 }}>{L(`含补丁 ${patched.length}`, `${patched.length} from patches`)}</Typography.Text> : undefined} /></Col>
          <Col span={8}><Statistic title={L('待 DCL 确认', 'Awaiting DCL')} value={plans.filter((p) => p.status === 'READY' && !isConfirmed(state, p)).length} /></Col>
          <Col span={8}><Statistic title={L('未结束的候选', 'Open candidates')} value={openCandidates.length} /></Col>
        </Row>
        {openCandidates.map((c) => (
          <Row2 key={c.id} onClick={() => navigate(`integration/${c.id}`)}>
            <Mono>{c.label}</Mono>
            <LabelTag map={CANDIDATE_STATUS_LABELS} value={c.status} color={CANDIDATE_STATUS_COLORS[c.status]} />
          </Row2>
        ))}
        {patched.map((f) => (
          <Row2 key={f.id} onClick={() => navigate('integration')}>
            <Mono>{f.name}</Mono>
            <PatchedTag feature={f} />
          </Row2>
        ))}
        {latest && latest.status === 'CONFLICT' && <Typography.Text type="danger">{L('最新合并预览有冲突', 'The latest merge preview has conflicts')}</Typography.Text>}
      </Card>,
    );
  }
  if (roles.includes('INTEGRATION_TEST') && workspace?.kind === 'INTEGRATION') {
    const mine = Object.values(state.candidates).filter((c) => c.testWorkspaceId === workspace.id && ['CANDIDATE', 'TESTING'].includes(c.status));
    const checks = Object.values(state.applicabilityChecks).filter((c) => c.testWorkspaceId === workspace.id && ['OPEN', 'TESTING'].includes(c.status));
    cards.push(
      <Card key="it" title={<RoleTag role="INTEGRATION_TEST" />} extra={<Button size="small" onClick={() => navigate('integration')}>{L('集成候选', 'Candidates')}</Button>}>
        <Row gutter={16} style={{ marginBottom: 12 }}>
          <Col span={8}><Statistic title={L('待下发', 'To dispatch')} value={mine.filter((c) => c.status === 'CANDIDATE').length} /></Col>
          <Col span={8}><Statistic title={L('测试中', 'Testing')} value={mine.filter((c) => c.status === 'TESTING').length} /></Col>
          <Col span={8}><Statistic title={L('待测试适用性', 'Applicability to test')} value={checks.length} /></Col>
        </Row>
        {mine.length === 0 && checks.length === 0 && <Typography.Text type="secondary">{L('暂无待测候选', 'No candidates to test')}</Typography.Text>}
        {checks.map((c) => (
          <Row2 key={c.id} onClick={() => navigate('integration/applicability')}>
            <Space>
              <Mono>{`${c.vehicleModelId} ${c.version}`}</Mono>
              <Typography.Text type="secondary">← {B(setName(state.releases[c.releaseId]!.dclVersion))}</Typography.Text>
            </Space>
            <LabelTag map={CHECK_STATUS_LABELS} value={c.status} color={CHECK_STATUS_COLORS[c.status]} />
          </Row2>
        ))}
        {mine.map((c) => (
          <Row2 key={c.id} onClick={() => navigate(`integration/${c.id}`)}>
            <Space>
              <Mono>{c.label}</Mono>
              {candidateTestStatus(state, c).some((t) => !t.applied) && <Typography.Text type="secondary">{L('等待车辆回执', 'awaiting receipts')}</Typography.Text>}
            </Space>
            <LabelTag map={CANDIDATE_STATUS_LABELS} value={c.status} color={CANDIDATE_STATUS_COLORS[c.status]} />
          </Row2>
        ))}
      </Card>,
    );
  }
  if (roles.includes('CONFIG_RELEASE') && workspace && !workspace.scopes.includes('Vehicle')) {
    // A domain's release role publishes subsystem releases, never whole-vehicle releases.
    const toPublish = Object.values(state.candidates).filter((c) => c.workspaceId === workspace.id && c.scope !== 'Vehicle' && c.status === 'VERIFIED');
    const published = Object.values(state.subsystemReleases).filter((r) => r.workspaceId === workspace.id);
    cards.push(
      <Card key="cr" title={<RoleTag role="CONFIG_RELEASE" />} extra={<Button size="small" onClick={() => navigate('integration')}>{L('配置集成', 'Integration')}</Button>}>
        <Row gutter={16} style={{ marginBottom: 12 }}>
          <Col span={12}><Statistic title={L('待发布的子系统候选', 'Subsystem candidates to publish')} value={toPublish.length} /></Col>
          <Col span={12}><Statistic title={L('可供整车集成的子系统发布', 'Subsystem releases ready')} value={published.filter((r) => r.status === 'ACTIVE').length} /></Col>
        </Row>
        {toPublish.map((c) => (
          <Row2 key={c.id} onClick={() => navigate(`integration/${c.id}`)}>
            <Mono>{c.label}</Mono>
            <LabelTag map={CANDIDATE_STATUS_LABELS} value={c.status} color={CANDIDATE_STATUS_COLORS[c.status]} />
          </Row2>
        ))}
      </Card>,
    );
  } else if (roles.includes('CONFIG_RELEASE') && workspace) {
    const toRelease = Object.values(state.candidates).filter((c) => c.vehicleModelId === workspace.vehicleModelId && c.scope === 'Vehicle' && c.status === 'VERIFIED');
    const rollouts = otaRollouts(state).filter((d) => state.workspaces[d.workspaceId]?.vehicleModelId === workspace.vehicleModelId);
    const production = Object.values(state.resources).filter((r) => r.env === 'production' && r.vehicleModelId === workspace.vehicleModelId && r.status !== 'RETIRED');
    const due = production.filter((r) => {
      const target = releaseFor(state, r).release;
      return target && r.appliedConfigId !== target.resolvedConfigId;
    });
    const latest = mainlineRelease(state, workspace.vehicleModelId);
    const checks = Object.values(state.applicabilityChecks).filter((c) => c.vehicleModelId === workspace.vehicleModelId && ['OPEN', 'TESTING', 'VERIFIED'].includes(c.status));
    const blocked = blockedProductionVehicles(state, workspace.vehicleModelId);
    cards.push(
      <Card key="cr" title={<RoleTag role="CONFIG_RELEASE" />} extra={<Button size="small" onClick={() => navigate('release')}>{L('发布与配置 OTA', 'Release & OTA')}</Button>}>
        <Row gutter={16} style={{ marginBottom: 12 }}>
          <Col span={6}><Statistic title={L('主线策略集', 'Mainline policy set')} value={latest ? latest.dclVersion : '—'} /></Col>
          <Col span={6}><Statistic title={L('待发布候选', 'To release')} value={toRelease.length} /></Col>
          <Col span={6}><Statistic title={L('进行中 / 暂停的 OTA', 'Running / paused')} value={`${rollouts.filter((d) => d.status === 'PENDING').length} / ${rollouts.filter((d) => d.status === 'PAUSED').length}`} /></Col>
          <Col span={6}><Statistic title={L('待更新的量产车', 'Vehicles due')} value={due.length} /></Col>
        </Row>
        {toRelease.map((c) => (
          <Row2 key={c.id} onClick={() => navigate('release')}>
            <Mono>{c.label}</Mono>
            <LabelTag map={CANDIDATE_STATUS_LABELS} value={c.status} color={CANDIDATE_STATUS_COLORS[c.status]} />
          </Row2>
        ))}
        {checks.map((c) => (
          <Row2 key={c.id} onClick={() => navigate('release/applicability')}>
            <Space>
              <Typography.Text>{L('适用性确认', 'Applicability')}</Typography.Text>
              <Mono>{`${c.vehicleModelId} ${c.version}`}</Mono>
              <Typography.Text type="secondary">← {B(setName(state.releases[c.releaseId]!.dclVersion))}</Typography.Text>
            </Space>
            <LabelTag map={CHECK_STATUS_LABELS} value={c.status} color={CHECK_STATUS_COLORS[c.status]} />
          </Row2>
        ))}
        {emergencyStopsOf(state, workspace.vehicleModelId)
          .filter((x) => x.status === 'REQUESTED')
          .map((x) => (
            <Row2 key={x.id} onClick={() => navigate('release')}>
              <Space>
                <Typography.Text type="danger">{L('紧急停用待批准', 'Emergency stop to decide')}</Typography.Text>
                <Mono>{x.policyId}</Mono>
              </Space>
              <Typography.Text type="secondary">{state.accounts[x.requestedBy]?.displayName}</Typography.Text>
            </Row2>
          ))}
        {blocked.length > 0 && (
          <Typography.Paragraph type="danger" style={{ marginBottom: 0 }}>
            {L(`${blocked.length} 辆量产车的软件版本没有适用的策略集：`, `${blocked.length} production vehicle(s) run software no policy set applies to: `)}
            {blocked.map((r) => `${r.id}（${r.integrationVersion}）`).join(L('、', ', '))}
          </Typography.Paragraph>
        )}
        {rollouts.some((d) => d.status === 'PAUSED') && <Typography.Text type="danger">{L('有 OTA 因车辆失败而暂停', 'A rollout is paused after a vehicle failure')}</Typography.Text>}
      </Card>,
    );
  }
  if (actor.grants.some((g) => g.role === 'VEHICLE_RESOURCE')) {
    const managed = managedResources(state, actor);
    cards.push(
      <Card key="vr" title={<RoleTag role="VEHICLE_RESOURCE" />} extra={<Button size="small" onClick={() => navigate('fleet/registry')}>{L('车辆台账', 'Registry')}</Button>}>
        <Row gutter={16}>
          <Col span={8}><Statistic title={L('管理的车辆', 'Managed vehicles')} value={managed.length} /></Col>
          <Col span={8}><Statistic title={L('软件版本未知', 'Unknown software')} value={managed.filter((r) => r.type === 'PHYSICAL' && !r.integrationVersion).length} /></Col>
          <Col span={8}><Statistic title={L('等待回执', 'Awaiting receipts')} value={managed.filter((r) => pendingDeploymentOf(state, r.id)).length} /></Col>
        </Row>
        {(() => {
          const loans = managedLoans(state, actor);
          const toApprove = loans.filter((l) => l.status === 'REQUESTED' && l.lenders.every((x) => x.decision === 'AGREED'));
          const extensions = loans.filter((l) => l.status === 'APPROVED' && l.extensions.some((x) => x.status === 'PENDING'));
          const overdue = loans.filter((l) => isOverdue(state, l));
          return toApprove.length + extensions.length + overdue.length > 0 ? (
            <Button type="link" style={{ paddingLeft: 0, marginTop: 8 }} onClick={() => navigate('fleet/loans')}>
              <Badge count={toApprove.length + extensions.length + overdue.length} size="small" offset={[10, 0]}>
                {L(`借用待审批 ${toApprove.length} · 延期 ${extensions.length} · 已到期 ${overdue.length}`, `Loans to approve ${toApprove.length} · extensions ${extensions.length} · overdue ${overdue.length}`)}
              </Badge>
            </Button>
          ) : null;
        })()}
        {unrecordedReports(state, actor).map((c) => (
          <Row2 key={c.id} onClick={() => navigate('fleet/registry')}>
            <Space>
              <Typography.Text type="warning">{L('上报了未登记的软件版本', 'Reported an unrecorded software version')}</Typography.Text>
              <Mono>{`${c.resourceId} · ${c.toVersion}`}</Mono>
            </Space>
            <Typography.Text type="secondary">{L('先登记版本，再确认', 'Record the version, then confirm')}</Typography.Text>
          </Row2>
        ))}
      </Card>,
    );
  }
  if (actor.grants.some((g) => g.role === 'DCL_ENGINEER')) {
    const q = intakeQueue(state, actor);
    const confirmations = Object.values(state.mergePlans).filter((p) => p.status === 'READY' && !isConfirmed(state, p));
    // Resource protection: vehicles that dropped or suppressed captures this hour, and paused ones.
    const overBudget = Object.values(state.resources)
      .map((r) => ({ id: r.id, u: usageOf(state, r.id) }))
      .filter((x) => x.u.dropped + x.u.suppressed + x.u.held > 0);
    const paused = Object.values(state.collectionHolds).filter((h) => h.state !== 'ACTIVE');
    cards.push(
      <Card key="dcl" title={<RoleTag role="DCL_ENGINEER" />} extra={<Button size="small" onClick={() => navigate('intake')}>{L('打开接入队列', 'Open intake')}</Button>}>
        <Row gutter={16}>
          <Col span={8}><Statistic title={L('待敏感审核的 Feature', 'Features awaiting review')} value={q.features.length} /></Col>
          <Col span={8}><Statistic title={L('待判定的来源重叠', 'Overlaps to decide')} value={q.overlaps.length} /></Col>
          <Col span={8}><Statistic title={L('待确认的集成处理集合', 'Integration sets to confirm')} value={confirmations.length} /></Col>
        </Row>
        {confirmations.map((p) => (
          <Row2 key={p.id} onClick={() => (access.some((a) => a.workspaceId === p.workspaceId) && setSession({ workspaceId: p.workspaceId }), navigate('integration/merge'))}>
            <Space>
              <Typography.Text>{state.workspaces[p.workspaceId]?.name}</Typography.Text>
              <Typography.Text type="secondary">{L('合并预览等待确认处理集合', 'merge preview awaiting the processing confirmation')}</Typography.Text>
            </Space>
            <Typography.Text type="secondary">{when(p.createdAt)}</Typography.Text>
          </Row2>
        ))}
        {overBudget.map(({ id, u }) => (
          <Row2 key={id} onClick={() => navigate('processing/budget')}>
            <Space>
              <Mono>{id}</Mono>
              <Typography.Text type="warning">{L('近一小时采集超出预算', 'Over its collection budget this hour')}</Typography.Text>
            </Space>
            <Typography.Text type="secondary">{L(`排队 ${u.held} · 未保留 ${u.dropped} · 抑制 ${u.suppressed}`, `${u.held} waiting · ${u.dropped} dropped · ${u.suppressed} suppressed`)}</Typography.Text>
          </Row2>
        ))}
        {paused.map((h) => (
          <Row2 key={h.resourceId} onClick={() => navigate('processing/budget')}>
            <Space>
              <Mono>{h.resourceId}</Mono>
              <HoldTag resourceId={h.resourceId} />
            </Space>
            <Typography.Text type="secondary">{h.history.at(-1)!.reason}</Typography.Text>
          </Row2>
        ))}
      </Card>,
    );
  }
  if (canOpen('org') || canOpen('accounts')) {
    const reviews = Object.values(state.accounts).filter((a) => a.status === 'ACTIVE' && a.grantReview);
    const orphaned = orphanedOrgObjects(state);
    cards.push(
      <Card key="ops" title={<RoleTag role="PLATFORM_OPS" />}>
        <Row gutter={16}>
          <Col span={8}><Statistic title={L('账号', 'Accounts')} value={Object.keys(state.accounts).length} /></Col>
          <Col span={8}><Statistic title={L('工作区', 'Workspaces')} value={Object.keys(state.workspaces).length} /></Col>
          <Col span={8}><Statistic title={L('业务分组', 'Groups')} value={Object.keys(state.groups).length} /></Col>
        </Row>
        {reviews.map((a) => (
          <Row2 key={a.username} onClick={() => navigate('accounts')}>
            <Space>
              <Typography.Text type="warning">{L('调岗后待复核授权', 'Grants to review after a move')}</Typography.Text>
              <span>{a.displayName}</span>
            </Space>
            <Typography.Text type="secondary">{`${state.orgUnits[a.grantReview!.fromUnitId ?? '']?.name ?? '—'} → ${state.orgUnits[a.grantReview!.toUnitId ?? '']?.name ?? '—'}`}</Typography.Text>
          </Row2>
        ))}
        {[...orphaned.workspaces.map((id) => state.workspaces[id]!.name), ...orphaned.groups.map((id) => state.groups[id]!.name)].map((name) => (
          <Row2 key={name} onClick={() => navigate('org')}>
            <Typography.Text type="danger">{L('组织节点已失效，需重新挂靠', 'Org unit no longer exists; re-attach')}</Typography.Text>
            <span>{name}</span>
          </Row2>
        ))}
        <Space style={{ marginTop: 12 }}>
          {canOpen('org') && <Button onClick={() => navigate('org')}>{L('组织与工作区', 'Organization')}</Button>}
          {canOpen('accounts') && <Button onClick={() => navigate('accounts')}>{L('账号与授权', 'Accounts')}</Button>}
        </Space>
      </Card>,
    );
  }

  return (
    <div className="kz-page">
      <Typography.Title level={3}>
        {L(`你好，${actor.displayName}`, `Hello, ${actor.displayName}`)}
      </Typography.Title>
      <Space style={{ marginBottom: 16 }} wrap>
        {roles.map((r) => (
          <RoleTag key={r} role={r} />
        ))}
      </Space>
      {cards.length === 0 ? (
        <Card>
          <Typography.Text type="secondary">
            {L('当前工作区没有本账号的待办。可在左侧菜单进入相关页面，或查看“原型工具 → 场景手册”。', 'Nothing to do in this workspace. Use the menu, or see “Prototype → Scenario guide”.')}
          </Typography.Text>
        </Card>
      ) : (
        <Row gutter={[16, 16]}>
          {cards.map((c, i) => (
            <Col xs={24} xl={12} key={i}>
              {c}
            </Col>
          ))}
        </Row>
      )}
      <SoftwareChangeDrawer changeId={changeOf} onClose={() => setChangeOf(null)} />
      <GroupFitDrawer resourceId={fitOfId} onClose={() => setFitOf(null)} />
      <LifecycleModal target={lifecycle} onClose={() => setLifecycle(null)} />
    </div>
  );
}
