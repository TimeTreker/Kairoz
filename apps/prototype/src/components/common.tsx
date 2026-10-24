import { Flex, Tag, Tooltip, Typography } from 'antd';
import type { ReactNode } from 'react';
import { useI18n } from '../i18n/i18n.tsx';
import type { Bilingual } from '../i18n/i18n.tsx';
import type { State } from '../engine/types.ts';
import { ENV_LABELS, ROLE_LABELS, STAGE_COLORS, STAGE_LABELS, setName } from '../i18n/vocab.ts';

export function PageHeader({ title, subtitle, extra }: { title: string; subtitle?: string; extra?: ReactNode }) {
  return (
    <Flex justify="space-between" align="flex-start" gap={16} wrap style={{ marginBottom: 16 }}>
      <div>
        <Typography.Title level={3} style={{ margin: 0 }}>
          {title}
        </Typography.Title>
        {subtitle && <Typography.Text type="secondary">{subtitle}</Typography.Text>}
      </div>
      {extra}
    </Flex>
  );
}

export function Mono({ children, copy = false }: { children: ReactNode; copy?: boolean }) {
  return (
    <Typography.Text className="kz-mono" copyable={copy ? { text: String(children) } : false}>
      {children}
    </Typography.Text>
  );
}

/** A shortened id/digest with the full value on hover. */
export function ShortId({ value, size = 14 }: { value: string | null | undefined; size?: number }) {
  if (!value) return <Typography.Text type="secondary">—</Typography.Text>;
  const short = value.length > size ? `${value.slice(0, size)}…` : value;
  return (
    <Tooltip title={<span className="kz-mono">{value}</span>}>
      <Typography.Text className="kz-mono">{short}</Typography.Text>
    </Tooltip>
  );
}

export function LabelTag({ map, value, color }: { map: Record<string, Bilingual>; value: string; color?: string }) {
  const { B } = useI18n();
  return <Tag color={color}>{B(map[value], value)}</Tag>;
}

export function StageTag({ stage }: { stage: string }) {
  return <LabelTag map={STAGE_LABELS} value={stage} color={STAGE_COLORS[stage]} />;
}

export function EnvTag({ env }: { env: string }) {
  const color = env === 'production' ? 'red' : env === 'testing' ? 'gold' : 'geekblue';
  return <LabelTag map={ENV_LABELS} value={env} color={color} />;
}

export function RoleTag({ role }: { role: string }) {
  return <LabelTag map={ROLE_LABELS} value={role} />;
}

export function Hint({ children }: { children: ReactNode }) {
  return (
    <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
      {children}
    </Typography.Paragraph>
  );
}

export function when(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

/** How a configuration is named: a policy set by its version, anything else by its label. */
export function configName(s: State, id: string | null | undefined): Bilingual {
  if (!id) return { zh: '—', en: '—' };
  const c = s.resolvedConfigs[id];
  if (!c) return { zh: id, en: id };
  const release = c.kind === 'RELEASE' ? s.releases[c.sourceId] : undefined;
  if (release) return setName(release.dclVersion);
  // A personal configuration names the Feature's draft, not a commit.
  return c.kind === 'PERSONAL' ? { zh: c.label.replace(/ \/ draft/, ' / 草稿'), en: c.label } : { zh: c.label, en: c.label };
}
