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
    """极简 .env 解析：不覆盖已存在的环境变量，避免污染 CI/生产注入。"""
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip().strip('"').strip("'")
        if key and key not in os.environ:
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


def reload_config() -> None:
    """清空缓存，用于 PUT /api/admin/reload 热重载配置。"""
    for fn in (raw_config, llm_settings, pg_settings, oss_settings, server_settings):
        fn.cache_clear()
