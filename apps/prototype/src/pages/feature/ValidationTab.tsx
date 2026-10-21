import { Alert, Button, Card, Space, Typography } from 'antd';
import { useState } from 'react';
import { useCan, useRun } from '../../app/hooks.ts';
import { useEngineState } from '../../app/store.ts';
import { Hint, Mono } from '../../components/common.tsx';
import { DeploymentsTable, DispatchModal, RecordTestModal, TargetsTable } from '../../components/testing.tsx';
import { displayName } from '../../engine/config.ts';
import { vehicleGroupsOf } from '../../engine/fleet.ts';
import type { Feature } from '../../engine/types.ts';
import { cancelDeployment, deploymentsOf, dispatchFeature, featureTestStatus, recordFeatureTest, verifyBlockers, verifyFeature } from '../../engine/validation.ts';
import { useI18n } from '../../i18n/i18n.tsx';

export function ValidationTab({ feature }: { feature: Feature }) {
  const state = useEngineState();
  const { L } = useI18n();
  const can = useCan();
  const run = useRun();
  const [dispatching, setDispatching] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const group = state.groups[feature.groupId]!;
  const target = (env: 'development' | 'testing') => ({ workspaceId: feature.workspaceId, groupId: group.id, scope: group.domain, env });

  const dispatchable = ['DCL_READY', 'TESTING', 'VERIFIED'].includes(feature.stage);
  const vehicleGroups = vehicleGroupsOf(state, feature.workspaceId).filter((g) => g.status === 'ACTIVE' && g.groupId === feature.groupId && g.purpose !== 'PRODUCTION');
  const canDispatch = dispatchable && vehicleGroups.some((g) => can('feature.dispatch', target(g.env as 'development')));
  const status = featureTestStatus(state, feature);
  const blockers = verifyBlockers(state, feature);
  const canVerify = feature.stage === 'TESTING' && can('feature.verify', { workspaceId: feature.workspaceId, groupId: group.id });

  return (
    <Space orientation="vertical" size={16} style={{ width: '100%' }}>
      <Card
        title={L('验证目标（当前提交）', 'Test targets (head commit)')}
        extra={
          <Space>
            {canDispatch && (
              <Button type="primary" onClick={() => setDispatching(true)}>
                {L('按车辆组下发', 'Dispatch to vehicle groups')}
              </Button>
            )}
            {canVerify && (
              <Button disabled={blockers.length > 0} onClick={() => run((c) => verifyFeature(c, feature.id), L('已确认 Verified，可交给配置集成', 'Verified; ready for integration'))}>
                {L('确认 Verified', 'Confirm Verified')}
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
        {feature.headCommitId && <Typography.Paragraph><Mono>{displayName(state, feature.headCommitId)}</Mono></Typography.Paragraph>}
        {!dispatchable && <Alert type="info" showIcon title={L('Feature 达到 DCL Ready 后才能下发。', 'Dispatch becomes available once the Feature is DCL Ready.')} />}
        {feature.stage === 'TESTING' && blockers.length > 0 && (
          <Alert type="warning" showIcon style={{ marginBottom: 12 }} title={L('尚不能确认 Verified', 'Not verifiable yet')} description={blockers.join('；')} />
        )}
        {feature.stage === 'VERIFIED' && <Alert type="success" showIcon style={{ marginBottom: 12 }} title={L('当前提交已验证，可由配置集成收集。', 'The head commit is verified and can be collected by integration.')} />}
        <TargetsTable
          status={status}
          action={(t) =>
            feature.stage === 'TESTING' &&
            t.applied &&
            can('feature.recordTest', target(state.resources[t.resourceId]!.env as 'development')) && (
              <Button size="small" onClick={() => setTesting(t.resourceId)}>
                {L('登记结果', 'Record result')}
              </Button>
            )
          }
        />
      </Card>

      <Card title={L('下发记录', 'Dispatches')}>
        <DeploymentsTable
          deployments={deploymentsOf(state, feature.id)}
          canCancel={(d) => can('feature.dispatch', target(d.env as 'development'))}
          onCancel={(d) => run((c) => cancelDeployment(c, d.id, L('手动取消', 'Cancelled manually')), L('已取消', 'Cancelled'))}
        />
      </Card>

      <DispatchModal
        open={dispatching}
        groups={vehicleGroups}
        emptyText={L('本工作区没有服务该分组的车辆组；请联系工作区管理员。', 'No vehicle group serves this group here; ask the workspace admin.')}
        onClose={() => setDispatching(false)}
        onDispatch={(ids) =>
          run((c) => dispatchFeature(c, feature.id, { commitId: feature.headCommitId!, vehicleGroupIds: ids }), L('已下发，等待车辆回执', 'Dispatched; waiting for vehicle receipts')) !== undefined
        }
      />
      <RecordTestModal
        resourceId={testing}
        onClose={() => setTesting(null)}
        onRecord={(v) => run((c) => recordFeatureTest(c, feature.id, { commitId: feature.headCommitId!, resourceId: testing!, ...v }), L('已登记', 'Recorded')) !== undefined}
      />
    </Space>
  );
}
