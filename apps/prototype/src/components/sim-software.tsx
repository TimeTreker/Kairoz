// What image a simulation runs, and changing it: switch a catalog image, build a module into a
// derived image and deploy it, roll back the last change. Builds and deployments are answered by
// the prototype's vehicle simulator (mock CI and simulation provider), never from these pages.

import { Alert, Button, Card, Descriptions, Drawer, Input, Select, Space, Table, Tag, Typography } from 'antd';
import { useState } from 'react';
import { useRun } from '../app/hooks.ts';
import { navigate } from '../app/router.ts';
import { useEngineState } from '../app/store.ts';
import { SIM_MODULES, simModule } from '../domain/sim-software.ts';
import { pendingImageChangeOf } from '../engine/fleet.ts';
import { buildsOf, cancelBuild, cancelImageChange, catalogImages, deployBuild, imageChangesOf, openBuildOf, requestBuild, rollbackImage, rollbackTarget, switchImage } from '../engine/sim-software.ts';
import type { State } from '../engine/types.ts';
import { useI18n } from '../i18n/i18n.tsx';
import { issueLabel } from '../i18n/issues.ts';
import { BUILD_STATUS_COLORS, BUILD_STATUS_LABELS, IMAGE_CHANGE_KIND_LABELS, IMAGE_CHANGE_STATUS_COLORS, IMAGE_CHANGE_STATUS_LABELS } from '../i18n/vocab.ts';
import { Hint, Mono, when } from './common.tsx';

/** A short form of a resolved commit for tables. */
function shortCommit(commit: string | null): string {
  if (!commit) return '—';
  return commit.startsWith('mock-commit:') ? 'mock-commit' : commit.slice(0, 10);
}

/** Whether the image is a derived one, for tags next to the software version. */
export function isDerivedImage(s: State, imageId: string | null): boolean {
  return !!imageId && !!s.images[imageId]?.derived;
}

/** The running image of one simulation and the controls to change it. */
export function SimSoftware({ resourceId }: { resourceId: string }) {
  const state = useEngineState();
  const run = useRun();
  const { L, B } = useI18n();
  const r = state.resources[resourceId]!;
  const [target, setTarget] = useState<string | undefined>();
  const [module, setModule] = useState<string>('brake');
  const [repository, setRepository] = useState('');
  const [ref, setRef] = useState('');
  const image = r.imageId ? state.images[r.imageId] : undefined;
  const pending = pendingImageChangeOf(state, r.id);
  const pendingChange = pending ? state.imageChanges[pending] : undefined;
  const builds = buildsOf(state, r.id);
  const changes = imageChangesOf(state, r.id);
  const rollback = rollbackTarget(state, r.id);
  const open = openBuildOf(state, r.id);
  const retired = r.status === 'RETIRED';
  const running = r.instance === 'RUNNING';
  const catalog = catalogImages(state, r.vehicleModelId).filter((i) => i.id !== r.imageId);
  const moduleName = (id: string) => {
    const m = simModule(id);
    return m ? L(m.name, m.nameEn) : id;
  };

  return (
    <Card size="small" title={L('运行镜像', 'Running image')}>
      <Space orientation="vertical" style={{ width: '100%' }}>
        <Descriptions size="small" column={{ xs: 1, sm: 1, md: 2 }} bordered>
          <Descriptions.Item label={L('镜像', 'Image')}>
            <Space size={4}>
              <Mono>{r.imageId ?? '—'}</Mono>
              {image?.derived && <Tag color="purple">{L('派生镜像', 'Derived image')}</Tag>}
            </Space>
          </Descriptions.Item>
          <Descriptions.Item label={image?.derived ? L('来源整车版本', 'Source software version') : L('整车软件', 'Software')}>
            {r.integrationVersion ?? L('未知', 'unknown')}
          </Descriptions.Item>
          {image?.derived && (
            <Descriptions.Item label={L('重新构建的模块', 'Rebuilt modules')} span="filled">
              <Space orientation="vertical" size={0}>
                {Object.entries(image.derived.modules).map(([m, x]) => (
                  <span key={m}>
                    {moduleName(m)} · <Mono>{x.repository.replace('https://github.com/', '')}</Mono> @ <Mono>{shortCommit(x.commit)}</Mono>
                  </span>
                ))}
              </Space>
            </Descriptions.Item>
          )}
        </Descriptions>

        {!retired && (
          <Hint>
            {L(
              '换镜像（切换、部署构建、回滚）前先停止实例；仿真服务确认后才生效。新镜像上的 DCL 客户端从空开始，需重新下发配置；在旧镜像上记录的测试结果不再计入未验证的 Feature、候选或适用性确认。',
              'Stop the instance before changing its image (switch, deploy a build, roll back); the change takes effect once the simulation provider confirms it. The DCL client on a new image starts empty, so configurations must be sent again; test results recorded on an earlier image stop counting for Features, candidates or checks not yet verified.',
            )}
          </Hint>
        )}

        {pendingChange && (
          <Alert
            type="info"
            showIcon
            title={`${L('等待仿真服务', 'Waiting for the simulation provider')}：${B(IMAGE_CHANGE_KIND_LABELS[pendingChange.kind])} → ${pendingChange.toImageId}`}
            description={L('部署结果由原型工具中的车辆模拟器（扮演仿真服务）给出；失败时保留原镜像和原配置。', 'The vehicle simulator in the prototype tools, playing the simulation provider, gives the result; a failure keeps the previous image and configuration.')}
            action={
              <Space orientation="vertical">
                <Button size="small" onClick={() => navigate('simulator')}>
                  {L('车辆模拟器', 'Vehicle simulator')}
                </Button>
                <Button size="small" onClick={() => run((c) => cancelImageChange(c, r.id), L('已撤回', 'Withdrawn'))}>
                  {L('撤回', 'Withdraw')}
                </Button>
              </Space>
            }
          />
        )}

        {!retired && !pending && (
          <Space wrap>
            <Select
              style={{ width: 260 }}
              value={target}
              onChange={setTarget}
              placeholder={L('选择平台镜像', 'Choose a catalog image')}
              options={catalog.map((i) => ({ value: i.id, label: `${i.id} · ${i.integrationVersion ?? L('无整车版本', 'no whole-vehicle version')}` }))}
            />
            <Button disabled={!target || running} onClick={() => run((c) => switchImage(c, r.id, target!), L('已请求切换，等待仿真服务', 'Switch requested; waiting for the provider')) && setTarget(undefined)}>
              {L('切换基础镜像', 'Switch base image')}
            </Button>
            {rollback && (
              <Button disabled={running} onClick={() => run((c) => rollbackImage(c, r.id), L('已请求回滚，等待仿真服务', 'Rollback requested; waiting for the provider'))}>
                {L('回滚到', 'Roll back to')} {rollback.fromImageId}
              </Button>
            )}
            {running && <Typography.Text type="warning">{L('实例运行中：先停止再换镜像', 'Running: stop it before changing the image')}</Typography.Text>}
          </Space>
        )}

        {!retired &&
          (r.env === 'development' ? (
            <Space wrap>
              <Select style={{ width: 140 }} value={module} onChange={setModule} options={SIM_MODULES.map((m) => ({ value: m.id, label: L(m.name, m.nameEn) }))} />
              <Input style={{ width: 300 }} value={repository} onChange={(e) => setRepository(e.target.value)} placeholder="https://github.com/example/brake" />
              <Input style={{ width: 160 }} value={ref} onChange={(e) => setRef(e.target.value)} placeholder={L('分支 / Tag / Commit', 'Branch / tag / commit')} />
              <Button
                disabled={!!open}
                onClick={() =>
                  run((c) => requestBuild(c, r.id, { module, repository, ref }), L('已请求构建，等待构建服务', 'Build requested; waiting for the build provider')) && (setRepository(''), setRef(''))
                }
              >
                {L('构建模块', 'Build module')}
              </Button>
            </Space>
          ) : (
            <Typography.Text type="secondary">{L('测试环境仿真只使用平台镜像；派生镜像只用于研发环境。', 'Testing simulations run catalog images only; derived images are for development.')}</Typography.Text>
          ))}

        {builds.length > 0 && (
          <Table
            rowKey="id"
            size="small"
            pagination={false}
            dataSource={builds}
            scroll={{ x: 'max-content' }}
            columns={[
              { title: L('构建', 'Build'), render: (_, b) => `${moduleName(b.module)} · ${when(b.requestedAt)}` },
              { title: L('源码', 'Source'), render: (_, b) => <Mono>{`${b.repository.replace('https://github.com/', '')} @ ${b.requestedRef} → ${shortCommit(b.resolvedCommit)}`}</Mono> },
              {
                title: L('状态', 'Status'),
                render: (_, b) => {
                  // A built image that reached the simulation reads as deployed, even after a rollback.
                  const shown = b.status === 'BUILT' && changes.some((c) => c.buildId === b.id && c.status === 'APPLIED') ? 'DEPLOYED' : b.status;
                  return <Tag color={BUILD_STATUS_COLORS[shown]}>{B(BUILD_STATUS_LABELS[shown])}</Tag>;
                },
              },
              { title: L('镜像', 'Image'), render: (_, b) => <Mono>{b.imageId ?? '—'}</Mono> },
              {
                title: '',
                render: (_, b) =>
                  open?.id === b.id &&
                  !retired && (
                    <Space size={0}>
                      {b.status === 'BUILT' && (
                        <Button type="link" size="small" disabled={running || !!pending} onClick={() => run((c) => deployBuild(c, r.id, b.id), L('已请求部署，等待仿真服务', 'Deployment requested; waiting for the provider'))}>
                          {L('部署', 'Deploy')}
                        </Button>
                      )}
                      <Button type="link" size="small" onClick={() => run((c) => cancelBuild(c, r.id, b.id), L('已取消构建', 'Build cancelled'))}>
                        {L('取消', 'Cancel')}
                      </Button>
                    </Space>
                  ),
              },
            ]}
          />
        )}

        {changes.length > 0 && (
          <Table
            rowKey="id"
            size="small"
            pagination={false}
            dataSource={changes}
            scroll={{ x: 'max-content' }}
            columns={[
              { title: L('时间', 'When'), render: (_, c) => when(c.requestedAt) },
              { title: L('变更', 'Change'), render: (_, c) => B(IMAGE_CHANGE_KIND_LABELS[c.kind]) },
              { title: L('镜像', 'Image'), render: (_, c) => <Mono>{`${c.fromImageId ?? '—'} → ${c.toImageId}`}</Mono> },
              {
                title: L('状态', 'Status'),
                render: (_, c) => (
                  <Space size={4}>
                    <Tag color={IMAGE_CHANGE_STATUS_COLORS[c.status]}>{B(IMAGE_CHANGE_STATUS_LABELS[c.status])}</Tag>
                    {c.error && <Typography.Text type="secondary">{B(issueLabel(c.error), c.error)}</Typography.Text>}
                  </Space>
                ),
              },
            ]}
          />
        )}
      </Space>
    </Card>
  );
}

/** The running image of a shared simulation, opened from a vehicle list. */
export function SimSoftwareDrawer({ resourceId, onClose }: { resourceId: string | null; onClose: () => void }) {
  const { L } = useI18n();
  return (
    <Drawer open={resourceId !== null} size={760} title={`${L('运行镜像', 'Running image')} · ${resourceId ?? ''}`} onClose={onClose}>
      {resourceId && <SimSoftware resourceId={resourceId} />}
    </Drawer>
  );
}
