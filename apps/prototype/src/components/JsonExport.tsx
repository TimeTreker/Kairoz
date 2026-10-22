// JSON exports download a file and also show the JSON to copy: the hosted artifact page blocks
// downloads, so the copy is the way out there.

import { App, Button, Input, Modal } from 'antd';
import type { GetRef } from 'antd';
import { useRef } from 'react';
import { useI18n } from '../i18n/i18n.tsx';
import { Hint } from './common.tsx';

export interface JsonFile {
  name: string;
  json: string;
}

export function downloadJson(file: JsonFile): void {
  const url = URL.createObjectURL(new Blob([file.json], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.click();
  URL.revokeObjectURL(url);
}

/** The exported JSON, read-only, with a copy button. */
export function JsonExportModal({ title, file, onClose }: { title: string; file: JsonFile | null; onClose: () => void }) {
  const { L } = useI18n();
  const { message } = App.useApp();
  const text = useRef<GetRef<typeof Input.TextArea>>(null);

  const copy = () => {
    // Where the clipboard is blocked, select everything so the user can copy by hand.
    const selectAll = () => {
      text.current?.focus({ cursor: 'all' });
      let copied = false;
      try {
        copied = document.execCommand('copy');
      } catch {
        // no copy command here: the selection stays for the user
      }
      if (copied) message.success(L('已复制', 'Copied'));
      else message.info(L('已全选，请按 Ctrl+C（Mac 上 ⌘C）复制', 'Selected; press Ctrl+C (⌘C on a Mac) to copy'));
    };
    if (!file) return;
    if (!navigator.clipboard?.writeText) return selectAll();
    navigator.clipboard.writeText(file.json).then(() => message.success(L('已复制', 'Copied')), selectAll);
  };

  return (
    <Modal
      open={file !== null}
      title={title}
      width={760}
      onCancel={onClose}
      footer={[
        <Button key="close" onClick={onClose}>
          {L('关闭', 'Close')}
        </Button>,
        <Button key="copy" type="primary" onClick={copy}>
          {L('复制', 'Copy')}
        </Button>,
      ]}
    >
      <Hint>
        {L(
          `已开始下载 ${file?.name ?? ''}。如果页面拦截了下载（例如托管的原型页面），请复制下面的 JSON 自行保存。`,
          `Downloading ${file?.name ?? ''}. If the page blocks downloads (as the hosted prototype does), copy the JSON below and save it yourself.`,
        )}
      </Hint>
      <Input.TextArea ref={text} readOnly rows={16} value={file?.json ?? ''} className="kz-mono" />
    </Modal>
  );
}
