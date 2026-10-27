// Chinese / English. Strings live next to their use as L('中文', 'English'); shared vocabulary
// (roles, stages, statuses, error codes) is in vocab.ts.

import { createContext, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

export type Lang = 'zh' | 'en';
const LANG_KEY = 'kairoz.lang';

export interface Bilingual {
  zh: string;
  en: string;
}

interface I18n {
  lang: Lang;
  setLang(lang: Lang): void;
  /** Picks the string for the current language. */
  L(zh: string, en: string): string;
  /** Picks from a bilingual label. */
  B(label: Bilingual | undefined, fallback?: string): string;
}

const Ctx = createContext<I18n | null>(null);

/** The language being rendered, for plain helpers (dates) that take no hook; the provider keeps it current. */
let active: Lang = 'zh';
export function currentLang(): Lang {
  return active;
}

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === 'zh' || saved === 'en') return saved;
  } catch {
    // ignore
  }
  return 'zh';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);
  active = lang;
  const value = useMemo<I18n>(
    () => ({
      lang,
      setLang(next) {
        setLangState(next);
        try {
          localStorage.setItem(LANG_KEY, next);
        } catch {
          // ignore
        }
        document.documentElement.lang = next === 'zh' ? 'zh-CN' : 'en';
      },
      L: (zh, en) => (lang === 'zh' ? zh : en),
      B: (label, fallback = '') => (label ? label[lang] : fallback),
    }),
    [lang],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18n {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useI18n outside I18nProvider');
  return ctx;
}
