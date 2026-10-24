import { MinusCircleOutlined, PlusOutlined } from '@ant-design/icons';
import { Button, Card, Col, Collapse, Empty, Form, Input, Modal, Row, Select, Space, Switch, Table, Tabs, Tag, Timeline, Tooltip, Typography } from 'antd';
import { useState } from 'react';
import { useActor, useCan, useRun, useWorkspace } from '../app/hooks.ts';
import { engine, useEngineState } from '../app/store.ts';
import { ClientReportDrawer } from '../components/client-report.tsx';
import { PersonalSims } from '../components/personal-sim.tsx';
import { SimSoftwareDrawer, isDerivedImage } from '../components/sim-software.tsx';
import { catalogImages } from '../engine/sim-software.ts';
import { EnvTag, Hint, LabelTag, Mono, PageHeader, ShortId, configName, when } from '../components/common.tsx';
import { ENVS, SCOPES } from '../domain/vocabulary.ts';
import {
  addGroupMember,
  addWorkspaceVehicle,
  archiveVehicleGroup,
  assignableVehicles,
  confirmIntegration,
  createSimulation,
  createVehicleGroup,
  managedResources,
  membersOf,
  pendingDeploymentOf,
  publicationLabel,
  recordSoftwareVersion,
  registerImage,
  registerPhysical,
  releaseReservation,
  removeGroupMember,
  removeWorkspaceVehicle,
  reportControllers,
  reserveVehicle,
  setGroupApproval,
  setGroupBase,
  setResourceStatus,
  setSoftwareManifest,
  startSimulation,
  stopSimulation,
  vehicleGroupsOf,
  workspaceVehicles,
} from '../engine/fleet.ts';
import { registerDeviceKey } from '../engine/client-report.ts';
import { displayName } from '../engine/config.ts';
import { devicePublicKey, provisionDevice } from '../engine/simulator.ts';
import { decideTestRequest, testRequestsOf } from '../engine/validation.ts';
import { answerConfigRequest } from '../engine/ota.ts';
import { compareVersions, releasesOf } from '../engine/release.ts';
import type { Resource, SoftwareVersion, State, TestRequest } from '../engine/types.ts';
import { sha256Hex } from '../domain/canonical.ts';
import { useI18n } from '../i18n/i18n.tsx';
import { CONFIG_ANSWER_LABELS, ENV_LABELS, GROUP_EVENT_LABELS, REQUEST_STATUS_COLORS, REQUEST_STATUS_LABELS, RESOURCE_STATUS_LABELS, RESOURCE_TYPE_LABELS, VEHICLE_GROUP_PURPOSE_LABELS, setName } from '../i18n/vocab.ts';
import { issueLabel } from '../i18n/issues.ts';
import { navigate } from '../app/router.ts';

const ANSWER_COLORS: Record<string, string> = { PERSONAL: 'purple', GROUP_TARGET: 'blue', REPUBLISH: 'gold', BASE_CONFLICT: 'red', NO_BASE: 'red', HELD: 'purple', TASK: 'processing', APPLIED: 'default', INITIAL: 'default', BLOCKED: 'red' };

function VehicleTable({ vehicles, extra }: { vehicles: Resource[]; extra?: (r: Resource) => React.ReactNode }) {
  const state = useEngineState();
  const { L, B } = useI18n();
  return (
    <Table
      rowKey="id"
      dataSource={vehicles}
      pagination={{ pageSize: 20, hideOnSinglePage: true }}
      scroll={{ x: 1000 }}
      locale={{ emptyText: L('没有车辆', 'No vehicles') }}
      columns={[
        {
          title: L('车辆', 'Vehicle'),
          render: (_, r) => (
            <Space orientation="vertical" size={0}>
              <Mono>{r.id}</Mono>
              <Typography.Text type="secondary">{r.displayName}</Typography.Text>
              {r.personal && <Tag color="purple">{L('个人', 'Personal')} · {state.accounts[r.personal.owner]?.displayName ?? r.personal.owner}</Tag>}
            </Space>
          ),
        },
        { title: L('类型', 'Type'), render: (_, r) => <LabelTag map={RESOURCE_TYPE_LABELS} value={r.type} color={r.type === 'PHYSICAL' ? 'blue' : 'cyan'} /> },
        { title: 'VIN / UVID', render: (_, r) => <Mono>{r.vin ?? r.uvid ?? '—'}</Mono> },
        { title: L('环境 / 资源池', 'Env / pool'), render: (_, r) => <Space size={4}><EnvTag env={r.env} /><span>{r.pool}</span></Space> },
        {
          title: L('实际整车版本', 'Actual software'),
          render: (_, r) =>
            r.softwareStatus === 'PARTIAL_FAILURE' ? (
              <Tooltip title={r.controllers.map((c) => `${c.name} ${c.version} ${c.status}`).join(' · ')}>
                <Tag color="red">{L('部分域控失败', 'Partial controller failure')}</Tag>
              </Tooltip>
            ) : r.integrationVersion ? (
              <Tooltip title={r.controllers.length ? r.controllers.map((c) => `${c.name} ${c.version}`).join(' · ') : r.integrationSource}>
                <span>
                  {r.vehicleModelId} {r.integrationVersion}
                  {isDerivedImage(state, r.imageId) && <Tag color="purple" style={{ marginLeft: 4 }}>{L('派生镜像', 'Derived image')}</Tag>}
                </span>
              </Tooltip>
            ) : isDerivedImage(state, r.imageId) ? (
              <Tag color="purple">{L('派生镜像', 'Derived image')}</Tag>
            ) : (
              <Typography.Text type="secondary">{L('尚未获取', 'Unknown')}</Typography.Text>
            ),
        },
        { title: L('已生效配置', 'Applied configuration'), render: (_, r) => <Mono>{B(configName(state, r.appliedConfigId))}</Mono> },
        {
          title: L('车辆组 / 下发', 'Group / dispatch'),
          render: (_, r) => {
            const g = state.vehicleGroups[state.groupMembers[r.id] ?? ''];
            const pending = pendingDeploymentOf(state, r.id);
            return (
              <Space size={4} wrap>
                {g ? <Tag>{g.name}</Tag> : !r.personal && <Typography.Text type="secondary">{L('未分组', 'Ungrouped')}</Typography.Text>}
                {pending && <Tag color="processing">{L('等待回执', 'Awaiting receipt')}</Tag>}
                {r.instance && <Tag color={r.instance === 'RUNNING' ? 'green' : 'default'}>{r.instance === 'RUNNING' ? L('实例运行中', 'running') : L('实例已停止', 'stopped')}</Tag>}
                {r.reservation && (
                  <Tooltip title={`${state.accounts[r.reservation.by]?.displayName} · ${when(r.reservation.at)}`}>
                    <Tag color="gold">{L(`预约：${r.reservation.purpose}`, `Reserved: ${r.reservation.purpose}`)}</Tag>
                  </Tooltip>
                )}
              </Space>
            );
          },
        },
        { title: L('状态', 'Status'), render: (_, r) => (r.personal && r.status === 'RETIRED' ? L('已释放', 'Released') : B(RESOURCE_STATUS_LABELS[r.status])) },
        ...(extra ? [{ title: '', render: (_: unknown, r: Resource) => extra(r) }] : []),
      ]}
    />
  );
}

function WorkspaceVehicles() {
  const state = useEngineState();
  const { workspace } = useWorkspace();
  const { L } = useI18n();
  const can = useCan();
  const run = useRun();
  const [adding, setAdding] = useState(false);
  const [creating, setCreating] = useState(false);
  const [reserving, setReserving] = useState<Resource | null>(null);
  const [purpose, setPurpose] = useState('');
  const [clientOf, setClientOf] = useState<string | null>(null);
  const [imageOf, setImageOf] = useState<string | null>(null);
  const [form] = Form.useForm();
  if (!workspace) return null;
  const vehicles = workspaceVehicles(state, workspace.id);
  const canManage = ENVS.some((env) => can('workspace.resources', { workspaceId: workspace.id, env }));
  const canSim = ENVS.some((env) => can('simulation.manage', { workspaceId: workspace.id, env }));
  const manages = (r: Resource) => can('workspace.resources', { workspaceId: workspace.id, scope: r.pool, env: r.env });
  const runsSim = (r: Resource) => r.type === 'SIMULATION' && can('simulation.manage', { workspaceId: r.homeWorkspaceId ?? workspace.id, scope: r.pool, env: r.env });
  const images = catalogImages(state, workspace.vehicleModelId);
  return (
    <Card
      extra={
        <Space>
          {canSim && (
            <Button icon={<PlusOutlined />} onClick={() => (form.resetFields(), setCreating(true))}>
              {L('创建仿真车', 'New simulation')}
            </Button>
          )}
          {canManage && (
            <Button icon={<PlusOutlined />} onClick={() => setAdding(true)}>
              {L('从资源池加入车辆', 'Add a vehicle')}
            </Button>
          )}
        </Space>
      }
    >
      <Hint>{L('工作区只获得车辆的使用权；车辆的身份、归属资源池与环境由车辆资源管理员维护。', 'A workspace only gains use of vehicles; identity, pool and environment are maintained by vehicle resources.')}</Hint>
      <VehicleTable
        vehicles={vehicles}
        extra={(r) => (
          <Space size={0} wrap>
            {runsSim(r) &&
              (r.instance === 'RUNNING' ? (
                <Button type="link" size="small" onClick={() => run((c) => stopSimulation(c, r.id), L('已停止实例', 'Instance stopped'))}>
                  {L('停止', 'Stop')}
                </Button>
              ) : (
                <Button type="link" size="small" onClick={() => run((c) => startSimulation(c, r.id), L('已启动实例', 'Instance started'))}>
                  {L('启动', 'Start')}
                </Button>
              ))}
            {manages(r) &&
              (r.reservation ? (
                <Button type="link" size="small" onClick={() => run((c) => releaseReservation(c, workspace.id, r.id), L('已解除预约', 'Reservation released'))}>
                  {L('解除预约', 'Release')}
                </Button>
              ) : (
                <Button type="link" size="small" onClick={() => (setPurpose(''), setReserving(r))}>
                  {L('预约', 'Reserve')}
                </Button>
              ))}
            {runsSim(r) && (
              <Button type="link" size="small" onClick={() => setImageOf(r.id)}>
                {L('运行镜像', 'Running image')}
              </Button>
            )}
            {can('clientReport.read', { workspaceId: workspace.id, env: r.env }) && (
              <Button type="link" size="small" onClick={() => setClientOf(r.id)}>
                {L('客户端状态', 'Client state')}
              </Button>
            )}
            {manages(r) && (
              <Button type="link" size="small" danger onClick={() => run((c) => removeWorkspaceVehicle(c, workspace.id, r.id), L('已移出工作区', 'Removed from the workspace'))}>
                {L('移出', 'Remove')}
              </Button>
            )}
          </Space>
        )}
      />
      <ClientReportDrawer resourceId={clientOf} workspaceId={workspace.id} onClose={() => setClientOf(null)} />
      <SimSoftwareDrawer resourceId={imageOf} onClose={() => setImageOf(null)} />
      <Modal
        open={reserving !== null}
        title={`${L('预约车辆', 'Reserve vehicle')} · ${reserving?.id}`}
        onCancel={() => setReserving(null)}
        onOk={() => {
          if (run((c) => reserveVehicle(c, workspace.id, reserving!.id, purpose), L('已预约', 'Reserved')) !== undefined) setReserving(null);
        }}
      >
        <Hint>{L('预约期间车辆不能移出工作区或车辆组；任务结束后解除预约。', 'While reserved the vehicle cannot leave the workspace or its group; release it when the task ends.')}</Hint>
        <Input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder={L('用途，例如：制动首版验证', 'Purpose, e.g. first brake validation')} />
      </Modal>
      <Modal open={adding} title={L('加入车辆', 'Add a vehicle')} footer={null} onCancel={() => setAdding(false)}>
        <Hint>{L('只列出车型、资源池与环境都符合本工作区的车辆；量产车辆只能分配给项目或集成工作区。', 'Only vehicles whose model, pool and environment fit; production vehicles only go to project or integration workspaces.')}</Hint>
        <Table
          rowKey="id"
          size="small"
          pagination={false}
          dataSource={assignableVehicles(state, workspace.id)}
          locale={{ emptyText: L('没有可加入的车辆', 'No vehicles to add') }}
          columns={[
            { title: L('车辆', 'Vehicle'), render: (_, r) => <Mono>{r.id}</Mono> },
            { title: L('类型', 'Type'), render: (_, r) => r.type },
            { title: L('环境', 'Env'), render: (_, r) => <EnvTag env={r.env} /> },
            { title: L('资源池', 'Pool'), dataIndex: 'pool' },
            {
              title: '',
              render: (_, r) => (
                <Button size="small" type="primary" onClick={() => run((c) => addWorkspaceVehicle(c, workspace.id, r.id), L('已加入', 'Added'))}>
                  {L('加入', 'Add')}
                </Button>
              ),
            },
          ]}
        />
      </Modal>
      <Modal
        open={creating}
        title={L('创建仿真车', 'New simulation instance')}
        onCancel={() => setCreating(false)}
        onOk={() =>
          form.validateFields().then((v) => {
            if (run((c) => createSimulation(c, { ...v, workspaceId: workspace.id }), L('已创建', 'Created')) !== undefined) setCreating(false);
          })
        }
      >
        <Form form={form} name="sim" layout="vertical" initialValues={{ env: 'development', pool: workspace.scopes[0] }}>
          <Form.Item name="id" label="ID" rules={[{ required: true, pattern: /^[A-Z][A-Z0-9-]{2,40}$/ }]}>
            <Input placeholder="SIM-022" />
          </Form.Item>
          <Form.Item name="displayName" label={L('名称', 'Name')}>
            <Input />
          </Form.Item>
          <Form.Item name="imageId" label={L('运行镜像（整车版本由镜像决定）', 'Runtime image (decides the software version)')} rules={[{ required: true }]}>
            <Select options={images.map((i) => ({ value: i.id, label: `${i.id} · ${i.integrationVersion ?? L('无整车版本', 'no software version')}` }))} />
          </Form.Item>
          <Space>
            <Form.Item name="env" label={L('环境', 'Environment')}>
              <Select style={{ width: 140 }} options={['development', 'testing'].map((e) => ({ value: e, label: e }))} />
            </Form.Item>
            <Form.Item name="pool" label={L('资源池', 'Pool')}>
              <Select style={{ width: 140 }} options={workspace.scopes.map((p) => ({ value: p, label: p }))} />
            </Form.Item>
          </Space>
        </Form>
      </Modal>
    </Card>
  );
}

function VehicleGroups() {
  const state = useEngineState();
  const { workspace } = useWorkspace();
  const { L, B } = useI18n();
  const can = useCan();
  const run = useRun();
  const [creating, setCreating] = useState(false);
  const [member, setMember] = useState<{ groupId: string; action: 'add' | 'remove'; resourceId?: string } | null>(null);
  const [form] = Form.useForm();
  const [memberForm] = Form.useForm();
  if (!workspace) return null;
  const groups = vehicleGroupsOf(state, workspace.id);
  const canCreate = ENVS.some((env) => can('vehicleGroup.manage', { workspaceId: workspace.id, env }));

  return (
    <Space orientation="vertical" size={16} style={{ width: '100%' }}>
      <Hint>
        {L(
          '车辆组是持久的配置路由：每辆车全平台只属于一个车辆组。下发时冻结成员快照；之后新加入的车辆不会加入旧任务。',
          'A vehicle group is a persistent configuration route: each vehicle belongs to one group platform-wide. Dispatches freeze the member list; vehicles added later do not join old dispatches.',
        )}
      </Hint>
      {canCreate && (
        <Button icon={<PlusOutlined />} onClick={() => (form.resetFields(), setCreating(true))}>
          {L('创建车辆组', 'New vehicle group')}
        </Button>
      )}
      <TestRequests workspaceId={workspace.id} />
      {groups.length === 0 && <Empty description={L('本工作区还没有车辆组', 'No vehicle groups in this workspace')} />}
      <Row gutter={[16, 16]}>
        {groups.map((g) => {
          const members = membersOf(state, g.id);
          const canManage = g.status === 'ACTIVE' && can('vehicleGroup.manage', { workspaceId: g.workspaceId, env: g.env });
          const events = state.vehicleGroupEvents.filter((e) => e.vehicleGroupId === g.id).reverse();
          return (
            <Col xs={24} xl={12} key={g.id}>
              <Card
                title={
                  <Space>
                    <span>{g.name}</span>
                    <LabelTag map={VEHICLE_GROUP_PURPOSE_LABELS} value={g.purpose} />
                    <EnvTag env={g.env} />
                    {g.requiresApproval && <Tag color="purple">{L('下发需审批', 'Approval required')}</Tag>}
                    {g.status === 'ARCHIVED' && <Tag>{L('已归档', 'Archived')}</Tag>}
                  </Space>
                }
                extra={
                  canManage && (
                    <Space>
                      <Button size="small" onClick={() => (memberForm.resetFields(), setMember({ groupId: g.id, action: 'add' }))}>
                        {L('加入车辆', 'Add vehicle')}
                      </Button>
                      {g.purpose !== 'PRODUCTION' && (
                        <Tooltip title={L('开启后，向本组下发需先提交团队测试申请并由工作区管理员批准', 'When on, dispatches to this group need a team test request approved by the workspace admin')}>
                          <Switch
                            size="small"
                            checked={g.requiresApproval}
                            checkedChildren={L('审批', 'approval')}
                            unCheckedChildren={L('直接', 'direct')}
                            onChange={(v) => run((c) => setGroupApproval(c, g.id, v), v ? L('已要求审批', 'Approval required') : L('已改为直接下发', 'Direct dispatch'))}
                          />
                        </Tooltip>
                      )}
                      {members.length === 0 && (
                        <Button size="small" danger onClick={() => run((c) => archiveVehicleGroup(c, g.id, L('不再使用', 'No longer used')), L('已归档', 'Archived'))}>
                          {L('归档', 'Archive')}
                        </Button>
                      )}
                    </Space>
                  )
                }
              >
                <Space orientation="vertical" style={{ width: '100%' }}>
                  <Typography.Text type="secondary">
                    {g.groupId ? `${L('业务分组', 'Business group')}: ${state.groups[g.groupId]?.name} · ` : ''}
                    {L('已发布', 'Published')}: <Mono>{g.publication ? publicationLabel(state, g.publication) : '—'}</Mono> · {L('绑定修订', 'binding rev.')} {g.bindingRevision}
                  </Typography.Text>
                  {g.publication?.kind === 'FEATURE' && g.publication.disabledPolicies.length > 0 && (
                    <Typography.Text type="secondary">
                      {L('已关闭的策略', 'Switched off')}: {g.publication.disabledPolicies.map((p) => <Tag key={p}>{p}</Tag>)}
                    </Typography.Text>
                  )}
                  {g.purpose !== 'PRODUCTION' && (
                    <Space size={8} wrap>
                      <Typography.Text type="secondary">{L('基线', 'Base')}:</Typography.Text>
                      {canManage ? (
                        <Select
                          size="small"
                          style={{ minWidth: 220 }}
                          value={g.baseReleaseId ?? ''}
                          onChange={(v) => run((c) => setGroupBase(c, g.id, v || null), v ? L('已指定显式基线，下次下发生效', 'Explicit base set; it applies from the next publish') : L('已恢复按车辆软件取基线', 'Back to each vehicle’s software'))}
                          options={[
                            { value: '', label: L('跟随每辆车的软件版本', 'Follow each vehicle’s software') },
                            ...releasesOf(state, workspace.vehicleModelId).map((r) => ({ value: r.id, label: `${L('显式基线', 'Explicit base')}: ${B(setName(r.dclVersion))}` })),
                          ]}
                        />
                      ) : (
                        <Typography.Text>{g.baseReleaseId ? `${L('显式基线', 'Explicit base')}: ${B(setName(state.releases[g.baseReleaseId]!.dclVersion))}` : L('跟随每辆车的软件版本', 'Follows each vehicle’s software')}</Typography.Text>
                      )}
                    </Space>
                  )}
                  <Table
                    rowKey={(r) => r}
                    size="small"
                    pagination={false}
                    dataSource={members}
                    locale={{ emptyText: L('没有车辆', 'No vehicles') }}
                    columns={[
                      { title: L('车辆', 'Vehicle'), render: (_, id) => <Mono>{id}</Mono> },
                      { title: L('类型', 'Type'), render: (_, id) => B(RESOURCE_TYPE_LABELS[state.resources[id]!.type]) },
                      { title: L('软件', 'Software'), render: (_, id) => state.resources[id]!.integrationVersion ?? <Tag color="orange">{L('未知', 'unknown')}</Tag> },
                      { title: L('已生效', 'Applied'), render: (_, id) => <Mono>{B(configName(state, state.resources[id]!.appliedConfigId))}</Mono> },
                      ...(g.purpose === 'PRODUCTION'
                        ? []
                        : [
                            {
                              title: L('应运行', 'Should run'),
                              render: (_: unknown, id: string) => {
                                const a = answerConfigRequest(state, id);
                                const due = a.reason === 'GROUP_TARGET' && a.configId !== state.resources[id]!.appliedConfigId;
                                return (
                                  <Tooltip title={a.detail ? B(issueLabel(a.detail), a.detail) : undefined}>
                                    <Space size={4} wrap>
                                      <Tag color={ANSWER_COLORS[a.reason] ?? 'default'}>{B(CONFIG_ANSWER_LABELS[a.reason])}</Tag>
                                      {a.reason === 'GROUP_TARGET' && <Mono>{B(configName(state, a.configId))}</Mono>}
                                      {/* Not applied: a receipt is on its way, or (after an image change) nothing was sent yet. */}
                                      {due && (pendingDeploymentOf(state, id) ? <Tag color="gold">{L('待回执', 'awaiting receipt')}</Tag> : <Tag color="gold">{L('需重新下发', 'publish again')}</Tag>)}
                                    </Space>
                                  </Tooltip>
                                );
                              },
                            },
                          ]),
                      {
                        title: '',
                        render: (_, id) =>
                          canManage && (
                            <Button type="link" size="small" danger onClick={() => (memberForm.resetFields(), setMember({ groupId: g.id, action: 'remove', resourceId: id }))}>
                              {L('移出', 'Remove')}
                            </Button>
                          ),
                      },
                    ]}
                  />
                  <Collapse
                    size="small"
                    items={[
                      {
                        key: 'events',
                        label: `${L('车辆组审计', 'Group audit')} · ${events.length}`,
                        children: (
                          <Timeline
                            items={events.map((e) => ({
                              content: (
                                <span>
                                  <LabelTag map={GROUP_EVENT_LABELS} value={e.kind} />
                                  {e.resourceId && <Mono>{e.resourceId}</Mono>} {e.reason} · {state.accounts[e.actor]?.displayName} · {when(e.createdAt)}
                                </span>
                              ),
                            }))}
                          />
                        ),
                      },
                    ]}
                  />
                </Space>
              </Card>
            </Col>
          );
        })}
      </Row>
      <Modal
        open={creating}
        title={L('创建车辆组', 'New vehicle group')}
        onCancel={() => setCreating(false)}
        onOk={() =>
          form.validateFields().then((v) => {
            if (run((c) => createVehicleGroup(c, { workspaceId: workspace.id, groupId: v.groupId ?? null, name: v.name, purpose: v.purpose, env: v.env, requiresApproval: !!v.requiresApproval }), L('已创建', 'Created')) !== undefined) setCreating(false);
          })
        }
      >
        <Form form={form} name="vehicle-group" layout="vertical" initialValues={{ purpose: workspace.kind === 'TEAM' ? 'DEV' : 'TEST', env: workspace.kind === 'TEAM' ? 'development' : 'testing', groupId: workspace.groupIds[0] }}>
          <Form.Item name="name" label={L('名称', 'Name')} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          {workspace.kind === 'TEAM' && (
            <Form.Item name="groupId" label={L('服务的业务分组', 'Business group served')} rules={[{ required: true }]}>
              <Select options={workspace.groupIds.map((id) => ({ value: id, label: state.groups[id]?.name }))} />
            </Form.Item>
          )}
          <Space>
            <Form.Item name="purpose" label={L('用途', 'Purpose')}>
              <Select style={{ width: 140 }} options={(workspace.kind === 'TEAM' ? ['DEV', 'TEST'] : ['TEST', 'PRODUCTION']).map((p) => ({ value: p, label: B(VEHICLE_GROUP_PURPOSE_LABELS[p]) }))} />
            </Form.Item>
            <Form.Item name="env" label={L('环境', 'Environment')}>
              <Select style={{ width: 140 }} options={ENVS.map((e) => ({ value: e, label: B(ENV_LABELS[e]) }))} />
            </Form.Item>
          </Space>
          <Form.Item name="requiresApproval" label={L('下发需审批（团队测试申请）', 'Dispatch needs approval (team test requests)')} valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        open={member !== null}
        title={member?.action === 'add' ? L('加入车辆', 'Add vehicle') : L('移出车辆', 'Remove vehicle')}
        onCancel={() => setMember(null)}
        onOk={() =>
          memberForm.validateFields().then((v) => {
            const m = member!;
            const ok =
              m.action === 'add'
                ? run((c) => addGroupMember(c, m.groupId, v.resourceId, v.reason), L('已加入', 'Added'))
                : run((c) => removeGroupMember(c, m.groupId, m.resourceId!, v.reason), L('已移出', 'Removed'));
            if (ok !== undefined) setMember(null);
          })
        }
      >
        <Form form={memberForm} name="member" layout="vertical">
          {member?.action === 'add' && (
            <Form.Item name="resourceId" label={L('车辆', 'Vehicle')} rules={[{ required: true }]}>
              <Select
                options={workspaceVehicles(state, workspace.id)
                  .filter((r) => !state.groupMembers[r.id])
                  .map((r) => ({ value: r.id, label: `${r.id} · ${r.type} · ${r.env}` }))}
              />
            </Form.Item>
          )}
          <Form.Item name="reason" label={L('原因（写入车辆组审计）', 'Reason (recorded in the group audit)')} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}

/** Team test requests of the workspace; the workspace admin decides pending ones. */
function TestRequests({ workspaceId }: { workspaceId: string }) {
  const state = useEngineState();
  const actor = useActor()!;
  const { L, B } = useI18n();
  const can = useCan();
  const run = useRun();
  const [deciding, setDeciding] = useState<{ req: TestRequest; decision: 'APPROVED' | 'REJECTED' } | null>(null);
  const [note, setNote] = useState('');
  const requests = testRequestsOf(state, workspaceId);
  if (requests.length === 0) return null;
  const canDecide = (r: TestRequest) => can('testRequest.decide', { workspaceId, env: state.vehicleGroups[r.vehicleGroupIds[0]!]?.env ?? 'development' }) && r.requestedBy !== actor.username;
  return (
    <Card size="small" title={`${L('团队测试申请', 'Team test requests')} · ${requests.filter((r) => r.status === 'PENDING').length} ${L('待审批', 'pending')}`}>
      <Table
        rowKey="id"
        size="small"
        pagination={{ pageSize: 5, hideOnSinglePage: true }}
        dataSource={requests}
        columns={[
          { title: 'Feature', render: (_, r) => <a onClick={() => navigate(`features/${r.featureId}`)}><Mono>{state.features[r.featureId]?.name}</Mono></a> },
          {
            title: L('提交', 'Commit'),
            render: (_, r) => (
              <Space size={4} wrap>
                <Mono>{displayName(state, r.commitId)}</Mono>
                {r.status === 'PENDING' && state.features[r.featureId]?.headCommitId !== r.commitId && <Tag color="orange">{L('已不是最新提交', 'no longer the head')}</Tag>}
              </Space>
            ),
          },
          { title: L('车辆组 / 车辆', 'Groups / vehicles'), render: (_, r) => `${r.vehicleGroupIds.map((g) => state.vehicleGroups[g]?.name).join(', ')} · ${r.members.join(', ')}` },
          {
            title: L('目标', 'Goal'),
            render: (_, r) => (
              <Space orientation="vertical" size={0}>
                <span>{r.goal}</span>
                {r.disabledPolicies.length > 0 && (
                  <Typography.Text type="secondary">
                    {L('关闭', 'Off')}: {r.disabledPolicies.join(', ')}
                  </Typography.Text>
                )}
              </Space>
            ),
          },
          { title: L('申请人', 'By'), render: (_, r) => `${state.accounts[r.requestedBy]?.displayName} · ${when(r.requestedAt)}` },
          { title: L('状态', 'Status'), render: (_, r) => <Tooltip title={r.decisionNote}><Tag color={REQUEST_STATUS_COLORS[r.status]}>{B(REQUEST_STATUS_LABELS[r.status])}</Tag></Tooltip> },
          {
            title: '',
            render: (_, r) =>
              r.status === 'PENDING' &&
              canDecide(r) && (
                <Space size={0}>
                  <Button type="link" size="small" onClick={() => (setNote(''), setDeciding({ req: r, decision: 'APPROVED' }))}>
                    {L('批准', 'Approve')}
                  </Button>
                  <Button type="link" size="small" danger onClick={() => (setNote(''), setDeciding({ req: r, decision: 'REJECTED' }))}>
                    {L('驳回', 'Reject')}
                  </Button>
                </Space>
              ),
          },
        ]}
      />
      <Modal
        open={deciding !== null}
        title={deciding?.decision === 'APPROVED' ? L('批准团队测试申请', 'Approve team test request') : L('驳回团队测试申请', 'Reject team test request')}
        onCancel={() => setDeciding(null)}
        onOk={() => {
          if (run((c) => decideTestRequest(c, deciding!.req.id, { decision: deciding!.decision, note }), L('已处理', 'Decided')) !== undefined) setDeciding(null);
        }}
      >
        <Hint>
          {L(
            '批准绑定该固定提交与当前车辆清单；成员变化后需重新申请。申请人执行时平台会再次检查版本、成员、环境与占用，批准只能使用一次。',
            'An approval binds the fixed commit and the current vehicle list; a changed list needs a new request. On execution the platform checks version, members, environment and occupancy again; an approval is used once.',
          )}
        </Hint>
        <Input.TextArea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={L('意见', 'Note')} />
      </Modal>
    </Card>
  );
}

function Registry() {
  const state = useEngineState();
  const actor = useActor()!;
  const { L, B } = useI18n();
  const run = useRun();
  const [registering, setRegistering] = useState(false);
  const [confirming, setConfirming] = useState<Resource | null>(null);
  const [statusOf, setStatusOf] = useState<Resource | null>(null);
  const [reporting, setReporting] = useState<Resource | null>(null);
  const [keying, setKeying] = useState<Resource | null>(null);
  const [clientOf, setClientOf] = useState<string | null>(null);
  const [imageOf, setImageOf] = useState<string | null>(null);
  const [cf] = Form.useForm();
  const [kf] = Form.useForm();
  const [form] = Form.useForm();
  const [vf] = Form.useForm();
  const [sf] = Form.useForm();
  const vehicles = managedResources(state, actor);
  return (
    <Card extra={<Button icon={<PlusOutlined />} onClick={() => (form.resetFields(), setRegistering(true))}>{L('登记实车', 'Register vehicle')}</Button>}>
      <Hint>{L('实车登记时整车版本为空，由 DIP / OTA 等可信来源上报后确认；仿真车的版本由镜像决定。', 'Physical vehicles start with unknown software, confirmed later from a trusted source (DIP, OTA); a simulation’s version comes from its image.')}</Hint>
      <VehicleTable
        vehicles={vehicles}
        extra={(r) => r.personal ? (
          <Typography.Text type="secondary">{L('仅创建人可操作', 'Owner only')}</Typography.Text>
        ) : (
          <Space size={0}>
            {r.type === 'PHYSICAL' && (
              <Button type="link" size="small" onClick={() => (vf.setFieldsValue({ version: r.integrationVersion, source: '' }), setConfirming(r))}>
                {L('确认软件版本', 'Confirm software')}
              </Button>
            )}
            {r.type === 'PHYSICAL' && (
              <Button
                type="link"
                size="small"
                onClick={() => (
                  cf.setFieldsValue({ target: r.integrationVersion ?? undefined, source: '', controllers: r.controllers.length ? r.controllers : [{ name: 'ADC', version: '', status: 'PASS' }, { name: 'BMS', version: '', status: 'PASS' }] }),
                  setReporting(r)
                )}
              >
                {L('域控状态', 'Controllers')}
              </Button>
            )}
            {r.type === 'SIMULATION' && (
              <Button type="link" size="small" onClick={() => setImageOf(r.id)}>
                {L('运行镜像', 'Running image')}
              </Button>
            )}
            <Button type="link" size="small" onClick={() => (sf.setFieldsValue({ status: r.status, reason: '' }), setStatusOf(r))}>
              {L('状态', 'Status')}
            </Button>
            {r.deviceKey ? (
              <Button type="link" size="small" onClick={() => setClientOf(r.id)}>
                {L('客户端状态', 'Client state')}
              </Button>
            ) : (
              <Button type="link" size="small" onClick={() => (kf.resetFields(), setKeying(r))}>
                {L('登记设备密钥（Mock）', 'Register device key (mock)')}
              </Button>
            )}
          </Space>
        )}
      />
      <ClientReportDrawer resourceId={clientOf} workspaceId={null} onClose={() => setClientOf(null)} />
      <SimSoftwareDrawer resourceId={imageOf} onClose={() => setImageOf(null)} />
      <Modal
        open={keying !== null}
        title={L(`登记设备密钥 · ${keying?.id ?? ''}`, `Register device key · ${keying?.id ?? ''}`)}
        onCancel={() => setKeying(null)}
        onOk={() =>
          kf.validateFields().then((v) => {
            if (run((c) => registerDeviceKey(c, keying!.id, v), L('已登记设备密钥', 'Device key registered')) !== undefined) setKeying(null);
          })
        }
      >
        <Hint>
          {L(
            '只有登记了公钥的设备才能上报客户端状态。原型使用 Mock 密钥与签名，可以伪造，不代表真实设备认证。',
            'Only a device whose public key is registered may report its client state. The prototype uses mock keys and signatures, which can be forged: this is not real device authentication.',
          )}
        </Hint>
        <Form form={kf} name="device-key" layout="vertical">
          <Form.Item name="keyId" label={L('密钥编号', 'Key id')} rules={[{ required: true }]}>
            <Input placeholder="VEH-901-k1" />
          </Form.Item>
          <Form.Item name="publicKey" label={L('设备公钥', 'Device public key')} rules={[{ required: true }]}>
            <Input.TextArea rows={2} placeholder="mock-ed25519:…" />
          </Form.Item>
          <Button
            size="small"
            onClick={() => {
              const key = engine.run(null, (c) => {
                provisionDevice(c, keying!.id);
                return devicePublicKey(c.s, keying!.id);
              });
              if (key) kf.setFieldsValue(key);
            }}
          >
            {L('从模拟设备读取公钥（原型工具）', 'Read the key from the simulated device (prototype tool)')}
          </Button>
        </Form>
      </Modal>
      <Modal
        open={registering}
        title={L('登记实车', 'Register a physical vehicle')}
        onCancel={() => setRegistering(false)}
        onOk={() =>
          form.validateFields().then((v) => {
            if (run((c) => registerPhysical(c, v), L('已登记', 'Registered')) !== undefined) setRegistering(false);
          })
        }
      >
        <Form form={form} name="register" layout="vertical" initialValues={{ vehicleModelId: Object.keys(state.vehicleModels)[0], env: 'development', pool: 'Chassis' }}>
          <Space>
            <Form.Item name="id" label="ID" rules={[{ required: true }]}>
              <Input placeholder="VEH-003" />
            </Form.Item>
            <Form.Item name="vin" label="VIN" rules={[{ required: true }]}>
              <Input placeholder="LSDEM0X8900000003" />
            </Form.Item>
          </Space>
          <Space>
            <Form.Item name="licensePlate" label={L('车牌', 'Plate')}>
              <Input />
            </Form.Item>
            <Form.Item name="displayName" label={L('名称', 'Name')}>
              <Input />
            </Form.Item>
          </Space>
          <Space>
            <Form.Item name="vehicleModelId" label={L('车型', 'Model')}>
              <Select style={{ width: 120 }} options={Object.keys(state.vehicleModels).map((m) => ({ value: m, label: m }))} />
            </Form.Item>
            <Form.Item name="env" label={L('环境', 'Environment')}>
              <Select style={{ width: 130 }} options={ENVS.map((e) => ({ value: e, label: B(ENV_LABELS[e]) }))} />
            </Form.Item>
            <Form.Item name="pool" label={L('资源池', 'Pool')}>
              <Select style={{ width: 130 }} options={SCOPES.map((p) => ({ value: p, label: p }))} />
            </Form.Item>
          </Space>
        </Form>
      </Modal>
      <Modal
        open={confirming !== null}
        title={`${L('确认实际软件版本', 'Confirm actual software')} · ${confirming?.id}`}
        onCancel={() => setConfirming(null)}
        onOk={() =>
          vf.validateFields().then((v) => {
            if (run((c) => confirmIntegration(c, confirming!.id, { version: v.version ?? null, source: v.source }), L('已确认', 'Confirmed')) !== undefined) setConfirming(null);
          })
        }
      >
        <Hint>{L('确认软件版本不等于刷写或配置生效。', 'Confirming software is neither flashing nor applying a configuration.')}</Hint>
        <Form form={vf} name="software" layout="vertical">
          <Form.Item name="version" label={L('整车版本（留空 = 未知）', 'Software version (blank = unknown)')}>
            <Select
              allowClear
              options={Object.values(state.softwareVersions)
                .filter((v) => v.vehicleModelId === confirming?.vehicleModelId)
                .map((v) => ({ value: v.version, label: `${v.vehicleModelId} ${v.version}` }))}
            />
          </Form.Item>
          <Form.Item name="source" label={L('可信来源', 'Trusted source')} rules={[{ required: true }]}>
            <Input placeholder={L('例如：DIP 上报 / 外部 OTA 确认', 'e.g. DIP report / external OTA confirmation')} />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        open={reporting !== null}
        width={620}
        title={`${L('登记各域控实际状态', 'Record each controller’s actual state')} · ${reporting?.id}`}
        onCancel={() => setReporting(null)}
        onOk={() =>
          cf.validateFields().then((v) => {
            if (run((c) => reportControllers(c, reporting!.id, { target: v.target, source: v.source, controllers: v.controllers ?? [] }), L('已登记', 'Recorded')) !== undefined) setReporting(null);
          })
        }
      >
        <Hint>
          {L(
            '只有全部域控都成功升级到目标版本，车辆才获得该整车版本；部分失败时整车版本记为未知并阻止量产配置，由外部软件 OTA 完成或回滚后重新上报。不要把期望版本填成实际版本。',
            'Only when every controller reached the target does the vehicle get that version; a partial failure leaves it unknown and blocks production configuration until the external software OTA completes or rolls back. Never enter the expected version as the actual one.',
          )}
        </Hint>
        <Form form={cf} name="controllers" layout="vertical">
          <Space>
            <Form.Item name="target" label={L('目标整车版本', 'Target version')} rules={[{ required: true }]}>
              <Select
                style={{ width: 140 }}
                options={Object.values(state.softwareVersions)
                  .filter((v) => v.vehicleModelId === reporting?.vehicleModelId)
                  .map((v) => ({ value: v.version, label: v.version }))}
              />
            </Form.Item>
            <Form.Item name="source" label={L('可信来源', 'Trusted source')} rules={[{ required: true }]}>
              <Input style={{ width: 300 }} placeholder={L('DIP 上报 / 外部软件 OTA 回执', 'DIP report / software OTA receipt')} />
            </Form.Item>
          </Space>
          <Form.List name="controllers">
            {(fields, { add, remove }) => (
              <>
                {fields.map((f) => (
                  <Space key={f.key} align="baseline">
                    <Form.Item name={[f.name, 'name']} rules={[{ required: true }]}>
                      <Input placeholder="ADC" style={{ width: 110 }} />
                    </Form.Item>
                    <Form.Item name={[f.name, 'version']} rules={[{ required: true }]}>
                      <Input placeholder="1.0" style={{ width: 110 }} />
                    </Form.Item>
                    <Form.Item name={[f.name, 'status']}>
                      <Select style={{ width: 110 }} options={[{ value: 'PASS', label: 'PASS' }, { value: 'FAIL', label: 'FAIL' }]} />
                    </Form.Item>
                    <MinusCircleOutlined onClick={() => remove(f.name)} />
                  </Space>
                ))}
                <Button size="small" icon={<PlusOutlined />} onClick={() => add({ name: '', version: '', status: 'PASS' })}>
                  {L('添加域控', 'Add controller')}
                </Button>
              </>
            )}
          </Form.List>
        </Form>
      </Modal>
      <Modal
        open={statusOf !== null}
        title={`${L('车辆状态', 'Vehicle status')} · ${statusOf?.id}`}
        onCancel={() => setStatusOf(null)}
        onOk={() =>
          sf.validateFields().then((v) => {
            if (run((c) => setResourceStatus(c, statusOf!.id, v), L('已更新', 'Updated')) !== undefined) setStatusOf(null);
          })
        }
      >
        <Form form={sf} name="status" layout="vertical">
          <Form.Item name="status" label={L('状态', 'Status')}>
            <Select options={['AVAILABLE', 'MAINTENANCE', 'RETIRED'].map((s) => ({ value: s, label: B(RESOURCE_STATUS_LABELS[s]) }))} />
          </Form.Item>
          <Form.Item name="reason" label={L('原因', 'Reason')} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}

/** A manifest typed as text: signals separated by spaces, commas or lines; one UNIT:/directory per line. */
function parseManifest(signals?: string, sources?: string) {
  if (!signals?.trim() && !sources?.trim()) return null;
  return {
    signals: (signals ?? '').split(/[\s,，]+/).filter(Boolean),
    sources: (sources ?? '')
      .split(/\n+/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => ({ unit: l.includes(':') ? l.slice(0, l.indexOf(':')) : '', directory: l.includes(':') ? l.slice(l.indexOf(':') + 1) : l })),
  };
}

function Catalogs() {
  const state = useEngineState();
  const { L } = useI18n();
  const can = useCan();
  const run = useRun();
  const [open, setOpen] = useState<'version' | 'image' | 'manifest' | null>(null);
  const [manifestFor, setManifestFor] = useState<SoftwareVersion | null>(null);
  const [form] = Form.useForm();
  const model = Form.useWatch('vehicleModelId', form);
  // The newest recorded manifest of the model, to start a new version from.
  const copyPrevious = () => {
    const previous = Object.values(state.softwareVersions)
      .filter((v) => v.vehicleModelId === (manifestFor?.vehicleModelId ?? model) && v.manifest)
      .sort((a, b) => compareVersions(b.version, a.version))[0];
    if (previous?.manifest) {
      form.setFieldsValue({ signals: previous.manifest.signals.join('\n'), sources: previous.manifest.sources.map((s) => `${s.unit}:${s.directory}`).join('\n') });
    }
  };
  const manifestFields = (
    <>
      <Form.Item
        name="signals"
        label={L('软件清单（Mock）· 信号', 'Software manifest (mock) · signals')}
        extra={
          <Space size={4}>
            <span>{L('每行一个，或用逗号分隔；用于逐条检查策略是否还能在该软件上运行', 'One per line or comma-separated; used to check each policy against this software')}</span>
            <Button size="small" type="link" onClick={copyPrevious}>
              {L('从上一版本复制', 'Copy from previous version')}
            </Button>
          </Space>
        }
      >
        <Input.TextArea rows={4} placeholder={'brake_pressure\nvehicle_speed'} />
      </Form.Item>
      <Form.Item name="sources" label={L('软件清单（Mock）· 数据源', 'Software manifest (mock) · sources')} extra={L('每行一个 单元:/目录，目录包含其子目录', 'One UNIT:/directory per line; a directory covers its subdirectories')}>
        <Input.TextArea rows={3} placeholder={'CHASSIS:/var/log\nADC:/data'} />
      </Form.Item>
    </>
  );
  const canVersion = can('softwareVersion.record', { scope: 'Vehicle' });
  const canImage = can('image.register', { workspaceId: '*', groupId: '*' });
  return (
    <Row gutter={16}>
      <Col xs={24} xl={10}>
        <Card title={L('整车软件版本', 'Software versions')} extra={canVersion && <Button size="small" icon={<PlusOutlined />} onClick={() => (form.resetFields(), setOpen('version'))}>{L('登记', 'Record')}</Button>}>
          <Table
            rowKey={(v) => `${v.vehicleModelId}::${v.version}`}
            size="small"
            pagination={false}
            dataSource={Object.values(state.softwareVersions)}
            columns={[
              { title: L('车型', 'Model'), dataIndex: 'vehicleModelId' },
              { title: L('版本', 'Version'), dataIndex: 'version' },
              { title: L('来源', 'Source'), dataIndex: 'source' },
              {
                title: L('软件清单', 'Manifest'),
                render: (_, v) =>
                  v.manifest ? (
                    <Tooltip title={`${v.manifest.signals.join(', ')} · ${v.manifest.sources.map((s) => `${s.unit}:${s.directory}`).join(', ')}`}>
                      <Tag>{L(`信号 ${v.manifest.signals.length} · 数据源 ${v.manifest.sources.length}`, `${v.manifest.signals.length} signals · ${v.manifest.sources.length} sources`)}</Tag>
                    </Tooltip>
                  ) : canVersion ? (
                    <Button size="small" type="link" onClick={() => (form.resetFields(), setManifestFor(v), setOpen('manifest'))}>
                      {L('补录清单', 'Add manifest')}
                    </Button>
                  ) : (
                    <Tag color="orange">{L('未登记', 'not recorded')}</Tag>
                  ),
              },
            ]}
          />
        </Card>
      </Col>
      <Col xs={24} xl={14}>
        <Card title={L('仿真镜像（不可变）', 'Simulation images (immutable)')} extra={canImage && <Button size="small" icon={<PlusOutlined />} onClick={() => (form.resetFields(), setOpen('image'))}>{L('登记镜像', 'Register image')}</Button>}>
          <Table
            rowKey="id"
            size="small"
            pagination={false}
            dataSource={Object.values(state.images)}
            columns={[
              { title: 'ID', render: (_, i) => <Mono>{i.id}</Mono> },
              { title: L('车型 / 整车版本', 'Model / software'), render: (_, i) => `${i.vehicleModelId} ${i.integrationVersion ?? L('（无）', '(none)')}` },
              { title: 'Build', dataIndex: 'build' },
              { title: L('仿真器', 'Simulator'), dataIndex: 'simulator' },
              { title: L('摘要', 'Digest'), render: (_, i) => <ShortId value={i.digest} size={16} /> },
            ]}
          />
        </Card>
      </Col>
      <Modal
        open={open !== null}
        title={
          open === 'version'
            ? L('登记整车软件版本', 'Record a software version')
            : open === 'manifest'
              ? L(`补录软件清单 · ${manifestFor?.vehicleModelId} ${manifestFor?.version}`, `Add the manifest · ${manifestFor?.vehicleModelId} ${manifestFor?.version}`)
              : L('登记仿真镜像', 'Register a simulation image')
        }
        onCancel={() => setOpen(null)}
        onOk={() =>
          form.validateFields().then((v) => {
            const ok =
              open === 'version'
                ? run(
                    (c) => recordSoftwareVersion(c, { vehicleModelId: v.vehicleModelId, version: v.version, source: v.source, manifest: parseManifest(v.signals, v.sources) }),
                    L('已登记；没有策略集适用时会自动开启适用性确认', 'Recorded; an applicability check opens if no policy set applies'),
                  )
                : open === 'manifest'
                  ? run(
                      (c) => setSoftwareManifest(c, { vehicleModelId: manifestFor!.vehicleModelId, version: manifestFor!.version, manifest: parseManifest(v.signals, v.sources) ?? { signals: [], sources: [] } }),
                      L('已补录软件清单', 'Manifest recorded'),
                    )
                  : run(
                    (c) =>
                      registerImage(c, {
                        id: v.id,
                        vehicleModelId: v.vehicleModelId,
                        build: v.build,
                        simulator: v.simulator,
                        integrationVersion: v.integrationVersion ?? null,
                        digest: v.digest?.trim() || `sha256:${sha256Hex(`${v.id}:${v.build}`)}`,
                      }),
                    L('已登记', 'Registered'),
                  );
            if (ok !== undefined) setOpen(null);
          })
        }
      >
        <Form form={form} name="catalog" layout="vertical" initialValues={{ vehicleModelId: Object.keys(state.vehicleModels)[0], simulator: 'SimOne 3' }}>
          <Form.Item name="vehicleModelId" label={L('车型', 'Model')} hidden={open === 'manifest'}>
            <Select options={Object.keys(state.vehicleModels).map((m) => ({ value: m, label: m }))} onChange={() => form.setFieldValue('integrationVersion', undefined)} />
          </Form.Item>
          {open === 'manifest' ? (
            manifestFields
          ) : open === 'version' ? (
            <>
              <Form.Item name="version" label={L('版本', 'Version')} rules={[{ required: true }]}>
                <Input placeholder="1.2" />
              </Form.Item>
              <Form.Item name="source" label={L('可信来源', 'Trusted source')} rules={[{ required: true }]}>
                <Input />
              </Form.Item>
              {manifestFields}
            </>
          ) : (
            <>
              <Form.Item name="id" label="ID" rules={[{ required: true }]}>
                <Input placeholder="x89-1.1-sim" />
              </Form.Item>
              <Form.Item name="integrationVersion" label={L('整车版本（留空 = 研发镜像）', 'Software version (blank = development image)')}>
                <Select
                  allowClear
                  options={Object.values(state.softwareVersions)
                    .filter((v) => v.vehicleModelId === model)
                    .map((v) => ({ value: v.version, label: `${v.vehicleModelId} ${v.version}` }))}
                />
              </Form.Item>
              <Form.Item name="build" label="Build" rules={[{ required: true }]}>
                <Input />
              </Form.Item>
              <Form.Item name="simulator" label={L('仿真器', 'Simulator')} rules={[{ required: true }]}>
                <Input />
              </Form.Item>
              <Form.Item
                name="digest"
                label={L('镜像摘要（可选）', 'Image digest (optional)')}
                extra={L('留空则按 ID 与 Build 生成；演示镜像可填带标注的 sha256:mock-…', 'Blank derives one from the ID and build; demo images may use a labelled sha256:mock-…')}
              >
                <Input placeholder="sha256:mock-dev-first" />
              </Form.Item>
            </>
          )}
        </Form>
      </Modal>
    </Row>
  );
}

export function FleetPage({ tab = 'workspace' }: { tab?: string }) {
  const state = useEngineState();
  const actor = useActor()!;
  const can = useCan();
  const { workspace } = useWorkspace();
  const { L } = useI18n();
  const isResourceAdmin = actor.grants.some((g) => g.role === 'VEHICLE_RESOURCE');
  const personal =
    !!workspace &&
    workspace.groupIds.some((id) => {
      const g = state.groups[id];
      return !!g && can('personalSim.use', { workspaceId: workspace.id, groupId: g.id, scope: g.domain, env: 'development' });
    });
  return (
    <div className="kz-page">
      <PageHeader title={L('车辆与车辆组', 'Vehicles & vehicle groups')} subtitle={L('车辆的真实状态（实际软件、已生效配置）与配置路由（车辆组）分别管理。', 'Actual vehicle state (software, applied configuration) and configuration routing (vehicle groups) are managed separately.')} />
      <Tabs
        activeKey={tab}
        onChange={(k) => navigate(`fleet/${k}`)}
        items={[
          { key: 'workspace', label: L('工作区车辆', 'Workspace vehicles'), children: <WorkspaceVehicles /> },
          { key: 'groups', label: L('车辆组', 'Vehicle groups'), children: <VehicleGroups /> },
          ...(personal && workspace ? [{ key: 'personal', label: L('我的研发仿真', 'My simulations'), children: <PersonalSims workspaceId={workspace.id} /> }] : []),
          ...(isResourceAdmin ? [{ key: 'registry', label: L('车辆台账', 'Vehicle registry'), children: <Registry /> }] : []),
          { key: 'catalogs', label: L('软件版本与镜像', 'Software & images'), children: <Catalogs /> },
        ]}
      />
    </div>
  );
}
