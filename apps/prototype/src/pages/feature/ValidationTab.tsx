import { Alert, Button, Card, Select, Space, Table, Tag, Tooltip, Typography } from 'antd';
import { useState } from 'react';
import { useActor, useCan, useRun } from '../../app/hooks.ts';
import { useEngineState } from '../../app/store.ts';
import { Hint, Mono, when } from '../../components/common.tsx';
import { PersonalTestsCard } from '../../components/personal-sim.tsx';
import { DeploymentsTable, DispatchModal, RecordTestModal, TargetsTable } from '../../components/testing.tsx';
import { displayName } from '../../engine/config.ts';
import { vehicleGroupsOf } from '../../engine/fleet.ts';
import { releasesOf } from '../../engine/release.ts';
import type { Feature } from '../../engine/types.ts';
import {
  cancelDeployment,
  deploymentsOf,
  dispatchFeature,
  executeTestRequest,
  featureTestStatus,
  historyCommitProblem,
  recordFeatureTest,
  testStatusFor,
  requestTeamTest,
  verifyBlockers,
  verifyFeature,
  withdrawTestRequest,
} from '../../engine/validation.ts';
import { REQUEST_STATUS_COLORS, REQUEST_STATUS_LABELS } from '../../i18n/vocab.ts';
import { useI18n } from '../../i18n/i18n.tsx';
import { issueLabel } from '../../i18n/issues.ts';

export function ValidationTab({ feature }: { feature: Feature }) {
  const state = useEngineState();
  const { L, B } = useI18n();
  const can = useCan();
  const run = useRun();
  const actor = useActor()!;
  const [dispatching, setDispatching] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const group = state.groups[feature.groupId]!;
  // The head is what is verified; an earlier commit can be dispatched and tested on its own (regression).
  const commits = Object.values(state.commits).filter((c) => c.featureId === feature.id).sort((a, b) => b.sequence - a.sequence);
  const commitId = picked && state.commits[picked]?.featureId === feature.id ? picked : feature.headCommitId;
  const historical = !!commitId && commitId !== feature.headCommitId;
  const historyProblem = historical ? historyCommitProblem(state, feature, commitId!) : null;
  const target = (env: 'development' | 'testing') => ({ workspaceId: feature.workspaceId, groupId: group.id, scope: group.domain, env });

  const dispatchable = ['DCL_READY', 'TESTING', 'VERIFIED'].includes(feature.stage);
  const vehicleGroups = vehicleGroupsOf(state, feature.workspaceId).filter((g) => g.status === 'ACTIVE' && g.groupId === feature.groupId && g.purpose !== 'PRODUCTION');
  const directGroups = vehicleGroups.filter((g) => !g.requiresApproval);
  const approvalGroups = vehicleGroups.filter((g) => g.requiresApproval);
  const canDispatch = dispatchable && !historyProblem && directGroups.some((g) => can('feature.dispatch', target(g.env as 'development')));
  const canRequest = dispatchable && !historical && approvalGroups.some((g) => can('feature.requestTest', target(g.env as 'development')));
  const requests = Object.values(state.testRequests)
    .filter((r) => r.featureId === feature.id)
    .sort((a, b) => b.id.localeCompare(a.id));
  // Other groups' policies in the model's policy sets: what a dispatch may switch off.
  const switchable = [
    ...new Map(
      releasesOf(state, feature.vehicleModelId).flatMap((r) =>
        Object.entries(r.groups)
          .filter(([g]) => g !== feature.groupId)
          .flatMap(([g, commitId]) => Object.keys(state.commits[commitId]!.policies).map((policyId) => [policyId, { policyId, group: state.groups[g]?.code ?? g }] as const)),
      ),
    ).values(),
  ].sort((a, b) => a.policyId.localeCompare(b.policyId));
  const status = historical ? testStatusFor(state, feature.id, commitId!) : featureTestStatus(state, feature);
  const blockers = verifyBlockers(state, feature);
  const canVerify = !historical && feature.stage === 'TESTING' && can('feature.verify', { workspaceId: feature.workspaceId, groupId: group.id });

  return (
    <Space orientation="vertical" size={16} style={{ width: '100%' }}>
      <Card
        title={
          commits.length > 1 ? (
            <Space wrap>
              <span>{L('验证目标', 'Test targets')}</span>
              <Select
                size="small"
                style={{ minWidth: 260 }}
                value={commitId ?? undefined}
                onChange={setPicked}
                options={commits.map((c) => ({ value: c.id, label: `${displayName(state, c.id)}${c.id === feature.headCommitId ? L('（当前）', ' (head)') : L('（历史）', ' (earlier)')}` }))}
              />
            </Space>
          ) : (
            L('验证目标（当前提交）', 'Test targets (head commit)')
          )
        }
        extra={
          <Space>
            {canRequest && (
              <Button type="primary" onClick={() => setRequesting(true)}>
                {L('申请团队测试', 'Request team test')}
              </Button>
            )}
            {canDispatch && (
              <Button type="primary" onClick={() => setDispatching(true)}>
                {L('按车辆组下发', 'Dispatch to vehicle groups')}
              </Button>
            )}
            {canVerify && (
              <Button disabled={blockers.length > 0} onClick={() => run((c) => verifyFeature(c, feature.id), L('已确认验证通过，可交给配置集成', 'Verified; ready for integration'))}>
                {L('确认验证通过', 'Confirm Verified')}
              </Button>
            )}
          </Space>
        }
      >
        <Hint>
          {L(
            '测试固定在当前提交：先仿真再实车；车辆确认应用（回执成功）后才能登记结果。新提交需要重新下发和验证，旧结果不能验证新内容。',
            'Tests pin to the head commit: simulation first, then physical; results are recorded only after the vehicle confirms applying it. A new commit needs a new dispatch; old results never verify new content.',
          )}
        </Hint>
        {commitId && <Typography.Paragraph><Mono>{displayName(state, commitId)}</Mono></Typography.Paragraph>}
        {historical && (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            title={L('历史提交：可以单独下发和登记结果，做回归对比。', 'An earlier commit: it can be dispatched and tested on its own, for a regression comparison.')}
            description={
              historyProblem
                ? historyProblem.startsWith('changes were requested')
                  ? L('这个提交被要求修改（退回、处理绑定调整或引用撤销），不能下发。', 'Changes were requested on this commit (returned, binding changed or reference revoked), so it cannot be dispatched.')
                  : historyProblem.startsWith('that commit no longer passes')
                    ? L(`这个提交已不符合提交检查（数据项、引用授权、策略或预算），不能下发：${historyProblem.match(/\((.*)\)$/)?.[1] ?? ''}`, `This commit no longer passes the submit checks (data items, granted references, policies or budgets), so it cannot be dispatched: ${historyProblem.match(/\((.*)\)$/)?.[1] ?? ''}`)
                    : L('这个提交有文件没有现行的 DCL 批准，不能下发。', 'A file of this commit lacks a current DCL approval, so it cannot be dispatched.')
                : L('结果只属于这个提交；确认验证通过仍只看当前提交。下发后车辆组改为运行这个提交。', 'Results belong to this commit only; Verified still looks at the head. Once dispatched, the group runs this commit.')
            }
          />
        )}
        {!dispatchable && <Alert type="info" showIcon title={L('Feature 达到 DCL Ready 后才能下发。', 'Dispatch becomes available once the Feature is DCL Ready.')} />}
        {dispatchable && vehicleGroups.length === 0 && (can('feature.dispatch', target('development')) || can('feature.dispatch', target('testing'))) && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 12 }}
            title={L(`本工作区没有服务 ${group.name} 的研发或测试车辆组，暂不能下发。`, `No development or testing vehicle group serves ${group.name} in this workspace, so nothing can be dispatched yet.`)}
            description={L('请工作区管理员在“车辆与车辆组”中为本组建立车辆组并加入车辆。', 'Ask the workspace admin to create a vehicle group for the group under Vehicles & groups and add vehicles.')}
          />
        )}
        {feature.stage === 'TESTING' && blockers.length > 0 && (
          <Alert type="warning" showIcon style={{ marginBottom: 12 }} title={L('尚不能确认验证通过', 'Not verifiable yet')} description={blockers.map((x) => B(issueLabel(x), x)).join(L('；', '; '))} />
        )}
        {feature.stage === 'VERIFIED' && <Alert type="success" showIcon style={{ marginBottom: 12 }} title={L('当前提交已验证，可由配置集成收集。', 'The head commit is verified and can be collected by integration.')} />}
        <TargetsTable
          status={status}
          action={(t) =>
            (historical || feature.stage === 'TESTING') &&
            t.applied &&
            can('feature.recordTest', target(state.resources[t.resourceId]!.env as 'development')) && (
              <Button size="small" onClick={() => setTesting(t.resourceId)}>
                {L('登记结果', 'Record result')}
              </Button>
            )
          }
        />
      </Card>

      {requests.length > 0 && (
        <Card title={L('团队测试申请', 'Team test requests')}>
          <Table
            rowKey="id"
            size="small"
            pagination={false}
            dataSource={requests}
            columns={[
              { title: L('提交', 'Commit'), render: (_, r) => <Mono>{displayName(state, r.commitId)}</Mono> },
              { title: L('车辆组 / 车辆', 'Groups / vehicles'), render: (_, r) => `${r.vehicleGroupIds.map((g) => state.vehicleGroups[g]?.name).join(', ')} · ${r.members.join(', ')}` },
              { title: L('目标', 'Goal'), render: (_, r) => (r.disabledPolicies.length ? `${r.goal} · ${L('关闭', 'off')} ${r.disabledPolicies.join(', ')}` : r.goal) },
              { title: L('申请人', 'By'), render: (_, r) => `${state.accounts[r.requestedBy]?.displayName} · ${when(r.requestedAt)}` },
              {
                title: L('状态', 'Status'),
                render: (_, r) => (
                  <Tooltip title={r.decidedBy ? `${state.accounts[r.decidedBy]?.displayName}: ${r.decisionNote}` : undefined}>
                    <Tag color={REQUEST_STATUS_COLORS[r.status]}>{B(REQUEST_STATUS_LABELS[r.status])}</Tag>
                  </Tooltip>
                ),
              },
              {
                title: '',
                render: (_, r) => (
                  <Space size={0}>
                    {r.status === 'APPROVED' && can('feature.dispatch', target(state.vehicleGroups[r.vehicleGroupIds[0]!]?.env as 'development')) && (
                      <Button type="link" size="small" onClick={() => run((c) => executeTestRequest(c, r.id), L('已按批准下发，等待车辆回执', 'Dispatched as approved; waiting for receipts'))}>
                        {L('执行', 'Execute')}
                      </Button>
                    )}
                    {['PENDING', 'APPROVED'].includes(r.status) && r.requestedBy === actor.username && (
                      <Button type="link" size="small" danger onClick={() => run((c) => withdrawTestRequest(c, r.id), L('已撤回', 'Withdrawn'))}>
                        {L('撤回', 'Withdraw')}
                      </Button>
                    )}
                  </Space>
                ),
              },
            ]}
          />
        </Card>
      )}

      <Card title={L('下发记录', 'Dispatches')}>
        <DeploymentsTable
          deployments={deploymentsOf(state, feature.id)}
          canCancel={(d) => can('feature.dispatch', target(d.env as 'development'))}
          onCancel={(d, reason) => run((c) => cancelDeployment(c, d.id, reason), L('已取消下发', 'Dispatch cancelled'))}
        />
      </Card>

      <PersonalTestsCard feature={feature} />

      <DispatchModal
        open={requesting}
        request
        groups={approvalGroups}
        switchable={switchable}
        emptyText=""
        onClose={() => setRequesting(false)}
        onDispatch={(ids, goal, _direct, disabledPolicies) =>
          run((c) => requestTeamTest(c, feature.id, { commitId: feature.headCommitId!, vehicleGroupIds: ids, disabledPolicies, goal }), L('已提交申请，等待工作区管理员审批', 'Request submitted; waiting for the workspace admin')) !== undefined
        }
      />
      <DispatchModal
        open={dispatching}
        groups={directGroups}
        switchable={switchable}
        emptyText={L('本工作区没有服务该分组的车辆组；请联系工作区管理员。', 'No vehicle group serves this group here; ask the workspace admin.')}
        onClose={() => setDispatching(false)}
        onDispatch={(ids, _goal, _direct, disabledPolicies) =>
          run((c) => dispatchFeature(c, feature.id, { commitId: commitId!, vehicleGroupIds: ids, disabledPolicies }), L('已下发：车辆上线时推送，回执后生效', 'Dispatched: pushed when each vehicle is on, applied after its receipt')) !== undefined
        }
      />
      <RecordTestModal
        resourceId={testing}
        onClose={() => setTesting(null)}
        onRecord={(v) => run((c) => recordFeatureTest(c, feature.id, { commitId: commitId!, resourceId: testing!, ...v }), L('已登记', 'Recorded')) !== undefined}
      />
    </Space>
  );
}
