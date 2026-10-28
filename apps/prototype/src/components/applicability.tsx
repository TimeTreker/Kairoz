// Policy sets and software versions (策略集与软件版本): which set each software version runs, the
// applicability checks that let an unchanged set serve another version, and what changed between
// two set versions.

import { Alert, Button, Card, Descriptions, Drawer, Empty, Input, Modal, Select, Space, Table, Tag, Tooltip, Typography } from 'antd';
import { useState } from 'react';
import { useCan, useRun } from '../app/hooks.ts';
import { navigate } from '../app/router.ts';
import { useEngineState } from '../app/store.ts';
import {
  blockedProductionVehicles,
  cancelApplicabilityCheck,
  checkTestStatus,
  checkVehicleProblems,
  compatibilityOf,
  confirmApplicability,
  confirmBlockers,
  dispatchApplicability,
  isOpenCheck,
  openApplicabilityCheck,
  recordApplicabilityTest,
  verifyApplicability,
  withdrawApplicability,
} from '../engine/applicability.ts';
import { ungroupedVehicles, vehicleGroupsOf } from '../engine/fleet.ts';
import { appliesTo, applicableVersions, compareVersions, releaseDiff, releasesOf, setInEffect, takeOverProblem } from '../engine/release.ts';
import type { ApplicabilityCheck, ApplicabilityRecord, Release } from '../engine/types.ts';
import { cancelDeployment } from '../engine/validation.ts';
import { useI18n } from '../i18n/i18n.tsx';
import { issueLabel } from '../i18n/issues.ts';
import { CHECK_STATUS_COLORS, CHECK_STATUS_LABELS, COMPATIBILITY_LABELS, setName } from '../i18n/vocab.ts';
import { Hint, Mono, when } from './common.tsx';
import { DiffView } from './DiffView.tsx';
import { DeploymentsTable, DispatchModal, RecordTestModal, TargetsTable } from './testing.tsx';
import { DclPartCell, VersionStatusTag } from './plm.tsx';

/** Every software version of a model with the set in effect for it and how that came to be. */
export function SoftwareVersionsCard({ modelId }: { modelId: string }) {
  const state = useEngineState();
  const { L, B } = useI18n();
  // A PLM version takes over its working name's sets: the record says so in words.
  const recordReason = (a: ApplicabilityRecord) => (a.checkId === null && a.reason.startsWith('working name ') ? L(`由工作名 ${a.reason.slice(13)} 关联`, `linked from working name ${a.reason.slice(13)}`) : a.reason);
  const can = useCan();
  const run = useRun();
  const [opening, setOpening] = useState<string | null>(null);
  const [releaseId, setReleaseId] = useState<string | undefined>();
  const [withdrawing, setWithdrawing] = useState<{ release: Release; version: string } | null>(null);
  const [reason, setReason] = useState('');
  const releases = releasesOf(state, modelId);
  // Sets that may take a software version over: patches only within their line, the mainline head
  // from a patch only once its fixes reached the mainline. The mainline comes first.
  const eligible = (version: string) =>
    releases.filter((r) => !appliesTo(state, r, version) && !takeOverProblem(state, r, version)).sort((a, b) => (a.patchOf === null ? 0 : 1) - (b.patchOf === null ? 0 : 1) || b.sequence - a.sequence);
  const testWs = Object.values(state.workspaces).find((w) => w.kind === 'INTEGRATION' && w.vehicleModelId === modelId && w.scopes.includes('Vehicle'));
  const canConfirm = can('applicability.confirm', { workspaceId: testWs?.id ?? '*', scope: 'Vehicle' });
  const versions = Object.values(state.softwareVersions)
    .filter((v) => v.vehicleModelId === modelId)
    .sort((a, b) => compareVersions(b.version, a.version));
  const blocked = blockedProductionVehicles(state, modelId);
  const production = (version: string) => Object.values(state.resources).filter((r) => r.env === 'production' && r.vehicleModelId === modelId && r.integrationVersion === version);

  return (
    <Card title={L('软件版本与策略集', 'Software versions and policy sets')}>
      <Hint>
        {L(
          '策略集与整车软件版本多对多：一个软件版本可先后采用多个策略集，一个策略集可适用多个软件版本。车辆按实际软件版本取当前适用的策略集（适用它的最新策略集）。新增或撤销适用关系只追加记录，不改变策略集内容和版本号。',
          'Policy sets and software versions are many-to-many: a software version may take several sets over time, and one set may serve many versions. A vehicle runs the set in effect for its actual software (the newest set that applies to it). Adding or withdrawing applicability appends a record; the set’s content and version never change.',
        )}
      </Hint>
      {blocked.length > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          title={L(`${blocked.length} 辆量产车的软件版本没有适用的策略集，量产下发被阻止`, `${blocked.length} production vehicle(s) run software no policy set applies to; production delivery is blocked`)}
          description={blocked.map((r) => `${r.id}（${r.integrationVersion}）`).join(L('、', ', '))}
        />
      )}
      <Table
        rowKey="version"
        size="small"
        pagination={false}
        dataSource={versions}
        columns={[
          {
            title: L('软件版本', 'Software'),
            render: (_, v) => (
              <Space size={4} wrap>
                <Mono>{`${modelId} ${v.version}`}</Mono>
                <VersionStatusTag v={v} />
              </Space>
            ),
          },
          {
            title: L('软件清单', 'Manifest'),
            render: (_, v) =>
              v.manifest ? (
                <Tooltip title={`${v.manifest.signals.join(', ')} · ${v.manifest.sources.map((s) => `${s.unit}:${s.directory}`).join(', ')}`}>
                  <Tag>{L(`信号 ${v.manifest.signals.length} · 数据源 ${v.manifest.sources.length}`, `${v.manifest.signals.length} signals · ${v.manifest.sources.length} sources`)}</Tag>
                </Tooltip>
              ) : (
                <Tag color="orange">{L('未登记', 'not recorded')}</Tag>
              ),
          },
          {
            title: L('当前适用策略集', 'Policy set in effect'),
            render: (_, v) => {
              const set = setInEffect(state, modelId, v.version);
              return set ? <Tag color="green">{B(setName(set.dclVersion))}</Tag> : <Tag color="red">{L('无适用策略集', 'none applies')}</Tag>;
            },
          },
          {
            title: L('适用记录', 'Applicability'),
            render: (_, v) => (
              <Space size={4} wrap>
                {releases
                  .filter((r) => r.vehicleIntegrationVersions.includes(v.version))
                  .reverse()
                  .map((r) => (
                    <Tag key={`p-${r.id}`}>{L(`发布时列入 ${r.dclVersion}`, `listed by ${r.dclVersion}`)}</Tag>
                  ))}
                {state.applicability
                  .filter((a) => a.vehicleModelId === modelId && a.version === v.version)
                  .sort((a, b) => a.seq - b.seq)
                  .map((a) => (
                    <Tooltip key={a.id} title={`${recordReason(a)} · ${a.by ? (state.accounts[a.by]?.displayName ?? a.by) : L('平台', 'Platform')} · ${when(a.at)}`}>
                      <Tag color={a.action === 'ADD' ? 'blue' : 'red'}>
                        {a.action === 'ADD' ? L(`追加 ${state.releases[a.releaseId]?.dclVersion}`, `added ${state.releases[a.releaseId]?.dclVersion}`) : L(`撤销 ${state.releases[a.releaseId]?.dclVersion}`, `withdrew ${state.releases[a.releaseId]?.dclVersion}`)}
                      </Tag>
                    </Tooltip>
                  ))}
              </Space>
            ),
          },
          {
            title: L('DCL 件（出厂配置）', 'DCL part (factory configuration)'),
            render: (_, v) => <DclPartCell v={v} />,
          },
          {
            title: L('量产车', 'Production vehicles'),
            render: (_, v) => {
              const list = production(v.version);
              const blocked = !setInEffect(state, modelId, v.version);
              return list.length ? (
                <Typography.Text type={blocked ? 'danger' : undefined}>
                  {list.map((r) => r.id).join(', ')}
                  {blocked ? L('（无适用策略集，被阻止）', ' (no set applies: blocked)') : ''}
                </Typography.Text>
              ) : (
                '—'
              );
            },
          },
          {
            title: '',
            render: (_, v) => {
              const set = setInEffect(state, modelId, v.version);
              return (
                <Space size={0} wrap>
                  <Button type="link" size="small" onClick={() => navigate(`versions/history/version/${v.version}`)}>
                    {L('发布记录', 'History')}
                  </Button>
                  {canConfirm && (
                  <Space size={0}>
                    <Tooltip
                      title={
                        v.status === 'PLANNED'
                          ? L('工作名的策略集来自它的集成征集，不做适用性确认；PLM 发布后在 PLM 版本上确认。', 'A working name’s set comes from its integration call; it takes no applicability check. Checks run on the PLM version once PLM publishes.')
                          : eligible(v.version).length === 0
                          ? L('没有可以接管这个软件版本的策略集：补丁只服务本线的软件；主线只有在补丁的修复合入（或写明不合入）后才能接管补丁服务的软件。', 'No policy set may take this software over: a patch only serves its own line’s software, and the mainline takes over from a patch only once the patch’s fixes reached it (or were closed for it).')
                          : undefined
                      }
                    >
                      <Button type="link" size="small" disabled={eligible(v.version).length === 0 || v.status === 'PLANNED'} onClick={() => (setReleaseId(eligible(v.version)[0]?.id), setOpening(v.version))}>
                        {L('开启适用性确认', 'Open a check')}
                      </Button>
                    </Tooltip>
                    {set && (
                      <Button type="link" size="small" danger onClick={() => (setReason(''), setWithdrawing({ release: set, version: v.version }))}>
                        {L('撤销适用', 'Withdraw')}
                      </Button>
                    )}
                  </Space>
                  )}
                </Space>
              );
            },
          },
        ]}
      />
      <Modal
        open={opening !== null}
        title={L(`开启适用性确认 · ${modelId} ${opening}`, `Open an applicability check · ${modelId} ${opening}`)}
        okText={L('开启', 'Open')}
        onCancel={() => setOpening(null)}
        onOk={() => {
          if (run((c) => openApplicabilityCheck(c, { releaseId: releaseId!, version: opening! }), L('已开启适用性确认，等待集成测试', 'Check opened; waiting for integration testing')) !== undefined) setOpening(null);
        }}
      >
        <Hint>{L('选择要在该软件版本上验证的策略集。确认前会逐条检查策略，并在运行该软件的测试车上做集成测试。', 'Choose the set to verify on this software. Before confirmation every policy is checked and the set is tested on testing vehicles running that software.')}</Hint>
        <Select
          style={{ width: '100%' }}
          value={releaseId}
          onChange={setReleaseId}
          options={(opening ? eligible(opening) : []).map((r) => ({ value: r.id, label: `${B(setName(r.dclVersion))} · ${r.patchOf ? L('补丁', 'patch') : L('主线', 'mainline')}` }))}
        />
      </Modal>
      <Modal
        open={withdrawing !== null}
        title={withdrawing ? L(`撤销 ${withdrawing.release.dclVersion} 对 ${withdrawing.version} 的适用`, `Withdraw ${withdrawing.release.dclVersion} from ${withdrawing.version}`) : ''}
        okButtonProps={{ danger: true }}
        onCancel={() => setWithdrawing(null)}
        onOk={() => {
          if (withdrawing && run((c) => withdrawApplicability(c, { releaseId: withdrawing.release.id, version: withdrawing.version, reason }), L('已撤销适用', 'Applicability withdrawn')) !== undefined) setWithdrawing(null);
        }}
      >
        <Hint>{L('只追加一条撤销记录。该软件版本的车辆回到仍适用的上一个策略集；没有时量产下发被阻止。', 'Only a withdrawal record is appended. Vehicles on that software fall back to the previous set that still applies; without one, production delivery is blocked.')}</Hint>
        <Input.TextArea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={L('原因', 'Reason')} />
      </Modal>
    </Card>
  );
}

/** Applicability checks of a model, or those tested in one integration workspace. */
export function ApplicabilityChecks({ modelId, testWorkspaceId }: { modelId: string; testWorkspaceId?: string }) {
  const state = useEngineState();
  const { L } = useI18n();
  const checks = Object.values(state.applicabilityChecks)
    .filter((c) => c.vehicleModelId === modelId && (!testWorkspaceId || c.testWorkspaceId === testWorkspaceId))
    .sort((a, b) => Number(isOpenCheck(b)) - Number(isOpenCheck(a)) || b.openedAt.localeCompare(a.openedAt) || b.id.localeCompare(a.id));
  if (checks.length === 0) return <Empty description={L('暂无适用性确认单。登记新的整车软件版本且没有策略集适用时会自动开启。', 'No applicability checks. One opens by itself when a software version no set applies to is recorded.')} />;
  return (
    <Space orientation="vertical" size={12} style={{ width: '100%' }}>
      {checks.map((c) => (
        <CheckCard key={c.id} check={c} />
      ))}
    </Space>
  );
}

function CheckCard({ check }: { check: ApplicabilityCheck }) {
  const state = useEngineState();
  const { L, B } = useI18n();
  const can = useCan();
  const run = useRun();
  const [dispatching, setDispatching] = useState(false);
  const [recording, setRecording] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<'confirm' | 'cancel' | null>(null);
  const [note, setNote] = useState('');
  const release = state.releases[check.releaseId]!;
  const target = { workspaceId: check.testWorkspaceId, scope: 'Vehicle' as const };
  const open = isOpenCheck(check);
  const compatibility = compatibilityOf(state, check.releaseId, check.version);
  const status = checkTestStatus(state, check);
  const blockers = check.status === 'VERIFIED' ? confirmBlockers(state, check) : [];
  const deployments = Object.values(state.deployments)
    .filter((d) => d.kind === 'APPLICABILITY' && d.subjectId === check.id)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const groups = vehicleGroupsOf(state, check.testWorkspaceId).filter((g) => g.status === 'ACTIVE' && g.purpose === 'TEST' && g.env === 'testing');
  const vehicles = ungroupedVehicles(state, check.testWorkspaceId)
    .filter((r) => r.env === 'testing')
    .map((r) => {
      const problems = checkVehicleProblems(state, check, r.id);
      return { id: r.id, label: `${r.id} · ${r.integrationVersion ?? L('版本未知', 'software unknown')}`, blocked: problems.length ? problems.map((p) => B(issueLabel(p), p)).join(L('；', '; ')) : undefined };
    });

  return (
    <Card
      size="small"
      title={
        <Space wrap>
          <Mono>{`${check.vehicleModelId} ${check.version}`}</Mono>
          <span>←</span>
          <Mono>{B(setName(release.dclVersion))}</Mono>
          <Tag color={CHECK_STATUS_COLORS[check.status]}>{B(CHECK_STATUS_LABELS[check.status])}</Tag>
          {check.auto && <Tag>{L('登记新软件时自动开启', 'opened when the software was recorded')}</Tag>}
        </Space>
      }
      extra={
        <Space size={4} wrap>
          {open && can('applicability.dispatch', target) && (
            <Button size="small" onClick={() => setDispatching(true)}>
              {L('下发测试', 'Dispatch for testing')}
            </Button>
          )}
          {check.status === 'TESTING' && can('applicability.verify', target) && (
            <Button size="small" type="primary" onClick={() => run((c) => verifyApplicability(c, check.id), L('集成测试已确认，等待配置发布确认适用', 'Verified; waiting for configuration release to confirm'))}>
              {L('确认验证', 'Verify')}
            </Button>
          )}
          {check.status === 'VERIFIED' && can('applicability.confirm', target) && (
            <Button size="small" type="primary" onClick={() => (setNote(''), setDeciding('confirm'))}>
              {L('确认适用', 'Confirm applicability')}
            </Button>
          )}
          {open && can('applicability.confirm', target) && (
            <Button size="small" danger onClick={() => (setNote(''), setDeciding('cancel'))}>
              {L('取消', 'Cancel')}
            </Button>
          )}
        </Space>
      }
    >
      <Descriptions size="small" column={{ xs: 1, md: 3 }}>
        <Descriptions.Item label={L('开启', 'Opened')}>{`${check.openedBy ? (state.accounts[check.openedBy]?.displayName ?? check.openedBy) : L('平台（PLM 发布新版本）', 'Platform (PLM published a version)')} · ${when(check.openedAt)}`}</Descriptions.Item>
        <Descriptions.Item label={L('测试工作区', 'Test workspace')}>{state.workspaces[check.testWorkspaceId]?.name}</Descriptions.Item>
        <Descriptions.Item label={L('集成验证', 'Verified')}>{check.verifiedBy ? `${state.accounts[check.verifiedBy]?.displayName} · ${when(check.verifiedAt)}` : '—'}</Descriptions.Item>
        {check.decidedBy && <Descriptions.Item label={L('决定', 'Decided')}>{`${state.accounts[check.decidedBy]?.displayName} · ${when(check.decidedAt)}`}</Descriptions.Item>}
        {check.note && <Descriptions.Item label={L('说明', 'Note')}>{check.note}</Descriptions.Item>}
      </Descriptions>
      {blockers.length > 0 && (
        <Alert type="warning" showIcon style={{ marginBottom: 12 }} title={L('暂不能确认适用', 'Not confirmable yet')} description={blockers.map((b) => B(issueLabel(b), b)).join(L('；', '; '))} />
      )}
      <Typography.Text strong>{L('逐条策略检查', 'Policy by policy')}</Typography.Text>
      <Table
        rowKey="policyId"
        size="small"
        pagination={false}
        style={{ margin: '4px 0 12px' }}
        dataSource={compatibility}
        columns={[
          { title: L('策略', 'Policy'), render: (_, c) => <Mono>{c.policyId}</Mono> },
          { title: L('结果', 'Result'), render: (_, c) => <Tag color={c.status === 'OK' ? 'green' : c.status === 'MISSING' ? 'red' : 'orange'}>{B(COMPATIBILITY_LABELS[c.status])}</Tag> },
          { title: L('缺少的信号', 'Missing signals'), render: (_, c) => (c.missingSignals.length ? <Mono>{c.missingSignals.join(', ')}</Mono> : '—') },
          { title: L('缺少数据源的文件', 'Files without a source'), render: (_, c) => (c.missingSources.length ? <Mono>{c.missingSources.join(', ')}</Mono> : '—') },
        ]}
      />
      <Typography.Text strong>{L('测试车辆', 'Test vehicles')}</Typography.Text>
      <TargetsTable
        status={status}
        action={(t) =>
          check.status === 'TESTING' &&
          can('applicability.recordTest', { ...target, env: state.resources[t.resourceId]!.env }) && (
            <Button size="small" disabled={!t.applied} onClick={() => setRecording(t.resourceId)}>
              {L('登记结果', 'Record result')}
            </Button>
          )
        }
      />
      {deployments.length > 0 && (
        <DeploymentsTable
          deployments={deployments}
          canCancel={() => can('applicability.dispatch', target)}
          onCancel={(d, reason) => run((c) => cancelDeployment(c, d.id, reason), L('已取消下发', 'Dispatch cancelled'))}
        />
      )}
      <DispatchModal
        open={dispatching}
        groups={groups}
        vehicles={vehicles}
        emptyText={L('集成工作区没有测试车辆组或未归组的测试车辆', 'The integration workspace has no testing vehicle groups or ungrouped testing vehicles')}
        onClose={() => setDispatching(false)}
        onDispatch={(vehicleGroupIds, _goal, resourceIds) =>
          run((c) => dispatchApplicability(c, check.id, { vehicleGroupIds, resourceIds }), L('已下发；车辆回执后再登记结果', 'Dispatched; record results after the vehicles confirm')) !== undefined
        }
      />
      <RecordTestModal
        resourceId={recording}
        onClose={() => setRecording(null)}
        onRecord={(input) => run((c) => recordApplicabilityTest(c, check.id, { resourceId: recording!, ...input }), L('已登记', 'Recorded')) !== undefined}
      />
      <Modal
        open={deciding !== null}
        title={deciding === 'confirm' ? L(`确认 ${release.dclVersion} 适用于 ${check.version}`, `Confirm ${release.dclVersion} for ${check.version}`) : L('取消适用性确认', 'Cancel the check')}
        okButtonProps={{ danger: deciding === 'cancel' }}
        onCancel={() => setDeciding(null)}
        onOk={() => {
          const ok =
            deciding === 'confirm'
              ? run((c) => confirmApplicability(c, check.id, { note }), L('已确认适用；策略集内容与版本号不变', 'Confirmed; the set’s content and version are unchanged'))
              : run((c) => cancelApplicabilityCheck(c, check.id, note), L('已取消', 'Cancelled'));
          if (ok !== undefined) setDeciding(null);
        }}
      >
        {deciding === 'confirm' && (
          <Hint>
            {L(
              '确认会追加一条适用记录：运行该软件版本的车辆从此取这个策略集，量产车仍需配置 OTA 才会实际运行它。',
              'Confirming appends an applicability record: vehicles on that software now resolve to this set; production vehicles still run it only after a configuration OTA.',
            )}
          </Hint>
        )}
        <Input.TextArea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={deciding === 'confirm' ? L('确认说明', 'Note') : L('原因', 'Reason')} />
      </Modal>
    </Card>
  );
}

/** What changed from the previous set version to this one: groups, files and policy versions. */
export function ReleaseDiffDrawer({ fromId, toId, onClose }: { fromId: string | null; toId: string | null; onClose: () => void }) {
  const state = useEngineState();
  const { L, B } = useI18n();
  if (!toId) return null;
  const to = state.releases[toId]!;
  const from = fromId ? state.releases[fromId] : null;
  const diff = releaseDiff(state, fromId, toId);
  const nameOf = (key: string) => state.dataItems[key]?.dataCode ?? key;
  return (
    <Drawer open size="large" onClose={onClose} title={`${from ? B(setName(from.dclVersion)) : L('初始配置', 'Initial configuration')} → ${B(setName(to.dclVersion))}`}>
      <Typography.Text strong>{L('策略版本变化', 'Policy versions')}</Typography.Text>
      <Table
        rowKey="policyId"
        size="small"
        pagination={false}
        style={{ margin: '4px 0 16px' }}
        dataSource={diff.policies}
        locale={{ emptyText: L('策略没有变化', 'No policy changed') }}
        columns={[
          { title: L('策略', 'Policy'), render: (_, p) => <Mono>{p.policyId}</Mono> },
          { title: L('业务分组', 'Group'), render: (_, p) => <Mono>{state.groups[p.groupId]?.code}</Mono> },
          { title: L('之前', 'Before'), render: (_, p) => (p.from === null ? <Tag>{L('无', 'none')}</Tag> : `v${p.from}`) },
          { title: L('之后', 'After'), render: (_, p) => (p.to === null ? <Tag color="red">{L('已移除', 'removed')}</Tag> : `v${p.to}`) },
        ]}
      />
      {diff.groups
        .filter((g) => g.status !== 'SAME')
        .map((g) => (
          <Card key={g.groupId} size="small" style={{ marginBottom: 12 }} title={<Space><Mono>{state.groups[g.groupId]?.code}</Mono><Tag>{g.status === 'ADDED' ? L('新增分组', 'added') : g.status === 'REMOVED' ? L('移除分组', 'removed') : L('有变化', 'changed')}</Tag></Space>}>
            <DiffView diff={g.diff} nameOf={nameOf} />
          </Card>
        ))}
      {diff.groups.every((g) => g.status === 'SAME') && <Empty description={L('两个版本内容相同', 'Both versions have the same content')} />}
      <Typography.Paragraph type="secondary" style={{ marginTop: 12 }}>
        {L(
          `适用软件版本（当前）：${applicableVersions(state, to).join(', ')}。适用关系的变化不改变策略集内容。`,
          `Applies to (now): ${applicableVersions(state, to).join(', ')}. Applicability changes never change a set’s content.`,
        )}
      </Typography.Paragraph>
    </Drawer>
  );
}
