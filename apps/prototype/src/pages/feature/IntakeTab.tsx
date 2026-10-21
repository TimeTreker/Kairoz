import { Alert, Button, Card, Checkbox, Form, Input, Modal, Space, Table, Tag, Typography } from 'antd';
import { useState } from 'react';
import { useCan, useRun } from '../../app/hooks.ts';
import { useEngineState } from '../../app/store.ts';
import { Hint, LabelTag, Mono, ShortId, when } from '../../components/common.tsx';
import { reviewItems } from '../../engine/approvals.ts';
import { displayName } from '../../engine/config.ts';
import { reviewFile } from '../../engine/intake.ts';
import { commitSnapshot, resolveFiles } from '../../engine/snapshots.ts';
import type { Feature } from '../../engine/types.ts';
import { useI18n } from '../../i18n/i18n.tsx';
import { FILE_TYPE_LABELS, REVIEW_STATUS_LABELS } from '../../i18n/vocab.ts';

export function IntakeTab({ feature }: { feature: Feature }) {
  const state = useEngineState();
  const { L, B } = useI18n();
  const can = useCan();
  const run = useRun();
  const [deciding, setDeciding] = useState<{ dataKey: string; decision: 'APPROVED' | 'REJECTED' } | null>(null);
  const [form] = Form.useForm();

  if (!feature.headCommitId) return <Hint>{L('尚未提交。提交后，需要审核的文件会出现在这里。', 'Not submitted yet. Files needing review appear here after a submit.')}</Hint>;
  const head = commitSnapshot(state, feature.headCommitId);
  const files = resolveFiles(state, head);
  const items = reviewItems(state, head, { groupId: feature.groupId, workspaceId: feature.workspaceId });
  const inIntake = feature.stage === 'SUBMITTED' || feature.stage === 'DCL_READY';
  const canReview = inIntake && can('feature.review', { workspaceId: feature.workspaceId, groupId: feature.groupId });

  const submitDecision = () =>
    form.validateFields().then((v) => {
      const ok = run(
        (c) =>
          reviewFile(c, feature.id, {
            commitId: feature.headCommitId!,
            dataKey: deciding!.dataKey,
            decision: deciding!.decision,
            reason: v.reason,
            ...(deciding!.decision === 'APPROVED'
              ? {
                  controls: {
                    purposeConfirmed: !!v.purposeConfirmed,
                    scopeConfirmed: !!v.scopeConfirmed,
                    retentionConfirmed: !!v.retentionConfirmed,
                    accessControl: v.accessControl ?? '',
                    uploadControl: v.uploadControl ?? '',
                    processingControl: v.processingControl ?? '',
                  },
                }
              : {}),
          }),
        deciding!.decision === 'APPROVED' ? L('已批准', 'Approved') : L('已拒绝，Feature 退回草稿', 'Rejected; the Feature is back in Draft'),
      );
      if (ok !== undefined) {
        setDeciding(null);
        form.resetFields();
      }
    });

  return (
    <Card title={`${L('敏感审核', 'Sensitive review')} · ${displayName(state, feature.headCommitId)}`}>
      <Hint>
        {L(
          '审核针对已提交的具体文件。批准绑定文件内容、处理绑定与采集它的策略；任何一项变化都需要重新审核。同一分组、工作区中内容相同的提交直接复用批准。',
          'Review applies to a specific committed file. Approval binds the file content, its processing binding and the policies capturing it; any change needs a new review. Identical content in the same group and workspace reuses the approval.',
        )}
      </Hint>
      {items.length === 0 && <Alert type="success" showIcon title={L('该提交没有需要敏感审核的文件。', 'Nothing in this commit needs sensitive review.')} />}
      {items.length > 0 && (
        <Table
          rowKey="dataKey"
          pagination={false}
          dataSource={items}
          columns={[
            {
              title: L('文件', 'File'),
              render: (_, i) => (
                <div>
                  <Typography.Text strong>{files[i.dataKey]?.name}</Typography.Text> {!i.owned && <Tag>{L('引用', 'reference')}</Tag>}
                  <div>
                    <Mono>{`${files[i.dataKey]?.source.unit}:${files[i.dataKey]?.source.directory}/${files[i.dataKey]?.source.pattern}`}</Mono>
                  </div>
                </div>
              ),
            },
            { title: L('类型 / 隐私', 'Type / privacy'), render: (_, i) => `${B(FILE_TYPE_LABELS[files[i.dataKey]!.fileType])} · ${files[i.dataKey]!.privacy}` },
            { title: L('用途', 'Purpose'), render: (_, i) => files[i.dataKey]?.purpose },
            {
              title: L('状态', 'Status'),
              render: (_, i) => (
                <div>
                  <LabelTag map={REVIEW_STATUS_LABELS} value={i.status} color={i.status === 'APPROVED' ? 'green' : i.status === 'REJECTED' ? 'red' : 'orange'} />
                  {i.lastReview && (
                    <div>
                      <Typography.Text type="secondary">
                        {state.accounts[i.lastReview.reviewer]?.displayName} · {when(i.lastReview.createdAt)} · {i.lastReview.reason}
                      </Typography.Text>
                    </div>
                  )}
                </div>
              ),
            },
            { title: L('签名', 'Signatures'), render: (_, i) => <Space orientation="vertical" size={0}><ShortId value={i.fileSignature} /><ShortId value={i.policySignature} /></Space> },
            {
              title: '',
              render: (_, i) =>
                canReview && (
                  <Space size={0}>
                    {i.status !== 'APPROVED' && (
                      <Button type="link" size="small" onClick={() => (form.resetFields(), setDeciding({ dataKey: i.dataKey, decision: 'APPROVED' }))}>
                        {L('批准', 'Approve')}
                      </Button>
                    )}
                    <Button type="link" size="small" danger onClick={() => (form.resetFields(), setDeciding({ dataKey: i.dataKey, decision: 'REJECTED' }))}>
                      {i.status === 'APPROVED' ? L('撤回批准', 'Withdraw approval') : L('拒绝', 'Reject')}
                    </Button>
                  </Space>
                ),
            },
          ]}
        />
      )}
      <Modal
        open={deciding !== null}
        title={deciding?.decision === 'APPROVED' ? L('批准敏感文件', 'Approve sensitive file') : L('拒绝敏感文件', 'Reject sensitive file')}
        okText={deciding?.decision === 'APPROVED' ? L('批准', 'Approve') : L('拒绝', 'Reject')}
        okButtonProps={{ danger: deciding?.decision === 'REJECTED' }}
        onCancel={() => setDeciding(null)}
        onOk={submitDecision}
      >
        <Form form={form} name="review" layout="vertical">
          {deciding?.decision === 'APPROVED' && (
            <>
              <Form.Item name="purposeConfirmed" valuePropName="checked">
                <Checkbox>{L('已确认采集用途', 'Collection purpose confirmed')}</Checkbox>
              </Form.Item>
              <Form.Item name="scopeConfirmed" valuePropName="checked">
                <Checkbox>{L('已确认采集范围（来源、窗口、触发）', 'Collection scope confirmed (source, window, trigger)')}</Checkbox>
              </Form.Item>
              <Form.Item name="retentionConfirmed" valuePropName="checked">
                <Checkbox>{L('已确认保留期限', 'Retention period confirmed')}</Checkbox>
              </Form.Item>
              <Form.Item name="accessControl" label={L('访问控制', 'Access control')}>
                <Input placeholder={L('例如：仅本组与 DCL 工程可读', 'e.g. readable only by the group and DCL')} />
              </Form.Item>
              <Form.Item name="uploadControl" label={L('上传控制', 'Upload control')}>
                <Input placeholder={L('例如：车端加密，仅 Wi-Fi 上传', 'e.g. encrypted on vehicle, Wi-Fi upload only')} />
              </Form.Item>
              <Form.Item name="processingControl" label={L('处理控制', 'Processing control')}>
                <Input placeholder={L('例如：人脸与车牌脱敏（外部引擎）', 'e.g. face and plate masking (external engine)')} />
              </Form.Item>
            </>
          )}
          <Form.Item name="reason" label={L('结论说明', 'Reason')} rules={[{ required: true }]}>
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
