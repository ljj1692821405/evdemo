# evdemo 评测平台开发任务清单

## 项目目标

构建完整的评测平台（FastAPI + PostgreSQL 后端，Next.js 前端）。

## Phase 1: MVP - 最小可用产品（2-3周）

### Week 1: 数据库 + 流程配置 API

#### ✅ 数据库设计与初始化
- [x] 扩展 `backend/init_db.py`，添加三张核心表：
  - `eval_flow_configs` - 流程配置（输入schema、仿真配置、输出schema）
  - `eval_tasks` - 评测任务（批次管理）
  - `eval_results` - 评测结果（每个case的结果）
- [x] 添加租户隔离字段：`org_id`, `product_line_id`, `agent_id`
- [x] 数据库建表脚本完成（待实际数据库环境可用时运行验证）

#### ✅ 仿真引擎封装
- [x] `backend/app/services/simulation/simulation_service.py` — 封装 Agent 仿真：建会话 → 逐轮发消息 → 解析 SSE → 产出标准化轨迹（`run_simulation` / `probe`）✅
- [x] `backend/app/services/result_processing/post_processor.py` — 按 `output_schema` 从轨迹提取结构化字段，缺省时给默认摘要 ✅
- [x] 任务执行器 `execute_single_task()` 已接通真实链路：取流程配置 → 逐 case 跑仿真 → 后处理 → 写 `eval_results`，单 case 失败不拖垮整批 ✅
- [x] `backend/app/config.py` 新增 `sim_settings()`：仿真凭据取自 config.json 顶层 `base_url` / `cookie`（与裁判用 `llm` 段相互独立）✅
- [x] `backend/simulation_test.py` — 26 项检查（mock httpx，不碰真实 Agent / DB，全绿）✅
- [ ] **待你操作**：config.json 顶层 `cookie` 为抓包会话凭证，过期需重新抓取替换，否则 `run_simulation` 会报 HTTP 401/403

#### ✅ 流程配置 API
- [x] 创建 `backend/app/routers/flow_config_router.py` ✅
  - `POST /api/flows` - 创建流程配置 ✅
  - `GET /api/flows` - 查询流程列表（支持过滤）✅
  - `GET /api/flows/{flow_id}` - 查询单个流程详情 ✅
  - `PUT /api/flows/{flow_id}` - 更新流程配置 ✅
  - `DELETE /api/flows/{flow_id}` - 删除流程（软删除）✅
- [x] 创建 `backend/app/services/flow_management/flow_config_service.py` - 数据库操作层 ✅
- [x] 在 `backend/app/main.py` 中注册路由 ✅
- [x] 新增 `judge_config` 字段：流程可携带裁判配置，为空则不评判 ✅
- [x] **版本控制**：`eval_flow_versions` 快照表 + `snapshot_version` / `rollback_to_version`；
  改动前自动留档，支持 `GET /versions`、`GET /versions/{v}`、`POST /rollback/{v}` ✅

### Week 2: 任务执行系统

#### ✅ 任务执行服务
- [x] 创建 `backend/app/services/task_execution/task_executor_service.py` ✅
  - 异步任务队列管理 ✅
  - 并发控制（最多同时执行 N 个任务）✅
  - 状态跟踪（pending → running → completed/partial_failed/failed/cancelled）✅
  - 错误重试机制：单 case 可重试错误（429/5xx/超时）按指数退避重试，重试次数取
    `simulation_config.retries`（0~3），业务错误（400/401/403）不重试 ✅

#### ✅ 任务 API
- [x] 创建 `backend/app/routers/task_router.py` ✅
  - `POST /api/tasks` - 提交评测任务（支持批量）✅
  - `GET /api/tasks` - 查询任务列表（支持过滤）✅
  - `GET /api/tasks/{task_id}` - 查询任务进度 ✅
  - `DELETE /api/tasks/{task_id}` - 取消任务 ✅

#### ✅ 结果 API
- [x] 创建 `backend/app/routers/result_router.py` ✅
  - `GET /api/results` - 查询结果列表（支持多维度过滤）✅
  - `GET /api/results/{result_id}` - 查询结果详情 ✅
  - `GET /api/results/export` - 导出结果（JSON）✅
- [x] 创建 `backend/app/services/result_processing/result_service.py` ✅

---

#### ✅ LLM 评判能力（Phase 2）
- [x] `backend/app/services/judging/judge_service.py` - 裁判服务：拼提示词 → `call_json`
  结构化打分（0/1 + 理由）→ 落 `judge_results` 表；汇总通过率 ✅
- [x] `backend/app/routers/judge_router.py` - `/api/judges`（单条）、`/api/judges/batch`
  （整批任务）、`GET /api/judges`（查记录）✅
- [x] 流程 `judge_config` 配好后，任务执行时自动对每条成功结果打分；评判失败不影响
  已落库的仿真结果 ✅
- [x] 复用已有的 `JudgeScore` 契约与 `llm_service.call_json`（含格式校验）✅

#### ✅ 简单 RBAC（Phase 2）
- [x] `backend/app/rbac.py` - 角色（admin/editor/member/viewer）→ 权限点矩阵，
  历史 role 文本做别名归一 ✅
- [x] 写接口加权限依赖：流程写 / 任务提交 / 数据集写 / 评判 / 用户管理 ✅
- [x] `GET /api/auth/capabilities` - 前端据此隐藏/禁用按钮 ✅
- [x] 边界：未登录（本地开发）按 member 放行，保持既有联调行为不变；
  管理员需手工 `UPDATE eval_users SET role='admin'` 提升 ✅

#### ⏳ 租户隔离中间件
- [x] `backend/app/tenant.py` - 租户上下文（ContextVar）✅
- [x] `backend/app/middleware/tenant_middleware.py` - 纯 ASGI 中间件，解析 `x-org-id` / `x-product-line-id` / `x-agent-id` / `x-user-id`（兼容同名 query 参数）✅
- [x] `GET /api/tenant/context` - 调试端点，确认请求头生效 ✅
- [x] dataset / case / task / result / flow 服务层统一走 `scope_conditions()`，读取、写入、删除、更新四条路径都带租户条件 ✅
- [x] `backend/tenant_isolation_test.py` - 21 项跨租户越权验证（真实 PG，全绿）✅

**隔离模型（重要，勿改错）**

隔离维度固定为三元组 `(org_id, product_line_id, agent_id)`：

| 维度 | 是否隔离 | 说明 |
|---|---|---|
| `org_id` | ✅ 始终 | 默认 `default` |
| `product_line_id` | ✅ | 产线之间互不可见 |
| `agent_id` | ✅ | 同一产线下不同 Agent 互不可见 |
| `user` | ❌ 不隔离 | 同一 Agent 内所有用户共享数据集，一起分析。后续如需私密数据集，再加 `visibility`(shared/private) + `owner_user_id` |

`product_line_id` / `agent_id` 为空串时**不加过滤条件**（而非匹配空串），避免历史数据全部不可见。新建资源时应确保请求头带齐这三个值。

**踩过的坑**：Pydantic 模型里 `org_id: str = "default"` 这种非空默认值会静默压过请求头，导致所有数据写进 `default` 组织、隔离失效。凡是「留空则取请求头」的字段，默认值必须是空串，传参时转 `None`。

#### ✅ 飞书扫码登录
- [x] `backend/app/services/auth_service.py` - 授权码换 token、拉用户信息、upsert 用户、签发/校验/吊销会话 ✅
- [x] `backend/app/routers/auth_router.py` - `/status` `/login-url` `/feishu/callback` `/me` `/logout` `/users` ✅
- [x] `eval_users` / `eval_sessions` 表（`init_db.py`）✅
- [x] `lib/auth-store.ts` - 前端登录态、跳转、CSRF state、登出 ✅
- [x] `app/login/page.tsx` + `app/auth/feishu/callback/page.tsx` ✅
- [x] `middleware.ts` - 未登录重定向到 `/login?redirect=...` ✅
- [x] 侧边栏底部显示飞书头像/昵称/邮箱 + 退出按钮 ✅
- [x] `backend/auth_test.py` - 27 项链路检查（mock 飞书 HTTP，真实 PG，全绿）✅
- [x] `FEISHU_LOGIN.md` - 开放平台配置步骤与常见错误对照表 ✅
- [ ] **待你操作**：在 `backend/.env` 填 `FEISHU_APP_ID` / `FEISHU_APP_SECRET`，并在开放平台登记重定向 URL

**当前边界**：身份记录 + 简单 RBAC（见上）。隔离维度仍是 `(org_id, product_line_id, agent_id)`，与用户无关；权限只控制「能否写」，不控制「能看哪些数据」。

#### 🔄 前端页面（UI 已画好，联调待接真实接口）
- [x] 前端 `lib/api-client.ts` 补齐封装：flows / tasks / results / judges / capabilities，
  全部 camelCase，与后端契约一致 ✅
- [ ] 流程管理页面：把 CRUD 接到 `getFlows/createFlow/updateFlow/deleteFlow` + 版本/回滚
- [ ] 任务提交页面：`createTask` 提交后用 `getTask` 轮询 `progress`，替换 mock 进度
- [ ] 结果展示页面：`getResults/getResult` + 评判 `getJudgements/judgeBatch`，替换 mock 数据
- [ ] 按 `getCapabilities()` 返回的权限隐藏/禁用写操作按钮

> 详细接口契约见根目录 `API_CONTRACT.md`（已冻结：路径/方法/字段/状态枚举改前先对齐前端）。

---

## Phase 2: 增强功能（1-2周）

- [x] LLM 评判能力集成 ✅（`judging/judge_service.py` + `/api/judges`，详见 Week2 小节）
- [x] 流程版本控制 ✅（`eval_flow_versions` 快照 + 回滚，详见流程配置 API 小节）
- [x] 简单 RBAC（角色权限控制）✅（`app/rbac.py`，详见 RBAC 小节）

---

## Phase 3: 生产部署（1周）

- [x] Docker 容器化 ✅
  - `backend/Dockerfile`（python:3.11-slim，非 root，带 healthcheck）
  - `docker-compose.yml`（postgres + backend，凭据走 .env / 只读挂载 config.json）
  - `backend/.dockerignore`
- [ ] CI/CD 流水线
- [x] 文档完善 ✅（`API_CONTRACT.md` 接口契约冻结；本 TODO 同步真实状态）

---

## 进度跟踪

| 功能块 | 完成度 | 最后更新 |
|------|------|--------|
| 数据库设计 | 100% | 2026-11-19 |
| 数据库初始化 | 100% | 2026-11-19 |
| 仿真引擎封装 | 100% | 2026-11-19 |
| 流程配置 API | 100% | 2026-11-19 |
| 流程版本控制 | 100% | 2026-11-19 |
| 任务执行 API（含重试） | 100% | 2026-11-19 |
| 结果查询 API | 100% | 2026-11-19 |
| 数据集 / Case API | 100% | 2026-11-19 |
| LLM 评判 | 100% | 2026-11-19 |
| 租户隔离 | 100% | 2026-11-19 |
| 简单 RBAC | 100% | 2026-11-19 |
| Docker 容器化 | 100% | 2026-11-19 |
| 前端 API 封装 | 100% | 2026-11-19 |
| 前端流程管理（接真实接口） | 0% | - |
| 前端任务提交（接真实接口） | 0% | - |
| 前端结果展示（接真实接口） | 0% | - |
| CI/CD | 0% | - |

---

## 技术栈

**后端：**
- FastAPI - Web 框架
- PostgreSQL - 数据库
- psycopg - 数据库驱动
- httpx - 异步 HTTP 客户端
- Pydantic - 数据验证

**前端：**
- Next.js - React 框架
- TypeScript - 类型检查
- TailwindCSS - 样式库

---

## 命名规范（避坑笔记）

❌ **不能用的**：
- 目录/包名以数字开头（如 `01_flow`, `02_app`）- Python 导入会失败
- 用 `-` 分隔符（如 `flow-config`）- Python 导入也会失败

✅ **推荐用的**：
- 用下划线分隔：`flow_management`, `task_executor`, `result_processor`
- 路由文件：`{feature}_router.py` 或 `{feature}_routes.py`
- 服务文件：`{feature}_service.py`
- 中间件：`{feature}_middleware.py`
- 模块包名：`{feature}/` 下放 `__init__.py`, `{feature}_service.py` 等

**示例结构：**
```
backend/app/
├── services/
│   ├── flow_management/
│   │   ├── __init__.py
│   │   └── flow_config_service.py
│   ├── simulation/
│   │   ├── __init__.py
│   │   └── simulation_service.py
│   ├── task_execution/
│   │   ├── __init__.py
│   │   └── task_executor_service.py
│   └── ...
├── routers/
│   ├── flow_config_router.py
│   ├── task_router.py
│   ├── result_router.py
│   └── ...
├── middleware/
│   ├── tenant_middleware.py
│   └── ...
├── main.py
├── config.py
└── ...
```

---

## 本地开发

```bash
# 启动后端
cd backend
python run.py --reload

# 初始化数据库
python init_db.py

# 查看表结构
python init_db.py --check
```

---

## Git 工作流

**恢复到远程分支的干净状态：**
```bash
git reset --hard origin/feat/eval-capabilities-v3
git clean -fd
```

**查看本地改动：**
```bash
git status
git diff
```

**提交工作：**
```bash
git add .
git commit -m "feat: 具体功能描述"
git push origin feat/eval-capabilities-v3
```
