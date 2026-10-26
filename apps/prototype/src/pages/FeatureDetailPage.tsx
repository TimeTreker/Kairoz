import { ArrowLeftOutlined } from '@ant-design/icons';
import { Alert, App, Button, Card, Descriptions, Input, Modal, Result, Space, Tabs, Tag, Typography } from 'antd';
import { useState } from 'react';
import { useActor, useCan, useRun } from '../app/hooks.ts';
import { navigate } from '../app/router.ts';
import { engine, useEngineState } from '../app/store.ts';
import { Mono, StageTag, when } from '../components/common.tsx';
import { PatchedTag } from '../components/patch.tsx';
import { TechnicalTag } from '../components/technical.tsx';
import { draftSelfTest } from '../components/personal-sim.tsx';
import { canReadFeature, displayName, draftReviewRequired, EDITABLE_STAGES, featureChanges, submitFeature } from '../engine/config.ts';
import { returnFeature } from '../engine/intake.ts';
import { isCollectible } from '../engine/integration.ts';
import { useI18n } from '../i18n/i18n.tsx';
import { CANDIDATE_STATUS_LABELS, FEEDBACK_LABELS, STAGE_LABELS, setName } from '../i18n/vocab.ts';
import { FilesTab } from './feature/FilesTab.tsx';
import { ChangesTab, CommitsTab, FeedbackTimeline } from './feature/HistoryTab.tsx';
import { IntakeTab } from './feature/IntakeTab.tsx';
import { PoliciesTab } from './feature/PoliciesTab.tsx';
import { ValidationTab } from './feature/ValidationTab.tsx';

export function FeatureDetailPage({ featureId }: { featureId: string }) {
  const state = useEngineState();
  const actor = useActor()!;
  const { L, B } = useI18n();
  const can = useCan();
  const run = useRun();
  const { modal } = App.useApp();
  const [submitting, setSubmitting] = useState(false);
  const [returning, setReturning] = useState(false);
  const [text, setText] = useState('');

  const feature = state.features[featureId];
  if (!feature || !canReadFeature(state, actor, feature)) {
    return <Result status="404" title={L('Feature 不存在或无权查看', 'Feature not found or not visible')} extra={<Button onClick={() => navigate('features')}>{L('返回', 'Back')}</Button>} />;
  }
  const group = state.groups[feature.groupId]!;
  const target = { workspaceId: feature.workspaceId, groupId: group.id, scope: group.domain };
  const unsubmitted = !featureChanges(state, feature).sinceHead.empty;
  // Submitting an unchanged draft only reuses the head commit, so offer it when there is something to submit.
  // A DCL technical change is submitted by DCL itself and never returned to business authors.
  const technical = feature.kind === 'TECHNICAL';
  const canSubmit = EDITABLE_STAGES.includes(feature.stage) && (feature.stage === 'DRAFT' || unsubmitted) && can(technical ? 'technical.manage' : 'feature.submit', target);
  const canReturn = !technical && (feature.stage === 'SUBMITTED' || feature.stage === 'DCL_READY') && can('feature.return', target);
  const verifiedHeadCollectible = feature.stage === 'DRAFT' && unsubmitted && isCollectible(state, feature);
  const latestFeedback = state.feedback.filter((f) => f.featureId === feature.id && f.commitId === feature.headCommitId).at(-1);
  const integratedIn = Object.values(state.candidates).filter((c) => c.sources.some((x) => x.featureId === feature.id));
  const review = draftReviewRequired(state, feature);
  const selfTest = draftSelfTest(state, feature);

  return (
    <div className="kz-page">
      <Space style={{ marginBottom: 12 }}>
        <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => navigate('features')}>
          {L('Feature 列表', 'Features')}
        </Button>
      </Space>
      <Card>
        <Space orientation="vertical" style={{ width: '100%' }}>
          <Space wrap style={{ justifyContent: 'space-between', width: '100%' }}>
            <Space>
              <Typography.Title level={3} style={{ margin: 0 }}>
                <Mono>{feature.name}</Mono>
              </Typography.Title>
              <StageTag stage={feature.stage} />
              <TechnicalTag feature={feature} />
              <PatchedTag feature={feature} />
            </Space>
            <Space>
              {canReturn && <Button onClick={() => (setText(''), setReturning(true))}>{L('退回业务方', 'Return to authors')}</Button>}
              {canSubmit && (
                <Button type="primary" onClick={() => (setText(''), setSubmitting(true))}>
                  {L('提交', 'Submit')}
                </Button>
              )}
            </Space>
          </Space>
          <Descriptions size="small" column={{ xs: 1, md: 3 }}>
            <Descriptions.Item label={L('业务分组', 'Group')}>
              {group.name} <Mono>({group.code})</Mono>
            </Descriptions.Item>
            <Descriptions.Item label={L('工作区', 'Workspace')}>{state.workspaces[feature.workspaceId]?.name}</Descriptions.Item>
            <Descriptions.Item label={L('基线', 'Base')}>
              {feature.baseReleaseId ? <Mono>{B(setName(state.releases[feature.baseReleaseId]!.dclVersion))}</Mono> : L('初始研发配置', 'Initial development config')}
            </Descriptions.Item>
            <Descriptions.Item label={L('最新提交', 'Head commit')}>{feature.headCommitId ? <Mono>{displayName(state, feature.headCommitId)}</Mono> : '—'}</Descriptions.Item>
            <Descriptions.Item label={L('车型', 'Vehicle model')}>{feature.vehicleModelId}</Descriptions.Item>
            <Descriptions.Item label={L('更新', 'Updated')}>{when(feature.updatedAt)}</Descriptions.Item>
            {integratedIn.length > 0 && (
              <Descriptions.Item label={L('集成与发布', 'Integrated in')} span="filled">
                <Space wrap>
                  {integratedIn.map((c) => {
                    const release = Object.values(state.releases).find((r) => r.candidateId === c.id);
                    return (
                      <Tag key={c.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`integration/${c.id}`)}>
                        {c.label}
                        {release ? ` → ${B(setName(release.dclVersion))}` : ` · ${B(CANDIDATE_STATUS_LABELS[c.status])}`}
                      </Tag>
                    );
                  })}
                </Space>
              </Descriptions.Item>
            )}
          </Descriptions>
          {feature.description && <Typography.Text type="secondary">{feature.description}</Typography.Text>}
          {feature.stage === 'DRAFT' && latestFeedback && (
            <Alert type="warning" showIcon title={B(FEEDBACK_LABELS[latestFeedback.kind])} description={latestFeedback.reason} />
          )}
          {feature.stage === 'DRAFT' && unsubmitted && !verifiedHeadCollectible && <Alert type="info" showIcon title={L('草稿有未提交的修改。', 'The draft has unsubmitted changes.')} />}
          {verifiedHeadCollectible && (
            <Alert
              type="info"
              showIcon
              title={L('草稿有未提交的修改；已验证的最新提交仍可被集成收集。', 'The draft has unsubmitted changes; the verified head commit can still be integrated.')}
              description={L(
                `集成收集的是 ${displayName(state, feature.headCommitId!)}。提交草稿会生成新提交，需重新测试与验证，旧结果不继承。`,
                `Integration collects ${displayName(state, feature.headCommitId!)}. Submitting the draft creates a new commit that must be tested and verified again; old results do not carry over.`,
              )}
            />
          )}
          {feature.stage === 'ARCHIVED' && unsubmitted && (
            <Alert
              type="warning"
              showIcon
              title={L('草稿中未提交的修改没有进入发布，已随归档冻结。', 'Unsubmitted draft changes did not go into the release and are frozen with the archive.')}
              description={L('后续修改请基于最新正式版本新建 Feature。', 'Make further changes in a new Feature based on the latest release.')}
            />
          )}
          {feature.stage === 'SUBMITTED' && <Alert type="warning" showIcon title={L('等待 DCL 工程审核敏感文件。', 'Waiting for DCL engineering to review sensitive files.')} />}
        </Space>
      </Card>
      <Tabs
        style={{ marginTop: 16 }}
        items={[
          { key: 'files', label: L('文件列表', 'Files'), children: <FilesTab feature={feature} /> },
          { key: 'policies', label: L('采集策略', 'Policies'), children: <PoliciesTab feature={feature} /> },
          { key: 'changes', label: L('变更', 'Changes'), children: <ChangesTab feature={feature} /> },
          { key: 'commits', label: L('提交历史', 'Commits'), children: <CommitsTab feature={feature} /> },
          { key: 'intake', label: L('DCL 接入', 'DCL intake'), children: <IntakeTab feature={feature} /> },
          { key: 'validation', label: L('下发与测试', 'Dispatch & tests'), children: <ValidationTab feature={feature} /> },
          { key: 'feedback', label: L('反馈', 'Feedback'), children: <Card><FeedbackTimeline feature={feature} /></Card> },
        ]}
      />
      <Modal
        open={submitting}
        title={L('提交 Feature', 'Submit Feature')}
        okText={L('提交', 'Submit')}
        onCancel={() => setSubmitting(false)}
        onOk={() => {
          const r = run((c) => submitFeature(c, feature.id, { message: text }));
          if (r) {
            setSubmitting(false);
            modal.success({
              title: r.reused ? L('内容与最新提交一致，复用该提交', 'Unchanged; the head commit is reused') : L('已生成新提交', 'New commit created'),
              content: `${displayName(engine.getState(), r.commitId)} · ${L('阶段', 'stage')}: ${B(STAGE_LABELS[r.stage], r.stage)}`,
            });
          }
        }}
      >
        <Typography.Paragraph type="secondary">
          {review.length
            ? L(`草稿含 ${review.length} 个需敏感审核的文件；没有现行批准时会进入 DCL 接入队列。`, `${review.length} file(s) need sensitive review; without a current approval the Feature goes to DCL intake.`)
            : L('普通内容提交后直接 DCL Ready。', 'Ordinary content becomes DCL Ready right away.')}
        </Typography.Paragraph>
        <Typography.Paragraph type="secondary">
          {selfTest === 'PASS'
            ? L('这份草稿在个人仿真上自测 PASS（仅供参考，团队测试仍需进行）。', 'This draft passed a self-test on a personal simulation (for reference; team testing still applies).')
            : selfTest === 'FAIL'
              ? L('这份草稿最近一次个人自测为 FAIL（仅供参考，不阻止提交）。', 'This draft’s latest personal self-test failed (for reference; it does not block submitting).')
              : L('这份草稿还没有个人自测（可选）。', 'This draft has no personal self-test (optional).')}
        </Typography.Paragraph>
        <Input.TextArea rows={2} placeholder={L('提交说明（可选）', 'Commit message (optional)')} value={text} onChange={(e) => setText(e.target.value)} />
      </Modal>
      <Modal
        open={returning}
        title={L('退回业务方', 'Return to authors')}
        okText={L('退回', 'Return')}
        okButtonProps={{ danger: true }}
        onCancel={() => setReturning(false)}
        onOk={() => {
          if (run((c) => returnFeature(c, feature.id, { reason: text }), L('已退回', 'Returned')) !== undefined) setReturning(false);
        }}
      >
        <Input.TextArea rows={3} placeholder={L('需要修改的内容', 'What needs to change')} value={text} onChange={(e) => setText(e.target.value)} />
      </Modal>
    </div>
  );
}

