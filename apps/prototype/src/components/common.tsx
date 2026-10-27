import { Button, Flex, Tag, Tooltip, Typography } from 'antd';
import { useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { useActor, useCanOpen } from '../app/hooks.ts';
import { navigate } from '../app/router.ts';
import { useEngineState } from '../app/store.ts';
import { canReadFeature } from '../engine/config.ts';
import { currentLang, useI18n } from '../i18n/i18n.tsx';
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

/** A record known by its number (#3), its id on hover. */
export function Numbered({ n, id }: { n: number; id: string }) {
  return (
    <Tooltip title={<span className="kz-mono">{id}</span>}>
      <Typography.Text className="kz-mono">#{n}</Typography.Text>
    </Tooltip>
  );
}

/** A shortened id/digest with the full value on hover. */
export function ShortId({ value, size = 14, copy = false }: { value: string | null | undefined; size?: number; copy?: boolean }) {
  if (!value) return <Typography.Text type="secondary">—</Typography.Text>;
  const short = value.length > size ? `${value.slice(0, size)}…` : value;
  return (
    // Copying inside a clickable row must not open the row.
    <span onClick={copy ? (e) => e.stopPropagation() : undefined}>
      <Tooltip title={<span className="kz-mono">{value}</span>}>
        <Typography.Text className="kz-mono" copyable={copy ? { text: value } : false}>
          {short}
        </Typography.Text>
      </Tooltip>
    </span>
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

// Page explanations can be collapsed for people who know the platform (a choice kept in this browser).
const HINTS_KEY = 'kairoz.hints';
let hintsHidden = (() => {
  try {
    return localStorage.getItem(HINTS_KEY) === 'hidden';
  } catch {
    return false;
  }
})();
const hintListeners = new Set<() => void>();
export function setHintsHidden(hidden: boolean): void {
  hintsHidden = hidden;
  try {
    localStorage.setItem(HINTS_KEY, hidden ? 'hidden' : 'shown');
  } catch {
    // Not kept; it still applies until the page closes.
  }
  for (const l of hintListeners) l();
}
export function useHintsHidden(): boolean {
  return useSyncExternalStore(
    (l) => (hintListeners.add(l), () => void hintListeners.delete(l)),
    () => hintsHidden,
  );
}

/** A page's explanation: shown, or (when collapsed) a small button that opens it here. */
export function Hint({ children }: { children: ReactNode }) {
  const hidden = useHintsHidden();
  const [open, setOpen] = useState(false);
  const { L } = useI18n();
  if (hidden && !open) {
    return (
      <Button type="link" size="small" style={{ padding: 0, marginBottom: 8 }} onClick={() => setOpen(true)}>
        ⓘ {L('说明', 'About this')}
      </Button>
    );
  }
  return (
    <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
      {children}
    </Typography.Paragraph>
  );
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');

/** A moment in the interface language, local time: 2026-10-27 14:30 / 27 Oct 2026, 14:30. */
export function when(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return currentLang() === 'zh' ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${time}` : `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${time}`;
}

/** A calendar day (YYYY-MM-DD, e.g. a due date) in the interface language: 2026-11-03 / 3 Nov 2026. */
export function day(date: string | null | undefined): string {
  if (!date) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m || currentLang() === 'zh') return date;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
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

/**
 * A Feature's name, linked to it only for accounts that can read it here: integration, release
 * and testing collect fixed commits and do not read other teams' Features.
 */
export function FeatureName({ featureId, tab }: { featureId: string; tab?: string }) {
  const state = useEngineState();
  const actor = useActor();
  const canOpen = useCanOpen();
  const { L } = useI18n();
  const f = state.features[featureId];
  if (!f) return <Mono>{featureId}</Mono>;
  if (actor && canOpen('features') && canReadFeature(state, actor, f)) {
    return (
      <Typography.Link onClick={() => navigate(`features/${f.id}${tab ? `/${tab}` : ''}`)}>
        <Mono>{f.name}</Mono>
      </Typography.Link>
    );
  }
  return (
    <Tooltip title={L('只有本组与 DCL 能打开 Feature；这里看到的是固定的提交。', 'Only the group and DCL open the Feature; this is its fixed commit.')}>
      <span>
        <Mono>{f.name}</Mono>
      </span>
    </Tooltip>
  );
}
