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
    titleZh: '主线一 · 业务测试：先仿真后实车，确认 Verified',
    titleEn: 'Flow 1 · Business testing: simulation, then physical, then Verified',
    steps: [
      { account: 'workspace_manager', workspace: 'team-brake', page: 'fleet', zh: '查看工作区车辆与“制动研发车组”（SIM-021 仿真、VEH-001 实车）', en: 'Review workspace vehicles and the brake development group (SIM-021, VEH-001)', expectZh: '每辆车只属于一个车辆组；实际软件版本与已生效配置分别显示', expectEn: 'Each vehicle routes through one group; actual software and applied configuration are shown separately' },
      { account: 'brake_tester', workspace: 'team-brake', page: 'features', zh: '打开 guided_brake →“下发与测试”→ 按车辆组下发', en: 'Open guided_brake → Dispatch & tests → dispatch to the vehicle group', expectZh: '两辆车等待回执；车辆的已生效配置尚未改变', expectEn: 'Both vehicles await receipts; their applied configuration has not changed yet' },
      { account: 'brake_tester', page: 'simulator', zh: '在车辆模拟器中让 SIM-021 回执成功、VEH-001 回执失败', en: 'In the simulator, SIM-021 applies and VEH-001 fails', expectZh: '只有成功回执更新已生效配置；失败的车辆保留原配置', expectEn: 'Only the applied receipt changes the applied configuration; the failed vehicle keeps its old one' },
      { account: 'brake_tester', workspace: 'team-brake', page: 'features', zh: '为 SIM-021 登记 PASS；对 VEH-001 再次下发并在模拟器回执成功后登记 PASS', en: 'Record PASS for SIM-021; redispatch VEH-001, apply it in the simulator, record PASS', expectZh: '实车结果必须在仿真通过之后', expectEn: 'Physical results require a passing simulation first' },
      { account: 'brake_tester', workspace: 'team-brake', page: 'features', zh: '确认 Verified', en: 'Confirm Verified', expectZh: 'Feature 已验证，可交给配置集成', expectEn: 'The Feature is verified and ready for integration' },
      { account: 'dispatch_operator', workspace: 'team-brake', page: 'features', zh: '用“仅下发”测试账号尝试登记结果', en: 'Try recording a result as the dispatch-only tester', expectZh: '可以下发，但不能登记结果或确认 Verified', expectEn: 'It can dispatch but cannot record results or verify' },
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
                description: (
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
