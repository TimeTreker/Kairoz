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
import { Avatar, Breadcrumb, Dropdown, Layout, Menu, Segmented, Select, Space, Tag, Typography } from 'antd';
import type { ReactNode } from 'react';
import type { Role } from '../domain/vocabulary.ts';
import { unitPath } from '../engine/org.ts';
import { useI18n } from '../i18n/i18n.tsx';
import { ROLE_LABELS, WORKSPACE_KIND_LABELS } from '../i18n/vocab.ts';
import { AccountsPage } from '../pages/AccountsPage.tsx';
import { AuditPage } from '../pages/AuditPage.tsx';
import { DataCatalogPage } from '../pages/DataCatalogPage.tsx';
import { FeatureDetailPage } from '../pages/FeatureDetailPage.tsx';
import { FeaturesPage } from '../pages/FeaturesPage.tsx';
import { GuidePage } from '../pages/GuidePage.tsx';
import { IntakePage } from '../pages/IntakePage.tsx';
import { OrgPage } from '../pages/OrgPage.tsx';
import { ProcessingPage } from '../pages/ProcessingPage.tsx';
import { WorkbenchPage } from '../pages/WorkbenchPage.tsx';
import { useActor, useWorkspace } from './hooks.ts';
import { PrototypeMenu } from './PrototypeMenu.tsx';
import { navigate, useRoute } from './router.ts';
import { setSession, useEngineState } from './store.ts';

interface NavItem {
  key: string;
  icon: ReactNode;
  zh: string;
  en: string;
  /** Roles (in the current workspace, or platform-wide) that see the item; empty = everyone. */
  roles: Role[];
}

const NAV: NavItem[] = [
  { key: 'workbench', icon: <DashboardOutlined />, zh: '工作台', en: 'Workbench', roles: [] },
  {
    key: 'features',
    icon: <BranchesOutlined />,
    zh: '研发 Feature',
    en: 'Features',
    roles: ['BUSINESS_DEV', 'BUSINESS_TEST', 'DCL_ENGINEER', 'CONFIG_INTEGRATOR', 'INTEGRATION_TEST', 'CONFIG_RELEASE'],
  },
  { key: 'data', icon: <DatabaseOutlined />, zh: '数据目录与引用', en: 'Data & references', roles: ['BUSINESS_DEV', 'BUSINESS_TEST', 'DCL_ENGINEER'] },
  { key: 'intake', icon: <SafetyCertificateOutlined />, zh: 'DCL 接入队列', en: 'DCL intake', roles: ['DCL_ENGINEER'] },
  { key: 'processing', icon: <DeploymentUnitOutlined />, zh: '处理目录', en: 'Processing catalog', roles: ['DCL_ENGINEER', 'BUSINESS_DEV'] },
  { key: 'fleet', icon: <CarOutlined />, zh: '车辆与车辆组', en: 'Vehicles & groups', roles: ['VEHICLE_RESOURCE', 'WORKSPACE_ADMIN', 'BUSINESS_DEV', 'BUSINESS_TEST', 'INTEGRATION_TEST', 'CONFIG_RELEASE', 'DCL_ENGINEER'] },
  { key: 'integration', icon: <ClusterOutlined />, zh: '配置集成', en: 'Integration', roles: ['CONFIG_INTEGRATOR', 'INTEGRATION_TEST', 'DCL_ENGINEER', 'CONFIG_RELEASE'] },
  { key: 'release', icon: <RocketOutlined />, zh: '发布与配置 OTA', en: 'Release & OTA', roles: ['CONFIG_RELEASE', 'VEHICLE_RESOURCE'] },
  { key: 'query', icon: <FileSearchOutlined />, zh: '数据查询', en: 'Data query', roles: ['BUSINESS_DEV', 'BUSINESS_TEST', 'DCL_ENGINEER', 'CONFIG_INTEGRATOR', 'CONFIG_RELEASE'] },
  { key: 'org', icon: <ApartmentOutlined />, zh: '组织与工作区', en: 'Organization', roles: ['PLATFORM_OPS'] },
  { key: 'accounts', icon: <TeamOutlined />, zh: '账号与授权', en: 'Accounts & grants', roles: ['PLATFORM_OPS'] },
  { key: 'audit', icon: <AuditOutlined />, zh: '审计日志', en: 'Audit log', roles: ['PLATFORM_OPS'] },
];

/** Pages not built yet in this phase show a placeholder instead of a broken link. */
const READY = new Set(['workbench', 'features', 'data', 'intake', 'processing', 'org', 'accounts', 'audit', 'guide']);

function Placeholder({ title }: { title: string }) {
  const { L } = useI18n();
  return (
    <div className="kz-page">
      <Typography.Title level={3}>{title}</Typography.Title>
      <Typography.Text type="secondary">{L('该模块将在后续阶段实现。', 'This module arrives in a later phase.')}</Typography.Text>
    </div>
  );
}

export function Shell() {
  const state = useEngineState();
  const actor = useActor()!;
  const { L, B, lang, setLang } = useI18n();
  const { access, workspace, roles } = useWorkspace();
  const route = useRoute();
  const page = route[0] ?? 'workbench';

  const allRoles = new Set(actor.grants.map((g) => g.role));
  const visibleRoles = new Set<Role>([...roles, ...(allRoles.has('PLATFORM_OPS') ? (['PLATFORM_OPS'] as Role[]) : [])]);
  const nav = NAV.filter((n) => n.roles.length === 0 || n.roles.some((r) => visibleRoles.has(r)));

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
  if (page === 'features' && route[1]) content = <FeatureDetailPage featureId={route[1]} />;
  else if (!READY.has(page)) content = <Placeholder title={L(NAV.find((n) => n.key === page)?.zh ?? page, NAV.find((n) => n.key === page)?.en ?? page)} />;
  else
    content = {
      workbench: <WorkbenchPage />,
      features: <FeaturesPage />,
      data: <DataCatalogPage />,
      intake: <IntakePage />,
      processing: <ProcessingPage />,
      org: <OrgPage />,
      accounts: <AccountsPage />,
      audit: <AuditPage />,
      guide: <GuidePage />,
    }[page];

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
          {workspace && page !== 'org' && page !== 'accounts' && page !== 'audit' && page !== 'guide' && (
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
