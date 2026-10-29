// Promoting a verified whole-vehicle candidate to a DCL policy set version (发布). Shared by the
// release page and the integration call page.

import { Alert, Checkbox, Descriptions, Form, Input, Modal, Space, Tag, Tooltip } from 'antd';
import { useRun } from '../app/hooks.ts';
import { useEngineState } from '../app/store.ts';
import { ShortId, when } from './common.tsx';
import { testVersionsOf } from '../engine/calls.ts';
import { compareVersions, highestVersion, nextDclVersion, promoteCandidate, promoteVersionProblem, setInEffect, targetMoved, testedVersions, versionLine, versionsInEffect } from '../engine/release.ts';
import type { Candidate } from '../engine/types.ts';
import { useI18n } from '../i18n/i18n.tsx';
import { issueLabel } from '../i18n/issues.ts';

/**
 * Promotes a verified whole-vehicle candidate to a DCL policy set version. A call's test
 * integration version is listed for the call's target, which its release turns into a recorded
 * whole-vehicle integration version; planned versions of other calls are never offered.
 */
export function PromoteModal({ candidate, onClose }: { candidate: Candidate; onClose: () => void }) {
  const state = useEngineState();
  const { L, B } = useI18n();
  const run = useRun();
  const tested = new Set(testedVersions(state, candidate));
  // A patch replaces its target only where the target is in effect.
  const target = candidate.patch && candidate.targetReleaseId ? state.releases[candidate.targetReleaseId] : undefined;
  const serving = target ? new Set(versionsInEffect(state, target)) : null;
  const call = candidate.callId ? state.integrationCalls[candidate.callId] : undefined;
  // The call's whole-vehicle test versions reference the new set with the release.
  const builds = call ? testVersionsOf(state, call).map((v) => v.version) : [];
  const versions = Object.values(state.softwareVersions)
    .filter((v) => v.vehicleModelId === candidate.vehicleModelId && (!serving || serving.has(v.version)))
    .filter((v) => (call ? v.version === call.targetVersion : v.status !== 'PLANNED' && v.status !== 'TESTING'))
    .map((v) => v.version)
    .sort(compareVersions);
  const [form] = Form.useForm<{ dclVersion: string; versions: string[]; notes: string }>();
  const moved = targetMoved(state, candidate);
  // Software a patch serves: listing it here would drop the patch's fixes unless this set carries them.
  const blocked = (v: string) => promoteVersionProblem(state, candidate, v)?.code === 'PATCH_FIX_MISSING';
  // The gates the release rests on, as the engine checks them again when it runs.
  const confirmation = state.processingConfirmations.filter((c) => c.mergePlanId === candidate.mergePlanId).at(-1);
  return (
    <Modal
      open
      title={`${L('发布候选', 'Release candidate')} · ${candidate.label}`}
      okText={L('发布', 'Release')}
      okButtonProps={{ disabled: moved }}
      onCancel={onClose}
      onOk={() =>
        form.validateFields().then((v) => {
          const id = run(
            (c) => promoteCandidate(c, candidate.id, { dclVersion: v.dclVersion, vehicleIntegrationVersions: v.versions ?? [], notes: v.notes }),
            call
              ? L(`已发布：新策略集对应工作名 ${call.vehicleModelId} ${call.targetVersion}，配置已导出，待 DCL 导出 DCL 件交给 PLM`, `Released: the set is related to working name ${call.vehicleModelId} ${call.targetVersion}; its configuration is exported for DCL to hand to PLM`)
              : L('已发布；车辆在 OTA 回执成功后才会运行新策略集', 'Released; vehicles run the set only after an OTA receipt'),
          );
          if (id !== undefined) onClose();
        })
      }
    >
      {moved && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          title={candidate.patch ? L('它所补的策略集已被更新的策略集替换，这个候选不能再发布；请在新的策略集上重新集成。', 'The set it patches was replaced by a newer one for its software, so this candidate can no longer be released; integrate again on the new set.') : L('主线在冻结后又发布了新的策略集，这个候选不能再发布；请重新集成。', 'A newer mainline set was published after it was frozen, so this candidate can no longer be released; integrate again.')}
        />
      )}
      <Descriptions size="small" column={1} bordered style={{ marginBottom: 12 }}>
        <Descriptions.Item label={L('配置摘要', 'Configuration digest')}>
          <ShortId value={state.resolvedConfigs[candidate.resolvedConfigId]?.digest} size={20} />
        </Descriptions.Item>
        <Descriptions.Item label={L('DCL 处理确认', 'DCL processing confirmation')}>
          {confirmation ? `${state.accounts[confirmation.confirmedBy]?.displayName ?? confirmation.confirmedBy} · ${when(confirmation.createdAt)}` : '—'}
        </Descriptions.Item>
        <Descriptions.Item label={L('集成测试', 'Integration test')}>
          {candidate.verifiedBy ? `${state.accounts[candidate.verifiedBy]?.displayName ?? candidate.verifiedBy} · ${when(candidate.verifiedAt)}` : '—'}
          {tested.size > 0 && ` · ${L('已测软件', 'tested on')} ${[...tested].sort(compareVersions).map((v) => `${candidate.vehicleModelId} ${v}`).join(L('、', ', '))}`}
        </Descriptions.Item>
        <Descriptions.Item label={L('回滚目标', 'Rollback target')}>
          {[...tested].sort(compareVersions).map((v) => {
            const current = setInEffect(state, candidate.vehicleModelId, v);
            return (
              <div key={v}>
                {`${candidate.vehicleModelId} ${v}：`}
                {current ? L(`回到策略集 ${current.dclVersion}`, `back to policy set ${current.dclVersion}`) : L('这个软件版本还没有生效的策略集，不能回滚', 'no set is in effect for this software yet, so nothing to roll back to')}
              </div>
            );
          })}
        </Descriptions.Item>
      </Descriptions>
      {call && !moved && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          title={L(`集成征集 ${call.title} 的测试集成版本`, `Test integration version of integration call ${call.title}`)}
          description={
            state.softwareVersions[`${call.vehicleModelId}::${call.targetVersion}`]?.status === 'PLANNED'
              ? L(
                  `发布后记录新策略集与工作名 ${call.vehicleModelId} ${call.targetVersion} 的对应关系，并导出配置。${builds.length ? `已关联的整车测试版本 ${builds.join('、')} 随发布一并引用新策略集。` : ''}工作名保持规划：DCL 导出 DCL 件交给 PLM，PLM 发布整车版本后，平台自动关联，刷这个版本的车随软件运行新策略集，弱网或离线也不受影响。`,
                  `Publishing relates the new policy set to working name ${call.vehicleModelId} ${call.targetVersion} and exports its configuration.${builds.length ? ` The linked test versions ${builds.join(', ')} reference the new set with it.` : ''} The working name stays planned: DCL exports the DCL part for PLM, and once PLM publishes the version the platform links them; vehicles flashed with it run the set with the software, weak signal or none.`,
                )
              : L(
                  `PLM 已发布 ${call.vehicleModelId} ${call.targetVersion}，它的 BOM 不再改变：新策略集只记录对应关系，由配置 OTA 送到车上。`,
                  `PLM already published ${call.vehicleModelId} ${call.targetVersion} and its BOM no longer changes: the new set is related to it and reaches vehicles by configuration OTA.`,
                )
          }
        />
      )}
      {target && !moved && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          title={L(`同软件版本补丁：基于策略集 ${target.dclVersion}，版本号沿 ${versionLine(target.dclVersion)}.x 递增，只能适用它正在服务的软件版本。主线不变。`, `Same-software patch of policy set ${target.dclVersion}: numbered ${versionLine(target.dclVersion)}.x, for the software versions that set serves only. The mainline stays as it is.`)}
        />
      )}
      <Form form={form} name="promote" layout="vertical" initialValues={{ dclVersion: call ? nextMinor(highestVersion(state, candidate.vehicleModelId)) : nextDclVersion(state, candidate.vehicleModelId, target?.id ?? null), versions: call ? [call.targetVersion] : versions.filter((v) => tested.has(v) && !blocked(v)), notes: '' }}>
        <Form.Item name="dclVersion" label={L('DCL 策略集版本', 'DCL policy set version')} rules={[{ required: true }]} extra={L('独立于整车软件版本，major.minor.patch', 'Independent of vehicle software, major.minor.patch')}>
          <Input />
        </Form.Item>
        <Form.Item name="versions" label={L('适用的整车软件版本', 'Applies to vehicle software')}>
          <Checkbox.Group>
            <Space orientation="vertical">
              {versions.map((v) => (
                <Checkbox key={v} value={v}>
                  {`${candidate.vehicleModelId} ${v}`}{' '}
                  {blocked(v) && (
                    <Tooltip title={B(issueLabel(promoteVersionProblem(state, candidate, v)!.message), promoteVersionProblem(state, candidate, v)!.message)}>
                      <Tag color="red">{L(`运行补丁 ${setInEffect(state, candidate.vehicleModelId, v)?.dclVersion}，其修复未合入`, `runs patch ${setInEffect(state, candidate.vehicleModelId, v)?.dclVersion}; its fixes are missing`)}</Tag>
                    </Tooltip>
                  )}
                  {tested.has(v) ? (
                    <Tag color="green">{L('已通过集成测试', 'integration tested')}</Tag>
                  ) : candidate.targetReleaseId === null ? (
                    <Tooltip title={L('首版候选在未定版本的测试车辆上验证，按设计不要求逐软件版本测试。', 'The initial candidate is tested on vehicles without a fixed software version, so per-version tests are not required by design.')}>
                      <Tag color="blue">{L('首版免逐版本测试', 'initial: no per-version test')}</Tag>
                    </Tooltip>
                  ) : (
                    <Tag>{L('无集成测试', 'not tested')}</Tag>
                  )}
                </Checkbox>
              ))}
            </Space>
          </Checkbox.Group>
        </Form.Item>
        <Form.Item name="notes" label={L('发布说明', 'Release notes')}>
          <Input.TextArea rows={2} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

/** A new whole-vehicle integration version takes the next minor policy set version, e.g. 1.0.2 → 1.1.0. */
function nextMinor(top: string | null): string {
  if (!top) return '1.0.0';
  const [major, minor] = top.split('.').map(Number);
  return `${major}.${minor! + 1}.0`;
}
