import { ArrowLeftOutlined } from '@ant-design/icons';
import { Alert, App, Button, Card, Descriptions, Input, Modal, Result, Space, Tabs, Typography } from 'antd';
import { useState } from 'react';
import { useActor, useCan, useRun } from '../app/hooks.ts';
import { navigate } from '../app/router.ts';
import { engine, useEngineState } from '../app/store.ts';
import { Mono, StageTag, when } from '../components/common.tsx';
import { canReadFeature, displayName, draftReviewRequired, EDITABLE_STAGES, featureChanges, submitFeature } from '../engine/config.ts';
import { returnFeature } from '../engine/intake.ts';
import { useI18n } from '../i18n/i18n.tsx';
import { FEEDBACK_LABELS, STAGE_LABELS } from '../i18n/vocab.ts';
import { FilesTab } from './feature/FilesTab.tsx';
import { ChangesTab, CommitsTab, FeedbackTimeline } from './feature/HistoryTab.tsx';
import { IntakeTab } from './feature/IntakeTab.tsx';
import { PoliciesTab } from './feature/PoliciesTab.tsx';

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
  const canSubmit = EDITABLE_STAGES.includes(feature.stage) && can('feature.submit', target);
  const canReturn = (feature.stage === 'SUBMITTED' || feature.stage === 'DCL_READY') && can('feature.return', target);
  const unsubmitted = !featureChanges(state, feature).sinceHead.empty;
  const latestFeedback = state.feedback.filter((f) => f.featureId === feature.id && f.commitId === feature.headCommitId).at(-1);
  const review = draftReviewRequired(state, feature);

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
              {feature.baseReleaseId ? <Mono>{state.releases[feature.baseReleaseId]?.dclVersion}</Mono> : L('初始研发配置（暂无正式版本）', 'Initial development config (no release yet)')}
            </Descriptions.Item>
            <Descriptions.Item label={L('最新提交', 'Head commit')}>{feature.headCommitId ? <Mono>{displayName(state, feature.headCommitId)}</Mono> : '—'}</Descriptions.Item>
            <Descriptions.Item label={L('车型', 'Vehicle model')}>{feature.vehicleModelId}</Descriptions.Item>
            <Descriptions.Item label={L('更新', 'Updated')}>{when(feature.updatedAt)}</Descriptions.Item>
          </Descriptions>
          {feature.description && <Typography.Text type="secondary">{feature.description}</Typography.Text>}
          {feature.stage === 'DRAFT' && latestFeedback && (
            <Alert type="warning" showIcon message={B(FEEDBACK_LABELS[latestFeedback.kind])} description={latestFeedback.reason} />
          )}
          {feature.stage === 'DRAFT' && unsubmitted && <Alert type="info" showIcon message={L('草稿有未提交的修改。', 'The draft has unsubmitted changes.')} />}
          {feature.stage === 'SUBMITTED' && <Alert type="warning" showIcon message={L('等待 DCL 工程审核敏感文件。', 'Waiting for DCL engineering to review sensitive files.')} />}
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

