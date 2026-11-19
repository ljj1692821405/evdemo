# -*- coding: utf-8 -*-
"""PostgreSQL 服务层：连通性探测 + 只读查询。"""
from __future__ import annotations

import time
from typing import Any

from ..config import pg_settings
from ..responses import ServiceError

try:  # 允许服务在其他模块未装驱动时仍能被导入（便于纯前端联调）
    import psycopg
    from psycopg.rows import dict_row
except ImportError:  # pragma: no cover
    psycopg = None  # type: ignore[assignment]
    dict_row = None  # type: ignore[assignment]


def _require_driver() -> None:
    if psycopg is None:
        raise ServiceError("未安装 psycopg，请执行 pip install -r requirements.txt", 500)


def _conninfo() -> str:
    cfg = pg_settings()
    if not cfg.host:
        raise ServiceError("未配置 PG host（config.json 的 pg.host 或环境变量 PG_HOST）", 500)
    return (
        f"host={cfg.host} port={cfg.port} user={cfg.user} "
        f"password={cfg.pwd} dbname={cfg.db} connect_timeout=5 "
        f"application_name=eval_platform"
    )


def query(sql: str, params: tuple[Any, ...] | None = None, limit: int = 200) -> list[dict[str, Any]]:
    """执行只读 SQL 并返回字典行。写操作由调用方自行把关，接口层默认只放行 SELECT。"""
    _require_driver()
    try:
        with psycopg.connect(_conninfo(), row_factory=dict_row) as conn:
            with conn.cursor() as cur:
                cur.execute(sql, params)
                rows = cur.fetchmany(limit)
        return list(rows)
    except psycopg.Error as exc:  # type: ignore[union-attr]
        raise ServiceError(f"PostgreSQL 查询失败：{exc}", 502) from exc


def execute(
    sql: str,
    params: tuple[Any, ...] | None = None,
    fetch: bool = False,
    limit: int = 200,
) -> list[dict[str, Any]] | int:
    """执行写 SQL（INSERT / UPDATE / DELETE）。

    fetch=False 时返回受影响行数（rowcount）；
    fetch=True 时返回 RETURNING 的结果行（配合 RETURNING 子句使用）。
    事务由 with psycopg.connect(...) 自动提交。
    """
    _require_driver()
    try:
        with psycopg.connect(_conninfo(), row_factory=dict_row) as conn:
            with conn.cursor() as cur:
                cur.execute(sql, params)
                if fetch:
                    return list(cur.fetchmany(limit))
                return cur.rowcount
    except psycopg.Error as exc:  # type: ignore[union-attr]
        raise ServiceError(f"PostgreSQL 执行失败：{exc}", 502) from exc


def probe() -> dict[str, Any]:
    """分层探测：TCP → 登录 → 元信息，返回每一步结果，便于定位问题。"""
    cfg = pg_settings()
    result: dict[str, Any] = {
        "target": f"{cfg.user}@{cfg.host}:{cfg.port}/{cfg.db}",
        "checks": [],
    }

    if not cfg.ready:
        result["ok"] = False
        result["error"] = "host / user / db 未配置完整"
        return result

    _require_driver()
    started = time.perf_counter()
    try:
        with psycopg.connect(_conninfo(), row_factory=dict_row) as conn:
            result["checks"].append({"step": "connect", "ok": True,
                                     "detail": f"TCP 建连 + 登录成功，耗时 {int((time.perf_counter() - started) * 1000)}ms"})
            with conn.cursor() as cur:
                cur.execute("select version() as v, current_database() as db, current_user as usr")
                info = cur.fetchone() or {}
                result["checks"].append({"step": "meta", "ok": True, "detail": info.get("v", "")})
                result["database"] = info.get("db")
                result["user"] = info.get("usr")

                cur.execute(
                    "select count(*) as n from information_schema.tables "
                    "where table_schema not in ('pg_catalog','information_schema')"
                )
                result["table_count"] = (cur.fetchone() or {}).get("n", 0)

                cur.execute(
                    "select table_name from information_schema.tables "
                    "where table_schema = 'public' order by table_name limit 20"
                )
                result["tables"] = [r["table_name"] for r in cur.fetchall()]
        result["ok"] = True
        result["latency_ms"] = int((time.perf_counter() - started) * 1000)
    except psycopg.Error as exc:  # type: ignore[union-attr]
        result["ok"] = False
        result["error"] = str(exc).strip()
        result["checks"].append({"step": "connect", "ok": False, "detail": result["error"]})
    return result
