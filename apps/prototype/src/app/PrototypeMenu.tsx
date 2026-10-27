// Prototype tools: reset to demo / clean installation, export / import the whole state, and the
// vehicle simulator. These are not part of the product; they drive and inspect the prototype.

import { ExperimentOutlined } from '@ant-design/icons';
import { App, Badge, Button, Dropdown, Input, Modal, Space } from 'antd';
import { useState } from 'react';
import { JsonExportModal, downloadJson } from '../components/JsonExport.tsx';
import type { JsonFile } from '../components/JsonExport.tsx';
import { useI18n } from '../i18n/i18n.tsx';
import { navigate } from './router.ts';
import { when } from '../components/common.tsx';
import { exportState, importState, readStateText, resetPlatform, useEngineState } from './store.ts';

/** 2026-10-22T143005 in local time, for file names. */
function fileStamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function PrototypeMenu({ compact = false }: { compact?: boolean }) {
  const { L } = useI18n();
  const PROBLEM_TEXT: Record<string, string> = {
    JSON: L('不是有效的 JSON。', 'This is not valid JSON.'),
    NOT_STATE: L('这不是 Kairoz 导出的状态。', 'This is not a state exported from Kairoz.'),
    TOO_OLD: L('状态来自过早的版本，无法读取。', 'The state comes from a version too old to read.'),
    NEWER: L('状态来自更新版本的 Kairoz，这个版本读不了。', 'The state comes from a newer version of Kairoz that this one cannot read.'),
  };
  const { modal, message } = App.useApp();
  const [importing, setImporting] = useState(false);
  const [json, setJson] = useState('');
  const [exported, setExported] = useState<JsonFile | null>(null);
  const state = useEngineState();
  // Demo data saved by an earlier version keeps working but lacks newer demo objects.
  const outdatedDemo = state.installation === 'DEMO' && (!state.workspaces['x89-adc-integration'] || !state.directory);

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
                    label: L('演示数据来自旧版本：重置为演示数据后可看到公司目录、软件清单等新的演示内容', 'Demo data from an earlier version: reset to demo data to see the company directory, software manifests and other new demo content'),
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
        okText={L('导入…', 'Import…')}
        okButtonProps={{ disabled: !json.trim() }}
        onCancel={() => (setImporting(false), setJson(''))}
        onOk={() => {
          const read = readStateText(json);
          if ('problem' in read) {
            message.error(PROBLEM_TEXT[read.problem]);
            return;
          }
          const s = read.state;
          const last = s.audit.at(-1)?.at;
          modal.confirm({
            title: L('用导入的状态替换本浏览器的全部原型数据？', 'Replace all prototype data in this browser with the imported state?'),
            content: (
              <div>
                <div>{s.installation === 'DEMO' ? L('演示数据', 'Demo data') : L('干净安装', 'Clean installation')}</div>
                <div>{L(`${Object.keys(s.accounts).length} 个账号 · ${Object.keys(s.workspaces).length} 个工作区 · ${Object.keys(s.features).length} 个 Feature`, `${Object.keys(s.accounts).length} accounts · ${Object.keys(s.workspaces).length} workspaces · ${Object.keys(s.features).length} Features`)}</div>
                {last && <div>{L(`最后一次操作：${when(last)}`, `Last change: ${when(last)}`)}</div>}
                <div>{L('导入后所有人需要重新选择账号。', 'Everyone signs in again afterwards.')}</div>
              </div>
            ),
            okText: L('替换', 'Replace'),
            okButtonProps: { danger: true },
            onOk: () => {
              importState(s);
              setImporting(false);
              setJson('');
              message.success(L('已导入', 'Imported'));
            },
          });
        }}
      >
        <Space orientation="vertical" style={{ width: '100%' }}>
          <input
            type="file"
            accept=".json,application/json"
            aria-label={L('选择导出的状态文件', 'Choose an exported state file')}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void file.text().then(setJson);
            }}
          />
          <Input.TextArea rows={8} value={json} onChange={(e) => setJson(e.target.value)} placeholder={L('选择文件，或粘贴“导出状态 JSON”得到的内容', 'Choose a file, or paste what “Export state JSON” gave you')} />
        </Space>
      </Modal>
      <JsonExportModal title={L('导出状态 JSON', 'Export state JSON')} file={exported} onClose={() => setExported(null)} />
    </>
  );
}
