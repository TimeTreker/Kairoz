import { Empty, Space, Tag, Typography } from 'antd';
import type { ConfigDiff } from '../domain/config.ts';
import { useI18n } from '../i18n/i18n.tsx';

/** Added / removed / changed files, references and policies of a configuration change. */
export function DiffView({ diff, nameOf }: { diff: ConfigDiff; nameOf: (key: string) => string }) {
  const { L } = useI18n();
  if (diff.empty) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={L('没有变化', 'No changes')} />;
  const sections = [
    { key: 'files', title: L('文件', 'Files'), d: diff.files, name: nameOf },
    { key: 'references', title: L('引用', 'References'), d: diff.references, name: nameOf },
    { key: 'policies', title: L('策略', 'Policies'), d: diff.policies, name: (k: string) => k },
  ].filter((s) => s.d.added.length || s.d.removed.length || s.d.changed.length);
  return (
    <Space orientation="vertical" style={{ width: '100%' }}>
      {sections.map((s) => (
        <div key={s.key}>
          <Typography.Text strong>{s.title}</Typography.Text>
          <div style={{ marginTop: 4 }}>
            {s.d.added.map((k) => (
              <Tag key={`a-${k}`} color="green">
                + {s.name(k)}
              </Tag>
            ))}
            {s.d.removed.map((k) => (
              <Tag key={`r-${k}`} color="red">
                − {s.name(k)}
              </Tag>
            ))}
            {s.d.changed.map((c) => (
              <Tag key={`c-${c.key}`} color="blue">
                ~ {s.name(c.key)}: {c.fields.join(', ')}
              </Tag>
            ))}
          </div>
        </div>
      ))}
    </Space>
  );
}
