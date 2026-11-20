# -*- coding: utf-8 -*-
"""
统一配置：环境变量 > 项目根 config.json > 默认值

config.json 位于仓库根目录（已被 .gitignore 排除），结构：
  { "llm": {...}, "pg": {...}, "oss": {...} }
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
ROOT_DIR = BACKEND_DIR.parent
CONFIG_JSON = ROOT_DIR / "config.json"


def _load_dotenv(path: Path) -> None:
    """解析 .env：若环境变量不存在或为空串，则载入 .env 中的值。支持 utf-8-sig 去除 BOM。"""
    if not path.exists():
        return
    try:
        text = path.read_text(encoding="utf-8-sig")
    except Exception:
        text = path.read_text(encoding="utf-8", errors="ignore")
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip().strip('"').strip("'")
        # 若系统环境变量未设置或为空，则采用 .env 中的值
        if key and (key not in os.environ or not os.environ[key].strip()):
            os.environ[key] = value


_load_dotenv(BACKEND_DIR / ".env")


@lru_cache(maxsize=1)
def raw_config() -> dict:
    """读取项目根 config.json；缺失或损坏时返回空字典，由上层报错。"""
    try:
        return json.loads(CONFIG_JSON.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def _pick(env_key: str, section: dict, key: str, default: str = "") -> str:
    value = os.getenv(env_key)
    if value:
        return value.strip()
    found = section.get(key)
    return str(found).strip() if found is not None else default


@dataclass(frozen=True)
class LlmSettings:
    base_url: str
    api_key: str
    model: str
    timeout: float
    max_retries: int = 2

    @property
    def ready(self) -> bool:
        return bool(self.base_url and self.api_key)

    @property
    def masked_key(self) -> str:
        if len(self.api_key) <= 8:
            return "••••"
        return f"{self.api_key[:6]}••••{self.api_key[-4:]}"


@dataclass(frozen=True)
class PgSettings:
    host: str
    port: int
    user: str
    pwd: str
    db: str

    @property
    def ready(self) -> bool:
        return bool(self.host and self.user and self.db)


@dataclass(frozen=True)
class OssSettings:
    bucket: str
    ak: str
    sk: str
    endpoint: str

    @property
    def ready(self) -> bool:
        return bool(self.bucket and self.ak and self.sk and self.endpoint)

    @property
    def public_endpoint(self) -> str:
        """内网 endpoint 在非 ECS 环境不可达，提供公网镜像域名做兜底探测。"""
        return self.endpoint.replace("-internal", "")


@dataclass(frozen=True)
class ServerSettings:
    host: str
    port: int
    cors_origins: list[str]
    api_token: str


@dataclass(frozen=True)
class SimSettings:
    """Agent 仿真服务（被评测的对象）。

    凭据来自 config.json 顶层的 base_url / cookie（浏览器抓包得到的会话 Cookie），
    与 llm（裁判用）是两套独立的上游。cookie 过期需重新抓取替换。
    """
    base_url: str
    cookie: str
    agent_id: str
    timeout: float
    max_turns: int

    @property
    def ready(self) -> bool:
        return bool(self.base_url and self.cookie)

    @property
    def masked_cookie(self) -> str:
        if len(self.cookie) <= 16:
            return "••••"
        return f"{self.cookie[:10]}••••{self.cookie[-6:]}"


@dataclass(frozen=True)
class FeishuSettings:
    """飞书网页扫码登录（OAuth 2.0 授权码模式）。"""
    app_id: str
    app_secret: str
    redirect_uri: str
    # 端点可配置，便于飞书侧调整或私有化部署时替换
    authorize_url: str = "https://accounts.feishu.cn/open-apis/authen/v1/authorize"
    token_url: str = "https://open.feishu.cn/open-apis/authen/v2/oauth/token"
    userinfo_url: str = "https://open.feishu.cn/open-apis/authen/v1/user_info"
    # 会话有效期（小时）
    session_hours: int = 24 * 7

    @property
    def ready(self) -> bool:
        """凭据是否齐备。未配置时前端自动退回本地模拟登录，避免开发环境被锁死。"""
        return bool(self.app_id and self.app_secret)

    @property
    def masked_secret(self) -> str:
        if len(self.app_secret) <= 8:
            return "••••"
        return f"{self.app_secret[:4]}••••{self.app_secret[-4:]}"


def _section(*names: str) -> dict:
    """按候选 key 顺序取配置段，容忍 pg / Postgre / postgres 等写法差异。"""
    cfg = raw_config()
    for name in names:
        sec = cfg.get(name)
        if isinstance(sec, dict):
            return sec
    return {}


@lru_cache(maxsize=1)
def llm_settings() -> LlmSettings:
    sec = _section("llm")
    return LlmSettings(
        base_url=_pick("LLM_BASE_URL", sec, "base_url").rstrip("/"),
        api_key=_pick("LLM_API_KEY", sec, "api_key"),
        model=_pick("LLM_MODEL", sec, "model", "gpt-5.6-sol"),
        timeout=float(os.getenv("LLM_TIMEOUT", "120")),
    )


@lru_cache(maxsize=1)
def pg_settings() -> PgSettings:
    sec = _section("pg", "Postgre", "postgres", "postgresql", "PG")
    return PgSettings(
        host=_pick("PG_HOST", sec, "host"),
        port=int(_pick("PG_PORT", sec, "port", "5432") or 5432),
        user=_pick("PG_USER", sec, "user"),
        pwd=_pick("PG_PWD", sec, "pwd") or _pick("PG_PWD", sec, "password"),
        db=_pick("PG_DB", sec, "db") or _pick("PG_DB", sec, "database"),
    )


@lru_cache(maxsize=1)
def oss_settings() -> OssSettings:
    sec = _section("oss", "OSS")
    # config.json 里 key 用的是 "bucket-name"，兼容三种写法
    bucket = (
        _pick("OSS_BUCKET", sec, "bucket-name")
        or _pick("OSS_BUCKET", sec, "bucket")
        or _pick("OSS_BUCKET", sec, "bucket_name")
    )
    return OssSettings(
        bucket=bucket,
        ak=_pick("OSS_AK", sec, "AK") or _pick("OSS_AK", sec, "access_key_id"),
        sk=_pick("OSS_SK", sec, "SK") or _pick("OSS_SK", sec, "access_key_secret"),
        endpoint=_pick("OSS_ENDPOINT", sec, "endpoint"),
    )


@lru_cache(maxsize=1)
def server_settings() -> ServerSettings:
    origins = os.getenv("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000")
    return ServerSettings(
        host=os.getenv("HOST", "127.0.0.1"),
        port=int(os.getenv("PORT", "8000")),
        cors_origins=[o.strip() for o in origins.split(",") if o.strip()],
        api_token=os.getenv("API_TOKEN", "").strip(),
    )


@lru_cache(maxsize=1)
def sim_settings() -> SimSettings:
    """Agent 仿真上游：凭据取自 config.json 顶层（非某个子段）。"""
    cfg = raw_config()
    return SimSettings(
        base_url=(os.getenv("SIM_BASE_URL") or str(cfg.get("base_url") or "")).strip().rstrip("/"),
        cookie=(os.getenv("SIM_COOKIE") or str(cfg.get("cookie") or "")).strip(),
        agent_id=(os.getenv("SIM_AGENT_ID") or str(cfg.get("agent_id") or "skill-edit-agent")).strip(),
        timeout=float(os.getenv("SIM_TIMEOUT", "60") or 60),
        max_turns=int(os.getenv("SIM_MAX_TURNS", "10") or 10),
    )


@lru_cache(maxsize=1)
def feishu_settings() -> FeishuSettings:
    sec = _section("feishu", "lark", "Feishu")
    return FeishuSettings(
        app_id=_pick("FEISHU_APP_ID", sec, "app_id"),
        app_secret=_pick("FEISHU_APP_SECRET", sec, "app_secret"),
        redirect_uri=_pick(
            "FEISHU_REDIRECT_URI", sec, "redirect_uri",
            # 注意是前端页面路由，不是后端 /api/auth/... 接口
            "http://localhost:3000/auth/feishu/callback",
        ),
        authorize_url=_pick(
            "FEISHU_AUTHORIZE_URL", sec, "authorize_url",
            "https://accounts.feishu.cn/open-apis/authen/v1/authorize",
        ),
        token_url=_pick(
            "FEISHU_TOKEN_URL", sec, "token_url",
            "https://open.feishu.cn/open-apis/authen/v2/oauth/token",
        ),
        userinfo_url=_pick(
            "FEISHU_USERINFO_URL", sec, "userinfo_url",
            "https://open.feishu.cn/open-apis/authen/v1/user_info",
        ),
        session_hours=int(os.getenv("FEISHU_SESSION_HOURS", "168") or 168),
    )


def reload_config() -> None:
    """清空缓存，用于 PUT /api/admin/reload 热重载配置。"""
    for fn in (raw_config, llm_settings, pg_settings, oss_settings, server_settings, sim_settings, feishu_settings):
        fn.cache_clear()
