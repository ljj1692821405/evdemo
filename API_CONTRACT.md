# 后端 API 契约（冻结版）

> **改动规则**：只改后端内部实现（SQL、解析、并发、日志）→ 随便改。
> 本文件里列出的**路径 / 方法 / 请求字段 / 响应字段 / 枚举值** → 改之前必须先问前端。
> 最后更新：2026-11-19

---

## 通用约定

### 响应包装（所有接口统一，`app/responses.py`）
```json
{ "ok": true,  "data": { ... } }
{ "ok": false, "error": "错误说明" }
```
前端一律先看 `ok`，再取 `data`。

### 命名风格
- **请求体 / 响应体：camelCase**（`taskId`、`inputData`、`completedCases`）
- 后端在服务层用 `row_to_xxx()` 把数据库的 snake_case 转成 camelCase，前端不需要做映射。
- 例外：`query` 参数仍是 snake_case（如 `?task_id=xxx&agent_id=xxx`），因为这些是 URL 里的查询串，跟 dataset 接口保持一致。

### 租户上下文（请求头）
```
x-org-id: default
x-product-line-id: <产线>
x-agent-id: <Agent>
```
留空则不加过滤。`org_id` 默认 `default`。

---

## 一、任务 API（`/api/tasks`）

### POST `/api/tasks` —— 提交评测任务
**请求体**（两种写法均可，别名兼容）：
```json
{
  "flowId": "flow_xxx",            // 或 "flow_id"
  "inputData": [                    // 或 "input_data"
    { "user_query": "你好" },
    { "messages": ["第一轮", "第二轮"] }
  ],
  "orgId": "",                      // 可选，留空取请求头
  "createdBy": "system"             // 可选
}
```
**响应**：
```json
{ "ok": true, "data": { "taskId": "task_a1b2c3d4e5f6", "message": "任务已提交，共 2 个 case" } }
```
> 注意：**异步**。提交立刻返回 taskId，仿真在后台跑。要用 GET 轮询进度。

### GET `/api/tasks` —— 任务列表
**查询参数**：`org_id`、`status`、`limit`(1-200,默认50)、`offset`
**响应**：
```json
{
  "ok": true,
  "data": {
    "tasks": [
      {
        "taskId": "task_xxx",
        "flowId": "flow_xxx",
        "status": "running",
        "totalCases": 10,
        "completedCases": 3,
        "failedCases": 1,
        "progress": 30,
        "createdBy": "system",
        "createdAt": "2026-11-19 10:00:00",
        "updatedAt": "2026-11-19 10:01:00"
      }
    ],
    "total": 1, "limit": 50, "offset": 0
  }
}
```

### GET `/api/tasks/{taskId}` —— 任务详情（轮询用）
**响应**：`data` 是**单个** task 对象，结构同上（含 `progress` 百分比，前端直接用）。

### DELETE `/api/tasks/{taskId}` —— 取消任务
仅 `pending` 状态可取消。
**响应**：`{ "ok": true, "data": { "taskId": "task_xxx", "message": "任务已取消" } }`

### 🔒 任务状态枚举（**禁止单边改**）
```
pending | running | completed | partial_failed | failed | cancelled
```
- `partial_failed` = 部分 case 成功、部分失败（不是 `partial`！）
- 前端 `simulations-view.tsx` 的 `statusLabel` 已按这套写死

---

## 二、结果 API（`/api/results`）

### GET `/api/results` —— 结果列表
**查询参数**：`task_id`、`flow_id`、`org_id`、`status`(completed/failed)、`limit`、`offset`
**响应**：
```json
{
  "ok": true,
  "data": {
    "results": [
      {
        "id": 123,
        "taskId": "task_xxx",
        "flowId": "flow_xxx",
        "inputData": { "user_query": "你好" },
        "rawOutput": { "session_id": "...", "turns": [...], "final_reply": "..." },
        "processedOutput": { "final_reply": "...", "turn_count": 1 },
        "status": "completed",
        "latencyMs": 3829,
        "errorMessage": "",
        "createdAt": "2026-11-19 10:00:05"
      }
    ],
    "total": 1, "limit": 50, "offset": 0
  }
}
```
> 列表接口的 `rawOutput` 可能较大；结果页如果只显示摘要，用 `processedOutput` 即可。

### GET `/api/results/{resultId}` —— 结果详情
**响应**：`data` 是单个 result 对象，结构同上（含完整 `rawOutput`）。

### GET `/api/results/export/{taskId}` —— 导出
**查询参数**：`format`（json；csv 待实现，会返回 501）
**响应**：`{ "ok": true, "data": { "taskId", "format", "count", "data": [...] } }`

---

## 三、流程配置 API（`/api/flows`）
> 提交任务前需要先有 flowId。前端流程管理页联调时用。

- `POST /api/flows` 创建
- `GET /api/flows` 列表（参数 `status`、`limit`、`offset`）
- `GET /api/flows/{flowId}` 详情
- `PUT /api/flows/{flowId}` 更新
- `DELETE /api/flows/{flowId}` 软删除（status → inactive）

流程配置里两个关键 JSON 字段（决定仿真怎么跑、结果怎么提）：
```json
"simulationConfig": { "max_turns": 10 },
"outputSchema": {
  "fields": [
    { "name": "final_reply", "source": "final_reply" },
    { "name": "turn_count",  "source": "turns_count" },
    { "name": "first_reply", "source": "turns.0.reply" }
  ]
}
```
`source` 可选值：`final_reply` / `turns_count` / `session_id` / `total_latency_ms` / `turns.{i}.{key}` / 轨迹顶层任意键。
留空则返回默认摘要 `{final_reply, turn_count, total_latency_ms}`。

---

## 四、数据集 / Case API（已联调过，仅登记）
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/datasets` | 列表（`agent_id`、`org_id`） |
| POST | `/api/datasets` | 创建 |
| DELETE | `/api/datasets/{id}` | 删除 |
| GET | `/api/cases` | 全部 case（`agent_id`、`dataset_id`） |
| GET | `/api/datasets/{id}/cases` | 某数据集下的 case |
| POST | `/api/datasets/{id}/cases` | 批量添加 |
| DELETE | `/api/cases/{id}` | 删除 |
| GET | `/api/tenant/context` | 调试：确认请求头生效 |

数据集/Case 的 DTO 已是 camelCase（`datasetId`、`workspaceSize`、`gtSource`、`invalidReason`）。

---

## 五、认证 API（`/api/auth`）
`/status`、`/login-url`、`/feishu/callback`、`/me`、`/logout`、`/users`。已联调，暂不动。

### GET `/api/auth/capabilities` —— 当前用户权限（RBAC）
**响应**：`{ ok, data: { role, isAdmin, permissions: [...] } }`
- `role`：admin / editor / member / viewer
- `permissions`：`flow:write` `task:write` `dataset:write` `judge:run` `user:admin` 的子集
- 前端据此隐藏/禁用写按钮。未登录按 member 处理。

---

## 五之二、LLM 评判 API（`/api/judges`）

### POST `/api/judges` —— 对单条结果打分（需 judge:run 权限）
**请求体**：`{ result_id, rubric?, model?, dimension? }`
**响应**：`{ ok, data: { judgementId, score(0/1), pass, evidenceAnalysis, reason, model, latencyMs } }`

### POST `/api/judges/batch` —— 整批任务打分
**请求体**：`{ task_id, rubric?, model?, dimension? }`
**响应**：`{ ok, data: { taskId, judged, failed, failures[], summary:{judged,passed,passRate,avgScore} } }`

### GET `/api/judges?result_id=` —— 查评判记录
**响应**：`data.judgements[]`，每条 `{ id, resultId, caseId, dimension, score, pass, evidence, reason, createdAt }`

> 流程 `judge_config` 配好后，任务执行时会**自动**对每条成功结果打分，无需手动调本接口。

---

## 五之三、流程版本 API（`/api/flows/{flowId}/...`）

- `GET  /api/flows/{flowId}/versions` —— 历史版本列表（需读流程）
- `GET  /api/flows/{flowId}/versions/{version}` —— 某版本完整快照
- `POST /api/flows/{flowId}/rollback/{version}` —— 回滚（需 flow:write；回滚前自动留档当前）

> 流程 `create` / `update` 会自动写版本快照。流程体新增可选 `judge_config` 字段。

---

## 六、可以随便改的（不在这份契约里）

- `simulation_service` 怎么解析 SSE、怎么建会话
- `post_processor` 的提取细节
- 数据库索引、SQL、连接池
- 并发数、超时、重试
- 日志内容、内部日志格式
- 新增接口（纯加法）

---

## 七、联调自检清单

改完后端后，跑这三步确认契约没破：

```bash
# 1. 模块能装配
python -c "from app.main import app; print(len(app.routes))"

# 2. 关键字段还是 camelCase
python -c "from app.services.task_execution import task_executor_service as t; print(list(t.row_to_task({'task_id':'x'}).keys()))"

# 3. 真实打接口
python -c "from fastapi.testclient import TestClient; from app.main import app; import json; print(json.dumps(TestClient(app).get('/api/tasks').json(), ensure_ascii=False)[:300])"
```

---

## 阶段二：能力版本 / 评分器版本 / 实验（2026-11-20 新增）

> 设计原则：**能力草稿、评分器草稿只活在前端内存，不落库**；
> 只有「发布」把版本固化（append-only，不可覆盖），「实验」是唯一持久化的评测对象。
> 写操作权限点统一为 `eval:write`（admin / editor 有，member / viewer 无）。

### 评分器版本 `/api/scorers`

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/scorers/{scorer_id}/publish` | 发布版本（需 `eval:write`） |
| GET | `/api/scorers/{scorer_id}/versions` | 历史列表（倒序，不含 config） |
| GET | `/api/scorers/{scorer_id}/versions/latest` | 最新版本（升版派生用） |
| GET | `/api/scorers/{scorer_id}/versions/{version}` | 指定版本完整快照 |
| GET | `/api/scorers/{scorer_id}/diff?from=1&to=2` | 两版字段级差异 |
| POST | `/api/scorers/{scorer_id}/versions/{version}/restore` | 取回旧版内容派生新草稿（不写库） |

**POST publish 请求体**
```json
{
  "config": { "name": "...", "implType": "llm_judge",
              "capabilityRef": {"id": "cap_x", "version": "v3.0.0"},
              "inputs": [{"name": "待评回复", "field": "agent_reply", "modality": "text"}],
              "promptTemplate": "...", "judgeModel": "gpt-4o-mini", "outputs": ["..."] },
  "version": null,            // 留空自动取 max+1
  "trialPassed": true,        // 必须 true，否则 400 TRIAL_REQUIRED
  "note": "改了什么",
  "createdBy": "张三"
}
```
- `version` 为整数自增。
- 重复发布同版本 → `409 VERSION_IMMUTABLE`（历史不可覆盖）。
- `trialPassed=false` → `400 TRIAL_REQUIRED`（服务端门禁，不依赖前端按钮）。

**diff 响应 `data`**
```json
{ "from":1, "to":2, "identical":false,
  "changes":[{"field":"inputs","label":"入参","before":{...},"after":{...}}, ...],
  "inputs":{ "added":[{"name":"参考要点","field":"ground_truth","modality":"text"}],
             "removed":[], "changed":[] } }
```

**restore 响应 `data`**：`{ config, draftVersion, source, hint }`——前端拿 `config` 当新草稿打开，`draftVersion = max+1`。

### 能力版本 `/api/capabilities`

结构同构，差异：版本号是**语义化字符串**（`v3.0.0`），发布**不强制** `trialPassed`。

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/capabilities/{capability_id}/publish` | 发布；`version` 留空自动推导 `v{major+1}.0.0` |
| GET | `/api/capabilities/{capability_id}/versions` | 历史列表 |
| GET | `/api/capabilities/{capability_id}/versions/latest` | 最新版本 |
| GET | `/api/capabilities/{capability_id}/versions/{version}` | 指定版本 |
| GET | `/api/capabilities/{capability_id}/diff?from=v1.0.0&to=v2.0.0` | 差异；`breaking=true` 表示执行入口/输出契约变了 |
| POST | `/api/capabilities/{capability_id}/versions/{version}/restore` | 取回旧版（不写库） |

### 实验 `/api/experiments`（唯一落库）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/experiments` | 创建；校验所有 `scorerRefs` 版本存在 |
| GET | `/api/experiments` | 列表（当前租户） |
| GET | `/api/experiments/{experiment_id}` | 详情 |
| GET | `/api/experiments/{experiment_id}/resolved` | 详情 + 解析出完整评分器版本快照 |
| DELETE | `/api/experiments/{experiment_id}` | 删除（连带运行记录） |
| POST | `/api/experiments/{experiment_id}/runs` | 登记一次运行；实验首跑后状态 `draft→running` |
| GET | `/api/experiments/{experiment_id}/runs` | 运行列表 |
| GET | `/api/experiments/runs/{run_id}` | 单次运行详情（含结果） |
| PUT | `/api/experiments/runs/{run_id}` | 回写运行进度/结果（供运行器） |

**POST 创建实验请求体**
```json
{
  "name": "W2 定向修改评测",
  "scorerRefs": [{"id": "sc_x", "version": 1}],   // 必须是已发布版本
  "snapshotId": "snap_xxx",                        // 必填，否则 400
  "fieldDictVersion": "fd_v1",
  "weights": {"answer_quality": 1.0}
}
```
- 任一 `scorerRefs` 版本不存在 → `400 SCORER_VERSION_MISSING`（含 `missing` 列表）。
- 缺 `snapshotId` → 400（结果无法复现）。
- 实验创建时把 `(id, version)` 写死，之后评分器升版**不影响**该实验 → 结果可复现。

**run 结果回写（PUT）字段**：`status / doneUnits / errors / cost / summary / detail / finished`。
`finished=true` 时写入 `finishedAt`。`summary` 建议 `{pass, total, rate}`。

### 新增错误码

| code | HTTP | 含义 |
|---|---|---|
| `TRIAL_REQUIRED` | 400 | 评分器未试跑通过，不许发布 |
| `VERSION_IMMUTABLE` | 409 | 版本号已存在，不可覆盖 |
| `SCORER_VERSION_MISSING` | 400 | 实验引用的评分器版本不存在 |
| `EXPERIMENT_EXISTS` | 409 | 实验 ID 重复 |
| `EXPERIMENT_LOCKED` | 409 | 实验已运行，不能改引用 |

### 对应数据库表（`init_db.py`）

`eval_capability_versions` / `eval_scorer_versions`（append-only，`UNIQUE(xxx_id, version)`）
/ `eval_experiments` / `eval_experiment_runs`（外键 CASCADE）。

