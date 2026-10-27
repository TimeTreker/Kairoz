import {
  ApartmentOutlined,
  AuditOutlined,
  BranchesOutlined,
  CarOutlined,
  ClusterOutlined,
  DashboardOutlined,
  DatabaseOutlined,
  DeploymentUnitOutlined,
  FileSearchOutlined,
  FlagOutlined,
  ReadOutlined,
  RocketOutlined,
  SafetyCertificateOutlined,
  TeamOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { Avatar, Breadcrumb, Button, Dropdown, Layout, Menu, Result, Segmented, Select, Space, Spin, Tag } from 'antd';
import { Suspense, lazy, useEffect, useState } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { canOpenPage } from '../domain/authz.ts';
import { unitPath } from '../engine/org.ts';
import { useI18n } from '../i18n/i18n.tsx';
import { ROLE_LABELS, WORKSPACE_KIND_LABELS } from '../i18n/vocab.ts';
import { NotificationBell } from '../components/notifications.tsx';
import { useActor, useCanOpen, useWorkspace } from './hooks.ts';
import { PrototypeMenu } from './PrototypeMenu.tsx';
import { navigate, useRoute } from './router.ts';
import { setSession, useEngineState } from './store.ts';

/**
 * A page in its own chunk: it loads the first time it renders, or earlier through `preload`. Once
 * loaded it renders directly: route changes render synchronously, and even an instant suspension
 * would show the fallback and hold the page back for React's reveal throttle. Each mount keeps the
 * component it started with, so a page never remounts (and loses its state) when the code arrives.
 */
function lazyPage<P extends object>(load: () => Promise<ComponentType<P>>) {
  let loaded: ComponentType<P> | null = null;
  const fetchPage = () => load().then((component) => (loaded = component));
  const Lazy = lazy(() =>
    fetchPage().then(
      (component) => ({ default: component }),
      () => ({ default: PageLoadFailed }),
    ),
  );
  function Page(props: P) {
    const [Shown] = useState<ComponentType<P>>(() => loaded ?? Lazy);
    return <Shown {...props} />;
  }
  // A failed preload is retried when the page opens.
  return Object.assign(Page, { preload: () => void fetchPage().catch(() => {}) });
}

/** A page whose code could not be fetched: the network dropped, or the app was republished since this tab opened. */
function PageLoadFailed() {
  const { L } = useI18n();
  return (
    <div className="kz-page">
      <Result
        status="warning"
        title={L('页面未能加载', 'This page could not be loaded')}
        subTitle={L('网络中断，或应用已更新。重新加载即可，原型数据不受影响。', 'The network dropped, or the app was updated. Reload; your prototype data is kept.')}
        extra={
          <Button type="primary" onClick={() => window.location.reload()}>
            {L('重新加载', 'Reload')}
          </Button>
        }
      />
    </div>
  );
}

// Signing in needs only the shell; each page's code arrives when it opens.
const WorkbenchPage = lazyPage(() => import('../pages/WorkbenchPage.tsx').then((m) => m.WorkbenchPage));
const FeaturesPage = lazyPage(() => import('../pages/FeaturesPage.tsx').then((m) => m.FeaturesPage));
const FeatureDetailPage = lazyPage(() => import('../pages/FeatureDetailPage.tsx').then((m) => m.FeatureDetailPage));
const DataCatalogPage = lazyPage(() => import('../pages/DataCatalogPage.tsx').then((m) => m.DataCatalogPage));
const IntakePage = lazyPage(() => import('../pages/IntakePage.tsx').then((m) => m.IntakePage));
const ProcessingPage = lazyPage(() => import('../pages/ProcessingPage.tsx').then((m) => m.ProcessingPage));
const FleetPage = lazyPage(() => import('../pages/FleetPage.tsx').then((m) => m.FleetPage));
const IntegrationPage = lazyPage(() => import('../pages/IntegrationPage.tsx').then((m) => m.IntegrationPage));
const ReleasePage = lazyPage(() => import('../pages/ReleasePage.tsx').then((m) => m.ReleasePage));
const VersionsPage = lazyPage(() => import('../pages/VersionsPage.tsx').then((m) => m.VersionsPage));
const QueryPage = lazyPage(() => import('../pages/QueryPage.tsx').then((m) => m.QueryPage));
const SimulatorPage = lazyPage(() => import('../pages/SimulatorPage.tsx').then((m) => m.SimulatorPage));
const OrgPage = lazyPage(() => import('../pages/OrgPage.tsx').then((m) => m.OrgPage));
const AccountsPage = lazyPage(() => import('../pages/AccountsPage.tsx').then((m) => m.AccountsPage));
const AuditPage = lazyPage(() => import('../pages/AuditPage.tsx').then((m) => m.AuditPage));
const GuidePage = lazyPage(() => import('../pages/GuidePage.tsx').then((m) => m.GuidePage));
const NotificationsPage = lazyPage(() => import('../pages/NotificationsPage.tsx').then((m) => m.NotificationsPage));
const AcceptancePage = lazyPage(() => import('../pages/AcceptancePage.tsx').then((m) => m.AcceptancePage));

/** Fetched once the shell is up, so switching pages during a demo never waits on the network. */
const PAGES = [
  WorkbenchPage, FeaturesPage, FeatureDetailPage, DataCatalogPage, IntakePage, ProcessingPage, FleetPage, IntegrationPage,
  ReleasePage, VersionsPage, QueryPage, SimulatorPage, OrgPage, AccountsPage, AuditPage, GuidePage, NotificationsPage, AcceptancePage,
];

interface NavItem {
  key: string;
  icon: ReactNode;
  zh: string;
  en: string;
}

/** Menu entries; who sees each one is `PAGE_ACCESS` in the authorization rules. */
const NAV: NavItem[] = [
  { key: 'workbench', icon: <DashboardOutlined />, zh: '工作台', en: 'Workbench' },
  { key: 'features', icon: <BranchesOutlined />, zh: '研发 Feature', en: 'Features' },
  { key: 'data', icon: <DatabaseOutlined />, zh: '数据目录与引用', en: 'Data & references' },
  { key: 'intake', icon: <SafetyCertificateOutlined />, zh: 'DCL 接入队列', en: 'DCL intake' },
  { key: 'processing', icon: <DeploymentUnitOutlined />, zh: '处理目录', en: 'Processing catalog' },
  { key: 'fleet', icon: <CarOutlined />, zh: '车辆与车辆组', en: 'Vehicles & groups' },
  { key: 'integration', icon: <ClusterOutlined />, zh: '配置集成', en: 'Integration' },
  { key: 'versions', icon: <FlagOutlined />, zh: '集成版本', en: 'Integration versions' },
  { key: 'release', icon: <RocketOutlined />, zh: '发布与配置 OTA', en: 'Release & OTA' },
  { key: 'query', icon: <FileSearchOutlined />, zh: '数据查询', en: 'Data query' },
  { key: 'org', icon: <ApartmentOutlined />, zh: '组织与工作区', en: 'Organization' },
  { key: 'accounts', icon: <TeamOutlined />, zh: '账号与授权', en: 'Accounts & grants' },
  { key: 'audit', icon: <AuditOutlined />, zh: '审计日志', en: 'Audit log' },
];

/** What a link to a page the actor cannot open shows, with the workspaces where it would open. */
function NoAccess({ page }: { page: string }) {
  const state = useEngineState();
  const actor = useActor()!;
  const { L } = useI18n();
  const { access } = useWorkspace();
  const elsewhere = access.filter((a) => canOpenPage(actor.grants, page, a.workspaceId));
  return (
    <div className="kz-page">
      <Result
        status="403"
        title={L('无权访问此页面', 'No access to this page')}
        subTitle={
          elsewhere.length
            ? L('当前工作区的授权不包含此页面。可以切换到下列工作区打开：', 'Your grants do not open this page in this workspace. It opens in:')
            : L('当前账号没有打开此页面所需的授权。', 'This account holds no grant that opens this page.')
        }
        extra={[
          ...elsewhere.map((a) => (
            <Button key={a.workspaceId} onClick={() => setSession({ workspaceId: a.workspaceId })}>
              {state.workspaces[a.workspaceId]!.name}
            </Button>
          )),
          <Button key="workbench" type="primary" onClick={() => navigate('workbench')}>
            {L('返回工作台', 'Back to the workbench')}
          </Button>,
        ]}
      />
    </div>
  );
}

export function Shell() {
  const state = useEngineState();
  const actor = useActor()!;
  const { L, B, lang, setLang } = useI18n();
  const { access, workspace, roles } = useWorkspace();
  const canOpen = useCanOpen();
  const route = useRoute();
  const page = route[0] ?? 'workbench';

  useEffect(() => {
    const t = setTimeout(() => PAGES.forEach((p) => p.preload()), 1000);
    return () => clearTimeout(t);
  }, []);

  const allRoles = new Set(actor.grants.map((g) => g.role));
  const nav = NAV.filter((n) => canOpen(n.key));

  const path = workspace ? unitPath(state, workspace.orgUnitId) : [];
  const options = (['TEAM', 'PROJECT', 'INTEGRATION'] as const)
    .map((kind) => ({
      label: B(WORKSPACE_KIND_LABELS[kind]),
      options: access
        .filter((a) => state.workspaces[a.workspaceId]!.kind === kind)
        .map((a) => ({ value: a.workspaceId, label: state.workspaces[a.workspaceId]!.name })),
    }))
    .filter((g) => g.options.length > 0);

  let content: ReactNode;
  if (!canOpen(page)) content = <NoAccess page={page} />;
  else if (page === 'features' && route[1]) content = <FeatureDetailPage featureId={route[1]} />;
  else if (page === 'integration') content = <IntegrationPage key={workspace?.id} candidateId={route[1]} />;
  else
    content = {
      workbench: <WorkbenchPage />,
      features: <FeaturesPage />,
      data: <DataCatalogPage />,
      intake: <IntakePage />,
      processing: <ProcessingPage tab={route[1]} />,
      fleet: <FleetPage key={workspace?.id} tab={route[1]} />,
      release: <ReleasePage key={workspace?.id} tab={route[1]} />,
      versions: <VersionsPage key={workspace?.id} tab={route[1]} id={route[2]} sub={route[3]} />,
      query: <QueryPage key={workspace?.id} tab={route[1]} />,
      simulator: <SimulatorPage />,
      org: <OrgPage />,
      accounts: <AccountsPage />,
      audit: <AuditPage />,
      guide: <GuidePage />,
      notifications: <NotificationsPage />,
      acceptance: <AcceptancePage />,
    }[page] ?? <WorkbenchPage />;

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Layout.Sider width={232} breakpoint="lg" collapsedWidth={0} style={{ background: 'var(--kz-nav)' }}>
        <div className="kz-brand">
          <span className="kz-brand-mark">K</span>
          <span>Kairoz</span>
        </div>
        <Menu
          theme="dark"
          mode="inline"
          style={{ background: 'transparent' }}
          selectedKeys={[page]}
          onClick={(e) => navigate(e.key)}
          items={nav.map((n) => ({ key: n.key, icon: n.icon, label: L(n.zh, n.en) }))}
        />
      </Layout.Sider>
      <Layout>
        <Layout.Header className="kz-header">
          <Select
            className="kz-header-workspace"
            value={workspace?.id}
            placeholder={L('没有可用工作区', 'No workspace available')}
            options={options}
            onChange={(v) => setSession({ workspaceId: v })}
          />
          {workspace && <Tag className="kz-header-kind">{B(WORKSPACE_KIND_LABELS[workspace.kind])}</Tag>}
          <div className="kz-header-tools">
            <Segmented size="small" value={lang} onChange={(v) => setLang(v as 'zh' | 'en')} options={[{ label: '中', value: 'zh' }, { label: 'EN', value: 'en' }]} />
            <PrototypeMenu compact />
            {workspace && <NotificationBell />}
            <Dropdown
              menu={{
                items: [
                  {
                    key: 'roles',
                    type: 'group',
                    label: L('当前工作区的角色', 'Roles in this workspace'),
                    children: (roles.length ? roles : [...allRoles]).map((r) => ({ key: r, label: B(ROLE_LABELS[r]), disabled: true })),
                  },
                  { type: 'divider' },
                  { key: 'switch', label: L('切换账号', 'Switch account'), onClick: () => setSession({ username: null, workspaceId: null }) },
                ],
              }}
            >
              <Space style={{ cursor: 'pointer' }}>
                <Avatar size="small" icon={<UserOutlined />} />
                <span className="kz-header-name">{actor.displayName}</span>
              </Space>
            </Dropdown>
          </div>
        </Layout.Header>
        <Layout.Content>
          {workspace && !['org', 'accounts', 'audit', 'guide', 'simulator', 'acceptance'].includes(page) && (
            <div style={{ padding: '12px 24px 0' }}>
              <Breadcrumb
                items={[
                  { title: <ReadOutlined /> },
                  ...path.map((u) => ({ title: u.name })),
                  { title: workspace.name },
                ]}
              />
            </div>
          )}
          <Suspense fallback={<Spin delay={300} style={{ display: 'block', padding: 48 }} />}>{content}</Suspense>
        </Layout.Content>
      </Layout>
    </Layout>
  );
}
