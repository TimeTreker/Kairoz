# 验收结果（引擎层逐幕回放）

运行时间：2026-10-26T14:18:00.011Z。由 `npm run acceptance` 生成；每次重新执行，不沿用历史结果。

状态：PASS 通过；FAIL 失败；GAP 设计要求尚未实现；BLOCKED 前置幕未通过；NOT_APPLICABLE 浏览器原型不适用（如服务端部署）。

合计：PASS 205 · FAIL 0 · GAP 0 · BLOCKED 0 · NOT_APPLICABLE 3 · NOT_WRITTEN 0

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
| E11 准备并验证独立集成资源 | resource → integration_tester | PASS | 适配：剧本 VIN “LSDEMOX89000000902” 同 E05 不合规，改用合法的 17 位模拟 VIN；车辆登记后还需由车辆资源“添加车辆”加入 x89-integration。 |
| E12 登记真实来源的软件版本并正式发布DCL | resource → release | PASS |  |
| E13 导出首个配置发布材料 | release / 配置发布 | PASS | 适配：签名配置包（ZIP、Ed25519 服务端签名）需要服务端；剧本规定离线页不伪造服务端签名，原型提供“导出配置集合”JSON。 |
| E14 准备量产目标与首版恢复方案 | resource / 车辆资源 | PASS | 适配：剧本 VIN “LSDEMOX8900000090x” 同 E05 不合规，改用合法模拟 VIN；域控版本上报（reportControllerVersions）在车辆台账“域控”中登记。 |
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
| U01 售后按车和事件定位采集数据 | business / 陈明 · 业务研发；制动团队工作区；研发环境 | PASS | 适配：演示数据中 VEH-002 没有任何事件，只查它不能证明隔离；另查转向团队的 VEH-003（有事件）应同样无记录。 |
| U02 训练按策略和场景选用数据 | business / 陈明 · 业务研发；制动团队工作区；研发环境 | PASS |  |

## 客户端状态上报 · 车辆资源与 DCL 联调

| 幕 | 执行人 | 状态 | 说明 |
|---|---|---|---|
| R01 查看客户端实际状态与上报历史 | resource / 刘子衡 · 车辆资源；研发环境 | PASS |  |
| R02 离线时版本变化暂存待补报 | 车辆模拟器 · SIM-021 | PASS |  |
| R03 恢复连接后补报 | 车辆模拟器 · SIM-021；resource 核对 | PASS |  |
| R04 设备身份与签名 | resource / 车辆资源；车辆模拟器 | PASS |  |
| R05 重复、乱序与重启 | 车辆模拟器 · SIM-021 | PASS |  |

## 子系统集成 · ADC/CDC 联合演练

| 幕 | 执行人 | 状态 | 说明 |
|---|---|---|---|
| S01 ADC 泊车组研发并提交 | adc_parking / 张景然 · 业务研发；泊车团队工作区 | PASS |  |
| S02 ADC 系统应用组与 CDC 两组研发 | adc_system、cdc_hmi、cdc_app · 业务研发 | PASS |  |
| S03 域集成人员以工作区管理员审批团队测试 | adc_integrator / 梁思齐 · 工作区管理员 | PASS |  |
| S04 团队测试：先仿真后实车，交付 Verified | 各组业务测试账号 | PASS |  |
| S05 域内合并：ADC 只收本域，CDC 只收本域 | adc_integrator、cdc_integrator · 配置集成 | PASS |  |
| S06 同组两分支冲突，由维护方修复 | adc_parking、adc_parking_tester、adc_integrator | PASS |  |
| S07 DCL 确认、冻结子系统候选、域内集成测试并发布子系统 | dcl；adc_integrator、cdc_integrator（配置集成 → 集成测试 → 配置发布） | PASS |  |
| S08 整车集成、集成测试、正式发布与灰度 | integrator、dcl、integration_tester、release | PASS |  |
| N01 跨域输入被拒绝 | adc_integrator · 配置集成 | PASS | 适配：演示数据中 ADC 域集成工作区只以 ADC 团队为来源，CDC Feature 不在可选范围（SOURCE_NOT_ALLOWED）；来源可达但跨域时返回 CROSS_DOMAIN_SOURCE（见引擎测试）。 |
| N02 域账号不能整车发布或配置 OTA | adc_integrator · 配置发布（本域） | PASS |  |
| N03 子系统发布不是正式版本 | adc_integrator；release | PASS |  |
| N04 新的子系统发布包含旧的 | adc_integrator | PASS |  |

## DCL 策略集与整车软件版本 · 适用性、研发车组与紧急停用

| 幕 | 执行人 | 状态 | 说明 |
|---|---|---|---|
| P01 登记新软件版本，自动开启适用性确认 | resource / 刘子衡 · 车辆资源；release / 孙立 · 配置发布 | PASS |  |
| P02 在运行新软件的测试车上验证未变化的策略集 | dcl、integration_admin、resource 准备测试车；integration_tester / 钱思源 · 集成测试 | PASS |  |
| P03 配置发布确认适用：策略集版本号不变 | release / 孙立 · 配置发布 | PASS |  |
| P04 不兼容的软件：逐条检查指出不能运行的策略 | resource / 刘子衡；release / 孙立 | PASS |  |
| P05 新策略集版本：与上一版逐条比较 | steering / 吴泽宇；integrator / 赵一鸣；dcl / 林书涵；integration_tester / 钱思源；release / 孙立 | PASS |  |
| P06 研发车组：基线跟随车辆软件，重新下发才生效 | resource / 刘子衡；workspace_manager / 周子墨；brake_tester / 王嘉宁 | PASS |  |
| P07 开关其他分组的策略 | brake_tester / 王嘉宁 · 业务测试 | PASS |  |
| P08 基线冲突与显式基线 | steering_tester / 吴凡；resource / 刘子衡；workspace_manager / 周子墨 | PASS |  |
| P09 紧急停用一条策略 | dcl / 林书涵 · DCL 工程申请；release / 孙立 · 配置发布批准 | PASS |  |
| N01 撤销适用：车辆回到仍适用的上一套或被阻止 | release / 孙立 · 配置发布 | PASS |  |

## 公司目录与组织授权 · 基础权限与特殊权限

| 幕 | 执行人 | 状态 | 说明 |
|---|---|---|---|
| O01 新员工入职：按组织规则获得基础研发权限 | 公司目录（车辆模拟器扮演）；brake_dev2 / 何晓 · 新员工 | PASS |  |
| O02 调岗：基础权限随组织变化，显式授权待复核 | 公司目录；admin / 平台管理员 | PASS |  |
| O03 部门改名：其他一切不变 | 公司目录；admin | PASS |  |
| O04 部门合并：工作区重新挂靠 | 公司目录；admin | PASS |  |
| O05 离职：账号停用，历史保留 | 公司目录；steering / 吴泽宇 | PASS |  |
| O06 组织规则的边界 | admin / 平台管理员 | PASS |  |

## 个人研发仿真 · 草稿自测与团队测试分离

| 幕 | 执行人 | 状态 | 说明 |
|---|---|---|---|
| PS01 新建个人仿真：平台生成 UVID，软件未知 | business / 陈明 · 业务研发；制动团队工作区 | PASS |  |
| PS02 把草稿配置到个人仿真，试触发并记录自测 | business / 陈明 · 业务研发；车辆模拟器扮演仿真器 | PASS |  |
| PS03 个人仿真只属于本人，不进入团队资源 | brake_tester / 王嘉宁；workspace_manager / 工作区管理员 | PASS |  |
| PS04 敏感文件仍须 DCL 审核 | business / 陈明 · 业务研发 | PASS |  |
| PS05 软件 1.0 的个人仿真：策略集为基线，关闭其他分组策略 | business / 陈明 · 业务研发 | PASS |  |
| PS06 提交时显示自测，团队测试照常 | business / 陈明；brake_tester / 王嘉宁 | PASS |  |
| PS07 配额与释放 | business / 陈明 · 业务研发 | PASS |  |
| PS08 测试人员也可以有自己的个人仿真 | brake_tester / 王嘉宁 · 业务测试 | PASS |  |
| PS09 离职：个人仿真自动释放 | 公司目录（车辆模拟器扮演）；brake_dev2 / 何晓 · 新员工 | PASS |  |
| N01 不允许的个人仿真 | business；workspace_manager | PASS |  |

## 仿真车软件 · 模块构建、部署与回滚

| 幕 | 执行人 | 状态 | 说明 |
|---|---|---|---|
| SW01 个人仿真运行草稿并自测 | business / 陈明 · 业务研发；制动团队工作区 | PASS |  |
| SW02 构建制动模块：生成派生镜像，运行镜像不变 | business / 陈明；车辆模拟器扮演构建服务 | PASS |  |
| SW03 部署派生镜像：失败保留原状，成功后配置需重新下发 | business / 陈明；车辆模拟器扮演仿真服务 | PASS |  |
| SW04 在新镜像上重新下发并自测 | business / 陈明 | PASS |  |
| SW05 回滚镜像，只能回滚一次 | business / 陈明；车辆模拟器扮演仿真服务 | PASS |  |
| SW06 不合法的构建请求 | business / 陈明；brake_tester | PASS |  |
| SW07 共享仿真：工作区管理员切换基础镜像 | workspace_manager / 工作区管理员；business | PASS |  |
| SW08 镜像变化后，旧测试结果不再计入 | business、brake_tester、workspace_manager | PASS |  |
| N01 派生镜像不进入集成测试与镜像目录 | integration_admin、integration_tester；business、workspace_manager | PASS |  |

## 整车软件版本变化 · 通知、两层检查与四种处理

| 幕 | 执行人 | 状态 | 说明 |
|---|---|---|---|
| VC01 前置：策略集 1.0.0 确认适用于 X89 1.1 | release、integration_admin、resource、integration_tester | PASS |  |
| VC02 A：同一策略集、全部可运行——确认即可 | 车辆模拟器；business / 陈明 | PASS |  |
| VC03 未登记的版本，以及新软件没有适用的策略集 | 车辆模拟器；resource / 车辆资源；business | PASS |  |
| VC04 B：同一基线，本组文件与策略需要修改 | workspace_manager；business；brake_tester | PASS |  |
| VC05 C：新软件对应另一个策略集，本组内容未变——重新下发 | dcl、release；workspace_manager；车辆模拟器；brake_tester | PASS |  |
| VC06 D：新基线改了本组内容——在新基线上新建 Feature | 车辆模拟器；steering / 吴泽宇 | PASS |  |
| N01 谁会收到、谁不会 | steering；release；车辆模拟器 | PASS |  |

## 通知中心 · 授权投影、已读与失效

| 幕 | 执行人 | 状态 | 说明 |
|---|---|---|---|
| NC01 通知只来自授权工作区与本组 | business、steering、brake_tester | PASS |  |
| NC02 状态变化产生新的提醒 | brake_tester；business | PASS |  |
| NC03 单条已读：按账号和工作区隔离，不改变任何事务 | business；brake_tester | PASS |  |
| NC04 全部已读与未读筛选 | business | PASS |  |
| NC05 警告类事项排在前面 | dcl；adc_parking；workspace_manager；brake_tester | PASS |  |
| NC06 失效通知不能打开 | workspace_manager；brake_tester | PASS |  |

## 借用车辆 · 下发与推送、更新整车版本

| 幕 | 执行人 | 状态 | 说明 |
|---|---|---|---|
| BR01 借用目录只给选车需要的信息 | workspace_manager | PASS |  |
| BR02 申请借用：写明车辆组和最后一天 | workspace_manager；business；resource | PASS |  |
| BR03 使用方工作区先同意 | adc_integrator；resource | PASS |  |
| BR04 车辆资源批准：车辆换组 | resource；workspace_manager；adc_integrator | PASS |  |
| BR05 车辆上报：与车辆组的发布不匹配 | 车辆模拟器；business | PASS |  |
| BR06 不改策略，更新车辆的整车版本 | business；车辆模拟器 | PASS |  |
| BR07 下发与推送是两个状态 | 车辆模拟器；brake_tester | PASS |  |
| BR08 借用到期：不能再下发，延期后恢复 | 车辆模拟器；workspace_manager；resource；brake_tester | PASS |  |
| BR09 归还：软件保留，借出方收到提醒 | workspace_manager；adc_integrator | PASS |  |
| BR10 整车软件自己变了：更新回去 | 车辆模拟器；business | PASS |  |
| N01 借出期间的拒绝 | steering；adc_integrator；resource；dispatch_operator | PASS |  |

## 车辆环境迁移与组织归档

| 幕 | 执行人 | 状态 | 说明 |
|---|---|---|---|
| LV01 车辆移出车辆组后转入测试环境 | resource；workspace_manager | PASS |  |
| LV02 量产只接收运行正式策略集的车辆 | resource | PASS |  |
| LV03 量产车去台架复测再回来 | release；resource | PASS |  |
| LV04 有事务的工作区不能归档 | workspace_manager | PASS |  |
| LV05 归档后关闭，平台运维恢复 | admin；resource | PASS |  |
| LV06 归档业务分组 | workspace_manager；admin | PASS |  |
| LV07 归档组织节点 | admin | PASS |  |
| N01 越权的归档与环境变更 | workspace_manager；integration_admin | PASS |  |

## 车端故障与恢复 · 校验、签名、应用中断与回执丢失

| 幕 | 执行人 | 状态 | 说明 |
|---|---|---|---|
| DF01 配置包校验失败与签名无效 | 车辆模拟器；brake_tester | PASS |  |
| DF02 排除故障后重新下发 | 车辆模拟器；brake_tester | PASS |  |
| DF03 应用中断，恢复原配置 | 车辆模拟器；brake_tester | PASS |  |
| DF04 回执丢失与补发 | 车辆模拟器；brake_tester；resource | PASS |  |
| DF05 取消后迟到的回执 | 车辆模拟器；brake_tester；resource | PASS |  |
| N01 回执不能改写或重复确认 | 车辆模拟器 | PASS |  |

## 同软件版本配置补丁 · 主线与补丁

| 幕 | 执行人 | 状态 | 说明 |
|---|---|---|---|
| PT01 主线前进到 1.1.0，软件 1.0 仍用 1.0.0 | integrator；integration_tester；release；resource | PASS |  |
| PT02 团队在 1.0.0 上开修复 Feature | steering；steering_tester | PASS |  |
| PT03 补丁模式：合并到 1.0.0 而不是主线 | integrator；dcl | PASS |  |
| PT04 补丁在它要服务的软件上集成测试 | integration_tester | PASS |  |
| PT05 发布补丁 1.0.1：只服务软件 1.0，主线不变 | release | PASS |  |
| PT06 修复合入主线 | integrator；dcl；integration_tester；release | PASS |  |
| PT07 补丁线的门禁：目标被替换后不能发布 | steering；steering_tester；integrator；dcl；integration_tester；release | PASS |  |
| N01 补丁的权限与“不合入主线” | integration_tester；steering；integrator | PASS |  |

## 资源预算与紧急停采 · 资源保护

| 幕 | 执行人 | 状态 | 说明 |
|---|---|---|---|
| BG01 DCL 设定车型采集预算 | dcl | PASS |  |
| BG02 合并时的资源保护检查 | steering；steering_tester；integrator；dcl | PASS |  |
| BG03 高优先级的核心采集 | business；brake_tester；车辆模拟器 | PASS |  |
| BG04 超出上传预算时排队，高优先级先走 | 车辆模拟器 | PASS |  |
| BG05 触发洪峰被抑制 | 车辆模拟器；dcl | PASS |  |
| BG06 紧急暂停与恢复采集 | release；dcl；车辆模拟器 | PASS |  |
| BG07 测试车的单独预算 | dcl；车辆模拟器 | PASS |  |
| N01 预算与停采的越权 | business；brake_tester；resource；integrator；workspace_manager | PASS |  |

## 仿真运行配额

| 幕 | 执行人 | 状态 | 说明 |
|---|---|---|---|
| Q01 车辆资源设定工作区的仿真运行配额 | resource | PASS |  |
| Q02 团队与个人仿真共用配额 | business；workspace_manager | PASS |  |
| Q03 停止后腾出名额，取消限制 | workspace_manager；resource | PASS |  |
| N01 配额只由车辆资源设置 | workspace_manager；business；dcl；release；integration_admin | PASS |  |

## DCL 技术变更 · 自有技术分支交付

| 幕 | 执行人 | 状态 | 说明 |
|---|---|---|---|
| TC01 DCL 发布新的处理版本并开技术分支 | dcl | PASS |  |
| TC02 只调整处理绑定，DCL 自己提交 | dcl | PASS |  |
| TC03 本组测试验证技术变更 | steering_tester | PASS |  |
| TC04 集成、集成测试与发布 | integrator；dcl；integration_tester；release | PASS |  |
| N01 技术变更只由 DCL 工程负责 | steering；integrator；dcl | PASS |  |

## 售后与 Grader · 售后回捞与优先级仲裁

| 幕 | 执行人 | 状态 | 说明 |
|---|---|---|---|
| AS01 业务为客户案例请求售后采集 | business；brake_tester | PASS |  |
| AS02 售后优先，Grader 延后 | 车辆模拟器 | PASS |  |
| AS03 车辆执行售后采集，数据回到业务 | 车辆模拟器；business | PASS |  |
| AS04 撤回尚未执行的请求 | brake_tester；车辆模拟器 | PASS |  |
| N01 售后请求的越权 | business；dispatch_operator；resource | PASS |  |

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
