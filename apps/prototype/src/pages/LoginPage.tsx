import { UserOutlined } from '@ant-design/icons';
import { Avatar, Button, Card, Col, Collapse, Flex, Input, Row, Segmented, Space, Tag, Typography } from 'antd';
import { useMemo, useState } from 'react';
import { PrototypeMenu } from '../app/PrototypeMenu.tsx';
import { navigate } from '../app/router.ts';
import { engine, lastWorkspaceOf, setSession, useEngineState } from '../app/store.ts';
import { canOpenPage } from '../domain/authz.ts';
import { grantsOf, workspaceAccess } from '../engine/identity.ts';
import { landingWorkspace } from '../engine/notifications.ts';
import { useI18n } from '../i18n/i18n.tsx';
import { ROLE_GOALS, ROLE_LABELS } from '../i18n/vocab.ts';
import { ROLES } from '../domain/vocabulary.ts';

/**
 * Signs in: the account starts in the workspace it last used (in this browser), else where it has
 * the most to do. A page it cannot open there gives way to the workbench.
 */
function signIn(username: string): void {
  const state = engine.getState();
  const account = state.accounts[username]!;
  const actor = { username, displayName: account.displayName, grants: grantsOf(state, account) };
  const access = workspaceAccess(state, actor);
  const remembered = lastWorkspaceOf(username);
  const workspaceId = remembered && access.some((a) => a.workspaceId === remembered) ? remembered : landingWorkspace(state, actor);
  const page = window.location.hash.replace(/^#\/?/, '').split('/')[0] || 'workbench';
  setSession({ username, workspaceId });
  if (!workspaceId || !canOpenPage(actor.grants, page, workspaceId)) navigate('workbench');
}

/** Prototype sign-in: pick a person, grouped by role. Roles come from that account's grants. */
export function LoginPage() {
  const state = useEngineState();
  const { L, B, lang, setLang } = useI18n();
  const [query, setQuery] = useState('');
  const people = useMemo(
    () =>
      Object.values(state.accounts).map((a) => {
        const grants = grantsOf(state, a);
        const actor = { username: a.username, displayName: a.displayName, grants };
        const roles = [...new Set(grants.map((g) => g.role))];
        // Where the account would start: its last workspace here, else where it has the most to do.
        const remembered = lastWorkspaceOf(a.username);
        const access = a.status === 'ACTIVE' ? workspaceAccess(state, actor) : [];
        const landing = remembered && access.some((x) => x.workspaceId === remembered) ? remembered : access.length ? landingWorkspace(state, actor) : null;
        return { account: a, roles, landing };
      }),
    [state],
  );
  const q = query.trim().toLowerCase();
  const matches = (p: (typeof people)[number]) =>
    !q || [p.account.displayName, p.account.username, ...p.roles.map((r) => B(ROLE_LABELS[r]))].some((x) => x.toLowerCase().includes(q));
  const usable = people.filter((p) => p.account.status === 'ACTIVE' && p.roles.length > 0 && matches(p));
  const unusable = people.filter((p) => (p.account.status !== 'ACTIVE' || p.roles.length === 0) && matches(p));
  // Each person once, under their first role; their card shows every role they hold.
  const byRole = ROLES.map((role) => ({ role, people: usable.filter((p) => p.roles[0] === role) })).filter((x) => x.people.length > 0);
  const card = (p: (typeof people)[number], disabled = false) => (
    <Col xs={24} sm={12} xl={8} key={p.account.username}>
      <Button block disabled={disabled} className="kz-account" onClick={() => signIn(p.account.username)} style={{ height: 'auto', padding: 12, textAlign: 'left', whiteSpace: 'normal' }}>
        <Flex gap={12} align="flex-start" style={{ width: '100%' }}>
          <Avatar icon={<UserOutlined />} style={{ background: '#e8efff', color: '#2865e8', flex: 'none' }} />
          <div style={{ minWidth: 0 }}>
            <Typography.Text strong>{p.account.displayName}</Typography.Text>
            <div>
              <Typography.Text type="secondary" className="kz-mono">
                {p.account.username}
              </Typography.Text>
            </div>
            <div style={{ marginTop: 6 }}>
              {p.roles.map((r) => (
                <Tag key={r} style={{ marginBottom: 4 }}>
                  {B(ROLE_LABELS[r])}
                  {p.account.grants.some((g) => g.role === r && g.dispatchOnly) ? L('（仅下发）', ' (dispatch only)') : ''}
                </Tag>
              ))}
            </div>
            {disabled ? (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {p.account.status !== 'ACTIVE'
                  ? p.account.employeeId
                    ? L('已停用：离职，或由平台运维停用', 'Disabled: left the company, or disabled by platform operations')
                    : L('已停用：由平台运维停用', 'Disabled by platform operations')
                  : L('没有任何有效授权', 'Holds no grant')}
              </Typography.Text>
            ) : (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {p.landing
                  ? L(`进入：${state.workspaces[p.landing]?.name}`, `Opens ${state.workspaces[p.landing]?.name}`)
                  : L('进入：工作台（还没有可用的工作区）', 'Opens the workbench (no workspace to work in yet)')}
              </Typography.Text>
            )}
          </div>
        </Flex>
      </Button>
    </Col>
  );
  return (
    <div style={{ minHeight: '100%', background: '#f4f6fa' }}>
      <div style={{ maxWidth: 1240, margin: '0 auto', padding: '40px 24px' }}>
        <Flex justify="space-between" align="center" wrap gap={12}>
          <div>
            <Typography.Text type="secondary" style={{ letterSpacing: 1 }}>
              KAIROZ · {L('数据采集平台原型', 'DATA ACQUISITION PLATFORM PROTOTYPE')}
            </Typography.Text>
            <Typography.Title level={2} style={{ margin: '4px 0' }}>
              {L('选择账号进入工作台', 'Choose an account to enter')}
            </Typography.Title>
            <Typography.Text type="secondary">
              {L('原型不校验密码；权限完全按账号的授权判定。', 'The prototype skips passwords; permissions follow the account’s grants.')}
            </Typography.Text>
          </div>
          <Space>
            <Segmented value={lang} onChange={(v) => setLang(v as 'zh' | 'en')} options={[{ label: '中文', value: 'zh' }, { label: 'English', value: 'en' }]} />
            <PrototypeMenu />
          </Space>
        </Flex>
        <Card
          style={{ marginTop: 28 }}
          title={`${L('人员账号', 'People')} · ${usable.length}`}
          extra={<Input.Search allowClear style={{ width: 220 }} placeholder={L('姓名、账号或角色', 'Name, account or role')} value={query} onChange={(e) => setQuery(e.target.value)} />}
        >
          <Space orientation="vertical" size={20} style={{ width: '100%' }}>
            {byRole.map(({ role, people: list }) => (
              <div key={role}>
                <Typography.Text strong>{B(ROLE_LABELS[role])}</Typography.Text>
                <Typography.Text type="secondary" style={{ marginLeft: 8 }}>
                  {B(ROLE_GOALS[role])}
                </Typography.Text>
                <Row gutter={[12, 12]} style={{ marginTop: 8 }}>
                  {list.map((p) => card(p))}
                </Row>
              </div>
            ))}
            {usable.length === 0 && <Typography.Text type="secondary">{L('没有匹配的账号。', 'No matching account.')}</Typography.Text>}
            {unusable.length > 0 && (
              <Collapse
                size="small"
                items={[
                  {
                    key: 'unusable',
                    label: L(`不能登录的账号 · ${unusable.length}`, `Accounts that cannot sign in · ${unusable.length}`),
                    children: <Row gutter={[12, 12]}>{unusable.map((p) => card(p, true))}</Row>,
                  },
                ]}
              />
            )}
          </Space>
        </Card>
      </div>
    </div>
  );
}
