import { PlusOutlined } from '@ant-design/icons';
import { Button, Card, Checkbox, Col, Descriptions, Form, Input, Modal, Row, Select, Space, Table, Tabs, Tag, Tree, Typography } from 'antd';
import type { TreeDataNode } from 'antd';
import { useState } from 'react';
import type { Key } from 'react';
import { useCan, useRun } from '../app/hooks.ts';
import { useEngineState } from '../app/store.ts';
import { Hint, LabelTag, Mono, PageHeader, RoleTag, when } from '../components/common.tsx';
import { LifecycleModal } from '../components/lifecycle.tsx';
import type { LifecycleTarget } from '../components/lifecycle.tsx';
import { workspacesOfGroup } from '../engine/lifecycle.ts';
import { DOMAINS, SCOPES } from '../domain/vocabulary.ts';
import { archiveGrantRule, createGrantRule, ruleCovers } from '../engine/identity.ts';
import {
  createGroup,
  createOrgUnit,
  createProject,
  createVehicleModel,
  createWorkspace,
  moveGroupUnit,
  moveWorkspaceUnit,
  orphanedOrgObjects,
  unitPath,
  updateOrgUnit,
  updateWorkspace,
} from '../engine/org.ts';
import type { State, Workspace } from '../engine/types.ts';
import { useI18n } from '../i18n/i18n.tsx';
import { issueLabel } from '../i18n/issues.ts';
import { SYNC_KIND_LABELS, WORKSPACE_KIND_LABELS } from '../i18n/vocab.ts';

function treeOf(state: State, filter: (kind: string, projectId: string | null) => boolean, L: (zh: string, en: string) => string): TreeDataNode[] {
  const units = Object.values(state.orgUnits).filter((u) => filter(u.kind, u.projectId));
  const build = (parentId: string | null): TreeDataNode[] =>
    units
      .filter((u) => u.parentId === parentId)
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((u) => ({
        key: u.id,
        title: (
          <span style={u.status === 'ARCHIVED' ? { opacity: 0.55 } : undefined}>
            {u.name} <Typography.Text type="secondary" className="kz-mono">{u.id}</Typography.Text>
            {u.source === 'DIRECTORY' && <Tag style={{ marginLeft: 6 }}>{u.externalId === u.id ? L('目录', 'directory') : L(`目录 ${u.externalId}`, `directory ${u.externalId}`)}</Tag>}
            {u.status === 'ARCHIVED' && <Tag color="red">{u.source === 'DIRECTORY' ? L('已撤销', 'removed') : L('已归档', 'archived')}</Tag>}
            {Object.values(state.workspaces)
              .filter((w) => w.orgUnitId === u.id)
              .map((w) => (
                <Tag key={w.id} color="blue" style={{ marginLeft: 6 }}>
                  {w.name}
                </Tag>
              ))}
          </span>
        ),
        children: build(u.id),
      }));
  return build(null);
}

export function OrgPage() {
  const state = useEngineState();
  const { L, B } = useI18n();
  const run = useRun();
  const can = useCan();
  const canOrg = can('org.manage', {});
  const canWorkspaces = can('workspace.manage', {});
  const [modal, setModal] = useState<null | 'unit' | 'project' | 'model' | 'group' | 'workspace' | 'rule' | { edit: string } | { ws: string } | { rehome: 'workspace' | 'group'; id: string }>(null);
  const canAccounts = can('account.manage', {});
  const [lifecycle, setLifecycle] = useState<LifecycleTarget | null>(null);
  const orphaned = orphanedOrgObjects(state);
  const [form] = Form.useForm();
  const units = Object.values(state.orgUnits).filter((u) => u.status === 'ACTIVE');
  const fromDirectory = units.some((u) => u.source === 'DIRECTORY');
  const unitOptions = units.map((u) => ({ value: u.id, label: `${unitPath(state, u.id).map((p) => p.name).join(' / ')} (${u.kind})` }));
  const close = () => (setModal(null), form.resetFields());
  const modalTitle =
    modal === 'unit'
      ? L('新建组织节点', 'New org unit')
      : modal === 'project'
        ? L('成立项目', 'Establish a project')
        : modal === 'model'
          ? L('登记车型', 'Register a vehicle model')
          : modal === 'group'
            ? L('新建业务分组', 'New business group')
            : modal === 'workspace'
              ? L('新建工作区', 'New workspace')
              : modal === 'rule'
                ? L('新建组织授权规则', 'New org grant rule')
                : modal && 'edit' in modal
                  ? `${L('编辑组织节点', 'Edit org unit')} · ${state.orgUnits[modal.edit]?.name ?? modal.edit}`
                  : modal && 'ws' in modal
                    ? `${L('编辑工作区', 'Edit workspace')} · ${state.workspaces[modal.ws]?.name ?? modal.ws}`
                    : modal && 'rehome' in modal
                      ? `${L('重新挂靠', 'Re-attach')} · ${modal.rehome === 'workspace' ? state.workspaces[modal.id]?.name : state.groups[modal.id]?.name}`
                      : '';
  const kind = Form.useWatch('kind', form);

  const save = () =>
    form.validateFields().then((v) => {
      let ok: unknown;
      if (modal === 'unit') ok = run((c) => createOrgUnit(c, { id: v.id, name: v.name, parentId: v.parentId ?? null }), L('已创建', 'Created'));
      else if (modal === 'project') ok = run((c) => createProject(c, v), L('已创建', 'Created'));
      else if (modal === 'model') ok = run((c) => createVehicleModel(c, v), L('已创建', 'Created'));
      else if (modal === 'group') ok = run((c) => createGroup(c, v), L('已创建', 'Created'));
      else if (modal === 'workspace')
        ok = run((c) => createWorkspace(c, { ...v, groupIds: v.groupIds ?? [], scopes: v.scopes ?? [], sourceWorkspaceIds: v.sourceWorkspaceIds ?? [] }), L('已创建', 'Created'));
      else if (modal === 'rule')
        ok = run(
          (c) => createGrantRule(c, { orgUnitId: v.orgUnitId, includeSubunits: !!v.includeSubunits, role: 'BUSINESS_DEV', workspaces: v.workspaces ?? [], groups: v.groups ?? [], scopes: [], envs: ['development'] }),
          L('已创建；该组织节点的成员立即获得这条基础权限', 'Created; members of the unit get this base right at once'),
        );
      else if (modal && 'edit' in modal) ok = run((c) => updateOrgUnit(c, modal.edit, { name: v.name, parentId: v.parentId ?? null }), L('已保存', 'Saved'));
      else if (modal && 'ws' in modal) ok = run((c) => updateWorkspace(c, modal.ws, v), L('已保存', 'Saved'));
      else if (modal && 'rehome' in modal)
        ok =
          modal.rehome === 'workspace'
            ? run((c) => moveWorkspaceUnit(c, modal.id, v.orgUnitId), L('已重新挂靠；业务分组代码、数据键和授权不变', 'Re-attached; group codes, data keys and grants are unchanged'))
            : run((c) => moveGroupUnit(c, modal.id, v.orgUnitId), L('已重新挂靠', 'Re-attached'));
      if (ok !== undefined) close();
    });

  // Platform operations edit or archive a unit from either tree; directory units follow the directory.
  const editUnit = (key: Key | undefined) => {
    if (key === undefined || !canOrg) return;
    const u = state.orgUnits[String(key)];
    if (!u || u.source === 'DIRECTORY' || u.status !== 'ACTIVE') return;
    form.setFieldsValue({ name: u.name, parentId: u.parentId });
    setModal({ edit: u.id });
  };

  const editWorkspace = (w: Workspace) => {
    form.setFieldsValue({ name: w.name, groupIds: w.groupIds, scopes: w.scopes, sourceWorkspaceIds: w.sourceWorkspaceIds });
    setModal({ ws: w.id });
  };

  return (
    <div className="kz-page">
      <PageHeader title={L('组织与工作区', 'Organization & workspaces')} subtitle={L('团队组织与项目组织是两棵独立的树；工作区类型决定它属于哪一棵。', 'The team and project organizations are separate trees; a workspace’s kind decides which one it belongs to.')} />
      <Tabs
        items={[
          {
            key: 'trees',
            label: L('组织树', 'Trees'),
            children: (
              <Row gutter={16}>
                <Col xs={24} lg={12}>
                  <Card title={L('团队组织', 'Team organization')} extra={canOrg && <Button icon={<PlusOutlined />} onClick={() => setModal('unit')}>{L('新建节点', 'New unit')}</Button>}>
                    {fromDirectory && (
                      <Hint>
                        {L(
                          '团队组织由公司目录同步，平台内只读：部门改名、调整或撤销都在目录中进行。业务分组、工作区与授权由平台管理；组织变化不会改动业务分组代码。',
                          'The team organization is synced from the company directory and read-only here: renaming, moving or removing departments happens in the directory. Business groups, workspaces and grants are the platform’s; org changes never change a group’s code.',
                        )}
                      </Hint>
                    )}
                    <Tree
                      defaultExpandAll
                      treeData={treeOf(state, (k) => k === 'TEAM', L)}
                      onSelect={([key]) => editUnit(key)}
                    />
                  </Card>
                </Col>
                <Col xs={24} lg={12}>
                  {Object.values(state.projects).map((p) => (
                    <Card key={p.id} title={`${L('项目组织', 'Project organization')} · ${p.name}`} style={{ marginBottom: 16 }}>
                      <Tree defaultExpandAll treeData={treeOf(state, (k, pid) => k === 'PROJECT' && pid === p.id, L)} onSelect={([key]) => editUnit(key)} />
                    </Card>
                  ))}
                  {canOrg && (
                    <Button icon={<PlusOutlined />} onClick={() => setModal('project')}>
                      {L('成立项目', 'Establish project')}
                    </Button>
                  )}
                </Col>
              </Row>
            ),
          },
          {
            key: 'workspaces',
            label: L('工作区', 'Workspaces'),
            children: (
              <Card extra={canWorkspaces && <Button icon={<PlusOutlined />} onClick={() => setModal('workspace')}>{L('新建工作区', 'New workspace')}</Button>}>
                <Table
                  rowKey="id"
                  pagination={false}
                  dataSource={Object.values(state.workspaces)}
                  columns={[
                    { title: L('工作区', 'Workspace'), render: (_, w) => <Space orientation="vertical" size={0}><span>{w.name}</span><Mono>{w.id}</Mono></Space> },
                    { title: L('类型', 'Kind'), render: (_, w) => <LabelTag map={WORKSPACE_KIND_LABELS} value={w.kind} /> },
                    {
                      title: L('组织路径', 'Org path'),
                      render: (_, w) =>
                        orphaned.workspaces.includes(w.id) ? (
                          <Space size={4} wrap>
                            <Tag color="red">{L('组织节点已失效', 'Org unit no longer exists')}</Tag>
                            {canWorkspaces && (
                              <Button size="small" type="link" onClick={() => (form.resetFields(), setModal({ rehome: 'workspace', id: w.id }))}>
                                {L('重新挂靠', 'Re-attach')}
                              </Button>
                            )}
                          </Space>
                        ) : (
                          unitPath(state, w.orgUnitId).map((u) => u.name).join(' / ')
                        ),
                    },
                    { title: L('车型', 'Model'), dataIndex: 'vehicleModelId' },
                    { title: L('业务分组', 'Groups'), render: (_, w) => w.groupIds.map((g) => <Tag key={g}>{state.groups[g]?.name}</Tag>) },
                    { title: L('范围', 'Scopes'), render: (_, w) => w.scopes.join(', ') },
                    { title: L('来源工作区', 'Sources'), render: (_, w) => w.sourceWorkspaceIds.map((s) => <Tag key={s}>{state.workspaces[s]?.name}</Tag>) },
                    { title: L('状态', 'Status'), render: (_, w) => (w.status === 'ARCHIVED' ? <Tag color="red">{L('已归档', 'Archived')}</Tag> : <Tag color="green">{L('使用中', 'Active')}</Tag>) },
                    {
                      title: '',
                      render: (_, w) => (
                        <Space size={0}>
                          {canWorkspaces && w.status === 'ACTIVE' && (
                            <Button type="link" size="small" onClick={() => editWorkspace(w)}>
                              {L('编辑', 'Edit')}
                            </Button>
                          )}
                          {w.status === 'ACTIVE' && can('workspace.archive', { workspaceId: w.id }) && (
                            <Button type="link" size="small" danger onClick={() => setLifecycle({ object: 'workspace', action: 'archive', id: w.id })}>
                              {L('归档', 'Archive')}
                            </Button>
                          )}
                          {w.status === 'ARCHIVED' && canWorkspaces && (
                            <Button type="link" size="small" onClick={() => setLifecycle({ object: 'workspace', action: 'restore', id: w.id })}>
                              {L('恢复', 'Restore')}
                            </Button>
                          )}
                        </Space>
                      ),
                    },
                  ]}
                />
              </Card>
            ),
          },
          {
            key: 'groups',
            label: L('业务分组', 'Business groups'),
            children: (
              <Card extra={canOrg && <Button icon={<PlusOutlined />} onClick={() => setModal('group')}>{L('新建分组', 'New group')}</Button>}>
                <Hint>{L('业务分组是文件列表与策略的唯一维护归属；测试用途分组不能维护配置。创建分组不授予任何人权限。', 'A business group is the sole maintainer of its file list and policies; test groups do not maintain configuration. Creating a group grants nobody anything.')}</Hint>
                <Table
                  rowKey="id"
                  pagination={false}
                  dataSource={Object.values(state.groups)}
                  columns={[
                    { title: L('名称', 'Name'), dataIndex: 'name' },
                    { title: L('代码', 'Code'), render: (_, g) => <Mono>{g.code}</Mono> },
                    { title: L('域', 'Domain'), dataIndex: 'domain' },
                    { title: L('用途', 'Purpose'), render: (_, g) => <Tag>{g.purpose === 'DEV' ? L('研发', 'Development') : L('测试', 'Testing')}</Tag> },
                    {
                      title: L('所属节点', 'Unit'),
                      render: (_, g) =>
                        orphaned.groups.includes(g.id) ? (
                          <Space size={4} wrap>
                            <Tag color="red">{L('组织节点已失效', 'Org unit no longer exists')}</Tag>
                            {canOrg && (
                              <Button size="small" type="link" onClick={() => (form.resetFields(), setModal({ rehome: 'group', id: g.id }))}>
                                {L('重新挂靠', 'Re-attach')}
                              </Button>
                            )}
                          </Space>
                        ) : (
                          unitPath(state, g.orgUnitId).map((u) => u.name).join(' / ')
                        ),
                    },
                    { title: L('状态', 'Status'), render: (_, g) => (g.status === 'ARCHIVED' ? <Tag color="red">{L('已归档', 'Archived')}</Tag> : <Tag color="green">{L('使用中', 'Active')}</Tag>) },
                    {
                      title: '',
                      render: (_, g) => {
                        // Archived by the admin of every workspace holding the group, or by platform operations.
                        const holders = workspacesOfGroup(state, g.id);
                        const may = holders.length ? holders.every((ws) => can('group.archive', { workspaceId: ws })) : canOrg;
                        return (
                          g.status === 'ACTIVE' &&
                          may && (
                            <Button type="link" size="small" danger onClick={() => setLifecycle({ object: 'group', action: 'archive', id: g.id })}>
                              {L('归档', 'Archive')}
                            </Button>
                          )
                        );
                      },
                    },
                  ]}
                />
              </Card>
            ),
          },
          {
            key: 'rules',
            label: L('授权规则', 'Grant rules'),
            children: (
              <Card extra={canAccounts && <Button icon={<PlusOutlined />} onClick={() => (form.resetFields(), setModal('rule'))}>{L('新建规则', 'New rule')}</Button>}>
                <Hint>
                  {L(
                    '组织授权规则让某个团队节点的成员自动获得基础权限：只能是研发环境的业务研发。测试、管理、集成、发布、车辆资源和敏感数据等特殊权限必须显式授予到人；规则不要覆盖测试人员所在的部门，避免测试身份修改自己测试的内容。成员调岗时，规则授予的权限随组织变化，显式授权标记待复核；离职即停用。',
                    'An org grant rule gives the members of a team unit a base right: business development in the development environment only. Testing, administration, integration, release, vehicle resources and sensitive data are always granted to people explicitly; keep rules off the departments testers sit in, so a tester never edits what they test. When someone moves, rule grants follow the unit and explicit grants are flagged for review; leaving disables the account.',
                  )}
                </Hint>
                <Table
                  rowKey="id"
                  pagination={false}
                  dataSource={Object.values(state.grantRules)}
                  locale={{ emptyText: L('暂无组织授权规则', 'No org grant rules') }}
                  columns={[
                    { title: L('组织节点', 'Unit'), render: (_, r) => `${unitPath(state, r.orgUnitId).map((u) => u.name).join(' / ')}${r.includeSubunits ? L('（含下级）', ' (and below)') : ''}` },
                    { title: L('角色', 'Role'), render: (_, r) => <RoleTag role={r.role} /> },
                    { title: L('工作区', 'Workspaces'), render: (_, r) => r.workspaces.map((w) => <Tag key={w}>{state.workspaces[w]?.name ?? w}</Tag>) },
                    { title: L('业务分组', 'Groups'), render: (_, r) => r.groups.map((g) => <Tag key={g}>{state.groups[g]?.name ?? g}</Tag>) },
                    { title: L('环境', 'Envs'), render: (_, r) => r.envs.join(', ') },
                    {
                      title: L('覆盖人员', 'Members'),
                      render: (_, r) =>
                        Object.values(state.accounts)
                          .filter((a) => a.status === 'ACTIVE' && a.orgUnitId && ruleCovers(state, r, a.orgUnitId))
                          .map((a) => a.displayName)
                          .join('、') || '—',
                    },
                    { title: L('状态', 'Status'), render: (_, r) => (r.status === 'ACTIVE' ? (state.orgUnits[r.orgUnitId]?.status === 'ACTIVE' ? <Tag color="green">{L('生效', 'Active')}</Tag> : <Tag color="red">{L('组织节点已失效', 'Org unit no longer exists')}</Tag>) : <Tag>{L('已停用', 'Archived')}</Tag>) },
                    {
                      title: '',
                      render: (_, r) =>
                        canAccounts &&
                        r.status === 'ACTIVE' && (
                          <Button size="small" type="link" danger onClick={() => run((c) => archiveGrantRule(c, r.id), L('已停用；成员立即失去这条基础权限', 'Archived; members lose this base right at once'))}>
                            {L('停用', 'Archive')}
                          </Button>
                        ),
                    },
                  ]}
                />
              </Card>
            ),
          },
          {
            key: 'sync',
            label: L('目录同步', 'Directory sync'),
            children: (
              <Card>
                {state.directory ? (
                  <>
                    <Descriptions size="small" column={{ xs: 1, md: 3 }} style={{ marginBottom: 12 }}>
                      <Descriptions.Item label={L('已同步修订', 'Revision synced')}>{state.directorySync.revision}</Descriptions.Item>
                      <Descriptions.Item label={L('目录当前修订', 'Directory revision')}>{state.directory.revision}</Descriptions.Item>
                      <Descriptions.Item label={L('同步时间', 'Synced at')}>{when(state.directorySync.syncedAt)}</Descriptions.Item>
                    </Descriptions>
                    <Table
                      rowKey="seq"
                      size="small"
                      pagination={{ pageSize: 20, hideOnSinglePage: true }}
                      dataSource={state.directorySync.log}
                      columns={[
                        { title: L('修订', 'Rev.'), dataIndex: 'revision' },
                        { title: L('变化', 'Change'), render: (_, e) => <LabelTag map={SYNC_KIND_LABELS} value={e.kind} /> },
                        { title: L('对象', 'Subject'), render: (_, e) => <Mono>{e.subject}</Mono> },
                        { title: L('说明', 'Detail'), render: (_, e) => B(issueLabel(e.detail), e.detail) },
                        { title: L('时间', 'At'), render: (_, e) => when(e.at) },
                      ]}
                    />
                  </>
                ) : (
                  <Typography.Text type="secondary">{L('本安装未接入公司目录；团队组织由平台维护。', 'This installation has no company directory; the platform maintains the team organization.')}</Typography.Text>
                )}
              </Card>
            ),
          },
          {
            key: 'models',
            label: L('车型', 'Vehicle models'),
            children: (
              <Card extra={canOrg && <Button icon={<PlusOutlined />} onClick={() => setModal('model')}>{L('登记车型', 'Register model')}</Button>}>
                <Table rowKey="id" pagination={false} dataSource={Object.values(state.vehicleModels)} columns={[{ title: 'ID', dataIndex: 'id' }, { title: L('名称', 'Name'), dataIndex: 'name' }, { title: L('状态', 'Status'), dataIndex: 'status' }]} />
              </Card>
            ),
          },
        ]}
      />
      <Modal open={modal !== null} title={modalTitle} onCancel={close} onOk={save} destroyOnHidden>
        <Form form={form} name="org" layout="vertical" preserve={false} initialValues={{ kind: 'TEAM', purpose: 'DEV', domain: 'Chassis' }}>
          {(modal === 'unit' || modal === 'project' || modal === 'model' || modal === 'group' || modal === 'workspace') && (
            <Form.Item name="id" label="ID" rules={[{ required: true }]}>
              <Input placeholder={modal === 'model' ? 'X91' : 'brake-team'} />
            </Form.Item>
          )}
          {modal !== null && modal !== 'rule' && !(typeof modal === 'object' && 'rehome' in modal) && (
            <Form.Item name="name" label={L('名称', 'Name')} rules={[{ required: true }]}>
              <Input />
            </Form.Item>
          )}
          {modal !== null && typeof modal === 'object' && 'rehome' in modal && (
            <Form.Item name="orgUnitId" label={L('新的组织节点', 'New org unit')} rules={[{ required: true }]}>
              <Select
                options={unitOptions.filter((u) => {
                  const unit = state.orgUnits[u.value]!;
                  const current = modal.rehome === 'workspace' ? state.workspaces[modal.id] : undefined;
                  if (current) return current.kind === 'TEAM' ? unit.kind === 'TEAM' : unit.kind === 'PROJECT' && unit.projectId === current.projectId;
                  const group = state.groups[modal.id];
                  const old = group ? state.orgUnits[group.orgUnitId] : undefined;
                  return !old || (unit.kind === old.kind && unit.projectId === old.projectId);
                })}
              />
            </Form.Item>
          )}
          {modal === 'rule' && (
            <>
              <Form.Item name="orgUnitId" label={L('团队组织节点', 'Team unit')} rules={[{ required: true }]}>
                <Select options={unitOptions.filter((u) => state.orgUnits[u.value]!.kind === 'TEAM')} />
              </Form.Item>
              <Form.Item name="includeSubunits" valuePropName="checked">
                <Checkbox>{L('包含下级节点的成员', 'Include members of units below')}</Checkbox>
              </Form.Item>
              <Typography.Paragraph type="secondary">{L('角色：业务研发；环境：研发（组织规则只能授予这一项）', 'Role: business development; environment: development (the only base right a rule may give)')}</Typography.Paragraph>
              <Form.Item name="workspaces" label={L('工作区', 'Workspaces')} rules={[{ required: true }]}>
                <Select mode="multiple" options={Object.values(state.workspaces).filter((w) => w.kind === 'TEAM').map((w) => ({ value: w.id, label: w.name }))} />
              </Form.Item>
              <Form.Item name="groups" label={L('业务分组', 'Business groups')} rules={[{ required: true }]}>
                <Select mode="multiple" options={Object.values(state.groups).map((g) => ({ value: g.id, label: g.name }))} />
              </Form.Item>
            </>
          )}
          {(modal === 'unit' || (modal !== null && typeof modal === 'object' && 'edit' in modal)) && (
            <Form.Item name="parentId" label={L('上级节点（团队树留空 = 根）', 'Parent (blank for a team root)')}>
              <Select allowClear options={unitOptions} />
            </Form.Item>
          )}
          {modal !== null && typeof modal === 'object' && 'edit' in modal && (
            <Button
              danger
              size="small"
              onClick={() => {
                const id = modal.edit;
                close();
                setLifecycle({ object: 'unit', action: 'archive', id });
              }}
            >
              {L('归档该节点…', 'Archive this unit…')}
            </Button>
          )}
          {modal === 'project' && (
            <Form.Item name="vehicleModelId" label={L('车型', 'Vehicle model')}>
              <Select allowClear options={Object.keys(state.vehicleModels).map((m) => ({ value: m, label: m }))} />
            </Form.Item>
          )}
          {modal === 'group' && (
            <>
              <Form.Item name="code" label={L('分组代码（点分，例：chassis.brake）', 'Group code (dotted, e.g. chassis.brake)')} rules={[{ required: true }]}>
                <Input />
              </Form.Item>
              <Space>
                <Form.Item name="domain" label={L('域', 'Domain')}>
                  <Select style={{ width: 160 }} options={DOMAINS.map((d) => ({ value: d, label: d }))} />
                </Form.Item>
                <Form.Item name="purpose" label={L('用途', 'Purpose')}>
                  <Select style={{ width: 160 }} options={[{ value: 'DEV', label: L('研发', 'Development') }, { value: 'TEST', label: L('测试', 'Testing') }]} />
                </Form.Item>
              </Space>
              <Form.Item name="orgUnitId" label={L('所属节点', 'Organization unit')} rules={[{ required: true }]}>
                <Select options={unitOptions} />
              </Form.Item>
              <Form.Item name="workspaceId" label={L('加入工作区（可选）', 'Join workspace (optional)')}>
                <Select allowClear options={Object.values(state.workspaces).map((w) => ({ value: w.id, label: w.name }))} />
              </Form.Item>
            </>
          )}
          {(modal === 'workspace' || (modal !== null && typeof modal === 'object' && 'ws' in modal)) && (
            <>
              {modal === 'workspace' && (
                <>
                  <Form.Item name="kind" label={L('类型', 'Kind')}>
                    <Select options={(['TEAM', 'PROJECT', 'INTEGRATION'] as const).map((k) => ({ value: k, label: B(WORKSPACE_KIND_LABELS[k]) }))} />
                  </Form.Item>
                  <Form.Item name="orgUnitId" label={L('组织节点', 'Organization unit')} rules={[{ required: true }]}>
                    <Select options={unitOptions.filter((u) => (kind === 'TEAM' ? state.orgUnits[u.value]!.kind === 'TEAM' : state.orgUnits[u.value]!.kind === 'PROJECT'))} />
                  </Form.Item>
                  <Form.Item name="vehicleModelId" label={L('车型', 'Vehicle model')} rules={[{ required: true }]}>
                    <Select options={Object.keys(state.vehicleModels).map((m) => ({ value: m, label: m }))} />
                  </Form.Item>
                </>
              )}
              <Form.Item name="groupIds" label={L('业务分组', 'Business groups')}>
                <Select
                  mode="multiple"
                  options={Object.values(state.groups).map((g) => {
                    // An archived group a workspace holds may stay; it is never added anew.
                    const held = typeof modal === 'object' && modal !== null && 'ws' in modal && !!state.workspaces[modal.ws]?.groupIds.includes(g.id);
                    return { value: g.id, label: g.status === 'ARCHIVED' ? `${g.name}（${L('已归档', 'archived')}）` : g.name, disabled: g.status === 'ARCHIVED' && !held };
                  })}
                />
              </Form.Item>
              <Form.Item name="scopes" label={L('范围', 'Scopes')}>
                <Select mode="multiple" options={SCOPES.map((s) => ({ value: s, label: s }))} />
              </Form.Item>
              <Form.Item name="sourceWorkspaceIds" label={L('来源工作区（项目 / 集成工作区）', 'Source workspaces (project / integration)')}>
                <Select mode="multiple" options={Object.values(state.workspaces).map((w) => ({ value: w.id, label: w.name }))} />
              </Form.Item>
            </>
          )}
        </Form>
      </Modal>
      <LifecycleModal target={lifecycle} onClose={() => setLifecycle(null)} />
    </div>
  );
}
