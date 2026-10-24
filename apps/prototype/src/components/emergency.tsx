// Emergency stops of one policy (紧急停用): the requests, who decided them, and the set each produced.

import { Button, Card, Input, Modal, Space, Table, Tag, Typography } from 'antd';
import { useState } from 'react';
import { useActor, useCan, useRun } from '../app/hooks.ts';
import { useEngineState } from '../app/store.ts';
import { decideEmergencyStop, emergencyStopsOf, releaseWorkspace, requestEmergencyStop } from '../engine/emergency.ts';
import type { EmergencyStop, Release } from '../engine/types.ts';
import { useI18n } from '../i18n/i18n.tsx';
import { STOP_STATUS_COLORS, STOP_STATUS_LABELS, setName } from '../i18n/vocab.ts';
import { Hint, Mono, when } from './common.tsx';

export function EmergencyStopsCard({ modelId }: { modelId: string }) {
  const state = useEngineState();
  const { L, B } = useI18n();
  const can = useCan();
  const run = useRun();
  const actor = useActor();
  const [deciding, setDeciding] = useState<{ stop: EmergencyStop; decision: 'APPROVED' | 'REJECTED' } | null>(null);
  const [note, setNote] = useState('');
  const stops = emergencyStopsOf(state, modelId);
  if (stops.length === 0) return null;
  return (
    <Card title={L('紧急停用', 'Emergency stops')}>
      <Hint>
        {L(
          '紧急停用由 DCL 工程或配置发布申请、另一名配置发布批准。批准后生成新的策略集版本（源策略集去掉该策略），只适用于源策略集当前生效的软件版本；车辆仍需配置 OTA 才会实际停用。进行中的集成候选需基于新策略集重新集成。',
          'An emergency stop is asked by DCL engineering or configuration release and decided by another release person. Approval publishes a new policy set version (the source set without the policy) for exactly the software versions the source is in effect for; vehicles stop the policy only after a configuration OTA. Open integration candidates must integrate again on the new set.',
        )}
      </Hint>
      <Table
        rowKey="id"
        size="small"
        pagination={false}
        dataSource={stops}
        columns={[
          { title: L('策略集', 'Policy set'), render: (_, x) => B(setName(state.releases[x.releaseId]!.dclVersion)) },
          { title: L('策略', 'Policy'), render: (_, x) => <Mono>{x.policyId}</Mono> },
          { title: L('原因', 'Reason'), dataIndex: 'reason' },
          { title: L('申请', 'Asked by'), render: (_, x) => `${state.accounts[x.requestedBy]?.displayName ?? x.requestedBy} · ${when(x.requestedAt)}` },
          { title: L('状态', 'Status'), render: (_, x) => <Tag color={STOP_STATUS_COLORS[x.status]}>{B(STOP_STATUS_LABELS[x.status])}</Tag> },
          {
            title: L('决定', 'Decision'),
            render: (_, x) =>
              x.decidedBy ? (
                <Space orientation="vertical" size={0}>
                  <span>{`${state.accounts[x.decidedBy]?.displayName} · ${when(x.decidedAt)}`}</span>
                  <Typography.Text type="secondary">{x.decisionNote}</Typography.Text>
                  {x.newReleaseId && <Mono>{`→ ${B(setName(state.releases[x.newReleaseId]!.dclVersion))}`}</Mono>}
                </Space>
              ) : (
                '—'
              ),
          },
          {
            title: '',
            render: (_, x) =>
              x.status === 'REQUESTED' &&
              x.requestedBy !== actor?.username &&
              can('emergency.approve', { workspaceId: releaseWorkspace(state, state.releases[x.releaseId]!), scope: 'Vehicle' }) && (
                <Space size={0}>
                  <Button type="link" size="small" onClick={() => (setNote(''), setDeciding({ stop: x, decision: 'APPROVED' }))}>
                    {L('批准', 'Approve')}
                  </Button>
                  <Button type="link" size="small" danger onClick={() => (setNote(''), setDeciding({ stop: x, decision: 'REJECTED' }))}>
                    {L('拒绝', 'Reject')}
                  </Button>
                </Space>
              ),
          },
        ]}
      />
      <Modal
        open={deciding !== null}
        title={deciding?.decision === 'APPROVED' ? L(`批准紧急停用 ${deciding.stop.policyId}`, `Approve stopping ${deciding.stop.policyId}`) : L('拒绝紧急停用', 'Reject the stop')}
        okButtonProps={{ danger: deciding?.decision === 'APPROVED' }}
        onCancel={() => setDeciding(null)}
        onOk={() => {
          if (!deciding) return;
          const ok = run(
            (c) => decideEmergencyStop(c, deciding.stop.id, { decision: deciding.decision, note }),
            deciding.decision === 'APPROVED' ? L('已发布紧急策略集；用配置 OTA 下发到量产车', 'Emergency set published; deliver it with a configuration OTA') : L('已拒绝', 'Rejected'),
          );
          if (ok !== undefined) setDeciding(null);
        }}
      >
        <Input.TextArea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={L('决定说明', 'Note')} />
      </Modal>
    </Card>
  );
}

/** Asks for an emergency stop of one policy of a set. */
export function RequestStopModal({ target, onClose }: { target: { release: Release; policyId: string } | null; onClose: () => void }) {
  const { L, B } = useI18n();
  const run = useRun();
  const [reason, setReason] = useState('');
  return (
    <Modal
      open={target !== null}
      title={target ? L(`申请紧急停用 · ${target.policyId}`, `Request an emergency stop · ${target.policyId}`) : ''}
      okButtonProps={{ danger: true }}
      okText={L('提交申请', 'Submit request')}
      onCancel={onClose}
      afterOpenChange={(open) => open && setReason('')}
      onOk={() => {
        if (!target) return;
        if (run((c) => requestEmergencyStop(c, { releaseId: target.release.id, policyId: target.policyId, reason }), L('已提交，等待另一名配置发布批准', 'Submitted; another release person decides')) !== undefined) onClose();
      }}
    >
      {target && (
        <Hint>
          {L(
            `批准后会生成 ${B(setName(target.release.dclVersion))} 去掉该策略的新版本，只用于它当前生效的软件版本。`,
            `Approval publishes ${B(setName(target.release.dclVersion))} without this policy as a new version, only for the software versions it is in effect for.`,
          )}
        </Hint>
      )}
      <Input.TextArea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={L('为什么必须马上停用（例如占满带宽、采错数据）', 'Why it must stop now (e.g. floods bandwidth, collects the wrong data)')} />
    </Modal>
  );
}
