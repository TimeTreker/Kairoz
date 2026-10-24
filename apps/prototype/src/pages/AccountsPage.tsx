import { MinusCircleOutlined, PlusOutlined } from '@ant-design/icons';
import { Button, Card, Checkbox, Form, Input, Modal, Select, Space, Switch, Table, Tag, Typography } from 'antd';
import { useState } from 'react';
import { useCan, useRun } from '../app/hooks.ts';
import { useEngineState } from '../app/store.ts';
import { EnvTag, Hint, Mono, PageHeader, RoleTag } from '../components/common.tsx';
import type { Grant, GrantInput } from '../domain/authz.ts';
import { DISPATCH_ONLY_ROLES } from '../domain/authz.ts';
import { ENVS, ROLE_INFO, ROLES, SCOPES } from '../domain/vocabulary.ts';
import { confirmGrantReview, createAccount, grantsOf, replaceGrants, updateAccount } from '../engine/identity.ts';
import { useI18n } from '../i18n/i18n.tsx';
import { ENV_LABELS, ROLE_LABELS } from '../i18n/vocab.ts';

function GrantSummary({ grant }: { grant: Grant }) {
  const { L } = useI18n();
  const dim = ROLE_INFO[grant.role].dimension;
  return (
    <Space size={4} wrap>
      <RoleTag role={grant.role} />
      {grant.dispatchOnly && <Tag color="orange">{L('仅下发', 'dispatch only')}</Tag>}
      <Typography.Text type="secondary">{L('工作区', 'ws')}:</Typography.Text>
      <Mono>{grant.workspaces.join(',')}</Mono>
      {dim === 'groups' && (
        <>
          <Typography.Text type="secondary">{L('分组', 'groups')}:</Typography.Text>
          <Mono>{grant.groups.join(',')}</Mono>
        </>
      )}
      {dim === 'scopes' && (
        <>
          <Typography.Text type="secondary">{L('范围', 'scopes')}:</Typography.Text>
          <Mono>{grant.scopes.join(',')}</Mono>
        </>
      )}
      {grant.envs.map((e) => (
        <EnvTag key={e} env={e} />
      ))}
    </Space>
  );
}

export function AccountsPage() {
  const state = useEngineState();
  const { L, B } = useI18n();
  const run = useRun();
  const can = useCan();
  const canManage = can('account.manage', {});
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [form] = Form.useForm();
  const workspaceOptions = [{ value: '*', label: L('* 全部', '* all') }, ...Object.values(state.workspaces).map((w) => ({ value: w.id, label: w.name }))];
  const groupOptions = [{ value: '*', label: L('* 全部', '* all') }, ...Object.values(state.groups).map((g) => ({ value: g.id, label: g.name }))];
  const grants = Form.useWatch('grants', form) as GrantInput[] | undefined;

  const open = (username: string | 'new') => {
    if (username === 'new') form.setFieldsValue({ username: '', displayName: '', grants: [{ role: 'BUSINESS_DEV', workspaces: [], groups: [], scopes: [], envs: ['development', 'testing'] }] });
    else {
      const a = state.accounts[username]!;
      form.setFieldsValue({ username, displayName: a.displayName, grants: a.grants.map(({ id: _id, ...g }) => g) });
    }
    setEditing(username);
  };

  const save = () =>
    form.validateFields().then((v) => {
      const list: GrantInput[] = (v.grants ?? []).map((g: GrantInput) => ({
        role: g.role,
        workspaces: g.workspaces ?? [],
        groups: ROLE_INFO[g.role as keyof typeof ROLE_INFO].dimension === 'groups' ? (g.groups ?? []) : [],
        scopes: ROLE_INFO[g.role as keyof typeof ROLE_INFO].dimension === 'scopes' ? (g.scopes ?? []) : [],
        envs: g.envs ?? [],
        dispatchOnly: DISPATCH_ONLY_ROLES.includes(g.role as never) ? !!g.dispatchOnly : false,
      }));
      const ok =
        editing === 'new'
          ? run((c) => createAccount(c, { username: v.username, displayName: v.displayName, grants: list }), L('已创建', 'Created'))
          : run((c) => {
              updateAccount(c, editing!, { displayName: v.displayName });
              replaceGrants(c, editing!, list);
            }, L('已保存', 'Saved'));
      if (ok !== undefined) setEditing(null);
    });

  return (
    <div className="kz-page">
      <PageHeader
        title={L('账号与授权', 'Accounts & grants')}
        subtitle={L(
          '每一行授权都是一条完整授权：角色 + 工作区 + 分组或范围 + 环境。操作必须由同一条授权完整满足，授权不能拼接。“来自组织”的授权由组织授权规则按目录归属自动获得，其余授权显式授予到人。',
          'Each grant row is one complete authorization: role + workspaces + groups or scopes + environments. An action must be satisfied by one grant; grants are never combined. Grants marked “from org” follow directory membership through org grant rules; all others are granted to the person explicitly.',
        )}
        extra={canManage && <Button type="primary" icon={<PlusOutlined />} onClick={() => open('new')}>{L('新建账号', 'New account')}</Button>}
      />
      <Card>
        <Table
          rowKey="username"
          dataSource={Object.values(state.accounts)}
          pagination={{ pageSize: 30, hideOnSinglePage: true }}
          columns={[
            { title: L('人员', 'Person'), render: (_, a) => <Space orientation="vertical" size={0}><span>{a.displayName}</span><Mono>{a.username}</Mono></Space> },
            {
              title: L('组织', 'Unit'),
              render: (_, a) => (
                <Space orientation="vertical" size={0}>
                  <span>{a.orgUnitId ? (state.orgUnits[a.orgUnitId]?.name ?? a.orgUnitId) : '—'}</span>
                  <Tag color={a.employeeId ? 'blue' : undefined}>{a.employeeId ? L(`目录 ${a.employeeId}`, `directory ${a.employeeId}`) : L('本地账号', 'local')}</Tag>
                </Space>
              ),
            },
            {
              title: L('授权', 'Grants'),
              render: (_, a) => (
                <Space orientation="vertical">
                  {a.grantReview && (
                    <Space size={4} wrap>
                      <Tag color="orange">
                        {L(
                          `待复核：已从 ${state.orgUnits[a.grantReview.fromUnitId ?? '']?.name ?? '—'} 调到 ${state.orgUnits[a.grantReview.toUnitId ?? '']?.name ?? '—'}`,
                          `To review: moved from ${state.orgUnits[a.grantReview.fromUnitId ?? '']?.name ?? '—'} to ${state.orgUnits[a.grantReview.toUnitId ?? '']?.name ?? '—'}`,
                        )}
                      </Tag>
                      {canManage && (
                        <Button size="small" type="link" onClick={() => run((c) => confirmGrantReview(c, a.username), L('已确认保留显式授权', 'Explicit grants kept'))}>
                          {L('确认保留', 'Keep them')}
                        </Button>
                      )}
                    </Space>
                  )}
                  {a.grants.map((g) => <GrantSummary key={g.id} grant={g} />)}
                  {grantsOf(state, a)
                    .filter((g) => g.ruleId)
                    .map((g) => (
                      <Space key={g.id} size={4} wrap>
                        <GrantSummary grant={g} />
                        <Tag color="cyan">{L(`来自组织：${state.orgUnits[state.grantRules[g.ruleId!]!.orgUnitId]?.name}`, `from org: ${state.orgUnits[state.grantRules[g.ruleId!]!.orgUnitId]?.name}`)}</Tag>
                      </Space>
                    ))}
                </Space>
              ),
            },
            {
              title: L('启用', 'Active'),
              render: (_, a) => <Switch checked={a.status === 'ACTIVE'} disabled={!canManage} onChange={(on) => run((c) => updateAccount(c, a.username, { status: on ? 'ACTIVE' : 'DISABLED' }))} />,
            },
            { title: '', render: (_, a) => canManage && <Button type="link" onClick={() => open(a.username)}>{L('编辑', 'Edit')}</Button> },
          ]}
        />
      </Card>
      <Modal open={editing !== null} width={860} title={editing === 'new' ? L('新建账号', 'New account') : L('编辑账号', 'Edit account')} onCancel={() => setEditing(null)} onOk={save}>
        <Hint>{L('账号名只是唯一标识，不定义角色；同一人员可以拥有多条授权。', 'The username is only an identifier; roles come from grants, and one person may hold several.')}</Hint>
        <Form form={form} name="account" layout="vertical">
          <Space>
            <Form.Item name="username" label={L('账号', 'Username')} rules={[{ required: true }]}>
              <Input disabled={editing !== 'new'} />
            </Form.Item>
            <Form.Item name="displayName" label={L('姓名', 'Name')} rules={[{ required: true }]}>
              <Input />
            </Form.Item>
          </Space>
          <Form.List name="grants">
            {(fields, { add, remove }) => (
              <Space orientation="vertical" style={{ width: '100%' }}>
                {fields.map((field) => {
                  const role = grants?.[field.name]?.role as keyof typeof ROLE_INFO | undefined;
                  const dim = role ? ROLE_INFO[role].dimension : 'none';
                  return (
                    <Card key={field.key} size="small" extra={<MinusCircleOutlined onClick={() => remove(field.name)} />}>
                      <Space wrap align="start">
                        <Form.Item name={[field.name, 'role']} label={L('角色', 'Role')} rules={[{ required: true }]}>
                          <Select style={{ width: 170 }} options={ROLES.map((r) => ({ value: r, label: B(ROLE_LABELS[r]) }))} />
                        </Form.Item>
                        <Form.Item name={[field.name, 'workspaces']} label={L('工作区', 'Workspaces')}>
                          <Select mode="multiple" style={{ width: 220 }} options={workspaceOptions} />
                        </Form.Item>
                        {dim === 'groups' && (
                          <Form.Item name={[field.name, 'groups']} label={L('业务分组', 'Groups')}>
                            <Select mode="multiple" style={{ width: 180 }} options={groupOptions} />
                          </Form.Item>
                        )}
                        {dim === 'scopes' && (
                          <Form.Item name={[field.name, 'scopes']} label={L('范围', 'Scopes')}>
                            <Select mode="multiple" style={{ width: 180 }} options={SCOPES.map((s) => ({ value: s, label: s }))} />
                          </Form.Item>
                        )}
                        <Form.Item name={[field.name, 'envs']} label={L('环境', 'Environments')}>
                          <Checkbox.Group options={ENVS.map((e) => ({ value: e, label: B(ENV_LABELS[e]) }))} />
                        </Form.Item>
                        {role && DISPATCH_ONLY_ROLES.includes(role) && (
                          <Form.Item name={[field.name, 'dispatchOnly']} valuePropName="checked" label=" ">
                            <Checkbox>{L('仅下发', 'Dispatch only')}</Checkbox>
                          </Form.Item>
                        )}
                      </Space>
                    </Card>
                  );
                })}
                <Button icon={<PlusOutlined />} onClick={() => add({ role: undefined, workspaces: [], groups: [], scopes: [], envs: ['development', 'testing'] })}>
                  {L('添加一条授权', 'Add a grant')}
                </Button>
              </Space>
            )}
          </Form.List>
        </Form>
      </Modal>
    </div>
  );
}
