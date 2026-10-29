// The simulated PLM (PLM（模拟）, prototype only): plays the company's version record so the
// platform has versions to sync. PLM maps every module's version (the BOM) to one whole-vehicle
// version number; the DCL part DCL hands over is one of those modules. Every whole-vehicle
// integration test round gets a test version, and the passing one is released under the same
// number. Nothing here is the platform's: the platform learns a version only by syncing.

import { MinusCircleOutlined, PlusOutlined } from '@ant-design/icons';
import { App, Button, Card, Input, Modal, Radio, Select, Space, Table, Tag, Tooltip, Typography } from 'antd';
import { useState } from 'react';
import { useErrorText } from '../app/hooks.ts';
import { engine, useEngineState } from '../app/store.ts';
import { Hint, Mono, PageHeader, ShortId, when } from '../components/common.tsx';
import { sha256Hex } from '../domain/canonical.ts';
import type { Ctx } from '../engine/engine.ts';
import { latestPlmVersion, publishPlmVersion, releasePlmVersion, syncPlmIfChanged } from '../engine/plm.ts';
import { compareVersions } from '../engine/release.ts';
import { partVersion } from '../engine/types.ts';
import type { PlmVersion } from '../engine/types.ts';
import { useI18n } from '../i18n/i18n.tsx';
import { PLM_STAGE_LABELS } from '../i18n/vocab.ts';

type Part = NonNullable<PlmVersion['dclPart']>;
type Publishing = { model: string; version: string; modules: { name: string; version: string }[]; part: string; stage: PlmVersion['stage'] };

const NONE = 'none';
const UNKNOWN = 'unknown';

export function PlmPage() {
  const state = useEngineState();
  const { L, B } = useI18n();
  const { message } = App.useApp();
  const errorText = useErrorText();
  const [form, setForm] = useState<Publishing | null>(null);
  const pending = state.plm.revision !== state.plmSync.revision;
  // Versions the platform held back over a number clash; those waiting on another name's part are tried again by a sync.
  const held = state.plmSync.conflicts ?? [];
  const retry = held.some((c) => c.kind === 'OTHER_NAME');
  const models = Object.keys(state.vehicleModels).sort();

  const system = <R,>(op: (c: Ctx) => R, ok?: string) => {
    try {
      const r = engine.run(null, op);
      if (ok) message.success(ok);
      return r;
    } catch (e) {
      message.error(errorText(e));
      return undefined;
    }
  };

  // DCL parts PLM received: each one DCL handed over for a working name (in the real system an upload to PLM).
  const received = Object.values(state.softwareVersions)
    .filter((v) => v.dclPart?.deliveredBy && v.status === 'PLANNED')
    .map((v) => ({ model: v.vehicleModelId, workingName: v.version, part: v.dclPart!, usedIn: state.plm.versions.filter((x) => x.dclPart?.digest === v.dclPart!.digest).map((x) => x.version) }));
  // What a new version may carry: a received part, or one already in a version's BOM.
  const choices = new Map<string, { model: string; part: Part; label: string }>();
  for (const r of received) {
    const label = r.usedIn.length
      ? L(`DCL ${partVersion(r.part)} · 工作名 ${r.workingName} · 已用于 ${r.usedIn.join('、')}`, `DCL ${partVersion(r.part)} · working name ${r.workingName} · in ${r.usedIn.join(', ')}`)
      : L(`DCL ${partVersion(r.part)} · 工作名 ${r.workingName}`, `DCL ${partVersion(r.part)} · working name ${r.workingName}`);
    choices.set(r.part.digest, { model: r.model, part: r.part, label });
  }
  for (const v of state.plm.versions) {
    if (v.dclPart && !choices.has(v.dclPart.digest)) choices.set(v.dclPart.digest, { model: v.vehicleModelId, part: v.dclPart, label: L(`DCL ${partVersion(v.dclPart)} · 同 ${v.version}`, `DCL ${partVersion(v.dclPart)} · as in ${v.version}`) });
  }

  const start = (model: string) => setForm({ model, version: '', modules: (latestPlmVersion(state.plm, model)?.modules ?? []).map((m) => ({ ...m })), part: NONE, stage: form?.stage ?? 'TEST' });
  const publish = () => {
    if (!form) return;
    const known = choices.get(form.part);
    const dclPart: Part | null =
      form.part === UNKNOWN
        ? { clientVersion: '2.3.0', setVersion: '9.9.9', digest: `sha256:${sha256Hex(`unknown-part-${form.model}-${form.version}`)}` }
        : known
          ? { clientVersion: known.part.clientVersion, setVersion: known.part.setVersion, digest: known.part.digest }
          : null;
    const ok = form.stage === 'TEST' ? L('PLM 已出测试版本（待同步到平台）', 'Test version issued in PLM (to sync)') : L('PLM 已发布（待同步到平台）', 'Published in PLM (to sync)');
    if (system((c) => publishPlmVersion(c, { vehicleModelId: form.model, version: form.version, modules: form.modules, dclPart, stage: form.stage }), ok) !== undefined) setForm(null);
  };
  const setModule = (i: number, key: 'name' | 'version', value: string) => form && setForm({ ...form, modules: form.modules.map((m, j) => (j === i ? { ...m, [key]: value } : m)) });

  return (
    <div className="kz-page">
      <div className="kz-sim-banner" style={{ padding: '10px 14px', borderRadius: 8, marginBottom: 16 }}>
        <Typography.Text strong>{L('模拟区 · 仅原型', 'Simulation zone · prototype only')}</Typography.Text>
        <Typography.Text>
          {' '}
          {L('这里扮演公司的 PLM（版本管理），不属于平台。平台只读取 PLM 的整车版本（每轮的测试版本和已发布版本）；DCL 件由 DCL 在平台导出后交给 PLM。', 'This plays the company’s PLM (version record); it is not part of the platform. The platform only reads PLM’s versions (each round’s test version and the released ones); DCL exports the DCL part from the platform and hands it to PLM.')}
        </Typography.Text>
      </div>
      <PageHeader
        title={L('PLM（模拟）', 'PLM (simulated)')}
        extra={
          <Space wrap>
            <Tag color={pending ? 'gold' : 'green'}>
              {pending ? L(`待同步：修订 ${state.plm.revision}，平台已同步 ${state.plmSync.revision}`, `To sync: revision ${state.plm.revision}, platform synced ${state.plmSync.revision}`) : L(`平台已同步修订 ${state.plm.revision}`, `Platform synced revision ${state.plm.revision}`)}
            </Tag>
            {held.length > 0 && <Tag color="orange">{L(`${held.length} 个版本因版本号冲突未同步`, `${held.length} held back by a number clash`)}</Tag>}
            <Button disabled={!pending && !retry} onClick={() => system((c) => syncPlmIfChanged(c), L('已同步到平台', 'Synced to the platform'))}>
              {L('同步到平台', 'Sync to platform')}
            </Button>
            <Button type="primary" icon={<PlusOutlined />} disabled={!models.length} onClick={() => start(models[0]!)}>
              {L('新建整车版本', 'New version')}
            </Button>
          </Space>
        }
      />
      <Space orientation="vertical" size={16} style={{ width: '100%' }}>
        <Card title={L('整车集成版本与 BOM', 'Integration versions and their BOM')}>
          <Hint>
            {L(
              'PLM 把各模块的版本映射成一个整车集成版本号，DCL 件是其中一个模块。整车集成测试每一轮出一个测试版本，通过的那一轮以同号发布。模拟器自动运行时每一步都会同步；也可以手动同步。',
              'PLM maps every module’s version to one whole-vehicle version number; the DCL part is one of the modules. Every whole-vehicle integration test round gets a test version, and the passing one is released under the same number. The simulator syncs on every step when it runs; you can also sync by hand.',
            )}
          </Hint>
          <Table
            rowKey={(v) => `${v.vehicleModelId}::${v.version}`}
            size="small"
            pagination={false}
            scroll={{ x: 'max-content' }}
            dataSource={[...state.plm.versions].sort((a, b) => a.vehicleModelId.localeCompare(b.vehicleModelId) || compareVersions(b.version, a.version))}
            locale={{ emptyText: L('PLM 还没有发布整车版本', 'PLM has published no version yet') }}
            columns={[
              { title: L('整车版本', 'Version'), render: (_, v) => <Mono>{`${v.vehicleModelId} ${v.version}`}</Mono> },
              {
                title: 'BOM',
                render: (_, v) => (
                  <Space size={4} wrap>
                    {v.modules.map((m) => (
                      <Tag key={m.name}>{`${m.name} ${m.version}`}</Tag>
                    ))}
                    {v.dclPart ? (
                      <Tooltip title={`${L('配置摘要', 'Configuration digest')} ${v.dclPart.digest}`}>
                        <Tag color="blue">{`DCL ${partVersion(v.dclPart)}`}</Tag>
                      </Tooltip>
                    ) : (
                      <Tag>{L('无 DCL 件', 'no DCL part')}</Tag>
                    )}
                  </Space>
                ),
              },
              {
                title: L('阶段', 'Stage'),
                render: (_, v) => <Tag color={v.stage === 'TEST' ? 'purple' : 'green'}>{B(PLM_STAGE_LABELS[v.stage ?? 'RELEASED'])}</Tag>,
              },
              { title: L('出号时间', 'Issued'), render: (_, v) => when(v.publishedAt) },
              { title: L('发布时间', 'Released'), render: (_, v) => (v.releasedAt ? when(v.releasedAt) : '—') },
              {
                title: L('操作', 'Actions'),
                render: (_, v) =>
                  v.stage === 'TEST' ? (
                    <Button size="small" onClick={() => system((c) => releasePlmVersion(c, { vehicleModelId: v.vehicleModelId, version: v.version }), L(`PLM 已发布 ${v.version}（待同步到平台）`, `PLM released ${v.version} (to sync)`))}>
                      {L('测试通过，发布', 'Passed: release')}
                    </Button>
                  ) : null,
              },
            ]}
          />
        </Card>
        <Card title={L('收到的 DCL 件', 'DCL parts received')}>
          <Table
            rowKey={(r) => r.part.digest}
            size="small"
            pagination={false}
            scroll={{ x: 'max-content' }}
            dataSource={received}
            locale={{ emptyText: L('DCL 还没有交来 DCL 件', 'DCL has handed over no part yet') }}
            columns={[
              { title: L('DCL 件', 'DCL part'), render: (_, r) => <Mono>{`${r.model} · DCL ${partVersion(r.part)}`}</Mono> },
              { title: L('配置摘要', 'Digest'), render: (_, r) => <ShortId value={r.part.digest} size={16} /> },
              { title: L('交来时说明', 'Handed over for'), render: (_, r) => L(`工作名 ${r.workingName}`, `working name ${r.workingName}`) },
              { title: L('交付', 'Handed over'), render: (_, r) => `${state.accounts[r.part.deliveredBy!]?.displayName ?? r.part.deliveredBy} · ${when(r.part.deliveredAt)}` },
              { title: L('用于', 'Used in'), render: (_, r) => (r.usedIn.length ? r.usedIn.join(', ') : <Typography.Text type="secondary">{L('还未发布', 'not published yet')}</Typography.Text>) },
            ]}
          />
        </Card>
      </Space>
      <Modal
        open={form !== null}
        title={L('PLM 新建整车版本', 'PLM issues a version')}
        okText={form?.stage === 'TEST' ? L('出测试版本', 'Issue the test version') : L('发布', 'Publish')}
        onCancel={() => setForm(null)}
        onOk={publish}
      >
        {form && (
          <Space orientation="vertical" style={{ width: '100%' }}>
            <Radio.Group
              value={form.stage}
              onChange={(e) => setForm({ ...form, stage: e.target.value })}
              options={[
                { value: 'TEST', label: L('集成测试版本（每轮一个）', 'Integration test version (one per round)') },
                { value: 'RELEASED', label: L('直接发布', 'Publish at once') },
              ]}
              aria-label={L('阶段', 'Stage')}
            />
            <Typography.Text>{L('车型', 'Vehicle model')}</Typography.Text>
            <Select style={{ width: '100%' }} value={form.model} onChange={start} options={models.map((m) => ({ value: m, label: m }))} aria-label={L('车型', 'Vehicle model')} />
            <Typography.Text>{L('PLM 版本号', 'PLM version number')}</Typography.Text>
            <Input value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })} placeholder="1.2.0" aria-label={L('PLM 版本号', 'PLM version number')} />
            <Typography.Text>{L('BOM：各模块版本（默认取上一版本）', 'BOM: module versions (from the previous version)')}</Typography.Text>
            {form.modules.map((m, i) => (
              <Space key={i} wrap>
                <Input style={{ width: 120 }} value={m.name} onChange={(e) => setModule(i, 'name', e.target.value)} aria-label={L('模块', 'Module')} />
                <Input style={{ width: 120 }} value={m.version} onChange={(e) => setModule(i, 'version', e.target.value)} aria-label={L('版本', 'Version')} />
                <Button type="text" icon={<MinusCircleOutlined />} aria-label={L('删除模块', 'Remove the module')} onClick={() => setForm({ ...form, modules: form.modules.filter((_, j) => j !== i) })} />
              </Space>
            ))}
            <Button size="small" icon={<PlusOutlined />} onClick={() => setForm({ ...form, modules: [...form.modules, { name: '', version: '' }] })}>
              {L('添加模块', 'Add a module')}
            </Button>
            <Typography.Text>{L('BOM 中的 DCL 件', 'DCL part in the BOM')}</Typography.Text>
            <Select
              aria-label={L('BOM 中的 DCL 件', 'DCL part in the BOM')}
              style={{ width: '100%' }}
              value={form.part}
              onChange={(part) => setForm({ ...form, part })}
              options={[
                { value: NONE, label: L('不带 DCL 件', 'No DCL part') },
                ...[...choices.entries()].filter(([, c]) => c.model === form.model).map(([digest, c]) => ({ value: digest, label: c.label })),
                { value: UNKNOWN, label: L('平台不认识的 DCL 件（模拟错误）', 'A DCL part the platform does not know (simulated mistake)') },
              ]}
            />
          </Space>
        )}
      </Modal>
    </div>
  );
}
