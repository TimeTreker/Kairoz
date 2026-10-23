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
  ReadOutlined,
  RocketOutlined,
  SafetyCertificateOutlined,
  TeamOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { Avatar, Breadcrumb, Button, Dropdown, Layout, Menu, Result, Segmented, Select, Space, Tag } from 'antd';
import type { ReactNode } from 'react';
import { canOpenPage } from '../domain/authz.ts';
import { unitPath } from '../engine/org.ts';
import { useI18n } from '../i18n/i18n.tsx';
import { ROLE_LABELS, WORKSPACE_KIND_LABELS } from '../i18n/vocab.ts';
import { AcceptancePage } from '../pages/AcceptancePage.tsx';
import { AccountsPage } from '../pages/AccountsPage.tsx';
import { AuditPage } from '../pages/AuditPage.tsx';
import { DataCatalogPage } from '../pages/DataCatalogPage.tsx';
import { FeatureDetailPage } from '../pages/FeatureDetailPage.tsx';
import { FeaturesPage } from '../pages/FeaturesPage.tsx';
import { FleetPage } from '../pages/FleetPage.tsx';
import { GuidePage } from '../pages/GuidePage.tsx';
import { IntakePage } from '../pages/IntakePage.tsx';
import { IntegrationPage } from '../pages/IntegrationPage.tsx';
import { OrgPage } from '../pages/OrgPage.tsx';
import { ProcessingPage } from '../pages/ProcessingPage.tsx';
import { QueryPage } from '../pages/QueryPage.tsx';
import { ReleasePage } from '../pages/ReleasePage.tsx';
import { SimulatorPage } from '../pages/SimulatorPage.tsx';
import { WorkbenchPage } from '../pages/WorkbenchPage.tsx';
import { useActor, useCanOpen, useWorkspace } from './hooks.ts';
import { PrototypeMenu } from './PrototypeMenu.tsx';
import { navigate, useRoute } from './router.ts';
import { setSession, useEngineState } from './store.ts';

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
      processing: <ProcessingPage />,
      fleet: <FleetPage />,
      release: <ReleasePage key={workspace?.id} tab={route[1]} />,
      query: <QueryPage key={workspace?.id} tab={route[1]} />,
      simulator: <SimulatorPage />,
      org: <OrgPage />,
      accounts: <AccountsPage />,
      audit: <AuditPage />,
      guide: <GuidePage />,
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
        <Layout.Header style={{ background: '#fff', padding: '0 20px', display: 'flex', alignItems: 'center', gap: 12, borderBottom: '1px solid #eef0f4' }}>
          <Select
            style={{ minWidth: 240 }}
            value={workspace?.id}
            placeholder={L('没有可用工作区', 'No workspace available')}
            options={options}
            onChange={(v) => setSession({ workspaceId: v })}
          />
          {workspace && <Tag>{B(WORKSPACE_KIND_LABELS[workspace.kind])}</Tag>}
          <div style={{ flex: 1 }} />
          <Segmented size="small" value={lang} onChange={(v) => setLang(v as 'zh' | 'en')} options={[{ label: '中', value: 'zh' }, { label: 'EN', value: 'en' }]} />
          <PrototypeMenu compact />
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
              <span>{actor.displayName}</span>
            </Space>
          </Dropdown>
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
          {content}
        </Layout.Content>
      </Layout>
    </Layout>
  );
}
