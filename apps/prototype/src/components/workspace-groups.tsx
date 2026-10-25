// The business groups of the current workspace, for its admin: create a development or testing
// group under the workspace's organization unit, and archive a group no other workspace holds.

import { Button, Form, Input, Modal, Select, Space, Tag, Typography } from 'antd';
import { useState } from 'react';
import { useCan, useRun } from '../app/hooks.ts';
import { useEngineState } from '../app/store.ts';
import { DOMAINS } from '../domain/vocabulary.ts';
import { workspacesOfGroup } from '../engine/lifecycle.ts';
import { createGroup, unitPath, unitWithin } from '../engine/org.ts';
import { useI18n } from '../i18n/i18n.tsx';
import { Mono } from './common.tsx';
import type { LifecycleTarget } from './lifecycle.tsx';

export function WorkspaceGroups({ workspaceId, onArchive }: { workspaceId: string; onArchive: (target: LifecycleTarget) => void }) {
  const state = useEngineState();
  const run = useRun();
  const can = useCan();
  const { L } = useI18n();
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const workspace = state.workspaces[workspaceId]!;
  const groups = workspace.groupIds.map((id) => state.groups[id]!).filter(Boolean);
  const units = Object.values(state.orgUnits).filter((u) => u.status === 'ACTIVE' && unitWithin(state, u.id, workspace.orgUnitId));
  const domains = DOMAINS.filter((d) => workspace.scopes.includes(d));
  const close = () => (setOpen(false), form.resetFields());
  const save = () =>
    form.validateFields().then((v) => {
      const ok = run((c) => createGroup(c, { ...v, workspaceId }), L('已创建，并加入本工作区；创建分组不授予任何人权限', 'Created and added to this workspace; creating a group grants nobody anything'));
      if (ok !== undefined) close();
    });
  return (
    <div style={{ marginTop: 12 }}>
      <Space style={{ width: '100%', justifyContent: 'space-between' }}>
        <Typography.Text strong>{L('业务分组', 'Business groups')}</Typography.Text>
        {can('group.create', { workspaceId }) && (
          <Button size="small" onClick={() => setOpen(true)}>
            {L('新建业务分组…', 'New business group…')}
          </Button>
        )}
      </Space>
      {groups.map((g) => {
        // A group other workspaces also hold is archived by all their admins, or by platform operations.
        const holders = workspacesOfGroup(state, g.id);
        const may = g.status === 'ACTIVE' && holders.every((ws) => can('group.archive', { workspaceId: ws }));
        return (
          <Space key={g.id} style={{ width: '100%', justifyContent: 'space-between', padding: '4px 0' }}>
            <Space size={6} wrap>
              <span>{g.name}</span>
              <Mono>{g.code}</Mono>
              <Tag>{g.purpose === 'DEV' ? L('研发', 'Development') : L('测试', 'Testing')}</Tag>
              {g.status === 'ARCHIVED' && <Tag color="red">{L('已归档', 'Archived')}</Tag>}
              {holders.length > 1 && <Typography.Text type="secondary">{L(`${holders.length} 个工作区持有`, `held by ${holders.length} workspaces`)}</Typography.Text>}
            </Space>
            {may && (
              <Button type="link" danger size="small" onClick={() => onArchive({ object: 'group', action: 'archive', id: g.id })}>
                {L('归档…', 'Archive…')}
              </Button>
            )}
          </Space>
        );
      })}
      <Modal open={open} title={L('新建业务分组', 'New business group')} onCancel={close} onOk={save} destroyOnHidden>
        <Form form={form} name="workspace-group" layout="vertical" preserve={false} initialValues={{ purpose: 'DEV', domain: domains[0], orgUnitId: workspace.orgUnitId }}>
          <Form.Item name="id" label="ID" rules={[{ required: true }]}>
            <Input placeholder="brake-lab" />
          </Form.Item>
          <Form.Item name="name" label={L('名称', 'Name')} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="code" label={L('分组代码（点分，例：chassis.brake）', 'Group code (dotted, e.g. chassis.brake)')} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Space>
            <Form.Item name="domain" label={L('域（本工作区范围内）', 'Domain (within this workspace)')}>
              <Select style={{ width: 180 }} options={domains.map((d) => ({ value: d, label: d }))} />
            </Form.Item>
            <Form.Item name="purpose" label={L('用途', 'Purpose')}>
              <Select style={{ width: 160 }} options={[{ value: 'DEV', label: L('研发', 'Development') }, { value: 'TEST', label: L('测试', 'Testing') }]} />
            </Form.Item>
          </Space>
          <Form.Item name="orgUnitId" label={L('所属节点（本工作区节点或下级）', 'Organization unit (this workspace’s or below)')} rules={[{ required: true }]}>
            <Select options={units.map((u) => ({ value: u.id, label: unitPath(state, u.id).map((p) => p.name).join(' / ') }))} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
