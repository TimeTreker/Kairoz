// Prototype tools: reset to demo / clean installation, export / import the whole state, and the
// vehicle simulator. These are not part of the product; they drive and inspect the prototype.

import { ExperimentOutlined } from '@ant-design/icons';
import { App, Button, Dropdown, Input, Modal } from 'antd';
import { useState } from 'react';
import { useI18n } from '../i18n/i18n.tsx';
import { navigate } from './router.ts';
import { exportState, importState, resetPlatform } from './store.ts';

export function PrototypeMenu({ compact = false }: { compact?: boolean }) {
  const { L } = useI18n();
  const { modal, message } = App.useApp();
  const [importing, setImporting] = useState(false);
  const [json, setJson] = useState('');

  const confirmReset = (kind: 'demo' | 'clean') =>
    modal.confirm({
      title: kind === 'demo' ? L('重置为演示数据？', 'Reset to demo data?') : L('重置为干净安装？', 'Reset to a clean installation?'),
      content: L('当前浏览器中的全部原型数据都会被替换。', 'All prototype data in this browser will be replaced.'),
      okText: L('重置', 'Reset'),
      okButtonProps: { danger: true },
      onOk: () => resetPlatform(kind),
    });

  const download = () => {
    const blob = new Blob([exportState()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `kairoz-state-${new Date().toISOString().slice(0, 19).replaceAll(':', '')}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <>
      <Dropdown
        menu={{
          items: [
            { key: 'sim', label: L('车辆模拟器', 'Vehicle simulator'), onClick: () => navigate('simulator') },
            { key: 'guide', label: L('场景手册', 'Scenario guide'), onClick: () => navigate('guide') },
            { type: 'divider' },
            { key: 'demo', label: L('重置为演示数据', 'Reset to demo data'), onClick: () => confirmReset('demo') },
            { key: 'clean', label: L('重置为干净安装', 'Reset to clean installation'), onClick: () => confirmReset('clean') },
            { type: 'divider' },
            { key: 'export', label: L('导出状态 JSON', 'Export state JSON'), onClick: download },
            { key: 'import', label: L('导入状态 JSON', 'Import state JSON'), onClick: () => setImporting(true) },
          ],
        }}
      >
        <Button icon={<ExperimentOutlined />} type={compact ? 'text' : 'default'}>
          {L('原型工具', 'Prototype')}
        </Button>
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
    </>
  );
}
