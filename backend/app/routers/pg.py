# -*- coding: utf-8 -*-
"""PostgreSQL 相关接口。"""
from __future__ import annotations

import re

from fastapi import APIRouter
from pydantic import BaseModel

from ..responses import ServiceError, ok
from ..services import pg_service

router = APIRouter(prefix="/api/pg", tags=["postgres"])

_READONLY = re.compile(r"^\s*(select|with)\b", re.IGNORECASE)


class QueryRequest(BaseModel):
    sql: str
    limit: int = 200


@router.get("/probe")
def probe() -> dict:
    """分层探测：TCP → 登录 → 元信息，逐步返回明细。"""
    return ok(pg_service.probe())


@router.post("/query")
def query(req: QueryRequest) -> dict:
    """只读查询，仅放行 SELECT / WITH，防止误操作生产库。"""
    if not _READONLY.match(req.sql):
        raise ServiceError("只允许只读查询（SELECT / WITH）", 400)
    rows = pg_service.query(req.sql, limit=max(1, min(req.limit, 1000)))
    return ok({"rows": rows, "count": len(rows)})
