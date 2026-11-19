# 飞书扫码登录 · 配置指南

代码已完成，剩下的是在飞书开放平台创建应用并填三项配置。

## 一、飞书开放平台操作

1. 打开 [飞书开放平台](https://open.feishu.cn/app) → **创建企业自建应用**
2. **凭证与基础信息** → 记下 `App ID` 和 `App Secret`
3. **添加应用能力** → 添加 **网页应用**
   > 关键：必须是「网页应用」能力，否则拿不到 `access_token`，扫码登录不可用
4. **安全设置 → 重定向 URL** → 添加：
   ```
   http://localhost:3000/auth/feishu/callback
   ```
   上线后再加上正式域名，例如 `https://eval.your-company.com/auth/feishu/callback`
5. **权限管理** → 开通：
   - `contact:user.base:readonly`（读取用户基本信息，必需）
   - `contact:user.email:readonly`（读取邮箱，可选）
6. **版本管理与发布** → 创建版本并**申请发布**，等管理员审核通过
   > 未发布的应用只有你自己能登录，其他人会报权限错误

## 二、后端配置

在 `backend/.env` 里加：

```bash
FEISHU_APP_ID=cli_xxxxxxxxxxxx
FEISHU_APP_SECRET=xxxxxxxxxxxxxxxxxxxxxxxx
FEISHU_REDIRECT_URI=http://localhost:3000/auth/feishu/callback
FEISHU_SESSION_HOURS=168
```

`FEISHU_REDIRECT_URI` 必须和开放平台白名单**一字不差**（包括 http/https、端口、结尾斜杠）。

改完重启后端。

## 三、验证

```bash
cd backend
python init_db.py     # 建 eval_users / eval_sessions 表（已执行过可跳过）
python auth_test.py   # 27 项链路检查，不需要真实飞书凭据
```

浏览器打开 `http://localhost:3000` → 自动跳转登录页 → 点「使用飞书扫码登录」→ 扫码 → 回到平台。

登录后点侧边栏底部头像可退出。查看已记录的用户：

```bash
curl http://127.0.0.1:8000/api/auth/users
```

## 四、实现要点

| 项 | 做法 | 原因 |
|---|---|---|
| 回调方式 | 飞书跳前端 `/auth/feishu/callback`，前端把 `code` 交后端 | `app_secret` 全程不进浏览器 |
| 用户唯一键 | 飞书 `open_id` | 单应用内稳定唯一，不再造第二套 ID |
| 会话 token | 库中只存 `sha256`，明文仅返回一次 | 库被拖也无法冒用会话 |
| CSRF 防护 | `state` = 随机值 + 回跳路径，前端存本地校验 | 防回调伪造，顺带支持登录后回原页面 |
| 路由守卫 | `middleware.ts` 只检查标记 cookie | 中间件不查库；会话真伪由 `/api/auth/me` 判定 |
| 未配置时 | `/api/auth/login-url` 返回 503，登录页显示提示 | 不让人点进死路 |

## 五、常见错误

| 报错 | 原因 |
|---|---|
| `20029 redirect_uri 请求不合法` | 重定向 URL 与白名单不一致 |
| `20003 invalid app_id` | App ID 填错或应用未发布 |
| `未返回 access_token` | 应用没加「网页应用」能力 |
| `99991663` / 权限错误 | 权限未开通，或应用版本未审核通过 |
| 登录页一直跳回登录 | 检查浏览器是否禁用 cookie（路由守卫依赖它） |

## 六、当前边界

- **只记录身份，不做权限控制** —— 所有登录用户看到的产线/Agent 数据一致。隔离维度仍是 `(org_id, product_line_id, agent_id)`，与用户无关。
- 后续要做「用户只能看自己有权限的产线」，在 `eval_users` 加 `allowed_lines` 字段，并在 `scope_conditions()` 里按当前用户的该字段过滤即可。
- 会话过期或被吊销后，前端下次请求 `/api/auth/me` 得到 401 会自动清 token 回登录页。
