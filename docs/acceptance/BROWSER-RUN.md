# 验收记录（浏览器逐幕重放）

记录号 KZ-ACC-20261021045306，2026-10-21 在浏览器原型（`npm run dev`）中按剧本逐幕操作，每幕以剧本中的账号登录、只用页面完成动作，结果记在“原型工具 → 流程验收（逐幕）”面板。车辆回执、事件和外部服务由“车辆模拟器”扮演，剧本里的终端命令（mock_receipt.mjs、curl）也由它代替。面板记录是执行人的陈述，没有签名；引擎层的自动重放见 [RESULTS.md](RESULTS.md)。

范围：首次 OTA 全部 18 幕与 X01–X03 三条支线（从干净安装开始），数据使用 U01–U02（演示数据）。从零启动 41 幕和反向用例 T-N01–T-N24 只在引擎层重放，本次没有在浏览器中逐幕操作。

| 剧本 | 幕 | PASS | FAIL | 不适用 |
|---|---|---|---|---|
| 首次 OTA · 集成与发布 | E01–E18、X01–X03 | 20 | 0 | 1（E01） |
| 数据使用 · 售后与训练 | U01–U02 | 2 | 0 | 0 |

U02 首次重放为 FAIL（导出清单没有 MOCK 标识、训练查询没有车型筛选），修复后重放通过；两次结果都留在面板历史中。

## 首次 OTA · 集成与发布

| 幕 | 执行人 | 结果 | 证据与说明 |
|---|---|---|---|
| E01 部署一个独立空平台 | admin | 不适用 | 原型工具 → 重置为干净安装；登录页只有 admin。服务启动、健康检查与运行目录属于服务端部署，浏览器原型不适用。 |
| E02 建立组织、车型、业务组和工作区 | admin | PASS | org-company → org-center → org-chassis → org-brake，org-hmi；车型 X89；分组 brake（Chassis，chassis.brake）、hmi（HMI，hmi.display）；TEAM team-brake；项目 proj-x89 及底盘、HMI 子节点；INTEGRATION x89-integration（分组 brake + hmi，范围 Vehicle，来源 team-brake）。切换工作区时面包屑只显示对应架构；没有正式版本，未手填 Bootstrap。 |
| E03 创建人员账号并关联九类角色 | admin | PASS | 逐个创建 business、brake_tester、workspace_manager、dcl（`*` 授权，见适配）、resource、integrator、integration_tester、release 及其授权；integration_tester 登录后落在 x89-integration。越权由导航隐藏，引擎拒绝在引擎层 E03 验证。 |
| E04 发布普通文件的默认车端和云端处理 | dcl | PASS | 发布 startup-edge@1、startup-cloud@1 与 template-text_log@1（text · opaque-text_log@1，P1，30 天，无需审核）；版本号由平台生成；其余类型显示“无模板（禁止新增文件）”。 |
| E05 登记无整车版本研发镜像和团队资源 | dcl → resource → workspace_manager | PASS | 镜像 x89-dev-first（无整车版本）；SIM-901 运行中；VEH-901 的剧本 VIN `LSDEMOX89000000901`（18 位、含 O）被拒，改用 `LSDEMX89000000901`；“制动首版验证组”（下发需审批）加入 SIM-901、VEH-901。 |
| E06 新增业务文件与事件策略并提交 | business | PASS | Feature first-brake，基线“初始研发配置”；文件“制动诊断日志”（ADC /data/brake debug.log）由平台生成 data_key 与代码 chassis.brake.debug，并自动绑定双侧处理；策略 chassis.brake.brake_debug；提交 r001 → DCL Ready；向验证组申请团队测试 → PENDING，未产生下发。 |
| E07 审批组下发并应用固定配置 | workspace_manager → brake_tester | PASS | 工作台提示 1 条待决申请；批准（备注“首版封闭Mock验证”）；需审批的组只能走申请；执行 → 下发 PENDING，车上已生效配置未变；模拟器回执两车 → 下发完成，两车已生效 r001。 |
| E08 先仿真，再实车模型验证业务提交 | brake_tester → business | PASS | 先登记 VEH-901 被拒“须先有仿真测试通过”；SIM-901、VEH-901 先后 PASS（绑定 r001）→ Verified。business 改草稿不提交，头提交仍为 r001。适配：原型不建模“结束资源任务 / 恢复 default”。 |
| E09 收集变更、冲突检查与合并 | integrator | PASS | 草稿有未提交修改时仍收集已验证的 r001；预览 Ready：chassis.brake Added +2，hmi.display 继承；无冲突；没有生成候选或版本。 |
| E10 确认处理集合并冻结首个候选 | dcl → integrator | PASS | DCL 确认绑定预览摘要并留下理由；冻结 X89-C1（目标“无（首次集成）”即 Initial），独立配置快照；first-brake 变为 Integrated；集成测试从零开始。 |
| E11 准备并验证独立集成资源 | resource → integration_tester | PASS | SIM-902（x89-dev-first，testing）；VEH-902 的剧本 VIN 同样被拒，改用合法 VIN 后加入 x89-integration；首版候选直投两台软件未知的车辆，回执后先仿真后实车 PASS → 候选 Verified；车辆软件版本仍为空。 |
| E12 登记真实来源的软件版本并正式发布 DCL | resource → release | PASS | 软件版本 X89 1.0（来源“MOCK 外部软件发布记录”），没有车辆因此改变；晋升 DCL 1.0.0，适用 X89 1.0；候选 Released，first-brake Archived；车辆已生效配置未被发布改写。 |
| E13 导出首个配置发布材料 | release | PASS | 导出 DCL_X89_1.0.0_config.json（prototype true、productionInstallable false、固定提交、文件、策略与处理引用），SHA-256 `4a2b0313…c3265`。不适用：签名 Mock 配置包需要服务端，原型不伪造签名。 |
| E14 准备量产目标与首版恢复方案 | resource | PASS | VEH-903/904（production，合法 VIN）加入 x89-integration；在车辆台账“域控”上报 ADC 1.0 / BMS 1.0 PASS → 软件 1.0、CONSISTENT；已生效配置为空；首版没有可回滚的上一正式配置。 |
| E15 创建灰度并接收签名 Mock 回执 | release | PASS | 新灰度：目标 VEH-903、VEH-904，首批只有 VEH-903；模拟器回执 → VEH-903 已生效 DCL 1.0.0，软件仍为 1.0，可扩量。适配：签名回执与节点公钥属于服务端。 |
| E16 扩量、失败暂停、新 attempt 重试 | release | PASS | 扩量 VEH-904；失败回执 → 自动暂停，VEH-904 保持原配置，配置请求回答“暂停同步（保持）”；首版回滚禁用；恢复后 VEH-904 attempt 0→1，#0 FAILED 保留；重试成功 → 完成。 |
| E17 验证数据闭环而不只验证配置安装 | dcl（business 核对可见性） | PASS | VEH-903 触发 BrakeDebug：事件快照含 VIN、软件 1.0、DCL 1.0.0、提交、策略版本与处理引用；4 个分片带校验上传，重传幂等，篡改被拒；云端完成，业务回调只送达一次。dcl 可查，business 无 production 授权看不到。不适用：MP-08 隔离服务、真实 Parser 与业务节点。 |
| E18 验收、交接与下一版准备 | release → admin → business | PASS | 核对发布、合并、确认、测试与两车状态；“导出状态 JSON → 重置为干净安装 → 导入”后状态逐字一致；新 Feature 以 DCL 1.0.0 为基线。结论是首版 Mock 流程通过，不是量产 OTA 上线通过。 |
| X01 敏感文件审核支线 | business → dcl | PASS | location.log 不能声明为 Text log；GNSS 先要 DCL 发布 gnss-edge@1 / gnss-cloud@1 / template-gnss@1；r001 待审 → 拒绝（附原因）→ 缩小范围，r002 重新审核 → 批准 → DCL Ready；改保留期 60 天的 r003 需重审，改回 30 天的 r004 复用批准。重新下发验证同 E07/E08，未重复。 |
| X02 同业务组两个分支冲突支线 | business → … → integration_tester | PASS | 在 DCL 1.0.0 上 first-alt（post 25）与 first-tune（post 15）都 Verified；合并显示 postSeconds 冲突，不能冻结；first-tune 改为 25（r002），重新测试验证 → 新预览 Ready，旧预览“已取代”；冻结 X89-C2；软件未知的车辆被拒，换 SIM-903（x89-1.0-sim）与 VEH-902（上报 1.0）后集成测试通过。 |
| X03 首版中途取消或回滚支线 | release → resource | PASS | 首版回滚禁用；发布 DCL 1.0.1 后灰度 VEH-903，暂停（附原因）→ 回滚：原灰度 Rolled back，新回滚 OTA 收到回执前车辆仍是 1.0.1，回执后回到 1.0.0；VEH-904 域控部分失败 → 量产下发被阻止，软件补完后恢复 CONSISTENT。不适用：出厂安全配置包与车端禁采。 |

## 数据使用 · 售后与训练（演示数据）

| 幕 | 执行人 | 结果 | 证据与说明 |
|---|---|---|---|
| U01 售后按车和事件定位采集数据 | business | PASS | 按 VEH-001 或 VIN 查到 4 条；按“处理失败诊断”只剩 1 条（ParserFailure）；详情含文件双侧状态与捕获时配置快照，没有“被哪些提交使用”字段；VEH-002 与转向团队的 VEH-003 都查不到。 |
| U02 训练按策略和场景选用数据 | business | PASS（首次 FAIL） | 无车辆身份筛选与列；车型 X89 + brake.monitor + 急刹车 + 质量 A → 2 条，导出清单 `mock: true`、每项 `origin: MOCK_SAMPLE`，不含车辆身份；“全部（含原因）”下失败、质量未知、用途待确认的记录不能选用。 |

## 重放发现与处理

| 幕 | 发现 | 处理 |
|---|---|---|
| U02 | 训练数据清单没有 MOCK / 来源标识；训练查询没有车型筛选 | 已修：清单增加 `mock` 与逐项 `origin`，查询增加车型筛选与“来源”列；引擎重放与单元测试同步检查 |
| E02 | 组织页所有弹窗标题都是“保存” | 已修：按动作显示标题 |
| E05 | 登记镜像不能填写带标注的 `sha256:mock-…` 摘要 | 已修：增加可选摘要字段，留空时由平台生成 |
| E07 | 管理员的审批列表看不到申请绑定的提交 | 已修：增加“提交”列，申请已不是最新提交时标出 |
| E08 | 草稿修改后页头只显示“草稿”，看不出已验证提交仍可被集成 | 已修：提示仍会收集哪个已验证提交，以及提交草稿需重新验证 |
| E11 | 只直投车辆时弹窗仍叫“按车辆组下发”，明细的车辆组列为空 | 已修：标题随内容变化，直投目标标“直投” |
| E12 | 首版晋升把适用软件标为“无集成测试”，与首版豁免不符；归档时未提交的草稿修改没有提示 | 已修：首版显示“首版免逐版本测试”；归档 Feature 上提示未提交修改已冻结 |
| E16 | 回滚不可用的原因只有英文悬停提示；模拟器对重试显示 OTA 创建时间 | 已修：暂停时直接显示原因与可走的路径；模拟器显示本次尝试开始时间 |
| E18 | 有正式发布后，新建 Feature 仍提示“从初始研发配置开始” | 已修：提示实际基线 DCL 版本 |
| X01 | 敏感类型的模板表单显示“需要审核”未勾选（发布时强制勾选）；已批准文件仍显示“批准” | 已修：敏感类型显示已勾选且不可改；已批准文件只保留“撤回批准” |
| X02 | 源 Feature 有新提交后，旧预览没有过期提示；下发弹窗列出不合格车辆，提交后才整体拒绝 | 已修：旧预览提示来源已变化并隐藏确认 / 冻结；弹窗中不合格车辆不可选并写明原因 |
| X03 | 回滚原因覆盖了暂停原因的显示 | 未改：审计日志保留两者 |
| U01 | 演示数据中 VEH-002 没有事件，剧本的越权查询单独证明不了隔离 | 引擎重放与本记录补查 VEH-003 |
| E05、E11、E14 | 剧本中的模拟 VIN 不合规（18 位、含 O） | 平台正确拒绝；改用合法模拟 VIN，写入场景说明 |
| 演示准备 | 中文界面下有 56 个错误码没有中文标签，拒绝时的逐项原因（如 `SIM-902: software version unknown`）一律为英文 | 已修：全部错误码有中英标签（测试会检查新增的错误码），逐项原因按句式给出中文读法并保留车辆、分组等主体 |
