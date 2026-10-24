// Personal simulation (个人研发仿真): one's own simulation instances in a workspace, the draft
// they run, trial captures and self-tests. The owner alone sees and uses them; receipts and trial
// captures come from the prototype's vehicle simulator, never from this page.

import { Alert, Button, Card, Descriptions, Drawer, Empty, Form, Input, Modal, Popconfirm, Radio, Select, Space, Switch, Table, Tag, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { useActor, useCan, useRun } from '../app/hooks.ts';
import { navigate } from '../app/router.ts';
import { useEngineState } from '../app/store.ts';
import { configurationContents } from '../engine/client-report.ts';
import { EDITABLE_STAGES } from '../engine/config.ts';
import { startSimulation, stopSimulation } from '../engine/fleet.ts';
import {
  PERSONAL_SIM_QUOTA,
  activePersonalCount,
  cancelPersonalConfig,
  configurePersonalSim,
  createPersonalSim,
  personalCapturesOf,
  personalPending,
  personalSimsOf,
  personalTestsOf,
  recordPersonalTest,
  releasePersonalSim,
} from '../engine/personal-sim.ts';
import { releasesOf } from '../engine/release.ts';
import type { Feature, Resource, State } from '../engine/types.ts';
import { baseTarget, vehicleBase } from '../engine/validation.ts';
import { useI18n } from '../i18n/i18n.tsx';
import { issueLabel } from '../i18n/issues.ts';
import { CLIENT_ITEM_STATUS_LABELS, setName } from '../i18n/vocab.ts';
import { Hint, Mono, configName, when } from './common.tsx';

const RESULT_COLORS: Record<string, string> = { PASS: 'green', FAIL: 'red' };

/** The software a personal simulation's image gives it, as people read it. */
function software(r: Resource, L: (zh: string, en: string) => string): string {
  return r.integrationVersion ?? L('未知（研发镜像）', 'unknown (development image)');
}

function StatusTag({ r }: { r: Resource }) {
  const state = useEngineState();
  const { L } = useI18n();
  if (r.status === 'RETIRED') return <Tag>{L('已释放', 'Released')}</Tag>;
  if (personalPending(state, r.id)) return <Tag color="processing">{L('等待回执', 'Awaiting receipt')}</Tag>;
  return r.instance === 'RUNNING' ? <Tag color="green">{L('运行中', 'Running')}</Tag> : <Tag>{L('已停止', 'Stopped')}</Tag>;
}

/** The personal simulations tab of “Vehicles & groups”: the actor's own instances in the workspace. */
export function PersonalSims({ workspaceId }: { workspaceId: string }) {
  const state = useEngineState();
  const actor = useActor()!;
  const can = useCan();
  const run = useRun();
  const { L, B } = useI18n();
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [showReleased, setShowReleased] = useState(false);
  const ws = state.workspaces[workspaceId]!;
  const groups = ws.groupIds.map((g) => state.groups[g]!).filter((g) => g && can('personalSim.use', { workspaceId, groupId: g.id, scope: g.domain, env: 'development' }));
  const all = personalSimsOf(state, actor.username, workspaceId);
  const mine = showReleased ? all : all.filter((r) => r.status !== 'RETIRED');
  const active = activePersonalCount(state, actor.username, workspaceId);
  const images = Object.values(state.images).filter((i) => i.vehicleModelId === ws.vehicleModelId);
  const [form] = Form.useForm<{ groupId: string; imageId: string; displayName?: string }>();
  useEffect(() => {
    if (creating) form.setFieldsValue({ groupId: groups[0]?.id, imageId: undefined, displayName: '' });
  }, [creating]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Card
      title={`${L('我的研发仿真', 'My simulations')} · ${active}/${PERSONAL_SIM_QUOTA}`}
      extra={
        <Space>
          <Typography.Text type="secondary">{L('显示已释放', 'Show released')}</Typography.Text>
          <Switch size="small" checked={showReleased} onChange={setShowReleased} />
          <Button type="primary" disabled={active >= PERSONAL_SIM_QUOTA || groups.length === 0} onClick={() => setCreating(true)}>
            {L('新建个人仿真', 'New personal simulation')}
          </Button>
        </Space>
      }
    >
      <Hint>
        {L(
          '个人仿真只属于你：用它运行本组 Feature 的当前草稿、试触发策略并记录个人自测。基线跟随镜像的软件版本（未知版本用初始配置）。个人自测不计入团队测试或 Verified，也不进入数据查询；个人仿真不能加入工作区车辆或车辆组。每个工作区最多同时保留 3 个，释放后保留历史。',
          'A personal simulation is yours alone: run your group’s current Feature draft on it, fire policies as trials and record a self-test. Its base follows the image’s software (unknown software takes the initial configuration). Self-tests never count as team tests or Verified and never reach data query; a personal simulation never joins workspace vehicles or vehicle groups. Up to 3 per workspace at a time; released ones keep their history.',
        )}
      </Hint>
      <Table
        rowKey="id"
        size="small"
        pagination={false}
        dataSource={mine}
        scroll={{ x: 'max-content' }}
        locale={{ emptyText: <Empty description={L('还没有个人仿真', 'No personal simulations yet')} /> }}
        columns={[
          { title: L('仿真', 'Simulation'), render: (_, r) => <Space><Mono>{r.id}</Mono>{r.displayName}</Space> },
          { title: L('业务分组', 'Group'), render: (_, r) => state.groups[r.personal!.groupId]?.name },
          { title: L('镜像 / 软件', 'Image / software'), render: (_, r) => `${r.imageId} · ${software(r, L)}` },
          { title: L('正在运行', 'Runs'), render: (_, r) => (r.appliedConfigId ? <Mono>{B(configName(state, r.appliedConfigId))}</Mono> : <Typography.Text type="secondary">{L('无配置', 'nothing')}</Typography.Text>) },
          { title: L('状态', 'Status'), render: (_, r) => <StatusTag r={r} /> },
          {
            title: '',
            render: (_, r) => (
              <Button size="small" onClick={() => setOpen(r.id)}>
                {L('打开', 'Open')}
              </Button>
            ),
          },
        ]}
      />
      <Modal
        open={creating}
        title={L('新建个人仿真', 'New personal simulation')}
        okText={L('创建', 'Create')}
        onCancel={() => setCreating(false)}
        onOk={async () => {
          const v = await form.validateFields();
          const id = run((c) => createPersonalSim(c, { workspaceId, groupId: v.groupId, imageId: v.imageId, displayName: v.displayName }), L('已创建个人仿真', 'Personal simulation created'));
          if (id) {
            setCreating(false);
            setOpen(id);
          }
        }}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="groupId" label={L('业务分组', 'Business group')} rules={[{ required: true }]} extra={L('个人仿真只运行该分组的 Feature 草稿。', 'It runs Feature drafts of this group only.')}>
            <Select options={groups.map((g) => ({ value: g.id, label: g.name }))} />
          </Form.Item>
          <Form.Item name="imageId" label={L('运行镜像', 'Runtime image')} rules={[{ required: true }]} extra={L('整车软件版本取自镜像；研发镜像没有整车版本，按未知版本处理。', 'The whole-vehicle software comes from the image; a development image has none and counts as unknown.')}>
            <Select
              options={images.map((i) => ({ value: i.id, label: `${i.id} · ${i.integrationVersion ?? L('无整车版本', 'no whole-vehicle version')} · ${i.simulator}` }))}
            />
          </Form.Item>
          <Form.Item name="displayName" label={L('名称（可选）', 'Name (optional)')}>
            <Input placeholder={L('例如：急刹车调试', 'e.g. hard-braking debug')} />
          </Form.Item>
        </Form>
      </Modal>
      <PersonalSimDrawer id={open} onClose={() => setOpen(null)} />
    </Card>
  );
}

/** Features whose drafts a personal simulation may run: its group's, in its workspace, still editable. */
function runnableFeatures(s: State, r: Resource): Feature[] {
  return Object.values(s.features)
    .filter((f) => f.workspaceId === r.homeWorkspaceId && f.groupId === r.personal!.groupId && EDITABLE_STAGES.includes(f.stage))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function PersonalSimDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const state = useEngineState();
  const run = useRun();
  const { L, B } = useI18n();
  const r = id ? state.resources[id] : undefined;
  const [featureId, setFeatureId] = useState<string | undefined>();
  const [baseId, setBaseId] = useState<string>('');
  const [disabled, setDisabled] = useState<string[]>([]);
  const [result, setResult] = useState<'PASS' | 'FAIL'>('PASS');
  const [note, setNote] = useState('');
  useEffect(() => {
    setFeatureId(undefined);
    setBaseId('');
    setDisabled([]);
    setNote('');
  }, [id]);
  if (!r?.personal) return <Drawer open={false} onClose={onClose} />;

  const features = runnableFeatures(state, r);
  const feature = featureId ? state.features[featureId] : features[0];
  const followed = vehicleBase(state, null, r);
  const target = feature ? baseTarget(state, feature, baseId || null, r, []) : null;
  const switchable = target && !target.problem ? Object.entries(target.groups).flatMap(([g, c]) => Object.keys(state.commits[c]!.policies).map((p) => ({ value: p, label: `${p} · ${state.groups[g]?.code ?? g}` }))) : [];
  const pending = personalPending(state, r.id);
  const applied = r.appliedConfigId ? state.resolvedConfigs[r.appliedConfigId] : undefined;
  const contents = configurationContents(state, r.appliedConfigId);
  const captures = personalCapturesOf(state, r.id);
  const tests = Object.values(state.personalTests)
    .filter((t) => t.resourceId === r.id)
    .sort((a, b) => b.seq - a.seq);
  const retired = r.status === 'RETIRED';
  const runsDraft = applied?.kind === 'PERSONAL';

  return (
    <Drawer open size={760} title={`${L('个人仿真', 'Personal simulation')} · ${r.id}${r.displayName ? ` · ${r.displayName}` : ''}`} onClose={onClose}
      extra={
        !retired && (
          <Space>
            {r.instance === 'RUNNING' ? (
              <Button disabled={!!pending} onClick={() => run((c) => stopSimulation(c, r.id), L('已停止', 'Stopped'))}>{L('停止', 'Stop')}</Button>
            ) : (
              <Button onClick={() => run((c) => startSimulation(c, r.id), L('已启动', 'Started'))}>{L('启动', 'Start')}</Button>
            )}
            <Popconfirm title={L('释放后不能再使用；配置、试触发和自测历史保留。', 'Released instances cannot be used again; configurations, trial captures and self-tests stay.')} onConfirm={() => run((c) => releasePersonalSim(c, r.id), L('已释放', 'Released'))}>
              <Button danger disabled={!!pending}>{L('释放', 'Release')}</Button>
            </Popconfirm>
          </Space>
        )
      }
    >
      <Space orientation="vertical" size={16} style={{ width: '100%' }}>
        <Descriptions size="small" column={2} bordered>
          <Descriptions.Item label="UVID"><Mono>{r.uvid}</Mono></Descriptions.Item>
          <Descriptions.Item label={L('状态', 'Status')}><StatusTag r={r} /></Descriptions.Item>
          <Descriptions.Item label={L('镜像', 'Image')}><Mono>{r.imageId}</Mono></Descriptions.Item>
          <Descriptions.Item label={L('整车软件', 'Software')}>{software(r, L)}</Descriptions.Item>
          <Descriptions.Item label={L('跟随软件的基线', 'Base for its software')} span={2}>
            {followed.problem ? B(issueLabel(followed.problem), followed.problem) : followed.release ? B(setName(followed.release.dclVersion)) : L('初始研发配置', 'Initial configuration')}
          </Descriptions.Item>
        </Descriptions>

        {!retired && (
          <Card size="small" title={L('配置草稿', 'Run a draft')}>
            {pending ? (
              <Alert
                type="info"
                showIcon
                title={L('已下发，等待仿真回执', 'Sent; waiting for the simulation’s receipt')}
                description={L('回执由原型工具中的车辆模拟器发出；回执成功后才算生效，失败则保留原配置。', 'The vehicle simulator in the prototype tools sends the receipt; only a successful one makes it run, a failure keeps the previous configuration.')}
                action={
                  <Space orientation="vertical">
                    <Button size="small" onClick={() => navigate('simulator')}>{L('车辆模拟器', 'Vehicle simulator')}</Button>
                    <Button size="small" onClick={() => run((c) => cancelPersonalConfig(c, r.id), L('已撤回', 'Withdrawn'))}>{L('撤回', 'Withdraw')}</Button>
                  </Space>
                }
              />
            ) : features.length === 0 ? (
              <Typography.Text type="secondary">{L('本组在这个工作区没有可运行草稿的 Feature。', 'No Feature of this group here has a draft to run.')}</Typography.Text>
            ) : (
              <Space orientation="vertical" style={{ width: '100%' }}>
                <Typography.Text type="secondary">
                  {L(
                    '发送所选 Feature 的当前草稿（未提交的内容）。草稿须能提交，敏感文件须已通过 DCL 审核。',
                    'Sends the chosen Feature’s current draft (uncommitted content). The draft must be submittable; sensitive files need a DCL approval.',
                  )}
                </Typography.Text>
                <Space wrap>
                  <Select style={{ width: 240 }} value={feature?.id} onChange={(v) => (setFeatureId(v), setDisabled([]))} options={features.map((f) => ({ value: f.id, label: f.name }))} />
                  <Select
                    style={{ width: 260 }}
                    value={baseId}
                    onChange={(v) => (setBaseId(v), setDisabled([]))}
                    options={[
                      { value: '', label: L('基线：跟随软件版本', 'Base: follow the software') },
                      ...releasesOf(state, r.vehicleModelId).map((x) => ({ value: x.id, label: `${L('显式基线', 'Explicit base')}：${B(setName(x.dclVersion))}` })),
                    ]}
                  />
                </Space>
                {target?.problem && <Alert type="warning" showIcon title={B(issueLabel(target.problem), target.problem)} />}
                {switchable.length > 0 && (
                  <Select
                    mode="multiple"
                    style={{ width: '100%' }}
                    value={disabled}
                    onChange={setDisabled}
                    placeholder={L('关闭其他分组的策略（可选）', 'Switch off other groups’ policies (optional)')}
                    options={switchable}
                  />
                )}
                <Button
                  type="primary"
                  disabled={!feature}
                  onClick={() => run((c) => configurePersonalSim(c, r.id, { featureId: feature!.id, baseReleaseId: baseId || null, disabledPolicies: disabled }), L('已下发草稿，等待仿真回执', 'Draft sent; waiting for the receipt'))}
                >
                  {L('配置草稿', 'Send draft')}
                </Button>
              </Space>
            )}
          </Card>
        )}

        <Card size="small" title={L('正在运行', 'What it runs')}>
          {!contents ? (
            <Typography.Text type="secondary">{L('还没有生效的配置。', 'No configuration applied yet.')}</Typography.Text>
          ) : (
            <Space orientation="vertical" style={{ width: '100%' }}>
              <Mono>{B(configName(state, r.appliedConfigId))}</Mono>
              <Table
                rowKey="id"
                size="small"
                pagination={false}
                dataSource={contents.policies}
                columns={[
                  { title: L('策略', 'Policy'), render: (_, p) => <Mono>{p.id}</Mono> },
                  { title: L('版本', 'Version'), render: (_, p) => (p.version === 'draft' ? <Tag color="purple">{L('草稿', 'draft')}</Tag> : p.version) },
                  { title: L('状态', 'Status'), render: (_, p) => <Tag color={p.status === 'DISABLED' ? 'default' : 'blue'}>{B(CLIENT_ITEM_STATUS_LABELS[p.status], p.status)}</Tag> },
                ]}
              />
            </Space>
          )}
        </Card>

        <Card size="small" title={L('试触发（仅本人可见）', 'Trial captures (yours only)')}>
          <Hint>
            {L(
              '试触发由原型工具中的车辆模拟器扮演仿真器发起：记录哪条草稿策略触发、会采集哪些文件。不上传、不处理，不进入数据查询或训练。',
              'Trial captures are fired by the vehicle simulator in the prototype tools, playing the simulator: which draft policy fired and which files it would capture. Nothing is uploaded or processed, and nothing reaches data query or training.',
            )}
          </Hint>
          <Table
            rowKey="id"
            size="small"
            pagination={false}
            dataSource={captures}
            locale={{ emptyText: L('还没有试触发', 'No trial captures yet') }}
            columns={[
              { title: L('时间', 'When'), render: (_, c) => when(c.occurredAt) },
              { title: L('策略', 'Policy'), render: (_, c) => `${c.policyName} · ${c.trigger}` },
              { title: L('文件', 'Files'), render: (_, c) => c.files.map((f) => `${f.name} (${f.format}, ${(f.sizeBytes / 1_000_000).toFixed(1)} MB)`).join('；') },
              { title: L('配置', 'Configuration'), render: (_, c) => (c.configId === r.appliedConfigId ? <Tag color="blue">{L('当前', 'current')}</Tag> : <Tag>{L('之前', 'earlier')}</Tag>) },
            ]}
          />
        </Card>

        <Card size="small" title={L('个人自测', 'Self-test')}>
          {!retired && runsDraft && (
            <Space wrap style={{ marginBottom: 12 }}>
              <Radio.Group value={result} onChange={(e) => setResult(e.target.value)} options={['PASS', 'FAIL']} optionType="button" />
              <Input style={{ width: 320 }} value={note} onChange={(e) => setNote(e.target.value)} placeholder={L('测了什么、结果如何', 'What you tested and what happened')} />
              <Button onClick={() => run((c) => recordPersonalTest(c, r.id, { result, note }), L('已记录个人自测', 'Self-test recorded')) && setNote('')}>{L('记录', 'Record')}</Button>
            </Space>
          )}
          <Table
            rowKey="id"
            size="small"
            pagination={false}
            dataSource={tests}
            locale={{ emptyText: L('还没有自测', 'No self-tests yet') }}
            columns={[
              { title: L('时间', 'When'), render: (_, t) => when(t.createdAt) },
              { title: 'Feature', render: (_, t) => state.features[t.featureId]?.name },
              { title: L('结果', 'Result'), render: (_, t) => <Tag color={RESULT_COLORS[t.result]}>{t.result}</Tag> },
              { title: L('说明', 'Note'), dataIndex: 'note' },
              { title: L('试触发', 'Trials'), render: (_, t) => t.captureIds.length },
            ]}
          />
        </Card>
      </Space>
    </Drawer>
  );
}

/** Self-tests of a Feature's drafts on personal simulations: shown, never required. */
export function PersonalTestsCard({ feature }: { feature: Feature }) {
  const state = useEngineState();
  const { L } = useI18n();
  const tests = personalTestsOf(state, feature.id);
  if (tests.length === 0) return null;
  return (
    <Card title={L('个人自测（不计入验证）', 'Personal self-tests (not team evidence)')}>
      <Hint>
        {L(
          '开发者在自己的个人仿真上对草稿做的自测，仅供参考：不产生测试目标、不改变阶段，也不是提交或 Verified 的前提。',
          'Self-tests developers ran on drafts on their own personal simulations, for reference only: they create no test targets, change no stage and gate neither submit nor Verified.',
        )}
      </Hint>
      <Table
        rowKey="id"
        size="small"
        pagination={false}
        dataSource={tests}
        scroll={{ x: 'max-content' }}
        columns={[
          { title: L('时间', 'When'), render: (_, t) => when(t.createdAt) },
          { title: L('人员', 'By'), render: (_, t) => state.accounts[t.owner]?.displayName ?? t.owner },
          { title: L('仿真 / 软件', 'Simulation / software'), render: (_, t) => `${t.resourceId} · ${t.integrationVersion ?? L('未知', 'unknown')}` },
          { title: L('基线', 'Base'), render: (_, t) => (t.baseReleaseId ? state.releases[t.baseReleaseId]?.dclVersion : L('初始', 'initial')) },
          { title: L('结果', 'Result'), render: (_, t) => <Tag color={RESULT_COLORS[t.result]}>{t.result}</Tag> },
          { title: L('说明', 'Note'), dataIndex: 'note' },
          {
            title: L('对应内容', 'Content'),
            render: (_, t) => (
              <Space size={4} wrap>
                {t.draftCurrent ? <Tag color="green">{L('与当前草稿一致', 'Matches the draft')}</Tag> : <Tag>{L('草稿已变化', 'Draft changed since')}</Tag>}
                {t.matchingCommitId && (
                  <Tag color="blue">
                    {L('与提交一致', 'Matches commit')} r{String(state.commits[t.matchingCommitId]!.sequence).padStart(3, '0')}
                  </Tag>
                )}
              </Space>
            ),
          },
        ]}
      />
    </Card>
  );
}

/** One line for the submit dialog: whether the draft about to be committed passed a self-test. */
export function draftSelfTest(s: State, feature: Feature): 'PASS' | 'FAIL' | null {
  const latest = personalTestsOf(s, feature.id).find((t) => t.draftCurrent);
  return latest?.result ?? null;
}
