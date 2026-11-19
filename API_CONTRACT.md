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
