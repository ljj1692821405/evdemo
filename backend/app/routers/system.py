# -*- coding: utf-8 -*-
"""健康检查与配置热重载。"""
from __future__ import annotations

import time

from fastapi import APIRouter

from .. import __version__
from ..config import llm_settings, oss_settings, pg_settings, reload_config, server_settings
from ..responses import ok

router = APIRouter(prefix="/api", tags=["system"])

_STARTED = time.time()


@router.get("/health")
def health() -> dict:
    llm, pg, oss = llm_settings(), pg_settings(), oss_settings()
    return ok(
        {
            "version": __version__,
            "uptime_sec": int(time.time() - _STARTED),
            "config_ready": {
                "llm": llm.ready,
                "pg": pg.ready,
                "oss": oss.ready,
            },
            "targets": {
                "llm": {"base_url": llm.base_url, "model": llm.model, "api_key_masked": llm.masked_key},
                "pg": {"host": pg.host, "port": pg.port, "db": pg.db, "user": pg.user},
                "oss": {"bucket": oss.bucket, "endpoint": oss.endpoint},
            },
        }
    )


@router.post("/admin/reload")
def reload() -> dict:
    """改完 config.json / .env 后无需重启进程。"""
    reload_config()
    _ = server_settings()
    return ok({"reloaded": True})
