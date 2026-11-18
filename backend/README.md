# backend · 评测平台后端服务

前后端分离的**服务端**，负责所有需要密钥的操作：LLM 代理、PostgreSQL 访问、OSS 读写。
前端（Next.js，仓库根目录）只调用本服务的 `/api/*`，**永远拿不到任何密钥**。

## 目录结构

```
backend/
├── app/
│   ├── config.py            # 配置中心：环境变量 > 根目录 config.json > 默认值
│   ├── responses.py         # 统一响应体 ok/fail 与业务异常 ServiceError
│   ├── main.py              # FastAPI 装配 + CORS + 可选令牌校验 + 异常处理
│   ├── services/
│   │   ├── llm_service.py   # OpenAI 兼容协议：非流式 / 流式 / 模型列表 / 自检
│   │   ├── pg_service.py    # PostgreSQL：分层探测 / 只读查询
│   │   └── oss_service.py   # 阿里云 OSS：探测 / 列举 / 上传 / 预签名
│   └── routers/
│       ├── system.py        # /api/health /api/admin/reload
│       ├── llm.py           # /api/llm/*
│       ├── pg.py            # /api/pg/*
│       └── oss.py           # /api/oss/*
├── run.py                   # 本地启动器
├── requirements.txt
└── .env.example
```

## 快速开始

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt

# 可选：不用 config.json 也可以，复制模板后填环境变量
Copy-Item .env.example .env

python run.py --reload
```

启动后：

- 服务地址 `http://127.0.0.1:8000`
- 交互式文档 `http://127.0.0.1:8000/docs`

## 配置来源

优先级：**环境变量 > 项目根 `config.json`**。`config.json` 已被 `.gitignore` 排除。

| 配置 | 环境变量 | config.json 路径 |
|---|---|---|
| LLM 地址 | `LLM_BASE_URL` | `llm.base_url` |
| LLM 密钥 | `LLM_API_KEY` | `llm.api_key` |
| LLM 模型 | `LLM_MODEL` | `llm.model` |
| PG 主机 | `PG_HOST` | `pg.host` |
| PG 端口 | `PG_PORT` | — （默认 5432） |
| PG 用户 | `PG_USER` | `pg.user` |
| PG 密码 | `PG_PWD` | `pg.pwd` |
| PG 库名 | `PG_DB` | `pg.db` |
| OSS Bucket | `OSS_BUCKET` | `oss.bucket-name` |
| OSS AK | `OSS_AK` | `oss.AK` |
| OSS SK | `OSS_SK` | `oss.SK` |
| OSS Endpoint | `OSS_ENDPOINT` | `oss.endpoint` |

改完配置不用重启：`POST /api/admin/reload`。

## 接口一览

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 三项配置是否就绪、目标地址、版本、运行时长 |
| POST | `/api/admin/reload` | 热重载 config.json / .env |
| GET | `/api/llm/status` | 配置状态，密钥打码返回 |
| GET | `/api/llm/probe` | **真实请求一次上游**，返回延迟与回复预览 |
| GET | `/api/llm/models` | 上游可用模型 ID 列表 |
| POST | `/api/llm/chat` | 非流式对话 |
| POST | `/api/llm/chat/stream` | 流式对话（SSE 透传） |
| GET | `/api/pg/probe` | 分层探测：TCP → 登录 → 库元信息 → 表清单 |
| POST | `/api/pg/query` | 只读查询，仅放行 `SELECT` / `WITH` |
| GET | `/api/oss/probe` | 探测 OSS，内网 endpoint 失败自动回退公网 |
| GET | `/api/oss/objects` | 列举对象 |
| POST | `/api/oss/upload` | 上传文件 |
| POST | `/api/oss/sign` | 生成预签名 URL |

## 联通性自检（先跑这三条）

```powershell
curl.exe http://127.0.0.1:8000/api/health
curl.exe http://127.0.0.1:8000/api/pg/probe
curl.exe http://127.0.0.1:8000/api/oss/probe
```

`/api/pg/probe` 会逐层返回 `connect` / `meta` 两步，哪步挂了一眼就能看出是网络、白名单还是密码问题。
`/api/oss/probe` 的 `attempts` 数组保存了每个 endpoint 的尝试结果。

## 安全说明

- LLM / PG / OSS 的密钥**只存在于服务端进程内存**，任何接口都不会返回明文；`/api/llm/status` 返回的是打码值。
- `API_TOKEN` 留空即不校验（仅本地开发）；对外暴露时必须设置，前端请求需带 `x-api-token` 头。
- `/api/pg/query` 只放行只读语句，避免误伤生产库。
