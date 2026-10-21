// 流程验收: replay the acceptance scripts scene by scene in the real product. The tester acts as the
// scene's account through the normal entry, ticks the steps, and records the result with evidence.
// Records are the tester's own statements, kept in this browser; nothing here performs a step.

import { Alert, App, Button, Card, Checkbox, Col, Descriptions, Empty, Flex, Input, Row, Segmented, Space, Table, Tag, Timeline, Typography } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { SCENE_NOTES, SCRIPT_NOTES } from '../acceptance/notes.ts';
import { NEGATIVE_CASES, SCRIPTS } from '../acceptance/scripts.ts';
import type { Scene } from '../acceptance/scripts.ts';
import { useActor, useWorkspace } from '../app/hooks.ts';
import { resetPlatform, setSession, useEngineState } from '../app/store.ts';
import { PageHeader, when } from '../components/common.tsx';
import { visibleFeatures } from '../engine/config.ts';
import { workspaceVehicles } from '../engine/fleet.ts';
import { pendingForVehicles } from '../engine/simulator.ts';
import { useI18n } from '../i18n/i18n.tsx';

type Result = 'NOT_RUN' | 'PASS' | 'FAIL' | 'BLOCKED' | 'SKIPPED' | 'NOT_APPLICABLE';

interface SceneRecord {
  checked: number[];
  result: Result;
  executor: string;
  evidence: string;
  updatedAt: string | null;
  history: { at: string; result: Result; executor: string; evidence: string }[];
}

interface Record_ {
  runId: string;
  startedAt: string;
  scenes: Record<string, SceneRecord>;
}

const KEY = 'kairoz.acceptance.v1';
const RESULTS: Result[] = ['NOT_RUN', 'PASS', 'FAIL', 'BLOCKED', 'SKIPPED', 'NOT_APPLICABLE'];
const COLORS: Record<Result, string> = { NOT_RUN: 'default', PASS: 'green', FAIL: 'red', BLOCKED: 'orange', SKIPPED: 'default', NOT_APPLICABLE: 'purple' };

const newRecord = (): Record_ => ({ runId: `KZ-ACC-${new Date().toISOString().slice(0, 19).replaceAll(/[-:T]/g, '')}`, startedAt: new Date().toISOString(), scenes: {} });

function load(): Record_ {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Record_;
  } catch {
    // unreadable storage: start a fresh record
  }
  return newRecord();
}

function save(r: Record_): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(r));
  } catch {
    // storage unavailable: the record lives only in this page
  }
}

const emptyScene = (): SceneRecord => ({ checked: [], result: 'NOT_RUN', executor: '', evidence: '', updatedAt: null, history: [] });

/** Negative cases appear as one-step scenes so they can be recorded the same way. */
const NEGATIVE_SCRIPT = {
  id: 'negative',
  name: '反向用例 T-N01–T-N24',
  scenes: NEGATIVE_CASES.map<Scene>((c) => ({ id: c.id, title: c.action, actor: c.role, accounts: [], workspace: null, page: '', pre: '', steps: [c.action], done: c.expected, fail: '' })),
};

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function AcceptancePage() {
  const { L } = useI18n();
  const { modal, message } = App.useApp();
  const [record, setRecord] = useState<Record_>(load);
  const [scriptId, setScriptId] = useState('first-ota');
  const scripts = useMemo(() => [...SCRIPTS, NEGATIVE_SCRIPT], []);
  const script = scripts.find((s) => s.id === scriptId)!;
  const [sceneId, setSceneId] = useState(script.scenes[0]!.id);
  const scene = script.scenes.find((s) => s.id === sceneId) ?? script.scenes[0]!;
  const key = (s: string, id: string) => `${s}/${id}`;
  const rec = (s: string, id: string) => record.scenes[key(s, id)] ?? emptyScene();

  useEffect(() => save(record), [record]);

  const update = (id: string, change: (r: SceneRecord) => SceneRecord) =>
    setRecord((prev) => ({ ...prev, scenes: { ...prev.scenes, [key(scriptId, id)]: change(prev.scenes[key(scriptId, id)] ?? emptyScene()) } }));

  const counts = (s: (typeof scripts)[number]) => {
    const c: Partial<Record<Result, number>> = {};
    for (const sc of s.scenes) {
      const r = rec(s.id, sc.id).result;
      c[r] = (c[r] ?? 0) + 1;
    }
    return c;
  };

  const exportJson = () =>
    download(`${record.runId}.json`, JSON.stringify({ ...record, kind: 'kairoz.acceptance-record', selfReported: true, exportedAt: new Date().toISOString() }, null, 2), 'application/json');
  const exportCsv = () => {
    const rows = [['script', 'scene', 'title', 'result', 'executor', 'evidence', 'updatedAt']];
    for (const s of scripts) for (const sc of s.scenes) {
      const r = rec(s.id, sc.id);
      rows.push([s.id, sc.id, sc.title, r.result, r.executor, r.evidence, r.updatedAt ?? '']);
    }
    download(`${record.runId}.csv`, rows.map((r) => r.map((x) => `"${String(x).replaceAll('"', '""')}"`).join(',')).join('\n'), 'text/csv');
  };

  return (
    <div className="kz-page">
      <div className="kz-sim-banner" style={{ padding: '10px 14px', borderRadius: 8, marginBottom: 16 }}>
        <Typography.Text strong>{L('流程验收 · 仅原型', 'Acceptance replay · prototype only')}</Typography.Text>
        <Typography.Text>
          {' '}
          {L(
            '按剧本逐幕在平台中以对应账号实际操作，然后在这里勾选步骤并登记结果。记录保存在本浏览器，是测试人员自述，没有签名；本页不代替任何操作。',
            'Play each scene in the product as its account, then tick the steps and record the result here. Records stay in this browser and are the tester’s own statements, unsigned; this page performs nothing.',
          )}
        </Typography.Text>
      </div>
      <PageHeader
        title={L('流程验收', 'Acceptance replay')}
        subtitle={`${record.runId} · ${when(record.startedAt)}`}
        extra={
          <Space wrap>
            <Button onClick={exportJson}>{L('导出 JSON', 'Export JSON')}</Button>
            <Button onClick={exportCsv}>{L('导出 CSV', 'Export CSV')}</Button>
            <Button
              danger
              onClick={() =>
                modal.confirm({
                  title: L('新建验收记录？', 'Start a new acceptance record?'),
                  content: L('当前记录会被清空；如需保留请先导出。', 'The current record is cleared; export it first to keep it.'),
                  onOk: () => setRecord(newRecord()),
                })
              }
            >
              {L('新建记录', 'New record')}
            </Button>
          </Space>
        }
      />
      <Segmented
        style={{ marginBottom: 12 }}
        value={scriptId}
        onChange={(v) => {
          setScriptId(v as string);
          setSceneId(scripts.find((s) => s.id === v)!.scenes[0]!.id);
        }}
        options={scripts.map((s) => ({ value: s.id, label: `${s.name} (${counts(s).PASS ?? 0}/${s.scenes.length})` }))}
      />
      {SCRIPT_NOTES[scriptId] && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          title={SCRIPT_NOTES[scriptId]}
          action={
            scriptId !== 'negative' && (
              <Button
                size="small"
                onClick={() =>
                  modal.confirm({
                    title: scriptId === 'data-usage' ? L('重置为演示数据？', 'Reset to demo data?') : L('重置为干净安装？', 'Reset to a clean installation?'),
                    content: L('当前浏览器中的原型数据会被替换；验收记录保留。', 'Prototype data in this browser is replaced; the acceptance record stays.'),
                    onOk: () => {
                      resetPlatform(scriptId === 'data-usage' ? 'demo' : 'clean');
                      message.success(L('已重置，请重新选择账号', 'Reset; choose an account again'));
                    },
                  })
                }
              >
                {L('准备环境', 'Prepare')}
              </Button>
            )
          }
        />
      )}
      <Row gutter={16}>
        <Col xs={24} xl={9}>
          <Card size="small" styles={{ body: { padding: 0 } }}>
            <Table
              rowKey="id"
              size="small"
              pagination={false}
              dataSource={script.scenes}
              scroll={{ y: 620 }}
              onRow={(s) => ({ onClick: () => setSceneId(s.id), style: { cursor: 'pointer', background: s.id === scene.id ? '#f0f5ff' : undefined } })}
              columns={[
                { title: L('幕', 'Scene'), width: 64, render: (_, s) => <Typography.Text strong>{s.id}</Typography.Text> },
                { title: L('内容', 'Content'), render: (_, s) => <Typography.Text ellipsis style={{ maxWidth: 260 }}>{s.title}</Typography.Text> },
                { title: L('结果', 'Result'), width: 110, render: (_, s) => <Tag color={COLORS[rec(script.id, s.id).result]}>{rec(script.id, s.id).result}</Tag> },
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} xl={15}>
          <SceneCard key={key(script.id, scene.id)} scriptId={script.id} scene={scene} record={rec(script.id, scene.id)} onSave={(r) => update(scene.id, () => r)} />
        </Col>
      </Row>
    </div>
  );
}

function SceneCard({ scriptId, scene, record, onSave }: { scriptId: string; scene: Scene; record: SceneRecord; onSave: (r: SceneRecord) => void }) {
  const state = useEngineState();
  const actor = useActor();
  const { workspace, roles } = useWorkspace();
  const { L } = useI18n();
  const { message } = App.useApp();
  const [checked, setChecked] = useState<number[]>(record.checked);
  const [result, setResult] = useState<Result>(record.result);
  const [executor, setExecutor] = useState(record.executor || actor?.username || '');
  const [evidence, setEvidence] = useState(record.evidence);
  const [check, setCheck] = useState<string[] | null>(null);
  const note = SCENE_NOTES[`${scriptId}/${scene.id}`];

  const commit = () => {
    if (result === 'PASS' && checked.length !== scene.steps.length) return message.error(L('通过需要逐步勾选全部步骤', 'PASS needs every step ticked'));
    if (['FAIL', 'BLOCKED', 'SKIPPED', 'NOT_APPLICABLE'].includes(result) && !evidence.trim()) return message.error(L('失败、阻塞、跳过与不适用需要写明原因', 'FAIL, BLOCKED, SKIPPED and NOT_APPLICABLE need a reason'));
    const now = new Date().toISOString();
    onSave({ checked, result, executor: executor.trim(), evidence: evidence.trim(), updatedAt: now, history: [...record.history, { at: now, result, executor: executor.trim(), evidence: evidence.trim() }] });
    message.success(L('已登记', 'Recorded'));
  };

  const autoCheck = () =>
    setCheck([
      `${L('当前账号', 'Account')}: ${actor ? `${actor.username} (${actor.displayName})` : L('未登录', 'not signed in')}`,
      `${L('当前工作区与角色', 'Workspace and roles')}: ${workspace?.id ?? '—'} · ${roles.join(', ') || '—'}`,
      `${L('授权', 'Grants')}: ${actor?.grants.map((g) => `${g.role}[${g.workspaces.join('|')}; ${(g.groups.length ? g.groups : g.scopes).join('|')}; ${g.envs.join('|')}${g.dispatchOnly ? '; dispatch-only' : ''}]`).join(' / ') ?? '—'}`,
      `${L('本工作区可见', 'Visible here')}: ${workspace ? `${workspaceVehicles(state, workspace.id).length} ${L('辆车', 'vehicles')} · ${actor ? visibleFeatures(state, actor, workspace.id).length : 0} Feature` : '—'}`,
      `${L('等待车辆回执', 'Awaiting receipts')}: ${pendingForVehicles(state).length}`,
    ]);

  return (
    <Card
      title={
        <Space wrap>
          <Typography.Text strong>{scene.id}</Typography.Text>
          <span>{scene.title}</span>
        </Space>
      }
    >
      <Descriptions size="small" column={1} style={{ marginBottom: 12 }}>
        <Descriptions.Item label={L('执行人', 'Actor')}>
          <Space wrap>
            <span>{scene.actor}</span>
            {scene.accounts.map((u) =>
              state.accounts[u] ? (
                <Button
                  key={u}
                  size="small"
                  type={actor?.username === u ? 'primary' : 'default'}
                  onClick={() => setSession({ username: u, workspaceId: scene.workspace && state.workspaces[scene.workspace] ? scene.workspace : null })}
                >
                  {L(`以 ${u} 进入`, `Act as ${u}`)}
                </Button>
              ) : (
                <Tag key={u}>{L(`${u}（尚未创建）`, `${u} (not created yet)`)}</Tag>
              ),
            )}
          </Space>
        </Descriptions.Item>
        {scene.workspace && <Descriptions.Item label={L('工作区', 'Workspace')}>{scene.workspace}</Descriptions.Item>}
        {scene.page && <Descriptions.Item label={L('页面', 'Page')}>{scene.page}</Descriptions.Item>}
        {scene.pre && <Descriptions.Item label={L('前置条件', 'Precondition')}>{scene.pre}</Descriptions.Item>}
      </Descriptions>
      {note && <Alert type="warning" showIcon style={{ marginBottom: 12 }} title={L('Kairoz 适配', 'How Kairoz plays it')} description={note} />}
      <Checkbox.Group value={checked} onChange={(v) => setChecked(v as number[])} style={{ width: '100%' }}>
        <Flex vertical gap={6}>
          {scene.steps.map((step, i) => (
            <Checkbox key={i} value={i}>
              {step}
            </Checkbox>
          ))}
        </Flex>
      </Checkbox.Group>
      <Descriptions size="small" column={1} style={{ marginTop: 12 }}>
        <Descriptions.Item label={L('完成条件', 'Done when')}>{scene.done}</Descriptions.Item>
        {scene.fail && <Descriptions.Item label={L('失败处理', 'On failure')}>{scene.fail}</Descriptions.Item>}
      </Descriptions>
      <Space style={{ margin: '8px 0' }}>
        <Button size="small" onClick={autoCheck}>
          {L('只读自动检查', 'Read-only check')}
        </Button>
        <Typography.Text type="secondary">{L('只读当前账号上下文与可见对象，不证明业务流程或车端成功。', 'Reads the current account context and visible objects; it proves no business flow or vehicle success.')}</Typography.Text>
      </Space>
      {check && (
        <Alert
          type="info"
          style={{ marginBottom: 12 }}
          description={
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {check.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          }
        />
      )}
      <Card size="small" title={L('登记结果', 'Record the result')}>
        <Space orientation="vertical" style={{ width: '100%' }}>
          <Segmented value={result} onChange={(v) => setResult(v as Result)} options={RESULTS.map((r) => ({ value: r, label: r }))} />
          <Input value={executor} onChange={(e) => setExecutor(e.target.value)} placeholder={L('实际执行人', 'Who performed it')} />
          <Input.TextArea rows={3} value={evidence} onChange={(e) => setEvidence(e.target.value)} placeholder={L('关联对象与版本、观察结果、证据位置；失败或阻塞写明原因', 'Objects and versions involved, observations, where evidence is; reasons for failures or blocks')} />
          <Button type="primary" onClick={commit}>
            {L('保存', 'Save')}
          </Button>
        </Space>
      </Card>
      {record.history.length > 0 ? (
        <Timeline
          style={{ marginTop: 16 }}
          items={[...record.history].reverse().map((h) => ({
            color: COLORS[h.result] === 'default' ? 'gray' : COLORS[h.result],
            content: (
              <span>
                <Tag color={COLORS[h.result]}>{h.result}</Tag> {h.executor} · {when(h.at)} · {h.evidence}
              </span>
            ),
          }))}
        />
      ) : (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={L('尚未登记', 'Not recorded yet')} />
      )}
    </Card>
  );
}
