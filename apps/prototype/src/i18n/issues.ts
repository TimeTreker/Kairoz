// Chinese readings of the engine's per-item reasons (dispatch, rollout, verification, merge…).
// The engine writes them in English as "<subject>: <problem>" or just "<problem>"; the subject
// (a vehicle, group, file or event) is kept as it is. Unmatched lines are shown unchanged.

import type { Bilingual } from './i18n.tsx';

type Pattern = [RegExp, (g: string[]) => string];

const STATUS: Record<string, string> = { available: '可用', maintenance: '维护中', retired: '已报废' };
const CONTROL: Record<string, string> = { accessControl: '访问控制', uploadControl: '上传控制', processingControl: '处理控制' };
const SIDE: Record<string, string> = { EDGE: '车端', CLOUD: '云端' };
const HELD: Record<string, string> = { 'a rollback': '是回滚', paused: '已暂停', cancelled: '已取消', rolled_back: '已回滚' };

/** Problem patterns, most specific first; capture groups feed the Chinese text. */
const PROBLEMS: Pattern[] = [
  // Vehicles and dispatch
  [/software version unknown/, () => '整车软件版本未知'],
  [/the whole-vehicle software version is unknown/, () => '整车软件版本未知'],
  [/a partial software update left controllers inconsistent \((.*)\); finish or roll back the software OTA first/, ([c]) => `软件部分升级使域控状态不一致（${c}），请先完成或回滚软件 OTA`],
  [/no policy set applies to (\S+) (\S+)/, ([m, v]) => `没有适用于 ${m} ${v} 的策略集`],
  [/policy set (\S+) does not apply to software (\S+)/, ([d, v]) => `策略集 ${d} 不适用于软件 ${v}`],
  [/resolves to the newer policy set (\S+)/, ([d]) => `应运行更新的策略集 ${d}`],
  [/software (\S+) has no manifest/, ([v]) => `软件 ${v} 没有软件清单`],
  [/missing (.+)/, ([m]) => `缺少 ${m}`],
  [/runs software (\S+); the check is for (\S+)/, ([v, c]) => `运行软件 ${v}，本确认单针对 ${c}`],
  [/testing vehicle groups of the integration workspace only/, () => '只能下发到集成工作区的测试车辆组'],
  [/(.+) does not apply to software (\S+)/, ([c, v]) => `${c} 不适用于软件 ${v}`],
  [/vehicle is waiting for deployment (\S+)/, ([d]) => `车辆正在等待下发 ${d} 的回执`],
  [/waiting for deployment (\S+)/, ([d]) => `正在等待下发 ${d} 的回执`],
  [/part of unfinished rollout (\S+)/, ([d]) => `属于未完成的 OTA ${d}`],
  [/no earlier formal configuration to return to/, () => '没有可回退的上一正式配置'],
  [/no vehicle runs this rollout’s configuration/, () => '没有车辆运行本次 OTA 的配置'],
  [/not a production vehicle/, () => '不是量产车辆'],
  [/not a testing vehicle/, () => '不是测试环境车辆'],
  [/not a vehicle of this workspace/, () => '不是本工作区的车辆'],
  [/not a vehicle of this rollout/, () => '不是本次 OTA 的车辆'],
  [/vehicle is not assigned to the workspace/, () => '车辆未分配到本工作区'],
  [/vehicle does not exist/, () => '车辆不存在'],
  [/routes through vehicle group (.+); dispatch to the group/, ([g]) => `属于车辆组“${g}”，请按车辆组下发`],
  [/another vehicle model/, () => '车型不同'],
  [/vehicle model (\S+) differs from the Feature/, ([m]) => `车型 ${m} 与 Feature 不同`],
  [/vehicle environment (\S+) differs from the group/, ([e]) => `车辆环境 ${e} 与车辆组不同`],
  [/vehicle software (\S+) is not compatible with base (\S+)/, ([v, d]) => `车辆软件 ${v} 与基线 ${d} 不兼容`],
  [/production vehicle/, () => '量产车辆'],
  [/vehicle is (available|maintenance|retired)/, ([st]) => `车辆状态：${STATUS[st!]}`],
  [/(available|maintenance|retired)/, ([st]) => STATUS[st!]!],
  [/choose the vehicles of the first wave/, () => '请选择首批车辆'],
  [/rollout (\S+) is (a rollback|paused|cancelled|rolled_back); start a new rollout to resume/, ([d, st]) => `OTA ${d} ${HELD[st!]}；新建 OTA 后才恢复同步`],
  [/the vehicle is (available|maintenance|retired)/, ([st]) => `车辆状态：${STATUS[st!]}`],
  [/unknown vehicle/, () => '未知车辆'],
  // Receipts, rollbacks and processing outcomes shown in history columns
  [/simulated apply failure/, () => '模拟的应用失败'],
  [/apply failed/, () => '应用失败'],
  [/rolled back: (.+)/, ([r]) => `已回滚：${r}`],
  [/ParserFailure: (\S+) could not be parsed/, ([sc]) => `ParserFailure：无法按 ${sc} 解析`],
  // Vehicle groups
  [/vehicle group does not exist/, () => '车辆组不存在'],
  [/vehicle group is archived/, () => '车辆组已归档'],
  [/vehicle group belongs to another workspace/, () => '车辆组属于其他工作区'],
  [/vehicle group serves another business group/, () => '车辆组服务于其他业务分组'],
  [/vehicle group has no vehicles/, () => '车辆组没有车辆'],
  [/Features never go to production vehicles/, () => 'Feature 不下发到量产车辆'],
  [/all vehicle groups of one dispatch share an environment/, () => '同一次下发的车辆组须在同一环境'],
  [/formal releases roll out to production vehicle groups/, () => '正式版本只下发到量产车辆组'],
  [/candidates only go to testing vehicle groups/, () => '候选只下发到测试车辆组'],
  [/not in the integration workspace/, () => '不在集成工作区'],
  [/in another workspace/, () => '属于其他工作区'],
  [/no vehicles/, () => '没有车辆'],
  [/archived/, () => '已归档'],
  // Verification
  [/no vehicles were dispatched for this commit/, () => '该提交尚未下发到任何车辆'],
  [/(\S+) has no passing test/, ([r]) => `${r} 没有通过的测试`],
  [/a simulation test must pass/, () => '须有仿真测试通过'],
  [/a physical vehicle test must pass/, () => '须有实车测试通过'],
  // Files, references and policies
  [/data item does not exist/, () => '数据项不存在'],
  [/owned by group (\S+)/, ([g]) => `归属分组 ${g}`],
  [/maintained by group (\S+)/, ([g]) => `由分组 ${g} 维护`],
  [/source overlaps another source and awaits DCL review/, () => '数据源与其他来源重叠，等待 DCL 判定'],
  [/data item was archived as a duplicate/, () => '数据项已作为重复项归档'],
  [/pinned version does not belong to this data item/, () => '固定的版本不属于该数据项'],
  [/reference is not \(or no longer\) granted/, () => '引用未获批准或已被撤销'],
  [/policy (\S+) captures (\S+), which is not in the merged file list/, ([p, k]) => `策略 ${p} 捕获的 ${k} 不在合并后的文件列表中`],
  [/policy (\S+) captures no file/, ([p]) => `策略 ${p} 没有捕获任何文件`],
  [/policy (\S+) has an invalid trigger: (.+) at (\d+)/, ([p, m, at]) => `策略 ${p} 的触发条件无效：${m}（位置 ${at}）`],
  [
    /policy (\S+) has a merged capture window of (\d+) s \((\d+) s before \+ (\d+) s after the trigger\), over the (\d+) s limit/,
    ([p, w, pre, post, max]) => `策略 ${p} 合并后的采集窗口为 ${w} 秒（触发前 ${pre} 秒 + 触发后 ${post} 秒），超过 ${max} 秒上限`,
  ],
  [/references (.+), which its owner group neither released nor merges here/, ([n]) => `引用的 ${n} 未被归属分组发布，也不在本次合并中`],
  [/references (.+), but the owner’s merged definition differs; re-pin the reference/, ([n]) => `引用的 ${n} 与归属分组合并后的定义不一致，请重新固定引用`],
  [/name is required/, () => '名称必填'],
  [/trigger: (.+) at (\d+)/, ([m, at]) => `触发条件：${m}（位置 ${at}）`],
  [/captures at least one file/, () => '至少捕获一个文件'],
  [/captures (\S+), which is not in the file list/, ([k]) => `捕获的 ${k} 不在文件列表中`],
  [/capture window must be whole seconds, 0\.\.(\d+) in total/, ([n]) => `采集窗口须为整秒，前后合计 0–${n} 秒`],
  // Processing bindings
  [/(EDGE|CLOUD) pipeline (\S+) does not exist/, ([side, id]) => `${SIDE[side!]}处理 ${id} 不存在`],
  [/(\S+) is not an? (EDGE|CLOUD) pipeline/, ([id, side]) => `${id} 不是${SIDE[side!]}处理`],
  [/(\S+) does not support format (\S+)/, ([id, f]) => `${id} 不支持格式 ${f}`],
  [/(\S+) does not support schema (\S+)/, ([id, sc]) => `${id} 不支持 Schema ${sc}`],
  // Sensitive review controls
  [/controls are required to approve/, () => '批准需要填写控制措施'],
  [/confirm the collection purpose/, () => '请确认采集目的'],
  [/confirm the collection scope/, () => '请确认采集范围'],
  [/confirm the retention period/, () => '请确认保留期限'],
  [/describe (\w+)/, ([f]) => `请说明${CONTROL[f!] ?? f}`],
  // Training data
  [/processing failed/, () => '处理失败'],
  [/processing not finished/, () => '处理未完成'],
  [/captured files incomplete/, () => '捕获文件不完整'],
  [/quality unknown/, () => '质量未知'],
  [/quality (\S+)/, ([q]) => `质量 ${q}`],
  [/training use not confirmed/, () => '训练用途待确认'],
  [/training use denied/, () => '不允许训练'],
];

const COMPILED = PROBLEMS.map(([re, zh]) => [new RegExp(`^(?:(.+?): )?${re.source}$`), zh] as const);

/** The Chinese reading of one engine issue line, or undefined when it is not a known problem. */
export function issueLabel(line: string): Bilingual | undefined {
  for (const [re, zh] of COMPILED) {
    const m = re.exec(line);
    if (!m) continue;
    const [, subject, ...groups] = m;
    return { zh: `${subject ? `${subject}：` : ''}${zh(groups as string[])}`, en: line };
  }
  return undefined;
}
