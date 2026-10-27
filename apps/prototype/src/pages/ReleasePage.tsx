// Release and configuration OTA (发布与配置 OTA): promote Verified candidates to DCL policy set
// versions, decide which software versions each set applies to, see which set each production
// vehicle should run, and roll sets out in waves.

import { Alert, Badge, Button, Card, Checkbox, Descriptions, Empty, Flex, Input, Modal, Select, Space, Table, Tabs, Tag, Tooltip, Typography } from 'antd';
import { useState } from 'react';
import { useCan, useRun, useWorkspace } from '../app/hooks.ts';
import { navigate } from '../app/router.ts';
import { setSession, useEngineState } from '../app/store.ts';
import { ApplicabilityChecks, ReleaseDiffDrawer, SoftwareVersionsCard } from '../components/applicability.tsx';
import { EmergencyStopsCard, RequestStopModal } from '../components/emergency.tsx';
import { EnvTag, Hint, LabelTag, Mono, Numbered, PageHeader, ShortId, configName, when } from '../components/common.tsx';
import { deploymentNumber } from '../engine/labels.ts';
import { JsonExportModal, downloadJson } from '../components/JsonExport.tsx';
import { LineTag, TargetSet } from '../components/patch.tsx';
import { PromoteModal } from '../components/promote.tsx';
import { DeliveryTag } from '../components/testing.tsx';
import type { JsonFile } from '../components/JsonExport.tsx';
import { displayName, mainlineRelease } from '../engine/config.ts';
import { membersOf, ungroupedVehicles, vehicleGroupsOf } from '../engine/fleet.ts';
import { answerConfigRequest, cancelOta, createOta, expandOta, otaProblems, otaRollouts, outsideRollout, pauseOta, resumeOta, rollbackOta, rollbackProblems, waveWaiting } from '../engine/ota.ts';
import { isOpenCheck } from '../engine/applicability.ts';
import { releaseWorkspace } from '../engine/emergency.ts';
import { applicableVersions, previousRelease, releaseConfiguration, releaseFor, releasesOf, setInEffect, targetMoved, testedVersions, versionsInEffect } from '../engine/release.ts';
import type { Candidate, Deployment, Release, State, VehicleGroup } from '../engine/types.ts';
import { useI18n } from '../i18n/i18n.tsx';
import { issueLabel } from '../i18n/issues.ts';
import { CONFIG_ANSWER_LABELS, DEPLOYMENT_STATUS_LABELS, TARGET_STATUS_LABELS, setName } from '../i18n/vocab.ts';

/** The project workspace holding production vehicle groups for the current workspace. */
function projectOf(s: State, workspaceId: string | undefined): string | undefined {
  const ws = workspaceId ? s.workspaces[workspaceId] : undefined;
  if (!ws) return undefined;
  const hasProduction = (id: string) =>
    Object.values(s.vehicleGroups).some((g) => g.workspaceId === id && g.purpose === 'PRODUCTION') || (s.workspaceResources[id] ?? []).some((r) => s.resources[r]?.env === 'production');
  // An integration testing workspace releases for the project it takes as source, unless it holds production vehicles itself.
  if (ws.kind === 'INTEGRATION' && !hasProduction(ws.id)) {
    const project = ws.sourceWorkspaceIds.find((id) => s.workspaces[id]?.kind === 'PROJECT');
    if (project) return project;
  }
  if (ws.kind !== 'TEAM') return ws.id;
  return Object.values(s.workspaces).find((w) => w.kind !== 'TEAM' && w.status === 'ACTIVE' && w.vehicleModelId === ws.vehicleModelId && hasProduction(w.id))?.id;
}

const ANSWER_COLORS: Record<string, string> = { HELD: 'purple', TASK: 'processing', LATEST_RELEASE: 'green', GROUP_TARGET: 'blue', APPLIED: 'default', INITIAL: 'default', BLOCKED: 'red' };

export function ReleasePage({ tab = 'releases' }: { tab?: string }) {
  const state = useEngineState();
  const { L, B } = useI18n();
  const { workspace, access } = useWorkspace();
  if (!workspace) return <div className="kz-page"><Empty /></div>;
  const modelId = workspace.vehicleModelId;
  const projectId = projectOf(state, workspace.id);
  const latest = mainlineRelease(state, modelId);
  const openChecks = Object.values(state.applicabilityChecks).filter((c) => c.vehicleModelId === modelId && isOpenCheck(c)).length;
  if (!workspace.scopes.includes('Vehicle') && workspace.kind === 'TEAM') {
    // A team workspace writes Features; formal releases are made where the whole vehicle is integrated.
    const project = projectId ? state.workspaces[projectId] : undefined;
    return (
      <div className="kz-page">
        <PageHeader title={L('发布与配置 OTA', 'Release & OTA')} />
        <Alert
          type="info"
          showIcon
          title={L('正式发布与配置 OTA 在整车项目工作区进行。', 'Formal releases and configuration OTA happen in the whole-vehicle project workspace.')}
          action={project && access.some((a) => a.workspaceId === project.id) ? <Button size="small" onClick={() => setSession({ workspaceId: project.id })}>{project.name}</Button> : undefined}
        />
      </div>
    );
  }
  if (!workspace.scopes.includes('Vehicle')) {
    // A domain workspace publishes subsystem releases; formal releases and OTA are whole-vehicle.
    return (
      <div className="kz-page">
        <PageHeader title={L('发布与配置 OTA', 'Release & OTA')} />
        <Alert
          type="info"
          showIcon
          title={L('正式发布与配置 OTA 只针对整车，由整车配置发布负责。', 'Formal releases and configuration OTA are whole-vehicle, done by whole-vehicle configuration release.')}
          description={L('本工作区做子系统集成：通过集成测试的子系统候选，在“配置集成 → 集成候选”中发布为子系统发布。', 'This workspace integrates a subsystem: a verified subsystem candidate is published as a subsystem release under Integration → Candidates.')}
          action={<Button size="small" onClick={() => navigate('integration')}>{L('配置集成', 'Integration')}</Button>}
        />
      </div>
    );
  }
  return (
    <div className="kz-page">
      <PageHeader title={L('发布与配置 OTA', 'Release & OTA')} subtitle={`${modelId} · ${L('主线策略集', 'Mainline policy set')}: ${latest ? B(setName(latest.dclVersion)) : L('无', 'none')}`} />
      <Tabs
        activeKey={tab}
        onChange={(k) => navigate(`release/${k}`)}
        items={[
          { key: 'releases', label: L('策略集发布', 'Policy sets'), children: <ReleasesTab modelId={modelId} workspaceId={workspace.id} /> },
          {
            key: 'applicability',
            label: (
              <Badge count={openChecks} size="small" offset={[8, 0]}>
                {L('软件版本与适用性', 'Software & applicability')}
              </Badge>
            ),
            children: (
              <Space orientation="vertical" size={16} style={{ width: '100%' }}>
                <SoftwareVersionsCard modelId={modelId} />
                <Card title={L('适用性确认单', 'Applicability checks')}>
                  <ApplicabilityChecks modelId={modelId} />
                </Card>
              </Space>
            ),
          },
          { key: 'ota', label: L('配置 OTA', 'Configuration OTA'), children: projectId ? <OtaTab projectId={projectId} /> : <Alert type="info" showIcon title={L('该车型没有项目工作区。', 'This vehicle model has no project workspace.')} /> },
        ]}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Releases
// ---------------------------------------------------------------------------

function ReleasesTab({ modelId, workspaceId }: { modelId: string; workspaceId: string }) {
  const state = useEngineState();
  const { L, B } = useI18n();
  const can = useCan();
  const [promoting, setPromoting] = useState<Candidate | null>(null);
  const [comparing, setComparing] = useState<Release | null>(null);
  const [stopping, setStopping] = useState<{ release: Release; policyId: string } | null>(null);
  const [exported, setExported] = useState<JsonFile | null>(null);
  const exportConfiguration = (releaseId: string) => {
    const r = state.releases[releaseId]!;
    const file = { name: `DCL_${r.vehicleModelId}_${r.dclVersion}_config.json`, json: JSON.stringify(releaseConfiguration(state, r.id), null, 2) };
    setExported(file);
    downloadJson(file);
  };
  // The configuration export is release material: only for release rights where the release was promoted.
  const canExport = (r: Release) => can('release.promote', { workspaceId: (r.candidateId ? state.candidates[r.candidateId]?.workspaceId : undefined) ?? workspaceId, scope: 'Vehicle' });
  const waiting = Object.values(state.candidates).filter((c) => c.vehicleModelId === modelId && c.scope === 'Vehicle' && c.status === 'VERIFIED');
  const releases = releasesOf(state, modelId);

  return (
    <Space orientation="vertical" size={16} style={{ width: '100%' }}>
      <Card title={`${L('待发布的集成候选', 'Candidates awaiting release')} · ${waiting.length}`}>
        <Hint>
          {L(
            '发布复核 DCL 处理确认、集成测试与目标版本；发布者指定独立的 DCL 策略集版本和适用的整车软件版本，每个适用版本都要有通过的集成测试。之后的软件版本可以经适用性确认追加，不必重新发布。发布不刷写软件，也不改变车辆已生效的配置。',
            'Releasing re-checks the DCL confirmation, integration tests and target; the publisher sets an independent DCL policy set version and the whole-vehicle software versions it applies to, each backed by a passing integration test. Later software versions are added by an applicability check, without a new release. Publishing flashes no software and changes no vehicle’s applied configuration.',
          )}
        </Hint>
        <Table
          rowKey="id"
          size="small"
          pagination={false}
          dataSource={waiting}
          locale={{ emptyText: L('暂无已通过集成测试的候选', 'No verified candidates') }}
          columns={[
            { title: L('候选', 'Candidate'), render: (_, c) => <a onClick={() => navigate(`integration/${c.id}`)}><Mono>{c.label}</Mono></a> },
            { title: L('来源', 'Sources'), render: (_, c) => [...c.subsystems.map((x) => state.subsystemReleases[x.subsystemReleaseId]?.label), ...c.sources.map((x) => state.features[x.featureId]?.name)].join(', ') },
            {
              title: L('目标策略集', 'Target set'),
              render: (_, c) => (
                <Space size={4} wrap>
                  <TargetSet targetReleaseId={c.targetReleaseId} patch={c.patch} />
                  {targetMoved(state, c) && <Tag color="red">{L('目标已变化，需重新集成', 'target changed: integrate again')}</Tag>}
                </Space>
              ),
            },
            { title: L('已测试的整车版本', 'Tested software'), render: (_, c) => testedVersions(state, c).map((v) => <Tag key={v}>{v}</Tag>) },
            { title: L('集成验证', 'Verified'), render: (_, c) => `${state.accounts[c.verifiedBy ?? '']?.displayName ?? '—'} · ${c.verifiedAt ? when(c.verifiedAt) : ''}` },
            {
              title: '',
              render: (_, c) =>
                can('release.promote', { workspaceId: c.workspaceId, scope: 'Vehicle' }) && (
                  <Button type="primary" size="small" onClick={() => setPromoting(c)}>
                    {L('发布', 'Release')}
                  </Button>
                ),
            },
          ]}
        />
      </Card>
      <Card title={L('DCL 策略集版本', 'DCL policy set versions')}>
        <Table
          rowKey="id"
          pagination={false}
          scroll={{ x: 'max-content' }}
          dataSource={releases}
          locale={{ emptyText: L('尚无正式发布；首次正式集成前车辆使用内部初始研发配置。', 'No release yet; before the first formal integration vehicles use the internal initial configuration.') }}
          expandable={{
            expandedRowRender: (r) => {
              const inEffect = versionsInEffect(state, r).length > 0;
              return (
                <Table
                  rowKey="groupId"
                  size="small"
                  pagination={false}
                  dataSource={Object.entries(r.groups).map(([groupId, commitId]) => ({ groupId, commitId }))}
                  columns={[
                    { title: L('业务分组', 'Group'), render: (_, x) => <Mono>{state.groups[x.groupId]?.code}</Mono> },
                    { title: L('提交', 'Commit'), render: (_, x) => <Mono>{displayName(state, x.commitId)}</Mono> },
                    {
                      title: L('策略', 'Policies'),
                      render: (_, x) => (
                        <Space size={4} wrap>
                          {Object.entries(state.commits[x.commitId]!.policies).map(([policyId, versionId]) => (
                            <Space key={policyId} size={0}>
                              <Tag>{`${policyId} v${state.policyVersions[versionId]?.version}`}</Tag>
                              {inEffect && can('emergency.request', { workspaceId: releaseWorkspace(state, r), groupId: x.groupId, scope: 'Vehicle' }) && (
                                <Button type="link" size="small" danger onClick={() => setStopping({ release: r, policyId })}>
                                  {L('紧急停用', 'Emergency stop')}
                                </Button>
                              )}
                            </Space>
                          ))}
                        </Space>
                      ),
                    },
                  ]}
                />
              );
            },
          }}
          columns={[
            {
              title: L('策略集版本', 'Policy set'),
              render: (_, r) => (
                <Space size={4}>
                  <Mono>{r.dclVersion}</Mono>
                  <LineTag release={r} />
                  {r.emergency && (
                    <Tooltip title={L(`紧急停用 ${r.emergency.policyId}（源自 ${state.releases[r.emergency.sourceReleaseId]?.dclVersion}）`, `Emergency stop of ${r.emergency.policyId} (from ${state.releases[r.emergency.sourceReleaseId]?.dclVersion})`)}>
                      <Tag color="red">{L('紧急', 'emergency')}</Tag>
                    </Tooltip>
                  )}
                </Space>
              ),
            },
            {
              title: L('适用整车版本（当前）', 'Applies to (now)'),
              render: (_, r) =>
                applicableVersions(state, r).map((v) => {
                  // A newer set that applies to the version is the one in effect there.
                  const effective = setInEffect(state, r.vehicleModelId, v)?.id === r.id;
                  return (
                    <Tooltip key={v} title={[r.vehicleIntegrationVersions.includes(v) ? null : L('经适用性确认追加', 'added by an applicability check'), effective ? null : L('已由更新的策略集生效', 'a newer set is in effect')].filter(Boolean).join(L('；', '; ')) || undefined}>
                      <Tag color={r.vehicleIntegrationVersions.includes(v) ? undefined : 'blue'} style={effective ? undefined : { textDecoration: 'line-through', opacity: 0.6 }}>
                        {`${r.vehicleModelId} ${v}`}
                        {effective ? '' : L(' · 已被取代', ' · superseded')}
                      </Tag>
                    </Tooltip>
                  );
                }),
            },
            { title: L('序号', 'Seq'), dataIndex: 'sequence' },
            { title: L('候选', 'Candidate'), render: (_, r) => <Mono>{r.candidateId ? state.candidates[r.candidateId]?.label : '—'}</Mono> },
            { title: L('配置摘要', 'Digest'), render: (_, r) => <ShortId value={state.resolvedConfigs[r.resolvedConfigId]?.digest} /> },
            { title: L('说明', 'Notes'), render: (_, r) => r.notes || '—' },
            { title: L('发布', 'Published'), render: (_, r) => `${state.accounts[r.publishedBy]?.displayName} · ${when(r.publishedAt)}` },
            {
              title: '',
              render: (_, r) => (
                <Space size={0}>
                  <Button type="link" size="small" onClick={() => setComparing(r)}>
                    {r.patchOf ? L('与所补的版本比较', 'Compare with the set it patches') : L('与上一版比较', 'Compare with previous')}
                  </Button>
                  <Button type="link" size="small" onClick={() => navigate(`versions/history/set/${r.id}`)}>
                    {L('发布记录', 'History')}
                  </Button>
                  {canExport(r) && (
                    <Button size="small" onClick={() => exportConfiguration(r.id)}>
                      {L('导出配置集合', 'Export configuration')}
                    </Button>
                  )}
                </Space>
              ),
            },
          ]}
        />
      </Card>
      {promoting && <PromoteModal candidate={promoting} onClose={() => setPromoting(null)} />}
      <ReleaseDiffDrawer fromId={comparing ? (previousRelease(state, comparing)?.id ?? null) : null} toId={comparing?.id ?? null} onClose={() => setComparing(null)} />
      <EmergencyStopsCard modelId={modelId} />
      <RequestStopModal target={stopping} onClose={() => setStopping(null)} />
      <JsonExportModal title={L('导出配置集合', 'Export configuration')} file={exported} onClose={() => setExported(null)} />
    </Space>
  );
}

// ---------------------------------------------------------------------------
// OTA
// ---------------------------------------------------------------------------

function OtaTab({ projectId }: { projectId: string }) {
  const state = useEngineState();
  const { L, B } = useI18n();
  const can = useCan();
  const [creating, setCreating] = useState(false);
  const project = state.workspaces[projectId]!;
  const groups = vehicleGroupsOf(state, projectId).filter((g) => g.status === 'ACTIVE' && g.purpose === 'PRODUCTION');
  const canManage = can('ota.manage', { workspaceId: projectId, scope: 'Vehicle' });
  const rollouts = otaRollouts(state, projectId);
  const vehicles = [
    ...groups.flatMap((g) => membersOf(state, g.id).map((id) => ({ vehicle: state.resources[id]!, group: g as VehicleGroup | null }))),
    ...ungroupedVehicles(state, projectId)
      .filter((r) => r.env === 'production')
      .map((vehicle) => ({ vehicle, group: null })),
  ];

  return (
    <Space orientation="vertical" size={16} style={{ width: '100%' }}>
      <Card
        title={`${L('量产车辆', 'Production vehicles')} · ${project.name}`}
        extra={
          canManage && (
            <Tooltip
              title={
                vehicles.length === 0
                  ? L('本工作区还没有量产车辆。', 'This workspace has no production vehicles yet.')
                  : releasesOf(state, project.vehicleModelId).length === 0
                    ? L('还没有发布的策略集。', 'No policy set is released yet.')
                    : undefined
              }
            >
              <Button type="primary" disabled={vehicles.length === 0 || releasesOf(state, project.vehicleModelId).length === 0} onClick={() => setCreating(true)}>
                {L('新建配置 OTA', 'New rollout')}
              </Button>
            </Tooltip>
          )
        }
      >
        <Hint>
          {L(
            '车辆上报车型与实际整车版本，平台取该软件版本当前适用的策略集（适用它的最新策略集）；没有适用策略集时阻止量产下发，不会回退到研发配置。期望配置与已生效配置分开显示，只有成功回执才更新已生效配置。',
            'Vehicles report their model and actual software; the platform takes the policy set in effect for that version (the newest set that applies to it). Without one, production delivery is blocked and never falls back to a development configuration. Expected and applied configurations are shown separately; only a successful receipt changes what a vehicle runs.',
          )}
        </Hint>
        <Table
          rowKey={(x) => x.vehicle.id}
          size="small"
          pagination={false}
          dataSource={vehicles}
          scroll={{ x: 'max-content' }}
          locale={{ emptyText: L('本工作区没有量产车辆；在“车辆与车辆组”中加入。', 'No production vehicles in this workspace; add them under Vehicles & groups.') }}
          columns={[
            { title: L('车辆', 'Vehicle'), render: (_, x) => <Mono>{x.vehicle.id}</Mono> },
            { title: L('车辆组', 'Group'), render: (_, x) => x.group?.name ?? <Typography.Text type="secondary">{L('未分组', 'ungrouped')}</Typography.Text> },
            {
              title: L('实际整车版本', 'Actual software'),
              render: (_, x) =>
                x.vehicle.softwareStatus === 'PARTIAL_FAILURE' ? (
                  <Tooltip title={x.vehicle.controllers.map((c) => `${c.name} ${c.version} ${c.status}`).join(' · ')}>
                    <Tag color="red">{L('部分域控失败', 'partial failure')}</Tag>
                  </Tooltip>
                ) : (
                  (x.vehicle.integrationVersion ?? <Tag color="orange">{L('未知', 'unknown')}</Tag>)
                ),
            },
            {
              title: L('应运行', 'Should run'),
              render: (_, x) => {
                const r = releaseFor(state, x.vehicle);
                return r.release ? <Mono>{B(setName(r.release.dclVersion))}</Mono> : <Tooltip title={r.problem ? B(issueLabel(r.problem), r.problem) : undefined}><Tag color="red">{L('无适用策略集，阻止下发', 'no set applies, blocked')}</Tag></Tooltip>;
              },
            },
            { title: L('已生效', 'Applied'), render: (_, x) => <Mono>{B(configName(state, x.vehicle.appliedConfigId))}</Mono> },
            {
              title: L('车辆请求配置时返回', 'Answer to a config request'),
              render: (_, x) => {
                const a = answerConfigRequest(state, x.vehicle.id);
                return (
                  <Tooltip title={a.detail ? B(issueLabel(a.detail), a.detail) : undefined}>
                    <Space size={4}>
                      <Tag color={ANSWER_COLORS[a.reason]}>{B(CONFIG_ANSWER_LABELS[a.reason])}</Tag>
                      <Mono>{B(configName(state, a.configId))}</Mono>
                    </Space>
                  </Tooltip>
                );
              },
            },
            {
              title: L('状态', 'State'),
              render: (_, x) => {
                const r = releaseFor(state, x.vehicle);
                if (!r.release) return <Tag color="red">{L('阻止', 'blocked')}</Tag>;
                if (x.vehicle.appliedConfigId === r.release.resolvedConfigId) return <Tag color="green">{L('已是最新', 'up to date')}</Tag>;
                if (answerConfigRequest(state, x.vehicle.id).reason === 'HELD') return <Tag color="purple">{L('保持（不追新）', 'held')}</Tag>;
                return <Tag color="gold">{L('待更新', 'update due')}</Tag>;
              },
            },
          ]}
        />
      </Card>
      <Card title={L('配置 OTA 记录', 'Rollouts')}>
        {rollouts.length === 0 && <Typography.Text type="secondary">{L('暂无配置 OTA。', 'No rollouts yet.')}</Typography.Text>}
        <Space orientation="vertical" size={12} style={{ width: '100%' }}>
          {rollouts.map((d) => (
            <RolloutCard key={d.id} deployment={d} canManage={canManage} />
          ))}
        </Space>
      </Card>
      {creating && <CreateOtaModal projectId={projectId} onClose={() => setCreating(false)} />}
    </Space>
  );
}

function CreateOtaModal({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const state = useEngineState();
  const { L, B } = useI18n();
  const run = useRun();
  const project = state.workspaces[projectId]!;
  const releases = releasesOf(state, project.vehicleModelId);
  const groups = vehicleGroupsOf(state, projectId).filter((g) => g.status === 'ACTIVE' && g.purpose === 'PRODUCTION');
  const [releaseId, setReleaseId] = useState(releases[0]?.id);
  const [groupIds, setGroupIds] = useState<string[]>(groups.map((g) => g.id));
  const ungrouped = ungroupedVehicles(state, projectId).filter((r) => r.env === 'production');
  const [direct, setDirect] = useState<string[]>(groups.length ? [] : ungrouped.map((r) => r.id));
  const release = releaseId ? state.releases[releaseId] : undefined;
  const vehicles = [...groupIds.flatMap((g) => membersOf(state, g)), ...direct].map((id) => state.resources[id]!);
  const candidates = release ? vehicles.filter((r) => r.appliedConfigId !== release.resolvedConfigId && !outsideRollout(state, r, release)) : [];
  const [wave, setWave] = useState<string[] | null>(null);
  const firstWave = wave ?? candidates.slice(0, 1).map((r) => r.id);

  return (
    <Modal
      open
      width={640}
      title={L('新建配置 OTA', 'New rollout')}
      okText={L('开始下发', 'Start rollout')}
      onCancel={onClose}
      onOk={() => {
        if (run((c) => createOta(c, { releaseId: releaseId!, workspaceId: projectId, vehicleGroupIds: groupIds, resourceIds: direct, firstWave }), L('已开始灰度，等待车辆回执', 'Rollout started; waiting for receipts')) !== undefined) onClose();
      }}
    >
      <Hint>
        {L(
          '先向第一批车辆灰度，确认回执成功后再扩大范围；任一车辆失败会暂停整个 OTA。平台逐车校验车型、实际整车版本、是否为最新匹配版本和占用情况，任一不满足则整体拒绝。软件版本已由其他策略集服务、本策略集又不适用的车辆不在本次范围。',
          'Send to a first wave, then expand after successful receipts; any failure pauses the whole rollout. Each vehicle’s model, actual software, newest match and occupancy are checked; any failure rejects the whole rollout. Vehicles whose software another set serves, and this set does not apply to, are not part of the rollout.',
        )}
      </Hint>
      <Space orientation="vertical" size={12} style={{ width: '100%' }}>
        <Select style={{ width: '100%' }} value={releaseId} onChange={(v) => (setReleaseId(v), setWave(null))} options={releases.map((r) => ({ value: r.id, label: `${B(setName(r.dclVersion))} · ${applicableVersions(state, r).join(', ')}` }))} />
        <Checkbox.Group value={groupIds} onChange={(v) => (setGroupIds(v as string[]), setWave(null))}>
          <Space orientation="vertical">
            {groups.map((g) => (
              <Checkbox key={g.id} value={g.id}>
                {g.name} · {membersOf(state, g.id).join(', ')} <EnvTag env={g.env} />
              </Checkbox>
            ))}
          </Space>
        </Checkbox.Group>
        {ungrouped.length > 0 && (
          <>
            <Typography.Text strong>{L('未归组的量产车（直接选择）', 'Ungrouped production vehicles (chosen directly)')}</Typography.Text>
            <Checkbox.Group value={direct} onChange={(v) => (setDirect(v as string[]), setWave(null))}>
              <Space wrap>
                {ungrouped.map((r) => (
                  <Checkbox key={r.id} value={r.id}>
                    <Mono>{r.id}</Mono>
                  </Checkbox>
                ))}
              </Space>
            </Checkbox.Group>
          </>
        )}
        <Typography.Text strong>{L('第一批（灰度）', 'First wave (canary)')}</Typography.Text>
        {candidates.length > 1 && candidates.every((r) => firstWave.includes(r.id)) && (
          <Alert type="warning" showIcon title={L('第一批包含全部车辆：没有灰度，任何问题会同时出现在所有车上。', 'The first wave holds every vehicle: no canary, so any problem reaches every vehicle at once.')} />
        )}
        {release &&
          vehicles.map((r) => {
            const done = r.appliedConfigId === release.resolvedConfigId;
            const outside = !done && outsideRollout(state, r, release);
            const problems = done || outside ? [] : otaProblems(state, r, release);
            return (
              <Flex key={r.id} gap={8} align="center" wrap>
                <Checkbox
                  disabled={done || outside}
                  checked={firstWave.includes(r.id)}
                  onChange={(e) => setWave(e.target.checked ? [...firstWave, r.id] : firstWave.filter((x) => x !== r.id))}
                >
                  <Mono>{r.id}</Mono>
                </Checkbox>
                <Typography.Text type="secondary">
                  {r.integrationVersion ?? L('版本未知', 'software unknown')} · {B(configName(state, r.appliedConfigId))}
                </Typography.Text>
                {done && <Tag color="green">{L('已运行该策略集', 'already runs it')}</Tag>}
                {outside && (
                  <Tag>
                    {L(`不在本次范围：软件 ${r.integrationVersion} 应运行${B(setName(releaseFor(state, r).release!.dclVersion))}`, `Not in this rollout: software ${r.integrationVersion} runs ${B(setName(releaseFor(state, r).release!.dclVersion))}`)}
                  </Tag>
                )}
                {problems.map((p) => (
                  <Tag key={p} color="red">
                    {B(issueLabel(p), p)}
                  </Tag>
                ))}
              </Flex>
            );
          })}
      </Space>
    </Modal>
  );
}

type Prompt = { kind: 'pause' | 'cancel' | 'rollback' | 'expand' } | null;

function RolloutCard({ deployment: d, canManage }: { deployment: Deployment; canManage: boolean }) {
  const state = useEngineState();
  const { L, B } = useI18n();
  const run = useRun();
  const [prompt, setPrompt] = useState<Prompt>(null);
  const [reason, setReason] = useState('');
  const [chosen, setChosen] = useState<string[]>([]);
  const queued = d.targets.filter((t) => t.status === 'QUEUED');
  const waiting = waveWaiting(d);
  const open = d.status === 'PENDING' || d.status === 'PAUSED';
  const rollbackIssues = rollbackProblems(state, d);
  const counts = (status: string) => d.targets.filter((t) => t.status === status).length;

  const submit = () => {
    const ok =
      prompt?.kind === 'pause'
        ? run((c) => pauseOta(c, d.id, reason), L('已暂停', 'Paused'))
        : prompt?.kind === 'cancel'
          ? run((c) => cancelOta(c, d.id, reason), L('已取消', 'Cancelled'))
          : prompt?.kind === 'rollback'
            ? run((c) => rollbackOta(c, d.id, reason), L('已创建回滚 OTA，等待车辆回执', 'Rollback started; waiting for receipts'))
            : run((c) => expandOta(c, d.id, chosen), L('已扩大下发范围', 'Rollout expanded'));
    if (ok !== undefined) setPrompt(null);
  };

  return (
    <Card
      size="small"
      title={
        <Space wrap>
          <Mono>{B(configName(state, d.resolvedConfigId))}</Mono>
          <LabelTag map={DEPLOYMENT_STATUS_LABELS} value={d.status} color={d.status === 'PAUSED' ? 'orange' : d.status === 'COMPLETED' ? 'green' : d.status === 'PENDING' ? 'processing' : undefined} />
          {d.rollbackOf && <Tag color="purple">{L('回滚', 'rollback')}</Tag>}
          <Typography.Text type="secondary">
            {L(`已生效 ${counts('APPLIED')} · 等待 ${counts('PENDING')} · 待放量 ${counts('QUEUED')} · 失败 ${counts('FAILED')}`, `applied ${counts('APPLIED')} · waiting ${counts('PENDING')} · queued ${counts('QUEUED')} · failed ${counts('FAILED')}`)}
          </Typography.Text>
        </Space>
      }
      extra={
        canManage && (
          <Space size={4} wrap>
            {d.status === 'PENDING' && queued.length > 0 && (
              <Tooltip title={waiting.length ? L(`等 ${waiting.join('、')} 回执成功后再扩大范围`, `Expand once ${waiting.join(', ')} applied it`) : undefined}>
                <Button size="small" type="primary" disabled={waiting.length > 0} onClick={() => (setChosen(queued.map((t) => t.resourceId)), setPrompt({ kind: 'expand' }))}>
                  {L('扩大范围', 'Expand')}
                </Button>
              </Tooltip>
            )}
            {d.status === 'PAUSED' && (
              <Button size="small" type="primary" onClick={() => run((c) => resumeOta(c, d.id), L('已恢复，失败车辆以新尝试重新下发', 'Resumed; failed vehicles retry with a new attempt'))}>
                {L('恢复（重试失败车辆）', 'Resume (retry failed)')}
              </Button>
            )}
            {d.status === 'PENDING' && (
              <Button size="small" onClick={() => (setReason(''), setPrompt({ kind: 'pause' }))}>
                {L('暂停', 'Pause')}
              </Button>
            )}
            {open && (
              <Button size="small" danger onClick={() => (setReason(''), setPrompt({ kind: 'cancel' }))}>
                {L('取消', 'Cancel')}
              </Button>
            )}
            {d.status !== 'CANCELLED' && d.status !== 'ROLLED_BACK' && (
              <Tooltip title={rollbackIssues.length ? `${L('不能回滚：', 'Cannot roll back: ')}${rollbackIssues.map((i) => B(issueLabel(i), i)).join(L('；', '; '))}` : undefined}>
                <Button size="small" danger disabled={rollbackIssues.length > 0} onClick={() => (setReason(''), setPrompt({ kind: 'rollback' }))}>
                  {L('回滚', 'Roll back')}
                </Button>
              </Tooltip>
            )}
            {d.status === 'PENDING' && d.targets.some((t) => t.status === 'PENDING') && (
              <Button size="small" type="link" onClick={() => navigate('simulator')}>
                {L('去车辆模拟器回执', 'Answer in simulator')}
              </Button>
            )}
          </Space>
        )
      }
    >
      <Descriptions size="small" column={{ xs: 1, md: 3 }}>
        <Descriptions.Item label={L('配置 OTA', 'Rollout')}><Numbered n={deploymentNumber(state, d)} id={d.id} /></Descriptions.Item>
        <Descriptions.Item label={L('发起', 'By')}>{`${state.accounts[d.dispatchedBy]?.displayName} · ${when(d.createdAt)}`}</Descriptions.Item>
        <Descriptions.Item label={L('车辆组', 'Groups')}>{d.vehicleGroupIds.map((g) => state.vehicleGroups[g]?.name).join(', ')}</Descriptions.Item>
        {d.rollbackOf && state.deployments[d.rollbackOf] && <Descriptions.Item label={L('回滚自', 'Rolls back')}><Numbered n={deploymentNumber(state, state.deployments[d.rollbackOf]!)} id={d.rollbackOf} /></Descriptions.Item>}
        {(d.pauseReason || d.status === 'PAUSED') && (
          <Descriptions.Item label={L('原因', 'Reason')}>{d.pauseReason ?? L('车辆应用失败，已自动暂停', 'Paused automatically after a vehicle failed')}</Descriptions.Item>
        )}
      </Descriptions>
      {d.status === 'PAUSED' && rollbackIssues.length > 0 && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          title={
            rollbackIssues.every((i) => i.endsWith('no earlier formal configuration to return to'))
              ? L('没有上一份正式配置，不能回滚', 'No earlier formal configuration to roll back to')
              : L('暂时不能回滚', 'Rollback is not possible right now')
          }
          description={
            rollbackIssues.every((i) => i.endsWith('no earlier formal configuration to return to'))
              ? L(
                  '保持暂停并排查；修复后用“恢复（重试失败车辆）”受控重试，或取消本次 OTA 后发布修复版本。平台不会虚构回滚版本。',
                  'Keep it paused and investigate; after a fix, retry the failed vehicles with “Resume”, or cancel and release a fixed version. The platform never invents a rollback version.',
                )
              : rollbackIssues.map((i) => B(issueLabel(i), i)).join(L('；', '; '))
          }
        />
      )}
      <Table
        rowKey="resourceId"
        size="small"
        pagination={false}
        dataSource={d.targets}
        columns={[
          { title: L('车辆', 'Vehicle'), render: (_, t) => <Mono>{t.resourceId}</Mono> },
          { title: L('尝试', 'Attempt'), dataIndex: 'attempt' },
          { title: L('状态', 'Status'), render: (_, t) => <DeliveryTag target={t} /> },
          { title: L('之前生效', 'Previously'), render: (_, t) => <Mono>{B(configName(state, t.previousConfigId))}</Mono> },
          { title: L('错误', 'Error'), render: (_, t) => (t.error ? B(issueLabel(t.error), t.error) : '—') },
          {
            title: L('历史尝试', 'Earlier attempts'),
            render: (_, t) => (t.history.length ? t.history.map((h) => <Tag key={h.attempt}>{`#${h.attempt} ${B(TARGET_STATUS_LABELS[h.status], h.status)}${h.error ? ` · ${B(issueLabel(h.error), h.error)}` : ''}`}</Tag>) : '—'),
          },
          { title: L('更新', 'Updated'), render: (_, t) => when(t.updatedAt) },
        ]}
      />
      <Modal
        open={prompt !== null}
        title={
          prompt?.kind === 'expand'
            ? L('扩大下发范围', 'Expand the rollout')
            : prompt?.kind === 'pause'
              ? L('暂停 OTA', 'Pause rollout')
              : prompt?.kind === 'cancel'
                ? L('取消 OTA', 'Cancel rollout')
                : L('回滚到上一正式配置', 'Roll back to the previous formal configuration')
        }
        okButtonProps={{ danger: prompt?.kind === 'cancel' || prompt?.kind === 'rollback' }}
        onCancel={() => setPrompt(null)}
        onOk={submit}
      >
        {prompt?.kind === 'expand' ? (
          <Checkbox.Group value={chosen} onChange={(v) => setChosen(v as string[])}>
            <Space orientation="vertical">
              {queued.map((t) => (
                <Checkbox key={t.resourceId} value={t.resourceId}>
                  <Mono>{t.resourceId}</Mono>
                </Checkbox>
              ))}
            </Space>
          </Checkbox.Group>
        ) : (
          <>
            {prompt?.kind === 'rollback' && (
              <Hint>
                {L(
                  '已生效的车辆以新的 OTA 回到各自之前成功的正式配置；只有仍适用于车辆实际整车版本的配置可以作为回滚目标。未确认的车辆不再下发。',
                  'Applied vehicles return to their previous successful formal configuration in a new rollout; only a configuration that still fits the vehicle’s actual software qualifies. Unconfirmed vehicles are not sent anything further.',
                )}
              </Hint>
            )}
            <Input.TextArea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={L('原因', 'Reason')} />
          </>
        )}
      </Modal>
    </Card>
  );
}
