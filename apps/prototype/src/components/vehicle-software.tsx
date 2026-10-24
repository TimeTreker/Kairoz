// The two choices when a vehicle's software does not fit what its group published: adapt the
// policies (and confirm and dispatch to the vehicle), or update the vehicle's whole-vehicle
// software through the vehicle OTA system and leave the policies as they are.

import { Alert, Button, Descriptions, Drawer, Input, Modal, Select, Space, Tag, Typography } from 'antd';
import { useState } from 'react';
import { useCan, useRun } from '../app/hooks.ts';
import { navigate } from '../app/router.ts';
import { useEngineState } from '../app/store.ts';
import { dispatchToVehicle, fitOf } from '../engine/delivery.ts';
import { pendingSoftwareUpdateOf } from '../engine/fleet.ts';
import { compareVersions } from '../engine/release.ts';
import { cancelVehicleSoftware, previewVehicleSoftware, requestVehicleSoftware } from '../engine/vehicle-software.ts';
import type { Resource, State } from '../engine/types.ts';
import { useI18n } from '../i18n/i18n.tsx';
import { issueLabel } from '../i18n/issues.ts';
import { CHANGE_OUTCOME_LABELS, FOLLOW_REASON_LABELS, SOFTWARE_REQUEST_STATUS_COLORS, SOFTWARE_REQUEST_STATUS_LABELS } from '../i18n/vocab.ts';
import { Hint, Mono, when } from './common.tsx';
import { ChangesToRedo, CheckCards, CheckOutcomeTag, NewFeatureOnBaseModal, outcomeAlert } from './publication-check.tsx';

/** Whether the account may ask for a software update of the vehicle in the workspace. */
export function useCanUpdateSoftware() {
  const state = useEngineState();
  const can = useCan();
  return (workspaceId: string, r: Resource) => {
    if (r.type !== 'PHYSICAL' || r.env === 'production' || r.personal) return false;
    const g = state.vehicleGroups[state.groupMembers[r.id] ?? ''];
    const groupId = g && g.workspaceId === workspaceId ? (g.groupId ?? undefined) : undefined;
    return can('vehicle.updateSoftware', { workspaceId, ...(groupId ? { groupId } : {}), scope: r.pool, env: r.env });
  };
}

function recordedVersions(s: State, r: Resource): string[] {
  return Object.values(s.softwareVersions)
    .filter((v) => v.vehicleModelId === r.vehicleModelId && v.version !== r.integrationVersion)
    .map((v) => v.version)
    .sort(compareVersions);
}

/** 更新整车版本: choose a recorded version, see how the group's publication fits it, and ask the vehicle OTA system. */
export function UpdateSoftwareModal({ workspaceId, resourceId, onClose }: { workspaceId: string; resourceId: string | null; onClose: () => void }) {
  const state = useEngineState();
  const run = useRun();
  const { L, B } = useI18n();
  const [version, setVersion] = useState<string | undefined>();
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState(false);
  const r = resourceId ? state.resources[resourceId] : undefined;
  if (!r) return <Modal open={false} />;
  const pendingId = pendingSoftwareUpdateOf(state, r.id);
  const pending = pendingId ? state.vehicleSoftwareRequests[pendingId] : undefined;
  const preview = version ? previewVehicleSoftware(state, r.id, version) : null;
  const close = () => (setVersion(undefined), setReason(''), setDetails(false), onClose());
  return (
    <Modal
      open
      width={pending ? 560 : details ? 900 : 640}
      title={`${L('更新整车版本', 'Update vehicle software')} · ${r.id}`}
      okText={L('提交给整车 OTA', 'Send to vehicle OTA')}
      okButtonProps={{ disabled: !!pending || !version }}
      onCancel={close}
      footer={pending ? null : undefined}
      onOk={() => {
        if (run((c) => requestVehicleSoftware(c, workspaceId, r.id, { version: version!, reason }), L('已提交整车 OTA', 'Sent to vehicle OTA')) !== undefined) close();
      }}
    >
      <Hint>
        {L(
          '不修改策略，而是请整车 OTA 系统把这辆车刷到另一个已登记的版本。车辆重启后上报版本，平台据此更新记录；如果车辆组的发布适用于新版本，云端会推送配置。',
          'Instead of changing the policies, the vehicle OTA system puts this vehicle on another recorded version. The vehicle restarts and reports it, and the platform records it; if the group’s publication fits the new version, the cloud pushes it.',
        )}
      </Hint>
      <Descriptions size="small" column={1} bordered style={{ marginBottom: 12 }}>
        <Descriptions.Item label={L('当前整车版本', 'Current software')}>{r.integrationVersion ? `${r.vehicleModelId} ${r.integrationVersion}` : L('未知', 'Unknown')}</Descriptions.Item>
      </Descriptions>
      {pending ? (
        <Alert
          type="info"
          showIcon
          title={`${B(SOFTWARE_REQUEST_STATUS_LABELS.PENDING)} · ${pending.fromVersion ?? '—'} → ${pending.toVersion}`}
          description={`${state.accounts[pending.requestedBy]?.displayName ?? pending.requestedBy} · ${when(pending.requestedAt)} · ${pending.reason}`}
          action={
            <Button size="small" onClick={() => run((c) => cancelVehicleSoftware(c, pending.id), L('已撤回', 'Withdrawn'))}>
              {L('撤回', 'Withdraw')}
            </Button>
          }
        />
      ) : (
        <Space orientation="vertical" size={12} style={{ width: '100%' }}>
          <Select
            style={{ width: '100%' }}
            placeholder={L('选择目标版本', 'Choose the target version')}
            value={version}
            onChange={setVersion}
            options={recordedVersions(state, r).map((v) => ({ value: v, label: `${r.vehicleModelId} ${v}` }))}
          />
          {preview && (
            <Alert
              type={outcomeAlert(preview.outcome)}
              showIcon
              title={
                <Space>
                  {L('车辆组的发布在该版本上', 'The group’s publication on this version')}
                  <CheckOutcomeTag check={preview} />
                </Space>
              }
              action={
                preview.outcome !== 'NOT_PUBLISHED' && (
                  <Button size="small" type="link" onClick={() => setDetails(!details)}>
                    {details ? L('收起检查', 'Hide the check') : L('查看检查', 'Show the check')}
                  </Button>
                )
              }
            />
          )}
          {preview && details && preview.outcome !== 'NOT_PUBLISHED' && <CheckCards check={preview} running={L('车上配置的基线', 'Base the vehicle runs')} target={L('该版本对应的基线', 'base for that version')} />}
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={L('原因，例如：回到策略适用的版本', 'Reason, e.g. back to a version the policies fit')} />
        </Space>
      )}
    </Modal>
  );
}

/** A software update's state, for vehicle rows. */
export function SoftwareUpdateTag({ resourceId }: { resourceId: string }) {
  const state = useEngineState();
  const { L, B } = useI18n();
  const id = pendingSoftwareUpdateOf(state, resourceId);
  const q = id ? state.vehicleSoftwareRequests[id] : undefined;
  if (!q) return null;
  return (
    <Tag color={SOFTWARE_REQUEST_STATUS_COLORS.PENDING}>
      {L(`整车更新中 → ${q.toVersion}`, `Updating → ${q.toVersion}`)} · {B(SOFTWARE_REQUEST_STATUS_LABELS.PENDING)}
    </Tag>
  );
}

/** A vehicle that waits to follow its group but does not fit what the group published. */
export function GroupFitDrawer({ resourceId, onClose }: { resourceId: string | null; onClose: () => void }) {
  const state = useEngineState();
  const can = useCan();
  const run = useRun();
  const canUpdate = useCanUpdateSoftware();
  const { L, B } = useI18n();
  const [updating, setUpdating] = useState(false);
  const [naming, setNaming] = useState(false);
  const fit = resourceId ? fitOf(state, resourceId) : null;
  if (!fit) return <Drawer open={false} onClose={onClose} />;
  const r = state.resources[fit.resourceId]!;
  const g = state.vehicleGroups[fit.vehicleGroupId]!;
  const p = g.publication;
  const feature = p?.kind === 'FEATURE' ? state.features[p.featureId] : undefined;
  const group = feature ? state.groups[feature.groupId] : undefined;
  const check = fit.check;
  const canDispatch = !!feature && !!group && can('feature.dispatch', { workspaceId: g.workspaceId, groupId: group.id, scope: group.domain, env: g.env });
  const canCreate = !!feature && can('feature.create', { workspaceId: feature.workspaceId, groupId: feature.groupId });
  const resolvable = !['NO_BASE', 'NEW_FEATURE', 'NOT_PUBLISHED', 'PRODUCTION'].includes(check.outcome);
  const explain: Record<string, string> = {
    NONE: L('这辆车与车辆组用同一个基线，本组文件与策略都可运行。', 'The vehicle uses the group’s base and every file and policy of the group runs on it.'),
    REPUBLISH: L('这辆车的软件对应另一个基线，本组内容不受影响。确认并下发后，云端在它的基线上生成配置并推送；也可以把车辆更新到与车辆组相同的版本。', 'The vehicle’s software takes another base that leaves the group’s content alone. Confirm and dispatch to build the configuration on its base and push it, or update the vehicle to the group’s version.'),
    FIX: L('本组有文件或策略在这辆车的软件上不可用。修改策略（在 Feature 中先改文件、再改依赖它的策略，提交后下发），或把车辆更新到策略可用的版本。', 'Some of the group’s files or policies do not work on this vehicle’s software. Adapt the policies (in the Feature, fix the files and then the policies that depend on them, commit and dispatch), or update the vehicle to a version they fit.'),
    NEW_FEATURE: L('这辆车的软件对应的策略集改动了本组内容。在新基线上新建 Feature，或把车辆更新到车辆组的版本。', 'The policy set for this vehicle’s software changed the group. Start a Feature on that base, or update the vehicle to the group’s version.'),
    NO_BASE: L('这辆车的软件没有适用的策略集。把车辆更新到有策略集的版本，或由工作区管理员为车辆组指定显式基线。', 'No policy set applies to this vehicle’s software. Update the vehicle to a version that has one, or have the workspace admin give the group an explicit base.'),
    UNKNOWN_SOFTWARE: L('这辆车的整车软件版本未知，无法检查。把车辆更新到已登记的版本，或请车辆资源确认它的版本；确认并下发会使用初始研发配置。', 'The vehicle’s software is unknown, so nothing can be checked. Update it to a recorded version, or have vehicle resources confirm its version; confirming and dispatching uses the initial configuration.'),
    CANNOT_CHECK: L('这辆车的软件没有登记软件清单，无法逐条检查。请车辆资源补录清单，或确认并下发。', 'The vehicle’s software has no recorded manifest, so nothing can be checked. Ask vehicle resources to record it, or confirm and dispatch.'),
  };
  return (
    <Drawer open size={820} title={`${L('与车辆组的发布不匹配', 'Does not fit the group')} · ${r.id}`} onClose={onClose}>
      <Space orientation="vertical" size={16} style={{ width: '100%' }}>
        <Descriptions size="small" column={{ xs: 1, sm: 1, md: 2 }} bordered>
          <Descriptions.Item label={L('车辆组', 'Vehicle group')}>{g.name}</Descriptions.Item>
          <Descriptions.Item label={L('原因', 'Why')}>
            {B(FOLLOW_REASON_LABELS[fit.follow.reason])} · {when(fit.follow.since)}
          </Descriptions.Item>
          <Descriptions.Item label={L('整车版本', 'Software')}>{r.integrationVersion ? `${r.vehicleModelId} ${r.integrationVersion}` : L('未知', 'Unknown')}</Descriptions.Item>
          <Descriptions.Item label={L('车辆组的发布', 'Group publication')}>{feature && p?.kind === 'FEATURE' ? <Mono>{`${feature.name} · r${String(state.commits[p.commitId]?.sequence ?? 0).padStart(3, '0')}`}</Mono> : '—'}</Descriptions.Item>
        </Descriptions>
        <Alert
          type={fit.fits ? 'success' : outcomeAlert(check.outcome)}
          showIcon
          title={fit.fits ? L('匹配：车辆下次上报时自动推送', 'Fits: pushed on the vehicle’s next report') : B(CHANGE_OUTCOME_LABELS[check.outcome])}
          description={explain[check.outcome]}
        />
        {fit.problems.length > 0 && (
          <Alert type="warning" showIcon title={L('现在还不能下发', 'Not dispatchable yet')} description={fit.problems.map((x) => <div key={x}>{B(issueLabel(x), x)}</div>)} />
        )}
        <Space wrap>
          {canDispatch && resolvable && (
            <Button type="primary" disabled={fit.problems.length > 0} onClick={() => run((c) => dispatchToVehicle(c, r.id), L('已确认并下发到该车', 'Confirmed and dispatched to the vehicle'))}>
              {L('确认并下发', 'Confirm and dispatch')}
            </Button>
          )}
          {canUpdate(g.workspaceId, r) && <Button onClick={() => setUpdating(true)}>{L('更新整车版本', 'Update vehicle software')}</Button>}
          {feature && (check.outcome === 'FIX' || check.outcome === 'NEW_FEATURE') && (
            <Button onClick={() => navigate(`features/${feature.id}`)}>{L('打开 Feature', 'Open the Feature')}</Button>
          )}
          {feature && check.outcome === 'NEW_FEATURE' && canCreate && check.newBaseId && (
            <Button onClick={() => setNaming(true)}>{L('在新基线上新建 Feature', 'Start a Feature on the new base')}</Button>
          )}
        </Space>
        {check.outcome !== 'NOT_PUBLISHED' && <CheckCards check={check} running={L('车辆组的基线', 'Base of the group')} target={L('这辆车的软件对应的基线', 'base for this vehicle’s software')} />}
        {check.outcome === 'NEW_FEATURE' && feature && p?.kind === 'FEATURE' && !check.integrated && <ChangesToRedo feature={feature} commitId={p.commitId} />}
        <Typography.Text type="secondary">
          {L('平台不会自行改策略或下发；更新整车版本后，车辆重启上报，匹配时云端推送车辆组的配置。', 'The platform never changes policies or dispatches by itself; after a software update the vehicle restarts and reports, and the cloud pushes the group’s configuration when it fits.')}
        </Typography.Text>
      </Space>
      {updating && <UpdateSoftwareModal workspaceId={g.workspaceId} resourceId={r.id} onClose={() => setUpdating(false)} />}
      {feature && <NewFeatureOnBaseModal feature={feature} baseId={check.newBaseId} open={naming} onClose={() => setNaming(false)} onCreated={onClose} />}
    </Drawer>
  );
}
