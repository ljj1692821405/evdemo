# -*- coding: utf-8 -*-
"""快照 API 路由：固化仿真结果为只读副本，供实验重打分使用。

快照是实验的引用锚点：固化后内容不可变，items 存 sim_traj 的 turn 级结构。
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field

from .. import rbac
from ..responses import ServiceError, ok
from ..services.snapshot_management import snapshot_service

router = APIRouter(prefix="/api/snapshots", tags=["快照"])


class FreezeSnapshotRequest(BaseModel):
    """固化快照请求。"""

    sourceTaskId: str = Field(default="", alias="source_task_id", description="来源仿真任务 ID")
    items: list[dict[str, Any]] = Field(description="快照内容（sim_traj 结构）")
    datasetId: str = Field(default="", alias="dataset_id", description="数据集 ID（可选）")
    createdBy: str = Field(default="system", alias="created_by")

    model_config = {"populate_by_name": True}


@router.post("")
async def freeze_snapshot(
    req: FreezeSnapshotRequest,
    _role: str = rbac.require(rbac.PERM_EVAL_WRITE),
) -> dict[str, Any]:
    """固化快照：拷贝 sim_traj 进 eval_snapshots（只读副本）。"""
    snapshot = snapshot_service.freeze_snapshot(
        req.sourceTaskId,
        req.items,
        dataset_id=req.datasetId,
        created_by=req.createdBy,
    )
    return ok(snapshot)


@router.get("")
async def list_snapshots(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> dict[str, Any]:
    """快照列表（当前租户，不含 items 明细）。"""
    snapshots = snapshot_service.list_snapshots(limit=limit, offset=offset)
    return ok({"snapshots": snapshots, "total": len(snapshots), "limit": limit, "offset": offset})


@router.get("/{snapshot_id}")
async def get_snapshot(snapshot_id: str) -> dict[str, Any]:
    """快照详情（含 items 明细）。快照是引用锚点，不过滤租户。"""
    snapshot = snapshot_service.get_snapshot(snapshot_id)
    if not snapshot:
        raise ServiceError(f"快照 '{snapshot_id}' 不存在", 404)
    return ok(snapshot)
