# 验收结果（引擎层逐幕回放）

运行时间：2026-10-21T04:46:13.541Z。由 `npm run acceptance` 生成；每次重新执行，不沿用历史结果。

状态：PASS 通过；FAIL 失败；GAP 设计要求尚未实现；BLOCKED 前置幕未通过；NOT_APPLICABLE 浏览器原型不适用（如服务端部署）。

合计：PASS 85 · FAIL 0 · GAP 0 · BLOCKED 0 · NOT_APPLICABLE 3 · NOT_WRITTEN 0

## 从零启动 · 角色协作

| 幕 | 执行人 | 状态 | 说明 |
|---|---|---|---|
| A01 部署服务，执行健康检查，写入测试记录后重启。 | admin / 平台运维 | NOT_APPLICABLE | 服务部署、数据库与存储健康检查、日志检索不属于浏览器原型<br>适配：浏览器原型没有服务器、数据库或部署；状态保存在浏览器本地。部署与重启在浏览器层以“重置为干净安装 + 刷新页面”核对持久化。 |
| A02 初始化管理员；安装八类内置角色，核对测试职责权限。 | admin / 平台运维 | PASS |  |
| A03 建立三个环境和公司→整车研发中心→底盘部门→制动团队；另建电池、动力团队。 | admin / 平台运维 | PASS |  |
| A04 建立brake、battery、power和hmi配置组，明确只读引用权限。 | admin / 平台运维 | PASS | 适配：跨组只读引用在 Kairoz 中按数据项申请与批准；此时还没有数据项，“读取不等于修改”由 T-N07 验证。 |
| A05 创建team-brake等TEAM区；选择车型、组织节点、分组和范围，不填项目ID。 | admin / 平台运维 | PASS |  |
| A06 授予研发、业务测试、工作区管理员、DCL、资源人员最小工作区及环境权限。 | admin / 平台运维 | PASS |  |
| A07 建立完整X89项目组织模块树，创建x89-integration，配置团队来源和集成测试人员。 | admin / 平台运维 | PASS |  |
| A08 发布普通日志/CAN双侧默认模板、敏感审核模板；登记x89-dev-r1及接入接口。 | dcl / DCL 工程 | PASS |  |
| A09 创建SIM-901，选择仿真、development、x89-dev-r1和暂无整车版本。 | workspace_manager / 工作区管理员 | PASS |  |
| A10 登记VEH-901及唯一VIN，版本留空；接收可信版本上报时另行确认。 | resource / 车辆资源 | PASS | 适配：演示 VIN 使用合法的 17 位格式（不含 I/O/Q）。 |
| A11 纳入本区，核对预约和可用状态，启动仿真并检查连接。 | workspace_manager / 工作区管理员 | PASS |  |
| B01 选择本组工作区，创建first_brake，不要求选择Bootstrap。 | business / 业务研发 | PASS |  |
| B02 登记text_log：ADC、/data/brake、debug.log、制动诊断；点击保存一次。 | business / 业务研发 | PASS |  |
| B03 定义brake_pressure>80 AND vehicle_speed>30，Capture引用逻辑data_key，窗口10/20秒并提交。 | business / 业务研发 | PASS |  |
| B04 下发固定提交到仿真，先检查Pending，成功回执后运行测试并记录PASS。 | brake_tester / 测试验证（业务测试） | PASS |  |
| B05 同一提交下发VEH-901，确认生效再验证；检查当前仿真和实车证据后标记Verified。 | brake_tester / 测试验证（业务测试） | PASS |  |
| B06 结束车辆测试任务、停止闲置仿真、释放预约，不擦除历史。 | workspace_manager / 工作区管理员 | PASS |  |
| C01 新增camera_image、pointcloud或gnss文件，申报用途及内容，创建采集策略并提交。 | business / 业务研发 | PASS |  |
| C02 审查采集范围、车端处理、上传、云端处理、保留；拒绝或批准具体策略版本并记录理由。 | dcl / DCL 工程 | PASS |  |
| C03 业务修采集范围/用途；DCL修专用处理，产生新提交，再送审核。 | business / 业务研发 | PASS |  |
| C04 下发已批准固定版本，用合成数据验证处理和上传结果。 | brake_tester / 测试验证（业务测试） | PASS | 适配：脱敏与上传边界没有真实算子；测试人员在模拟回执生效后登记基于合成样本的结论。仿真在 B06 停止，前置条件“授权仿真可用”由工作区管理员重新启动。 |
| C05 使用批准版本完成授权实车验证并交付Verified。 | brake_tester / 测试验证（业务测试） | PASS |  |
| D01 切集成工作区；核对来源TEAM区、testing池SIM-902/VEH-902。 | integrator / 配置集成 | PASS |  |
| D02 收集固定来源，预览合并；保留HMI未变配置。 | integrator / 配置集成 | PASS | 适配：电池、动力的 Verified 提交没有对应的幕；由前置夹具补齐（平台运维为 workspace_manager 增加电池/动力工作区授权，团队登记仿真与实车并完成业务验证），其中电池两个 Feature 定义同一策略、内容不同，用于检验冲突。 |
| D03 业务方统一需求修文件/策略，DCL修处理；提交新版本。 | business / 业务研发 | PASS |  |
| D04 重新下发和验证修复提交；交付新Verified证据。 | brake_tester / 测试验证（业务测试） | PASS |  |
| D05 核对最终文件、车云处理、Schema、敏感批准、资源保护，确认集合摘要。 | dcl / DCL 工程 | PASS |  |
| D06 冻结完整候选与来源清单，移交集成测试。 | integrator / 配置集成 | PASS |  |
| D07 在SIM-902、VEH-902下发冻结候选，完成整车独立测试。 | integration_tester / 测试验证（集成测试） | PASS |  |
| E01 准备正式镜像，确认量产车实际Integration Version、环境与兼容范围。 | resource / 车辆资源 | PASS |  |
| E02 核对DCL确认、敏感审批、候选测试摘要和回滚目标，Promote正式DCL集合。 | release / 配置发布 | PASS |  |
| E03 创建灰度，收到签名回执后更新实际已生效集合。 | release / 配置发布 | PASS |  |
| E04 扩大目标，监控失败比例；出现异常立即暂停并移交恢复。 | release / 配置发布 | PASS |  |
| E05 测试人员触发虚构售后事件，检查路由、采集、处理、上传、云端产物和业务回调。 | dcl / DCL 工程 | PASS |  |
| F01 暂停；显式开始新attempt，接收新PASS；无法修复时兼容回滚。 | release / 配置发布 | PASS |  |
| F02 恢复失败处理，重传分片、去重回调；旧事件继续旧Parser版本。 | dcl / DCL 工程 | PASS |  |
| F03 修文件或业务策略形成新提交；DCL按需修流程；重新审核和测试。 | business / 业务研发 | PASS |  |
| F04 记录真实组件状态；外部OTA继续完成或回滚；恢复后确认可信版本和DCL兼容。 | resource / 车辆资源 | PASS |  |
| F05 结束任务和预约、停止实例、回收配额、移出闲置资源；不移出占用资源。 | workspace_manager / 工作区管理员 | PASS | 适配：原型不建模仿真配额；“回收配额”以停止实例与解除预约体现。 |
| F06 撤销角色/工作区授权，验证旧会话和直接对象请求。 | admin / 平台运维 | PASS |  |
| F07 备份并在隔离环境恢复，检查版本、回执、事件和审计；提交运维交接。 | admin / 平台运维 | NOT_APPLICABLE | 隔离环境的数据库与存储备份恢复、恢复窗口与监控交接不属于浏览器原型<br>适配：原型以“导出 / 导入完整状态 JSON”代替数据库与存储备份恢复；监控接手不适用。 |

## 首次 OTA · 集成与发布

| 幕 | 执行人 | 状态 | 说明 |
|---|---|---|---|
| E01 部署一个独立空平台 | 终端运维人员 | NOT_APPLICABLE | 启动服务、健康检查与运行目录属于服务端部署，浏览器原型不适用<br>适配：原型没有服务端：以“干净安装”代替空平台部署；runId 记在验收结果里。 |
| E02 建立组织、车型、业务组和工作区 | admin / 平台运维 | PASS |  |
| E03 创建人员账号并关联九类角色 | admin / 平台运维 | PASS | 适配：Kairoz 要求修改共享处理目录的 DCL 授权覆盖全部工作区与分组（`*`）；本安装中“相关组及两个工作区”即全部，故授予 `*`。 |
| E04 发布普通文件的默认车端和云端处理 | dcl / DCL 工程 | PASS |  |
| E05 登记无整车版本研发镜像和团队资源 | dcl → resource → workspace_manager | PASS | 适配：剧本中的模拟 VIN “LSDEMOX89000000901” 是 18 位且含字母 O，不是合法 VIN；平台拒绝后改用合法的 17 位模拟 VIN。车辆组设为“需审批”，对应 E06/E07 的团队测试申请流程。 |
| E06 新增业务文件与事件策略并提交 | business / 业务研发 | PASS |  |
| E07 审批组下发并应用固定配置 | workspace_manager → brake_tester | PASS |  |
| E08 先仿真，再实车模型验证业务提交 | brake_tester / 业务测试 | PASS |  |
| E09 收集变更、冲突检查与合并 | integrator / 配置集成 | PASS |  |
| E10 确认处理集合并冻结首个候选 | dcl → integrator | PASS |  |
| E11 准备并验证独立集成资源 | resource → integration_tester | PASS |  |
| E12 登记真实来源的软件版本并正式发布DCL | resource → release | PASS |  |
| E13 导出首个配置发布材料 | release / 配置发布 | PASS | 适配：签名配置包（ZIP、Ed25519 服务端签名）需要服务端；剧本规定离线页不伪造服务端签名，原型提供“导出配置集合”JSON。 |
| E14 准备量产目标与首版恢复方案 | resource / 车辆资源 | PASS |  |
| E15 创建灰度并接收签名Mock回执 | release / 配置发布 | PASS |  |
| E16 扩量、失败暂停、新attempt重试 | release / 配置发布 | PASS |  |
| E17 验证数据闭环而不只验证配置安装 | dcl → 业务需求人 | PASS | 适配：业务节点、Parser 与业务需求人的数据确认未接入；以模拟器的合成事件验证配置快照、分片上传、产物与回调，真实环节记为未执行。 |
| E18 验收、交接与下一版准备 | release → admin → 各业务人员 | PASS | 适配：SQLite 备份与恢复对应原型的“导出 / 导入完整状态 JSON”。 |
| X01 敏感文件审核支线 | business → dcl → brake_tester | PASS | 适配：首次 OTA 只发布了 text_log 模板；支线开始前由 DCL 发布相机图像的敏感处理模板。 |
| X02 同业务组两个分支冲突支线 | business → brake_tester → integrator → dcl | PASS |  |
| X03 首版中途取消或回滚支线 | release → resource → dcl | PASS |  |

## 数据使用 · 售后与训练

| 幕 | 执行人 | 状态 | 说明 |
|---|---|---|---|
| U01 售后按车和事件定位采集数据 | business / 陈明 · 业务研发；制动团队工作区；研发环境 | PASS |  |
| U02 训练按策略和场景选用数据 | business / 陈明 · 业务研发；制动团队工作区；研发环境 | PASS |  |

## 反向用例 T-N01–T-N24

| 幕 | 执行人 | 状态 | 说明 |
|---|---|---|---|
| T-N01 用business登记仿真资源 → 请求拒绝，资源数与revision不变。 | DEV | PASS |  |
| T-N02 在制动工作区登记电池、X90或production资源 → 服务端逐项拒绝，不能靠换筛选绕过。 | WM | PASS |  |
| T-N03 并发登记同VIN和同资源ID → 只保留一项，失败请求无部分写入。 | VR | PASS | 适配：浏览器原型中操作逐个在事务中执行，没有并发写入；以先后两次登记同 VIN / 同 ID 验证只保留一项、失败无部分写入。 |
| T-N04 选择X90镜像创建X89车，或伪造镜像整车版本 → 车型与版本不匹配拒绝。 | WM | PASS |  |
| T-N05 相同requestId重放文件创建 → 相同data_key，只有一个身份和双侧绑定。 | DEV | PASS | 适配：原型没有网络请求与 requestId；以重复提交同一文件创建来验证：被拒绝且返回已有的 data_key，只有一个身份与一份双侧绑定。 |
| T-N06 注入云端策略创建失败，再并发创建同来源文件 → 全事务回滚或复用同一身份；没有孤立文件/单侧策略。 | DEV | PASS |  |
| T-N07 读取授权电池文件后尝试修改其定义或绑定 → 读取允许，修改拒绝且原版本不变。 | DEV | PASS |  |
| T-N08 未审核camera/pointcloud/GNSS，或仅完成一般接入后直接下发 → 禁止采集；普通Ready不能替代敏感批准。 | DEV | PASS |  |
| T-N09 把含敏感内容文本标成普通日志或改低等级 → 平台规则仍要求审核；用户不能自行放行。 | DEV | PASS |  |
| T-N10 批准后修改文件范围、车云处理、上传或保留规则 → 新提交审批失效，需按影响重审及重测。 | DCL | PASS |  |
| T-N11 升级默认模板后解析旧提交和旧事件 → 固定旧模板版本，不追随latest。 | DCL | PASS |  |
| T-N12 无变化再次提交，或仅更改软件Build → 复用原提交和DCL版本；实际配置变更才新建。 | DEV | PASS | 适配：Kairoz 的 DCL 版本只来自正式发布，不随软件 Build 产生；“仅改 Build 不出新版本”自然成立。 |
| T-N13 仅下发身份记录PASS或业务测试身份测试整车候选 → 拒绝职责越权。 | TEST | PASS |  |
| T-N14 回执Pending或车上旧配置时写当前提交PASS → 拒绝，实际生效版本与测试目标必须一致。 | TEST | PASS |  |
| T-N15 Feature发量产；候选发研发或量产；正式Release发不兼容车型/版本 → 逐类目标门禁拒绝，无半批应用。 | REL | PASS |  |
| T-N16 有冲突冻结候选，或集成人员代改维护方策略 → 拒绝；修复新提交重验再合并。 | INT | PASS |  |
| T-N17 候选未获最终DCL确认就绑定测试车辆 → 拒绝候选测试；来源Ready不等于集合确认。 | TEST | PASS |  |
| T-N18 未获集合确认、摘要漂移或无当前候选测试即发布 → 拒绝，已审批已测试内容必须与发布摘要一致。 | REL | PASS |  |
| T-N19 FAIL后新attempt成功；同attempt矛盾回执；旧attempt迟到 → 新尝试PASS接受，旧失败保留；矛盾和过期回执拒绝。 | REL | PASS |  |
| T-N20 重传相同分片、篡改checksum、重复产品回调 → 正常重传幂等；坏校验拒绝；产品及业务回调不重复。 | DCL | PASS |  |
| T-N21 撤销授权后继续使用旧token访问同一对象 → 请求拒绝，历史记录保留，不写业务数据。 | OPS | PASS |  |
| T-N22 量产车部分ECU升级失败，却申报整体版本成功 → 量产目标不放行，记录真实状态，交外部OTA完成或回滚。 | VR | PASS |  |
| T-N23 运行实例或仍有任务/下发/预约时移出资源 → 拒绝，结束占用后才移出。 | WM | PASS |  |
| T-N24 真正新装平台初始化时自动载入演示组织/资源/账号 → 仅保留管理员及内置角色；样例夹具必须显式加载。 | OPS | PASS |  |
