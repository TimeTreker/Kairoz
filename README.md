# Kairoz

Kairoz 是数据闭环平台（DCL）中**数据采集平台**的正式实现：业务团队定义要从车辆采集哪些文件、在什么条件下采集，经 DCL 工程接入、仿真与实车验证、集成合并、正式发布后，以配置 OTA 下发到车辆，并对每个采集事件保留完整的配置追溯。

本仓库以原型 v0.13（`Data_Acquisition_Platform_Data_Query_20261018.zip`）的设计文档为需求来源进行**干净重写**。原型代码只作为行为参考，不复用。

## 当前进度

| 能力 | 状态 |
|---|---|
| 身份与授权：账号、单条完整授权（不拼接）、会话失效、审计 | ✅ 第一切片 |
| 组织：团队组织树、项目组织树、车型、业务分组、TEAM / PROJECT / INTEGRATION 工作区 | ✅ 第一切片 |
| 处理目录：车端 / 云端不可变处理版本、按文件类型的默认模板 | ✅ 第一切片 |
| 配置编写：Feature、文件列表、采集策略、提交、不可变内容寻址版本、DCL Ready | ✅ 第一切片 |
| DCL 接入：接入队列、绑定内容的敏感审核、退回、处理绑定调整 | ✅ 第二切片 |
| 跨组只读引用：可引用数据目录、申请 / 决定 / 撤销、固定版本引用 | ✅ 第二切片 |
| 车辆资源、测试、集成合并、发布、OTA、数据查询 | 后续切片 |
| 前端界面 | 后续切片 |

设计与取舍见 [docs/architecture.md](docs/architecture.md)。

## 本地启动

需要 Node.js 24 与 Docker。

```bash
cp .env.example .env
```

```bash
npm install
```

```bash
npm run db:up
```

```bash
npm run dev
```

服务默认监听 `http://127.0.0.1:8081`。首次启动自动执行数据库迁移，并在空库中创建唯一的平台管理员 `admin`。

开发模式下（`KAIROZ_AUTH_MODE=dev-username`）只输入用户名即可登录，**仅限本地开发，禁止用于生产**；正式环境将接入组织身份系统。

```bash
curl -s -X POST http://127.0.0.1:8081/api/v1/auth/dev-login -H 'content-type: application/json' -d '{"username":"admin"}'
```

返回的 `token` 用于后续请求的 `Authorization: Bearer <token>`。

### 演示数据

演示数据只能显式加载，并且只能加载到干净安装中：

```bash
npm run seed:demo
```

包含 6 个团队工作区（制动、转向、ADC 泊车/系统、CDC HMI/座舱应用）、X89 项目与集成工作区、各角色演示账号（如 `business` 陈明、`dcl` 林书涵、`workspace_manager`、`integrator`、`release`、`resource`）、8 类文件的 RawStorage 默认模板，一个已提交的 `guided_brake` Feature、一个等待 DCL 敏感审核的泊车环视视频 Feature（`adc_parking`），以及一条等待制动组决定的跨组引用申请（转向组 → 制动调试数据）。RawStorage 只表示原始存储，不代表真实解析或脱敏能力。

## 测试

```bash
npm test
```

```bash
npm run typecheck
```

测试使用真实 Postgres（`kairoz_test` 库），每个测试文件在独立 schema 中从零迁移。

## 目录

```
apps/server/
  migrations/        SQL 迁移（只追加，不修改已应用的文件）
  src/domain/        纯领域规则：授权、词汇表、触发表达式、数据源、配置差异
  src/modules/       按业务模块划分的服务与路由：identity / org / processing / config / audit
  src/http/          请求上下文、事务、幂等、校验
  src/db/            连接池、事务、迁移
  src/demo/          演示数据
  test/              领域单元测试与 HTTP 集成测试
docker-compose.yml   本地 Postgres 18
docs/                架构与设计说明
```
