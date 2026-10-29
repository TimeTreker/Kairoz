// PLM in the console: where a version stands (a working name until PLM publishes it), the DCL part
// of its BOM, and DCL's export of that part for PLM. PLM itself is simulated on its own page.

import { Button, Input, Modal, Space, Tag, Tooltip, Typography } from 'antd';
import { useState } from 'react';
import { useCan, useRun } from '../app/hooks.ts';
import { useEngineState } from '../app/store.ts';
import { deliverDclPart, reportedClientVersion } from '../engine/calls.ts';
import { deliveredPartOutdated, releaseOfDigest, workingNameState } from '../engine/plm-sync.ts';
import { releaseConfiguration, setInEffect } from '../engine/release.ts';
import { partVersion } from '../engine/types.ts';
import type { SoftwareVersion } from '../engine/types.ts';
import { useI18n } from '../i18n/i18n.tsx';
import { SOFTWARE_STATUS_LABELS, setName } from '../i18n/vocab.ts';
import { Hint, Mono, when } from './common.tsx';
import { downloadJson } from './JsonExport.tsx';

const STATUS_COLORS: Record<string, string> = { PLANNED: 'gold', TO_DELIVER: 'orange', DELIVERED: 'blue', LINKED: 'default', TESTING: 'purple', RECORDED: 'green' };

/** A version's status: a working name by where it stands, or published by PLM (with the working name it was linked from). */
export function VersionStatusTag({ v }: { v: SoftwareVersion }) {
  const { L, B } = useI18n();
  const status = workingNameState(v) ?? (v.status === 'TESTING' ? 'TESTING' : 'RECORDED');
  const tips: Record<string, string> = {
    PLANNED: L('集成征集的工作名：PLM 还没有这个版本号；只有该征集的发布能列入它，量产车不能使用。', 'An integration call’s working name: PLM has no number for it yet; only that call’s release lists it, and production vehicles never run it.'),
    TO_DELIVER: L('征集已发布：DCL 导出 DCL 件，在平台外合入 DCL 软件并交给 PLM。', 'The call is released: DCL exports the DCL part, merges it into the DCL software and hands it to PLM outside the platform.'),
    DELIVERED: L('DCL 件已导出交付；PLM 发布带这个件的整车版本后，平台按配置摘要自动关联。', 'The DCL part is exported for PLM; once PLM publishes a version carrying it, the platform links them by the configuration digest.'),
    LINKED: L('PLM 已发布这个软件；以后使用 PLM 版本号。', 'PLM published this software; use the PLM number from now on.'),
    TESTING: v.testOf
      ? L(`PLM 为整车集成测试出的测试版本，是工作名 ${v.testOf.workingName} 第 ${v.testOf.round} 轮的构建：研发车、测试车可以运行，按工作名引用策略集；量产车不能使用。通过后 PLM 以同号发布。`, `A test build PLM issued for whole-vehicle integration testing, round ${v.testOf.round} of working name ${v.testOf.workingName}: development and testing vehicles run it and it references the working name’s sets; production vehicles never run it. PLM releases it under the same number if it passes.`)
      : L('PLM 为整车集成测试出的测试版本，还没关联到集成征集：由集成管理员在征集里关联为整车的某一轮。量产车不能使用。', 'A test build PLM issued for whole-vehicle integration testing, not linked to a call yet: the integration admin links it as a round of the call. Production vehicles never run it.'),
    RECORDED: L('PLM 发布的整车集成版本。', 'A whole-vehicle integration version PLM published.'),
  };
  return (
    <Space size={4} wrap>
      <Tooltip title={tips[status]}>
        <Tag color={STATUS_COLORS[status]}>
          {B(SOFTWARE_STATUS_LABELS[status])}
          {status === 'LINKED' ? ` ${v.linkedTo}` : ''}
        </Tag>
      </Tooltip>
      {v.testOf ? (
        <Tag>{L(`工作名 ${v.testOf.workingName} · 第 ${v.testOf.round} 轮`, `working name ${v.testOf.workingName} · round ${v.testOf.round}`)}</Tag>
      ) : v.status === 'TESTING' ? (
        <Tag color="orange">{L('未关联征集', 'not linked to a call')}</Tag>
      ) : null}
      {v.status === 'RECORDED' && v.workingName && v.workingName !== v.version && !v.testOf && <Tag>{L(`工作名 ${v.workingName}`, `working name ${v.workingName}`)}</Tag>}
    </Space>
  );
}

/**
 * The DCL part of a version: for a working name, the part DCL delivered (or the delivery to do); for
 * a PLM version, the part its BOM carries, the set it was recognised as (its factory configuration)
 * and how that compares with the set in effect.
 */
export function DclPartCell({ v }: { v: SoftwareVersion }) {
  const state = useEngineState();
  const { L, B } = useI18n();
  const can = useCan();
  const run = useRun();
  const [open, setOpen] = useState(false);
  const [client, setClient] = useState('');
  const call = v.callId ? state.integrationCalls[v.callId] : undefined;
  const canDeliver = can('dclPart.deliver', { workspaceId: call?.workspaceId ?? '*', scope: 'Vehicle' });
  const part = v.dclPart;
  const partTag = part && (
    <Tooltip title={`${L('配置摘要', 'Configuration digest')} ${part.digest}${part.deliveredBy ? ` · ${state.accounts[part.deliveredBy]?.displayName ?? part.deliveredBy} · ${when(part.deliveredAt)}` : ''}`}>
      <Tag>
        <Mono>{`DCL ${partVersion(part)}`}</Mono>
      </Tag>
    </Tooltip>
  );
  const deliver = () => {
    const p = run((c) => deliverDclPart(c, { vehicleModelId: v.vehicleModelId, version: v.version, clientVersion: client }), L('已导出 DCL 件，交给 PLM', 'DCL part exported for PLM'));
    if (p === undefined) return;
    setOpen(false);
    // The part carries the set in effect for the working name, which may be newer than the one first exported.
    const set = releaseOfDigest(state, v.vehicleModelId, p.digest);
    // What DCL merges into the DCL software: the set's complete configuration, by digest.
    if (set) downloadJson({ name: `DCL_${v.vehicleModelId}_${partVersion(p)}.json`, json: JSON.stringify({ part: { vehicleModelId: v.vehicleModelId, workingName: v.version, ...p }, configuration: releaseConfiguration(state, set.id) }, null, 2) });
  };

  if (v.status === 'PLANNED') {
    const state_ = workingNameState(v);
    const outdated = deliveredPartOutdated(state, v);
    return (
      <Space size={4} wrap>
        {outdated && (
          <Tooltip title={L('交付后这个工作名生效的策略集变了（例如紧急停用）：请重新导出，把新的件交给 PLM。', 'The set in effect for this working name changed after the delivery (an emergency stop, say): export again and hand PLM the new part.')}>
            <Tag color="orange">{L(`需重新导出 · ${setInEffect(state, v.vehicleModelId, v.version)?.dclVersion ?? ''}`, `export again · ${setInEffect(state, v.vehicleModelId, v.version)?.dclVersion ?? ''}`)}</Tag>
          </Tooltip>
        )}
        {partTag ?? (v.dclModule ? <Tag color="orange">{L(`待导出 · ${state.releases[v.dclModule.releaseId]?.dclVersion ?? ''}`, `to export · ${state.releases[v.dclModule.releaseId]?.dclVersion ?? ''}`)}</Tag> : '—')}
        {canDeliver && (state_ === 'TO_DELIVER' || state_ === 'DELIVERED') && (
          <Button type="link" size="small" onClick={() => (setClient(reportedClientVersion(state, v.vehicleModelId) ?? ''), setOpen(true))}>
            {part ? L('重新导出', 'Export again') : L('导出 DCL 件（交付 PLM）', 'Export the DCL part (for PLM)')}
          </Button>
        )}
        <Modal open={open} title={L(`导出 DCL 件 · ${v.vehicleModelId} ${v.version}`, `Export the DCL part · ${v.vehicleModelId} ${v.version}`)} okText={L('导出', 'Export')} onCancel={() => setOpen(false)} onOk={deliver}>
          <Hint>
            {L(
              '导出已发布策略集的完整配置，供 DCL 合入所选版本的 DCL 客户端，作为一个件交给 PLM（在平台之外完成）。件的版本写明客户端版本和策略集版本；配置摘要让平台在 PLM 发布后认出它。必须在 PLM 发布前交付。',
              'Export the released set’s complete configuration for DCL to merge into the chosen DCL client and hand to PLM as one part (outside the platform). Its version names the client and the set; the configuration digest lets the platform recognise it once PLM publishes. Hand it over before PLM publishes.',
            )}
          </Hint>
          <Typography.Text>{L('DCL 客户端版本', 'DCL client version')}</Typography.Text>
          <Input value={client} onChange={(e) => setClient(e.target.value)} placeholder="2.3.0" aria-label={L('DCL 客户端版本', 'DCL client version')} />
        </Modal>
      </Space>
    );
  }
  const missing = (state.plmSync.missingParts ?? []).find((m) => m.vehicleModelId === v.vehicleModelId && m.version === v.version);
  if (!part)
    return missing ? (
      <Tooltip title={L(`PLM 发布这个工作名时没有带上交付的 DCL 件 ${partVersion(missing.part)}：出厂没有配置，车辆从云端取配置。`, `PLM published this working name without the delivered DCL part ${partVersion(missing.part)}: no factory configuration; vehicles take theirs from the cloud.`)}>
        <Tag color="orange">{L('交付的件未带上', 'delivered part left out')}</Tag>
      </Tooltip>
    ) : (
      <>—</>
    );
  const bundled = v.dclModule ? state.releases[v.dclModule.releaseId] : undefined;
  const current = setInEffect(state, v.vehicleModelId, v.version);
  return (
    <Space size={4} wrap>
      {partTag}
      {bundled ? (
        <Tooltip title={L('出厂配置：刷这个版本的车随软件运行它，不依赖网络；车端上报的配置摘要与之相同才算。', 'Factory configuration: vehicles flashed with this version run it with the software, no network needed; it counts once the vehicle reports the same digest.')}>
          <Tag color={bundled.id === current?.id ? 'green' : 'default'}>
            {L(`出厂 ${B(setName(bundled.dclVersion))}`, `factory ${B(setName(bundled.dclVersion))}`)}
            {current && bundled.id !== current.id ? L(` · 生效 ${current.dclVersion}，连云后推送`, ` · ${current.dclVersion} in effect, pushed once connected`) : ''}
          </Tag>
        </Tooltip>
      ) : (
        <Tag color="red">{L('摘要无法识别', 'unknown digest')}</Tag>
      )}
    </Space>
  );
}
