# Kairoz 架构说明（第一、二切片）

## 1. 为什么重写

原型 v0.13 的业务设计完整，但工程形态不适合继续演进：

- 整个平台状态存为一个 JSON 大对象，只有一个全局 revision，任何人写入都会让其他人的待提交写入冲突。
- 浏览器端运行完整领域模型，服务端再重放一次；本地 SQLite 服务与托管 D1 服务是两份已经分叉的实现。
- 代码为压缩式长行写法（单文件 100–190 KB），`model.js → model-v3 → model-v4` 层层叠加，并通过临时改写当前角色复用旧逻辑。
- 错误统一返回 403，消息只有中文字符串，没有错误码。

Kairoz 保留原型的业务规则，重新设计工程结构。

## 2. 技术栈

| 层 | 选择 | 说明 |
|---|---|---|
| 运行时 | Node.js 24 | 直接运行 TypeScript（type stripping），无构建步骤；代码只使用可擦除语法 |
| HTTP | Fastify 5 | |
| 校验 | zod 4 | 请求体严格校验，未知字段拒绝 |
| 数据库 | PostgreSQL 18，`pg` 驱动 | 手写 SQL；不使用 ORM |
| 类型检查 | TypeScript 7 | `tsc --noEmit` |
| 测试 | `node:test` | 真实 Postgres，每个测试文件独立 schema |

## 3. 分层

```
routes.ts   HTTP：路径、zod 校验、选择 reader / writer
service.ts  应用逻辑：加载对象 → 授权 → 业务规则 → SQL 写入
domain/     纯函数：授权判定、词汇表、触发表达式、数据源与 glob、配置差异、摘要
```

- **reader**：使用连接池读取；不审计。
- **writer**：在一个事务中依次执行：重新加载当前账号（`FOR SHARE`）→ 认领幂等键 → 业务逻辑 → 写入审计 → 保存幂等结果 → 提交。被拒绝的请求事务回滚后，另行写入 `DENIED` 审计。
- 服务端是唯一权威；浏览器以后只调用 API，不再运行领域模型。

## 4. 关键设计决策

### 4.1 单条完整授权

每个 grant 行是一条完整授权：`role + workspaces + groups 或 scopes + envs`。操作要求**同一条** grant 同时满足角色、工作区、业务分组或范围、环境；不同 grant 不拼接。

每个操作都声明所需环境：配置编写类操作需要 `development`；账号、组织、工作区、处理目录等平台级操作需要 grant **同时包含三个环境**，因此仅有部分环境的管理员无法管理账号，也无法授出超出自身范围的权限。目标中的 `*` 表示“影响全部”，只有通配授权才能满足，例如修改共享处理目录要求 DCL 工程的工作区与分组均为 `*`；跨多个业务分组的来源重叠判定同样要求覆盖全部分组的授权。拒绝原因区分 `ROLE_NOT_GRANTED`、`WORKSPACE_NOT_GRANTED`、`GROUP_NOT_GRANTED`、`SCOPE_NOT_GRANTED`、`ENV_NOT_GRANTED`；各项条件分别能被不同 grant 满足、但没有一条全部满足时返回 `NO_SINGLE_GRANT`。

| 角色 | 维度 |
|---|---|
| 业务研发、业务测试、DCL 工程 | 业务分组（`*` 表示全部） |
| 集成测试、配置集成、配置发布、车辆资源 | 范围（`Vehicle` 或域，`Vehicle` 不自动包含域） |
| 工作区管理员、平台运维 | 仅工作区与环境；平台运维的工作区必须为 `*` |

读取业务配置单独判定：平台运维和工作区管理员不因管理职责获得配置内容读取权；范围类角色可读取其域或整车范围内的分组配置。

修改授权或停用账号会递增 `auth_version` 并删除会话。系统始终保留至少一个在三个环境都有平台运维授权的启用账号。

### 4.2 并发与幂等

- 每个可修改对象有自己的 `revision`；修改必须带 `expectedRevision`，不一致返回 `409 REVISION_CONFLICT` 和当前 revision，不自动覆盖他人修改。
- 写请求可带 `Idempotency-Key`。幂等记录与业务数据在同一事务提交：重放返回已提交的结果（响应头 `idempotent-replayed: true`）；同一个键用于不同请求内容返回 `IDEMPOTENCY_KEY_REUSED`。
- 版本号分配用事务级 advisory lock 串行化。

### 4.3 数据身份

- `data_key`（如 `dk_01k…`）由平台生成，不由路径、文件名或命名约定推导；`data_code` 为可读代码（`<分组代码>.<文件名主干>`）。
- 来源（域控、目录、文件匹配规则）完全相同：本组复用原身份；他组已登记则拒绝（`DATA_SOURCE_OWNED_ELSEWHERE`），不能通过重新登记绕过读取授权。
- 同域控同目录、匹配规则存在交集（精确的 `*` / `?` glob 交集判定）时进入 `REVIEW`，需 DCL 工程判定“不同数据”或“重复”后才能提交。同一目录的登记与释放用 advisory lock 串行化，并发登记也能检出重叠。
- 从草稿移除文件时，若该数据身份从未提交、也没有其他 Feature 草稿引用，则释放登记，避免废弃草稿长期占用来源。

### 4.4 处理绑定与审核要求

- 处理版本（`code@version`）不可变，一个 code 只属于车端或云端之一。
- 每类文件的默认模板绑定车端 / 云端处理版本；干净安装没有模板，缺少模板时添加文件明确失败（`TEMPLATE_MISSING`）。
- 文件加入草稿时固定当时的模板绑定；之后模板升级不会让已有文件漂移。
- 敏感类型（图像、视频、点云、GNSS）和未知类型的模板强制需要审核；文件匹配规则显示为敏感类型时不能申报为普通日志。含通配符、可能匹配敏感扩展名的规则（如 `front_*.mp?`、`*`）无论申报为何种类型都需要审核。P2/P3 或含 `location / identity / image / voice / sensitive` 标签的文件也需要审核。

### 4.5 Feature、提交与不可变版本

- Feature 持有其业务分组文件列表与策略的**完整工作副本**；保存草稿不产生版本。
- 提交时为每个文件生成 FileSpec 版本、为每个策略生成 Policy 版本、为文件列表生成 Manifest 版本，均以规范化 JSON 的 SHA-256 内容寻址：内容不变则复用已有版本。
- 草稿与上次提交完全一致时复用上次提交，不产生重复提交。
- 提交显示名为 `基线 / 分组代码 / Feature 名 / r序号`，例如 `initial / chassis.brake / guided_brake / r001`；它不是主键。
- 普通内容提交后自动 `DCL_READY`；含需审核文件、且没有现行批准时停在 `SUBMITTED`，进入 DCL 接入队列（见 4.7）。
- 编辑已提交的 Feature 回到 `DRAFT`；历史提交不受影响。
- 策略 ID 以所属分组代码为命名空间（如 `chassis.brake.hard_braking`）；分组代码之间不得互为点分前缀（`GROUP_CODE_NESTED`），已提交策略的归属以记录为准；触发条件经语法校验（比较、`AND / OR / NOT`、括号），采集窗口前后合计不超过 120 秒，采集项必须在本组文件列表中。

### 4.6 组织与工作区

- 团队组织与项目组织是两棵独立的树（同一张表，`kind` 区分）；移动只能在同一棵树内，不得形成环。同一棵树的移动串行执行，祖先查询带环检测；移动若使某个 TEAM 工作区的分组落到团队之外则拒绝。项目创建时自动建立同 ID 的项目根节点。
- 工作区类型决定所在的树：TEAM 位于团队节点、`project_id` 为空；PROJECT / INTEGRATION 位于已成立项目的节点，项目由节点推导。
- TEAM 工作区使用本团队子树内的分组，不声明来源；项目工作区只使用本项目组织下的分组，通过显式来源（同车型、启用中）收集团队变更。
- 工作区管理员可在本工作区节点及其下级、且在工作区范围内的域中创建业务分组，新分组加入该工作区；创建分组不授予任何人权限。测试用途分组不能维护文件和策略。

### 4.7 DCL 接入（第二切片）

- **接入队列**（`GET /intake`）：处于 `SUBMITTED` 的 Feature 及其待审核文件、等待来源重叠判定的数据身份；按 DCL 工程的单条授权过滤。
- **敏感审核针对已提交内容**：审核对象是 Feature 当前头提交中的具体文件，请求必须带 `commitId`，头提交已更新则返回 `STALE_COMMIT`。
- **批准绑定内容签名与使用场景，不绑定 Feature**：决定只在被审核 Feature 所属的业务分组与工作区内生效，不会改变其他分组或其他工作区的 Feature，即使内容完全相同。
  - 文件签名覆盖来源、类型、用途、隐私等级、保留期、内容标签、模板与车端 / 云端处理绑定；显示名和优先级不在其中。
  - 策略签名覆盖所有采集该文件的策略的触发条件、前后窗口和同时采集的文件。
  - 任一项变化都会产生新签名，原批准不再适用。
- **最新决定生效**：同一分组、工作区、签名以最新一次决定为准（按写入序号，而不是事务开始时间），因此拒绝会撤销同内容的旧批准。拒绝时被审核的 Feature 回到 `DRAFT` 并收到反馈；同一范围内头提交采集同一数据的已提交 Feature 会重新判定阶段。
- **串行化**：审核、提交和撤销引用都先获取所属分组的接入锁，再锁定 Feature 行，因此提交与并发的拒绝不会得到不一致的阶段，也不会死锁。
- **批准门槛**：须确认用途、采集范围、保留期，并说明访问、上传和处理控制，同时绑定必须兼容。控制记录是准入证据，真实脱敏和保留执行仍需外部引擎验证。
- **批准复用**：内容与已批准签名一致的提交直接 `DCL_READY`，同一内容不重复审核。
- **退回**：DCL 可把接入中的 Feature 退回 `DRAFT`，必须填写原因。
- **提交前完整检查**：即使草稿与上次提交相同、复用头提交，也会先完成全部提交检查（例如引用授权是否仍有效）。DCL 已对该提交提出修改要求（退回、调整绑定或引用被撤销）时，原样再次提交会被拒绝（`CHANGES_REQUESTED`）。
- **调整处理绑定**：DCL 可修改草稿中文件的处理绑定（format、schema、车端 / 云端处理版本），Feature 回到 `DRAFT` 并附反馈，由业务方重新提交。同类型的后续业务编辑保留 DCL 的绑定。
- 原型中的独立“技术 Feature”需要以正式版本为基线，留到发布切片实现。

### 4.8 跨组只读引用（第二切片）

- **可引用数据目录**（`GET /workspaces/:id/groups/:groupId/catalog`）列出其他分组已提交的数据身份。未获授权时只显示名称、维护组和状态；来源路径、代码和处理定义保持隐藏。
- **申请与决定**：读取方分组的业务研发提出申请，需要填写理由。数据所属分组的业务研发决定批准或拒绝，平台运维也可以处理；申请方不能批准自己的申请。每个数据身份与读取分组之间同时只有一条进行中的申请或有效授权。
- **固定版本引用**：草稿的 `references` 部分记录 `data_key → 对方 FileSpec 版本`，引用时取对方最新已提交版本，之后对方修改不影响该引用，需重新引用才会更新。策略可以采集被引用的文件。读取方不能修改被引用的定义，定义所有权不转移。
- **撤销**：撤销后不能新增引用，含该引用的新提交被阻止，已有提交保持不变；头提交使用该引用、仍在接入中的读取方 Feature 回到 `DRAFT` 并收到 `REFERENCE_REVOKED` 反馈。撤销与读取方的提交、审核串行执行。
- **当前定义**：引用固定的是所属分组最近一次提交中的版本，而不是最大版本号（内容寻址的版本会被复用）。
- **不泄露隐藏来源**：来源重叠时，业务方只能看到本组的重叠数据身份，其他分组只显示“与其他分组来源重叠”；精确猜中他组来源时只返回所属分组，不返回数据身份（已获引用授权的除外）。DCL 接入队列显示完整信息。
- **平台运维处理引用授权**时需要三个环境的授权，与其他平台级操作一致。
- **敏感数据**：被引用的敏感文件在读取方的策略上下文中重新审核，因为策略签名不同。

## 5. 数据模型

| 表 | 内容 |
|---|---|
| `accounts`、`grants`、`sessions` | 账号、单条完整授权、会话（只存 token 的 SHA-256） |
| `vehicle_models`、`projects`、`org_units` | 车型、项目、两棵组织树 |
| `business_groups` | 业务分组：代码、域、用途（DEV/TEST）、所属节点 |
| `workspaces` 及 `workspace_groups / scopes / sources` | 工作区及其分组、范围、来源 |
| `processing_pipelines`、`processing_templates` | 不可变处理版本、按文件类型的默认模板 |
| `data_items` | 稳定数据身份与来源，部分唯一索引保证来源唯一 |
| `file_spec_versions`、`policies`、`policy_versions`、`manifest_versions`、`manifest_entries` | 内容寻址的不可变版本 |
| `features`、`commits`、`commit_policies` | 研发分支与不可变提交 |
| `sensitive_reviews` | 敏感审核决定，绑定数据身份、文件签名与策略签名 |
| `feature_feedback` | DCL 给 Feature 作者的退回、拒绝与绑定调整反馈 |
| `reference_requests` | 跨组只读引用的申请、批准、拒绝与撤销 |
| `audit_events`、`idempotency_keys` | 审计（含被拒绝的请求）与幂等记录 |

## 6. API 概览

所有接口位于 `/api/v1`，JSON 请求与响应。除登录外均需 `Authorization: Bearer <token>`。

| 方法与路径 | 说明 | 角色 |
|---|---|---|
| `POST /auth/dev-login`、`POST /auth/logout`、`GET /me` | 开发登录、退出、当前账号与可用工作区 | — |
| `GET/POST /accounts`、`PATCH /accounts/:username`、`PUT /accounts/:username/grants` | 账号与授权 | 平台运维 |
| `GET /audit` | 审计查询 | 平台运维 |
| `GET/POST /vehicle-models`、`/projects`、`/org-units`，`PATCH /org-units/:id` | 车型、项目、组织节点 | 写：平台运维 |
| `GET/POST /groups` | 业务分组（带 `workspaceId` 时可由工作区管理员委派创建） | 写：平台运维 / 工作区管理员 |
| `GET/POST /workspaces`、`GET/PATCH /workspaces/:id` | 工作区 | 写：平台运维 |
| `GET/POST /processing/pipelines`、`/processing/templates` | 处理目录 | 写：DCL 工程 |
| `GET/POST /workspaces/:id/features` | Feature 列表与创建 | 写：业务研发 |
| `GET /features/:id`、`GET /features/:id/commits` | Feature 详情（草稿、差异、待审核文件）与提交历史 | 可读该分组配置的角色 |
| `POST /features/:id/files`、`PATCH/DELETE /features/:id/files/:dataKey` | 草稿文件 | 业务研发 |
| `PUT/DELETE /features/:id/policies/:policyId` | 草稿策略 | 业务研发 |
| `POST /features/:id/submit` | 提交 | 业务研发 |
| `GET /commits/:id` | 提交内容与相对上一提交的差异 | 可读该分组配置的角色 |
| `GET /workspaces/:id/groups/:groupId/data-items`、`POST /data-items/:dataKey/overlap-review` | 数据身份目录（经包含该分组的工作区读取）、来源重叠判定 | 判定：DCL 工程 |
| `GET /intake` | DCL 接入队列 | DCL 工程 |
| `POST /features/:id/reviews` | 对头提交中的文件作出敏感审核决定 | DCL 工程 |
| `POST /features/:id/return`、`PUT /features/:id/files/:dataKey/binding` | 退回 Feature、调整处理绑定 | DCL 工程 |
| `GET /workspaces/:id/groups/:groupId/catalog` | 可引用数据目录 | 可读该分组配置的角色 |
| `GET/POST /reference-requests`、`POST /reference-requests/:id/decision`、`POST /reference-requests/:id/revoke` | 引用申请、决定、撤销 | 申请：业务研发；决定：所属分组业务研发 / 平台运维 |
| `PUT/DELETE /features/:id/references/:dataKey` | 草稿中的只读引用 | 业务研发 |

错误格式统一为 `{"error": {"code", "message", "details"}}`。`code` 是稳定的机器可读标识，界面按 `code` 本地化；`message` 面向开发者。状态码：400 请求格式错误或非法值（如文本中的 NUL 字符），401 未登录或会话失效，403 未授权（`details.reason` 为拒绝原因），404 不存在，409 并发或唯一性冲突，422 业务规则拒绝，503 等待锁或语句超时（可重试）。

## 7. 与原型的差异

- 集成测试按范围（域 / 整车）授权，与业务测试的分组授权分开，对应原型 v0.13 “角色与账号分离”的设计。
- 策略 ID 使用分组代码命名空间，避免跨组冲突。
- 来源重叠判定使用精确的 glob 交集，而不是前缀启发式。
- 数据来源身份暂不包含车型：同一域控、目录、匹配规则在不同车型上视为同一数据。见第 9 节待确认事项。

## 8. 路线图

1. **车辆与验证**——车辆资源（实车 / 仿真、整车版本可为 NULL）、仿真镜像、车辆组、分组下发与回执、先仿真后实车的测试证据、Verified。
2. **集成与发布**——三方合并与冲突交接、DCL 最终处理集合确认、候选冻结与独立集成测试、正式发布与 DCL 版本（按车型隔离）、以正式版本为基线的技术 Feature。
3. **OTA 与数据闭环**——灰度 / 扩量 / 暂停 / 重试 / 回滚、设备签名回执、客户端状态上报、事件快照、售后查询与训练数据查询。
4. **前端**——角色工作台，界面只调用 API。

## 9. 待确认事项

- 数据来源身份是否应包含车型（X89 与 X90 上同一路径是否为同一数据项）。
- 生产身份认证接入的组织身份系统（OIDC / LDAP 等）。
- 跨组引用由数据所属分组的业务研发决定、平台运维也可处理；是否需要两级审批（所属分组同意后再由平台运维授权）。
- 域列表（`Common / Chassis / Battery / Powertrain / HMI / ADC / CDC / Other`）是否需要可配置。
- 界面语言：仅中文，或中英双语。
