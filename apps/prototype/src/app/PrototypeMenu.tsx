// Prototype tools: reset to demo / clean installation, export / import the whole state, and the
// vehicle simulator. These are not part of the product; they drive and inspect the prototype.

import { ExperimentOutlined } from '@ant-design/icons';
import { App, Badge, Button, Dropdown, Input, Modal } from 'antd';
import { useState } from 'react';
import { JsonExportModal, downloadJson } from '../components/JsonExport.tsx';
import type { JsonFile } from '../components/JsonExport.tsx';
import { useI18n } from '../i18n/i18n.tsx';
import { navigate } from './router.ts';
import { exportState, importState, resetPlatform, useEngineState } from './store.ts';

/** 2026-10-22T143005 in local time, for file names. */
function fileStamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function PrototypeMenu({ compact = false }: { compact?: boolean }) {
  const { L } = useI18n();
  const { modal, message } = App.useApp();
  const [importing, setImporting] = useState(false);
  const [json, setJson] = useState('');
  const [exported, setExported] = useState<JsonFile | null>(null);
  const state = useEngineState();
  // Demo data saved by an earlier version keeps working but lacks newer demo objects.
  const outdatedDemo = state.installation === 'DEMO' && !state.workspaces['x89-adc-integration'];

  const confirmReset = (kind: 'demo' | 'clean') =>
    modal.confirm({
      title: kind === 'demo' ? L('重置为演示数据？', 'Reset to demo data?') : L('重置为干净安装？', 'Reset to a clean installation?'),
      content: L('当前浏览器中的全部原型数据都会被替换。', 'All prototype data in this browser will be replaced.'),
      okText: L('重置', 'Reset'),
      okButtonProps: { danger: true },
      onOk: () => resetPlatform(kind),
    });

  const download = () => {
    const file = { name: `kairoz-state-${fileStamp(new Date())}.json`, json: exportState() };
    setExported(file);
    downloadJson(file);
  };

  return (
    <>
      <Dropdown
        menu={{
          items: [
            ...(outdatedDemo
              ? [
                  {
                    key: 'outdated',
                    label: L('演示数据来自旧版本：重置为演示数据后可看到子系统集成与车辆设备密钥', 'Demo data from an earlier version: reset to demo data to see subsystem integration and vehicle device keys'),
                    onClick: () => confirmReset('demo'),
                  },
                  { type: 'divider' as const },
                ]
              : []),
            { key: 'sim', label: L('车辆模拟器', 'Vehicle simulator'), onClick: () => navigate('simulator') },
            { key: 'guide', label: L('场景手册', 'Scenario guide'), onClick: () => navigate('guide') },
            { key: 'acceptance', label: L('流程验收（逐幕）', 'Acceptance replay'), onClick: () => navigate('acceptance') },
            { type: 'divider' },
            { key: 'demo', label: L('重置为演示数据', 'Reset to demo data'), onClick: () => confirmReset('demo') },
            { key: 'clean', label: L('重置为干净安装', 'Reset to clean installation'), onClick: () => confirmReset('clean') },
            { type: 'divider' },
            { key: 'export', label: L('导出状态 JSON', 'Export state JSON'), onClick: download },
            { key: 'import', label: L('导入状态 JSON', 'Import state JSON'), onClick: () => setImporting(true) },
          ],
        }}
      >
        <Badge dot={outdatedDemo}>
          <Button icon={<ExperimentOutlined />} type={compact ? 'text' : 'default'}>
            {L('原型工具', 'Prototype')}
          </Button>
        </Badge>
      </Dropdown>
      <Modal
        open={importing}
        title={L('导入状态', 'Import state')}
        onCancel={() => setImporting(false)}
        onOk={() => {
          try {
            importState(json);
            setImporting(false);
            message.success(L('已导入', 'Imported'));
          } catch (e) {
            message.error(String(e));
          }
        }}
      >
        <Input.TextArea rows={10} value={json} onChange={(e) => setJson(e.target.value)} placeholder="{ ... }" />
      </Modal>
      <JsonExportModal title={L('导出状态 JSON', 'Export state JSON')} file={exported} onClose={() => setExported(null)} />
    </>
  );
}
