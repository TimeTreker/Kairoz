// How Kairoz plays each scene where it differs from the original platform: a browser-only
// prototype with simulated vehicles. Shown in the acceptance panel and in the engine replay report.

export const SCRIPT_NOTES: Record<string, string> = {
  startup: '从“原型工具 → 重置为干净安装”开始。车辆回执、事件与外部服务由车辆模拟器扮演；服务端部署、数据库备份等幕记为不适用。',
  'first-ota': '从“原型工具 → 重置为干净安装”开始。剧本中的终端命令（mock_receipt.mjs、curl）由车辆模拟器与平台页面代替；签名配置包需要服务端，原型只导出配置集合 JSON。',
  'data-usage': '使用演示数据（原型工具 → 重置为演示数据）。样例事件日期固定为 2026-10-18。',
  'domain-integration': '使用演示数据（ADC、CDC 域集成工作区与 adc_integrator / cdc_integrator 已建立）。原型没有“用户中心切换身份”：账号的各项授权同时生效，每个动作仍只由一条完整授权放行。',
  'client-report': '使用演示数据。车端客户端由车辆模拟器扮演，设备签名为 Mock（可伪造），不代表真实设备认证；剧本中的 Mock 控制台与 curl 由模拟器按钮代替。',
  'policy-sets': '使用演示数据。软件清单为 Mock（车辆资源按可信来源登记信号与数据源）；兼容性检查只核对信号名与数据源目录，不代表真实软件验证。',
  'personal-simulation': '使用演示数据。车辆回执与试触发由车辆模拟器扮演仿真器；试触发不上传、不处理，只给创建人看。镜像构建与切换不在本剧本内。',
  'sim-software': '使用演示数据。构建服务（模拟 CI）与仿真服务由车辆模拟器扮演：不下载源码、不执行命令，仓库地址只作记录；构建与部署结果通过模拟器按钮给出。',
  'software-change': '使用演示数据。车辆的整车软件 OTA 由车辆模拟器扮演（“模拟整车软件 OTA”），平台只从车辆签名的上报中得知；软件清单为 Mock。',
  borrowing: '使用演示数据。车辆上报、整车 OTA 系统和时间推进由车辆模拟器扮演；签名为 Mock。借用到期按平台日期（真实时间加模拟推进）判断。',
  lifecycle: '使用演示数据。真实车队的环境迁移还需线下资源移交与设备凭证接入，原型只记录平台侧的环境、原因和审计；归档不删除任何历史数据。',
  'device-faults': '使用演示数据。车端故障由车辆模拟器扮演（对应 v0.13 Mock 的 Checksum、无效签名、ApplyInterrupted、DropReceipt；Offline 即“在线”开关）：没有真实配置包、签名或设备，只演练平台如何处理失败回执、丢失回执与补发。',
  notifications: '使用演示数据。通知由授权数据中的当前事项生成，已读保存在平台状态中并按账号、工作区隔离；不提供后台推送、邮件或跨设备同步。',
  quota: '使用演示数据。配额按工作区计算同时运行的仿真（团队与个人一起，借入的仿真算在借用方）；只限制运行，不限制登记。',
  budget: '使用演示数据。车端代理的预算核算与车辆确认由车辆模拟器扮演；数据速率按文件类型的名义值估算，真实 CPU、内存与带宽需要台架验证。滚动一小时按平台时间（含模拟推进）计算。',
  patch: '使用演示数据。主线 1.1.0 由剧本自己建立（集成测试车辆在 1.1 上由仿真镜像与车辆资源确认准备）；车辆回执与配置 OTA 回执由车辆模拟器扮演。',
  'org-directory': '使用演示数据。公司目录由车辆模拟器扮演（真实系统中是 HR、LDAP/AD 或 SCIM 推送）；自动运行时每一步同步，也可手动“同步到平台”。',
};

/** Keyed by script and scene, e.g. 'first-ota/E05'. */
export const SCENE_NOTES: Record<string, string> = {
  'domain-integration/N01': '演示数据中 ADC 域集成工作区只以 ADC 团队为来源，CDC Feature 不在可选范围（SOURCE_NOT_ALLOWED）；来源可达但跨域时返回 CROSS_DOMAIN_SOURCE（见引擎测试）。',
  'startup/A01': '浏览器原型没有服务器、数据库或部署；状态保存在浏览器本地。部署与重启在浏览器层以“重置为干净安装 + 刷新页面”核对持久化。',
  'startup/A04': '跨组只读引用在 Kairoz 中按数据项申请与批准；此时还没有数据项，“读取不等于修改”由 T-N07 验证。',
  'startup/A10': '演示 VIN 使用合法的 17 位格式（不含 I/O/Q）。',
  'startup/C04': '脱敏与上传边界没有真实算子；测试人员在模拟回执生效后登记基于合成样本的结论。仿真在 B06 停止，前置条件“授权仿真可用”由工作区管理员重新启动。',
  'startup/D02': '电池、动力的 Verified 提交没有对应的幕；由前置夹具补齐（平台运维为 workspace_manager 增加电池/动力工作区授权，团队登记仿真与实车并完成业务验证），其中电池两个 Feature 定义同一策略、内容不同，用于检验冲突。',
  'first-ota/E01': '原型没有服务端：以“干净安装”代替空平台部署；runId 记在验收结果里。',
  'first-ota/E03': 'Kairoz 要求修改共享处理目录的 DCL 授权覆盖全部工作区与分组（`*`）；本安装中“相关组及两个工作区”即全部，故授予 `*`。',
  'first-ota/E05': '剧本中的模拟 VIN “LSDEMOX89000000901” 是 18 位且含字母 O，不是合法 VIN；平台拒绝后改用合法的 17 位模拟 VIN。车辆组设为“需审批”，对应 E06/E07 的团队测试申请流程。',
  'first-ota/E11': '剧本 VIN “LSDEMOX89000000902” 同 E05 不合规，改用合法的 17 位模拟 VIN；车辆登记后还需由车辆资源“添加车辆”加入 x89-integration。',
  'first-ota/E14': '剧本 VIN “LSDEMOX8900000090x” 同 E05 不合规，改用合法模拟 VIN；域控版本上报（reportControllerVersions）在车辆台账“域控”中登记。',
  'first-ota/E13': '签名配置包（ZIP、Ed25519 服务端签名）需要服务端；剧本规定离线页不伪造服务端签名，原型提供“导出配置集合”JSON。',
  'first-ota/E17': '业务节点、Parser 与业务需求人的数据确认未接入；以模拟器的合成事件验证配置快照、分片上传、产物与回调，真实环节记为未执行。',
  'first-ota/E18': 'SQLite 备份与恢复对应原型的“导出 / 导入完整状态 JSON”。',
  'startup/F05': '原型不建模仿真配额；“回收配额”以停止实例与解除预约体现。',
  'startup/F07': '原型以“导出 / 导入完整状态 JSON”代替数据库与存储备份恢复；监控接手不适用。',
  'negative/T-N03': '浏览器原型中操作逐个在事务中执行，没有并发写入；以先后两次登记同 VIN / 同 ID 验证只保留一项、失败无部分写入。',
  'negative/T-N05': '原型没有网络请求与 requestId；以重复提交同一文件创建来验证：被拒绝且返回已有的 data_key，只有一个身份与一份双侧绑定。',
  'negative/T-N12': 'Kairoz 的 DCL 版本只来自正式发布，不随软件 Build 产生；“仅改 Build 不出新版本”自然成立。',
  'data-usage/U01': '演示数据中 VEH-002 没有任何事件，只查它不能证明隔离；另查转向团队的 VEH-003（有事件）应同样无记录。',
  'first-ota/X01': '首次 OTA 只发布了 text_log 模板；支线开始前由 DCL 发布相机图像的敏感处理模板。',
};
