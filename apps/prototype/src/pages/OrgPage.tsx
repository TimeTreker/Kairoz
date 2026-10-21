import { PlusOutlined } from '@ant-design/icons';
import { Button, Card, Col, Form, Input, Modal, Row, Select, Space, Table, Tabs, Tag, Tree, Typography } from 'antd';
import type { TreeDataNode } from 'antd';
import { useState } from 'react';
import { useRun } from '../app/hooks.ts';
import { useEngineState } from '../app/store.ts';
import { Hint, LabelTag, Mono, PageHeader } from '../components/common.tsx';
import { DOMAINS, SCOPES } from '../domain/vocabulary.ts';
import { createGroup, createOrgUnit, createProject, createVehicleModel, createWorkspace, unitPath, updateOrgUnit, updateWorkspace } from '../engine/org.ts';
import type { State, Workspace } from '../engine/types.ts';
import { useI18n } from '../i18n/i18n.tsx';
import { WORKSPACE_KIND_LABELS } from '../i18n/vocab.ts';

function treeOf(state: State, filter: (kind: string, projectId: string | null) => boolean): TreeDataNode[] {
  const units = Object.values(state.orgUnits).filter((u) => filter(u.kind, u.projectId));
  const build = (parentId: string | null): TreeDataNode[] =>
    units
      .filter((u) => u.parentId === parentId)
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((u) => ({
        key: u.id,
        title: (
          <span>
            {u.name} <Typography.Text type="secondary" className="kz-mono">{u.id}</Typography.Text>
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
  const [modal, setModal] = useState<null | 'unit' | 'project' | 'model' | 'group' | 'workspace' | { edit: string } | { ws: string }>(null);
  const [form] = Form.useForm();
  const units = Object.values(state.orgUnits);
  const unitOptions = units.map((u) => ({ value: u.id, label: `${unitPath(state, u.id).map((p) => p.name).join(' / ')} (${u.kind})` }));
  const close = () => (setModal(null), form.resetFields());
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
      else if (modal && 'edit' in modal) ok = run((c) => updateOrgUnit(c, modal.edit, { name: v.name, parentId: v.parentId ?? null }), L('已保存', 'Saved'));
      else if (modal && 'ws' in modal) ok = run((c) => updateWorkspace(c, modal.ws, v), L('已保存', 'Saved'));
      if (ok !== undefined) close();
    });

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
                  <Card title={L('团队组织', 'Team organization')} extra={<Button icon={<PlusOutlined />} onClick={() => setModal('unit')}>{L('新建节点', 'New unit')}</Button>}>
                    <Tree
                      defaultExpandAll
                      treeData={treeOf(state, (k) => k === 'TEAM')}
                      onSelect={([key]) => {
                        if (!key) return;
                        const u = state.orgUnits[String(key)]!;
                        form.setFieldsValue({ name: u.name, parentId: u.parentId });
                        setModal({ edit: u.id });
                      }}
                    />
                  </Card>
                </Col>
                <Col xs={24} lg={12}>
                  {Object.values(state.projects).map((p) => (
                    <Card key={p.id} title={`${L('项目组织', 'Project organization')} · ${p.name}`} style={{ marginBottom: 16 }}>
                      <Tree defaultExpandAll treeData={treeOf(state, (k, pid) => k === 'PROJECT' && pid === p.id)} />
                    </Card>
                  ))}
                  <Button icon={<PlusOutlined />} onClick={() => setModal('project')}>
                    {L('成立项目', 'Establish project')}
                  </Button>
                </Col>
              </Row>
            ),
          },
          {
            key: 'workspaces',
            label: L('工作区', 'Workspaces'),
            children: (
              <Card extra={<Button icon={<PlusOutlined />} onClick={() => setModal('workspace')}>{L('新建工作区', 'New workspace')}</Button>}>
                <Table
                  rowKey="id"
                  pagination={false}
                  dataSource={Object.values(state.workspaces)}
                  columns={[
                    { title: L('工作区', 'Workspace'), render: (_, w) => <Space orientation="vertical" size={0}><span>{w.name}</span><Mono>{w.id}</Mono></Space> },
                    { title: L('类型', 'Kind'), render: (_, w) => <LabelTag map={WORKSPACE_KIND_LABELS} value={w.kind} /> },
                    { title: L('组织路径', 'Org path'), render: (_, w) => unitPath(state, w.orgUnitId).map((u) => u.name).join(' / ') },
                    { title: L('车型', 'Model'), dataIndex: 'vehicleModelId' },
                    { title: L('业务分组', 'Groups'), render: (_, w) => w.groupIds.map((g) => <Tag key={g}>{state.groups[g]?.name}</Tag>) },
                    { title: L('范围', 'Scopes'), render: (_, w) => w.scopes.join(', ') },
                    { title: L('来源工作区', 'Sources'), render: (_, w) => w.sourceWorkspaceIds.map((s) => <Tag key={s}>{state.workspaces[s]?.name}</Tag>) },
                    { title: '', render: (_, w) => <Button type="link" size="small" onClick={() => editWorkspace(w)}>{L('编辑', 'Edit')}</Button> },
                  ]}
                />
              </Card>
            ),
          },
          {
            key: 'groups',
            label: L('业务分组', 'Business groups'),
            children: (
              <Card extra={<Button icon={<PlusOutlined />} onClick={() => setModal('group')}>{L('新建分组', 'New group')}</Button>}>
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
                    { title: L('所属节点', 'Unit'), render: (_, g) => unitPath(state, g.orgUnitId).map((u) => u.name).join(' / ') },
                  ]}
                />
              </Card>
            ),
          },
          {
            key: 'models',
            label: L('车型', 'Vehicle models'),
            children: (
              <Card extra={<Button icon={<PlusOutlined />} onClick={() => setModal('model')}>{L('登记车型', 'Register model')}</Button>}>
                <Table rowKey="id" pagination={false} dataSource={Object.values(state.vehicleModels)} columns={[{ title: 'ID', dataIndex: 'id' }, { title: L('名称', 'Name'), dataIndex: 'name' }, { title: L('状态', 'Status'), dataIndex: 'status' }]} />
              </Card>
            ),
          },
        ]}
      />
      <Modal open={modal !== null} title={L('保存', 'Save')} onCancel={close} onOk={save} destroyOnHidden>
        <Form form={form} name="org" layout="vertical" preserve={false} initialValues={{ kind: 'TEAM', purpose: 'DEV', domain: 'Chassis' }}>
          {(modal === 'unit' || modal === 'project' || modal === 'model' || modal === 'group' || modal === 'workspace') && (
            <Form.Item name="id" label="ID" rules={[{ required: true }]}>
              <Input placeholder={modal === 'model' ? 'X91' : 'brake-team'} />
            </Form.Item>
          )}
          {modal !== null && (
            <Form.Item name="name" label={L('名称', 'Name')} rules={[{ required: true }]}>
              <Input />
            </Form.Item>
          )}
          {(modal === 'unit' || (modal !== null && typeof modal === 'object' && 'edit' in modal)) && (
            <Form.Item name="parentId" label={L('上级节点（团队树留空 = 根）', 'Parent (blank for a team root)')}>
              <Select allowClear options={unitOptions} />
            </Form.Item>
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
                <Select mode="multiple" options={Object.values(state.groups).map((g) => ({ value: g.id, label: g.name }))} />
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
    </div>
  );
}
