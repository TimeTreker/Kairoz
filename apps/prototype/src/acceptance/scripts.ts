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
          "车端签名上报单车各域控实际成功或失败状态；平台不把期望版本当作实际版本。",
          "外部 OTA 完成或回滚后由车端重新上报，确认软件状态与 DCL 兼容，再恢复量产资格。",
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
          "PLM（模拟）发布整车版本 X89 1.0（不带 DCL 件），同步到平台；版本只从 PLM 来，平台没有手工登记入口。这不自动给车刷软件。",
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
          "从 TSP 登记 VEH-903、VEH-904：production、Integration 资源池，归入获授权 x89-integration。",
          "TSP（模拟）收录 VEH-903、VEH-904（应为 1.0），resource 从 TSP 登记两辆量产车并登记设备密钥；车辆按 PLM BOM 运行 1.0，签名上报各域控状态，平台记为一致。",
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
  },
  {
    "id": "domain-integration",
    "name": "子系统集成 · ADC/CDC 联合演练",
    "start": "demo",
    "scenes": [
      {
        "id": "S01",
        "title": "ADC 泊车组研发并提交",
        "actor": "adc_parking / 张景然 · 业务研发；泊车团队工作区",
        "accounts": [
          "adc_parking"
        ],
        "workspace": null,
        "page": "研发 Feature；车辆与车辆组 → 我的研发仿真；原型工具 → 车辆模拟器",
        "pre": "演示数据；ADC、CDC 域集成工作区已建立。",
        "steps": [
          "选择 adc_parking，创建 Feature，登记普通文本日志和采集策略并提交。",
          "记录固定提交版本。",
          "在“车辆与车辆组 → 我的研发仿真”新建个人仿真（x89-dev-sim），配置该 Feature 草稿，车辆模拟器回执后记录个人自测 PASS。"
        ],
        "done": "泊车组得到 DCL Ready 的固定提交；个人自测标注“与提交一致”，不计入团队验证。",
        "fail": "个人仿真不能直接作为团队资源；固定提交在 S04 由团队测试车组验证。"
      },
      {
        "id": "S02",
        "title": "ADC 系统应用组与 CDC 两组研发",
        "actor": "adc_system、cdc_hmi、cdc_app · 业务研发",
        "accounts": [
          "adc_system",
          "cdc_hmi",
          "cdc_app"
        ],
        "workspace": null,
        "page": "研发 Feature",
        "pre": "S01 完成。",
        "steps": [
          "adc_system 为本组创建另一 Feature 并提交，不能修改泊车组的文件和策略。",
          "cdc_hmi 与 cdc_app 重复相同步骤。"
        ],
        "done": "四个组各有固定提交，跨组修改被拒绝。",
        "fail": "跨组写入成功说明授权错误。"
      },
      {
        "id": "S03",
        "title": "域集成人员以工作区管理员审批团队测试",
        "actor": "adc_integrator / 梁思齐 · 工作区管理员",
        "accounts": [
          "adc_integrator",
          "adc_parking_tester"
        ],
        "workspace": null,
        "page": "车辆与车辆组；研发 Feature → 下发与测试",
        "pre": "S01 完成；泊车研发车组已有仿真车与实车。",
        "steps": [
          "adc_integrator 以工作区管理员身份为泊车研发车组开启下发审批。",
          "adc_parking_tester 为固定提交申请团队测试，adc_integrator 批准后执行下发。"
        ],
        "done": "审批后的申请只能执行一次，下发固定在申请时的提交。",
        "fail": "未经审批直接下发到需审批的车组应被拒绝。"
      },
      {
        "id": "S04",
        "title": "团队测试：先仿真后实车，交付 Verified",
        "actor": "各组业务测试账号",
        "accounts": [
          "adc_parking_tester",
          "adc_system_tester",
          "cdc_hmi_tester",
          "cdc_app_tester"
        ],
        "workspace": null,
        "page": "研发 Feature → 下发与测试",
        "pre": "S02、S03 完成。",
        "steps": [
          "各组测试账号把固定提交下发到本组研发车组。",
          "车辆回执后先登记仿真 PASS，再登记实车 PASS，确认 Verified。"
        ],
        "done": "四个 Feature 均为 Verified。",
        "fail": "回执前不能登记结果；测试身份不能编辑配置。"
      },
      {
        "id": "S05",
        "title": "域内合并：ADC 只收本域，CDC 只收本域",
        "actor": "adc_integrator、cdc_integrator · 配置集成",
        "accounts": [
          "adc_integrator",
          "cdc_integrator"
        ],
        "workspace": null,
        "page": "配置集成 → 合并与处理确认",
        "pre": "S04 完成。",
        "steps": [
          "adc_integrator 在 ADC 域集成工作区选择两个已验证 Feature 预览合并。",
          "cdc_integrator 在 CDC 域集成工作区只能看到并选择 CDC 来源。"
        ],
        "done": "两个域各得到可冻结前的合并预览；跨域来源不可选。",
        "fail": "跨域输入必须被拒绝。"
      },
      {
        "id": "S06",
        "title": "同组两分支冲突，由维护方修复",
        "actor": "adc_parking、adc_parking_tester、adc_integrator",
        "accounts": [
          "adc_parking",
          "adc_parking_tester",
          "adc_integrator"
        ],
        "workspace": null,
        "page": "研发 Feature；配置集成",
        "pre": "S05 完成。",
        "steps": [
          "泊车组两个分支对同一 policy_id 的触发条件做不同修改，分别提交并验证。",
          "adc_integrator 合并时显示冲突并阻止冻结。",
          "策略维护方修复后形成新提交并重新验证，集成人员重新预览。"
        ],
        "done": "冲突只能由维护方修复；重新预览后可冻结。",
        "fail": "集成人员不能代改维护方策略。"
      },
      {
        "id": "S07",
        "title": "DCL 确认、冻结子系统候选、域内集成测试并发布子系统",
        "actor": "dcl；adc_integrator、cdc_integrator（配置集成 → 集成测试 → 配置发布）",
        "accounts": [
          "dcl",
          "adc_integrator",
          "cdc_integrator"
        ],
        "workspace": null,
        "page": "配置集成 → 集成候选",
        "pre": "S06 完成。",
        "steps": [
          "DCL 确认最终处理集合，域集成人员冻结子系统候选。",
          "以集成测试身份在本域集成测试车组完成仿真与实车验证。",
          "以配置发布身份发布子系统集合。"
        ],
        "done": "得到 ADC 与 CDC 的子系统发布；不产生 DCL 正式版本。",
        "fail": "子系统发布不能作为整车正式版本或量产目标。"
      },
      {
        "id": "S08",
        "title": "整车集成、集成测试、正式发布与灰度",
        "actor": "integrator、dcl、integration_tester、release",
        "accounts": [
          "integrator",
          "dcl",
          "integration_tester",
          "release"
        ],
        "workspace": null,
        "page": "配置集成；发布与配置 OTA",
        "pre": "S07 完成。",
        "steps": [
          "integrator 收集 ADC/CDC 子系统发布及底盘变更，完成整车合并。",
          "DCL 确认，冻结整车候选，integration_tester 完成整车测试。",
          "release 发布新的 DCL 正式版本并创建灰度 OTA。"
        ],
        "done": "整车正式版本包含两个子系统发布与底盘变更；子系统发布进入已纳入状态。",
        "fail": "域账号不能越权做整车正式发布。"
      },
      {
        "id": "N01",
        "title": "跨域输入被拒绝",
        "actor": "adc_integrator · 配置集成",
        "accounts": [
          "adc_integrator"
        ],
        "workspace": null,
        "page": "配置集成",
        "pre": "演示数据。",
        "steps": [
          "在 ADC 域集成中选择 CDC 组的已验证 Feature。"
        ],
        "done": "请求被拒绝，平台状态不变。",
        "fail": "—"
      },
      {
        "id": "N02",
        "title": "域账号不能整车发布或配置 OTA",
        "actor": "adc_integrator · 配置发布（本域）",
        "accounts": [
          "adc_integrator"
        ],
        "workspace": null,
        "page": "发布与配置 OTA",
        "pre": "存在整车候选与正式版本。",
        "steps": [
          "以本域配置发布身份尝试正式发布整车候选、创建配置 OTA。"
        ],
        "done": "均被拒绝。",
        "fail": "—"
      },
      {
        "id": "N03",
        "title": "子系统发布不是正式版本",
        "actor": "adc_integrator；release",
        "accounts": [
          "adc_integrator",
          "release"
        ],
        "workspace": null,
        "page": "配置集成；发布与配置 OTA",
        "pre": "已有子系统发布。",
        "steps": [
          "核对最新正式版本、下一 DCL 版本建议、量产车解析与新 Feature 基线在子系统发布后均不变。",
          "尝试把子系统候选正式发布为 DCL 版本。"
        ],
        "done": "子系统发布不改变正式版本与量产解析；正式发布被拒绝。",
        "fail": "—"
      },
      {
        "id": "N04",
        "title": "新的子系统发布包含旧的",
        "actor": "adc_integrator",
        "accounts": [
          "adc_integrator"
        ],
        "workspace": null,
        "page": "配置集成 → 子系统发布",
        "pre": "已有尚未纳入正式版本的子系统发布。",
        "steps": [
          "本域新 Feature 验证后再次做子系统集成并发布。"
        ],
        "done": "新的子系统发布包含旧发布的全部内容，旧发布被替代。",
        "fail": "—"
      }
    ]
  },
  {
    "id": "policy-sets",
    "name": "DCL 策略集与整车软件版本 · 适用性、研发车组与紧急停用",
    "start": "demo",
    "scenes": [
      {
        "id": "P01",
        "title": "登记新软件版本，自动开启适用性确认",
        "actor": "resource / 刘子衡 · 车辆资源；release / 孙立 · 配置发布",
        "accounts": [
          "resource",
          "release"
        ],
        "workspace": null,
        "page": "车辆与车辆组 → 软件版本与镜像；发布与配置 OTA → 软件版本与适用性",
        "pre": "演示数据：策略集 1.0.0 适用于 X89 1.0，量产车 VEH-201、VEH-202 都运行它。",
        "steps": [
          "PLM（模拟）发布 X89 1.2（不带 DCL 件），同步到平台；resource 为 1.2 补录软件清单（从上一版本复制）。",
          "车辆模拟器把量产车 VEH-202 刷到 1.2，车端签名上报 1.2。",
          "release 打开“软件版本与适用性”：1.2 没有适用的策略集，VEH-202 被列为阻止；适用性确认单已自动开启，候选策略集为 1.0.0，逐条检查全部可运行。"
        ],
        "done": "新软件登记即产生待办；量产车没有适用策略集时被阻止，而不是回退到研发配置。",
        "fail": "没有自动开启确认单时，检查该车型是否已有策略集、是否有整车集成测试工作区。"
      },
      {
        "id": "P02",
        "title": "在运行新软件的测试车上验证未变化的策略集",
        "actor": "dcl、integration_admin、resource 准备测试车；integration_tester / 钱思源 · 集成测试",
        "accounts": [
          "dcl",
          "integration_admin",
          "resource",
          "integration_tester"
        ],
        "workspace": "x89-integration",
        "page": "车辆与车辆组；配置集成 → 适用性测试",
        "pre": "P01 完成。",
        "steps": [
          "dcl 登记仿真镜像 x89-1.2-sim（整车版本 1.2）；integration_admin 在 X89 集成测试创建测试环境仿真车 SIM-112。",
          "resource 从 TSP 登记测试车 VEH-032，车辆刷写 1.2 后上报；integration_admin 把它加入 X89 集成测试。",
          "integration_tester 在“适用性测试”先尝试下发到 X89 集成测试车组：车辆运行 1.0，被拒绝。",
          "改为直接下发 SIM-112 与 VEH-032，在模拟器回执；先仿真后实车登记 PASS，确认验证。"
        ],
        "done": "未改变的策略集在运行新软件的车辆上通过集成测试；软件不符的车辆不能参与。",
        "fail": "实车先登记会被拒绝（需先有仿真通过）；车辆未回执不能登记结果。"
      },
      {
        "id": "P03",
        "title": "配置发布确认适用：策略集版本号不变",
        "actor": "release / 孙立 · 配置发布",
        "accounts": [
          "release"
        ],
        "workspace": "x89-project",
        "page": "发布与配置 OTA → 软件版本与适用性；策略集发布",
        "pre": "P02 完成，确认单已由集成测试确认。",
        "steps": [
          "release 在确认单上“确认适用”，填写说明。",
          "在“策略集发布”核对：策略集 1.0.0 的版本号与发布时的适用列表不变，当前适用 X89 1.0 与 1.2（1.2 为追加）。",
          "在“配置 OTA”核对：VEH-202 应运行策略集 1.0.0，已是最新，无需新的 OTA。"
        ],
        "done": "适用关系只追加记录；车辆按软件版本取到当前适用的策略集。",
        "fail": "集成测试未确认、软件没有清单或有策略缺少信号时，确认被拒绝。"
      },
      {
        "id": "P04",
        "title": "不兼容的软件：逐条检查指出不能运行的策略",
        "actor": "resource / 刘子衡；release / 孙立",
        "accounts": [
          "resource",
          "release"
        ],
        "workspace": "x89-project",
        "page": "车辆与车辆组 → 软件版本与镜像；发布与配置 OTA → 软件版本与适用性",
        "pre": "P03 完成。",
        "steps": [
          "PLM（模拟）发布 X89 1.3；resource 补录软件清单，复制后把信号 steering_angle_rate 改名为 steering_wheel_rate。",
          "release 查看自动开启的确认单：chassis.steering.angle_jump 缺少信号 steering_angle_rate。",
          "确认适用不可用：该软件需要修改后的策略集，而不是带例外地确认。"
        ],
        "done": "兼容性逐条检查，结论按整套策略集作出。",
        "fail": "不要为个别策略开例外；修改策略后发布新的策略集版本。"
      },
      {
        "id": "P05",
        "title": "新策略集版本：与上一版逐条比较",
        "actor": "steering / 吴泽宇；integrator / 赵一鸣；dcl / 林书涵；integration_tester / 钱思源；release / 孙立",
        "accounts": [
          "steering",
          "integrator",
          "dcl",
          "integration_tester",
          "release"
        ],
        "workspace": "x89-project",
        "page": "研发 Feature；配置集成；发布与配置 OTA → 策略集发布 → 与上一版比较",
        "pre": "P04 完成。",
        "steps": [
          "steering 在转向团队工作区基于策略集 1.0.0 提交新 Feature lane_drift（跑偏采集）。",
          "integrator 合并 steering_return_rate，dcl 确认处理集合，冻结候选 X89-C2；integration_tester 在 X89 集成测试车组验证。",
          "release 发布策略集 1.0.1，适用 X89 1.0。",
          "在 1.0.1 上“与上一版比较”：angle_jump 从 v1 到 v2，新增 return_rate v1。",
          "在“软件版本与适用性”核对：1.0 现在运行 1.0.1，1.2 仍运行 1.0.0。"
        ],
        "done": "策略集之间逐条可比；一个策略集适用多个软件版本，一个软件版本先后采用多个策略集。",
        "fail": "比较看到内容不符时检查候选来源；发布时适用版本须有集成测试。"
      },
      {
        "id": "P06",
        "title": "研发车组：基线跟随车辆软件，重新下发才生效",
        "actor": "resource / 刘子衡；workspace_manager / 周子墨；brake_tester / 王嘉宁",
        "accounts": [
          "resource",
          "workspace_manager",
          "brake_tester"
        ],
        "workspace": "team-brake",
        "page": "车辆与车辆组 → 车辆组；研发 Feature → 下发与测试",
        "pre": "P05 完成；制动研发车组已发布 brake_monitor。",
        "steps": [
          "workspace_manager 查看制动研发车组：SIM-021（软件 1.0）应运行显示“软件或策略集已变化，需重新下发”。",
          "VEH-001 刷到 1.2 并上报；它的基线仍是策略集 1.0.0，应运行与已生效一致。",
          "brake_tester 重新下发 brake_monitor：两辆车基线不同，平台生成两次下发；回执后各自运行自己的组合。"
        ],
        "done": "每辆车运行“自身软件当前适用的策略集 + 本组提交”；平台不会自行推送，变化提示后由团队显式下发。",
        "fail": "看到“需重新下发”时不要等待自动更新；下发后需等车辆回执。"
      },
      {
        "id": "P07",
        "title": "开关其他分组的策略",
        "actor": "brake_tester / 王嘉宁 · 业务测试",
        "accounts": [
          "brake_tester"
        ],
        "workspace": "team-brake",
        "page": "研发 Feature → 下发与测试 → 按车辆组下发；原型工具 → 车辆模拟器",
        "pre": "P06 完成。",
        "steps": [
          "brake_tester 下发时尝试关闭本组策略 chassis.brake.monitor：被拒绝，本组策略只能通过提交修改。",
          "改为关闭转向组的 chassis.steering.angle_jump 后下发，并在模拟器回执。",
          "在模拟器的采集事件中，SIM-021 不再提供 angle_jump；制动策略和转向回正策略照常。"
        ],
        "done": "开关随发布记录、进入配置标识；被关闭的策略在车上不触发。",
        "fail": "开关不进入集成合并，也不能用来打开未批准的策略。"
      },
      {
        "id": "P08",
        "title": "基线冲突与显式基线",
        "actor": "steering_tester / 吴凡；resource / 刘子衡；workspace_manager / 周子墨",
        "accounts": [
          "steering_tester",
          "resource",
          "workspace_manager"
        ],
        "workspace": "team-steering",
        "page": "研发 Feature → 下发与测试；车辆与车辆组 → 车辆组",
        "pre": "P07 完成；lane_drift 在 P05 基于策略集 1.0.0 提交。",
        "steps": [
          "steering_tester 下发 lane_drift 到转向研发车组：策略集 1.0.1 已改动 chassis.steering，下发被拒绝。",
          "VEH-003 刷到 1.3 并上报：转向研发车组上它显示“没有适用基线，保持已生效配置”。",
          "workspace_manager 为转向研发车组指定显式基线策略集 1.0.0；steering_tester 再次下发 lane_drift，两辆车都以 1.0.0 为基线运行。"
        ],
        "done": "与新基线冲突时保持已生效配置并给出原因；显式基线让团队在未确认适用的软件上继续研发测试。",
        "fail": "冲突应基于新策略集新建 Feature 解决，平台不做自动变基。"
      },
      {
        "id": "P09",
        "title": "紧急停用一条策略",
        "actor": "dcl / 林书涵 · DCL 工程申请；release / 孙立 · 配置发布批准",
        "accounts": [
          "dcl",
          "release"
        ],
        "workspace": "x89-project",
        "page": "发布与配置 OTA → 策略集发布 → 紧急停用；配置 OTA",
        "pre": "P08 完成；策略集 1.0.1 适用于 1.0。",
        "steps": [
          "dcl 在策略集 1.0.1 的 chassis.steering.return_rate 上“紧急停用”，写明原因；dcl 不能自己批准。",
          "release 批准：生成策略集 1.0.2（紧急），去掉该策略，只适用于 1.0.1 当前生效的 X89 1.0。",
          "release 新建 OTA：VEH-201 收到 1.0.2；运行 1.2 的 VEH-202 不在本次范围，继续运行 1.0.0。"
        ],
        "done": "车上始终运行平台叫得出名字的一套策略集；紧急停用由两人完成，并通过 OTA 生效。",
        "fail": "批准人不能是申请人；策略集没有在任何软件版本生效时不能紧急停用。"
      },
      {
        "id": "N01",
        "title": "撤销适用：车辆回到仍适用的上一套或被阻止",
        "actor": "release / 孙立 · 配置发布",
        "accounts": [
          "release"
        ],
        "workspace": "x89-project",
        "page": "发布与配置 OTA → 软件版本与适用性",
        "pre": "P09 完成；1.2 由策略集 1.0.0 经追加适用。",
        "steps": [
          "release 在 X89 1.2 行“撤销适用”，填写原因。",
          "核对 1.2 没有其他适用策略集：VEH-202 被列为阻止；适用记录多了一条撤销，历史保留。"
        ],
        "done": "撤销只追加记录，不改写策略集。",
        "fail": "撤销后如需恢复，重新开启适用性确认并测试。"
      }
    ]
  },
  {
    "id": "org-directory",
    "name": "公司目录与组织授权 · 基础权限与特殊权限",
    "start": "demo",
    "scenes": [
      {
        "id": "O01",
        "title": "新员工入职：按组织规则获得基础研发权限",
        "actor": "公司目录（车辆模拟器扮演）；brake_dev2 / 何晓 · 新员工",
        "accounts": [
          "admin",
          "brake_dev2"
        ],
        "workspace": "team-brake",
        "page": "原型工具 → 车辆模拟器 → 公司目录；研发 Feature",
        "pre": "演示数据：制动团队有一条组织授权规则（研发环境的业务研发，制动团队工作区 / 制动组）。",
        "steps": [
          "在公司目录为制动团队办理入职：账号 brake_dev2，姓名何晓；同步到平台。",
          "以 brake_dev2 登录：只有业务研发角色，可进入制动团队工作区创建 Feature。",
          "审计中该操作的授权标注“来自组织规则”；brake_dev2 不能测试、验证，也不能在转向团队工作区研发。"
        ],
        "done": "基础权限随组织归属自动获得，每条仍是一条完整授权；特殊权限不会因此获得。",
        "fail": "规则不覆盖测试人员所在部门；需要测试权限时由平台运维显式授予。"
      },
      {
        "id": "O02",
        "title": "调岗：基础权限随组织变化，显式授权待复核",
        "actor": "公司目录；admin / 平台管理员",
        "accounts": [
          "admin",
          "business"
        ],
        "workspace": null,
        "page": "原型工具 → 车辆模拟器 → 公司目录；账号与授权；工作台",
        "pre": "O01 完成。",
        "steps": [
          "在公司目录把陈明（business）调到转向团队并同步。",
          "平台运维在工作台看到“调岗后待复核授权”；账号页显示组织为转向团队，制动团队规则的权限已不再出现，显式授权仍在并标记待复核。",
          "平台运维“确认保留”，或改写授权。"
        ],
        "done": "组织规则的权限立即跟随调岗；显式授权由人复核，不自动删除。",
        "fail": "不要指望调岗自动收回显式授权，必须复核。"
      },
      {
        "id": "O03",
        "title": "部门改名：其他一切不变",
        "actor": "公司目录；admin",
        "accounts": [
          "admin"
        ],
        "workspace": null,
        "page": "原型工具 → 车辆模拟器 → 公司目录；组织与工作区",
        "pre": "O02 完成。",
        "steps": [
          "在公司目录把制动团队改名为“制动与线控团队”并同步。",
          "组织树中节点 brake-team 名称已变，节点 ID、工作区、业务分组代码和授权都不变；目录同步记录有一条“组织节点改名”。"
        ],
        "done": "组织调整不改业务分组代码和 data_key，也不重算授权。",
        "fail": "团队组织在平台内只读，改名要在目录中进行。"
      },
      {
        "id": "O04",
        "title": "部门合并：工作区重新挂靠",
        "actor": "公司目录；admin",
        "accounts": [
          "admin"
        ],
        "workspace": null,
        "page": "原型工具 → 车辆模拟器 → 公司目录；组织与工作区 → 工作区",
        "pre": "O03 完成。",
        "steps": [
          "在公司目录把 HMI 团队合并到 CDC 并同步：人员转入 CDC，HMI 团队节点撤销。",
          "组织与工作区中“HMI 团队工作区”和“CDC HMI 组”显示“组织节点已失效”；工作台提示重新挂靠。",
          "平台运维把 HMI 团队工作区重新挂靠到 CDC：业务分组随之迁移，代码与授权不变。"
        ],
        "done": "目录变化不会删除业务分组或工作区；失效的挂靠由人处理。",
        "fail": "重新挂靠只能选同一棵组织树中仍存在的节点。"
      },
      {
        "id": "O05",
        "title": "离职：账号停用，历史保留",
        "actor": "公司目录；steering / 吴泽宇",
        "accounts": [
          "admin",
          "steering"
        ],
        "workspace": null,
        "page": "原型工具 → 车辆模拟器 → 公司目录；登录页",
        "pre": "O04 完成。",
        "steps": [
          "在公司目录办理吴泽宇（steering）离职并同步。",
          "登录页不再列出 steering；已有提交、审计中的作者仍是 steering。",
          "本地账号（平台管理员）不受目录影响：目录中同名人员只记“跳过”。"
        ],
        "done": "离职即停用；目录永远不会改动本地账号。",
        "fail": "最后一个平台管理员不会因同步被停用。"
      },
      {
        "id": "O06",
        "title": "组织规则的边界",
        "actor": "admin / 平台管理员",
        "accounts": [
          "admin"
        ],
        "workspace": null,
        "page": "组织与工作区 → 授权规则 / 组织树",
        "pre": "O05 完成。",
        "steps": [
          "新建授权规则时选业务测试或测试环境：被拒绝，组织规则只能授予研发环境的业务研发。",
          "尝试编辑来自目录的组织节点：不可编辑，提示在目录中修改。",
          "停用制动团队的规则：其成员立即失去这条基础权限，显式授权不受影响。"
        ],
        "done": "基础权限按组，特殊权限显式到人；组织节点由目录维护。",
        "fail": "需要例外时显式授予到人，不要放宽组织规则。"
      }
    ]
  },
  {
    "id": "personal-simulation",
    "name": "个人研发仿真 · 草稿自测与团队测试分离",
    "start": "demo",
    "scenes": [
      {
        "id": "PS01",
        "title": "新建个人仿真：平台生成 UVID，软件未知",
        "actor": "business / 陈明 · 业务研发；制动团队工作区",
        "accounts": [
          "business",
          "brake_tester"
        ],
        "workspace": "team-brake",
        "page": "车辆与车辆组 → 我的研发仿真",
        "pre": "演示数据。",
        "steps": [
          "business 在“我的研发仿真”新建个人仿真：业务分组制动组，镜像 x89-dev-sim（无整车版本），名称“急刹车调试”。",
          "得到 SIM-P001：仿真、研发环境，UVID 即 SIM-P001，整车软件未知，跟随软件的基线为初始研发配置；配额显示 1/3。",
          "“工作区车辆”和“车辆组”中都没有 SIM-P001；以 brake_tester 登录，“我的研发仿真”为空，也看不到它。"
        ],
        "done": "研发自助创建个人仿真，只属于创建人。",
        "fail": "个人仿真只能用于研发环境，镜像须是本工作区车型的。"
      },
      {
        "id": "PS02",
        "title": "把草稿配置到个人仿真，试触发并记录自测",
        "actor": "business / 陈明 · 业务研发；车辆模拟器扮演仿真器",
        "accounts": [
          "business"
        ],
        "workspace": "team-brake",
        "page": "研发 Feature；车辆与车辆组 → 我的研发仿真；原型工具 → 车辆模拟器",
        "pre": "PS01 完成。",
        "steps": [
          "在 brake_monitor 的“采集策略”把“急刹车”的触发条件改为 brake_pressure > 90 AND vehicle_deceleration > 6，不提交。",
          "打开 SIM-P001，选择 brake_monitor、基线“跟随软件版本”，配置草稿：显示等待回执，回执前仍没有生效配置。",
          "在车辆模拟器为 SIM-P001 发送“回执：应用成功”；再选 SIM-P001 与 chassis.brake.monitor，点“试触发（个人，仅本人可见）”。",
          "回到 SIM-P001：正在运行“initial / chassis.brake / brake_monitor / 草稿”，两条制动策略标“草稿”；试触发列出制动监测日志；采集事件列表没有新增。",
          "记录个人自测 PASS，说明“急刹车场景回放，触发正确”。"
        ],
        "done": "brake_monitor 的“下发与测试”出现个人自测（不计入验证），标注与当前草稿一致；没有团队测试记录。",
        "fail": "回执失败时保留原配置；没有生效的草稿不能记录自测。"
      },
      {
        "id": "PS03",
        "title": "个人仿真只属于本人，不进入团队资源",
        "actor": "brake_tester / 王嘉宁；workspace_manager / 工作区管理员",
        "accounts": [
          "brake_tester",
          "workspace_manager"
        ],
        "workspace": "team-brake",
        "page": "车辆与车辆组；原型工具 → 车辆模拟器",
        "pre": "PS02 完成。",
        "steps": [
          "brake_tester 停止或释放 SIM-P001：被拒绝，个人仿真只能由创建人本人操作（页面不提供入口，由引擎回放核对）。",
          "workspace_manager 把 SIM-P001 加入工作区车辆或“制动研发车组”：被拒绝；选择框中也不出现个人仿真。",
          "车辆模拟器对 SIM-P001 只提供试触发，不能触发采集事件。"
        ],
        "done": "个人仿真不进入工作区车辆、车辆组或团队测试；工作区管理员也不能操作它。",
        "fail": "需要共享资源时，由工作区管理员登记团队仿真并归入车辆组。"
      },
      {
        "id": "PS04",
        "title": "敏感文件仍须 DCL 审核",
        "actor": "business / 陈明 · 业务研发",
        "accounts": [
          "business"
        ],
        "workspace": "team-brake",
        "page": "研发 Feature；车辆与车辆组 → 我的研发仿真",
        "pre": "PS03 完成。",
        "steps": [
          "在 brake_monitor 草稿新增文件：ADC /data/camera/brake brake_*.mp4（视频，需敏感审核），让“急刹车”也采集它。",
          "对 SIM-P001 配置草稿：被拒绝，提示敏感文件须先通过 DCL 审核，个人仿真也不能采集。",
          "从“急刹车”去掉该文件并删除文件，草稿回到 PS02 的内容。"
        ],
        "done": "个人仿真不能绕过敏感数据审核。",
        "fail": "确需采集时先提交，由 DCL 在接入队列审核。"
      },
      {
        "id": "PS05",
        "title": "软件 1.0 的个人仿真：策略集为基线，关闭其他分组策略",
        "actor": "business / 陈明 · 业务研发",
        "accounts": [
          "business"
        ],
        "workspace": "team-brake",
        "page": "车辆与车辆组 → 我的研发仿真；原型工具 → 车辆模拟器",
        "pre": "PS04 完成。",
        "steps": [
          "新建个人仿真，镜像 x89-1.0-sim，名称“1.0 回归”：跟随软件的基线为策略集 1.0.0。",
          "配置 brake_monitor 草稿，关闭 chassis.steering.angle_jump（选择框只列出其他分组的策略）；车辆模拟器回执成功。",
          "“正在运行”中转向策略标“已关闭（下发时关闭）”，制动策略为“草稿”。"
        ],
        "done": "草稿替换本组提交，其他分组按软件版本的策略集运行；开关只能关闭其他分组的策略。",
        "fail": "软件没有适用策略集时，选择显式基线。"
      },
      {
        "id": "PS06",
        "title": "提交时显示自测，团队测试照常",
        "actor": "business / 陈明；brake_tester / 王嘉宁",
        "accounts": [
          "business",
          "brake_tester"
        ],
        "workspace": "team-brake",
        "page": "研发 Feature → 下发与测试",
        "pre": "PS05 完成。",
        "steps": [
          "business 提交 brake_monitor：对话框提示这份草稿在个人仿真上自测 PASS（仅供参考）；生成 r002。",
          "个人自测标注“与提交一致 r002”。",
          "brake_tester 把 r002 下发到“制动研发车组”并回执：验证目标只有 SIM-021 与 VEH-001，个人仿真不是验证目标，自测不能代替团队测试。",
          "business 再改草稿（急刹车阈值 85）：个人自测改标“草稿已变化”。"
        ],
        "done": "个人自测只作参考，不卡提交；团队验证仍按车辆组进行。",
        "fail": "不能把个人自测当作业务测试结果登记。"
      },
      {
        "id": "PS07",
        "title": "配额与释放",
        "actor": "business / 陈明 · 业务研发",
        "accounts": [
          "business"
        ],
        "workspace": "team-brake",
        "page": "车辆与车辆组 → 我的研发仿真",
        "pre": "PS06 完成。",
        "steps": [
          "再新建一个个人仿真（x89-1.1-sim），达到 3/3；“新建个人仿真”不可用。",
          "对 SIM-P001 配置当前草稿：等待回执时“释放”不可用；撤回后释放。",
          "打开“显示已释放”：SIM-P001 为已释放，打开后配置、试触发与自测历史仍在；配额回到 2/3。"
        ],
        "done": "每人每工作区最多 3 个，释放即归还配额，历史保留。",
        "fail": "等待回执的实例先撤回或等回执，再释放。"
      },
      {
        "id": "PS08",
        "title": "测试人员也可以有自己的个人仿真",
        "actor": "brake_tester / 王嘉宁 · 业务测试",
        "accounts": [
          "brake_tester"
        ],
        "workspace": "team-brake",
        "page": "车辆与车辆组 → 我的研发仿真",
        "pre": "PS07 完成。",
        "steps": [
          "brake_tester 新建个人仿真（x89-dev-sim，名称“测试自查”），配置 brake_monitor 草稿（只读，不能编辑），车辆模拟器回执成功。",
          "记录个人自测 FAIL，说明“低速急刹未触发”。",
          "brake_monitor 的个人自测列表出现这一条；它不是验证目标，也不改变 Feature。"
        ],
        "done": "测试人员可以自查草稿，但个人仿真不能用于团队测试。",
        "fail": "测试身份仍不能编辑文件和策略。"
      },
      {
        "id": "PS09",
        "title": "离职：个人仿真自动释放",
        "actor": "公司目录（车辆模拟器扮演）；brake_dev2 / 何晓 · 新员工",
        "accounts": [
          "admin",
          "brake_dev2"
        ],
        "workspace": "team-brake",
        "page": "原型工具 → 车辆模拟器 → 公司目录；车辆与车辆组 → 我的研发仿真",
        "pre": "PS08 完成。",
        "steps": [
          "在公司目录为制动团队办理入职 brake_dev2（何晓）并同步；brake_dev2 按组织规则获得研发权限。",
          "brake_dev2 新建个人仿真并配置 brake_monitor 草稿，不发回执。",
          "在公司目录办理 brake_dev2 离职并同步：账号停用；目录同步记录“释放个人仿真”；待回执的配置被撤回，实例为已释放（vehicle resources 在车辆台账可见），历史保留。"
        ],
        "done": "人员离开时，平台收回其个人仿真。",
        "fail": "停用账号（离职或运维停用）都会释放个人仿真。"
      },
      {
        "id": "N01",
        "title": "不允许的个人仿真",
        "actor": "business；workspace_manager",
        "accounts": [
          "business",
          "workspace_manager",
          "dcl"
        ],
        "workspace": "team-brake",
        "page": "车辆与车辆组 → 我的研发仿真",
        "pre": "演示数据。",
        "steps": [
          "以生产环境创建个人仿真：被拒绝，个人仿真只能用于研发环境（页面不提供环境选择，由引擎回放核对）。",
          "DCL 登记 X90 的镜像后，用它在 X89 工作区创建个人仿真：被拒绝，镜像属于其他车型（页面只列出本车型镜像）。",
          "workspace_manager（没有业务研发或业务测试授权）创建个人仿真：被拒绝。"
        ],
        "done": "个人仿真只给有研发或测试授权的人，在研发环境、本车型镜像上使用。",
        "fail": "共享仿真由工作区管理员按团队资源流程登记。"
      }
    ]
  },
  {
    "id": "sim-software",
    "name": "仿真车软件 · 模块构建、部署与回滚",
    "start": "demo",
    "scenes": [
      {
        "id": "SW01",
        "title": "个人仿真运行草稿并自测",
        "actor": "business / 陈明 · 业务研发；制动团队工作区",
        "accounts": [
          "business"
        ],
        "workspace": "team-brake",
        "page": "车辆与车辆组 → 我的研发仿真；原型工具 → 车辆模拟器",
        "pre": "演示数据。",
        "steps": [
          "新建个人仿真：制动组，镜像 x89-1.0-sim，名称“制动模块调试”；整车软件 1.0，基线策略集 1.0.0。",
          "配置 brake_monitor 草稿，车辆模拟器回执成功；记录个人自测 PASS，说明“原镜像上急刹车触发正确”。"
        ],
        "done": "个人仿真运行草稿，已有一条在原镜像上的自测。",
        "fail": "回执失败时保留原配置。"
      },
      {
        "id": "SW02",
        "title": "构建制动模块：生成派生镜像，运行镜像不变",
        "actor": "business / 陈明；车辆模拟器扮演构建服务",
        "accounts": [
          "business"
        ],
        "workspace": "team-brake",
        "page": "我的研发仿真 → 运行镜像；原型工具 → 车辆模拟器",
        "pre": "SW01 完成。",
        "steps": [
          "在“运行镜像”选择制动模块，仓库 https://github.com/example/brake，源码版本 main，“构建模块”：构建显示待构建。该地址为剧本占位，不表示访问了真实仓库。",
          "在车辆模拟器“仿真软件：构建与部署”点“构建成功”：生成派生镜像 dev-x89-1.0-sim-brake-1，源码固定为 mock-commit。",
          "回到个人仿真：运行镜像仍是 x89-1.0-sim，草稿配置仍生效。"
        ],
        "done": "构建只生成派生镜像，不改变仿真正在运行的镜像和配置。",
        "fail": "构建失败时运行镜像不变，可重新构建。"
      },
      {
        "id": "SW03",
        "title": "部署派生镜像：失败保留原状，成功后配置需重新下发",
        "actor": "business / 陈明；车辆模拟器扮演仿真服务",
        "accounts": [
          "business"
        ],
        "workspace": "team-brake",
        "page": "我的研发仿真 → 运行镜像；原型工具 → 车辆模拟器",
        "pre": "SW02 完成。",
        "steps": [
          "实例运行时“部署”不可用（引擎拒绝：先停止实例）；停止实例后部署，在模拟器点“部署失败”：仍运行 x89-1.0-sim，草稿配置仍生效。",
          "再次部署，在模拟器点“部署成功”：运行 dev-x89-1.0-sim-brake-1（派生镜像），来源整车版本仍为 1.0；已生效配置清空。",
          "个人自测列表中原镜像上的自测标“镜像已变化”。"
        ],
        "done": "镜像只在仿真服务确认后改变；新镜像上 DCL 客户端从空开始。",
        "fail": "失败的部署不影响原镜像和原配置。"
      },
      {
        "id": "SW04",
        "title": "在新镜像上重新下发并自测",
        "actor": "business / 陈明",
        "accounts": [
          "business"
        ],
        "workspace": "team-brake",
        "page": "我的研发仿真；原型工具 → 车辆模拟器",
        "pre": "SW03 完成。",
        "steps": [
          "启动实例，重新配置 brake_monitor 草稿，模拟器回执成功。",
          "记录个人自测 PASS，说明“新制动模块上急刹车触发正确”：这条自测的镜像为派生镜像。"
        ],
        "done": "原镜像上的自测只作历史，不代表新软件验证通过。",
        "fail": "没有生效的草稿不能记录自测。"
      },
      {
        "id": "SW05",
        "title": "回滚镜像，只能回滚一次",
        "actor": "business / 陈明；车辆模拟器扮演仿真服务",
        "accounts": [
          "business"
        ],
        "workspace": "team-brake",
        "page": "我的研发仿真 → 运行镜像；原型工具 → 车辆模拟器",
        "pre": "SW04 完成。",
        "steps": [
          "停止实例，点“回滚到 x89-1.0-sim”，在模拟器点“部署成功”：恢复之前的镜像，已生效配置清空。",
          "回滚按钮不再出现（引擎拒绝再次回滚）。"
        ],
        "done": "回滚恢复之前的镜像并保留历史。",
        "fail": "重复回滚被拒绝；需要时重新构建并部署。"
      },
      {
        "id": "SW06",
        "title": "不合法的构建请求",
        "actor": "business / 陈明；brake_tester",
        "accounts": [
          "business",
          "brake_tester"
        ],
        "workspace": "team-brake",
        "page": "我的研发仿真 → 运行镜像",
        "pre": "SW05 完成。",
        "steps": [
          "仓库填 file:///etc/passwd、https://evil.test/repo 或带 ?token= 的地址：被拒绝，只接受 GitHub 仓库地址。",
          "模块 shell 不在已接入模块中（页面只列出四个模块，由引擎回放核对）。",
          "请求一个构建后再请求：被拒绝，先部署或取消；“取消”后构建为已取消。brake_tester 不能为陈明的个人仿真构建（引擎回放）。"
        ],
        "done": "不下载源码、不执行命令，只接受已接入模块与合法仓库。",
        "fail": "共享仿真的构建由工作区管理员进行。"
      },
      {
        "id": "SW07",
        "title": "共享仿真：工作区管理员切换基础镜像",
        "actor": "workspace_manager / 工作区管理员；business",
        "accounts": [
          "workspace_manager",
          "business"
        ],
        "workspace": "team-brake",
        "page": "车辆与车辆组 → 工作区车辆 → 运行镜像；原型工具 → 车辆模拟器",
        "pre": "SW06 完成。",
        "steps": [
          "business 不能更改 SIM-021 的镜像（页面不提供入口，由引擎回放核对）。",
          "workspace_manager 在“工作区车辆”停止 SIM-021，打开“运行镜像”，切换到 x89-1.1-sim，模拟器“部署成功”：软件 1.1，已生效配置清空。",
          "“车辆组”中 SIM-021 应运行“没有适用基线，保持已生效配置”（演示数据中没有适用 1.1 的策略集）；brake_monitor 仍为已验证。",
          "回滚到 x89-1.0-sim，模拟器“部署成功”，启动实例：车辆组发布内容重新适用。"
        ],
        "done": "共享仿真的软件由工作区管理员维护；基线跟随软件版本，下发仍需显式进行。",
        "fail": "没有适用策略集时，为车辆组指定显式基线或先确认适用性。"
      },
      {
        "id": "SW08",
        "title": "镜像变化后，旧测试结果不再计入",
        "actor": "business、brake_tester、workspace_manager",
        "accounts": [
          "business",
          "brake_tester",
          "workspace_manager"
        ],
        "workspace": "team-brake",
        "page": "研发 Feature → 下发与测试；工作区车辆 → 运行镜像；原型工具 → 车辆模拟器",
        "pre": "SW07 完成。",
        "steps": [
          "business 把 brake_monitor 的急刹车阈值改为 85 并提交 r002；brake_tester 按车辆组下发并回执，在 SIM-021 登记 PASS。",
          "workspace_manager 为 SIM-021 构建感知模块（https://github.com/example/perception，release-2），构建成功后停止实例、部署，部署成功后启动。",
          "“下发与测试”中 SIM-021 显示“镜像已变化，需重新测试”；VEH-001 实车登记 PASS 被拒绝（须先有仿真通过）。",
          "brake_tester 重新下发并回执，SIM-021 与 VEH-001 先仿真后实车 PASS，确认 Verified。"
        ],
        "done": "测试结果绑定运行的镜像；镜像变化后旧结果保留为历史，不再计入。已验证的 Feature 不会因此退回。",
        "fail": "不要用旧镜像上的结果确认 Verified。"
      },
      {
        "id": "N01",
        "title": "派生镜像不进入集成测试与镜像目录",
        "actor": "integration_admin、integration_tester；business、workspace_manager",
        "accounts": [
          "integration_admin",
          "integration_tester",
          "business",
          "workspace_manager"
        ],
        "workspace": "x89-integration",
        "page": "工作区车辆 → 运行镜像",
        "pre": "演示数据。",
        "steps": [
          "integration_admin 为测试环境仿真 SIM-101 构建模块：被拒绝，派生镜像只用于研发环境（页面显示“测试环境仿真只使用平台镜像”）。",
          "integration_tester 不能更改仿真镜像（页面不提供入口，由引擎回放核对）。",
          "个人仿真构建出的派生镜像不出现在创建仿真或切换镜像的镜像列表中；按 ID 使用被拒绝（引擎回放）。"
        ],
        "done": "集成和适用性测试只用平台正式镜像。",
        "fail": "需要测试新软件时，由车辆资源登记正式镜像。"
      }
    ]
  },
  {
    "id": "software-change",
    "name": "整车软件版本变化 · 通知、两层检查与四种处理",
    "start": "demo",
    "scenes": [
      {
        "id": "VC01",
        "title": "前置：策略集 1.0.0 确认适用于 X89 1.1",
        "actor": "release、integration_admin、resource、integration_tester",
        "accounts": [
          "release",
          "integration_admin",
          "resource",
          "integration_tester"
        ],
        "workspace": "x89-integration",
        "page": "发布与配置 OTA → 软件版本与适用性；工作区车辆 → 运行镜像；车辆台账；配置集成 → 适用性测试",
        "pre": "演示数据。",
        "steps": [
          "release 为 X89 1.1 开启适用性确认（策略集 1.0.0）。",
          "integration_admin 停止 SIM-101，“运行镜像”切换到 x89-1.1-sim，模拟器“部署成功”后启动；车辆模拟器把 VEH-031 刷到 1.1，车端上报。",
          "integration_tester 向 X89 集成测试车组下发适用性测试，回执后先仿真后实车登记 PASS，确认验证；release 确认适用。"
        ],
        "done": "策略集 1.0.0 同时适用 1.0 与 1.1，版本号不变。",
        "fail": "运行 1.0 的车辆不能用于 1.1 的适用性测试。"
      },
      {
        "id": "VC02",
        "title": "A：同一策略集、全部可运行——确认即可",
        "actor": "车辆模拟器；business / 陈明",
        "accounts": [
          "business"
        ],
        "workspace": "team-brake",
        "page": "原型工具 → 车辆模拟器；工作台；研发 Feature → 下发与测试",
        "pre": "VC01 完成。",
        "steps": [
          "在车辆模拟器对 VEH-001“更多 → 模拟整车软件 OTA…”刷写 1.1，再“上报”：平台从签名上报中得知 VEH-001 运行 1.1。",
          "business 工作台出现“车辆软件已变化 VEH-001 1.0 → 1.1 · 无需修改”；打开：基线 策略集 1.0.0 → 策略集 1.0.0，文件与策略都可用。点“确认”。",
          "brake_monitor 仍为已验证；VEH-001 的测试结果标注“在 1.0 上测试，车辆现为 1.1”并继续计入。"
        ],
        "done": "版本变了但策略集与本组内容都没变：不建分支、不重新下发。",
        "fail": "需要修改时不要只点确认。"
      },
      {
        "id": "VC03",
        "title": "未登记的版本，以及新软件没有适用的策略集",
        "actor": "车辆模拟器；resource / 车辆资源；business",
        "accounts": [
          "resource",
          "business"
        ],
        "workspace": "team-brake",
        "page": "原型工具 → 车辆模拟器；工作台；车辆与车辆组 → 软件版本与镜像、车辆台账",
        "pre": "VC02 完成。",
        "steps": [
          "把 VEH-001 刷写为 1.3 并上报：平台仍记录 1.1；resource 工作台出现“上报了 PLM 未发布的软件版本 VEH-001 · 1.3”。",
          "PLM（模拟）发布 X89 1.3，resource 补录软件清单：从上一版本复制，把 ADC:/var/log 改为 ADC:/var/log/chassis。同步后，VEH-001 之前的上报立即生效，记为 1.3。",
          "business 打开 VEH-001 的变化：“新软件没有适用的策略集”；文件“制动监测日志 · 来源缺失”；两条制动策略“有问题 · 文件有问题：制动监测日志”。"
        ],
        "done": "平台不认未登记的版本；登记后才更新车辆并检查。",
        "fail": "没有适用策略集时，车辆保持已生效配置。"
      },
      {
        "id": "VC04",
        "title": "B：同一基线，本组文件与策略需要修改",
        "actor": "workspace_manager；business；brake_tester",
        "accounts": [
          "workspace_manager",
          "business",
          "brake_tester"
        ],
        "workspace": "team-brake",
        "page": "车辆与车辆组 → 车辆组；研发 Feature；原型工具 → 车辆模拟器",
        "pre": "VC03 完成。",
        "steps": [
          "workspace_manager 把制动研发车组设为显式基线 策略集 1.0.0：VEH-001 的变化变为“需修改本组文件或策略”。",
          "business 在 brake_monitor 新增文件 ADC /var/log/chassis/brake monitor.log（制动监测日志（新路径）），两条策略改为采集它，移除旧文件，提交 r002。",
          "brake_tester 按车辆组下发 r002，模拟器回执：变化重新检查为“无需修改”；business 点“确认”。"
        ],
        "done": "先改文件、再改依赖它的策略；同一基线不需要新分支。",
        "fail": "只改策略不改文件，文件来源仍然缺失。"
      },
      {
        "id": "VC05",
        "title": "C：新软件对应另一个策略集，本组内容未变——重新下发",
        "actor": "dcl、release；workspace_manager；车辆模拟器；brake_tester",
        "accounts": [
          "dcl",
          "release",
          "workspace_manager",
          "brake_tester"
        ],
        "workspace": "team-brake",
        "page": "发布与配置 OTA；车辆组；原型工具 → 车辆模拟器；研发 Feature → 下发与测试",
        "pre": "VC04 完成。",
        "steps": [
          "dcl 对策略集 1.0.0 的 chassis.steering.angle_jump 申请紧急停用，release 批准：策略集 1.0.1 适用 1.0 与 1.1。",
          "workspace_manager 把制动研发车组改回“跟随每辆车的软件版本”；VEH-001 刷写回 1.1 并上报。",
          "变化显示“基线已变化，需重新下发”：策略集 1.0.0 → 1.0.1，有变化的分组 chassis.steering；制动文件与策略都可用。brake_tester 重新下发 r002，回执后检查为“无需修改”，确认。"
        ],
        "done": "基线变化但未改本组：重新下发同一提交即可。",
        "fail": "车辆运行的组合变了，需要重新测试。"
      },
      {
        "id": "VC06",
        "title": "D：新基线改了本组内容——在新基线上新建 Feature",
        "actor": "车辆模拟器；steering / 吴泽宇",
        "accounts": [
          "steering"
        ],
        "workspace": "team-steering",
        "page": "原型工具 → 车辆模拟器；工作台；研发 Feature",
        "pre": "VC05 完成。",
        "steps": [
          "VEH-003（转向研发车组，运行 steering_return_rate）刷写为 1.1 并上报。",
          "steering 工作台出现变化：“基线改了本组内容，需在新基线上新建 Feature”；抽屉列出本 Feature 相对基线的修改。",
          "点“在新基线上新建 Feature”，名称 steering_return_rate_v2：新 Feature 基线为策略集 1.0.1，草稿中没有已停用的 angle_jump。确认这次变化。"
        ],
        "done": "新分支跟着策略集走：只有新基线改了本组内容时才新建 Feature。",
        "fail": "平台不自动建分支或下发，由团队决定。"
      },
      {
        "id": "N01",
        "title": "谁会收到、谁不会",
        "actor": "steering；release；车辆模拟器",
        "accounts": [
          "steering",
          "release"
        ],
        "workspace": null,
        "page": "工作台",
        "pre": "VC06 完成。",
        "steps": [
          "steering 不能确认制动车辆的变化（页面不出现，由引擎回放核对）。",
          "量产车 VEH-201 刷写为 1.1 并上报：记录变化，但没有团队待办；量产按适用策略集与适用性确认处理。",
          "仿真不能“模拟整车软件 OTA”：仿真的软件由运行镜像决定（菜单中不出现，由引擎回放核对）。"
        ],
        "done": "只通知往该车辆组发布的团队。",
        "fail": "仿真换软件请使用“运行镜像”。"
      }
    ]
  },
  {
    "id": "notifications",
    "name": "通知中心 · 授权投影、已读与失效",
    "start": "demo",
    "scenes": [
      {
        "id": "NC01",
        "title": "通知只来自授权工作区与本组",
        "actor": "business、steering、brake_tester",
        "accounts": [
          "business",
          "steering",
          "brake_tester"
        ],
        "workspace": "team-brake",
        "page": "顶栏 → 通知中心",
        "pre": "演示数据。",
        "steps": [
          "以 business 登录（制动团队工作区）：顶栏铃铛显示未读 3；展开只有制动的事项：guided_brake · DCL Ready、brake_monitor · 已验证、chassis.steering 申请引用本组文件。",
          "以 steering 登录（转向团队工作区）：只有 steering_return_rate · 已验证，看不到制动组的事项。",
          "以 brake_tester 登录：只有“guided_brake 可下发验证”。"
        ],
        "done": "每个账号只看到本工作区、本组授权范围内的当前事项。",
        "fail": "没有事项时显示“当前没有事项”，不生成虚构通知。"
      },
      {
        "id": "NC02",
        "title": "状态变化产生新的提醒",
        "actor": "brake_tester；business",
        "accounts": [
          "brake_tester",
          "business"
        ],
        "workspace": "team-brake",
        "page": "研发 Feature → 下发与测试；通知中心",
        "pre": "NC01 完成。",
        "steps": [
          "brake_tester 把 guided_brake 按车辆组下发到制动研发车组，模拟器回执。",
          "business 的通知中心：原“guided_brake · DCL Ready”消失，出现未读的“guided_brake · 测试中”。"
        ],
        "done": "事项标识包含对象与状态：状态一变，就是一条新的未读提醒。",
        "fail": "通知不是历史记录；过去的状态在 Feature 历史中追溯。"
      },
      {
        "id": "NC03",
        "title": "单条已读：按账号和工作区隔离，不改变任何事务",
        "actor": "business；brake_tester",
        "accounts": [
          "business",
          "brake_tester"
        ],
        "workspace": "team-brake",
        "page": "通知中心",
        "pre": "NC02 完成。",
        "steps": [
          "business 在“chassis.steering 申请引用本组文件”上点“标记已读”：未读数减一；刷新页面后仍为已读。",
          "以 brake_tester 登录：其未读数不变。",
          "引用申请仍待本组决定；guided_brake 阶段不变。"
        ],
        "done": "已读只是本账号在本工作区的标记。",
        "fail": "已读不等于已处理，仍需到对应页面完成事务。"
      },
      {
        "id": "NC04",
        "title": "全部已读与未读筛选",
        "actor": "business",
        "accounts": [
          "business"
        ],
        "workspace": "team-brake",
        "page": "通知中心 → 查看全部",
        "pre": "NC03 完成。",
        "steps": [
          "展开铃铛点“全部已读”：未读数为 0。",
          "“查看全部”进入通知中心页面：“未读”筛选显示“没有未读事项”；“全部”仍列出各项并标注已读。"
        ],
        "done": "全部已读与筛选只改变本账号的标记。",
        "fail": "类别筛选只影响显示。"
      },
      {
        "id": "NC05",
        "title": "警告类事项排在前面",
        "actor": "dcl；adc_parking；workspace_manager；brake_tester",
        "accounts": [
          "dcl",
          "adc_parking",
          "workspace_manager",
          "brake_tester"
        ],
        "workspace": null,
        "page": "DCL 接入队列；通知中心；研发 Feature → 下发与测试",
        "pre": "NC04 完成。",
        "steps": [
          "dcl 退回 parking_camera，原因“视频分辨率说明不完整”：adc_parking 通知中心第一条为“parking_camera 需要修改”及原因。",
          "workspace_manager 把制动研发车组设为需审批；brake_tester 为 guided_brake 申请团队测试：workspace_manager 收到“guided_brake 的团队测试申请待审批”（警告），点击打开车辆组页面。"
        ],
        "done": "需要动作的事项以警告排在前面，点击直达对象。",
        "fail": "只有能处理的人收到对应事项。"
      },
      {
        "id": "NC06",
        "title": "失效通知不能打开",
        "actor": "workspace_manager；brake_tester",
        "accounts": [
          "workspace_manager",
          "brake_tester"
        ],
        "workspace": "team-brake",
        "page": "通知中心；车辆与车辆组",
        "pre": "NC05 完成。",
        "steps": [
          "workspace_manager 批准该申请：待审批事项随即消失，其他标签页的通知列表也同步更新。点击时会重新计算可见事项，已失效的通知提示“该通知已失效：状态已变化或已无权限，不能打开”而不跳转（由引擎回放核对）。",
          "brake_tester 收到“guided_brake 的团队测试申请已批准”。"
        ],
        "done": "点击时重新计算可见事项，过期或无权的通知不能跳转。",
        "fail": "按通知操作前以对象页面的当前状态为准。"
      }
    ]
  },
  {
    "id": "borrowing",
    "name": "借用车辆 · 下发与推送、更新整车版本",
    "start": "demo",
    "scenes": [
      {
        "id": "BR01",
        "title": "借用目录只给选车需要的信息",
        "actor": "workspace_manager",
        "accounts": [
          "workspace_manager"
        ],
        "workspace": "team-brake",
        "page": "车辆与车辆组 → 借用 → 借用车辆",
        "pre": "演示数据。",
        "steps": [
          "以 workspace_manager 登录（制动团队工作区），在“借用”点“借用车辆”。",
          "目录列出 VEH-004：实车 · 研发 · ADC · 整车软件未知 · 可用 · 使用方“系统应用团队工作区”。",
          "没有量产车，也没有本工作区已有的车辆；目录不显示车上配置、客户端上报或测试结果。"
        ],
        "done": "选车所需的信息可见，其他分组的数据在批准前不可见。",
        "fail": "本资源池且无人使用的车辆标注“可直接加入”，不需要借用。"
      },
      {
        "id": "BR02",
        "title": "申请借用：写明车辆组和最后一天",
        "actor": "workspace_manager；business；resource",
        "accounts": [
          "workspace_manager",
          "business",
          "resource"
        ],
        "workspace": "team-brake",
        "page": "借用 → 借用目录 → 申请借用",
        "pre": "BR01 完成。",
        "steps": [
          "对 VEH-004 点“申请借用”：加入“制动研发车组”，最后一天为 7 天后，用途“AEB 联合制动验证”。",
          "最后一天选今天会被拒绝：“归还日期须晚于今天…”。business 没有借用权限。",
          "借入表显示“待使用方同意 · 系统应用团队工作区 · 待同意”；车辆资源此时不能批准（“须先由正在使用该车的工作区同意”）。"
        ],
        "done": "申请记录车辆组、最后一天、用途和需要同意的使用方。",
        "fail": "申请不改变车辆、车辆组或任何配置。"
      },
      {
        "id": "BR03",
        "title": "使用方工作区先同意",
        "actor": "adc_integrator；resource",
        "accounts": [
          "adc_integrator",
          "resource"
        ],
        "workspace": "team-adc-system",
        "page": "借用 → 借出",
        "pre": "BR02 完成。",
        "steps": [
          "以 adc_integrator 登录（系统应用团队工作区）：通知中心有“制动团队工作区申请借用 VEH-004”。",
          "在“借出”对 VEH-004 点“同意”：状态变为“待车辆资源批准”。",
          "resource 的通知与工作台出现“VEH-004 借用待审批”。"
        ],
        "done": "使用方同意后才交给车辆资源。",
        "fail": "不同意须写原因，申请随即结束。"
      },
      {
        "id": "BR04",
        "title": "车辆资源批准：车辆换组",
        "actor": "resource；workspace_manager；adc_integrator",
        "accounts": [
          "resource",
          "workspace_manager",
          "adc_integrator"
        ],
        "workspace": null,
        "page": "借用 → 借用审批；车辆与车辆组",
        "pre": "BR03 完成。",
        "steps": [
          "resource 在“借用审批 → 待审批”看到检查“可以借出”，点“批准”。",
          "VEH-004 离开“系统应用研发车组”（组审计：借出至 制动团队工作区），加入“制动研发车组”（借用：AEB 联合制动验证）。",
          "制动团队的车辆列表标注“借用 · 至 …”；系统应用团队的列表标注“借出至 制动团队工作区 · 至 …”。"
        ],
        "done": "归属、资源池和环境不变，只有使用方和车辆组变化。",
        "fail": "车辆有待回执、仿真运行中或被预约时不能批准。"
      },
      {
        "id": "BR05",
        "title": "车辆上报：与车辆组的发布不匹配",
        "actor": "车辆模拟器；business",
        "accounts": [
          "business"
        ],
        "workspace": "team-brake",
        "page": "车辆模拟器 → 车端 Agent；车辆与车辆组 → 车辆组",
        "pre": "BR04 完成。",
        "steps": [
          "在车辆模拟器对 VEH-004 点“上报”。",
          "以 business 登录：VEH-004 在制动研发车组中标注“与车辆组不匹配 · 整车软件版本未知，无法检查”，没有推送任何配置；通知中心有同一提醒。",
          "打开它：两种做法——确认并下发（使用初始研发配置），或更新整车版本。"
        ],
        "done": "平台不自行下发不匹配的配置，由团队选择。",
        "fail": "匹配的车辆在上报后直接推送车辆组的配置。"
      },
      {
        "id": "BR06",
        "title": "不改策略，更新车辆的整车版本",
        "actor": "business；车辆模拟器",
        "accounts": [
          "business"
        ],
        "workspace": "team-brake",
        "page": "与车辆组不匹配 → 更新整车版本；车辆模拟器 → 整车 OTA 系统",
        "pre": "BR05 完成。",
        "steps": [
          "点“更新整车版本”，选择 X89 1.0：预览“无需修改”；原因“与车组一致”，提交给整车 OTA。",
          "在车辆模拟器“整车 OTA 系统”点“更新成功”：车辆重启并上报 1.0。",
          "云端推送车辆组的配置（brake_monitor r001，标注“随车辆组推送”，已推送·待回执）；回执后 VEH-004 运行它。"
        ],
        "done": "策略不变；车辆刷到合适的版本后自动推送已下发给车辆组的配置。",
        "fail": "平台只从车辆上报得知新版本；整车 OTA 失败时车辆保持原版本。"
      },
      {
        "id": "BR07",
        "title": "下发与推送是两个状态",
        "actor": "车辆模拟器；brake_tester",
        "accounts": [
          "brake_tester"
        ],
        "workspace": "team-brake",
        "page": "研发 Feature → 下发与测试；车辆模拟器",
        "pre": "BR06 完成。",
        "steps": [
          "在车辆模拟器让 VEH-004 离线。",
          "brake_tester 把 guided_brake 按车辆组下发到制动研发车组：三辆车都是“已下发·待推送”。",
          "执行一步：SIM-021 与 VEH-001 变为“已推送·待回执”，VEH-004 仍“已下发·待推送”；恢复在线再执行一步后才推送；回执后生效。"
        ],
        "done": "下发只设置云端配置；车辆上线时才推送，回执后才生效。",
        "fail": "离线车辆不会被当成已收到。"
      },
      {
        "id": "BR08",
        "title": "借用到期：不能再下发，延期后恢复",
        "actor": "车辆模拟器；workspace_manager；resource；brake_tester",
        "accounts": [
          "workspace_manager",
          "resource",
          "brake_tester"
        ],
        "workspace": "team-brake",
        "page": "车辆模拟器 → 模拟时间；借用；研发 Feature → 下发与测试",
        "pre": "BR07 完成。",
        "steps": [
          "在车辆模拟器“模拟时间”推进 7 天，再推进 1 天：借用已到期，workspace_manager 与 resource 都收到警告。",
          "brake_tester 再次下发 guided_brake：被拒绝，“VEH-004：借用已于 … 到期，请延期或归还”。",
          "workspace_manager 申请延期 7 天，resource 批准；再次下发成功，回执后生效。"
        ],
        "done": "到期只阻止新的下发，平台不会自行收回。",
        "fail": "延期须由车辆资源批准；车辆资源也可以收回。"
      },
      {
        "id": "BR09",
        "title": "归还：软件保留，借出方收到提醒",
        "actor": "workspace_manager；adc_integrator",
        "accounts": [
          "workspace_manager",
          "adc_integrator"
        ],
        "workspace": null,
        "page": "借用 → 借入；借出；车辆组",
        "pre": "BR08 完成。",
        "steps": [
          "workspace_manager 在“借入”对 VEH-004 点“归还”：车辆离开制动研发车组和制动团队工作区，车上配置和整车软件保持不变。",
          "adc_integrator 收到“VEH-004 已归还 · 整车软件 — → 1.0”；借出表显示同样的软件变化。",
          "adc_integrator 把 VEH-004 加回系统应用研发车组；该组没有发布，上报后不推送。"
        ],
        "done": "平台不替借出方重新入组，也不回滚配置。",
        "fail": "有待回执的下发或仿真运行中时不能归还。"
      },
      {
        "id": "BR10",
        "title": "整车软件自己变了：更新回去",
        "actor": "车辆模拟器；business",
        "accounts": [
          "business"
        ],
        "workspace": "team-brake",
        "page": "车辆模拟器；工作台 → 车辆软件已变化",
        "pre": "BR09 完成。",
        "steps": [
          "在车辆模拟器对 VEH-001 “模拟整车软件 OTA”到 1.1 并上报：business 的工作台显示“1.0 → 1.1 · 新软件没有适用的策略集”。",
          "打开它，点“更新整车版本”选 1.0 并提交；在模拟器“整车 OTA 系统”点“更新成功”。",
          "VEH-001 回到 1.0，两次变化都已确认；它的配置仍然适用，不需要推送。"
        ],
        "done": "不匹配时可以改策略，也可以只更新车辆的整车版本。",
        "fail": "更新申请等待期间不能下发到该车。"
      },
      {
        "id": "N01",
        "title": "借出期间的拒绝",
        "actor": "steering；adc_integrator；resource；dispatch_operator",
        "accounts": [
          "steering",
          "adc_integrator",
          "resource",
          "dispatch_operator"
        ],
        "workspace": null,
        "page": "借用；车辆组；车辆台账",
        "pre": "BR04 完成（支线）。",
        "steps": [
          "steering 不能归还制动团队借的车。",
          "adc_integrator 不能把借出的 VEH-004 加入自己的车辆组：“车辆借用中…”。",
          "resource 不能把借出的车转为维护。",
          "dispatch_operator 不能申请更新整车版本。"
        ],
        "done": "借用期间只有借用方使用车辆。",
        "fail": "拒绝不改变任何状态。"
      }
    ]
  },
  {
    "id": "lifecycle",
    "name": "车辆环境迁移与组织归档",
    "start": "demo",
    "scenes": [
      {
        "id": "LV01",
        "title": "车辆移出车辆组后转入测试环境",
        "actor": "resource；workspace_manager",
        "accounts": ["resource", "workspace_manager"],
        "workspace": null,
        "page": "车辆与车辆组 → 车辆台账 → 变更环境；车辆组",
        "pre": "演示数据。",
        "steps": [
          "resource 在车辆台账对 VEH-003 点“变更环境”，选“测试”：提示“属于车辆组“转向研发车组”，请先移出”，不能变更。",
          "workspace_manager（转向团队工作区）把 VEH-003 移出转向研发车组。",
          "resource 再次变更到测试，原因“转入转向联调”：VEH-003 变为测试环境，整车软件与已生效配置不变；对话框中列出这次变更。workspace_manager 收到“VEH-003 的环境已变更”。"
        ],
        "done": "环境是车辆的使用边界，由车辆资源按授权变更并留痕。",
        "fail": "车辆组、下发、预约、借用、运行中的仿真或处理中的事件未结束时不能变更。"
      },
      {
        "id": "LV02",
        "title": "量产只接收运行正式策略集的车辆",
        "actor": "resource",
        "accounts": ["resource"],
        "workspace": null,
        "page": "车辆台账 → 变更环境",
        "pre": "LV01 完成。",
        "steps": [
          "对 VEH-001 选“量产”：列出“团队工作区 制动团队工作区 正在使用；量产车不能用于团队工作区”和“没有运行适用于软件 1.0 的正式策略集”。",
          "对 SIM-021 选“量产”：“仿真实例只用于研发与测试环境”。"
        ],
        "done": "研发车、仿真不能直接变成量产车。",
        "fail": "按钮保持不可用，平台也会拒绝。"
      },
      {
        "id": "LV03",
        "title": "量产车去台架复测再回来",
        "actor": "release；resource",
        "accounts": ["release", "resource"],
        "workspace": "x89-project",
        "page": "车辆组；车辆台账 → 变更环境",
        "pre": "LV02 完成。",
        "steps": [
          "release 在 X89 项目研发把 VEH-202 移出 X89 量产车组（原因“台架复测”）。",
          "resource 把 VEH-202 变更到测试，再变更回量产：它仍运行适用于 1.0 的策略集 1.0.0，可以回到量产。"
        ],
        "done": "环境变更不改变车上的软件和配置。",
        "fail": "量产车回到量产前须运行适用于其软件的正式策略集。"
      },
      {
        "id": "LV04",
        "title": "有事务的工作区不能归档",
        "actor": "workspace_manager",
        "accounts": ["workspace_manager"],
        "workspace": "team-steering",
        "page": "工作台 → 归档本工作区",
        "pre": "LV03 完成。",
        "steps": [
          "workspace_manager 在转向团队工作区的工作台点“归档本工作区…”：列出“工作区 X89 项目研发 以它为集成来源”、尚未结束的 Feature 与“仿真实例 SIM-022 正在运行”，“归档”不可用。"
        ],
        "done": "归档前须结束来源依赖、Feature、候选、合并、实例、预约、借用与下发。",
        "fail": "平台同样拒绝。"
      },
      {
        "id": "LV05",
        "title": "归档后关闭，平台运维恢复",
        "actor": "admin；resource",
        "accounts": ["admin", "resource"],
        "workspace": null,
        "page": "组织与工作区 → 组织树、工作区",
        "pre": "LV04 完成。",
        "steps": [
          "admin 在 X89 项目下新建节点“试验组”（x89-lab-unit），再新建项目工作区“X89 试验区”（x89-lab）。",
          "在“工作区”对 X89 试验区点“归档”，原因“试验结束”：状态“已归档”；resource 的工作区切换中不再有它，平台拒绝其中的操作。",
          "admin 点“恢复”，原因“重开试验”：恢复使用，历史中保留归档与恢复两条记录。"
        ],
        "done": "归档撤销入口与访问，不删除车辆归属和历史。",
        "fail": "只有平台运维可以恢复。"
      },
      {
        "id": "LV06",
        "title": "归档业务分组",
        "actor": "workspace_manager；admin",
        "accounts": ["workspace_manager", "admin"],
        "workspace": "team-brake",
        "page": "工作台 → 业务分组；组织与工作区 → 工作区",
        "pre": "LV05 完成。",
        "steps": [
          "workspace_manager 在制动团队工作区的工作台点“新建业务分组…”，建“制动预研组”（brake-lab，chassis.brakelab，研发），随后点它的“归档…”，原因“预研结束”（只有本工作区持有该分组）。",
          "admin 编辑 X89 项目研发：业务分组中“制动预研组（已归档）”不可选；平台同样拒绝把它加入工作区（“业务分组已归档”）。制动团队工作区仍保留它（已归档），仍可编辑。"
        ],
        "done": "分组的文件、策略与提交保留，不再加入工作区或新建 Feature。",
        "fail": "被其他工作区持有的分组须由各工作区管理员或平台运维归档。"
      },
      {
        "id": "LV07",
        "title": "归档组织节点",
        "actor": "admin",
        "accounts": ["admin"],
        "workspace": null,
        "page": "组织与工作区 → 组织树",
        "pre": "LV06 完成。",
        "steps": [
          "admin 打开“试验组”节点，点“归档该节点…”：提示“工作区 X89 试验区 仍在使用”。",
          "先归档 X89 试验区，再归档试验组：成功；这时恢复 X89 试验区会提示“组织节点 试验组 已归档”。",
          "来自公司目录的节点（如制动团队）不能在平台中归档。"
        ],
        "done": "下级节点、分组与工作区都归档后才能归档节点。",
        "fail": "目录节点随公司目录变化。"
      },
      {
        "id": "N01",
        "title": "越权的归档与环境变更",
        "actor": "workspace_manager；integration_admin",
        "accounts": ["workspace_manager", "integration_admin"],
        "workspace": null,
        "page": "引擎回放",
        "pre": "演示数据。",
        "steps": [
          "workspace_manager 不能归档转向组：X89 项目研发也持有它。",
          "workspace_manager 不能变更车辆环境。",
          "integration_admin 不能恢复工作区。"
        ],
        "done": "每个动作只由一条完整授权放行。",
        "fail": "拒绝不改变任何状态。"
      }
    ]
  },
  {
    "id": "device-faults",
    "name": "车端故障与恢复 · 校验、签名、应用中断与回执丢失",
    "start": "demo",
    "scenes": [
      {
        "id": "DF01",
        "title": "配置包校验失败与签名无效",
        "actor": "车辆模拟器；brake_tester",
        "accounts": [
          "brake_tester"
        ],
        "workspace": "team-brake",
        "page": "原型工具 → 车辆模拟器；研发 Feature → guided_brake → 下发与测试",
        "pre": "演示数据。车辆模拟器中 SIM-021、VEH-001 打开“自动回执”。",
        "steps": [
          "在车辆模拟器“车端 Agent”把 VEH-001 的车端故障设为“配置包校验失败”，SIM-021 设为“配置包签名无效”。",
          "brake_tester 在制动团队工作区把 guided_brake 的当前提交下发到制动研发车组。",
          "在模拟器点“执行一步”：两辆车都回执失败，错误分别为“配置包校验失败：未安装，保留原配置”和“配置包签名与平台公钥不符：未安装，保留原配置”；两车已生效配置不变。",
          "brake_tester 不能在 SIM-021 上登记测试结果：车辆尚未确认应用。"
        ],
        "done": "车辆拒绝损坏或签名不符的配置包，失败回执写明原因，旧配置保留。",
        "fail": "失败的车辆不能被当成已应用。"
      },
      {
        "id": "DF02",
        "title": "排除故障后重新下发",
        "actor": "车辆模拟器；brake_tester",
        "accounts": [
          "brake_tester"
        ],
        "workspace": "team-brake",
        "page": "车辆模拟器；guided_brake → 下发与测试",
        "pre": "DF01 完成。",
        "steps": [
          "把两辆车的车端故障改回“无”。",
          "brake_tester 再次下发 guided_brake；执行一步：两车应用成功。",
          "下发记录中上一次下发仍为“失败”，保留错误原因。"
        ],
        "done": "故障持续到被排除；失败的下发不被改写。",
        "fail": "故障未排除时重新下发仍会失败。"
      },
      {
        "id": "DF03",
        "title": "应用中断，恢复原配置",
        "actor": "车辆模拟器；brake_tester",
        "accounts": [
          "brake_tester"
        ],
        "workspace": "team-brake",
        "page": "车辆模拟器；brake_monitor → 下发与测试",
        "pre": "DF02 完成。",
        "steps": [
          "把 VEH-001 的车端故障设为“应用中断”。",
          "brake_tester 把 brake_monitor 下发到制动研发车组；执行一步：VEH-001 回执失败“应用中断：已恢复原配置”，仍运行 guided_brake；SIM-021 应用成功。"
        ],
        "done": "应用中断时车辆回到上一配置，平台记录与车上一致。",
        "fail": "同一次尝试的失败回执不能再换成成功。"
      },
      {
        "id": "DF04",
        "title": "回执丢失与补发",
        "actor": "车辆模拟器；brake_tester；resource",
        "accounts": [
          "brake_tester",
          "resource"
        ],
        "workspace": "team-brake",
        "page": "车辆模拟器；brake_monitor → 下发与测试；车辆台账 → 客户端状态",
        "pre": "DF03 完成。",
        "steps": [
          "把 VEH-001 的车端故障设为“回执丢失”；brake_tester 再次下发 brake_monitor。",
          "执行一步：模拟器显示 VEH-001“已应用 · 回执未送达”，已生效配置旁标注“车上实际：brake_monitor …”；平台的下发记录为“已推送·待回执”，已生效配置仍为 guided_brake。",
          "VEH-001“上报”后，resource 在车辆台账“客户端状态”中看到上报的配置与平台记录不同。",
          "再执行一步：不会重复安装，也不会送出回执。",
          "把故障改回“无”，执行一步：同一尝试的回执补发，平台确认一次，VEH-001 已生效 brake_monitor。"
        ],
        "done": "平台只按回执记录车上的配置；补发的回执只确认一次。",
        "fail": "期望下发的配置不被当作车上已生效的配置。"
      },
      {
        "id": "DF05",
        "title": "取消后迟到的回执",
        "actor": "车辆模拟器；brake_tester；resource",
        "accounts": [
          "brake_tester",
          "resource"
        ],
        "workspace": "team-brake",
        "page": "车辆模拟器；guided_brake → 下发与测试；车辆台账 → 客户端状态",
        "pre": "DF04 完成。",
        "steps": [
          "VEH-001 设为“回执丢失”；brake_tester 下发 guided_brake，执行一步后取消这次下发（原因“回执迟迟未到，取消后重新下发”）。",
          "把故障改回“无”，执行一步：迟到的回执被平台拒绝并丢弃，平台仍记录 brake_monitor；VEH-001 上报后客户端状态显示车上实际运行 guided_brake，与平台记录不同。",
          "brake_tester 重新下发 guided_brake，执行一步：应用成功，再次上报后与平台记录一致。"
        ],
        "done": "取消的下发不会因迟到的回执生效；重新下发让平台与车辆重新一致。",
        "fail": "迟到的回执不能改变已取消的下发。"
      },
      {
        "id": "N01",
        "title": "回执不能改写或重复确认",
        "actor": "车辆模拟器",
        "accounts": [],
        "workspace": null,
        "page": "引擎回放",
        "pre": "DF04 完成。",
        "steps": [
          "DF03 中失败的尝试再收到“应用成功”：拒绝（同一次尝试已有不同回执）。",
          "已确认的回执再次补发：没有可补发的回执；重复的成功回执被忽略。"
        ],
        "done": "每次尝试只有一个结果。",
        "fail": "拒绝不改变任何状态。"
      }
    ]
  },
  {
    "id": "patch",
    "name": "同软件版本配置补丁 · 主线与补丁",
    "start": "demo",
    "scenes": [
      {
        "id": "PT01",
        "title": "主线前进到 1.1.0，软件 1.0 仍用 1.0.0",
        "actor": "integrator；integration_tester；release；resource",
        "accounts": [
          "integrator",
          "integration_tester",
          "release",
          "resource"
        ],
        "workspace": "x89-project",
        "page": "配置集成；发布与配置 OTA",
        "pre": "演示数据。集成测试工作区准备运行 1.1 的仿真（镜像 x89-1.1-sim）与实车（在车辆模拟器刷写 1.1 并上报）。",
        "steps": [
          "integrator 把 steering_return_rate 合并到主线（目标策略集 1.0.0 · 主线），DCL 确认后冻结 X89-C2。",
          "integration_tester 在两辆 1.1 车辆上先仿真后实车登记 PASS，确认验证；release 发布 1.1.0，只适用 1.1。",
          "量产车 VEH-202 在车辆模拟器刷写 1.1 并上报。"
        ],
        "done": "主线策略集为 1.1.0；软件 1.0 仍解析到 1.0.0，1.0.0 成为可以打补丁的目标；VEH-202 解析到 1.1.0。",
        "fail": "1.1.0 不适用 1.0，软件 1.0 的车辆不会收到主线的新策略。"
      },
      {
        "id": "PT02",
        "title": "团队在 1.0.0 上开修复 Feature",
        "actor": "steering；steering_tester",
        "accounts": [
          "steering",
          "steering_tester"
        ],
        "workspace": "team-steering",
        "page": "研发 Feature → 创建 Feature",
        "pre": "PT01 完成。",
        "steps": [
          "steering 创建 Feature angle_jump_fix，基线选“策略集 1.0.0 · 软件 1.0 在用”（默认是主线 1.1.0）。",
          "把转角突变的阈值从 300 改为 350，提交；没有新文件，直接 DCL Ready。",
          "steering_tester 下发到转向研发车组（软件 1.0，基线 1.0.0），先仿真后实车登记 PASS，确认 Verified。"
        ],
        "done": "修复从 1.0.0 开始，草稿里没有主线的回正策略。",
        "fail": "基线由团队明确选择，平台不会自动改基线。"
      },
      {
        "id": "PT03",
        "title": "补丁模式：合并到 1.0.0 而不是主线",
        "actor": "integrator；dcl",
        "accounts": [
          "integrator",
          "dcl"
        ],
        "workspace": "x89-project",
        "page": "配置集成 → 合并与处理确认 → 合并目标",
        "pre": "PT02 完成；主线上已有 brake_monitor 的合并预览。",
        "steps": [
          "合并目标选“同软件版本补丁”→ 策略集 1.0.0（软件 1.0 在用），预览 angle_jump_fix。",
          "以主线 1.1.0 为补丁目标被拒绝；补丁带子系统发布被拒绝（补丁只收 Verified Feature）。",
          "预览就绪：转向只改转角突变（阈值 350，录制时长仍是 1.0.0 的 10 秒），1.1.0 的回正策略不进入补丁。",
          "DCL 确认处理集合，integrator 冻结 X89-P1；主线上 brake_monitor 的预览仍然有效。"
        ],
        "done": "补丁的完整集合 = 1.0.0 + 修复。",
        "fail": "补丁预览不取代主线预览，主线预览也不取代补丁预览。"
      },
      {
        "id": "PT04",
        "title": "补丁在它要服务的软件上集成测试",
        "actor": "integration_tester",
        "accounts": [
          "integration_tester"
        ],
        "workspace": "x89-integration",
        "page": "配置集成 → 集成候选",
        "pre": "PT03 完成。",
        "steps": [
          "把 X89-P1 下发到 X89 集成测试车组（SIM-101、VEH-031，软件 1.0），回执后先仿真后实车登记 PASS。",
          "确认集成验证。"
        ],
        "done": "补丁候选通过软件 1.0 上的独立集成测试。",
        "fail": "候选的测试从零开始，不继承 Feature 的结果。"
      },
      {
        "id": "PT05",
        "title": "发布补丁 1.0.1：只服务软件 1.0，主线不变",
        "actor": "release",
        "accounts": [
          "release"
        ],
        "workspace": "x89-project",
        "page": "发布与配置 OTA → 策略集发布",
        "pre": "PT04 完成。",
        "steps": [
          "发布表单建议版本 1.0.1，适用版本只列出软件 1.0。",
          "填 1.1.1 被拒绝（补丁沿 1.0.x 编号）；同时选 1.0 和 1.1 被拒绝（1.0.0 只服务 1.0）。",
          "发布 1.0.1（补丁 · 基于 1.0.0），适用 1.0；与所补的版本比较只有转角突变变化。",
          "向 X89 量产车组发起 1.0.1 的配置 OTA：只有运行 1.0 的 VEH-201 在内，回执后运行 1.0.1。"
        ],
        "done": "软件 1.0 解析到 1.0.1，软件 1.1 仍是 1.1.0；主线仍是 1.1.0。",
        "fail": "补丁不能替代主线在其他软件版本上的策略集。"
      },
      {
        "id": "PT06",
        "title": "修复合入主线",
        "actor": "integrator；dcl；integration_tester；release",
        "accounts": [
          "integrator",
          "dcl",
          "integration_tester",
          "release"
        ],
        "workspace": "x89-project",
        "page": "配置集成 → 合并与处理确认",
        "pre": "PT05 完成。",
        "steps": [
          "angle_jump_fix 回到 Verified，标注“已进入补丁 1.0.1 · 待合入主线”；工作台的集成卡片列出它。",
          "在主线合并中预览它：三方合并到 1.1.0，保留主线的回正策略与 15 秒录制时长，加入阈值 350。",
          "DCL 确认、冻结、在 1.1 车辆上集成测试，release 发布 1.1.1（适用 1.1）。"
        ],
        "done": "修复进入主线后 angle_jump_fix 归档；主线 1.1.1，软件 1.0 仍用 1.0.1。",
        "fail": "补丁里的修复不会悄悄丢在下一个主线版本之外。"
      },
      {
        "id": "PT07",
        "title": "补丁线的门禁：目标被替换后不能发布",
        "actor": "steering；steering_tester；integrator；dcl；integration_tester；release",
        "accounts": [
          "steering",
          "steering_tester",
          "integrator",
          "dcl",
          "integration_tester",
          "release"
        ],
        "workspace": "x89-project",
        "page": "配置集成；发布与配置 OTA",
        "pre": "PT06 完成。",
        "steps": [
          "steering 在 1.0.1 上开 angle_window_fix（转角突变触发前 5 秒改为 8 秒），业务验证 Verified。",
          "integrator 以 1.0.1 为补丁目标合并、DCL 确认、冻结 X89-P2，集成测试通过。",
          "dcl 对 1.0.1 的转角突变申请紧急停用，release 批准：生成 1.0.2（补丁 · 基于 1.0.1），只适用 1.0，主线仍是 1.1.1。",
          "发布 X89-P2 被拒绝：它的目标 1.0.1 已被替换。"
        ],
        "done": "补丁的门禁按自己的线判断：1.0.1 被替换后，基于它的候选须重新集成。",
        "fail": "主线发布不会使补丁候选过期，补丁发布也不会使主线候选过期。"
      },
      {
        "id": "N01",
        "title": "补丁的权限与“不合入主线”",
        "actor": "integration_tester；steering；integrator",
        "accounts": [
          "integration_tester",
          "steering",
          "integrator"
        ],
        "workspace": "x89-project",
        "page": "配置集成 → 合并与处理确认",
        "pre": "PT05 完成（支线）。",
        "steps": [
          "integration_tester 不能做补丁合并预览；steering 不能关闭补丁里的修复。",
          "integrator 对 angle_jump_fix 点“不合入主线”，写明“主线已重写转角突变策略”。",
          "Feature 归档，原因记录在 Feature 的反馈中；再次关闭被拒绝（不是待合入主线的 Verified Feature）。"
        ],
        "done": "主线不需要的修复由配置集成写明理由后关闭。",
        "fail": "没有理由不能关闭。"
      }
    ]
  },
  {
    "id": "budget",
    "name": "资源预算与紧急停采 · 资源保护",
    "start": "demo",
    "scenes": [
      {
        "id": "BG01",
        "title": "DCL 设定车型采集预算",
        "actor": "dcl",
        "accounts": [
          "dcl"
        ],
        "workspace": null,
        "page": "处理目录 → 资源预算",
        "pre": "演示数据。",
        "steps": [
          "以 dcl 登录，“处理目录 → 资源预算”：X89 当前为“默认预算”。",
          "“设置预算”：车端缓存 64 MB、上传 5 MB/小时、单策略触发上限 3 次/小时，其余不变；填负数被拒绝。"
        ],
        "done": "X89 的车辆都按车型预算核算。",
        "fail": "预算值必须为正数，触发上限为整数。"
      },
      {
        "id": "BG02",
        "title": "提交与合并时的资源保护检查",
        "actor": "steering；steering_tester；integrator；dcl",
        "accounts": [
          "steering",
          "steering_tester",
          "integrator",
          "dcl"
        ],
        "workspace": "x89-project",
        "page": "研发 Feature → 提交；配置集成 → 合并预览 → 资源保护",
        "pre": "BG01 完成。",
        "steps": [
          "steering 新建 angle_jump_long，把转角突变的录制后时长改为 110 秒并提交：提交被拒绝，转角突变“单次采集就超出 X89 预算（上传 23 MB > 5 MB/小时）”。",
          "steering 把录制后时长改为 15 秒提交；steering_tester 在转向研发车组验证。",
          "dcl 把 X89 的上传预算临时降到 3 MB/小时；integrator 预览合并：资源保护中转角突变“单次就超出预算 · 上传网络”（4 MB > 3 MB/小时），DCL 的“确认处理集合”不可用。",
          "dcl 把上传预算恢复为 5 MB/小时；同一预览变为“高频时会被限流”，DCL 确认。"
        ],
        "done": "一次采集就超出预算的策略在提交时就被拦下；验证之后预算变紧的，合并时仍会被拦下。",
        "fail": "检查按策略逐条进行，只阻止永远采集不到的策略。"
      },
      {
        "id": "BG03",
        "title": "高优先级的核心采集",
        "actor": "business；brake_tester；车辆模拟器",
        "accounts": [
          "business",
          "brake_tester"
        ],
        "workspace": "team-brake",
        "page": "研发 Feature；车辆模拟器",
        "pre": "BG01 完成。",
        "steps": [
          "business 新建 brake_core：文件“制动核心日志”，策略“制动核心”优先级 HIGH、前后各 30 秒；brake_tester 在制动研发车组验证。",
          "模拟器对 VEH-001 触发转角突变：上传（3 MB）。"
        ],
        "done": "预算内的采集立即上传。",
        "fail": "—"
      },
      {
        "id": "BG04",
        "title": "超出上传预算时排队，高优先级先走",
        "actor": "车辆模拟器",
        "accounts": [],
        "workspace": null,
        "page": "车辆模拟器 → 采集事件",
        "pre": "BG03 完成。",
        "steps": [
          "再触发一次转角突变：“预算排队”。",
          "触发“制动核心”（1.2 MB）：在预算内，先于排队的采集上传；再触发一次：超出上传预算仍然采集，标注“高优先级，超预算仍采集”。",
          "执行一步：排队的仍排队；“推进 1 小时”后执行一步：上传。"
        ],
        "done": "超出上传预算的采集不丢，等到预算允许；核心采集不受影响。",
        "fail": "—"
      },
      {
        "id": "BG05",
        "title": "触发洪峰被抑制",
        "actor": "车辆模拟器；dcl",
        "accounts": [
          "dcl"
        ],
        "workspace": "x89-project",
        "page": "车辆模拟器 → 模拟洪峰",
        "pre": "BG01 完成。",
        "steps": [
          "对 VEH-201 的转角突变“模拟洪峰（连发 10 次）”：上传 1、排队 2、洪峰抑制 7。",
          "洪峰抑制的触发不进入数据查询；dcl 的通知中心与工作台提示 VEH-201 超出预算。"
        ],
        "done": "单策略的触发次数受限，平台记得被抑制的次数。",
        "fail": "—"
      },
      {
        "id": "BG06",
        "title": "紧急暂停与恢复采集",
        "actor": "release；dcl；车辆模拟器",
        "accounts": [
          "release",
          "dcl"
        ],
        "workspace": "x89-project",
        "page": "车辆与车辆组；车辆模拟器",
        "pre": "BG05 完成。",
        "steps": [
          "release 对 VEH-201“暂停采集”，原因“上传链路拥塞”：立即“停采待车辆确认”，新的触发被拒绝。",
          "执行一步：车辆确认，“采集已暂停”，车上排队的采集被丢弃（紧急停采）。",
          "dcl“恢复采集”（链路恢复），执行一步后恢复；历史保留两条。"
        ],
        "done": "停采立即生效、由车辆确认，不需要新的策略集。",
        "fail": "恢复需写原因；未确认的暂停不能恢复。"
      },
      {
        "id": "BG07",
        "title": "测试车的单独预算",
        "actor": "dcl；车辆模拟器",
        "accounts": [
          "dcl"
        ],
        "workspace": null,
        "page": "处理目录 → 资源预算",
        "pre": "BG01 完成。",
        "steps": [
          "为 VEH-031 单独设置上传 100 MB/小时：连续两次采集都直接上传。",
          "“清除”后 VEH-031 回到车型预算。"
        ],
        "done": "台架与测试车可以有自己的预算。",
        "fail": "—"
      },
      {
        "id": "N01",
        "title": "预算与停采的越权",
        "actor": "business；brake_tester；resource；integrator；workspace_manager",
        "accounts": [
          "business",
          "brake_tester",
          "resource",
          "integrator",
          "workspace_manager"
        ],
        "workspace": null,
        "page": "引擎回放",
        "pre": "BG01 完成。",
        "steps": [
          "业务、测试、车辆资源、集成与发布都不能设置预算；业务、测试、车辆资源、集成与工作区管理员都不能暂停采集。",
          "没有暂停的车辆不能“恢复”。"
        ],
        "done": "资源保护只由 DCL 工程负责；停采只由 DCL 工程与配置发布执行。",
        "fail": "拒绝不改变任何状态。"
      }
    ]
  },
  {
    "id": "quota",
    "name": "仿真运行配额",
    "start": "demo",
    "scenes": [
      {
        "id": "Q01",
        "title": "车辆资源设定工作区的仿真运行配额",
        "actor": "resource",
        "accounts": [
          "resource"
        ],
        "workspace": "team-brake",
        "page": "车辆与车辆组 → 工作区车辆 → 仿真配额",
        "pre": "演示数据。",
        "steps": [
          "以 resource 登录，切到制动团队工作区：卡片显示“仿真运行 n · 不限”。",
          "“仿真配额”填比正在运行的少一个：被拒绝（不能低于正在运行的数量）；填 n+1：保存。"
        ],
        "done": "工作区同时运行的仿真不超过配额。",
        "fail": "配额不能低于正在运行的数量。"
      },
      {
        "id": "Q02",
        "title": "团队与个人仿真共用配额",
        "actor": "business；workspace_manager",
        "accounts": [
          "business",
          "workspace_manager"
        ],
        "workspace": "team-brake",
        "page": "车辆与车辆组；个人仿真",
        "pre": "Q01 完成。",
        "steps": [
          "business 创建个人仿真：占用最后一个名额，卡片显示“仿真运行 n+1 / n+1”。",
          "workspace_manager“创建仿真车”被拒绝：工作区的仿真运行配额已用满；business 再建个人仿真同样被拒绝。"
        ],
        "done": "个人仿真计入工作区的运行配额。",
        "fail": "—"
      },
      {
        "id": "Q03",
        "title": "停止后腾出名额，取消限制",
        "actor": "workspace_manager；resource",
        "accounts": [
          "workspace_manager",
          "resource"
        ],
        "workspace": "team-brake",
        "page": "车辆与车辆组 → 工作区车辆",
        "pre": "Q02 完成。",
        "steps": [
          "workspace_manager 停止 SIM-021，再创建仿真车 SIM-029：成功。",
          "resource 把配额清空：不再限制。"
        ],
        "done": "名额在停止后回收。",
        "fail": "—"
      },
      {
        "id": "N01",
        "title": "配额只由车辆资源设置",
        "actor": "workspace_manager；business；dcl；release；integration_admin",
        "accounts": [
          "workspace_manager",
          "business",
          "dcl",
          "release",
          "integration_admin"
        ],
        "workspace": null,
        "page": "引擎回放",
        "pre": "Q01 完成。",
        "steps": [
          "工作区管理员、业务、DCL、发布与集成工作区管理员都不能设置配额；负数被拒绝。"
        ],
        "done": "配额治理只在车辆资源。",
        "fail": "拒绝不改变任何状态。"
      }
    ]
  },
  {
    "id": "technical",
    "name": "DCL 技术变更 · 自有技术分支交付",
    "start": "demo",
    "scenes": [
      {
        "id": "TC01",
        "title": "DCL 发布新的处理版本并开技术分支",
        "actor": "dcl",
        "accounts": [
          "dcl"
        ],
        "workspace": null,
        "page": "处理目录 → 处理版本；技术变更",
        "pre": "演示数据。",
        "steps": [
          "以 dcl 登录，“处理目录 → 处理版本 → 发布处理版本”：default-edge-bin-log，EDGE，格式 binary，步骤 Receive、Compress、Encrypt：生成 default-edge-bin-log@2，已有文件仍绑定 @1。",
          "“技术变更 → 新建技术变更”：转向团队工作区 · 转向分组，名称 bin_log_edge_v2，基线默认主线 1.0.0。"
        ],
        "done": "技术分支从主线开始，内容与基线相同，标注“DCL 技术变更”。",
        "fail": "技术修复不能直接改已发布的策略集。"
      },
      {
        "id": "TC02",
        "title": "只调整处理绑定，DCL 自己提交",
        "actor": "dcl",
        "accounts": [
          "dcl"
        ],
        "workspace": "team-steering",
        "page": "研发 Feature → 文件列表 → 调整处理绑定",
        "pre": "TC01 完成。",
        "steps": [
          "在 bin_log_edge_v2 的文件列表对 EPS 转向轨迹“调整处理绑定”，车端处理改为 default-edge-bin-log@2（没有原因栏，不发反馈）。",
          "文件与策略没有添加、编辑入口；“提交”后直接 DCL Ready。"
        ],
        "done": "提交只改了处理绑定；每次采集的车端 CPU 由 0.75 秒降到 0.45 秒。",
        "fail": "技术变更不能增删文件、改策略或引用。"
      },
      {
        "id": "TC03",
        "title": "本组测试验证技术变更",
        "actor": "steering_tester",
        "accounts": [
          "steering_tester"
        ],
        "workspace": "team-steering",
        "page": "研发 Feature → 下发与测试",
        "pre": "TC02 完成。",
        "steps": [
          "steering_tester 把 bin_log_edge_v2 下发到转向研发车组，回执后先仿真后实车登记 PASS，确认 Verified。"
        ],
        "done": "技术变更由业务所有者的测试验证。",
        "fail": "—"
      },
      {
        "id": "TC04",
        "title": "集成、集成测试与发布",
        "actor": "integrator；dcl；integration_tester；release",
        "accounts": [
          "integrator",
          "dcl",
          "integration_tester",
          "release"
        ],
        "workspace": "x89-project",
        "page": "配置集成；发布与配置 OTA",
        "pre": "TC03 完成。",
        "steps": [
          "integrator 预览合并（来源标注“DCL 技术变更”），dcl 确认处理集合，冻结 X89-C2。",
          "integration_tester 在 X89 集成测试车组先仿真后实车 PASS，确认验证；release 发布 1.0.1。",
          "与上一版比较：没有策略变化，转向组只有 EPS 转向轨迹的车端处理变化。"
        ],
        "done": "DCL 的技术修复经过独立测试、集成和发布交付。",
        "fail": "—"
      },
      {
        "id": "N01",
        "title": "技术变更只由 DCL 工程负责",
        "actor": "steering；integrator；dcl",
        "accounts": [
          "steering",
          "integrator",
          "dcl"
        ],
        "workspace": null,
        "page": "引擎回放",
        "pre": "TC01 完成（支线）。",
        "steps": [
          "业务研发与配置集成不能新建技术变更；业务研发不能提交 DCL 的技术变更。",
          "没有任何调整时提交被拒绝（与基线相同）。"
        ],
        "done": "技术分支归 DCL 所有。",
        "fail": "拒绝不改变任何状态。"
      }
    ]
  },
  {
    "id": "aftersales",
    "name": "售后与 Grader · 售后回捞与优先级仲裁",
    "start": "demo",
    "scenes": [
      {
        "id": "AS01",
        "title": "业务为客户案例请求售后采集",
        "actor": "business；brake_tester",
        "accounts": [
          "business",
          "brake_tester"
        ],
        "workspace": "team-brake",
        "page": "数据查询 → 售后查询 → 售后回捞",
        "pre": "演示数据；VEH-001 离线（车辆模拟器关闭“在线”）。",
        "steps": [
          "以 business 登录（制动团队工作区），“售后回捞”选 VEH-001、策略 chassis.brake.monitor，原因“客户投诉：低速制动异响”，“请求采集”。",
          "请求列表“等待车辆执行”；brake_tester 再对同一策略请求被拒绝（已有等待执行的请求）。"
        ],
        "done": "请求记录车辆、策略、原因与请求人，等车辆连线。",
        "fail": "只能请求本组的策略，且必须写明原因。"
      },
      {
        "id": "AS02",
        "title": "售后优先，Grader 延后",
        "actor": "车辆模拟器",
        "accounts": [],
        "workspace": null,
        "page": "车辆模拟器 → 采集事件",
        "pre": "AS01 完成。",
        "steps": [
          "对 VEH-001 的 chassis.brake.failure_diag 点“Grader 周期采集”：“预算排队 · 售后优先，Grader 延迟”。",
          "同一策略“触发事件”：照常上传，触发不受售后仲裁影响。"
        ],
        "done": "车辆上有售后工作时，周期性的 Grader 采集等待。",
        "fail": "—"
      },
      {
        "id": "AS03",
        "title": "车辆执行售后采集，数据回到业务",
        "actor": "车辆模拟器；business",
        "accounts": [
          "business"
        ],
        "workspace": "team-brake",
        "page": "车辆模拟器；数据查询；通知中心",
        "pre": "AS02 完成。",
        "steps": [
          "VEH-001 恢复在线，执行一步：请求“已采集”，事件来源“售后”、优先级 HIGH；Grader 采集仍等待。",
          "再执行一步：售后采集上传完成后 Grader 采集上传；处理完成后 business 在售后查询中看到“采集方式：售后”的事件，通知“VEH-001 的售后采集已就绪”。"
        ],
        "done": "售后采集作为核心业务先走，数据进入业务的查询。",
        "fail": "—"
      },
      {
        "id": "AS04",
        "title": "撤回尚未执行的请求",
        "actor": "brake_tester；车辆模拟器",
        "accounts": [
          "brake_tester"
        ],
        "workspace": "team-brake",
        "page": "数据查询 → 售后回捞",
        "pre": "AS01 完成。",
        "steps": [
          "VEH-001 离线时 brake_tester 请求 chassis.brake.failure_diag，再“取消”：状态“已取消”。",
          "车辆连线后不再执行；已取消的请求不能再执行。"
        ],
        "done": "未执行的请求可以撤回。",
        "fail": "—"
      },
      {
        "id": "N01",
        "title": "售后请求的越权",
        "actor": "business；dispatch_operator；resource",
        "accounts": [
          "business",
          "dispatch_operator",
          "resource"
        ],
        "workspace": null,
        "page": "引擎回放",
        "pre": "AS01 完成。",
        "steps": [
          "business 不能请求转向组的策略；仅下发的测试账号与车辆资源不能请求；没有原因被拒绝。"
        ],
        "done": "售后请求只针对本组的策略。",
        "fail": "拒绝不改变任何状态。"
      }
    ]
  },
  {
    "id": "integration-call",
    "name": "集成征集与发布记录 · 整车集成版本的发布管理",
    "start": "demo",
    "scenes": [
      {
        "id": "IC01",
        "title": "集成管理员为 X89 1.2 发起集成征集",
        "actor": "integration_admin / 郑书杰 · 工作区管理员",
        "accounts": [
          "integration_admin",
          "integration_tester",
          "release",
          "resource"
        ],
        "workspace": "x89-project",
        "page": "集成版本 → 集成征集",
        "pre": "演示数据：X89 已有策略集 1.0.0（软件 1.0），软件 1.1 已登记、尚无策略集。",
        "steps": [
          "integration_tester、release 不能发起集成征集；为已发布过策略集的 1.0 发起被拒绝。",
          "integration_admin 发起：目标版本 1.2，基线 1.1，四个模块都参加。",
          "模块清单：制动、转向（叶子 · 业务组）与 ADC、CDC（上层 · 域集成），都待提交；平台建了工作名 X89 1.2（规划中，PLM 还没有版本号）。",
          "量产车 VEH-201 不能确认到工作名 1.2；工作名不能另开适用性确认。",
          "integration_admin 能打开“集成版本”页面。"
        ],
        "done": "目标整车集成版本与模块清单建立，各模块收到待提交通知。",
        "fail": "没有授权不能发起；规划版本不进入量产。"
      },
      {
        "id": "IC02",
        "title": "叶子模块由本组研发提交",
        "actor": "steering；business；integrator；integration_admin",
        "accounts": [
          "steering",
          "business",
          "workspace_manager",
          "integrator",
          "integration_admin"
        ],
        "workspace": "team-steering",
        "page": "研发 Feature → 提交到集成征集",
        "pre": "IC01 完成。",
        "steps": [
          "business（制动组）不能替转向组提交；workspace_manager（团队工作区管理员）不能提交叶子模块。",
          "steering 打开已验证的 steering_return_rate，点“提交到 X89 1.2”；business 提交 brake_monitor。",
          "没收齐时 integrator 生成集成预览被拒绝（还没收齐）。",
          "integration_admin 催办：ADC、CDC 两个模块收到新的提醒。"
        ],
        "done": "叶子模块各自提交了已验证的固定提交。",
        "fail": "只能由本组研发提交本组版本。"
      },
      {
        "id": "IC03",
        "title": "上层模块：ADC 开子征集，CDC 直接答复",
        "actor": "adc_integrator；adc_parking；adc_system；cdc_integrator",
        "accounts": [
          "adc_integrator",
          "adc_parking",
          "adc_system",
          "cdc_integrator"
        ],
        "workspace": "x89-adc-integration",
        "page": "集成版本 → 集成征集",
        "pre": "IC02 完成。",
        "steps": [
          "cdc_integrator 不能替 ADC 提交。",
          "adc_integrator 在 ADC 模块上“开子征集”：模块为泊车组、系统应用组。",
          "两组研发都提交“本次无变更”；adc_integrator 按“无变更”结束子征集。",
          "整车征集的 ADC 模块自动变为“本次无变更”；cdc_integrator 在 CDC 模块提交“本次无变更”。",
          "整车征集阶段变为“已收齐”。"
        ],
        "done": "上层模块由域工作区的管理员或配置集成答复，可先在本域征集。",
        "fail": "子征集的结果自动交回整车征集。"
      },
      {
        "id": "IC04",
        "title": "PLM 出第 1 轮整车测试版本，关联后送测",
        "actor": "PLM（模拟）；integration_admin；integrator；dcl；resource",
        "accounts": [
          "integration_admin",
          "release",
          "integrator",
          "dcl",
          "resource"
        ],
        "workspace": "x89-project",
        "page": "原型工具 → PLM（模拟）；集成版本 → 整车测试版本；收齐，生成集成预览",
        "pre": "IC03 完成。",
        "steps": [
          "PLM（模拟）出第 1 轮整车测试版本 X89 1.2.0.1（不带 DCL 件）并同步：平台记为“测试版本 · 未关联”，integration_admin 收到“还没关联到征集”的提醒。",
          "release 不能关联；integration_admin 在征集里把 1.2.0.1 关联为整车第 1 轮（工作名 1.2 的测试版本）。征集还没发布，暂不引用策略集。",
          "dcl 登记 1.2.0.1 的仿真镜像 x89-1.2-sim；integration_admin 建测试仿真 SIM-112；resource 从 TSP 登记测试车 VEH-032，车辆刷写 1.2.0.1 后上报，加入 X89 集成测试。",
          "integration_admin 不能生成集成预览（要读并合并各组配置，是配置集成的事）；integrator 生成预览，dcl 确认处理集合，integrator 送测：测试集成版本 X89 1.2-T1。"
        ],
        "done": "整车第 1 轮的测试版本已关联，DCL 第一轮在跑 1.2.0.1 的测试车上送测。",
        "fail": "只有集成管理员能关联；未收齐不能合并；送测只走现有的合并、DCL 确认和冻结门禁。"
      },
      {
        "id": "IC05",
        "title": "第一轮不通过：退回转向组",
        "actor": "integration_tester；integration_admin；steering；steering_tester",
        "accounts": [
          "integration_tester",
          "integration_admin",
          "steering",
          "steering_tester"
        ],
        "workspace": "x89-integration",
        "page": "配置集成 → 集成候选；集成版本 → 退回",
        "pre": "IC04 完成。",
        "steps": [
          "integration_tester 下发 X89 1.2-T1：SIM-112 PASS，VEH-032 FAIL（回正误触发偏多），不能判定通过。",
          "integration_tester 不能退回模块；integration_admin 退回转向模块并写明原因。",
          "T1 取消，第 1 轮记为已取消；制动的提交保留。",
          "steering 收紧回正阈值，steering_tester 重新验证后，steering 重新提交；征集再次收齐。"
        ],
        "done": "不通过的一轮退回对应模块，下一轮合并新的提交。",
        "fail": "退回必须写原因；其他模块不受影响。"
      },
      {
        "id": "IC06",
        "title": "第二轮通过",
        "actor": "integrator；dcl；integration_tester",
        "accounts": [
          "integrator",
          "dcl",
          "integration_tester",
          "integration_admin"
        ],
        "workspace": "x89-integration",
        "page": "配置集成 → 集成候选",
        "pre": "IC05 完成。",
        "steps": [
          "integrator 生成预览、dcl 确认、integrator 送测：X89 1.2-T2。",
          "送测后不能再改目标版本（测试证据绑定版本号）。",
          "integration_tester 在两辆跑 1.2.0.1 的测试车上都 PASS，判定通过；征集阶段为“测试通过，待发布”。轮次表写明测试车软件 1.2.0.1（整车第 1 轮）。"
        ],
        "done": "DCL 的轮次与整车轮次各自独立：T1、T2 都在整车第 1 轮的测试版本上测。",
        "fail": "测试车跑工作名的测试版本时，结果算作该工作名的测试。"
      },
      {
        "id": "IC07",
        "title": "发布：策略集对应工作名，并引用到已关联的测试版本",
        "actor": "release / 孙立；resource",
        "accounts": [
          "release",
          "integrator",
          "resource"
        ],
        "workspace": "x89-project",
        "page": "集成版本 → 发布",
        "pre": "IC06 完成。",
        "steps": [
          "integrator 不能发布；不列入工作名 1.2 的发布被拒绝；把测试版本 1.2.0.1 也列进发布被拒绝（测试版本只按征集引用）。",
          "release 发布策略集 1.1.0：记录 1.1.0 ↔ 工作名 X89 1.2，并导出 1.1.0 的配置；已关联的 1.2.0.1 随发布引用 1.1.0。征集为“已发布”，工作名仍是规划中，等 PLM 发布。",
          "量产车 VEH-202 仍在 1.0，用 1.0.0。"
        ],
        "done": "策略集已发布并对应到工作名和它的测试版本；配置等 DCL 交给 PLM。",
        "fail": "发布仍复核测试、DCL 确认和版本规则。"
      },
      {
        "id": "IC08",
        "title": "DCL 导出 DCL 件，交给 PLM",
        "actor": "dcl / 林书涵",
        "accounts": [
          "dcl",
          "release"
        ],
        "workspace": "x89-project",
        "page": "发布与配置 OTA → 软件版本与策略集",
        "pre": "IC07 完成。",
        "steps": [
          "release 不能导出 DCL 件。",
          "dcl 在 X89 1.2 一行点“导出 DCL 件（交付 PLM）”，客户端版本 2.3.0：得到件 DCL 2.3.0+1.1.0，带配置摘要；下载的文件交给 PLM（在平台之外）。",
          "1.2 的状态变为“DCL 件已交付 · 待 PLM 发布”。"
        ],
        "done": "DCL 件在 PLM 发布前交付，写明客户端版本、策略集版本和配置摘要。",
        "fail": "只有 DCL 能导出；征集发布前没有可导出的配置。"
      },
      {
        "id": "IC09",
        "title": "PLM 出第 2 轮测试版本：直接确认引用，测试车按映射取到 1.1.0",
        "actor": "PLM（模拟）；integration_admin / 郑书杰；车辆模拟器 · VEH-031",
        "accounts": [
          "integration_admin",
          "integration_tester"
        ],
        "workspace": "x89-project",
        "page": "原型工具 → PLM（模拟）；集成版本 → 整车测试版本；车辆模拟器",
        "pre": "IC08 完成。",
        "steps": [
          "一天后，PLM（模拟）出第 2 轮整车测试版本 X89 1.2.0.2，BOM 带上 DCL 2.3.0+1.1.0，同步到平台。",
          "integration_admin 关联为整车第 2 轮：DCL 策略集没变，关联即确认引用 1.1.0（适用记录写明“确认引用”），1.1.0 ↔ 1.2.0.2。",
          "X89 集成测试车组的 VEH-031 刷到 1.2.0.2 后上报：车辆组没有进行中的测试，平台按映射答复 1.1.0，云端推送；回执后 VEH-031 运行 1.1.0。"
        ],
        "done": "每轮整车测试版本都记下它引用的策略集；后续刷到这个版本的测试车按版本取策略。",
        "fail": "有进行中的候选或适用性测试时，以测试下发为准。"
      },
      {
        "id": "IC10",
        "title": "第 2 轮通过：PLM 同号发布 1.2.0.2，量产车随包运行 1.1.0",
        "actor": "PLM（模拟）；车辆模拟器 · VEH-201",
        "accounts": [
          "release",
          "resource"
        ],
        "workspace": "x89-project",
        "page": "原型工具 → PLM（模拟）；车辆模拟器",
        "pre": "IC09 完成。",
        "steps": [
          "PLM（模拟）把 1.2.0.2 测试通过、以同号发布，同步到平台：1.2.0.2 变为已发布，工作名 1.2 关联到 1.2.0.2；1.1.0 已经适用，不开适用性确认。1.2.0.1 仍是测试版本。",
          "关联后，不能再把研发车更新到工作名 1.2，不能再为它导出 DCL 件，也不能再关联测试版本。",
          "车辆模拟器把量产车 VEH-201 刷到 1.2.0.2；车端签名上报的配置摘要就是 1.1.0，平台记为运行 1.1.0，不需要配置 OTA 推送。"
        ],
        "done": "通过的那一轮的号就是发布号；配置随系统 OTA 包到车，弱网也能按正确策略采集。",
        "fail": "平台只认车端上报的摘要，不替车推断。"
      },
      {
        "id": "IC11",
        "title": "第 2 轮通过：PLM 同号发布 1.2.0.2，量产车随包运行 1.1.0",
        "actor": "PLM（模拟）；车辆模拟器 · VEH-201",
        "accounts": [
          "release",
          "resource"
        ],
        "workspace": "x89-project",
        "page": "原型工具 → PLM（模拟）；车辆模拟器",
        "pre": "IC10 完成。",
        "steps": [
          "integration_admin 打开“发布记录”，选 X89 1.2.0.2。",
          "时间线从工作名 1.2 的征集开始：各模块提交、整车第 1 轮 1.2.0.1 关联、T1 送测、转向被退回、T1 取消、T2 送测并在 1.2.0.1 上通过、发布 1.1.0、导出配置、DCL 件交付、PLM 出第 2 轮 1.2.0.2、关联并确认引用 1.1.0、VEH-031 到达、PLM 同号发布、关联工作名、VEH-201 随包运行。",
          "1.2.0.2 先后生效的策略集只有 1.1.0。"
        ],
        "done": "通过的那一轮的号就是发布号；配置随系统 OTA 包到车，弱网也能按正确策略采集。",
        "fail": "平台只认车端上报的摘要，不替车推断。"
      },
      {
        "id": "IC12",
        "title": "PLM 发布 1.2.1，复用同一个 DCL 件",
        "actor": "PLM（模拟）；release / 孙立",
        "accounts": [
          "release"
        ],
        "workspace": "x89-project",
        "page": "原型工具 → PLM（模拟）；发布与配置 OTA → 软件版本与策略集",
        "pre": "IC11 完成。",
        "steps": [
          "PLM（模拟）直接发布 X89 1.2.1（别的模块有修复，不经过征集的轮次），BOM 仍带 DCL 2.3.0+1.1.0。",
          "平台把 1.2.1 记为 PLM 版本，出厂配置是 1.1.0；它不是哪个工作名，也没关联到征集，所以开一张 1.1.0 用于 1.2.1 的适用性确认待办。"
        ],
        "done": "复用 DCL 件的新版本也要经过适用性确认才在量产生效。",
        "fail": "出厂配置不等于适用关系。"
      },
      {
        "id": "N01",
        "title": "反向：越权与已结束的征集",
        "actor": "cdc_integrator；steering；integration_tester；release；integration_admin",
        "accounts": [
          "cdc_integrator",
          "steering",
          "integration_tester",
          "release",
          "integration_admin"
        ],
        "workspace": "x89-project",
        "page": "集成版本",
        "pre": "IC01 完成（支线）。",
        "steps": [
          "cdc_integrator 不能提交 ADC；steering 不能提交制动；integration_tester 不能设模块不参加；release 不能取消征集。",
          "integration_admin 仍不能打开“发布与配置 OTA”。",
          "PLM 出测试版本 1.2.0.1：integration_tester 不能关联；把已发布的 1.1 当测试版本关联被拒绝；车辆模拟器不能把量产车 VEH-201 刷到测试版本。",
          "integration_admin 取消征集后，再提交、再关联都被拒绝（征集已结束）。"
        ],
        "done": "每一步都按一条完整授权执行。",
        "fail": "越权操作不改变任何记录。"
      }
    ]
  },
  {
    "id": "multi-model",
    "name": "多车型独立发布",
    "start": "demo",
    "scenes": [
      {
        "id": "MM01",
        "title": "为 X90 建项目、工作区与账号",
        "actor": "admin",
        "accounts": [
          "admin"
        ],
        "workspace": "x90-project",
        "page": "组织与工作区；账号与授权",
        "pre": "演示数据：X89 已有策略集 1.0.0，X90 车型已登记、还没有工作区。",
        "steps": [
          "admin 建 X90 项目与“X90 集成测试组”，建制动团队 X90 工作区（团队树制动团队节点，车型 X90，业务分组制动组）、X90 项目研发（来源制动团队 X90 工作区）和 X90 集成测试（来源 X90 项目研发）。",
          "为 X90 的业务研发、业务测试、工作区管理员、配置集成、集成测试、配置发布建账号，授权只覆盖 X90 的工作区。"
        ],
        "done": "工作区都显示车型 X90；X90 还没有任何策略集。",
        "fail": "—"
      },
      {
        "id": "MM02",
        "title": "X90 的软件、镜像与首辆实车",
        "actor": "resource；dcl；x90_admin",
        "accounts": [
          "resource",
          "dcl",
          "x90_admin"
        ],
        "workspace": "team-brake-x90",
        "page": "车辆与车辆组；软件版本与镜像",
        "pre": "MM01 完成。",
        "steps": [
          "resource 登记 X90 1.0；dcl 登记 X90 的研发镜像（无整车版本）和 1.0 镜像。",
          "x90_admin 在制动团队 X90 工作区用研发镜像建仿真 SIM-901；resource 从 TSP 登记实车 VEH-901（整车版本为空，等车辆上报）并交给该工作区；x90_admin 建“X90 制动研发车组”，加入两辆车。",
          "用 X89 的镜像为 X90 工作区建仿真：被拒绝。"
        ],
        "done": "X90 1.0 与 X89 1.0 是两个版本；X90 首车的软件版本为空。",
        "fail": "镜像、车辆不能跨车型。"
      },
      {
        "id": "MM03",
        "title": "X90 首个 Feature 从空初始配置开始",
        "actor": "x90_business；x90_tester",
        "accounts": [
          "x90_business",
          "x90_tester"
        ],
        "workspace": "team-brake-x90",
        "page": "研发 Feature；下发与测试",
        "pre": "MM02 完成。",
        "steps": [
          "x90_business 新建 x90_brake_first，加一个普通日志与“X90 急刹车”策略并提交：DCL Ready，基线是 X90 的初始研发配置。",
          "x90_tester 下发到 X90 制动研发车组，回执后先为仿真、再为整车版本未知的实车登记 PASS，确认验证通过。"
        ],
        "done": "X90 的首版开发不需要整车版本，也不依赖 X89 的策略集。",
        "fail": "—"
      },
      {
        "id": "MM04",
        "title": "X90 的集成只收 X90 的 Feature",
        "actor": "x90_integrator；dcl",
        "accounts": [
          "x90_integrator",
          "dcl"
        ],
        "workspace": "x90-project",
        "page": "配置集成 → 合并与处理确认",
        "pre": "MM03 完成。",
        "steps": [
          "x90_integrator 的可集成列表只有 x90_brake_first；试图合并 X89 的 brake_monitor：被拒绝。",
          "预览 x90_brake_first：目标为 X90 的初始配置；dcl 确认处理集合；冻结为 X90-C1，在 X90 集成测试测试。"
        ],
        "done": "候选只接收同车型的 Feature。",
        "fail": "跨车型合并被拒绝。"
      },
      {
        "id": "MM05",
        "title": "X90 候选的集成测试",
        "actor": "x90_admin；resource；x90_integration_tester",
        "accounts": [
          "x90_admin",
          "resource",
          "x90_integration_tester"
        ],
        "workspace": "x90-integration",
        "page": "配置集成 → 集成候选",
        "pre": "MM04 完成。",
        "steps": [
          "x90_admin 在 X90 集成测试用 1.0 镜像建仿真 SIM-911；resource 从 TSP 登记测试实车 VEH-911，车辆刷写 X90 1.0 后上报，交给 X90 集成测试。",
          "x90_integration_tester 把 X90-C1 下发到两辆车，回执后登记 PASS 并确认集成验证通过。"
        ],
        "done": "X90 的候选在 X90 1.0 上通过集成测试。",
        "fail": "—"
      },
      {
        "id": "MM06",
        "title": "X90 发布自己的策略集 1.0.0",
        "actor": "x90_release",
        "accounts": [
          "x90_release"
        ],
        "workspace": "x90-project",
        "page": "发布与配置 OTA → 策略集发布",
        "pre": "MM05 完成。",
        "steps": [
          "x90_release 发布 X90-C1：建议版本 1.0.0；列入 1.1（X90 没有这个版本）被拒绝；列入 X90 1.0 发布。",
          "核对 X89：它的策略集、各版本生效的策略集、车辆与 1.0 的发布记录都没有变化。"
        ],
        "done": "X90 发布 1.0 不改变 X89 的 1.0；两个车型各自从 1.0.0 编号。",
        "fail": "—"
      },
      {
        "id": "MM07",
        "title": "X90 量产车的灰度、失败重试与扩量",
        "actor": "resource；x90_admin；x90_release",
        "accounts": [
          "resource",
          "x90_admin",
          "x90_release"
        ],
        "workspace": "x90-project",
        "page": "发布与配置 OTA → 配置 OTA",
        "pre": "MM06 完成。",
        "steps": [
          "resource 登记两辆 X90 量产车 VEH-921、VEH-922（X90 1.0）交给 X90 项目研发；x90_release 建 X90 量产车组。",
          "用 X89 的策略集对 X90 车组建配置 OTA：被拒绝。",
          "用 X90 1.0.0 灰度 VEH-921：回执失败自动暂停；恢复后重试成功，再扩大到 VEH-922。"
        ],
        "done": "两辆 X90 量产车运行 X90 1.0.0，失败的尝试保留；X89 仍没有任何变化。",
        "fail": "配置 OTA 不能跨车型。"
      },
      {
        "id": "MM08",
        "title": "每个车型的发布记录只讲自己的事",
        "actor": "x90_release",
        "accounts": [
          "x90_release"
        ],
        "workspace": "x90-project",
        "page": "集成版本 → 发布记录",
        "pre": "MM07 完成。",
        "steps": [
          "打开 X90 1.0 的发布记录：有 X90 1.0.0 的发布与配置 OTA，没有 X89 的策略集。",
          "打开 X89 1.0 的发布记录：没有 X90 的策略集。"
        ],
        "done": "历史按车型隔离、保持不变。",
        "fail": "—"
      },
      {
        "id": "N01",
        "title": "跨车型操作一律拒绝",
        "actor": "admin；resource；x90_admin；x90_tester",
        "accounts": [
          "admin",
          "resource",
          "x90_admin",
          "x90_tester"
        ],
        "workspace": "x90-project",
        "page": "组织与工作区；车辆台账",
        "pre": "MM02 完成（支线）。",
        "steps": [
          "admin 建一个以 X89 团队工作区为来源的 X90 项目工作区：被拒绝。",
          "X90 车上报 1.1（只有 X89 有这个版本）：平台不认，等 PLM 发布 X90 1.1；x90_admin 把 X89 的 VEH-001 加入 X90 工作区：被拒绝。",
          "x90_tester 为 X89 的 Feature 登记结果：无权。"
        ],
        "done": "来源、车辆、软件版本、镜像与测试都按车型隔离。",
        "fail": "越权与跨车型操作不改变任何记录。"
      }
    ]
  },
  {
    "id": "plm-tsp",
    "name": "外部系统 · PLM 与 TSP",
    "start": "demo",
    "scenes": [
      {
        "id": "EX01",
        "title": "PLM 发布 X89 1.2，平台同步",
        "actor": "PLM（模拟）；release / 孙立；business",
        "accounts": [
          "release",
          "business"
        ],
        "workspace": "x89-project",
        "page": "原型工具 → PLM（模拟）；发布与配置 OTA → 软件版本与策略集",
        "pre": "演示数据：PLM 已发布 X89 1.0、1.1。",
        "steps": [
          "PLM（模拟）发布整车版本 X89 1.2，不带 DCL 件；BOM 默认取 1.1 的各模块版本。同步到平台。",
          "平台记为 PLM 已发布的 1.2；没有策略集适用，平台自动开一张适用性确认待办。",
          "business 不能补录 1.2 的软件清单；平台没有手工登记版本的入口。"
        ],
        "done": "整车版本只从 PLM 来，平台按同步结果开待办。",
        "fail": "平台不自己造整车版本。"
      },
      {
        "id": "EX02",
        "title": "PLM 版本带了平台不认识的 DCL 件",
        "actor": "PLM（模拟）；release / 孙立；dcl / 林书涵",
        "accounts": [
          "release",
          "dcl"
        ],
        "workspace": "x89-project",
        "page": "原型工具 → PLM（模拟）；通知中心",
        "pre": "演示数据。",
        "steps": [
          "PLM（模拟）发布 X89 1.3，BOM 中的 DCL 件选“平台不认识的 DCL 件（模拟错误）”。",
          "平台同步后，1.3 没有出厂配置；配置发布和 DCL 都收到“DCL 件无法识别”的提醒。"
        ],
        "done": "平台只按配置摘要认 DCL 件，认不出来就提醒人核对。",
        "fail": "不认识的件不会被当成任何策略集。"
      },
      {
        "id": "EX03",
        "title": "车辆资源从 TSP 登记车辆",
        "actor": "resource / 刘子衡；车辆模拟器",
        "accounts": [
          "resource"
        ],
        "workspace": "x89-project",
        "page": "车辆与车辆组 → 车辆台账；原型工具 → TSP（模拟）",
        "pre": "演示数据：TSP 收录了还没登记的 LSDEM0X8900000007。",
        "steps": [
          "登记一辆 TSP 里没有的车：被拒绝。",
          "从 TSP 选 LSDEM0X8900000007 登记为 VEH-007（研发、ADC）：车型 X89、车牌、T-Box 和硬件配置（激光雷达 有、座舱芯片 8295）都来自 TSP；整车版本为空。",
          "登记设备密钥后，车辆模拟器把它刷到 1.1：车端签名上报，平台记为 1.1。"
        ],
        "done": "车辆信息来自 TSP，实际版本来自车端上报。",
        "fail": "平台不手工录入车辆身份和版本。"
      },
      {
        "id": "EX04",
        "title": "TSP 应为版本与车端实为版本",
        "actor": "TSP（模拟）；车辆模拟器；resource；release",
        "accounts": [
          "resource",
          "release"
        ],
        "workspace": "x89-project",
        "page": "原型工具 → TSP（模拟）；车辆台账；通知中心",
        "pre": "演示数据。",
        "steps": [
          "TSP（模拟）把 VEH-201 的应为版本改为 1.1（整车 OTA 给它定了 1.1），同步：车辆台账显示“TSP 应为 1.1”，车端仍上报 1.0，平台按 1.0。",
          "resource 收到“与 TSP 的应为版本不一致”；release 收到“将升到 1.1，它还没有适用的策略集”。",
          "车辆模拟器刷写 1.1 时 BMS 失败：车端上报部分域控失败，平台不记整车版本。",
          "重新刷写成功：车端上报 1.1，与 TSP 一致。"
        ],
        "done": "量产和研发车一样：TSP 给应为版本，车端给实为版本，以车端为准。",
        "fail": "TSP 的应为版本永远不直接变成车辆的实际版本。"
      },
      {
        "id": "EX05",
        "title": "PLM 的整车测试版本：等征集关联，量产车不刷",
        "actor": "PLM（模拟）；integration_admin / 郑书杰；release",
        "accounts": [
          "integration_admin",
          "release",
          "resource"
        ],
        "workspace": "x89-project",
        "page": "原型工具 → PLM（模拟）；集成版本 → 集成征集",
        "pre": "EX04 完成。",
        "steps": [
          "integration_admin 为工作名 1.4 发起征集（PLM 在 EX01、EX02 已发布 1.2、1.3）；整车集成测试开始，PLM（模拟）出第 1 轮测试版本 X89 1.4.0.1：平台记为“测试版本 · 未关联”，不开适用性确认；release 为它开适用性确认被拒绝（测试版本按所属征集引用策略集）。",
          "车辆模拟器不能把量产车 VEH-201 刷到测试版本。",
          "integration_admin 收到“PLM 出了整车测试版本 1.4.0.1，还没关联到征集”的提醒；关联为整车第 1 轮后，提醒消失。征集发起之前出的测试版本不提醒。"
        ],
        "done": "每轮整车测试都有 PLM 的版本号，由集成管理员关联到征集。",
        "fail": "测试版本不进量产，也不单独确认适用。"
      },
      {
        "id": "N01",
        "title": "反向：车型不符、重复登记、越权、PLM 版本号重复",
        "actor": "resource；business；PLM（模拟）",
        "accounts": [
          "resource",
          "business"
        ],
        "workspace": "x89-project",
        "page": "车辆台账；PLM（模拟）",
        "pre": "演示数据。",
        "steps": [
          "把 TSP 里的 X90 车按 X89 登记：被拒绝；重复登记 VEH-001 的 VIN：被拒绝；business 登记车辆：无权。",
          "PLM 再发布一次 X89 1.1：被拒绝。"
        ],
        "done": "登记只认 TSP 的记录，版本号只由 PLM 给出一次。",
        "fail": "被拒绝的操作不改变任何记录。"
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
