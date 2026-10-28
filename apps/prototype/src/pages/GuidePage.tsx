// Scenario guide: the order of steps and the accounts that perform them. The product itself
// never runs steps on the user's behalf; this page only explains and lets you switch accounts.

import { Button, Card, Space, Steps, Tag, Typography } from 'antd';
import { setSession, useEngineState } from '../app/store.ts';
import { navigate } from '../app/router.ts';
import { PageHeader } from '../components/common.tsx';
import { useI18n } from '../i18n/i18n.tsx';

interface Step {
  account: string;
  workspace?: string;
  page: string;
  zh: string;
  en: string;
  expectZh: string;
  expectEn: string;
}

interface Scenario {
  key: string;
  titleZh: string;
  titleEn: string;
  steps: Step[];
}

export const SCENARIOS: Scenario[] = [
  {
    key: 'authoring',
    titleZh: '主线一 · 业务研发：定义文件与采集策略',
    titleEn: 'Flow 1 · Business development: files and policies',
    steps: [
      { account: 'business', workspace: 'team-brake', page: 'features', zh: '创建 Feature，例如 brake_monitor_v2', en: 'Create a Feature, e.g. brake_monitor_v2', expectZh: 'Feature 为草稿，基线为初始研发配置', expectEn: 'Draft Feature on the initial development config' },
      { account: 'business', workspace: 'team-brake', page: 'features', zh: '在“文件列表”添加文件：ADC /var/log/brake abs_*.log', en: 'In Files add ADC /var/log/brake abs_*.log', expectZh: '平台生成 data_key 与代码，并固定文本日志的默认处理绑定', expectEn: 'A data_key and code are generated; the text-log default binding is fixed' },
      { account: 'business', workspace: 'team-brake', page: 'features', zh: '在“采集策略”添加 chassis.brake.abs_active：触发 abs.active AND vehicle_speed > 20', en: 'Add policy chassis.brake.abs_active with trigger abs.active AND vehicle_speed > 20', expectZh: '触发条件实时校验；窗口不超过 120 秒', expectEn: 'The trigger is validated live; window ≤ 120 s' },
      { account: 'business', workspace: 'team-brake', page: 'features', zh: '提交', en: 'Submit', expectZh: '生成 r001 提交；普通内容直接 DCL Ready', expectEn: 'Commit r001 is created; ordinary content is DCL Ready at once' },
    ],
  },
  {
    key: 'personal-sim',
    titleZh: '个人研发仿真：草稿自测',
    titleEn: 'Personal simulation: self-testing a draft',
    steps: [
      { account: 'business', workspace: 'team-brake', page: 'fleet', zh: '在“车辆与车辆组 → 我的研发仿真”新建个人仿真：制动组、镜像 x89-dev-sim', en: 'Under Vehicles & groups → My simulations create one: brake group, image x89-dev-sim', expectZh: '得到 SIM-P001，整车软件未知，基线为初始配置；它不出现在工作区车辆或车辆组里', expectEn: 'SIM-P001 with unknown software on the initial configuration; it is in no workspace vehicles or groups' },
      { account: 'business', workspace: 'team-brake', page: 'features', zh: '在 brake_monitor 的草稿里修改“急刹车”的触发条件，不提交', en: 'Change the 急刹车 trigger in the brake_monitor draft without submitting', expectZh: 'Feature 回到草稿', expectEn: 'The Feature is a draft again' },
      { account: 'business', workspace: 'team-brake', page: 'fleet', zh: '打开 SIM-P001，选择 brake_monitor，“配置草稿”', en: 'Open SIM-P001, choose brake_monitor and Send draft', expectZh: '等待回执；回执前什么都不运行', expectEn: 'Awaiting the receipt; nothing runs before it' },
      { account: 'business', page: 'simulator', zh: '在原型工具 → 车辆模拟器为 SIM-P001 发送成功回执，再对它的草稿策略“试触发”', en: 'In Prototype → Vehicle simulator send SIM-P001 a successful receipt, then make a trial capture of its draft policy', expectZh: '草稿生效；试触发只在个人仿真里看到，不产生采集事件', expectEn: 'The draft runs; the trial shows only on the personal simulation and makes no collection event' },
      { account: 'business', workspace: 'team-brake', page: 'fleet', zh: '在 SIM-P001 记录个人自测 PASS', en: 'Record a PASS self-test on SIM-P001', expectZh: 'brake_monitor 的“下发与测试”显示个人自测（不计入验证），阶段不变', expectEn: 'brake_monitor’s Dispatch & tests lists the self-test (not team evidence); the stage is unchanged' },
      { account: 'business', workspace: 'team-brake', page: 'features', zh: '提交 brake_monitor', en: 'Submit brake_monitor', expectZh: '提交对话框提示草稿已自测 PASS；自测标注“与提交一致”；团队测试照常按车辆组进行', expectEn: 'The submit dialog notes the PASS self-test; the self-test shows Matches commit; team testing still goes through vehicle groups' },
      { account: 'business', workspace: 'team-brake', page: 'fleet', zh: '释放 SIM-P001', en: 'Release SIM-P001', expectZh: '配额空出一个，自测与试触发历史保留', expectEn: 'One quota slot frees; self-tests and trial captures stay' },
    ],
  },
  {
    key: 'sim-software',
    titleZh: '仿真车软件：构建、部署与回滚',
    titleEn: 'Simulation software: build, deploy, roll back',
    steps: [
      { account: 'business', workspace: 'team-brake', page: 'fleet', zh: '在“我的研发仿真”打开一个个人仿真，在“运行镜像”构建制动模块：https://github.com/example/brake，main', en: 'Open a personal simulation under My simulations; under Running image build the brake module from https://github.com/example/brake, main', expectZh: '构建待处理；运行镜像不变', expectEn: 'The build waits; the running image is unchanged' },
      { account: 'business', page: 'simulator', zh: '在原型工具 → 车辆模拟器“构建成功”', en: 'In Prototype → Vehicle simulator, Build succeeds', expectZh: '生成派生镜像与 mock-commit', expectEn: 'A derived image with a mock commit' },
      { account: 'business', workspace: 'team-brake', page: 'fleet', zh: '停止实例，部署该构建；在模拟器“部署成功”', en: 'Stop the instance, deploy the build; in the simulator, Deployment succeeds', expectZh: '运行派生镜像，来源整车版本不变；DCL 已生效配置清空，需重新下发草稿', expectEn: 'It runs the derived image with the same source version; the applied DCL configuration is cleared, so send the draft again' },
      { account: 'business', workspace: 'team-brake', page: 'fleet', zh: '停止实例，回滚；在模拟器“部署成功”', en: 'Stop the instance, roll back; in the simulator, Deployment succeeds', expectZh: '回到之前的镜像；再次回滚被拒绝', expectEn: 'The previous image is back; a second rollback is refused' },
      { account: 'workspace_manager', workspace: 'team-brake', page: 'fleet', zh: '在“工作区车辆”对 SIM-021 打开“运行镜像”，停止后切换到 x89-1.1-sim', en: 'Under Workspace vehicles open Running image on SIM-021; stop it and switch to x89-1.1-sim', expectZh: '仿真服务确认后软件为 1.1；车辆组需按新软件版本重新下发', expectEn: 'Once the provider confirms, it runs 1.1; the group must be dispatched again for the new software' },
    ],
  },
  {
    key: 'software-change',
    titleZh: '整车软件版本变化',
    titleEn: 'Vehicle software changes',
    steps: [
      { account: 'business', page: 'simulator', zh: '在原型工具 → 车辆模拟器对 VEH-001“更多 → 模拟整车软件 OTA…”刷写 1.1，再“上报”', en: 'In Prototype → Vehicle simulator, on VEH-001 use More → Simulate a vehicle software OTA… with 1.1, then Report', expectZh: '平台从签名上报中得知 VEH-001 运行 1.1', expectEn: 'The platform learns from the signed report that VEH-001 runs 1.1' },
      { account: 'business', workspace: 'team-brake', page: 'workbench', zh: '在工作台“车辆软件已变化”打开 VEH-001', en: 'On the workbench open VEH-001 under Vehicle software changed', expectZh: '基线、文件、策略逐层检查；新旧版本同一策略集且都可运行时为“无需修改”', expectEn: 'Base, files and policies are checked level by level; with the same set and everything runnable it reads No change needed' },
      { account: 'business', workspace: 'team-brake', page: 'workbench', zh: '点“确认”', en: 'Click Confirm', expectZh: '不建分支、不重新下发；车上的测试结果继续有效并标注测试时的版本', expectEn: 'No branch and no republish; the vehicle’s results still count, tagged with the version they ran on' },
      { account: 'resource', page: 'plm', zh: '车辆上报 PLM 未发布的版本时，台账显示“上报”，平台等 PLM：在原型工具 → PLM（模拟）发布这个版本，再让车辆上报一次', en: 'When a vehicle reports a version PLM has not published, the registry shows the report and the platform waits for PLM: publish the version in Prototype → PLM (simulated), then let the vehicle report again', expectZh: '平台同步 PLM 版本后，按车辆上报更新它的软件并通知车辆组团队', expectEn: 'Once the PLM version is synced, the vehicle’s report updates its software and its group’s team is told' },
    ],
  },
  {
    key: 'borrowing',
    titleZh: '借用车辆与下发、推送',
    titleEn: 'Borrowing a vehicle; dispatch and push',
    steps: [
      { account: 'workspace_manager', workspace: 'team-brake', page: 'fleet/loans', zh: '在“借用”点“借用车辆”，对 VEH-004“申请借用”：制动研发车组，7 天，AEB 联合制动验证', en: 'Under Loans click Borrow a vehicle and ask for VEH-004: 制动研发车组, 7 days, joint AEB brake validation', expectZh: '目录只显示类型、资源池、整车软件、状态和使用方，不显示车上配置', expectEn: 'The catalog shows type, pool, software, status and who uses it, never the configuration' },
      { account: 'adc_integrator', workspace: 'team-adc-system', page: 'fleet/loans', zh: '在“借出”对 VEH-004 点“同意”', en: 'Under Lent click Agree for VEH-004', expectZh: '使用方先同意，再交给车辆资源', expectEn: 'The workspace using the car agrees first, then vehicle resources decide' },
      { account: 'resource', page: 'fleet/loans', zh: '在“借用审批”批准', en: 'Approve under Loan approvals', expectZh: 'VEH-004 离开系统应用研发车组，加入制动研发车组，标注“借用 · 至 …”', expectEn: 'VEH-004 leaves its ADC group and joins the brake group, tagged Borrowed · until …' },
      { account: 'business', workspace: 'team-brake', page: 'fleet/groups', zh: '在车辆模拟器让 VEH-004“上报”，再打开它的“与车辆组不匹配”', en: 'Make VEH-004 report in the simulator, then open its Does not fit tag', expectZh: '软件未知时不推送；两种做法：修改策略并下发，或更新整车版本', expectEn: 'Unknown software is not pushed; two ways: adapt the policies and dispatch, or update the vehicle’s software' },
      { account: 'business', workspace: 'team-brake', page: 'fleet/groups', zh: '“更新整车版本”到 1.0，在模拟器“整车 OTA 系统”点“更新成功”', en: 'Update vehicle software to 1.0, then Update succeeds in the simulator’s vehicle OTA card', expectZh: '车辆重启上报 1.0，云端推送车辆组的配置（随车辆组推送），回执后生效', expectEn: 'The vehicle restarts and reports 1.0; the cloud pushes the group’s configuration, applied after the receipt' },
      { account: 'workspace_manager', workspace: 'team-brake', page: 'simulator', zh: '在“模拟时间”推进 7 天两次', en: 'Under Simulated time move forward 7 days twice', expectZh: '借用到期：不能再下发，双方收到提醒；可申请延期或归还', expectEn: 'The loan is overdue: no new dispatches, both sides are warned; extend or return it' },
    ],
  },
  {
    key: 'device-faults',
    titleZh: '车端故障与恢复',
    titleEn: 'Device faults and recovery',
    steps: [
      { account: 'brake_tester', workspace: 'team-brake', page: 'simulator', zh: '在“车端 Agent”打开 SIM-021、VEH-001 的自动回执，把 VEH-001 的车端故障设为“配置包校验失败”', en: 'Under On-vehicle agents turn on Auto receipt for SIM-021 and VEH-001 and set VEH-001’s device fault to Package checksum fails', expectZh: '故障持续到改回“无”', expectEn: 'The fault lasts until set back to None' },
      { account: 'brake_tester', workspace: 'team-brake', page: 'features', zh: '把 guided_brake 下发到制动研发车组，在模拟器“执行一步”', en: 'Dispatch guided_brake to 制动研发车组, then Step once in the simulator', expectZh: 'VEH-001 回执失败“配置包校验失败：未安装，保留原配置”，已生效配置不变', expectEn: 'VEH-001 answers failed: checksum mismatch, nothing installed; its configuration stays' },
      { account: 'brake_tester', workspace: 'team-brake', page: 'simulator', zh: '把故障改为“回执丢失”，再下发并执行一步', en: 'Change the fault to Receipt lost, dispatch again and step', expectZh: '车辆已应用、回执未送达：平台仍“已推送·待回执”，客户端状态显示与平台记录不同', expectEn: 'Applied, receipt not delivered: the platform still waits, and the client state differs from the platform record' },
      { account: 'brake_tester', workspace: 'team-brake', page: 'simulator', zh: '把故障改回“无”，执行一步', en: 'Set the fault back to None and step', expectZh: '同一尝试的回执补发，平台只确认一次', expectEn: 'The same attempt’s receipt is sent again and confirmed once' },
    ],
  },
  {
    key: 'lifecycle',
    titleZh: '车辆环境迁移与组织归档',
    titleEn: 'Vehicle environments and archiving',
    steps: [
      { account: 'resource', page: 'fleet/registry', zh: '在车辆台账对 VEH-003 点“变更环境”，选“测试”', en: 'In the registry click Change environment on VEH-003 and pick Testing', expectZh: '它还在转向研发车组：先移出才能变更', expectEn: 'It still routes through the steering group: take it out first' },
      { account: 'workspace_manager', workspace: 'team-steering', page: 'fleet/groups', zh: '把 VEH-003 移出转向研发车组', en: 'Take VEH-003 out of the steering vehicle group', expectZh: '车辆回到未分组', expectEn: 'The vehicle is ungrouped' },
      { account: 'resource', page: 'fleet/registry', zh: '再变更到测试，写明原因', en: 'Move it to Testing again, with a reason', expectZh: '环境变为测试，软件与已生效配置不变；转向团队收到通知', expectEn: 'It is a testing vehicle now, with the same software and configuration; the steering team is told' },
      { account: 'resource', page: 'fleet/registry', zh: '对 VEH-001 选“量产”', en: 'Pick Production for VEH-001', expectZh: '团队工作区在用、没有运行适用于其软件的正式策略集：不能转量产', expectEn: 'A team workspace uses it and it runs no formal set for its software: no production' },
      { account: 'workspace_manager', workspace: 'team-steering', page: 'workbench', zh: '在工作台点“归档本工作区…”', en: 'On the workbench click Archive this workspace…', expectZh: '列出来源依赖、未结束的 Feature 与运行中的仿真，不能归档', expectEn: 'Source use, open Features and a running simulation are listed; it cannot be archived' },
      { account: 'workspace_manager', workspace: 'team-brake', page: 'workbench', zh: '在“业务分组”新建一个研发组，再归档它', en: 'Under Business groups create a development group, then archive it', expectZh: '只有本工作区持有的组可由本区管理员归档；归档后不再加入工作区或新建 Feature', expectEn: 'Only a group no other workspace holds is archived by this admin; it then joins no workspace and starts no Feature' },
      { account: 'admin', page: 'org', zh: '在“工作区”归档一个没有事务的工作区，再“恢复”', en: 'Under Workspaces archive a workspace with nothing in flight, then Restore it', expectZh: '归档后从工作区切换中消失、拒绝一切操作；恢复后历史保留两条', expectEn: 'Archived it leaves the switcher and refuses every action; after the restore both entries stay in the history' },
    ],
  },
  {
    key: 'intake',
    titleZh: 'DCL 接入 · 敏感文件审核',
    titleEn: 'DCL intake · sensitive review',
    steps: [
      { account: 'dcl', page: 'intake', zh: '打开 DCL 接入队列，进入 parking_camera', en: 'Open DCL intake and open parking_camera', expectZh: '环视视频为待审核', expectEn: 'The surround video is pending review' },
      { account: 'dcl', page: 'intake', zh: '在“DCL 接入”页签确认全部控制项并批准', en: 'In the DCL intake tab confirm every control and approve', expectZh: 'Feature 变为 DCL Ready', expectEn: 'The Feature becomes DCL Ready' },
      { account: 'adc_parking', workspace: 'team-adc-parking', page: 'features', zh: '把策略窗口改为前 30 秒并重新提交', en: 'Change the policy window to 30 s before and resubmit', expectZh: '内容变化使批准失效，重新进入待审核', expectEn: 'The change invalidates the approval; the Feature waits for review again' },
      { account: 'dcl', page: 'intake', zh: '拒绝并填写原因', en: 'Reject with a reason', expectZh: 'Feature 退回草稿，业务方看到反馈', expectEn: 'The Feature returns to Draft with feedback for the authors' },
    ],
  },
  {
    key: 'validation',
    titleZh: '主线一 · 业务测试：先仿真后实车，确认验证通过',
    titleEn: 'Flow 1 · Business testing: simulation, then physical, then Verified',
    steps: [
      { account: 'workspace_manager', workspace: 'team-brake', page: 'fleet', zh: '查看工作区车辆与“制动研发车组”（SIM-021 仿真、VEH-001 实车）', en: 'Review workspace vehicles and the brake development group (SIM-021, VEH-001)', expectZh: '每辆车只属于一个车辆组；实际软件版本与已生效配置分别显示', expectEn: 'Each vehicle routes through one group; actual software and applied configuration are shown separately' },
      { account: 'brake_tester', workspace: 'team-brake', page: 'features', zh: '打开 guided_brake →“下发与测试”→ 按车辆组下发', en: 'Open guided_brake → Dispatch & tests → dispatch to the vehicle group', expectZh: '两辆车等待回执；车辆的已生效配置尚未改变', expectEn: 'Both vehicles await receipts; their applied configuration has not changed yet' },
      { account: 'brake_tester', page: 'simulator', zh: '在车辆模拟器中让 SIM-021 回执成功、VEH-001 回执失败', en: 'In the simulator, SIM-021 applies and VEH-001 fails', expectZh: '只有成功回执更新已生效配置；失败的车辆保留原配置', expectEn: 'Only the applied receipt changes the applied configuration; the failed vehicle keeps its old one' },
      { account: 'brake_tester', workspace: 'team-brake', page: 'features', zh: '为 SIM-021 登记 PASS；对 VEH-001 再次下发并在模拟器回执成功后登记 PASS', en: 'Record PASS for SIM-021; redispatch VEH-001, apply it in the simulator, record PASS', expectZh: '实车结果必须在仿真通过之后', expectEn: 'Physical results require a passing simulation first' },
      { account: 'brake_tester', workspace: 'team-brake', page: 'features', zh: '确认验证通过', en: 'Confirm Verified', expectZh: 'Feature 已验证，可交给配置集成', expectEn: 'The Feature is verified and ready for integration' },
      { account: 'dispatch_operator', workspace: 'team-brake', page: 'features', zh: '用“仅下发”测试账号尝试登记结果', en: 'Try recording a result as the dispatch-only tester', expectZh: '可以下发，但不能登记结果或确认验证通过', expectEn: 'It can dispatch but cannot record results or verify' },
    ],
  },
  {
    key: 'integration',
    titleZh: '主线二 · 配置集成与集成测试',
    titleEn: 'Flow 2 · Configuration integration and integration testing',
    steps: [
      { account: 'integrator', workspace: 'x89-project', page: 'integration', zh: '在“合并与处理确认”选择 Verified 的 steering_return_rate（基于策略集 1.0.0；可先完成主线一，把 guided_brake 也加入）并预览合并', en: 'Under Merge & processing select the Verified steering_return_rate (built on policy set 1.0.0; finish flow 1 to add guided_brake) and preview', expectZh: '三方合并到策略集 1.0.0：转角突变策略的事后窗口变化、新增回正策略；显示最终处理集合', expectEn: 'Three-way onto policy set 1.0.0: the angle-jump window changes and a return-rate policy is added; the final processing set is shown' },
      { account: 'dcl', workspace: 'x89-project', page: 'integration', zh: '确认最终处理集合', en: 'Confirm the final processing set', expectZh: '确认绑定在预览摘要上；敏感文件须以合并后的内容获得批准', expectEn: 'The confirmation binds to the preview digest; sensitive files need approval of the merged content' },
      { account: 'integrator', workspace: 'x89-project', page: 'integration', zh: '冻结为集成候选 X89-C2', en: 'Freeze as candidate X89-C2', expectZh: '生成完整车辆配置；来源 Feature 变为“已集成”；候选测试从零开始', expectEn: 'A complete vehicle configuration is created; sources become Integrated; candidate tests start from zero' },
      { account: 'integration_tester', workspace: 'x89-integration', page: 'integration', zh: '打开候选 → 下发到“X89 集成测试车组”', en: 'Open the candidate → dispatch to the X89 integration test group', expectZh: 'SIM-101 与 VEH-031 等待回执；只能下发到集成工作区的测试车辆组', expectEn: 'SIM-101 and VEH-031 await receipts; only the integration workspace’s testing groups are allowed' },
      { account: 'integration_tester', page: 'simulator', zh: '在车辆模拟器中让两辆车回执成功', en: 'In the simulator, apply on both vehicles', expectZh: '车辆的已生效配置变为候选配置', expectEn: 'Both vehicles now run the candidate configuration' },
      { account: 'integration_tester', workspace: 'x89-integration', page: 'integration', zh: '先为 SIM-101、再为 VEH-031 登记 PASS，然后确认集成验证通过', en: 'Record PASS for SIM-101, then VEH-031, then confirm Verified', expectZh: '候选“集成已验证”，可交给配置发布', expectEn: 'The candidate is Verified and ready for release' },
      { account: 'integrator', workspace: 'x89-project', page: 'integration', zh: '（冲突演示）在制动组再建一个 Feature，定义同名策略 chassis.brake.hard_braking 但触发不同；验证后与 guided_brake 一起预览', en: '(Conflict demo) Create another brake Feature defining policy chassis.brake.hard_braking differently; verify it and preview it with guided_brake', expectZh: '预览显示整项冲突与解决方；冲突由业务方在来源 Feature 中解决', expectEn: 'The preview shows a whole-item conflict and its owner; the business side resolves it in a source Feature' },
    ],
  },
  {
    key: 'release',
    titleZh: '主线三 · 正式发布与配置 OTA',
    titleEn: 'Flow 3 · Formal release and configuration OTA',
    steps: [
      { account: 'release', workspace: 'x89-project', page: 'release', zh: '在“策略集发布”发布 X89-C2：先勾选 1.0 和 1.1 试一下，再只选 1.0，版本 1.0.1', en: 'Under Policy sets promote X89-C2: try 1.0 and 1.1 first, then only 1.0, as version 1.0.1', expectZh: '1.1 没有集成测试被拒绝；发布后量产车的已生效配置仍是策略集 1.0.0', expectEn: '1.1 is refused for lack of integration tests; after publishing the production vehicles still run policy set 1.0.0' },
      { account: 'release', workspace: 'x89-project', page: 'release', zh: '在“配置 OTA”新建 OTA：策略集 1.0.1 → X89 量产车组，第一批只选 VEH-201', en: 'Under Configuration OTA start a rollout of policy set 1.0.1 to the X89 production group, first wave VEH-201 only', expectZh: 'VEH-201 等待回执，VEH-202 待放量', expectEn: 'VEH-201 awaits a receipt; VEH-202 is queued' },
      { account: 'release', page: 'simulator', zh: '在车辆模拟器中让 VEH-201 回执失败', en: 'In the simulator, VEH-201 fails', expectZh: 'OTA 自动暂停；VEH-201 保留策略集 1.0.0', expectEn: 'The rollout pauses; VEH-201 keeps policy set 1.0.0' },
      { account: 'release', workspace: 'x89-project', page: 'release', zh: '恢复 OTA，再在模拟器中让 VEH-201 回执成功', en: 'Resume the rollout, then apply on VEH-201 in the simulator', expectZh: '失败记录保留为尝试 #0，新尝试 #1 成功后才更新已生效配置', expectEn: 'The failure stays as attempt #0; attempt #1 succeeds and only then changes the applied configuration' },
      { account: 'release', workspace: 'x89-project', page: 'release', zh: '扩大范围到 VEH-202，并在模拟器中回执成功', en: 'Expand to VEH-202 and apply it in the simulator', expectZh: 'OTA 结束，两辆车都运行策略集 1.0.1', expectEn: 'The rollout finishes; both vehicles run policy set 1.0.1' },
      { account: 'release', workspace: 'x89-project', page: 'release', zh: '回滚该 OTA，并在模拟器中回执成功', en: 'Roll the rollout back and apply in the simulator', expectZh: '以新的 OTA 回到兼容的策略集 1.0.0；原记录保留', expectEn: 'A new rollout returns both to the compatible policy set 1.0.0; the original record stays' },
      { account: 'resource', page: 'simulator', zh: '在车辆模拟器对 VEH-202“更多 → 模拟整车软件 OTA…”刷写 1.1、选 BMS 升级失败，再“上报”；然后让配置发布尝试新建 OTA', en: 'In the simulator flash VEH-202 with 1.1 with BMS failing (More → Simulate a vehicle software OTA…), Report, then try a new rollout as release', expectZh: '量产下发被阻止，不会回退到研发配置', expectEn: 'Production rollout is blocked and never falls back to a development configuration' },
    ],
  },
  {
    key: 'query',
    titleZh: '主线四 · 采集事件与数据查询',
    titleEn: 'Flow 4 · Collection events and data query',
    steps: [
      { account: 'steering', workspace: 'team-steering', page: 'query', zh: '在“售后查询”输入 VEH-003，打开处理失败的事件', en: 'Under After-sales enter VEH-003 and open the failed event', expectZh: '只显示本组该车事件；详情显示 ParserFailure、采集文件与折叠的配置快照', expectEn: 'Only this group’s events of that vehicle; the detail shows the ParserFailure, captured files and the folded configuration snapshot' },
      { account: 'steering', workspace: 'team-steering', page: 'query', zh: '输入量产车 VEH-201 查询', en: 'Search for the production vehicle VEH-201', expectZh: '没有结果：量产事件属于项目工作区与量产环境，查询条件不能扩大授权', expectEn: 'No results: production events belong to the project workspace and environment; filters never widen grants' },
      { account: 'release', workspace: 'x89-project', page: 'query', zh: '查询 VEH-201 的售后事件，并切到“训练数据查询”，按质量 A 选择数据并导出清单', en: 'Look up VEH-201’s events, then under Training data pick quality A and export the manifest', expectZh: '训练结果不含车辆身份与整车版本；清单是 JSON', expectEn: 'Training results carry no vehicle identity or software; the manifest is JSON' },
      { account: 'release', workspace: 'x89-project', page: 'query', zh: '把“数据可用性”改为“全部”', en: 'Set Availability to All', expectZh: '失败、质量未知、用途待确认的记录显示原因，没有选择入口', expectEn: 'Failed, unknown-quality and unconfirmed records show their reasons and cannot be selected' },
      { account: 'release', page: 'simulator', zh: '在车辆模拟器中为 VEH-201 触发转角突变事件，执行几步', en: 'In the simulator fire the angle-jump policy on VEH-201 and step it', expectZh: '只采集该策略的文件；处理完成后质量与用途仍为“未知 / 待确认”', expectEn: 'Only that policy’s files are captured; once processed, quality and use are still unknown / unconfirmed' },
      { account: 'dcl', workspace: 'x89-project', page: 'query', zh: '打开处理失败的事件并“重新处理”，再到模拟器执行一步', en: 'Open the failed event, Reprocess, then step the simulator', expectZh: '以相同的固定版本重新解析成功，产物地址不变', expectEn: 'It parses again with the same pinned versions; the artifact address is stable' },
    ],
  },
  {
    key: 'reference',
    titleZh: '跨组只读引用',
    titleEn: 'Cross-group read-only reference',
    steps: [
      { account: 'business', workspace: 'team-brake', page: 'data', zh: '在“引用申请”批准转向组对制动调试数据的申请', en: 'Under Reference requests approve steering’s request for the brake debug data', expectZh: '转向组可看到来源与代码', expectEn: 'Steering can now see source and code' },
      { account: 'steering', workspace: 'team-steering', page: 'features', zh: '创建 Feature，在文件列表“添加引用”，再添加采集它的策略并提交', en: 'Create a Feature, add the reference, a policy capturing it, and submit', expectZh: '提交中该文件标记为引用，定义仍属于制动组', expectEn: 'The commit marks the file as a reference; brake keeps the definition' },
      { account: 'business', workspace: 'team-brake', page: 'data', zh: '撤销该引用', en: 'Revoke the reference', expectZh: '转向组 Feature 回到草稿；新的提交被阻止，历史提交不变', expectEn: 'Steering’s Feature returns to Draft; new submits are blocked; history stays' },
    ],
  },
  {
    key: 'subsystem',
    titleZh: '子系统集成：ADC 先集成发布，整车再收集',
    titleEn: 'Subsystem integration: ADC integrates and publishes, then the whole vehicle collects it',
    steps: [
      { account: 'adc_parking', workspace: 'team-adc-parking', page: 'features', zh: '创建 Feature，添加文本日志和采集它的策略并提交', en: 'Create a Feature with a text log and a policy capturing it, and submit', expectZh: '生成 r001，DCL Ready', expectEn: 'Commit r001, DCL Ready' },
      { account: 'adc_parking_tester', workspace: 'team-adc-parking', page: 'features', zh: '下发到泊车研发车组，回执后先仿真后实车登记 PASS，确认验证通过', en: 'Dispatch to 泊车研发车组, then record PASS on the simulator and the car and confirm Verified', expectZh: 'Feature 为 Verified', expectEn: 'The Feature is Verified' },
      { account: 'adc_integrator', workspace: 'x89-adc-integration', page: 'integration', zh: '在 ADC 子系统集成中勾选已验证 Feature 并预览合并', en: 'In the ADC subsystem merge tick the Verified Feature and preview', expectZh: '只列出 ADC 域的 Feature；预览等待 DCL 确认', expectEn: 'Only ADC Features are listed; the preview awaits DCL' },
      { account: 'dcl', workspace: 'x89-adc-integration', page: 'integration', zh: '确认处理集合', en: 'Confirm the processing set', expectZh: '预览变为可冻结', expectEn: 'The preview can be frozen' },
      { account: 'adc_integrator', workspace: 'x89-adc-integration', page: 'integration', zh: '冻结、下发到 ADC 域集成测试车组、先仿真后实车登记 PASS、确认验证，再“发布子系统”', en: 'Freeze, dispatch to ADC 域集成测试车组, record PASS (simulator first), confirm, then Publish subsystem', expectZh: '得到 ADC-S1：可供整车集成，不是 DCL 策略集版本', expectEn: 'ADC-S1: ready for whole-vehicle integration, not a DCL policy set' },
      { account: 'integrator', workspace: 'x89-project', page: 'integration', zh: '在“可集成的子系统发布”勾选 ADC-S1，与底盘 Feature 一起预览合并', en: 'Tick ADC-S1 under Subsystem releases to integrate, with a chassis Feature, and preview', expectZh: '来源中显示子系统发布；冻结后候选沿用它的提交', expectEn: 'The subsystem release is a source; the candidate keeps its commits' },
    ],
  },
  {
    key: 'client-report',
    titleZh: '车辆客户端状态上报',
    titleEn: 'Vehicle client reports',
    steps: [
      { account: 'resource', page: 'fleet', zh: '在“车辆台账”打开 SIM-021 的客户端状态', en: 'Under Vehicle registry open SIM-021’s client state', expectZh: '实际版本、DCL 客户端、已生效配置与平台记录对照；历史中有重启前的启动', expectEn: 'Actual software, DCL client and applied configuration compared with the platform; the history shows the boot before the restart' },
      { account: 'resource', page: 'simulator', zh: '在车辆模拟器把 SIM-021 设为离线，升级客户端后点“上报”', en: 'In the simulator set SIM-021 offline, upgrade the client, then Report', expectZh: '离线，已暂存待补报；平台最新状态不变', expectEn: 'Offline, queued; the platform’s latest report is unchanged' },
      { account: 'resource', page: 'simulator', zh: '恢复在线后点“补报”', en: 'Back online, Send queued', expectZh: '最新状态更新为新客户端版本，历史保留', expectEn: 'The latest report shows the new client; history is kept' },
      { account: 'resource', page: 'simulator', zh: '在“更多”中重放上一份、篡改签名、乱序到达', en: 'Under More resend the last report, tamper with one, deliver two out of order', expectZh: '重复被忽略；篡改被拒绝；较旧的只进入历史', expectEn: 'The resend is ignored; the tampered one refused; the older one only joins the history' },
    ],
  },
  {
    key: 'policy-sets',
    titleZh: '策略集与整车软件版本',
    titleEn: 'Policy sets and software versions',
    steps: [
      { account: 'resource', page: 'plm', zh: '在原型工具 → PLM（模拟）发布 X89 1.2（不带 DCL 件）；在“车辆与车辆组 → 软件版本与镜像”为 1.2“补录清单”（从上一版本复制）；在车辆模拟器把 VEH-202 刷到 1.2 并“上报”', en: 'In Prototype → PLM (simulated) publish X89 1.2 (no DCL part); under Vehicles → Software versions add 1.2’s manifest (Copy from previous version); in the simulator flash VEH-202 with 1.2 and Report', expectZh: '同步后自动开启适用性确认；VEH-202 没有适用策略集，被阻止', expectEn: 'Once synced an applicability check opens; VEH-202 has no set and is blocked' },
      { account: 'integration_tester', workspace: 'x89-integration', page: 'integration', zh: '准备运行 1.2 的仿真与实车（镜像 x89-1.2-sim），在“适用性测试”下发、回执、先仿真后实车登记 PASS、确认验证', en: 'With a simulation and a vehicle on 1.2 (image x89-1.2-sim), under Applicability tests dispatch, apply, record PASS (simulation first) and verify', expectZh: '运行 1.0 的车辆被拒绝；验证后等待配置发布', expectEn: 'Vehicles on 1.0 are refused; once verified it waits for release' },
      { account: 'release', workspace: 'x89-project', page: 'release', zh: '在“软件版本与适用性”确认适用', en: 'Under Software & applicability confirm it', expectZh: '策略集 1.0.0 版本号不变，追加适用 1.2；VEH-202 应运行它', expectEn: 'Policy set 1.0.0 keeps its version and now also applies to 1.2; VEH-202 resolves to it' },
      { account: 'brake_tester', workspace: 'team-brake', page: 'features', zh: '在 brake_monitor 的“下发与测试”下发时关闭 chassis.steering.angle_jump', en: 'Dispatch brake_monitor with chassis.steering.angle_jump switched off', expectZh: '每辆车按自身软件的策略集为基线；被关闭的策略在车上不触发', expectEn: 'Each vehicle builds on its software’s set; the switched-off policy does not fire' },
      { account: 'dcl', workspace: 'x89-project', page: 'release', zh: '在策略集 1.0.0 的策略上“紧急停用”，再由 release 批准', en: 'Request an emergency stop on a policy of 1.0.0; release approves', expectZh: '生成去掉该策略的新策略集版本，只适用于原策略集生效的软件版本', expectEn: 'A new set version without the policy, only for the versions the source served' },
    ],
  },
  {
    key: 'calls',
    titleZh: '集成征集：X89 1.2 从征集到发布',
    titleEn: 'Integration call: X89 1.2 from call to release',
    steps: [
      { account: 'integration_admin', workspace: 'x89-project', page: 'versions', zh: '“集成版本 → 集成征集”中发起集成征集：目标版本 1.2，基线 1.1，四个模块都参加', en: 'Under Integration versions → Integration calls, open a call: target 1.2, base 1.1, all four modules taking part', expectZh: '制动、转向是叶子模块，ADC、CDC 是上层模块，都待提交；1.2 是自己起的工作名，PLM 还没有版本号，平台建为规划中', expectEn: 'Brake and steering are leaf modules, ADC and CDC upper modules, all waiting; 1.2 is a working name of your own, which PLM has no number for yet, planned by the platform' },
      { account: 'steering', workspace: 'team-steering', page: 'features', zh: '打开已验证的 steering_return_rate，点“提交到 X89 1.2”', en: 'Open the Verified steering_return_rate and click Submit to X89 1.2', expectZh: '转向模块变为已提交，记录了提交的版本', expectEn: 'The steering module is submitted, with the commit recorded' },
      { account: 'business', workspace: 'team-brake', page: 'features', zh: '打开已验证的 brake_monitor，点“提交到 X89 1.2”', en: 'Open the Verified brake_monitor and click Submit to X89 1.2', expectZh: '制动模块已提交；陈明不能替转向组提交', expectEn: 'The brake module is submitted; 陈明 cannot submit for steering' },
      { account: 'adc_integrator', workspace: 'x89-adc-integration', page: 'versions', zh: '打开 X89 1.2，在 ADC 模块上“开子征集”，两个 ADC 组都参加', en: 'Open X89 1.2 and, on the ADC module, open a domain call with both ADC groups', expectZh: '子征集 X89 1.2 · ADC 列出泊车组和系统应用组', expectEn: 'The domain call X89 1.2 · ADC lists the parking and system groups' },
      { account: 'adc_parking', workspace: 'team-adc-parking', page: 'versions', zh: '在子征集里提交“本次无变更”（adc_system 同样提交）', en: 'Submit No change in the domain call (adc_system does the same)', expectZh: '两组都答复后，子征集可以按无变更结束', expectEn: 'Once both answer, the domain call can close with no change' },
      { account: 'adc_integrator', workspace: 'x89-adc-integration', page: 'versions', zh: '子征集点“按无变更结束”', en: 'Close the domain call: no change', expectZh: '整车征集的 ADC 模块自动变为“本次无变更”', expectEn: 'The whole-vehicle call’s ADC module becomes No change by itself' },
      { account: 'cdc_integrator', workspace: 'x89-cdc-integration', page: 'versions', zh: '在 CDC 模块上直接提交“本次无变更”', en: 'Submit No change on the CDC module directly', expectZh: '整车征集已收齐', expectEn: 'The whole-vehicle call is complete' },
      { account: 'integrator', workspace: 'x89-project', page: 'versions', zh: '点“收齐，生成集成预览”，在集成页等 DCL 确认后送测（冻结），名称默认 X89 1.2-T1', en: 'Click Complete: preview the merge; after DCL confirms on the integration page, freeze it (named X89 1.2-T1)', expectZh: '预览和候选都标着“集成征集 X89 1.2 第 1 轮”；DCL 林书涵确认处理集合', expectEn: 'The preview and candidate show “Integration call X89 1.2, round 1”; DCL (林书涵) confirms the processing set' },
      { account: 'dcl', workspace: 'x89-project', page: 'fleet', zh: '登记仿真镜像 x89-1.2-sim（整车版本选工作名 1.2）；integration_admin 用它在 X89 集成测试新建测试仿真；车辆模拟器把 VEH-031 刷到 1.2 并“上报”', en: 'Register image x89-1.2-sim on the working name 1.2; integration_admin creates a testing simulation from it in X89 integration testing; in the simulator flash VEH-031 with 1.2 and Report', expectZh: '测试车跑的是 1.2 的预发布软件并自己上报；量产车上报工作名时平台不认，等 PLM', expectEn: 'The testing vehicles run 1.2 pre-release software and report it; a production vehicle reporting a working name waits for PLM' },
      { account: 'integration_tester', workspace: 'x89-integration', page: 'integration', zh: '把 X89 1.2-T1 下发到这两辆车，仿真 PASS、实车 FAIL（回正误触发偏多）', en: 'Dispatch X89 1.2-T1 to both, record PASS on the simulation and FAIL on the vehicle (too many false triggers)', expectZh: '不能判定通过', expectEn: 'It cannot be verified' },
      { account: 'integration_admin', workspace: 'x89-project', page: 'versions', zh: '在转向模块上“退回”，写明原因；转向组修改后重新提交', en: 'Send the steering module back with the reason; steering fixes it and submits again', expectZh: 'T1 被取消；收齐后赵一鸣再预览、送测，得到 X89 1.2-T2', expectEn: 'T1 is cancelled; once complete, 赵一鸣 previews and freezes again: X89 1.2-T2' },
      { account: 'integration_tester', workspace: 'x89-integration', page: 'integration', zh: '测试 X89 1.2-T2，两辆车都 PASS，确认验证', en: 'Test X89 1.2-T2, PASS on both, verify', expectZh: '征集阶段变为“测试通过，待发布”', expectEn: 'The call is Passed, to release' },
      { account: 'release', workspace: 'x89-project', page: 'versions', zh: '在征集详情点“发布”，策略集 1.1.0', en: 'On the call, click Release: policy set 1.1.0', expectZh: '1.1.0 对应工作名 X89 1.2，配置已导出；工作名仍是规划中，等 PLM 发布', expectEn: '1.1.0 is related to working name X89 1.2 and its configuration exported; the working name stays planned until PLM publishes' },
      { account: 'dcl', workspace: 'x89-project', page: 'release', zh: '在“软件版本与策略集”的 X89 1.2 一行点“导出 DCL 件（交付 PLM）”，客户端版本 2.3.0', en: 'Under Software versions and policy sets, on X89 1.2 click Export the DCL part (for PLM), client version 2.3.0', expectZh: '得到 DCL 2.3.0+1.1.0 和配置摘要；1.2 变为“DCL 件已交付 · 待 PLM 发布”', expectEn: 'DCL 2.3.0+1.1.0 with its configuration digest; 1.2 reads DCL part handed over · waiting for PLM' },
      { account: 'release', page: 'plm', zh: '原型工具 → PLM（模拟）：发布整车版本 X89 1.2.0，BOM 中的 DCL 件选 2.3.0+1.1.0，再“同步到平台”', en: 'Prototype → PLM (simulated): publish X89 1.2.0 with DCL part 2.3.0+1.1.0 in the BOM, then Sync to platform', expectZh: '平台按配置摘要把工作名 1.2 关联到 PLM 1.2.0；1.1.0 适用于 1.2.0，不开适用性确认', expectEn: 'The platform links working name 1.2 to PLM 1.2.0 by the digest; 1.1.0 applies to 1.2.0 with no applicability check' },
      { account: 'resource', page: 'simulator', zh: '车辆模拟器对量产车 VEH-201“更多 → 模拟整车软件 OTA…”刷写 1.2.0，再“上报”', en: 'In the vehicle simulator, flash production vehicle VEH-201 with 1.2.0 (More → Simulate a vehicle software OTA…), then Report', expectZh: 'VEH-201 上报的配置摘要就是 1.1.0，平台记为运行 1.1.0，不需要配置 OTA 推送（弱网也一样）', expectEn: 'VEH-201 reports the digest of 1.1.0 and the platform takes it as running 1.1.0, with no configuration OTA push (weak signal included)' },
      { account: 'integration_admin', workspace: 'x89-project', page: 'versions', zh: '打开“发布记录”，选 X89 1.2.0', en: 'Open Release history and choose X89 1.2.0', expectZh: '从工作名 1.2 的征集、两轮测试、退回、发布，到 DCL 件交付、PLM 发布、按摘要关联、VEH-201 随包运行，每一步都有人和时间', expectEn: 'Every step, from working name 1.2’s call, both rounds, the return and the release to the part, PLM, the link and VEH-201 running it, with who and when' },
    ],
  },
  {
    key: 'plm-tsp',
    titleZh: '外部系统：PLM 发布版本，TSP 提供车辆',
    titleEn: 'External systems: versions from PLM, cars from TSP',
    steps: [
      { account: 'release', page: 'plm', zh: '原型工具 → PLM（模拟）：发布 X89 1.2，不带 DCL 件，再“同步到平台”', en: 'Prototype → PLM (simulated): publish X89 1.2 with no DCL part, then Sync to platform', expectZh: '平台记为 PLM 已发布的 1.2，自动开一张适用性确认待办；车辆页没有手工登记版本的入口', expectEn: 'The platform records 1.2 as published by PLM and opens an applicability check; the vehicles page has no way to record a version by hand' },
      { account: 'resource', workspace: 'x89-project', page: 'fleet/registry', zh: '在“车辆台账”点“登记实车”，从 TSP 选 LSDEM0X8900000007，登记为 VEH-007（研发、ADC）', en: 'Under Vehicle registry click Register vehicle, pick LSDEM0X8900000007 from TSP and register it as VEH-007 (development, ADC)', expectZh: '车型、车牌、T-Box 和硬件配置都来自 TSP；整车版本为空，等车辆上报', expectEn: 'Model, plate, T-Box and hardware come from TSP; the software is unknown until the car reports' },
      { account: 'resource', workspace: 'x89-project', page: 'fleet/registry', zh: '为 VEH-007“登记设备密钥（Mock）”（从模拟设备读取公钥），再在车辆模拟器把它刷到 1.1 并“上报”', en: 'Register VEH-007’s device key (read it from the simulated device), then flash it with 1.1 in the simulator and Report', expectZh: '车端签名上报 1.1，平台记为 1.1', expectEn: 'The car’s signed report says 1.1 and the platform records it' },
      { account: 'resource', page: 'tsp', zh: '原型工具 → TSP（模拟）：把 LSDEM0X8900000201 的应为版本改为 1.1，同步', en: 'Prototype → TSP (simulated): set LSDEM0X8900000201’s expected version to 1.1 and sync', expectZh: 'VEH-201 显示“TSP 应为 1.1”，车端仍上报 1.0，平台按 1.0；车辆资源收到不一致提醒，配置发布收到“将升到无策略集的版本”', expectEn: 'VEH-201 shows TSP expects 1.1 while the car still reports 1.0, which counts; vehicle resources are told of the difference, release that cars are to move to a version with no set' },
      { account: 'resource', page: 'simulator', zh: '在车辆模拟器把 VEH-201 刷到 1.1、选 BMS 失败，“上报”；再正常刷写一次', en: 'In the simulator flash VEH-201 with 1.1 with BMS failing and Report; then flash it again normally', expectZh: '先显示“部分域控失败”（不记整车版本），再变为 1.1，与 TSP 一致', expectEn: 'First a partial controller failure (no version claimed), then 1.1, matching TSP' },
    ],
  },
  {
    key: 'patch',
    titleZh: '同软件版本配置补丁',
    titleEn: 'Same-software configuration patch',
    steps: [
      { account: 'integration_admin', workspace: 'x89-integration', page: 'fleet', zh: '准备运行 1.1 的测试仿真（镜像 x89-1.1-sim）与实车（由车辆资源确认 1.1），加入 X89 集成测试工作区', en: 'Prepare a testing simulation (image x89-1.1-sim) and a vehicle (confirmed on 1.1 by vehicle resources) in the X89 integration workspace', expectZh: '集成测试可以在软件 1.1 上进行', expectEn: 'Integration tests can run on software 1.1' },
      { account: 'integrator', workspace: 'x89-project', page: 'integration', zh: '把 steering_return_rate 合并到主线并冻结；集成测试在 1.1 车辆上通过后，配置发布发布 1.1.0，只适用 1.1', en: 'Merge steering_return_rate onto the mainline and freeze; once it passes on the 1.1 vehicles, release publishes 1.1.0 for 1.1 only', expectZh: '主线前进到 1.1.0；软件 1.0 的车辆仍用 1.0.0', expectEn: 'The mainline moves to 1.1.0; vehicles on 1.0 keep 1.0.0' },
      { account: 'steering', workspace: 'team-steering', page: 'features', zh: '创建 Feature angle_jump_fix，基线选“策略集 1.0.0 · 软件 1.0 在用”，把转角突变阈值改为 350 并提交', en: 'Create Feature angle_jump_fix on base “Policy set 1.0.0 · in effect for 1.0”, raise the angle-jump threshold to 350 and submit', expectZh: '修复从 1.0.0 开始，不带主线的回正策略', expectEn: 'The fix starts from 1.0.0, without the mainline’s return-rate policy' },
      { account: 'steering_tester', workspace: 'team-steering', page: 'features', zh: '下发到转向研发车组，先仿真后实车登记 PASS，确认验证通过', en: 'Dispatch to 转向研发车组, record PASS (simulation first) and confirm Verified', expectZh: '研发车运行 1.0，基线就是 1.0.0', expectEn: 'The development vehicles run 1.0, so their base is 1.0.0' },
      { account: 'integrator', workspace: 'x89-project', page: 'integration', zh: '合并目标选“同软件版本补丁”→ 1.0.0，预览 angle_jump_fix；DCL 确认后冻结 X89-P1', en: 'Choose Same-software patch → 1.0.0, preview angle_jump_fix; after DCL confirms, freeze X89-P1', expectZh: '只改转角突变；1.1.0 的回正策略不进入补丁；主线上的预览和候选不受影响', expectEn: 'Only the angle-jump policy changes; 1.1.0’s return-rate policy stays out; mainline previews and candidates are untouched' },
      { account: 'integration_tester', workspace: 'x89-integration', page: 'integration', zh: '把 X89-P1 下发到 X89 集成测试车组（软件 1.0），先仿真后实车登记 PASS，确认验证', en: 'Dispatch X89-P1 to the X89 integration test group (software 1.0), record PASS (simulation first) and verify', expectZh: '补丁在它要服务的软件上测试', expectEn: 'The patch is tested on the software it will serve' },
      { account: 'release', workspace: 'x89-project', page: 'release', zh: '发布 X89-P1', en: 'Promote X89-P1', expectZh: '建议版本 1.0.1，只能选软件 1.0；发布后 1.0 车辆解析到 1.0.1，1.1 仍是 1.1.0，主线仍是 1.1.0', expectEn: 'Suggested version 1.0.1, software 1.0 only; afterwards 1.0 vehicles resolve to 1.0.1, 1.1 stays on 1.1.0, and the mainline is still 1.1.0' },
      { account: 'integrator', workspace: 'x89-project', page: 'integration', zh: '在主线合并中预览 angle_jump_fix（标注“已进入补丁 1.0.1 · 待合入主线”）', en: 'In a mainline merge preview angle_jump_fix (tagged In patch 1.0.1 · mainline pending)', expectZh: '三方合并到 1.1.0：保留主线的回正策略并加入修复；主线不需要时可写明理由“不合入主线”', expectEn: 'A three-way merge onto 1.1.0 keeps the return-rate policy and adds the fix; if the mainline does not need it, close it for the mainline with a reason' },
    ],
  },
  {
    key: 'budget',
    titleZh: '资源预算与紧急停采',
    titleEn: 'Collection budgets and emergency pauses',
    steps: [
      { account: 'dcl', page: 'processing/budget', zh: '在“资源预算”把 X89 的上传设为 5 MB/小时、单策略触发上限设为 3 次/小时', en: 'Under Collection budgets set X89’s upload to 5 MB per hour and the per-policy trigger limit to 3', expectZh: '车端代理按滚动一小时核算；高优先级采集超预算仍采集', expectEn: 'The vehicle agent counts a rolling hour; HIGH-priority captures are collected even over budget' },
      { account: 'dcl', page: 'simulator', zh: '在车辆模拟器对 VEH-201 触发 chassis.steering.angle_jump 两次', en: 'In the simulator fire chassis.steering.angle_jump on VEH-201 twice', expectZh: '第一次上传（3 MB），第二次“预算排队”', expectEn: 'The first uploads (3 MB), the second waits for budget' },
      { account: 'dcl', page: 'simulator', zh: '“模拟洪峰（连发 10 次）”', en: 'Flood (10 in a row)', expectZh: '超过每小时 3 次的触发被“洪峰抑制”，不进入数据查询', expectEn: 'Triggers past 3 an hour are suppressed and never reach the data query' },
      { account: 'dcl', page: 'simulator', zh: '在“模拟时间”推进 1 小时，再执行一步', en: 'Move the clock forward 1 hour, then step', expectZh: '排队的采集在新一小时的预算内上传', expectEn: 'The waiting capture uploads within the new hour’s budget' },
      { account: 'release', workspace: 'x89-project', page: 'fleet', zh: '对 VEH-201“暂停采集”，原因“上传链路拥塞”', en: 'Pause collection on VEH-201: upload link congested', expectZh: '立即拒绝新的触发；车辆确认后车上未上传的采集被丢弃', expectEn: 'New triggers are refused at once; once the vehicle confirms, captures still on it are dropped' },
      { account: 'dcl', workspace: 'x89-project', page: 'integration', zh: '把 X89 车端缓存设为 3.5 MB 后查看合并预览的“资源保护”', en: 'Set the X89 buffer to 3.5 MB, then look at a merge preview’s Resource protection', expectZh: '单次 4 MB 的策略“单次就超出预算”，确认处理集合被禁用', expectEn: 'A 4 MB policy never fits and Confirm processing set is disabled' },
    ],
  },
  {
    key: 'technical',
    titleZh: 'DCL 技术变更',
    titleEn: 'DCL technical changes',
    steps: [
      { account: 'dcl', page: 'processing/pipelines', zh: '发布处理版本 default-edge-bin-log：车端、binary，步骤 Receive、Compress、Encrypt', en: 'Publish pipeline default-edge-bin-log: edge, binary, steps Receive, Compress, Encrypt', expectZh: '得到 default-edge-bin-log@2；已绑定 @1 的文件不变', expectEn: 'default-edge-bin-log@2; files bound to @1 keep it' },
      { account: 'dcl', page: 'processing/technical', zh: '新建技术变更：转向团队工作区 · 转向组，名称 bin_log_edge_v2', en: 'New technical change: steering workspace · steering group, named bin_log_edge_v2', expectZh: '技术分支基于主线策略集，只能调整处理绑定', expectEn: 'A technical branch on the mainline set that may only change processing bindings' },
      { account: 'dcl', page: 'processing/technical', zh: '在文件列表“调整绑定”，车端处理选 @2，然后由 DCL 自己提交', en: 'Adjust binding in Files to the @2 edge pipeline, then submit it as DCL', expectZh: '生成 r001，DCL Ready；每次采集的车端 CPU 下降', expectEn: 'Commit r001, DCL Ready; each capture’s edge CPU drops' },
      { account: 'steering_tester', workspace: 'team-steering', page: 'features', zh: '下发到转向研发车组，先仿真后实车登记 PASS，确认验证通过', en: 'Dispatch to 转向研发车组, record PASS (simulation first) and confirm Verified', expectZh: '本组测试验证技术变更；技术变更不能退回给业务', expectEn: 'The group’s testers verify it; a technical change cannot be returned to business' },
      { account: 'integrator', workspace: 'x89-project', page: 'integration', zh: '在主线合并中预览 bin_log_edge_v2，DCL 确认后冻结，集成测试与发布照常', en: 'Preview bin_log_edge_v2 in a mainline merge; after DCL confirms, freeze, then integration testing and release as usual', expectZh: '新策略集与上一版相比没有策略变化，只有处理绑定不同', expectEn: 'The new set differs from the previous one only in processing bindings, with no policy changes' },
    ],
  },
  {
    key: 'aftersales',
    titleZh: '售后回捞与 Grader',
    titleEn: 'After-sales captures and the grader',
    steps: [
      { account: 'business', workspace: 'team-brake', page: 'query', zh: '在“售后回捞”对 VEH-001 请求 chassis.brake.monitor，写明客户案例', en: 'Under After-sales ask VEH-001 for chassis.brake.monitor with the customer case', expectZh: '请求等待车辆执行；只能请求本组的策略', expectEn: 'The request waits for the vehicle; only your group’s policies can be asked for' },
      { account: 'business', page: 'simulator', zh: '在车辆模拟器对 VEH-001 点“Grader 周期采集”（chassis.brake.failure_diag）', en: 'In the simulator run a Grader capture on VEH-001 (chassis.brake.failure_diag)', expectZh: '售后优先，Grader 延迟', expectEn: 'Deferred: after-sales first' },
      { account: 'business', page: 'simulator', zh: '执行一步两次', en: 'Step twice', expectZh: '车辆先执行售后采集（HIGH），上传后 Grader 采集才走', expectEn: 'The vehicle makes the after-sales capture (HIGH) first; the grader capture goes once it is uploaded' },
      { account: 'business', workspace: 'team-brake', page: 'query', zh: '处理完成后在售后查询中查看', en: 'Once processed, look in the after-sales query', expectZh: '事件“采集方式：售后”；通知售后采集已就绪', expectEn: 'The event shows Captured by: After-sales; a notification says it is ready' },
    ],
  },
  {
    key: 'directory',
    titleZh: '公司目录与组织授权',
    titleEn: 'Company directory and org grants',
    steps: [
      { account: 'admin', page: 'simulator', zh: '在“公司目录”为制动团队办理入职 brake_dev2，并同步到平台', en: 'In Company directory hire brake_dev2 into the brake team and sync', expectZh: '平台新建账号，没有显式授权', expectEn: 'An account is created with no explicit grants' },
      { account: 'brake_dev2', workspace: 'team-brake', page: 'features', zh: '以 brake_dev2 登录并创建 Feature', en: 'Sign in as brake_dev2 and create a Feature', expectZh: '按制动团队的组织规则获得研发权限；不能测试或验证', expectEn: 'Business development comes from the brake team rule; no testing or verifying' },
      { account: 'admin', page: 'simulator', zh: '把陈明调到转向团队，把 HMI 团队合并到 CDC，同步', en: 'Move 陈明 to the steering team, merge HMI into CDC, sync', expectZh: '工作台出现“待复核授权”和“组织节点已失效”', expectEn: 'The workbench lists grants to review and an orphaned workspace' },
      { account: 'admin', page: 'org', zh: '在账号页确认保留陈明的显式授权；在“组织与工作区 → 工作区”重新挂靠 HMI 团队工作区', en: 'Keep 陈明’s explicit grants on Accounts; re-attach the HMI workspace under Organization → Workspaces', expectZh: '业务分组随工作区迁移，代码与授权不变', expectEn: 'The group moves with the workspace; codes and grants are unchanged' },
    ],
  },
  {
    key: 'setup',
    titleZh: '从零开始（干净安装）',
    titleEn: 'From scratch (clean installation)',
    steps: [
      { account: 'admin', page: 'org', zh: '原型工具 → 重置为干净安装，以 admin 登录；登记车型、建立团队节点与业务分组', en: 'Prototype → Reset to clean installation; as admin register a model, team units and groups', expectZh: '只有 admin，一切从空开始', expectEn: 'Only admin exists; everything starts empty' },
      { account: 'admin', page: 'org', zh: '创建 TEAM 工作区并加入分组与范围', en: 'Create a TEAM workspace with groups and scopes', expectZh: '团队工作区不需要项目', expectEn: 'A team workspace needs no project' },
      { account: 'admin', page: 'accounts', zh: '创建账号并逐条配置完整授权', en: 'Create accounts with complete grants', expectZh: '授权不能拼接', expectEn: 'Grants are never combined' },
      { account: 'admin', page: 'accounts', zh: '为 DCL 工程账号授权（分组 *、工作区 *），由其在处理目录发布模板', en: 'Grant a DCL engineer (groups *, workspaces *) who publishes templates', expectZh: '没有模板时添加文件会被明确阻止', expectEn: 'Without templates, adding files is blocked explicitly' },
    ],
  },
];

export function GuidePage() {
  const state = useEngineState();
  const { L } = useI18n();
  return (
    <div className="kz-page">
      <PageHeader
        title={L('场景手册', 'Scenario guide')}
        subtitle={L('按步骤切换账号完成协作流程。平台不会替你执行步骤；“以该账号进入”只是切换身份。', 'Switch accounts step by step to run the collaboration flows. The platform never performs steps for you; “Act as” only switches identity.')}
      />
      <Space orientation="vertical" size={16} style={{ width: '100%' }}>
        {SCENARIOS.map((sc) => (
          <Card key={sc.key} title={L(sc.titleZh, sc.titleEn)}>
            <Steps
              orientation="vertical"
              size="small"
              items={sc.steps.map((st) => ({
                title: (
                  <Space wrap>
                    <Tag color="blue">{state.accounts[st.account]?.displayName ?? st.account}</Tag>
                    <span>{L(st.zh, st.en)}</span>
                  </Space>
                ),
                content: (
                  <Space orientation="vertical" size={4}>
                    <Typography.Text type="secondary">{L(`预期：${st.expectZh}`, `Expect: ${st.expectEn}`)}</Typography.Text>
                    {state.accounts[st.account] && (
                      <Button
                        size="small"
                        onClick={() => {
                          setSession({ username: st.account, workspaceId: st.workspace ?? null });
                          navigate(st.page);
                        }}
                      >
                        {L('以该账号进入', 'Act as this account')}
                      </Button>
                    )}
                  </Space>
                ),
                status: 'process',
              }))}
            />
          </Card>
        ))}
      </Space>
    </div>
  );
}
