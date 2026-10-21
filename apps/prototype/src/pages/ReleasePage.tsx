// Release and configuration OTA (发布与配置 OTA): promote Verified candidates to formal DCL
// versions, see which release each production vehicle should run, and roll releases out in waves.

import { Alert, Button, Card, Checkbox, Descriptions, Empty, Flex, Form, Input, Modal, Select, Space, Table, Tabs, Tag, Tooltip, Typography } from 'antd';
import { useState } from 'react';
import { useCan, useRun, useWorkspace } from '../app/hooks.ts';
import { navigate } from '../app/router.ts';
import { useEngineState } from '../app/store.ts';
import { EnvTag, Hint, LabelTag, Mono, PageHeader, ShortId, when } from '../components/common.tsx';
import { displayName } from '../engine/config.ts';
import { membersOf, ungroupedVehicles, vehicleGroupsOf } from '../engine/fleet.ts';
import { answerConfigRequest, cancelOta, createOta, expandOta, otaProblems, otaRollouts, pauseOta, resumeOta, rollbackOta, rollbackProblems } from '../engine/ota.ts';
import { compareVersions, nextDclVersion, promoteCandidate, releaseConfiguration, releaseFor, releasesOf, testedVersions } from '../engine/release.ts';
import type { Candidate, Deployment, State, VehicleGroup } from '../engine/types.ts';
import { useI18n } from '../i18n/i18n.tsx';
import { issueLabel } from '../i18n/issues.ts';
import { CONFIG_ANSWER_LABELS, DEPLOYMENT_STATUS_LABELS, TARGET_STATUS_COLORS, TARGET_STATUS_LABELS } from '../i18n/vocab.ts';

/** The project workspace holding production vehicle groups for the current workspace. */
function projectOf(s: State, workspaceId: string | undefined): string | undefined {
  const ws = workspaceId ? s.workspaces[workspaceId] : undefined;
  if (!ws) return undefined;
  if (ws.kind !== 'TEAM') return ws.id;
  return Object.values(s.workspaces).find((w) => w.kind !== 'TEAM' && w.status === 'ACTIVE' && w.vehicleModelId === ws.vehicleModelId && Object.values(s.vehicleGroups).some((g) => g.workspaceId === w.id && g.purpose === 'PRODUCTION'))?.id;
}

const releaseLabel = (s: State, configId: string | null) => (configId ? (s.resolvedConfigs[configId]?.label ?? configId) : '—');

const ANSWER_COLORS: Record<string, string> = { HELD: 'purple', TASK: 'processing', LATEST_RELEASE: 'green', GROUP_TARGET: 'blue', APPLIED: 'default', INITIAL: 'default', BLOCKED: 'red' };

function downloadJson(fileName: string, data: unknown): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

export function ReleasePage({ tab = 'releases' }: { tab?: string }) {
  const state = useEngineState();
  const { L } = useI18n();
  const { workspace } = useWorkspace();
  if (!workspace) return <div className="kz-page"><Empty /></div>;
  const modelId = workspace.vehicleModelId;
  const projectId = projectOf(state, workspace.id);
  const latest = releasesOf(state, modelId)[0];
  return (
    <div className="kz-page">
      <PageHeader title={L('发布与配置 OTA', 'Release & OTA')} subtitle={`${modelId} · ${L('最新正式版本', 'Latest release')}: ${latest ? `DCL ${latest.dclVersion}` : L('无', 'none')}`} />
      <Tabs
        activeKey={tab}
        onChange={(k) => navigate(`release/${k}`)}
        items={[
          { key: 'releases', label: L('正式发布', 'Releases'), children: <ReleasesTab modelId={modelId} /> },
          { key: 'ota', label: L('配置 OTA', 'Configuration OTA'), children: projectId ? <OtaTab projectId={projectId} /> : <Alert type="info" showIcon title={L('该车型没有项目工作区。', 'This vehicle model has no project workspace.')} /> },
        ]}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Releases
// ---------------------------------------------------------------------------

function ReleasesTab({ modelId }: { modelId: string }) {
  const state = useEngineState();
  const { L } = useI18n();
  const can = useCan();
  const [promoting, setPromoting] = useState<Candidate | null>(null);
  const waiting = Object.values(state.candidates).filter((c) => c.vehicleModelId === modelId && c.status === 'VERIFIED');
  const releases = releasesOf(state, modelId);

  return (
    <Space orientation="vertical" size={16} style={{ width: '100%' }}>
      <Card title={`${L('待发布的集成候选', 'Candidates awaiting release')} · ${waiting.length}`}>
        <Hint>
          {L(
            '发布复核 DCL 处理确认、集成测试与目标版本；发布者指定独立的 DCL 版本和适用的整车软件版本，每个适用版本都要有通过的集成测试。发布不刷写软件，也不改变车辆已生效的配置。',
            'Promotion re-checks the DCL confirmation, integration tests and target; the publisher sets an independent DCL version and the whole-vehicle software versions it applies to, each backed by a passing integration test. Publishing flashes no software and changes no vehicle’s applied configuration.',
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
            { title: L('来源 Feature', 'Sources'), render: (_, c) => c.sources.map((x) => state.features[x.featureId]?.name).join(', ') },
            { title: L('目标版本', 'Target'), render: (_, c) => (c.targetReleaseId ? `DCL ${state.releases[c.targetReleaseId]?.dclVersion}` : L('无（首次）', 'none (first)')) },
            { title: L('已测试的整车版本', 'Tested software'), render: (_, c) => testedVersions(state, c).map((v) => <Tag key={v}>{v}</Tag>) },
            { title: L('集成验证', 'Verified'), render: (_, c) => `${state.accounts[c.verifiedBy ?? '']?.displayName ?? '—'} · ${c.verifiedAt ? when(c.verifiedAt) : ''}` },
            {
              title: '',
              render: (_, c) =>
                can('release.promote', { workspaceId: c.workspaceId, scope: 'Vehicle' }) && (
                  <Button type="primary" size="small" onClick={() => setPromoting(c)}>
                    {L('发布', 'Promote')}
                  </Button>
                ),
            },
          ]}
        />
      </Card>
      <Card title={L('发布记录', 'Releases')}>
        <Table
          rowKey="id"
          pagination={false}
          dataSource={releases}
          locale={{ emptyText: L('尚无正式发布；首次正式集成前车辆使用内部初始研发配置。', 'No release yet; before the first formal integration vehicles use the internal initial configuration.') }}
          expandable={{
            expandedRowRender: (r) => (
              <Table
                rowKey="groupId"
                size="small"
                pagination={false}
                dataSource={Object.entries(r.groups).map(([groupId, commitId]) => ({ groupId, commitId }))}
                columns={[
                  { title: L('业务分组', 'Group'), render: (_, x) => <Mono>{state.groups[x.groupId]?.code}</Mono> },
                  { title: L('提交', 'Commit'), render: (_, x) => <Mono>{displayName(state, x.commitId)}</Mono> },
                ]}
              />
            ),
          }}
          columns={[
            { title: 'DCL', render: (_, r) => <Mono>{r.dclVersion}</Mono> },
            { title: L('适用整车版本', 'Applies to'), render: (_, r) => r.vehicleIntegrationVersions.map((v) => <Tag key={v}>{`${r.vehicleModelId} ${v}`}</Tag>) },
            { title: L('序号', 'Seq'), dataIndex: 'sequence' },
            { title: L('候选', 'Candidate'), render: (_, r) => <Mono>{r.candidateId ? state.candidates[r.candidateId]?.label : '—'}</Mono> },
            { title: L('配置摘要', 'Digest'), render: (_, r) => <ShortId value={state.resolvedConfigs[r.resolvedConfigId]?.digest} /> },
            { title: L('说明', 'Notes'), render: (_, r) => r.notes || '—' },
            { title: L('发布', 'Published'), render: (_, r) => `${state.accounts[r.publishedBy]?.displayName} · ${when(r.publishedAt)}` },
            {
              title: '',
              render: (_, r) => (
                <Button size="small" onClick={() => downloadJson(`DCL_${r.vehicleModelId}_${r.dclVersion}_config.json`, releaseConfiguration(state, r.id))}>
                  {L('导出配置集合', 'Export configuration')}
                </Button>
              ),
            },
          ]}
        />
      </Card>
      {promoting && <PromoteModal candidate={promoting} onClose={() => setPromoting(null)} />}
    </Space>
  );
}

function PromoteModal({ candidate, onClose }: { candidate: Candidate; onClose: () => void }) {
  const state = useEngineState();
  const { L } = useI18n();
  const run = useRun();
  const tested = new Set(testedVersions(state, candidate));
  const versions = Object.values(state.softwareVersions)
    .filter((v) => v.vehicleModelId === candidate.vehicleModelId)
    .map((v) => v.version)
    .sort(compareVersions);
  const [form] = Form.useForm<{ dclVersion: string; versions: string[]; notes: string }>();
  return (
    <Modal
      open
      title={`${L('发布候选', 'Promote candidate')} · ${candidate.label}`}
      okText={L('发布', 'Promote')}
      onCancel={onClose}
      onOk={() =>
        form.validateFields().then((v) => {
          const id = run((c) => promoteCandidate(c, candidate.id, { dclVersion: v.dclVersion, vehicleIntegrationVersions: v.versions ?? [], notes: v.notes }), L('已发布；车辆在 OTA 回执成功后才会运行新版本', 'Released; vehicles run it only after an OTA receipt'));
          if (id !== undefined) onClose();
        })
      }
    >
      <Form form={form} name="promote" layout="vertical" initialValues={{ dclVersion: nextDclVersion(state, candidate.vehicleModelId), versions: [...tested], notes: '' }}>
        <Form.Item name="dclVersion" label={L('DCL 版本', 'DCL version')} rules={[{ required: true }]} extra={L('独立于整车软件版本，major.minor.patch', 'Independent of vehicle software, major.minor.patch')}>
          <Input />
        </Form.Item>
        <Form.Item name="versions" label={L('适用的整车软件版本', 'Applies to vehicle software')}>
          <Checkbox.Group>
            <Space orientation="vertical">
              {versions.map((v) => (
                <Checkbox key={v} value={v}>
                  {`${candidate.vehicleModelId} ${v}`}{' '}
                  {tested.has(v) ? (
                    <Tag color="green">{L('已通过集成测试', 'integration tested')}</Tag>
                  ) : candidate.targetReleaseId === null ? (
                    <Tooltip title={L('首版候选在未定版本的测试车辆上验证，按设计不要求逐软件版本测试。', 'The initial candidate is tested on vehicles without a fixed software version, so per-version tests are not required by design.')}>
                      <Tag color="blue">{L('首版免逐版本测试', 'initial: no per-version test')}</Tag>
                    </Tooltip>
                  ) : (
                    <Tag>{L('无集成测试', 'not tested')}</Tag>
                  )}
                </Checkbox>
              ))}
            </Space>
          </Checkbox.Group>
        </Form.Item>
        <Form.Item name="notes" label={L('发布说明', 'Release notes')}>
          <Input.TextArea rows={2} />
        </Form.Item>
      </Form>
    </Modal>
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
            <Button type="primary" disabled={vehicles.length === 0 || releasesOf(state, project.vehicleModelId).length === 0} onClick={() => setCreating(true)}>
              {L('新建配置 OTA', 'New rollout')}
            </Button>
          )
        }
      >
        <Hint>
          {L(
            '车辆上报车型与实际整车版本，平台在适用该版本的正式 DCL 中按发布序号选最新的一个；没有匹配时阻止量产下发，不会回退到研发配置。期望配置与已生效配置分开显示，只有成功回执才更新已生效配置。',
            'Vehicles report their model and actual software; the platform picks the newest formal DCL that lists that version. Without a match production rollout is blocked and never falls back to a development configuration. Expected and applied configurations are shown separately; only a successful receipt changes what a vehicle runs.',
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
                return r.release ? <Mono>{`DCL ${r.release.dclVersion}`}</Mono> : <Tooltip title={r.problem ? B(issueLabel(r.problem), r.problem) : undefined}><Tag color="red">{L('无匹配，阻止下发', 'no match, blocked')}</Tag></Tooltip>;
              },
            },
            { title: L('已生效', 'Applied'), render: (_, x) => <Mono>{releaseLabel(state, x.vehicle.appliedConfigId)}</Mono> },
            {
              title: L('车辆请求配置时返回', 'Answer to a config request'),
              render: (_, x) => {
                const a = answerConfigRequest(state, x.vehicle.id);
                return (
                  <Tooltip title={a.detail ? B(issueLabel(a.detail), a.detail) : undefined}>
                    <Space size={4}>
                      <Tag color={ANSWER_COLORS[a.reason]}>{B(CONFIG_ANSWER_LABELS[a.reason])}</Tag>
                      <Mono>{releaseLabel(state, a.configId)}</Mono>
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
  const candidates = release ? vehicles.filter((r) => r.appliedConfigId !== release.resolvedConfigId) : [];
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
          '先向第一批车辆灰度，确认回执成功后再扩大范围；任一车辆失败会暂停整个 OTA。平台逐车校验车型、实际整车版本、是否为最新匹配版本和占用情况，任一不满足则整体拒绝。',
          'Send to a first wave, then expand after successful receipts; any failure pauses the whole rollout. Each vehicle’s model, actual software, newest match and occupancy are checked; any failure rejects the whole rollout.',
        )}
      </Hint>
      <Space orientation="vertical" size={12} style={{ width: '100%' }}>
        <Select style={{ width: '100%' }} value={releaseId} onChange={(v) => (setReleaseId(v), setWave(null))} options={releases.map((r) => ({ value: r.id, label: `DCL ${r.dclVersion} · ${r.vehicleIntegrationVersions.join(', ')}` }))} />
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
        <Typography.Text strong>{L('第一批（灰度）', 'First wave (gray)')}</Typography.Text>
        {release &&
          vehicles.map((r) => {
            const done = r.appliedConfigId === release.resolvedConfigId;
            const problems = done ? [] : otaProblems(state, r, release);
            return (
              <Flex key={r.id} gap={8} align="center" wrap>
                <Checkbox
                  disabled={done}
                  checked={firstWave.includes(r.id)}
                  onChange={(e) => setWave(e.target.checked ? [...firstWave, r.id] : firstWave.filter((x) => x !== r.id))}
                >
                  <Mono>{r.id}</Mono>
                </Checkbox>
                <Typography.Text type="secondary">
                  {r.integrationVersion ?? L('版本未知', 'software unknown')} · {releaseLabel(state, r.appliedConfigId)}
                </Typography.Text>
                {done && <Tag color="green">{L('已运行该版本', 'already runs it')}</Tag>}
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
          <Mono>{releaseLabel(state, d.resolvedConfigId)}</Mono>
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
              <Button size="small" type="primary" onClick={() => (setChosen(queued.map((t) => t.resourceId)), setPrompt({ kind: 'expand' }))}>
                {L('扩大范围', 'Expand')}
              </Button>
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
            {d.targets.some((t) => t.status === 'PENDING') && (
              <Button size="small" type="link" onClick={() => navigate('simulator')}>
                {L('去车辆模拟器回执', 'Answer in simulator')}
              </Button>
            )}
          </Space>
        )
      }
    >
      <Descriptions size="small" column={{ xs: 1, md: 3 }}>
        <Descriptions.Item label={L('下发', 'Rollout')}><Mono>{d.id}</Mono></Descriptions.Item>
        <Descriptions.Item label={L('发起', 'By')}>{`${state.accounts[d.dispatchedBy]?.displayName} · ${when(d.createdAt)}`}</Descriptions.Item>
        <Descriptions.Item label={L('车辆组', 'Groups')}>{d.vehicleGroupIds.map((g) => state.vehicleGroups[g]?.name).join(', ')}</Descriptions.Item>
        {d.rollbackOf && <Descriptions.Item label={L('回滚自', 'Rolls back')}><Mono>{d.rollbackOf}</Mono></Descriptions.Item>}
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
          { title: L('状态', 'Status'), render: (_, t) => <Tag color={TARGET_STATUS_COLORS[t.status]}>{B(TARGET_STATUS_LABELS[t.status])}</Tag> },
          { title: L('之前生效', 'Previously'), render: (_, t) => <Mono>{releaseLabel(state, t.previousConfigId)}</Mono> },
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
