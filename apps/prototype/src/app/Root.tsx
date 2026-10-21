import { App as AntApp, ConfigProvider, theme } from 'antd';
import enUS from 'antd/locale/en_US';
import zhCN from 'antd/locale/zh_CN';
import { I18nProvider, useI18n } from '../i18n/i18n.tsx';
import { LoginPage } from '../pages/LoginPage.tsx';
import { useActor } from './hooks.ts';
import { Shell } from './Shell.tsx';

function Themed() {
  const { lang } = useI18n();
  const actor = useActor();
  return (
    <ConfigProvider
      locale={lang === 'zh' ? zhCN : enUS}
      theme={{ algorithm: theme.defaultAlgorithm, token: { colorPrimary: '#2865e8', borderRadius: 8 } }}
    >
      <AntApp>{actor ? <Shell /> : <LoginPage />}</AntApp>
    </ConfigProvider>
  );
}

export function Root() {
  return (
    <I18nProvider>
      <Themed />
    </I18nProvider>
  );
}
