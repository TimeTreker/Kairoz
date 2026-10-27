// A banner for problems with this browser's saved platform: saving failed, or a saved state could
// not be read and the demo was loaded instead (the unread state is kept and can be copied out).

import { Alert, Button } from 'antd';
import { useState } from 'react';
import { JsonExportModal, downloadJson } from '../components/JsonExport.tsx';
import type { JsonFile } from '../components/JsonExport.tsx';
import { useI18n } from '../i18n/i18n.tsx';
import { dismissStorageProblem, useStorageProblem } from './store.ts';

export function StorageBanner() {
  const problem = useStorageProblem();
  const { L } = useI18n();
  const [file, setFile] = useState<JsonFile | null>(null);
  if (!problem) return null;
  if (problem.kind === 'SAVE_FAILED') {
    return (
      <Alert
        type="error"
        banner
        title={L('浏览器存储不可用或已满：修改只保留到关闭页面为止。请用“原型工具 → 导出状态 JSON”备份。', 'Browser storage is unavailable or full: changes last only until the page is closed. Back them up with Prototype → Export state JSON.')}
      />
    );
  }
  const why = {
    NOT_STATE: L('不是 Kairoz 的状态', 'it is not a Kairoz state'),
    TOO_OLD: L('来自过早的版本', 'it comes from a version too old to read'),
    NEWER: L('来自更新版本的 Kairoz', 'it comes from a newer version of Kairoz'),
    DAMAGED: L('数据已损坏', 'it is damaged'),
  }[problem.reason];
  return (
    <>
      <Alert
        type="warning"
        banner
        closable={{ onClose: dismissStorageProblem }}
        title={L(`本浏览器保存的数据无法读取（${why}），已载入演示数据。原数据另外保留，没有丢失。`, `The data saved in this browser could not be read (${why}), so the demo was loaded. The saved data is kept aside, not lost.`)}
        action={
          <Button
            size="small"
            onClick={() => {
              const f = { name: 'kairoz-state-unread.json', json: problem.raw };
              setFile(f);
              downloadJson(f);
            }}
          >
            {L('查看原数据', 'See the saved data')}
          </Button>
        }
      />
      <JsonExportModal title={L('无法读取的原数据', 'The saved data that could not be read')} file={file} onClose={() => setFile(null)} />
    </>
  );
}
