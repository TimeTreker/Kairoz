// A vehicle's whole-vehicle software change and what it means for its group's configuration:
// the base, the files and the policies that depend on them, with the next step for each outcome.
// The platform never creates a branch or publishes by itself; the team decides here.

import { Alert, Button, Descriptions, Drawer, Space, Tag, Typography } from 'antd';
import { useState } from 'react';
import { useCan, useRun } from '../app/hooks.ts';
import { navigate } from '../app/router.ts';
import { useEngineState } from '../app/store.ts';
import { dispatchToVehicle } from '../engine/delivery.ts';
import { acknowledgeSoftwareChange, assessSoftwareChange, softwareChangeTarget } from '../engine/software-change.ts';
import { useI18n } from '../i18n/i18n.tsx';
import { CHANGE_OUTCOME_COLORS, CHANGE_OUTCOME_LABELS, SOFTWARE_SOURCE_LABELS } from '../i18n/vocab.ts';
import { Mono, when } from './common.tsx';
import { ChangesToRedo, CheckCards, NewFeatureOnBaseModal, outcomeAlert } from './publication-check.tsx';
import { UpdateSoftwareModal, useCanUpdateSoftware } from './vehicle-software.tsx';

/** The tag for a change's outcome, as rows and lists show it. */
export function OutcomeTag({ changeId }: { changeId: string }) {
  const state = useEngineState();
  const { B } = useI18n();
  const outcome = assessSoftwareChange(state, changeId).outcome;
  return <Tag color={CHANGE_OUTCOME_COLORS[outcome]}>{B(CHANGE_OUTCOME_LABELS[outcome])}</Tag>;
}

export function SoftwareChangeDrawer({ changeId, onClose }: { changeId: string | null; onClose: () => void }) {
  const state = useEngineState();
  const can = useCan();
  const run = useRun();
  const { L, B } = useI18n();
  const canUpdate = useCanUpdateSoftware();
  const [naming, setNaming] = useState(false);
  const [updating, setUpdating] = useState(false);
  if (!changeId || !state.softwareChanges[changeId]) return <Drawer open={false} onClose={onClose} />;
  const a = assessSoftwareChange(state, changeId);
  const c = a.change;
  const r = state.resources[c.resourceId]!;
  const feature = a.featureId ? state.features[a.featureId] : undefined;
  const target = softwareChangeTarget(state, c);
  const canAct = !!target && can('feature.dispatch', target);
  const canCreate = !!feature && can('feature.create', { workspaceId: feature.workspaceId, groupId: feature.groupId });
  const explain: Record<string, string> = {
    NONE: L('新旧版本使用同一个策略集，本组文件与策略在新软件上都可运行。确认即可，不需要新建分支或重新下发；车上的测试结果继续有效。', 'Both versions use the same policy set and the group’s files and policies all run on the new software. Just confirm: no new branch and no new dispatch; the vehicle’s test results still count.'),
    FIX: L('本组有文件或策略在新软件上不可用。请在原 Feature 中先改文件、再改依赖它的策略，提交后下发到车辆组并重新测试。', 'Some of the group’s files or policies do not work on the new software. In the Feature, fix the files first and then the policies that depend on them; commit, dispatch to the group and test again.'),
    REPUBLISH: L('新软件对应另一个策略集，但没有改动本组内容。确认并下发：在新基线上把同一提交下发到这辆车（车辆运行的组合变了，需要重新测试）；或把车辆更新回原版本。', 'The new software takes another policy set that leaves the group’s content alone. Confirm and dispatch the same commit to this vehicle on the new base (the combination changed, so test again), or update the vehicle back.'),
    NEW_FEATURE: a.integrated
      ? L('新软件对应的策略集改动了本组内容。本 Feature 已集成；后续修改请在新基线上新建 Feature。', 'The new software’s policy set changed this group. This Feature is already integrated; make further changes in a Feature on the new base.')
      : L('新软件对应的策略集改动了本组内容。请在新基线上新建 Feature，按下方列出的本 Feature 的修改重做，再提交、下发和测试。', 'The new software’s policy set changed this group. Start a Feature on the new base, redo this Feature’s changes listed below, then commit, dispatchlish and test.'),
    UNKNOWN_SOFTWARE: L('车辆的整车软件版本未知，无法检查。', 'The vehicle’s software is unknown, so nothing can be checked.'),
    NO_BASE: L('新软件还没有适用的策略集。等待适用性确认，或由工作区管理员为车辆组指定显式基线；车辆保持已生效配置。', 'No policy set applies to the new software yet. Wait for the applicability check, or have the workspace admin give the group an explicit base; the vehicle keeps its applied configuration.'),
    CANNOT_CHECK: L('新软件没有登记软件清单，无法逐条检查；请车辆资源补录清单。', 'The new software has no recorded manifest, so nothing can be checked; ask vehicle resources to record it.'),
    PRODUCTION: L('量产车没有 Feature：按新软件版本当前适用的策略集运行，没有适用策略集时由配置发布处理。', 'Production cars run no Features: they take the set in effect for the new software, and config release handles versions without one.'),
    NOT_PUBLISHED: L('车辆组没有下发 Feature，没有需要检查的本组内容。', 'Nothing is dispatched to the vehicle’s group, so there is nothing of a team to check.'),
    UNRECORDED: L('车辆上报的版本平台尚未登记；车辆资源登记该版本并确认后再检查。', 'The platform has not recorded the reported version; vehicle resources record and confirm it first.'),
  };
  // The two choices when the software does not fit: adapt the policies, or update the vehicle.
  const mismatch = ['FIX', 'REPUBLISH', 'NEW_FEATURE', 'NO_BASE', 'CANNOT_CHECK'].includes(a.outcome);
  const mayUpdate = mismatch && !!target && c.status === 'APPLIED' && canUpdate(target.workspaceId, r);

  return (
    <Drawer open size={820} title={`${L('整车软件版本变化', 'Vehicle software change')} · ${r.id}`} onClose={onClose}
      extra={
        canAct && !c.acknowledgedBy && c.status === 'APPLIED' && (
          <Button type="primary" onClick={() => run((x) => acknowledgeSoftwareChange(x, c.id), L('已确认', 'Confirmed'))}>
            {L('确认', 'Confirm')}
          </Button>
        )
      }
    >
      <Space orientation="vertical" size={16} style={{ width: '100%' }}>
        <Descriptions size="small" column={{ xs: 1, sm: 1, md: 2 }} bordered>
          <Descriptions.Item label={L('版本', 'Version')}>
            <Mono>{`${c.fromVersion ?? '—'} → ${c.toVersion}`}</Mono>
          </Descriptions.Item>
          <Descriptions.Item label={L('来源', 'Source')}>
            {B(SOFTWARE_SOURCE_LABELS[c.source])} · {when(c.at)}
          </Descriptions.Item>
          <Descriptions.Item label={L('车辆组', 'Vehicle group')}>{a.vehicleGroupId ? state.vehicleGroups[a.vehicleGroupId]?.name : '—'}</Descriptions.Item>
          <Descriptions.Item label={L('下发的 Feature', 'Dispatched Feature')}>{feature ? `${feature.name} · r${String(state.commits[a.commitId!]?.sequence ?? 0).padStart(3, '0')}` : '—'}</Descriptions.Item>
          <Descriptions.Item label={L('确认', 'Confirmed')} span="filled">
            {c.acknowledgedBy ? `${state.accounts[c.acknowledgedBy]?.displayName ?? c.acknowledgedBy} · ${when(c.acknowledgedAt)}` : L('未确认', 'Not yet')}
          </Descriptions.Item>
        </Descriptions>

        <Alert type={outcomeAlert(a.outcome)} showIcon title={B(CHANGE_OUTCOME_LABELS[a.outcome])} description={explain[a.outcome]}
          action={
            feature && (
              <Space orientation="vertical">
                {a.outcome === 'FIX' && (
                  <Button size="small" onClick={() => navigate(`features/${feature.id}`)}>
                    {L('打开 Feature', 'Open the Feature')}
                  </Button>
                )}
                {a.outcome === 'REPUBLISH' && canAct && !c.acknowledgedBy && !(a.vehicleGroupId && state.vehicleGroups[a.vehicleGroupId]?.requiresApproval) && (
                  <Button size="small" type="primary" onClick={() => run((x) => dispatchToVehicle(x, r.id), L('已确认并下发到该车', 'Confirmed and dispatched to the vehicle'))}>
                    {L('确认并下发', 'Confirm and dispatch')}
                  </Button>
                )}
                {a.outcome === 'NEW_FEATURE' && canCreate && a.newBaseId && (
                  <Button size="small" type="primary" onClick={() => setNaming(true)}>
                    {L('在新基线上新建 Feature', 'Start a Feature on the new base')}
                  </Button>
                )}
                {mayUpdate && (
                  <Button size="small" onClick={() => setUpdating(true)}>
                    {L('更新整车版本', 'Update vehicle software')}
                  </Button>
                )}
              </Space>
            )
          }
        />
        {mismatch && feature && (
          <Typography.Text type="secondary">
            {L('两种做法：修改策略去适配新版本；或不改策略，把车辆更新到策略可用的版本。', 'Two ways: adapt the policies to the new version, or keep them and update the vehicle to a version they fit.')}
          </Typography.Text>
        )}

        {a.vehicleGroupId && feature && (
          <>
            <CheckCards check={a} running={L('车上配置的基线', 'Base the vehicle runs')} target={L('新软件对应的基线', 'base for the new software')} />
            {a.outcome === 'NEW_FEATURE' && !a.integrated && a.commitId && <ChangesToRedo feature={feature} commitId={a.commitId} />}
          </>
        )}
      </Space>
      {feature && <NewFeatureOnBaseModal feature={feature} baseId={a.newBaseId} open={naming} onClose={() => setNaming(false)} onCreated={onClose} />}
      {updating && target && <UpdateSoftwareModal workspaceId={target.workspaceId} resourceId={r.id} onClose={() => setUpdating(false)} />}
    </Drawer>
  );
}
