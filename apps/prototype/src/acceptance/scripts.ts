// Acceptance scripts (剧本) and scenes (幕), ported as data from the v0.13 design's role-play
// handbook (从零启动, 首次 OTA, 数据使用) and its negative cases. The text is the requirement;
// Kairoz-specific notes live with the scene runners in acceptance/.

export interface Scene {
  id: string;
  title: string;
  /** Who performs it, as the script names them. */
  actor: string;
  accounts: string[];
  workspace: string | null;
  page: string;
  pre: string;
  steps: string[];
  done: string;
  fail: string;
}

export interface Script {
  id: string;
  name: string;
  /** Where the script starts: a clean installation or the demo data. */
  start: 'clean' | 'demo';
  scenes: Scene[];
}

export interface NegativeCase {
  id: string;
  role: string;
  action: string;
  expected: string;
}

export const SCRIPTS: Script[] = [
  {
    "id": "startup",
    "name": "从零启动 · 角色协作",
    "start": "clean",
    "scenes": [
      {
        "id": "A01",
        "title": "部署服务，执行健康检查，写入测试记录后重启。",
        "actor": "admin / 平台运维",
        "accounts": [
          "admin"
        ],
        "workspace": "平台级；A05前无工作区",
        "page": "部署环境（外部）",
        "pre": "全新数据库和存储，无业务对象。",
        "steps": [
          "确认是隔离部署环境；使用部署团队提供的服务器/CI账号及其运维权限，不使用网页 admin 代替部署身份。",
          "核对工作区：平台级；A05前无工作区；组/范围：全平台目录与授权；环境：按步骤配置三环境；隔离环境执行破坏性操作。前序未创建或未授权时记录 BLOCKED，不自动补权。",
          "在隔离环境使用部署团队提供的服务器或CI身份部署服务；此步不使用网页账号。",
          "执行服务、数据库和存储健康检查，保存响应和日志。",
          "写入测试记录，重启服务，再读回同一记录，确认数据未丢失。",
          "检查完成条件：服务可用，记录保留，日志可检索。",
          "保存 runId、账号/角色、工作区/环境、对象版本、操作结果及证据；管理员初始化 → OPS/A02。失败时：修部署故障，不带病初始化。"
        ],
        "done": "服务可用，记录保留，日志可检索。",
        "fail": "修部署故障，不带病初始化。"
      },
      {
        "id": "A02",
        "title": "初始化管理员；安装八类内置角色，核对测试职责权限。",
        "actor": "admin / 平台运维",
        "accounts": [
          "admin"
        ],
        "workspace": "平台级；A05前无工作区",
        "page": "初始化入口、账号与角色授权",
        "pre": "A01通过。",
        "steps": [
          "确认 A01 健康检查通过；首次初始化创建 admin 后进入，已有演示数据时直接输入 admin。",
          "核对工作区：平台级；A05前无工作区；组/范围：全平台目录与授权；环境：按步骤配置三环境；隔离环境执行破坏性操作。前序未创建或未授权时记录 BLOCKED，不自动补权。",
          "打开初始化入口，建立首个管理员 admin；原型只输入用户名，不检查密码。",
          "以 admin 进入账号与角色授权，检查八类内置角色及其权限边界。",
          "检查完成条件：只有必要管理身份；角色动作边界明确。",
          "保存 runId、账号/角色、工作区/环境、对象版本、操作结果及证据；环境及组织初始化 → OPS/A03。失败时：修角色定义；不放开所有权限。"
        ],
        "done": "只有必要管理身份；角色动作边界明确。",
        "fail": "修角色定义；不放开所有权限。"
      },
      {
        "id": "A03",
        "title": "建立三个环境和公司→整车研发中心→底盘部门→制动团队；另建电池、动力团队。",
        "actor": "admin / 平台运维",
        "accounts": [
          "admin"
        ],
        "workspace": "平台级；A05前无工作区",
        "page": "组织与运行保障（目录编辑拟新增）",
        "pre": "管理员可用。",
        "steps": [
          "在账号入口输入 admin，点击进入；核对角色“平台运维”。原型不需密码，仍需匹配授权。",
          "核对工作区：平台级；A05前无工作区；组/范围：全平台目录与授权；环境：按步骤配置三环境；隔离环境执行破坏性操作。前序未创建或未授权时记录 BLOCKED，不自动补权。",
          "建立 development、testing、production 三个环境。",
          "创建公司→整车研发中心→底盘部门→制动团队，再创建电池及动力团队，核对父子节点。",
          "检查完成条件：目录有稳定父子ID；未建项目时团队仍有效。",
          "保存 runId、账号/角色、工作区/环境、对象版本、操作结果及证据；配置分组目录 → OPS/A04。失败时：修目录关系，防环路和非法父节点。"
        ],
        "done": "目录有稳定父子ID；未建项目时团队仍有效。",
        "fail": "修目录关系，防环路和非法父节点。"
      },
      {
        "id": "A04",
        "title": "建立brake、battery、power和hmi配置组，明确只读引用权限。",
        "actor": "admin / 平台运维",
        "accounts": [
          "admin"
        ],
        "workspace": "平台级；A05前无工作区",
        "page": "组织与运行保障",
        "pre": "团队目录已建。",
        "steps": [
          "在账号入口输入 admin，点击进入；核对角色“平台运维”。原型不需密码，仍需匹配授权。",
          "核对工作区：平台级；A05前无工作区；组/范围：全平台目录与授权；环境：按步骤配置三环境；隔离环境执行破坏性操作。前序未创建或未授权时记录 BLOCKED，不自动补权。",
          "建立 brake、battery、power、hmi 配置分组，分别指定维护组织。",
          "配置跨组只读引用，检查读取权没有转为修改权。",
          "检查完成条件：各组各自维护，引用不获得修改权。",
          "保存 runId、账号/角色、工作区/环境、对象版本、操作结果及证据；团队工作区 → OPS/A05。失败时：先解决归属，禁止同名猜测授权。"
        ],
        "done": "各组各自维护，引用不获得修改权。",
        "fail": "先解决归属，禁止同名猜测授权。"
      },
      {
        "id": "A05",
        "title": "创建team-brake等TEAM区；选择车型、组织节点、分组和范围，不填项目ID。",
        "actor": "admin / 平台运维",
        "accounts": [
          "admin"
        ],
        "workspace": "平台级；A05前无工作区",
        "page": "工作区管理",
        "pre": "A04通过，项目组织尚未成立。",
        "steps": [
          "在账号入口输入 admin，点击进入；核对角色“平台运维”。原型不需密码，仍需匹配授权。",
          "核对工作区：平台级；A05前无工作区；组/范围：全平台目录与授权；环境：按步骤配置三环境；隔离环境执行破坏性操作。前序未创建或未授权时记录 BLOCKED，不自动补权。",
          "打开工作区管理，创建 team-brake、team-battery、team-power 团队工作区。",
          "为每区选择组织节点、车型、业务组和授权范围；项目未成立时项目ID留空。",
          "检查完成条件：团队工作区可用，projectId可空。",
          "保存 runId、账号/角色、工作区/环境、对象版本、操作结果及证据；成员账号 → OPS/A06。失败时：无项目时不阻塞、不自动虚构项目。"
        ],
        "done": "团队工作区可用，projectId可空。",
        "fail": "无项目时不阻塞、不自动虚构项目。"
      },
      {
        "id": "A06",
        "title": "授予研发、业务测试、工作区管理员、DCL、资源人员最小工作区及环境权限。",
        "actor": "admin / 平台运维",
        "accounts": [
          "admin"
        ],
        "workspace": "平台级；A05前无工作区",
        "page": "账号与角色授权",
        "pre": "工作区已建立。",
        "steps": [
          "在账号入口输入 admin，点击进入；核对角色“平台运维”。原型不需密码，仍需匹配授权。",
          "核对工作区：平台级；A05前无工作区；组/范围：全平台目录与授权；环境：按步骤配置三环境；隔离环境执行破坏性操作。前序未创建或未授权时记录 BLOCKED，不自动补权。",
          "打开账号与角色授权，创建 business、battery、power、brake_tester、battery_tester、power_tester、workspace_manager、dcl、resource。",
          "授予 business/battery/power 各自团队区的业务研发角色；brake_tester/battery_tester/power_tester 各自组的业务测试身份及研发/测试环境；workspace_manager 仅 team-brake 资源管理；dcl/resource 授予必要组或范围，保存完整授权。battery_tester、power_tester 是本步新建账号，演示种子未预置。",
          "逐一用新账号进入，验证授权入口；以 business 尝试登记车辆，确认被拒绝。",
          "检查完成条件：各账号能正常进入；business不能登记车；工作区管理员不能编辑策略。",
          "保存 runId、账号/角色、工作区/环境、对象版本、操作结果及证据；默认能力和资源 → DCL/A08、WM/A09。失败时：检查同一条grant的完整上下文，不拼授权。"
        ],
        "done": "各账号能正常进入；business不能登记车；工作区管理员不能编辑策略。",
        "fail": "检查同一条grant的完整上下文，不拼授权。"
      },
      {
        "id": "A07",
        "title": "建立完整X89项目组织模块树，创建x89-integration，配置团队来源和集成测试人员。",
        "actor": "admin / 平台运维",
        "accounts": [
          "admin"
        ],
        "workspace": "平台级；A05前无工作区",
        "page": "组织与运行保障、工作区管理",
        "pre": "项目正式成立；可复用既有团队成果。",
        "steps": [
          "在账号入口输入 admin，点击进入；核对角色“平台运维”。原型不需密码，仍需匹配授权。",
          "核对工作区：平台级；A05前无工作区；组/范围：全平台目录与授权；环境：按步骤配置三环境；隔离环境执行破坏性操作。前序未创建或未授权时记录 BLOCKED，不自动补权。",
          "建立 X89 项目组织完整模块树，创建 x89-project 项目区和 x89-integration 集成测试区。",
          "创建 integrator、chassis_integrator、integration_tester、dispatch_operator、release，按账号表授权；将团队来源加入项目区。",
          "切换团队与项目工作区，确认只展示当前架构，原团队Feature仍保留。",
          "检查完成条件：右上角可切工作区，当前页面只显示一种组织架构；既有团队Feature不重置。",
          "保存 runId、账号/角色、工作区/环境、对象版本、操作结果及证据；集成准备 → INT/D01。失败时：目录未成立只阻塞项目集成，不阻塞团队研发。"
        ],
        "done": "右上角可切工作区，当前页面只显示一种组织架构；既有团队Feature不重置。",
        "fail": "目录未成立只阻塞项目集成，不阻塞团队研发。"
      },
      {
        "id": "A08",
        "title": "发布普通日志/CAN双侧默认模板、敏感审核模板；登记x89-dev-r1及接入接口。",
        "actor": "dcl / DCL 工程",
        "accounts": [
          "dcl"
        ],
        "workspace": "team-brake",
        "page": "处理流程、仿真镜像；模板与审核规则管理拟新增",
        "pre": "DCL授权可用，运行Provider配置已准备。",
        "steps": [
          "在账号入口输入 dcl，点击进入；核对角色“DCL 工程”。原型不需密码，仍需匹配授权。",
          "核对工作区：team-brake；组/范围：业务组 brake；环境：development。前序未创建或未授权时记录 BLOCKED，不自动补权。",
          "打开处理流程，为普通日志和CAN发布车端、云端默认模板，并设置敏感审核规则。",
          "打开仿真镜像，登记 x89-dev-r1，允许无正式整车版本，并核对车型与Provider设置。",
          "检查完成条件：每类型有明确模板、版本与能力；无正式版本镜像有效；未知格式明确待配置。",
          "保存 runId、账号/角色、工作区/环境、对象版本、操作结果及证据；仿真创建 → WM/A09；文件创建 → DEV/B02。失败时：禁止用任意Parser处理未知格式。"
        ],
        "done": "每类型有明确模板、版本与能力；无正式版本镜像有效；未知格式明确待配置。",
        "fail": "禁止用任意Parser处理未知格式。"
      },
      {
        "id": "A09",
        "title": "创建SIM-901，选择仿真、development、x89-dev-r1和暂无整车版本。",
        "actor": "workspace_manager / 工作区管理员",
        "accounts": [
          "workspace_manager"
        ],
        "workspace": "team-brake",
        "page": "工作区管理 → 新建车辆资源",
        "pre": "A05、A06、A08通过。",
        "steps": [
          "在账号入口输入 workspace_manager，点击进入；核对角色“工作区管理员”。原型不需密码，仍需匹配授权。",
          "核对工作区：team-brake；组/范围：业务组 brake；环境：development。前序未创建或未授权时记录 BLOCKED，不自动补权。",
          "打开工作区管理→新建车辆资源，填写 SIM-901，选择仿真、development、x89-dev-r1。",
          "选择“暂无整车版本”，保存资源，并确认归属 team-brake、无需VIN。",
          "检查完成条件：integration为空，VIN不要求，资源纳入team-brake。",
          "保存 runId、账号/角色、工作区/环境、对象版本、操作结果及证据；可用仿真 → DEV/B01、TEST/B04。失败时：镜像不匹配、配额或权限不满足时拒绝并保留原状态。"
        ],
        "done": "integration为空，VIN不要求，资源纳入team-brake。",
        "fail": "镜像不匹配、配额或权限不满足时拒绝并保留原状态。"
      },
      {
        "id": "A10",
        "title": "登记VEH-901及唯一VIN，版本留空；接收可信版本上报时另行确认。",
        "actor": "resource / 车辆资源",
        "accounts": [
          "resource"
        ],
        "workspace": "team-brake",
        "page": "车辆资源 → 登记资源；批量导入拟新增",
        "pre": "实车台账已准备且有对应资源池权限。",
        "steps": [
          "在账号入口输入 resource，点击进入；核对角色“车辆资源”。原型不需密码，仍需匹配授权。",
          "核对工作区：team-brake；组/范围：范围 Chassis；资源归属 brake；环境：development。前序未创建或未授权时记录 BLOCKED，不自动补权。",
          "打开车辆资源→登记资源，填写 VEH-901、车型及唯一VIN，选择研发环境和授权资源池。",
          "整车版本留空并保存；后续收到可信上报时再确认实际版本。",
          "检查完成条件：未知版本不造假；创建不是软件刷写，也不是配置生效。",
          "保存 runId、账号/角色、工作区/环境、对象版本、操作结果及证据；实车资源 → WM/A11、TEST/B05。失败时：重复VIN/ID拒绝，批量行失败要有逐行结果。"
        ],
        "done": "未知版本不造假；创建不是软件刷写，也不是配置生效。",
        "fail": "重复VIN/ID拒绝，批量行失败要有逐行结果。"
      },
      {
        "id": "A11",
        "title": "纳入本区，核对预约和可用状态，启动仿真并检查连接。",
        "actor": "workspace_manager / 工作区管理员",
        "accounts": [
          "workspace_manager"
        ],
        "workspace": "team-brake",
        "page": "工作区管理、资源借用与配额",
        "pre": "SIM-901和VEH-901已登记。",
        "steps": [
          "在账号入口输入 workspace_manager，点击进入；核对角色“工作区管理员”。原型不需密码，仍需匹配授权。",
          "核对工作区：team-brake；组/范围：业务组 brake；环境：development。前序未创建或未授权时记录 BLOCKED，不自动补权。",
          "在工作区管理中将 SIM-901、VEH-901 纳入本区；创建研发与测试车辆组并分别归组。",
          "核对预约、可用性和连接，启动仿真；首页检查实际版本及生效配置允许为空。",
          "检查完成条件：本组首页展示全部授权资源；实际版本/已生效配置可为空。",
          "保存 runId、账号/角色、工作区/环境、对象版本、操作结果及证据；资源就绪 → DEV/B01。失败时：占用先结束；未回执不标记配置生效。"
        ],
        "done": "本组首页展示全部授权资源；实际版本/已生效配置可为空。",
        "fail": "占用先结束；未回执不标记配置生效。"
      },
      {
        "id": "B01",
        "title": "选择本组工作区，创建first_brake，不要求选择Bootstrap。",
        "actor": "business / 业务研发",
        "accounts": [
          "business"
        ],
        "workspace": "team-brake",
        "page": "角色工作台 → 研发 Feature",
        "pre": "A06、A09、A11通过。",
        "steps": [
          "在账号入口输入 business，点击进入；核对角色“业务研发”。原型不需密码，仍需匹配授权。",
          "核对工作区：team-brake；组/范围：业务组 brake；环境：development。前序未创建或未授权时记录 BLOCKED，不自动补权。",
          "在本组全部车辆资源检查车型、VIN/UVID、车辆组、实际基线和生效配置。",
          "打开研发 Feature，创建 first_brake；没有正式版本时使用初始研发配置，无需选择Bootstrap。",
          "检查完成条件：内部有初始配置，用户只见初始研发配置；资源版本仍为空。",
          "保存 runId、账号/角色、工作区/环境、对象版本、操作结果及证据；文件需求 → DEV/B02。失败时：权限或资源问题交管理员，不虚构基线。"
        ],
        "done": "内部有初始配置，用户只见初始研发配置；资源版本仍为空。",
        "fail": "权限或资源问题交管理员，不虚构基线。"
      },
      {
        "id": "B02",
        "title": "登记text_log：ADC、/data/brake、debug.log、制动诊断；点击保存一次。",
        "actor": "business / 业务研发",
        "accounts": [
          "business"
        ],
        "workspace": "team-brake",
        "page": "我的文件列表 → 新建文件（类型及自动绑定拟新增）",
        "pre": "first_brake为可编辑草稿，普通模板已发布。",
        "steps": [
          "在账号入口输入 business，点击进入；核对角色“业务研发”。原型不需密码，仍需匹配授权。",
          "核对工作区：team-brake；组/范围：业务组 brake；环境：development。前序未创建或未授权时记录 BLOCKED，不自动补权。",
          "打开 first_brake 的文件列表→新建文件，选 text_log，填域控 ADC、目录 /data/brake、文件 debug.log 和用途。",
          "保存一次，检查自动生成唯一 data_key、车端和云端固定处理绑定，并记录版本。",
          "检查完成条件：一个data_key和两份固定处理绑定同时创建；普通内容匹配批准模板。",
          "保存 runId、账号/角色、工作区/环境、对象版本、操作结果及证据；文件身份及处理引用 → DEV/B03。失败时：任一创建失败全部回滚；重复请求返回同一身份。"
        ],
        "done": "一个data_key和两份固定处理绑定同时创建；普通内容匹配批准模板。",
        "fail": "任一创建失败全部回滚；重复请求返回同一身份。"
      },
      {
        "id": "B03",
        "title": "定义brake_pressure>80 AND vehicle_speed>30，Capture引用逻辑data_key，窗口10/20秒并提交。",
        "actor": "business / 业务研发",
        "accounts": [
          "business"
        ],
        "workspace": "team-brake",
        "page": "我的业务策略 → 提交",
        "pre": "B02完成，无敏感内容，模板兼容。",
        "steps": [
          "在账号入口输入 business，点击进入；核对角色“业务研发”。原型不需密码，仍需匹配授权。",
          "核对工作区：team-brake；组/范围：业务组 brake；环境：development。前序未创建或未授权时记录 BLOCKED，不自动补权。",
          "打开业务策略，配置 brake_pressure>80 AND vehicle_speed>30，Capture选择逻辑data_key，窗口前10秒后20秒。",
          "保存并提交，检查普通模板兼容及资源预算检查通过，记录固定提交和可测试集合。",
          "检查完成条件：检查通过自动可测试，不调用DCL人工Mark Ready。",
          "保存 runId、账号/角色、工作区/环境、对象版本、操作结果及证据；固定commit与ResolvedRelease → TEST/B04。失败时：错误引用、格式或预算不满足返回具体字段及维护方。"
        ],
        "done": "检查通过自动可测试，不调用DCL人工Mark Ready。",
        "fail": "错误引用、格式或预算不满足返回具体字段及维护方。"
      },
      {
        "id": "B04",
        "title": "下发固定提交到仿真，先检查Pending，成功回执后运行测试并记录PASS。",
        "actor": "brake_tester / 测试验证（业务测试）",
        "accounts": [
          "brake_tester"
        ],
        "workspace": "team-brake",
        "page": "研发 Feature → 下发测试配置、测试结果",
        "pre": "B03通过，business测试身份有SIM-901权限。",
        "steps": [
          "在账号入口输入 brake_tester，点击进入；核对角色“测试验证（业务测试）”。原型不需密码，仍需匹配授权。",
          "核对工作区：team-brake；组/范围：业务组 brake；环境：development。前序未创建或未授权时记录 BLOCKED，不自动补权。",
          "选择已纳入 SIM-901 的研发或测试车辆组，对固定提交创建按组下发任务；保存任务成员快照。",
          "检查回执前为 Pending；使用标记为Mock的Provider产生成功回执，确认车上集合生效。",
          "执行仿真验证，记录当前提交、实际集合、资源和 PASS 证据。",
          "检查完成条件：回执前不写已生效；证据包含当前commit和实际Release。",
          "保存 runId、账号/角色、工作区/环境、对象版本、操作结果及证据；仿真PASS → TEST/B05。失败时：下发失败先重试或回滚；测试失败交DEV/F03。"
        ],
        "done": "回执前不写已生效；证据包含当前commit和实际Release。",
        "fail": "下发失败先重试或回滚；测试失败交DEV/F03。"
      },
      {
        "id": "B05",
        "title": "同一提交下发VEH-901，确认生效再验证；检查当前仿真和实车证据后标记Verified。",
        "actor": "brake_tester / 测试验证（业务测试）",
        "accounts": [
          "brake_tester"
        ],
        "workspace": "team-brake",
        "page": "研发 Feature → 下发与实车验证",
        "pre": "仿真通过，实车授权可用。",
        "steps": [
          "在账号入口输入 brake_tester，点击进入；核对角色“测试验证（业务测试）”。原型不需密码，仍需匹配授权。",
          "核对工作区：team-brake；组/范围：业务组 brake；环境：development。前序未创建或未授权时记录 BLOCKED，不自动补权。",
          "选择包含 VEH-901 的授权车辆组，将 B04 同一提交按组下发，等待实际生效回执。",
          "执行实车场景的Mock验证，保存证据；核对当前提交同时具有仿真与实车PASS，再标记 Verified。",
          "检查完成条件：只接受当前提交的有效证据。",
          "保存 runId、账号/角色、工作区/环境、对象版本、操作结果及证据；Verified提交 → INT/D02。失败时：提交变更后两种测试按影响重新验证。"
        ],
        "done": "只接受当前提交的有效证据。",
        "fail": "提交变更后两种测试按影响重新验证。"
      },
      {
        "id": "B06",
        "title": "结束车辆测试任务、停止闲置仿真、释放预约，不擦除历史。",
        "actor": "workspace_manager / 工作区管理员",
        "accounts": [
          "workspace_manager"
        ],
        "workspace": "team-brake",
        "page": "车辆资源、资源借用与配额",
        "pre": "Feature已交付，仍保留后续追溯。",
        "steps": [
          "在账号入口输入 workspace_manager，点击进入；核对角色“工作区管理员”。原型不需密码，仍需匹配授权。",
          "核对工作区：team-brake；组/范围：业务组 brake；环境：development。前序未创建或未授权时记录 BLOCKED，不自动补权。",
          "结束测试任务和预约，停止闲置仿真。",
          "检查资源重新可用，历史提交、回执及验证证据仍可追溯。",
          "检查完成条件：资源可以被后续任务使用，历史证据保留。",
          "保存 runId、账号/角色、工作区/环境、对象版本、操作结果及证据；可用资源 → 下一个Feature。失败时：有待回执/执行/预约时先处理占用。"
        ],
        "done": "资源可以被后续任务使用，历史证据保留。",
        "fail": "有待回执/执行/预约时先处理占用。"
      },
      {
        "id": "C01",
        "title": "新增camera_image、pointcloud或gnss文件，申报用途及内容，创建采集策略并提交。",
        "actor": "business / 业务研发",
        "accounts": [
          "business"
        ],
        "workspace": "team-brake",
        "page": "我的文件列表、我的业务策略",
        "pre": "敏感模板已配置，测试数据为虚构fixture。",
        "steps": [
          "在账号入口输入 business，点击进入；核对角色“业务研发”。原型不需密码，仍需匹配授权。",
          "核对工作区：team-brake；组/范围：业务组 brake；环境：development。前序未创建或未授权时记录 BLOCKED，不自动补权。",
          "新建敏感Feature，登记 camera_image、pointcloud 或 gnss 文件，填写用途与采集范围。",
          "检查文件与双侧策略同时生成；建立采集策略并提交，确认待审核时下发被阻止。",
          "检查完成条件：文件和双侧策略同时创建，但状态为待审核；不能下发采集。",
          "保存 runId、账号/角色、工作区/环境、对象版本、操作结果及证据；版本化敏感需求 → DCL/C02。失败时：不得改成text_log来绕过审核。"
        ],
        "done": "文件和双侧策略同时创建，但状态为待审核；不能下发采集。",
        "fail": "不得改成text_log来绕过审核。"
      },
      {
        "id": "C02",
        "title": "审查采集范围、车端处理、上传、云端处理、保留；拒绝或批准具体策略版本并记录理由。",
        "actor": "dcl / DCL 工程",
        "accounts": [
          "dcl"
        ],
        "workspace": "team-brake",
        "page": "DCL接入队列 → 敏感文件审核",
        "pre": "C01提交固定，处理模板能力明确。",
        "steps": [
          "在账号入口输入 dcl，点击进入；核对角色“DCL 工程”。原型不需密码，仍需匹配授权。",
          "核对工作区：team-brake；组/范围：业务组 brake；环境：development。前序未创建或未授权时记录 BLOCKED，不自动补权。",
          "打开DCL接入队列，选择 C01 固定提交，核对文件及双侧处理版本。",
          "检查采集范围、处理、上传与保留，记录具体理由后批准或拒绝；保存审批摘要。",
          "检查完成条件：批准绑定文件/双侧策略版本及摘要；普通接入Ready不能替代审批。",
          "保存 runId、账号/角色、工作区/环境、对象版本、操作结果及证据；批准版本 → TEST/C04；拒绝事项 → DEV/C03。失败时：能力不支持交技术维护，业务用途不满足退业务方。"
        ],
        "done": "批准绑定文件/双侧策略版本及摘要；普通接入Ready不能替代审批。",
        "fail": "能力不支持交技术维护，业务用途不满足退业务方。"
      },
      {
        "id": "C03",
        "title": "业务修采集范围/用途；DCL修专用处理，产生新提交，再送审核。",
        "actor": "business / 业务研发",
        "accounts": [
          "business"
        ],
        "workspace": "team-brake",
        "page": "我的文件列表、我的业务策略；DCL技术分支",
        "pre": "C02拒绝或需求变更。",
        "steps": [
          "在账号入口输入 business，点击进入；核对角色“业务研发”。原型不需密码，仍需匹配授权。",
          "核对工作区：team-brake；组/范围：业务组 brake；环境：development。前序未创建或未授权时记录 BLOCKED，不自动补权。",
          "以 business 修正被拒绝的采集范围或用途并提交。",
          "若需处理能力修改，切换 dcl，在技术分支修正专用处理后生成新提交。",
          "重新交 dcl 审核，确认旧审批不覆盖新内容。",
          "检查完成条件：旧审批不自动覆盖新内容；历史提交不可变。",
          "保存 runId、账号/角色、工作区/环境、对象版本、操作结果及证据；新版本 → DCL/C02。失败时：未重新批准保持下发阻止。"
        ],
        "done": "旧审批不自动覆盖新内容；历史提交不可变。",
        "fail": "未重新批准保持下发阻止。"
      },
      {
        "id": "C04",
        "title": "下发已批准固定版本，用合成数据验证处理和上传结果。",
        "actor": "brake_tester / 测试验证（业务测试）",
        "accounts": [
          "brake_tester"
        ],
        "workspace": "team-brake",
        "page": "研发 Feature → 下发及仿真测试",
        "pre": "敏感版本批准且授权仿真可用。",
        "steps": [
          "在账号入口输入 brake_tester，点击进入；核对角色“测试验证（业务测试）”。原型不需密码，仍需匹配授权。",
          "核对工作区：team-brake；组/范围：业务组 brake；环境：development。前序未创建或未授权时记录 BLOCKED，不自动补权。",
          "选择授权仿真车辆组，仅下发已批准的固定版本。",
          "用合成敏感数据验证脱敏及上传边界，记录当前提交、审批和实际集合的PASS证据。",
          "检查完成条件：不应上传的内容未出车；输出与已批准处理策略一致。",
          "保存 runId、账号/角色、工作区/环境、对象版本、操作结果及证据；敏感仿真证据 → TEST/C05。失败时：脱敏或上传边界不满足停止测试，交DCL/C02。"
        ],
        "done": "不应上传的内容未出车；输出与已批准处理策略一致。",
        "fail": "脱敏或上传边界不满足停止测试，交DCL/C02。"
      },
      {
        "id": "C05",
        "title": "使用批准版本完成授权实车验证并交付Verified。",
        "actor": "brake_tester / 测试验证（业务测试）",
        "accounts": [
          "brake_tester"
        ],
        "workspace": "team-brake",
        "page": "研发 Feature → 实车验证",
        "pre": "C04通过、当前审批仍有效。",
        "steps": [
          "在账号入口输入 brake_tester，点击进入；核对角色“测试验证（业务测试）”。原型不需密码，仍需匹配授权。",
          "核对工作区：team-brake；组/范围：业务组 brake；环境：development。前序未创建或未授权时记录 BLOCKED，不自动补权。",
          "将 C04 同一批准版本下发授权实车组，确认生效。",
          "执行Mock实车验证，保存审批与提交关联证据，再交付 Verified。",
          "检查完成条件：证据同时绑定提交、敏感审批及实际Release。",
          "保存 runId、账号/角色、工作区/环境、对象版本、操作结果及证据；已验证敏感Feature → INT/D02。失败时：不得用旧批准或旧PASS为新提交背书。"
        ],
        "done": "证据同时绑定提交、敏感审批及实际Release。",
        "fail": "不得用旧批准或旧PASS为新提交背书。"
      },
      {
        "id": "D01",
        "title": "切集成工作区；核对来源TEAM区、testing池SIM-902/VEH-902。",
        "actor": "integrator / 配置集成",
        "accounts": [
          "integrator"
        ],
        "workspace": "x89-project",
        "page": "配置集成、车辆资源",
        "pre": "项目及集成工作区成立。",
        "steps": [
          "在账号入口输入 integrator，点击进入；核对角色“配置集成”。原型不需密码，仍需匹配授权。",
          "核对工作区：x89-project；组/范围：范围 Vehicle；环境：testing。前序未创建或未授权时记录 BLOCKED，不自动补权。",
          "切到项目集成区，检查 team-brake、team-battery、team-power 来源已授权。",
          "核对 testing 池 SIM-902、VEH-902；缺资源时切 resource 登记并纳入授权范围，再返回 integrator。",
          "检查完成条件：来源合法，资源仅为testing；资源缺失交VR处理。",
          "保存 runId、账号/角色、工作区/环境、对象版本、操作结果及证据；集成范围 → INT/D02。失败时：无项目区或池先补齐，不用量产车代替。"
        ],
        "done": "来源合法，资源仅为testing；资源缺失交VR处理。",
        "fail": "无项目区或池先补齐，不用量产车代替。"
      },
      {
        "id": "D02",
        "title": "收集固定来源，预览合并；保留HMI未变配置。",
        "actor": "integrator / 配置集成",
        "accounts": [
          "integrator"
        ],
        "workspace": "x89-project",
        "page": "配置集成 → 三方合并预览",
        "pre": "底盘、电池、动力的当前提交Verified。",
        "steps": [
          "在账号入口输入 integrator，点击进入；核对角色“配置集成”。原型不需密码，仍需匹配授权。",
          "核对工作区：x89-project；组/范围：范围 Vehicle；环境：testing。前序未创建或未授权时记录 BLOCKED，不自动补权。",
          "在配置集成选择各业务当前 Verified 提交，创建合并预览。",
          "检查 Added/Changed/Removed/Inherited 和 HMI 继承项；保存冲突清单或无冲突集合摘要。",
          "检查完成条件：显示Added/Changed/Removed/Inherited；同字段冲突不静默覆盖。",
          "保存 runId、账号/角色、工作区/环境、对象版本、操作结果及证据；无冲突 → DCL/D05；冲突清单 → DEV/D03或DCL。失败时：不要求来源基线相同；检查共同来源、引用和最终兼容性。"
        ],
        "done": "显示Added/Changed/Removed/Inherited；同字段冲突不静默覆盖。",
        "fail": "不要求来源基线相同；检查共同来源、引用和最终兼容性。"
      },
      {
        "id": "D03",
        "title": "业务方统一需求修文件/策略，DCL修处理；提交新版本。",
        "actor": "business / 业务研发",
        "accounts": [
          "business"
        ],
        "workspace": "team-brake",
        "page": "研发 Feature → 冲突修复；处理冲突交DCL技术分支",
        "pre": "冲突定位到维护组及字段。",
        "steps": [
          "在账号入口输入 business，点击进入；核对角色“业务研发”。原型不需密码，仍需匹配授权。",
          "核对工作区：team-brake；组/范围：业务组 brake；环境：development。前序未创建或未授权时记录 BLOCKED，不自动补权。",
          "处理电池冲突时改用 battery / team-battery / battery；动力冲突改用 power / team-power / power；均选择来源Feature所在环境。",
          "按冲突归属切换 business、battery 或 power，在各自团队区修正本组文件或业务策略。",
          "处理流程冲突切 dcl 修技术分支；各维护方生成新提交，保留旧提交及冲突记录。",
          "检查完成条件：只有维护方可改；旧提交保持不变，旧测试失效。",
          "保存 runId、账号/角色、工作区/环境、对象版本、操作结果及证据；修复提交 → TEST/D04。失败时：集成角色不能一键覆盖维护方内容。"
        ],
        "done": "只有维护方可改；旧提交保持不变，旧测试失效。",
        "fail": "集成角色不能一键覆盖维护方内容。"
      },
      {
        "id": "D04",
        "title": "重新下发和验证修复提交；交付新Verified证据。",
        "actor": "brake_tester / 测试验证（业务测试）",
        "accounts": [
          "brake_tester"
        ],
        "workspace": "team-brake",
        "page": "研发 Feature → 仿真和实车重验",
        "pre": "D03生成新提交。",
        "steps": [
          "在账号入口输入 brake_tester，点击进入；核对角色“测试验证（业务测试）”。原型不需密码，仍需匹配授权。",
          "核对工作区：team-brake；组/范围：业务组 brake；环境：development。前序未创建或未授权时记录 BLOCKED，不自动补权。",
          "底盘用 brake_tester；电池用 A06 创建的 battery_tester / team-battery / battery；动力用 power_tester / team-power / power，核对业务测试身份。",
          "切业务测试账号，对 D03 新提交重新下发仿真组及实车组。",
          "重新执行测试并形成新 Verified 证据，交 integrator 重新预览合并，禁止复用旧PASS。",
          "检查完成条件：证据绑定新版本，原冲突计划不能直接冻结。",
          "保存 runId、账号/角色、工作区/环境、对象版本、操作结果及证据；重验结果 → INT/D02。失败时：失败继续交维护方；不复用旧证据。"
        ],
        "done": "证据绑定新版本，原冲突计划不能直接冻结。",
        "fail": "失败继续交维护方；不复用旧证据。"
      },
      {
        "id": "D05",
        "title": "核对最终文件、车云处理、Schema、敏感批准、资源保护，确认集合摘要。",
        "actor": "dcl / DCL 工程",
        "accounts": [
          "dcl"
        ],
        "workspace": "x89-project",
        "page": "配置集成 → 最终处理集合确认",
        "pre": "合并预览无冲突，全部源提交固定。",
        "steps": [
          "在账号入口输入 dcl，点击进入；核对角色“DCL 工程”。原型不需密码，仍需匹配授权。",
          "核对工作区：x89-project；组/范围：业务组 brake；按来源分别选择 battery/power；环境：testing。前序未创建或未授权时记录 BLOCKED，不自动补权。",
          "在项目区打开无冲突的最终集合，核对固定来源提交、Schema、双侧处理、敏感批准与预算。",
          "确认完整集合摘要，记录DCL确认；确认后改内容必须重新确认。",
          "检查完成条件：确认绑定完整集合及来源摘要，后续任何内容改变使确认失效。",
          "保存 runId、账号/角色、工作区/环境、对象版本、操作结果及证据；DCL确认 → INT/D06。失败时：问题退维护方，再合并再确认。"
        ],
        "done": "确认绑定完整集合及来源摘要，后续任何内容改变使确认失效。",
        "fail": "问题退维护方，再合并再确认。"
      },
      {
        "id": "D06",
        "title": "冻结完整候选与来源清单，移交集成测试。",
        "actor": "integrator / 配置集成",
        "accounts": [
          "integrator"
        ],
        "workspace": "x89-project",
        "page": "配置集成 → 冻结候选",
        "pre": "D05确认有效。",
        "steps": [
          "在账号入口输入 integrator，点击进入；核对角色“配置集成”。原型不需密码，仍需匹配授权。",
          "核对工作区：x89-project；组/范围：范围 Vehicle；环境：testing。前序未创建或未授权时记录 BLOCKED，不自动补权。",
          "在配置集成核对 D05 确认摘要与当前集合一致。",
          "冻结不可编辑候选并记录来源清单，交集成测试账号；不继承Feature的PASS。",
          "检查完成条件：冻结候选不可编辑，没有继承来源PASS。",
          "保存 runId、账号/角色、工作区/环境、对象版本、操作结果及证据；固定候选 → TEST/D07。失败时：内容需变更时新建候选。"
        ],
        "done": "冻结候选不可编辑，没有继承来源PASS。",
        "fail": "内容需变更时新建候选。"
      },
      {
        "id": "D07",
        "title": "在SIM-902、VEH-902下发冻结候选，完成整车独立测试。",
        "actor": "integration_tester / 测试验证（集成测试）",
        "accounts": [
          "integration_tester"
        ],
        "workspace": "x89-integration",
        "page": "配置集成 → 候选测试",
        "pre": "integration测试身份有testing池权限。",
        "steps": [
          "在账号入口输入 integration_tester，点击进入；核对角色“测试验证（集成测试）”。原型不需密码，仍需匹配授权。",
          "核对工作区：x89-integration；组/范围：范围 Vehicle；按候选包含的业务组选择；环境：testing。前序未创建或未授权时记录 BLOCKED，不自动补权。",
          "切 integration_tester，在 x89-integration、testing 环境选择冻结候选。",
          "向包含 SIM-902、VEH-902 的集成测试车辆组下发并等待生效。",
          "执行独立整车仿真和实车Mock测试，保存候选摘要及PASS证据。",
          "检查完成条件：候选摘要、实际生效集合及证据一致。",
          "保存 runId、账号/角色、工作区/环境、对象版本、操作结果及证据；Verified候选 → REL/E02。失败时：候选不能下发development或production，失败交维护方。"
        ],
        "done": "候选摘要、实际生效集合及证据一致。",
        "fail": "候选不能下发development或production，失败交维护方。"
      },
      {
        "id": "E01",
        "title": "准备正式镜像，确认量产车实际Integration Version、环境与兼容范围。",
        "actor": "resource / 车辆资源",
        "accounts": [
          "resource"
        ],
        "workspace": "x89-project",
        "page": "车辆资源、仿真镜像；外部软件集成系统",
        "pre": "正式软件版本由外部流程发布并有可信元数据。",
        "steps": [
          "在账号入口输入 resource，点击进入；核对角色“车辆资源”。原型不需密码，仍需匹配授权。",
          "核对工作区：x89-project；组/范围：范围 Vehicle；环境：production。前序未创建或未授权时记录 BLOCKED，不自动补权。",
          "从外部软件集成流程取得正式版本与可信元数据，准备正式镜像。",
          "检查量产资源实际版本、环境及兼容范围；部分域控失败的车辆移交外部OTA恢复，不作为发布目标。",
          "检查完成条件：软件版本不由DCL发布冒充；混合ECU软件状态量产不放行。",
          "保存 runId、账号/角色、工作区/环境、对象版本、操作结果及证据；兼容量产目标 → REL/E03。失败时：缺版本或部分域控失败交外部OTA恢复；研发不强制停摆。"
        ],
        "done": "软件版本不由DCL发布冒充；混合ECU软件状态量产不放行。",
        "fail": "缺版本或部分域控失败交外部OTA恢复；研发不强制停摆。"
      },
      {
        "id": "E02",
        "title": "核对DCL确认、敏感审批、候选测试摘要和回滚目标，Promote正式DCL集合。",
        "actor": "release / 配置发布",
        "accounts": [
          "release"
        ],
        "workspace": "x89-project",
        "page": "配置集成 → 发布与配置 OTA",
        "pre": "D07通过，目标软件版本已正式提供。",
        "steps": [
          "在账号入口输入 release，点击进入；核对角色“配置发布”。原型不需密码，仍需匹配授权。",
          "核对工作区：x89-project；组/范围：范围 Vehicle；环境：production。前序未创建或未授权时记录 BLOCKED，不自动补权。",
          "核对候选测试、DCL确认、敏感审批、软件兼容范围和回滚目标。",
          "Promote 正式DCL集合，保存不可变发布记录；检查车辆实际软件及配置未被自动改写。",
          "发布时填写独立DCL集成版本与适用整车软件版本列表；多个整车版本可共享同一DCL。Bugfix选择Patch集成，不要求整车软件版本变化。",
          "检查完成条件：不可变Release；车辆实际软件版本和实际DCL配置不自动变化。",
          "保存 runId、账号/角色、工作区/环境、对象版本、操作结果及证据；正式Release → REL/E03。失败时：审核或证据与摘要不一致则拒绝发布。"
        ],
        "done": "不可变Release；车辆实际软件版本和实际DCL配置不自动变化。",
        "fail": "审核或证据与摘要不一致则拒绝发布。"
      },
      {
        "id": "E03",
        "title": "创建灰度，收到签名回执后更新实际已生效集合。",
        "actor": "release / 配置发布",
        "accounts": [
          "release"
        ],
        "workspace": "x89-project",
        "page": "发布与配置 OTA → 灰度",
        "pre": "正式Release和兼容production目标可用。",
        "steps": [
          "在账号入口输入 release，点击进入；核对角色“配置发布”。原型不需密码，仍需匹配授权。",
          "核对工作区：x89-project；组/范围：范围 Vehicle；环境：production。前序未创建或未授权时记录 BLOCKED，不自动补权。",
          "选择兼容production车辆组，创建正式集合灰度任务，保存固定目标快照。",
          "等待签名回执；Mock演练明确使用合成签名，逐车检查实际生效与 PASS/FAIL。",
          "检查默认目标是车型及实际整车版本匹配的最新正式DCL；开始灰度后任务固定版本，新发布不改变本任务。",
          "检查完成条件：逐车Pending/PASS/FAIL分明，目标资源和摘要匹配。",
          "保存 runId、账号/角色、工作区/环境、对象版本、操作结果及证据；灰度通过 → REL/E04；失败 → REL/F01。失败时：非法或失配签名不能更新配置状态。"
        ],
        "done": "逐车Pending/PASS/FAIL分明，目标资源和摘要匹配。",
        "fail": "非法或失配签名不能更新配置状态。"
      },
      {
        "id": "E04",
        "title": "扩大目标，监控失败比例；出现异常立即暂停并移交恢复。",
        "actor": "release / 配置发布",
        "accounts": [
          "release"
        ],
        "workspace": "x89-project",
        "page": "发布与配置 OTA → 扩量",
        "pre": "灰度达到预定通过条件。",
        "steps": [
          "在账号入口输入 release，点击进入；核对角色“配置发布”。原型不需密码，仍需匹配授权。",
          "核对工作区：x89-project；组/范围：范围 Vehicle；环境：production。前序未创建或未授权时记录 BLOCKED，不自动补权。",
          "检查灰度通过条件，增加授权目标并等待逐车回执。",
          "监控失败比例，失败目标保留旧集合；出现异常立即暂停并交恢复流程。",
          "检查完成条件：未成功目标保留旧已生效集合，不做整组假成功。",
          "保存 runId、账号/角色、工作区/环境、对象版本、操作结果及证据；生效清单 → DCL/E05。失败时：停止新增下发，进入F01恢复。"
        ],
        "done": "未成功目标保留旧已生效集合，不做整组假成功。",
        "fail": "停止新增下发，进入F01恢复。"
      },
      {
        "id": "E05",
        "title": "测试人员触发虚构售后事件，检查路由、采集、处理、上传、云端产物和业务回调。",
        "actor": "dcl / DCL 工程",
        "accounts": [
          "dcl"
        ],
        "workspace": "x89-project",
        "page": "运行与异常恢复、提交与事件追溯",
        "pre": "目标车正式集合已确认生效。",
        "steps": [
          "在账号入口输入 dcl，点击进入；核对角色“DCL 工程”。原型不需密码，仍需匹配授权。",
          "核对工作区：x89-project；组/范围：业务组 brake；按来源分别选择 battery/power；环境：production。前序未创建或未授权时记录 BLOCKED，不自动补权。",
          "从已生效车辆触发虚构业务事件，记录当时实际配置快照。",
          "检查路由、采集、车端处理、上传、云端产物和业务回调，保存各节点证据。",
          "检查完成条件：事件保留当时配置；产物和回调按事件快照执行。",
          "保存 runId、账号/角色、工作区/环境、对象版本、操作结果及证据；可用数据与事件证据 → 业务方、OPS/F07。失败时：失败记录当前处理节点，安全重试并防重复产品。"
        ],
        "done": "事件保留当时配置；产物和回调按事件快照执行。",
        "fail": "失败记录当前处理节点，安全重试并防重复产品。"
      },
      {
        "id": "F01",
        "title": "暂停；显式开始新attempt，接收新PASS；无法修复时兼容回滚。",
        "actor": "release / 配置发布",
        "accounts": [
          "release"
        ],
        "workspace": "x89-project",
        "page": "发布与配置 OTA → 暂停、重试、回滚",
        "pre": "灰度出现FAIL。",
        "steps": [
          "在账号入口输入 release，点击进入；核对角色“配置发布”。原型不需密码，仍需匹配授权。",
          "核对工作区：x89-project；组/范围：范围 Vehicle；环境：production。前序未创建或未授权时记录 BLOCKED，不自动补权。",
          "对失败灰度任务执行暂停，保存原失败回执。",
          "显式开启新attempt，接收新成功回执；确认旧失败保留，旧attempt迟到不能覆盖。",
          "无法修复时选择兼容回滚目标执行回滚，确认实际生效及车辆组目标一致。",
          "暂停或回滚后再次请求配置，确认保持已确认集合，不被自动追新绕过；显式恢复后才继续。",
          "检查完成条件：旧失败保留，新成功可以更新；旧attempt和重复回执正确处理。",
          "保存 runId、账号/角色、工作区/环境、对象版本、操作结果及证据；恢复证据 → DCL/F02、TEST。失败时：签名或摘要错误按异常处理，不手改PASS。"
        ],
        "done": "旧失败保留，新成功可以更新；旧attempt和重复回执正确处理。",
        "fail": "签名或摘要错误按异常处理，不手改PASS。"
      },
      {
        "id": "F02",
        "title": "恢复失败处理，重传分片、去重回调；旧事件继续旧Parser版本。",
        "actor": "dcl / DCL 工程",
        "accounts": [
          "dcl"
        ],
        "workspace": "x89-project",
        "page": "运行与异常恢复、事件详情",
        "pre": "事件已形成快照，之后处理模板又发布新版本。",
        "steps": [
          "在账号入口输入 dcl，点击进入；核对角色“DCL 工程”。原型不需密码，仍需匹配授权。",
          "核对工作区：x89-project；组/范围：业务组 brake；按来源分别选择 battery/power；环境：production。前序未创建或未授权时记录 BLOCKED，不自动补权。",
          "打开历史事件，确认使用当时固定处理版本。",
          "重试失败节点、重传分片并重复回调，检查校验、产物唯一性及回调幂等。",
          "检查完成条件：校验通过、产品唯一、回调幂等；历史配置不漂移。",
          "保存 runId、账号/角色、工作区/环境、对象版本、操作结果及证据；恢复后的数据 → 业务方。失败时：预算耗尽退避；不能静默换新Parser。"
        ],
        "done": "校验通过、产品唯一、回调幂等；历史配置不漂移。",
        "fail": "预算耗尽退避；不能静默换新Parser。"
      },
      {
        "id": "F03",
        "title": "修文件或业务策略形成新提交；DCL按需修流程；重新审核和测试。",
        "actor": "business / 业务研发",
        "accounts": [
          "business"
        ],
        "workspace": "team-brake",
        "page": "研发 Feature、测试记录",
        "pre": "测试人员交付失败步骤和当前版本。",
        "steps": [
          "在账号入口输入 business，点击进入；核对角色“业务研发”。原型不需密码，仍需匹配授权。",
          "核对工作区：team-brake；组/范围：业务组 brake；环境：development。前序未创建或未授权时记录 BLOCKED，不自动补权。",
          "根据失败证据修正本组文件或策略，产生新提交；需要技术修改时交 dcl。",
          "检查新提交尚未Verified、旧证据保留；将新版本交测试重新审核及验证。",
          "检查完成条件：旧证据保留，新提交未测试前不能Verified。",
          "保存 runId、账号/角色、工作区/环境、对象版本、操作结果及证据；修复提交 → TEST/B04或C02。失败时：没有变化不得无故生成新配置版本。"
        ],
        "done": "旧证据保留，新提交未测试前不能Verified。",
        "fail": "没有变化不得无故生成新配置版本。"
      },
      {
        "id": "F04",
        "title": "记录真实组件状态；外部OTA继续完成或回滚；恢复后确认可信版本和DCL兼容。",
        "actor": "resource / 车辆资源",
        "accounts": [
          "resource"
        ],
        "workspace": "x89-project",
        "page": "车辆资源；外部软件OTA",
        "pre": "一辆车部分域控成功、部分失败。",
        "steps": [
          "在账号入口输入 resource，点击进入；核对角色“车辆资源”。原型不需密码，仍需匹配授权。",
          "核对工作区：x89-project；组/范围：范围 Vehicle；环境：production。前序未创建或未授权时记录 BLOCKED，不自动补权。",
          "记录单车各域控实际成功或失败状态，不填写期望版本冒充实际版本。",
          "由外部OTA完成或回滚后取得可信上报，确认软件状态与DCL兼容，再恢复量产资格。",
          "检查完成条件：研发可按明确兼容范围继续；量产在状态恢复一致前不放行。",
          "保存 runId、账号/角色、工作区/环境、对象版本、操作结果及证据；可信资源 → REL/E03或业务研发。失败时：不能把期望软件版本填写成实际版本。"
        ],
        "done": "研发可按明确兼容范围继续；量产在状态恢复一致前不放行。",
        "fail": "不能把期望软件版本填写成实际版本。"
      },
      {
        "id": "F05",
        "title": "结束任务和预约、停止实例、回收配额、移出闲置资源；不移出占用资源。",
        "actor": "workspace_manager / 工作区管理员",
        "accounts": [
          "workspace_manager"
        ],
        "workspace": "team-brake",
        "page": "工作区管理、资源借用与配额",
        "pre": "开发或测试结束。",
        "steps": [
          "在账号入口输入 workspace_manager，点击进入；核对角色“工作区管理员”。原型不需密码，仍需匹配授权。",
          "核对工作区：team-brake；组/范围：业务组 brake；环境：development。前序未创建或未授权时记录 BLOCKED，不自动补权。",
          "结束任务与预约，停止实例并回收配额。",
          "检查无占用后移出或重新归组，保留历史成员及任务快照；空组才允许归档。",
          "检查完成条件：资源可重新分配，归属和历史不变。",
          "保存 runId、账号/角色、工作区/环境、对象版本、操作结果及证据；可用资源 → 下一任务。失败时：占用先定位接手方。"
        ],
        "done": "资源可重新分配，归属和历史不变。",
        "fail": "占用先定位接手方。"
      },
      {
        "id": "F06",
        "title": "撤销角色/工作区授权，验证旧会话和直接对象请求。",
        "actor": "admin / 平台运维",
        "accounts": [
          "admin"
        ],
        "workspace": "平台级；A05前无工作区",
        "page": "账号与角色授权",
        "pre": "人员离组或账号停用。",
        "steps": [
          "在账号入口输入 admin，点击进入；核对角色“平台运维”。原型不需密码，仍需匹配授权。",
          "核对工作区：平台级；A05前无工作区；组/范围：全平台目录与授权；环境：按步骤配置三环境；隔离环境执行破坏性操作。前序未创建或未授权时记录 BLOCKED，不自动补权。",
          "在账号与角色授权撤销离组用户权限或停用账号。",
          "使用旧会话及直接对象请求验证拒绝，检查业务对象未变化且历史作者仍保留。",
          "检查完成条件：旧会话无效；未授权请求拒绝且业务数据不变。",
          "保存 runId、账号/角色、工作区/环境、对象版本、操作结果及证据；权限撤销记录 → 资源和业务维护方。失败时：不删除历史作者及审计记录。"
        ],
        "done": "旧会话无效；未授权请求拒绝且业务数据不变。",
        "fail": "不删除历史作者及审计记录。"
      },
      {
        "id": "F07",
        "title": "备份并在隔离环境恢复，检查版本、回执、事件和审计；提交运维交接。",
        "actor": "admin / 平台运维",
        "accounts": [
          "admin"
        ],
        "workspace": "平台级；A05前无工作区",
        "page": "组织与运行保障、部署环境",
        "pre": "平台有正式Release及历史事件。",
        "steps": [
          "在账号入口输入 admin，点击进入；核对角色“平台运维”。原型不需密码，仍需匹配授权。",
          "核对工作区：平台级；A05前无工作区；组/范围：全平台目录与授权；环境：按步骤配置三环境；隔离环境执行破坏性操作。前序未创建或未授权时记录 BLOCKED，不自动补权。",
          "使用部署团队提供的运维身份，在隔离环境备份并恢复数据库与存储。",
          "核对版本、回执、事件、审计和恢复窗口，保存恢复证据。",
          "以 admin 查看平台健康并提交运维交接；外部恢复未执行时记录 NOT_RUN 或 BLOCKED。",
          "检查完成条件：恢复点及丢失窗口明确；实际状态可重建，监控接手到人。",
          "保存 runId、账号/角色、工作区/环境、对象版本、操作结果及证据；平台启动验收 → 业务负责人、测试负责人。失败时：恢复检查不通过不得宣称可持续运营。"
        ],
        "done": "恢复点及丢失窗口明确；实际状态可重建，监控接手到人。",
        "fail": "恢复检查不通过不得宣称可持续运营。"
      }
    ]
  },
  {
    "id": "first-ota",
    "name": "首次 OTA · 集成与发布",
    "start": "clean",
    "scenes": [
      {
        "id": "E01",
        "title": "部署一个独立空平台",
        "actor": "终端运维人员",
        "accounts": [],
        "workspace": null,
        "page": "终端 → 浏览器",
        "pre": "解压完整项目；Node.js 24、Python 3。",
        "steps": [
          "进入 dcl-control-plane 根目录。不要使用现有演示数据库，以免首版编号和历史对象混入。",
          "运行：DCL_RUNTIME_DIR=runtime-first-ota DCL_PORT=8081 node reference/server.mjs。不要设置 DCL_SAMPLE_DATA。",
          "打开 http://127.0.0.1:8081/，选择 admin。另开终端运行 curl http://127.0.0.1:8081/api/health，检查 Healthy。",
          "将本手册目录复制到项目根目录，例如 first-ota-manual/。以后从项目根目录执行 node first-ota-manual/mock_receipt.mjs …。所有示例默认本地 8081。",
          "记录本次 runId：FIRST-OTA-20261012-01；后续截图、JSON和报告归入同一目录。"
        ],
        "done": "空平台可访问，只有 admin；重启使用同一 runtime-first-ota 数据目录。",
        "fail": "端口占用时换端口，并给回执工具设置 DCL_BASE_URL=http://127.0.0.1:新端口。"
      },
      {
        "id": "E02",
        "title": "建立组织、车型、业务组和工作区",
        "actor": "admin / 平台运维",
        "accounts": [
          "admin"
        ],
        "workspace": null,
        "page": "组织与运行保障、工作区管理",
        "pre": "E01完成。",
        "steps": [
          "建立团队组织：org-company 公司 → org-center 整车研发中心 → org-chassis 底盘部门 → org-brake 制动团队。",
          "登记车型 X89。建立业务组 brake（制动组，Domain=Chassis，用途=研发，代码 chassis.brake，组织 org-brake）及 hmi（Domain=HMI）。hmi 在首版无变更，用于检查继承；其组织节点先建立后选择。",
          "创建 TEAM 工作区 team-brake：组织 org-brake，车型 X89，业务组 brake，范围 Chassis。",
          "建立项目组织 proj-x89（X89项目）及其底盘/HMI子节点。创建 INTEGRATION 工作区 x89-integration：项目组织 proj-x89，车型 X89，业务组包含 brake、hmi，范围 Vehicle，来源工作区包含 team-brake。",
          "切换工作区确认只展示当前团队或项目组织架构。首次没有正式版本，界面显示“尚未获取整车版本”；不要手填 Bootstrap/RB0。"
        ],
        "done": "两工作区及来源关系正确；内部起始配置由平台自动管理。",
        "fail": "集成来源缺失会看不到 Feature；先补来源关系，不复制业务组配置。"
      },
      {
        "id": "E03",
        "title": "创建人员账号并关联九类角色",
        "actor": "admin / 平台运维",
        "accounts": [
          "admin"
        ],
        "workspace": null,
        "page": "账号与角色授权",
        "pre": "E02完成。",
        "steps": [
          "逐个创建演员表中的人员账号，填写完整姓名，不使用“王工”等称呼。所有账号启用，不设密码。",
          "按演员表勾选角色、工作区和环境。业务研发/业务测试授予 brake；DCL授予相关组及两个工作区；资源管理员在工作区按需授予 Chassis 和 Vehicle；集成、集成测试、发布授予 Vehicle。",
          "业务测试为“下发与验证”，不是“仅下发”。集成测试的权限由角色决定，不与业务测试混为一个全能测试授权。",
          "资源管理员必须能访问量产环境的 x89-integration；发布人员也必须具备该工作区量产环境权限。",
          "分别退出并点击每个人员账号，确认能进入获授权工作区。若同一人员兼任研发与测试，分别配置两条角色授权并切换，不自动合并权限。"
        ],
        "done": "九类职责均有人承担，账号能进入正确工作区；越权操作被拒绝。",
        "fail": "“角色未授权”检查账号授权；“工作区未授权”检查工作区绑定；不要用admin替代所有演员。"
      },
      {
        "id": "E04",
        "title": "发布普通文件的默认车端和云端处理",
        "actor": "dcl / DCL 工程",
        "accounts": [
          "dcl"
        ],
        "workspace": null,
        "page": "处理流程",
        "pre": "E03完成；选择 team-brake。",
        "steps": [
          "创建 Edge 处理 startup-edge：版本由平台生成；兼容格式 text，Schema *；步骤 Locate → Snapshot → Compress → Encrypt → Upload。",
          "创建 Cloud 处理 startup-cloud：兼容格式 text，Schema *；步骤 Receive → Checksum → Decrypt → RawStore → Index。",
          "发布 text_log 默认模板：format=text，schema=opaque-text_log@1，绑定刚创建的 Edge/Cloud 版本，保留30天，隐私P1。",
          "记录实际生成的处理引用，例如 startup-edge@1 / startup-cloud@1。模板发布只影响未来文件，不能改写历史提交。",
          "这里创建的是处理定义；RawStore 仅原始存储，不能把它当业务Parser或真实脱敏实现。首轮不采相机、点云、语音。"
        ],
        "done": "新建 text_log 时可同时自动绑定两侧处理，无需每个普通文件人工接单。",
        "fail": "模板缺失或不兼容时由DCL修模板或绑定，不能先下发再补定义。"
      },
      {
        "id": "E05",
        "title": "登记无整车版本研发镜像和团队资源",
        "actor": "dcl → resource → workspace_manager",
        "accounts": [
          "dcl",
          "resource",
          "workspace_manager"
        ],
        "workspace": null,
        "page": "镜像、车辆资源、工作区管理",
        "pre": "E04完成。",
        "steps": [
          "DCL登记镜像 x89-dev-first：车型X89，暂无整车版本，build=dev-first，摘要使用明确标注的 sha256:mock-dev-first；仅为演示镜像元数据。",
          "resource在team-brake登记SIM-901：仿真、X89、Chassis/brake、development，选择上述镜像，整车版本为空。",
          "登记VEH-901：实车模型、X89、研发环境，填写模拟VIN LSDEMOX89000000901、品牌车型与可选车牌；明确记录其为Mock设备，不是真车登记证明。实际整车版本保持空。",
          "workspace_manager核对两个资源在team-brake内；如资源创建在别处，先分配到本工作区。",
          "建立车辆组“制动首版验证组”：业务归属brake、用途研发、环境development，加入SIM-901、VEH-901。保存生成的车辆组ID。"
        ],
        "done": "业务首页能看到组内两资源、空整车版本、当前车上配置和车辆组；一车一组。",
        "fail": "个人仿真不能直接替代共享团队资源；先按团队资源管理和审批流程处理。"
      },
      {
        "id": "E06",
        "title": "新增业务文件与事件策略并提交",
        "actor": "business / 业务研发",
        "accounts": [
          "business"
        ],
        "workspace": null,
        "page": "车辆与配置工作台 → 研发 Feature",
        "pre": "E05完成；team-brake。",
        "steps": [
          "创建Feature：ID first-brake，名称“首版制动诊断”；没有正式版本时使用平台当前起始配置，不创建假的整车版本。",
          "新建数据项：名称“制动诊断日志”、源域控ADC、目录/data/brake、文件debug.log、类型text_log、用途“首版制动诊断”、隐私P1。",
          "平台生成唯一data_key和可读代码；检查自动绑定的Edge/Cloud引用。业务方不自行编造key。",
          "新建策略BrakeDebug：brake_pressure > 80 AND vehicle_speed > 30；Capture选择刚创建的逻辑数据项，pre=10s、post=20s。若界面不提供policy_id输入，以平台生成值为准。",
          "提交固定版本，记录commit及配置版本；普通文件自动检查通过后应达到DCL Ready。未变化的HMI继续继承，不创建Feature。",
          "向“制动首版验证组”提交团队下发申请，绑定本次固定提交和车辆清单。"
        ],
        "done": "文件+业务策略+双侧处理组成固定提交；状态DCL Ready；存在审批请求。",
        "fail": "新增或修改提交后旧测试和审批不适用于新提交；须重新申请和验证。"
      },
      {
        "id": "E07",
        "title": "审批组下发并应用固定配置",
        "actor": "workspace_manager → brake_tester",
        "accounts": [
          "workspace_manager",
          "brake_tester"
        ],
        "workspace": null,
        "page": "团队申请、车辆组 → 选择配置并下发",
        "pre": "E06固定提交已准备，资源空闲。",
        "steps": [
          "workspace_manager审核申请：核对工作区、Feature当前提交、车辆组ID及成员快照；批准，并填写“首版封闭Mock验证”。",
          "切brake_tester，角色业务测试，team-brake、development。打开车辆组，选择first-brake的固定提交，创建下发任务。",
          "记录下发任务command ID。此时目标配置已确定，但车上已生效配置仍不应直接变化。",
          "在终端为SIM-901提交Mock回执：node first-ota-manual/mock_receipt.mjs group COMMAND_ID SIM-901 PASS。",
          "再执行：node first-ota-manual/mock_receipt.mjs group COMMAND_ID VEH-901 PASS。刷新列表，检查两车已生效配置及任务回执。"
        ],
        "done": "同一固定配置在两资源确认应用；任务证据保留命令与成员快照。",
        "fail": "如果回执FAIL，停止验证、修复后建受控重试；下发途中不调整成员。此工具模拟回执，不实际启动仿真器。"
      },
      {
        "id": "E08",
        "title": "先仿真，再实车模型验证业务提交",
        "actor": "brake_tester / 业务测试",
        "accounts": [
          "brake_tester"
        ],
        "workspace": null,
        "page": "Feature测试资源与验证",
        "pre": "E07已生效配置确认。",
        "steps": [
          "针对SIM-901执行当前固定提交的仿真测试，记录PASS及模拟证据；核对commit和Release与回执一致。",
          "仿真当前提交PASS后，再对VEH-901执行实车模型测试，记录PASS。真实实车执行器未连接，因此记录为Mock。",
          "提交业务Verified，确认两个资源的最新测试均属于当前提交。",
          "结束资源任务/恢复default，保留历史测试和回执，不删除证据。",
          "切business尝试改动草稿可产生新提交，但本次集成必须继续选已验证的固定提交；若实际提交改变，重新验证。"
        ],
        "done": "first-brake为Verified，仿真→实车顺序正确，集成人员可收集。",
        "fail": "不能用个人自测代替业务Verified；任何当前提交FAIL均不能晋升。"
      },
      {
        "id": "E09",
        "title": "收集变更、冲突检查与合并",
        "actor": "integrator / 配置集成",
        "accounts": [
          "integrator"
        ],
        "workspace": null,
        "page": "配置集成 → 合并预览",
        "pre": "E08完成；x89-integration、Vehicle、testing。",
        "steps": [
          "创建首次整车集成计划，选择first-brake；目标使用当前平台起始配置。",
          "查看Added/Changed/Removed/Inherited，确认只有brake变化，HMI为空或继承，不生成多余版本。",
          "检查策略ID冲突、同数据源定义冲突、Schema/处理兼容性及资源保护问题。无冲突应为Ready。",
          "如冲突，禁止冻结；转到支线X02处理，业务归属人修复、生成新提交、重新验证，再创建新合并预览。",
          "保存合并计划ID和来源commit；交给DCL做最终处理集合确认。"
        ],
        "done": "得到无冲突、无兼容阻塞的完整配置预览；未直接发布。",
        "fail": "集成人员不擅自改业务策略；来源head变化时旧计划失效，重新预览。"
      },
      {
        "id": "E10",
        "title": "确认处理集合并冻结首个候选",
        "actor": "dcl → integrator",
        "accounts": [
          "dcl",
          "integrator"
        ],
        "workspace": null,
        "page": "合并详情 → 最终处理确认 → 冻结",
        "pre": "E09 Ready。",
        "steps": [
          "DCL切x89-integration，检查最终文件Spec、Edge/Cloud引用、格式和Schema、敏感审核情况与资源预算。",
          "点击确认最终处理集合，填写审核理由；确认绑定当前完整集合，不是业务方每次新增普通文件都要人工确认。",
          "integrator重新检查无冲突，点击冻结候选。",
          "确认首版Candidate 1.0，mode=Initial（内部语义）；候选具有独立不可变配置快照。",
          "候选测试列表必须为空，不能复制Feature PASS作为集成测试PASS。"
        ],
        "done": "冻结首版候选，完整集合及来源固定，交给集成测试。",
        "fail": "DCL确认后任何集合变化都需重确认；测试不通过不允许发布。"
      },
      {
        "id": "E11",
        "title": "准备并验证独立集成资源",
        "actor": "resource → integration_tester",
        "accounts": [
          "resource",
          "integration_tester"
        ],
        "workspace": null,
        "page": "车辆资源 → 集成候选测试",
        "pre": "E10完成。",
        "steps": [
          "resource在x89-integration登记SIM-902和VEH-902：X89、Integration资源池、testing；仿真选择x89-dev-first，实际整车版本仍可为空，实车填模拟VIN LSDEMOX89000000902。",
          "integration_tester进入x89-integration，角色集成测试、范围Vehicle。绑定冻结候选，先仿真后实车模型验证。",
          "无整车版本的同车型testing资源，现在会显示在首配候选选择框中。选择SIM-902与VEH-902并确认绑定；保持其实际整车版本为空。正式基线候选不能据此接收NULL或不兼容软件资源，量产仍被排除。",
          "两资源配置确认后，分别记录当前候选仿真PASS和实车模型PASS，再提交候选Verified。",
          "核对测试记录固定同一候选配置签名。结束测试资源任务并保留证据。"
        ],
        "done": "候选Verified，完成独立集成测试；车辆软件版本未因DCL测试改变。",
        "fail": "业务测试角色不能验证候选；没有资源时核对车型、测试环境、Integration资源池、工作区授权与占用状态。"
      },
      {
        "id": "E12",
        "title": "登记真实来源的软件版本并正式发布DCL",
        "actor": "resource → release",
        "accounts": [
          "resource",
          "release"
        ],
        "workspace": null,
        "page": "可信软件发布记录 → 候选发布",
        "pre": "E11完成；软件团队已发布适用整车版本，或本地Mock演练明确声明软件记录是fixture。",
        "steps": [
          "resource在x89-integration登记软件整车版本1.0，车型X89，来源填写外部软件发布编号；演练可写“MOCK 外部软件发布记录”。这不自动给车刷软件。",
          "release在x89-integration、Vehicle、testing打开已Verified候选，点击正式发布。",
          "填写DCL集成版本1.0.0，适用整车软件版本1.0。软件1.0不是DCL1.0.0，它们是独立对象，适用关系在此关联。",
          "检查处理集合确认、当前候选仿真和实车模型证据、基线未被其他发布替换等门禁，然后发布。",
          "确认正式DCL1.0.0生成，参与Feature收口Archived；车辆actualIntegration不被自动改写。记录实际内部release ID但日常使用DCL1.0.0。"
        ],
        "done": "首个正式DCL集合可查询，适用X89软件1.0。",
        "fail": "没有可信的软件发布记录时只能停在候选，不能凭空制造软件版本或将NULL车辆投入量产OTA。"
      },
      {
        "id": "E13",
        "title": "导出首个配置发布材料",
        "actor": "release / 配置发布",
        "accounts": [
          "release"
        ],
        "workspace": null,
        "page": "提交与事件追溯 → 正式配置详情",
        "pre": "E12完成。",
        "steps": [
          "打开DCL1.0.0详情，核对类型Base、车型X89、适用软件1.0、固定文件/策略/处理引用。",
          "点击“导出配置集合”，保存JSON，改文件名为DCL_X89_1.0.0_config.json；不要修改其内容。",
          "使用共享后端，在正式配置详情点击“下载签名配置包 · Mock”。ZIP包含configuration.json、evidence.json、manifest.json、signature.json和README；manifest固定文件SHA-256，服务端Ed25519签名绑定清单。离线页不伪造服务端签名。",
          "从平台管理员取得独立可信渠道提供的演示公钥，例如public.pem。运行 node scripts/verify-release-package.mjs 下载的Mock.zip public.pem，检查签名、文件摘要及版本。包内公钥不能自动充当生产信任根。",
          "终端生成审阅归档：sha256sum first-release/DCL_X89_1.0.0_config.json > first-release/SHA256SUMS.txt；python3 -m zipfile -c DCL_X89_1.0.0_review.zip first-release。"
        ],
        "done": "取得可解包、可核验签名与内容完整性的首版Mock配置包，保留固定提交、合并与测试证据。",
        "fail": "这个签名ZIP仍标记PROTOTYPE_MOCK、productionInstallable=false；没有整车软件安装器、生产信任根和真实Agent执行能力。配置JSON和审阅ZIP仍可导出。"
      },
      {
        "id": "E14",
        "title": "准备量产目标与首版恢复方案",
        "actor": "resource / 车辆资源",
        "accounts": [
          "resource"
        ],
        "workspace": null,
        "page": "资源详情、可信软件版本、工作区资源",
        "pre": "E12完成；在隔离本地环境。",
        "steps": [
          "登记VEH-903、VEH-904：车型X89、production、Integration资源池，归入获授权x89-integration，分别填模拟VIN LSDEMOX89000000903 / LSDEMOX89000000904。",
          "真实场景由车端/DIP/OTA上报actualIntegration=1.0及各域控状态。演练用授权API：node first-ota-manual/mock_receipt.mjs action resource 车辆资源 x89-integration production reportControllerVersions '[\"VEH-903\",{\"target\":\"1.0\",\"source\":\"MOCK DIP\",\"controllers\":[{\"name\":\"ADC\",\"version\":\"1.0\",\"status\":\"PASS\"},{\"name\":\"BMS\",\"version\":\"1.0\",\"status\":\"PASS\"}]}]'；对VEH-904重复。",
          "检查两车不为PartialFailure，软件版本1.0确实与DCL适用关系匹配。没有回执前已生效配置仍为空或旧配置。",
          "本轮直接灰度使用暂不归车辆组的两车；如果已归组，必须从车辆组下发界面操作，不能同时创建直投任务。量产组需额外授权工作区管理员production，默认制动管理员没有此权限。",
          "首版可能没有上一份兼容正式DCL：预先定义暂停、恢复到受验证的出厂安全配置或停止采集方案；不能将内部Bootstrap视为已验证量产回滚包。"
        ],
        "done": "两资源处于量产环境、空闲、软件一致；首版恢复边界明确。",
        "fail": "任何域控升级部分失败都先由软件OTA完成或回滚，DCL量产下发阻止；研发容许已知状态不代表量产许可。"
      },
      {
        "id": "E15",
        "title": "创建灰度并接收签名Mock回执",
        "actor": "release / 配置发布",
        "accounts": [
          "release"
        ],
        "workspace": null,
        "page": "配置OTA → 创建配置灰度",
        "pre": "E14完成；x89-integration、production、Vehicle。",
        "steps": [
          "选择正式DCL1.0.0，目标只选VEH-903；开始灰度，记录OTA任务ID。",
          "检查任务的目标清单和配置摘要；期望版本不是车上已生效版本。",
          "执行：node first-ota-manual/mock_receipt.mjs ota OTA_TASK_ID VEH-903 PASS。工具会用resource账号登记本地Mock节点公钥，用release账号提交Ed25519签名回执；严格复用任务当前attempt及配置摘要。",
          "刷新资源及OTA详情，检查VEH-903已生效DCL1.0.0、回执PASS、任务进入允许扩量状态，实际软件仍1.0。",
          "保存终端输出、任务ID、resource、attempt、release和digest；Mock回执只验证服务端签名与状态机。"
        ],
        "done": "首辆灰度确认成功，正式配置与实际软件版本分离记录。",
        "fail": "签名、digest、任务ID或attempt不匹配会拒绝；检查失败原因，不直接改数据库标成功。"
      },
      {
        "id": "E16",
        "title": "扩量、失败暂停、新attempt重试",
        "actor": "release / 配置发布",
        "accounts": [
          "release"
        ],
        "workspace": null,
        "page": "OTA详情 → 扩大下发、暂停、重试",
        "pre": "E15灰度成功。",
        "steps": [
          "扩量添加VEH-904。目标清单固定，不通过改车辆组成员把车塞进已有任务。",
          "演失败：node first-ota-manual/mock_receipt.mjs ota OTA_TASK_ID VEH-904 FAIL。确认任务Paused，VEH-904保留原已生效配置。",
          "排查与修复后在界面明确恢复/重试。检查VEH-904当前attempt从0变1，旧FAIL记录保留。",
          "执行：node first-ota-manual/mock_receipt.mjs ota OTA_TASK_ID VEH-904 PASS。工具自动读取新attempt，不能覆盖旧attempt的FAIL。",
          "确认两个目标最新回执PASS且任务Completed。同一attempt重复相同回执幂等，内容不同拒绝。"
        ],
        "done": "首轮扩量完成，失败与重试均可追溯。",
        "fail": "首版无兼容上一配置时不能强制回滚；暂停扩量、保持已生效状态，修复后出新包或受控重试。"
      },
      {
        "id": "E17",
        "title": "验证数据闭环而不只验证配置安装",
        "actor": "dcl → 业务需求人",
        "accounts": [
          "dcl"
        ],
        "workspace": null,
        "page": "运行保障、事件追溯、云端产物",
        "pre": "E16完成。",
        "steps": [
          "核对业务节点已收到该版本策略；触发一条满足BrakeDebug条件的合成事件，检查策略路由和节点应用回执。",
          "核对事件包含资源ID/VIN、actualIntegration、DCL版本、commit/文件/处理引用及当时Resolved快照；后续修改分支不会改历史事件。",
          "验证合成文件的车端处理、分片上传、云端模型处理和业务回调；断网重试不重复生成产物，回调只一次。",
          "当前未连接真实业务节点/Parser/车端，因此用node qa/mock-provider-episodes.mjs演MP-08，并保存qa/reports/mock-provider-episodes.json；它是隔离临时服务，不能代替本次常驻数据库的事件证据。",
          "业务需求人核对数据是否满足诊断目的；真实发布前补真实格式、算子、采集和业务消费验收。"
        ],
        "done": "配置OTA控制链与合成数据闭环证据区分保存；未执行真实环节明确标记。",
        "fail": "仅OTA PASS不代表数据可用；缺Parser或业务消费结果应记录阻塞。"
      },
      {
        "id": "E18",
        "title": "验收、交接与下一版准备",
        "actor": "release → admin → 各业务人员",
        "accounts": [
          "release",
          "admin"
        ],
        "workspace": null,
        "page": "发布详情、审计、验收记录",
        "pre": "E16完成；E17按Mock/真实范围记录。",
        "steps": [
          "核对正式DCL1.0.0、适用软件1.0、来源固定提交、无冲突合并、DCL确认、独立集成测试。",
          "核对VEH-903/904actualIntegration=1.0、已生效DCL1.0.0、最新回执PASS、失败重试历史保留。",
          "备份需保证SQLite一致性；正常停止服务后复制runtime-first-ota和演示节点密钥，恢复到独立目录后启动并核对配置及签名公钥。本地自动化PK04另验证SQLite一致性快照恢复，保证配置和持久签名密钥一致；不是生产灾备认证。",
          "首版后的业务改动建立新Feature并提交新版本；同软件1.0的Bugfix可发布新DCL版本，但仍需完整门禁。量产默认最新匹配正式版本，研发测试固定版本。",
          "按后文执行独立首版回放和持续验收；将NOT_RUN/BLOCKED保留，不将Mock算真实量产通过。"
        ],
        "done": "首版控制流程完成并可追溯；有明确下一版与真实接入交接。",
        "fail": "没有真实Agent/OTA封装/信任根/执行器时，结论是“首版Mock流程通过”，不是“量产OTA上线通过”。"
      },
      {
        "id": "X01",
        "title": "敏感文件审核支线",
        "actor": "business → dcl → brake_tester",
        "accounts": [
          "business",
          "dcl",
          "brake_tester"
        ],
        "workspace": null,
        "page": "新建文件、敏感审核、Feature测试",
        "pre": "需要相机、点云、位置、语音等数据时，插入E06之后。",
        "steps": [
          "业务创建文件时如实选择类型与敏感标签；默认处理同时生成/绑定，但敏感项停在Submitted。",
          "DCL检查边缘处理、加密、保留期限、访问范围、必要性与脱敏能力；不合格明确Rejected及原因。",
          "业务缩小用途/范围，形成新提交；DCL针对该提交重新审核Approved。",
          "复用E07/E08重新验证；合并后E10仍确认最终集合。不得把对旧提交的审核复用到新敏感内容。"
        ],
        "done": "敏感审核严格绑定内容和提交。",
        "fail": "无真实脱敏算子时只能使用明确合成样本演练，不能宣称真实敏感数据安全处理通过。"
      },
      {
        "id": "X02",
        "title": "同业务组两个分支冲突支线",
        "actor": "business → brake_tester → integrator → dcl",
        "accounts": [
          "business",
          "brake_tester",
          "integrator",
          "dcl"
        ],
        "workspace": null,
        "page": "分支、策略、合并预览",
        "pre": "插入E09；两分支应属于同一业务组，修改同一policy_id。",
        "steps": [
          "创建first-alt，复用同一个逻辑文件和policy_id；post从20改为25，提交并按E07/E08验证。",
          "integrator同时选first-brake与first-alt；合并应显示Conflict，冻结被阻止。",
          "业务归属人根据测试结论统一为post=20（或双方接受的值），提交新版本；旧测试不自动继承。",
          "重新审批和业务验证，再重新创建合并计划；旧冲突计划不强制冻结。",
          "DCL确认新的完整集合，冻结候选并重新执行独立集成测试。"
        ],
        "done": "冲突由维护方修复，集成人员只协调与合并。",
        "fail": "不同组独立策略通常可合并，不要人为把所有跨域变更都算冲突。"
      },
      {
        "id": "X03",
        "title": "首版中途取消或回滚支线",
        "actor": "release → resource → dcl",
        "accounts": [
          "release",
          "resource",
          "dcl"
        ],
        "workspace": null,
        "page": "OTA详情、资源状态、恢复记录",
        "pre": "任一灰度或扩量异常。",
        "steps": [
          "暂停扩量，记录受影响车辆、失败步骤、实际生效配置与软件健康。",
          "如果已有上一份兼容且已验证配置，可在平台允许的路径回滚并等待新回执。",
          "真正首版无上一正式配置时，回滚不是必然可执行：使用事先批准的出厂安全配置、停止采集、重新封装首版或完成软件修复。",
          "软件域控部分升级失败先处理软件OTA，不以改变DCL适用版本掩盖混合软件状态。",
          "恢复后核对每车实际配置，不能仅以任务目标判断成功。"
        ],
        "done": "异常恢复不损失历史证据，不虚构回滚版本。",
        "fail": "生产安全恢复/禁采的车端能力尚需真实接入，原型不会生成可信出厂包。"
      }
    ]
  },
  {
    "id": "data-usage",
    "name": "数据使用 · 售后与训练",
    "start": "demo",
    "scenes": [
      {
        "id": "U01",
        "title": "售后按车和事件定位采集数据",
        "actor": "business / 陈明 · 业务研发；制动团队工作区；研发环境",
        "accounts": [
          "business"
        ],
        "workspace": null,
        "page": "数据查询 → 售后查询",
        "pre": "样例平台可访问，business有制动团队资源授权；不要求真实车辆。",
        "steps": [
          "在下方操作区选择business，切换制动团队工作区和研发环境。",
          "打开数据查询 → 售后查询，输入VEH-001查询；核对车辆标识、车型、策略和事件。",
          "输入事件名称“处理失败诊断”，核对只显示匹配事件。",
          "打开查看事件数据，检查采集文件、车端与云端处理状态和ParserFailure原因。",
          "展开事件配置追溯，核对策略版本来自事件快照；文件没有被哪些提交使用的字段。",
          "查询未授权车辆VEH-002，应无记录；记录本次观察结果和事件ID。"
        ],
        "done": "能按车和事件定位文件与处理失败；跨组资源不泄漏。",
        "fail": "没有样例时先确认样例部署和工作区；不要扩大账号授权来绕过错误。"
      },
      {
        "id": "U02",
        "title": "训练按策略和场景选用数据",
        "actor": "business / 陈明 · 业务研发；制动团队工作区；研发环境",
        "accounts": [
          "business"
        ],
        "workspace": null,
        "page": "数据查询 → 训练数据查询",
        "pre": "U01完成或已存在授权范围内的采集样例。",
        "steps": [
          "切换训练数据查询，核对没有VIN、UVID、车牌筛选或结果列。",
          "填写策略brake.monitor、车型X89、场景急刹车、质量A查询。",
          "选择可用数据，导出JSON清单，核对事件、策略、场景、文件和MOCK标识；不应含车辆身份字段。",
          "将数据可用性改为全部，查看解析失败、质量Unknown或用途待确认的记录。",
          "这些记录应显示不可选用，不能导出为可用数据。",
          "记录清单文件位置与验收结果；Mock数据不可登记为真实车辆采集通过。"
        ],
        "done": "能从业务场景选取合格Mock数据，未知质量和用途被阻止，导出不暴露车辆身份。",
        "fail": "检查质量、用途许可和处理状态；不手工修改数据来制造通过。"
      }
    ]
  },
  {
    "id": "client-report",
    "name": "客户端状态上报 · 车辆资源与 DCL 联调",
    "start": "demo",
    "scenes": [
      {
        "id": "R01",
        "title": "查看客户端实际状态与上报历史",
        "actor": "resource / 刘子衡 · 车辆资源；研发环境",
        "accounts": [
          "resource"
        ],
        "workspace": null,
        "page": "车辆与车辆组 → 车辆台账 → 客户端状态",
        "pre": "样例平台可访问；SIM-021 的设备密钥已由车辆资源登记。",
        "steps": [
          "选择 resource（刘子衡，车辆资源角色），打开车辆台账，查看 SIM-021 的客户端状态。",
          "核对实际整车版本、DCL Client 版本、已生效配置、文件和车云处理引用。",
          "核对上报与平台记录的对照只作诊断；展开上报历史，确认重启前后的启动计数。"
        ],
        "done": "能看到车辆实际运行的版本与配置，以及按启动计数和序号排序的完整历史。",
        "fail": "没有上报时先确认设备密钥已登记、客户端在运行；不要手工填写上报内容。"
      },
      {
        "id": "R02",
        "title": "离线时版本变化暂存待补报",
        "actor": "车辆模拟器 · SIM-021",
        "accounts": [
          "resource"
        ],
        "workspace": null,
        "page": "原型工具 → 车辆模拟器",
        "pre": "R01 完成。",
        "steps": [
          "在车辆模拟器把 SIM-021 设为离线。",
          "升级客户端版本，再触发上报。",
          "确认上报暂存为待补报，平台没有新的成功上报，最新状态不变。"
        ],
        "done": "离线期间版本变化只产生待发送快照，不出现成功上报。",
        "fail": "离线时出现成功上报说明未按连接状态处理。"
      },
      {
        "id": "R03",
        "title": "恢复连接后补报",
        "actor": "车辆模拟器 · SIM-021；resource 核对",
        "accounts": [
          "resource"
        ],
        "workspace": null,
        "page": "原型工具 → 车辆模拟器；车辆台账 → 客户端状态",
        "pre": "R02 完成，SIM-021 有待补报快照。",
        "steps": [
          "把 SIM-021 恢复在线并补报。",
          "确认待补报清空，最新状态更新为新客户端版本。",
          "核对历史保留，之前的上报没有被删除或改写。"
        ],
        "done": "快照补报成功；最新状态更新，历史保留。",
        "fail": "补报失败的快照应留在队列并显示原因，不能丢弃。"
      },
      {
        "id": "R04",
        "title": "设备身份与签名",
        "actor": "resource / 车辆资源；车辆模拟器",
        "accounts": [
          "resource"
        ],
        "workspace": null,
        "page": "车辆台账 → 登记设备密钥；车辆模拟器",
        "pre": "可登记新的实车。",
        "steps": [
          "登记一辆新实车，未登记设备密钥时让其客户端上报，应被拒绝。",
          "车辆资源登记该车设备公钥后再上报，应被接收。",
          "篡改已签名的上报或改用其他车辆身份，应被拒绝且平台状态不变。"
        ],
        "done": "只有登记了设备公钥的车辆才能上报；签名或身份不符的上报被拒绝。",
        "fail": "签名为 Mock，只验证流程；不能当作真实设备认证。"
      },
      {
        "id": "R05",
        "title": "重复、乱序与重启",
        "actor": "车辆模拟器 · SIM-021",
        "accounts": [
          "resource"
        ],
        "workspace": null,
        "page": "原型工具 → 车辆模拟器",
        "pre": "R03 完成。",
        "steps": [
          "重放上一份上报，应返回重复且不新增历史。",
          "同一启动与序号发送不同内容、同一启动计数换启动 ID，应被拒绝。",
          "两份上报乱序到达，较旧的只进入历史，不覆盖最新状态。",
          "重启客户端，启动计数加一、序号从零开始，新上报成为最新。"
        ],
        "done": "最新状态按启动计数与序号决定，不按客户端时钟；重复与冲突被正确处理。",
        "fail": "以客户端时间排序或用重置计数覆盖历史都是错误的。"
      }
    ]
  }
];

export const NEGATIVE_CASES: NegativeCase[] = [
  {
    "id": "T-N01",
    "role": "DEV",
    "action": "用business登记仿真资源",
    "expected": "请求拒绝，资源数与revision不变。"
  },
  {
    "id": "T-N02",
    "role": "WM",
    "action": "在制动工作区登记电池、X90或production资源",
    "expected": "服务端逐项拒绝，不能靠换筛选绕过。"
  },
  {
    "id": "T-N03",
    "role": "VR",
    "action": "并发登记同VIN和同资源ID",
    "expected": "只保留一项，失败请求无部分写入。"
  },
  {
    "id": "T-N04",
    "role": "WM",
    "action": "选择X90镜像创建X89车，或伪造镜像整车版本",
    "expected": "车型与版本不匹配拒绝。"
  },
  {
    "id": "T-N05",
    "role": "DEV",
    "action": "相同requestId重放文件创建",
    "expected": "相同data_key，只有一个身份和双侧绑定。"
  },
  {
    "id": "T-N06",
    "role": "DEV",
    "action": "注入云端策略创建失败，再并发创建同来源文件",
    "expected": "全事务回滚或复用同一身份；没有孤立文件/单侧策略。"
  },
  {
    "id": "T-N07",
    "role": "DEV",
    "action": "读取授权电池文件后尝试修改其定义或绑定",
    "expected": "读取允许，修改拒绝且原版本不变。"
  },
  {
    "id": "T-N08",
    "role": "DEV",
    "action": "未审核camera/pointcloud/GNSS，或仅完成一般接入后直接下发",
    "expected": "禁止采集；普通Ready不能替代敏感批准。"
  },
  {
    "id": "T-N09",
    "role": "DEV",
    "action": "把含敏感内容文本标成普通日志或改低等级",
    "expected": "平台规则仍要求审核；用户不能自行放行。"
  },
  {
    "id": "T-N10",
    "role": "DCL",
    "action": "批准后修改文件范围、车云处理、上传或保留规则",
    "expected": "新提交审批失效，需按影响重审及重测。"
  },
  {
    "id": "T-N11",
    "role": "DCL",
    "action": "升级默认模板后解析旧提交和旧事件",
    "expected": "固定旧模板版本，不追随latest。"
  },
  {
    "id": "T-N12",
    "role": "DEV",
    "action": "无变化再次提交，或仅更改软件Build",
    "expected": "复用原提交和DCL版本；实际配置变更才新建。"
  },
  {
    "id": "T-N13",
    "role": "TEST",
    "action": "仅下发身份记录PASS或业务测试身份测试整车候选",
    "expected": "拒绝职责越权。"
  },
  {
    "id": "T-N14",
    "role": "TEST",
    "action": "回执Pending或车上旧配置时写当前提交PASS",
    "expected": "拒绝，实际生效版本与测试目标必须一致。"
  },
  {
    "id": "T-N15",
    "role": "REL",
    "action": "Feature发量产；候选发研发或量产；正式Release发不兼容车型/版本",
    "expected": "逐类目标门禁拒绝，无半批应用。"
  },
  {
    "id": "T-N16",
    "role": "INT",
    "action": "有冲突冻结候选，或集成人员代改维护方策略",
    "expected": "拒绝；修复新提交重验再合并。"
  },
  {
    "id": "T-N17",
    "role": "TEST",
    "action": "候选未获最终DCL确认就绑定测试车辆",
    "expected": "拒绝候选测试；来源Ready不等于集合确认。"
  },
  {
    "id": "T-N18",
    "role": "REL",
    "action": "未获集合确认、摘要漂移或无当前候选测试即发布",
    "expected": "拒绝，已审批已测试内容必须与发布摘要一致。"
  },
  {
    "id": "T-N19",
    "role": "REL",
    "action": "FAIL后新attempt成功；同attempt矛盾回执；旧attempt迟到",
    "expected": "新尝试PASS接受，旧失败保留；矛盾和过期回执拒绝。"
  },
  {
    "id": "T-N20",
    "role": "DCL",
    "action": "重传相同分片、篡改checksum、重复产品回调",
    "expected": "正常重传幂等；坏校验拒绝；产品及业务回调不重复。"
  },
  {
    "id": "T-N21",
    "role": "OPS",
    "action": "撤销授权后继续使用旧token访问同一对象",
    "expected": "请求拒绝，历史记录保留，不写业务数据。"
  },
  {
    "id": "T-N22",
    "role": "VR",
    "action": "量产车部分ECU升级失败，却申报整体版本成功",
    "expected": "量产目标不放行，记录真实状态，交外部OTA完成或回滚。"
  },
  {
    "id": "T-N23",
    "role": "WM",
    "action": "运行实例或仍有任务/下发/预约时移出资源",
    "expected": "拒绝，结束占用后才移出。"
  },
  {
    "id": "T-N24",
    "role": "OPS",
    "action": "真正新装平台初始化时自动载入演示组织/资源/账号",
    "expected": "仅保留管理员及内置角色；样例夹具必须显式加载。"
  }
];
