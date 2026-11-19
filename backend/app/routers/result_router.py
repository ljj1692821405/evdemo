# -*- coding: utf-8 -*-
"""结果查询 API 路由。"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Query
from pydantic import BaseModel

from ..responses import ServiceError, ok
from ..services.result_processing import result_service

router = APIRouter(prefix="/api/results", tags=["结果查询"])


@router.get("")
async def list_results(
    task_id: str | None = Query(None, description="按任务过滤"),
    flow_id: str | None = Query(None, description="按流程过滤"),
    org_id: str | None = Query(None, description="按组织过滤"),
    status: str | None = Query(None, description="按状态过滤: completed/failed"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> dict[str, Any]:
    """查询评测结果列表。"""
    results = result_service.list_results(
        task_id=task_id,
        flow_id=flow_id,
        org_id=org_id,
        status=status,
        limit=limit,
        offset=offset,
    )
    
    return ok({
        "results": [result_service.row_to_result(r) for r in results],
        "total": len(results),
        "limit": limit,
        "offset": offset,
    })


@router.get("/{result_id}")
async def get_result(result_id: int) -> dict[str, Any]:
    """查询单个结果详情。"""
    result = result_service.get_result(result_id)

    if not result:
        raise ServiceError(f"结果记录 {result_id} 不存在", 404)

    return ok(result_service.row_to_result(result))


@router.get("/export/{task_id}")
async def export_results(
    task_id: str,
    format: str = Query("json", description="导出格式: json/csv"),
) -> dict[str, Any]:
    """导出任务的所有结果。"""
    results = result_service.list_results(task_id=task_id, limit=10000)
    
    if not results:
        raise ServiceError(f"任务 {task_id} 没有结果数据", 404)
    
    if format == "csv":
        # TODO: 实现 CSV 导出
        raise ServiceError("CSV 导出功能待实现", 501)
    
    return ok({
        "task_id": task_id,
        "format": format,
        "count": len(results),
        "data": results,
    })
