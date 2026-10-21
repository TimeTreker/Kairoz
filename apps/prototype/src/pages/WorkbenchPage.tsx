import { Badge, Button, Card, Col, Flex, Row, Space, Statistic, Typography } from 'antd';
import type { ReactNode } from 'react';
import { useActor, useWorkspace } from '../app/hooks.ts';
import { navigate } from '../app/router.ts';
import { useEngineState } from '../app/store.ts';
import { LabelTag, Mono, RoleTag, StageTag } from '../components/common.tsx';
import { authorize } from '../domain/authz.ts';
import { visibleFeatures } from '../engine/config.ts';
import { intakeQueue } from '../engine/intake.ts';
import { isConfirmed, verifiedSources } from '../engine/integration.ts';
import { managedResources, pendingDeploymentOf, vehicleGroupsOf, workspaceVehicles } from '../engine/fleet.ts';
import { referenceRequestsFor } from '../engine/references.ts';
import { candidateTestStatus, featureTestStatus } from '../engine/validation.ts';
import type { Feature } from '../engine/types.ts';
import { useI18n } from '../i18n/i18n.tsx';
import { CANDIDATE_STATUS_COLORS, CANDIDATE_STATUS_LABELS, FEEDBACK_LABELS } from '../i18n/vocab.ts';

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
  const { workspace, roles } = useWorkspace();
  const { L, B } = useI18n();
  const cards: ReactNode[] = [];
  const features = workspace ? visibleFeatures(state, actor, workspace.id) : [];

  if (roles.includes('BUSINESS_DEV') && workspace) {
    const mine = features.filter((f) => authorize(actor.grants, 'feature.edit', { workspaceId: f.workspaceId, groupId: f.groupId }).ok);
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
          <Button type="link" onClick={() => navigate('data')}>
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
  if (roles.includes('WORKSPACE_ADMIN') && workspace) {
    const vehicles = workspaceVehicles(state, workspace.id);
    cards.push(
      <Card key="wa" title={<RoleTag role="WORKSPACE_ADMIN" />} extra={<Button size="small" onClick={() => navigate('fleet')}>{L('车辆与车辆组', 'Vehicles & groups')}</Button>}>
        <Row gutter={16}>
          <Col span={8}><Statistic title={L('工作区车辆', 'Vehicles')} value={vehicles.length} /></Col>
          <Col span={8}><Statistic title={L('未分组', 'Ungrouped')} value={vehicles.filter((r) => !state.groupMembers[r.id]).length} /></Col>
          <Col span={8}><Statistic title={L('车辆组', 'Vehicle groups')} value={vehicleGroupsOf(state, workspace.id).filter((g) => g.status === 'ACTIVE').length} /></Col>
        </Row>
      </Card>,
    );
  }
  if (roles.includes('CONFIG_INTEGRATOR') && workspace?.kind === 'PROJECT') {
    const plans = Object.values(state.mergePlans).filter((p) => p.workspaceId === workspace.id);
    const latest = plans.at(-1);
    const openCandidates = Object.values(state.candidates).filter((c) => c.workspaceId === workspace.id && ['CANDIDATE', 'TESTING', 'VERIFIED'].includes(c.status));
    cards.push(
      <Card key="ci" title={<RoleTag role="CONFIG_INTEGRATOR" />} extra={<Button size="small" onClick={() => navigate('integration')}>{L('配置集成', 'Integration')}</Button>}>
        <Row gutter={16} style={{ marginBottom: 12 }}>
          <Col span={8}><Statistic title={L('可集成的 Verified', 'Verified to integrate')} value={verifiedSources(state, workspace.id).length} /></Col>
          <Col span={8}><Statistic title={L('待 DCL 确认', 'Awaiting DCL')} value={plans.filter((p) => p.status === 'READY' && !isConfirmed(state, p)).length} /></Col>
          <Col span={8}><Statistic title={L('未结束的候选', 'Open candidates')} value={openCandidates.length} /></Col>
        </Row>
        {openCandidates.map((c) => (
          <Row2 key={c.id} onClick={() => navigate(`integration/${c.id}`)}>
            <Mono>{c.label}</Mono>
            <LabelTag map={CANDIDATE_STATUS_LABELS} value={c.status} color={CANDIDATE_STATUS_COLORS[c.status]} />
          </Row2>
        ))}
        {latest && latest.status === 'CONFLICT' && <Typography.Text type="danger">{L('最新合并预览有冲突', 'The latest merge preview has conflicts')}</Typography.Text>}
      </Card>,
    );
  }
  if (roles.includes('INTEGRATION_TEST') && workspace?.kind === 'INTEGRATION') {
    const mine = Object.values(state.candidates).filter((c) => c.testWorkspaceId === workspace.id && ['CANDIDATE', 'TESTING'].includes(c.status));
    cards.push(
      <Card key="it" title={<RoleTag role="INTEGRATION_TEST" />} extra={<Button size="small" onClick={() => navigate('integration')}>{L('集成候选', 'Candidates')}</Button>}>
        <Row gutter={16} style={{ marginBottom: 12 }}>
          <Col span={12}><Statistic title={L('待下发', 'To dispatch')} value={mine.filter((c) => c.status === 'CANDIDATE').length} /></Col>
          <Col span={12}><Statistic title={L('测试中', 'Testing')} value={mine.filter((c) => c.status === 'TESTING').length} /></Col>
        </Row>
        {mine.length === 0 && <Typography.Text type="secondary">{L('暂无待测候选', 'No candidates to test')}</Typography.Text>}
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
  if (actor.grants.some((g) => g.role === 'VEHICLE_RESOURCE')) {
    const managed = managedResources(state, actor);
    cards.push(
      <Card key="vr" title={<RoleTag role="VEHICLE_RESOURCE" />} extra={<Button size="small" onClick={() => navigate('fleet')}>{L('车辆台账', 'Registry')}</Button>}>
        <Row gutter={16}>
          <Col span={8}><Statistic title={L('管理的车辆', 'Managed vehicles')} value={managed.length} /></Col>
          <Col span={8}><Statistic title={L('软件版本未知', 'Unknown software')} value={managed.filter((r) => r.type === 'PHYSICAL' && !r.integrationVersion).length} /></Col>
          <Col span={8}><Statistic title={L('等待回执', 'Awaiting receipts')} value={managed.filter((r) => pendingDeploymentOf(state, r.id)).length} /></Col>
        </Row>
      </Card>,
    );
  }
  if (actor.grants.some((g) => g.role === 'DCL_ENGINEER')) {
    const q = intakeQueue(state, actor);
    const confirmations = Object.values(state.mergePlans).filter((p) => p.status === 'READY' && !isConfirmed(state, p));
    cards.push(
      <Card key="dcl" title={<RoleTag role="DCL_ENGINEER" />} extra={<Button size="small" onClick={() => navigate('intake')}>{L('打开接入队列', 'Open intake')}</Button>}>
        <Row gutter={16}>
          <Col span={8}><Statistic title={L('待敏感审核的 Feature', 'Features awaiting review')} value={q.features.length} /></Col>
          <Col span={8}><Statistic title={L('待判定的来源重叠', 'Overlaps to decide')} value={q.overlaps.length} /></Col>
          <Col span={8}><Statistic title={L('待确认的集成处理集合', 'Integration sets to confirm')} value={confirmations.length} /></Col>
        </Row>
        {confirmations.length > 0 && (
          <Button type="link" style={{ paddingLeft: 0 }} onClick={() => navigate('integration')}>
            {L('去配置集成确认处理集合', 'Confirm processing sets in Integration')}
          </Button>
        )}
      </Card>,
    );
  }
  if (actor.grants.some((g) => g.role === 'PLATFORM_OPS')) {
    cards.push(
      <Card key="ops" title={<RoleTag role="PLATFORM_OPS" />}>
        <Row gutter={16}>
          <Col span={8}><Statistic title={L('账号', 'Accounts')} value={Object.keys(state.accounts).length} /></Col>
          <Col span={8}><Statistic title={L('工作区', 'Workspaces')} value={Object.keys(state.workspaces).length} /></Col>
          <Col span={8}><Statistic title={L('业务分组', 'Groups')} value={Object.keys(state.groups).length} /></Col>
        </Row>
        <Space style={{ marginTop: 12 }}>
          <Button onClick={() => navigate('org')}>{L('组织与工作区', 'Organization')}</Button>
          <Button onClick={() => navigate('accounts')}>{L('账号与授权', 'Accounts')}</Button>
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
    </div>
  );
}
