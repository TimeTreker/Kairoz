// The simulated company directory card (公司目录): plays HR / LDAP so the platform has something to
// sync from. Changes here reach the platform only through a sync.

import { App, Button, Card, Input, Modal, Select, Space, Table, Tag, Typography } from 'antd';
import { useState } from 'react';
import { useErrorText } from '../app/hooks.ts';
import { engine, useEngineState } from '../app/store.ts';
import { addDepartment, hirePerson, mergeDepartment, personLeaves, renameDepartment, syncIfChanged, transferPerson } from '../engine/company-directory.ts';
import type { Ctx } from '../engine/engine.ts';
import { useI18n } from '../i18n/i18n.tsx';
import { Mono } from './common.tsx';

type Prompt =
  | { kind: 'hire' }
  | { kind: 'department' }
  | { kind: 'transfer'; employeeId: string }
  | { kind: 'rename'; extId: string }
  | { kind: 'merge'; extId: string };

export function CompanyDirectoryCard() {
  const state = useEngineState();
  const { L } = useI18n();
  const { message } = App.useApp();
  const errorText = useErrorText();
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [text, setText] = useState({ username: '', name: '', dept: '' });
  const dir = state.directory;

  const system = <R,>(op: (c: Ctx) => R, ok?: string) => {
    try {
      const r = engine.run(null, op);
      if (ok) message.success(ok);
      return r;
    } catch (e) {
      message.error(errorText(e));
      return undefined;
    }
  };

  if (!dir) {
    return (
      <Card title={L('公司目录（模拟 HR / LDAP）', 'Company directory (simulated HR / LDAP)')}>
        <Typography.Text type="secondary">{L('本安装未接入公司目录；团队组织由平台运维维护。', 'This installation has no company directory; platform ops maintain the team organization.')}</Typography.Text>
      </Card>
    );
  }
  const active = dir.departments.filter((d) => d.status === 'ACTIVE');
  const deptName = (extId: string) => dir.departments.find((d) => d.extId === extId)?.name ?? extId;
  const deptOptions = (except?: string) => active.filter((d) => d.extId !== except).map((d) => ({ value: d.extId, label: `${d.name} · ${d.extId}` }));
  const open = (p: Prompt) => (setText({ username: '', name: '', dept: '' }), setPrompt(p));
  const pending = dir.revision !== state.directorySync.revision;

  const submit = () => {
    if (!prompt) return;
    const ok =
      prompt.kind === 'hire'
        ? system((c) => hirePerson(c, { username: text.username, displayName: text.name, deptExtId: text.dept }), L('已入职（待同步）', 'Hired (to sync)'))
        : prompt.kind === 'department'
          ? system((c) => addDepartment(c, { name: text.name, parentExtId: text.dept }), L('已新建部门（待同步）', 'Department added (to sync)'))
          : prompt.kind === 'transfer'
            ? system((c) => transferPerson(c, prompt.employeeId, text.dept), L('已调岗（待同步）', 'Transferred (to sync)'))
            : prompt.kind === 'rename'
              ? system((c) => renameDepartment(c, prompt.extId, text.name), L('已改名（待同步）', 'Renamed (to sync)'))
              : system((c) => mergeDepartment(c, prompt.extId, text.dept), L('已合并（待同步）', 'Merged (to sync)'));
    if (ok !== undefined) setPrompt(null);
  };

  return (
    <Card
      title={L('公司目录（模拟 HR / LDAP）', 'Company directory (simulated HR / LDAP)')}
      extra={
        <Space wrap>
          <Tag color={pending ? 'gold' : 'green'}>
            {pending ? L(`待同步：目录修订 ${dir.revision}，已同步 ${state.directorySync.revision}`, `To sync: revision ${dir.revision}, synced ${state.directorySync.revision}`) : L(`已同步修订 ${dir.revision}`, `Synced revision ${dir.revision}`)}
          </Tag>
          <Button size="small" type="primary" disabled={!pending} onClick={() => system((c) => syncIfChanged(c), L('已同步到平台', 'Synced to the platform'))}>
            {L('同步到平台', 'Sync to platform')}
          </Button>
        </Space>
      }
    >
      <Typography.Paragraph type="secondary">
        {L(
          '这里扮演公司的人事目录（真实系统中是 HR、LDAP/AD 或 SCIM 推送）。平台只通过同步读取：部门成为只读的团队组织节点，人员成为带组织归属的账号。自动运行时，模拟器每一步都会同步变化。',
          'This plays the company’s people directory (HR, LDAP/AD or a SCIM feed in a real system). The platform reads it only by syncing: departments become read-only team units, people become accounts with their unit. With auto-run on, every simulator step syncs changes.',
        )}
      </Typography.Paragraph>
      <Space style={{ marginBottom: 8 }} wrap>
        <Button size="small" onClick={() => open({ kind: 'hire' })}>
          {L('入职', 'Hire')}
        </Button>
        <Button size="small" onClick={() => open({ kind: 'department' })}>
          {L('新建部门', 'New department')}
        </Button>
      </Space>
      <Table
        rowKey="employeeId"
        size="small"
        pagination={{ pageSize: 10, hideOnSinglePage: true }}
        dataSource={dir.people}
        columns={[
          { title: L('工号', 'Employee'), render: (_, p) => <Mono>{p.employeeId}</Mono> },
          { title: L('姓名', 'Name'), render: (_, p) => `${p.displayName} · ${p.username}` },
          { title: L('部门', 'Department'), render: (_, p) => deptName(p.deptExtId) },
          { title: L('状态', 'Status'), render: (_, p) => (p.status === 'ACTIVE' ? <Tag color="green">{L('在职', 'Active')}</Tag> : <Tag>{L('已离职', 'Left')}</Tag>) },
          {
            title: '',
            render: (_, p) =>
              p.status === 'ACTIVE' && (
                <Space size={0}>
                  <Button type="link" size="small" onClick={() => open({ kind: 'transfer', employeeId: p.employeeId })}>
                    {L('调岗', 'Transfer')}
                  </Button>
                  <Button type="link" size="small" danger onClick={() => system((c) => personLeaves(c, p.employeeId), L('已离职（待同步）', 'Left (to sync)'))}>
                    {L('离职', 'Leaves')}
                  </Button>
                </Space>
              ),
          },
        ]}
      />
      <Table
        rowKey="extId"
        size="small"
        style={{ marginTop: 12 }}
        pagination={{ pageSize: 20, hideOnSinglePage: true }}
        dataSource={dir.departments}
        columns={[
          { title: L('部门', 'Department'), render: (_, d) => <Space><span>{d.name}</span><Mono>{d.extId}</Mono></Space> },
          { title: L('上级', 'Parent'), render: (_, d) => (d.parentExtId ? deptName(d.parentExtId) : '—') },
          { title: L('人数', 'People'), render: (_, d) => dir.people.filter((p) => p.deptExtId === d.extId && p.status === 'ACTIVE').length },
          { title: L('状态', 'Status'), render: (_, d) => (d.status === 'ACTIVE' ? <Tag color="green">{L('存在', 'Active')}</Tag> : <Tag>{L('已撤销', 'Removed')}</Tag>) },
          {
            title: '',
            render: (_, d) =>
              d.status === 'ACTIVE' && (
                <Space size={0}>
                  <Button type="link" size="small" onClick={() => open({ kind: 'rename', extId: d.extId })}>
                    {L('改名', 'Rename')}
                  </Button>
                  {d.parentExtId && (
                    <Button type="link" size="small" danger onClick={() => open({ kind: 'merge', extId: d.extId })}>
                      {L('合并到…', 'Merge into…')}
                    </Button>
                  )}
                </Space>
              ),
          },
        ]}
      />
      <Modal
        open={prompt !== null}
        title={
          prompt?.kind === 'hire'
            ? L('入职', 'Hire')
            : prompt?.kind === 'department'
              ? L('新建部门', 'New department')
              : prompt?.kind === 'transfer'
                ? L('调岗', 'Transfer')
                : prompt?.kind === 'rename'
                  ? L(`部门改名 · ${deptName(prompt.extId)}`, `Rename · ${deptName(prompt.extId)}`)
                  : prompt?.kind === 'merge'
                    ? L(`合并部门 · ${deptName(prompt.extId)}`, `Merge · ${deptName(prompt.extId)}`)
                    : ''
        }
        onCancel={() => setPrompt(null)}
        onOk={submit}
      >
        <Space orientation="vertical" style={{ width: '100%' }}>
          {prompt?.kind === 'hire' && <Input placeholder={L('账号名，例如 brake_dev2', 'Username, e.g. brake_dev2')} value={text.username} onChange={(e) => setText({ ...text, username: e.target.value })} />}
          {(prompt?.kind === 'hire' || prompt?.kind === 'department' || prompt?.kind === 'rename') && (
            <Input placeholder={prompt.kind === 'hire' ? L('姓名', 'Name') : L('部门名称', 'Department name')} value={text.name} onChange={(e) => setText({ ...text, name: e.target.value })} />
          )}
          {prompt && prompt.kind !== 'rename' && (
            <Select
              style={{ width: '100%' }}
              placeholder={prompt.kind === 'department' ? L('上级部门', 'Parent department') : prompt.kind === 'merge' ? L('合并到', 'Merge into') : L('部门', 'Department')}
              value={text.dept || undefined}
              onChange={(v) => setText({ ...text, dept: v })}
              options={deptOptions(prompt.kind === 'merge' ? prompt.extId : undefined)}
            />
          )}
          {prompt?.kind === 'merge' && (
            <Typography.Text type="secondary">{L('人员与下级部门转入目标部门，原部门撤销；同步后挂在它上面的工作区需要重新挂靠。', 'People and subdepartments move to the target and the department is removed; after the sync, workspaces on it need re-attaching.')}</Typography.Text>
          )}
        </Space>
      </Modal>
    </Card>
  );
}
