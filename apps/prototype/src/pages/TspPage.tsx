// The simulated TSP (TSP（模拟）, prototype only): plays the company's record of each car — identity,
// model, plate, hardware configuration and the version it should run — so the platform has cars to
// register and sync. Nothing here is the platform's: what a car actually runs comes only from its
// own signed report.

import { MinusCircleOutlined, PlusOutlined } from '@ant-design/icons';
import { App, Button, Card, Input, Modal, Select, Space, Table, Tag, Typography } from 'antd';
import { useState } from 'react';
import { useErrorText } from '../app/hooks.ts';
import { engine, useEngineState } from '../app/store.ts';
import { Hint, Mono, PageHeader } from '../components/common.tsx';
import { HardwareTags } from '../components/tsp.tsx';
import type { Ctx } from '../engine/engine.ts';
import { addTspVehicle, syncTspIfChanged, updateTspVehicle } from '../engine/tsp.ts';
import { reportedSoftware } from '../engine/tsp-sync.ts';
import type { HardwareItem, TspVehicle } from '../engine/types.ts';
import { useI18n } from '../i18n/i18n.tsx';

type Editing = { kind: 'add' | 'edit'; vin: string; model: string; plate: string; expected: string; hardware: HardwareItem[] };

export function TspPage() {
  const state = useEngineState();
  const { L } = useI18n();
  const { message } = App.useApp();
  const errorText = useErrorText();
  const [form, setForm] = useState<Editing | null>(null);
  const pending = state.tsp.revision !== state.tspSync.revision;
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

  const registered = (vin: string) => Object.values(state.resources).find((r) => r.vin === vin);
  const save = () => {
    if (!form) return;
    const hardware = form.hardware.filter((h) => h.item.trim() || h.value.trim());
    const done =
      form.kind === 'add'
        ? system((c) => addTspVehicle(c, { vin: form.vin, vehicleModelId: form.model, licensePlate: form.plate, hardware, expectedVersion: form.expected }), L('TSP 已收录（待同步）', 'Added to TSP (to sync)'))
        : system((c) => updateTspVehicle(c, form.vin, { expectedVersion: form.expected, hardware }), L('TSP 记录已修改（待同步）', 'TSP record changed (to sync)'));
    if (done !== undefined) setForm(null);
  };
  const edit = (v: TspVehicle) => setForm({ kind: 'edit', vin: v.vin, model: v.vehicleModelId, plate: v.licensePlate ?? '', expected: v.expectedVersion ?? '', hardware: v.hardware.map((h) => ({ ...h })) });
  const setItem = (i: number, key: keyof HardwareItem, value: string) => form && setForm({ ...form, hardware: form.hardware.map((h, j) => (j === i ? { ...h, [key]: value } : h)) });

  return (
    <div className="kz-page">
      <div className="kz-sim-banner" style={{ padding: '10px 14px', borderRadius: 8, marginBottom: 16 }}>
        <Typography.Text strong>{L('模拟区 · 仅原型', 'Simulation zone · prototype only')}</Typography.Text>
        <Typography.Text>
          {' '}
          {L(
            '这里扮演公司的 TSP（车联网平台），不属于平台。车辆资源从 TSP 登记车辆；TSP 给出车辆应运行的版本，车辆实际运行什么只看车端签名上报。',
            'This plays the company’s TSP (telematics platform); it is not part of the platform. Vehicle resources register cars from TSP; TSP says which version a car should run, and only the car’s signed report says what it runs.',
          )}
        </Typography.Text>
      </div>
      <PageHeader
        title={L('TSP（模拟）', 'TSP (simulated)')}
        extra={
          <Space wrap>
            <Tag color={pending ? 'gold' : 'green'}>
              {pending ? L(`待同步：修订 ${state.tsp.revision}，平台已同步 ${state.tspSync.revision}`, `To sync: revision ${state.tsp.revision}, platform synced ${state.tspSync.revision}`) : L(`平台已同步修订 ${state.tsp.revision}`, `Platform synced revision ${state.tsp.revision}`)}
            </Tag>
            <Button disabled={!pending} onClick={() => system((c) => syncTspIfChanged(c), L('已同步到平台', 'Synced to the platform'))}>
              {L('同步到平台', 'Sync to platform')}
            </Button>
            <Button type="primary" icon={<PlusOutlined />} disabled={!models.length} onClick={() => setForm({ kind: 'add', vin: '', model: models[0]!, plate: '', expected: '', hardware: [{ item: '激光雷达', value: '有' }] })}>
              {L('新增车辆', 'Add a car')}
            </Button>
          </Space>
        }
      />
      <Card title={L('车辆', 'Cars')}>
        <Hint>
          {L(
            '应为版本是整车 OTA 最近一次给这辆车定的版本；车辆还没升级、或升级失败时，它与车端上报的实际版本不同。模拟整车 OTA 会同时更新这里。',
            'The expected version is what the vehicle OTA program last put the car on; it differs from the car’s reported version while the car has not updated, or when the update failed. A simulated vehicle OTA updates it too.',
          )}
        </Hint>
        <Table
          rowKey="vin"
          size="small"
          pagination={{ pageSize: 20, hideOnSinglePage: true }}
          scroll={{ x: 'max-content' }}
          dataSource={state.tsp.vehicles}
          locale={{ emptyText: L('TSP 里还没有车辆', 'TSP has no cars yet') }}
          columns={[
            { title: 'VIN', render: (_, v) => <Mono>{v.vin}</Mono> },
            { title: L('车型 / 车牌', 'Model / plate'), render: (_, v) => `${v.vehicleModelId} · ${v.licensePlate ?? '—'}` },
            { title: 'UVID / T-Box', render: (_, v) => <Typography.Text type="secondary">{`${v.uvid} · ${v.tboxId}`}</Typography.Text> },
            { title: L('硬件配置', 'Hardware'), render: (_, v) => (v.hardware.length ? <HardwareTags hardware={v.hardware} /> : '—') },
            { title: L('应为版本', 'Expected version'), render: (_, v) => v.expectedVersion ?? <Typography.Text type="secondary">{L('未记录', 'none')}</Typography.Text> },
            {
              title: L('平台', 'Platform'),
              render: (_, v) => {
                const r = registered(v.vin);
                const reported = r ? reportedSoftware(state, r) : null;
                return r ? (
                  <Space size={4} wrap>
                    <Mono>{r.id}</Mono>
                    <Typography.Text type="secondary">
                      {!reported
                        ? L('尚未上报', 'not reported yet')
                        : reported.partial
                          ? L('车端上报部分域控失败', 'reports a partial update')
                          : L(`车端上报 ${reported.version ?? '未知'}`, `reports ${reported.version ?? 'unknown'}`)}
                    </Typography.Text>
                  </Space>
                ) : (
                  <Typography.Text type="secondary">{L('未登记', 'not registered')}</Typography.Text>
                );
              },
            },
            {
              title: '',
              render: (_, v) => (
                <Button type="link" size="small" onClick={() => edit(v)}>
                  {L('修改', 'Change')}
                </Button>
              ),
            },
          ]}
        />
      </Card>
      <Modal open={form !== null} title={form?.kind === 'add' ? L('TSP 收录车辆', 'TSP adds a car') : L(`修改 TSP 记录 · ${form?.vin ?? ''}`, `Change the TSP record · ${form?.vin ?? ''}`)} okText={L('保存', 'Save')} onCancel={() => setForm(null)} onOk={save}>
        {form && (
          <Space orientation="vertical" style={{ width: '100%' }}>
            {form.kind === 'add' && (
              <>
                <Typography.Text>VIN</Typography.Text>
                <Input value={form.vin} onChange={(e) => setForm({ ...form, vin: e.target.value })} placeholder="LSDEM0X8900000008" aria-label="VIN" />
                <Typography.Text>{L('车型', 'Vehicle model')}</Typography.Text>
                <Select style={{ width: '100%' }} value={form.model} onChange={(model) => setForm({ ...form, model })} options={models.map((m) => ({ value: m, label: m }))} aria-label={L('车型', 'Vehicle model')} />
                <Typography.Text>{L('车牌', 'Plate')}</Typography.Text>
                <Input value={form.plate} onChange={(e) => setForm({ ...form, plate: e.target.value })} aria-label={L('车牌', 'Plate')} />
              </>
            )}
            <Typography.Text>{L('应为版本（可留空）', 'Expected version (may be blank)')}</Typography.Text>
            <Input value={form.expected} onChange={(e) => setForm({ ...form, expected: e.target.value })} placeholder="1.2.0" aria-label={L('应为版本', 'Expected version')} />
            <Typography.Text>{L('硬件配置', 'Hardware')}</Typography.Text>
            {form.hardware.map((h, i) => (
              <Space key={i} wrap>
                <Input style={{ width: 130 }} value={h.item} onChange={(e) => setItem(i, 'item', e.target.value)} placeholder={L('项目', 'Item')} aria-label={L('硬件项目', 'Hardware item')} />
                <Input style={{ width: 130 }} value={h.value} onChange={(e) => setItem(i, 'value', e.target.value)} placeholder={L('值', 'Value')} aria-label={L('硬件值', 'Hardware value')} />
                <Button type="text" icon={<MinusCircleOutlined />} aria-label={L('删除这一项', 'Remove the item')} onClick={() => setForm({ ...form, hardware: form.hardware.filter((_, j) => j !== i) })} />
              </Space>
            ))}
            <Button size="small" icon={<PlusOutlined />} onClick={() => setForm({ ...form, hardware: [...form.hardware, { item: '', value: '' }] })}>
              {L('添加硬件项', 'Add an item')}
            </Button>
          </Space>
        )}
      </Modal>
    </div>
  );
}
