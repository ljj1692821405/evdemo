# -*- coding: utf-8 -*-
"""实验 API 路由。

实验是唯一持久化的评测对象。创建时后端会校验 scorerRefs 指向的版本都存在，
把 (id, version) 写死，之后评分器升版不影响该实验——这是「结果可复现」的底座。
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field

from .. import rbac
from ..responses import ServiceError, ok
from ..services.experiment_management import experiment_service
from ..services.scorer_management import scorer_version_service

router = APIRouter(prefix="/api/experiments", tags=["实验"])


class ScorerRef(BaseModel):
    """评分器版本引用。"""

    id: str = Field(description="评分器 ID")
    version: int = Field(description="已发布的评分器版本号")


class CreateExperimentRequest(BaseModel):
    name: str = Field(description="实验名称")
    scorerRefs: list[ScorerRef] = Field(alias="scorer_refs", description="评分器版本引用列表")
    experimentId: str = Field(default="", alias="experiment_id", description="留空自动生成")
    description: str = Field(default="")
    snapshotId: str = Field(default="", alias="snapshot_id", description="仿真数据快照 ID，必填")
    fieldDictVersion: str = Field(default="", alias="field_dict_version")
    weights: dict[str, Any] = Field(default_factory=dict)
    createdBy: str = Field(default="system", alias="created_by")

    model_config = {"populate_by_name": True}


class CreateRunRequest(BaseModel):
    units: int = Field(default=0, description="本次运行的评测单元总数")
    status: str = Field(default="queued")
    summary: dict[str, Any] = Field(default_factory=dict)
    detail: list[Any] = Field(default_factory=list)


class UpdateRunRequest(BaseModel):
    status: str | None = None
    doneUnits: int | None = Field(default=None, alias="done_units")
    errors: int | None = None
    cost: str | None = None
    summary: dict[str, Any] | None = None
    detail: list[Any] | None = None
    finished: bool = False

    model_config = {"populate_by_name": True}


# ========== 实验 ==========

@router.post("")
async def create_experiment(
    req: CreateExperimentRequest,
    _role: str = rbac.require(rbac.PERM_EVAL_WRITE),
) -> dict[str, Any]:
    """创建实验。先校验所有 scorerRefs 的版本真实存在，缺一个就整体拒绝。"""
    refs = [{"id": r.id, "version": r.version} for r in req.scorerRefs]
    # 版本存在性校验（缺失会抛 400 SCORER_VERSION_MISSING）
    scorer_version_service.resolve_refs(refs)

    experiment = experiment_service.create_experiment(
        req.name,
        refs,
        experiment_id=req.experimentId,
        description=req.description,
        snapshot_id=req.snapshotId,
        field_dict_version=req.fieldDictVersion,
        weights=req.weights,
        created_by=req.createdBy,
    )
    return ok(experiment)


@router.get("")
async def list_experiments(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> dict[str, Any]:
    """实验列表（当前租户）。"""
    experiments = experiment_service.list_experiments(limit=limit, offset=offset)
    return ok({"experiments": experiments, "total": len(experiments), "limit": limit, "offset": offset})


@router.get("/{experiment_id}")
async def get_experiment(experiment_id: str) -> dict[str, Any]:
    """实验详情。"""
    experiment = experiment_service.get_experiment(experiment_id)
    if not experiment:
        raise ServiceError(f"实验 '{experiment_id}' 不存在", 404)
    return ok(experiment)


@router.get("/{experiment_id}/resolved")
async def get_experiment_resolved(experiment_id: str) -> dict[str, Any]:
    """实验详情 + 把 scorerRefs 解析成完整版本快照（运行前预览 / 复现核对用）。"""
    experiment = experiment_service.get_experiment(experiment_id)
    if not experiment:
        raise ServiceError(f"实验 '{experiment_id}' 不存在", 404)
    resolved = scorer_version_service.resolve_refs(experiment.get("scorerRefs") or [])
    return ok({**experiment, "resolvedScorers": resolved})


@router.delete("/{experiment_id}")
async def delete_experiment(
    experiment_id: str,
    _role: str = rbac.require(rbac.PERM_EVAL_WRITE),
) -> dict[str, Any]:
    """删除实验（连带其运行记录）。"""
    if not experiment_service.delete_experiment(experiment_id):
        raise ServiceError(f"实验 '{experiment_id}' 不存在", 404)
    return ok({"experimentId": experiment_id, "message": "实验已删除"})


# ========== 实验运行 ==========

@router.post("/{experiment_id}/runs")
async def create_run(
    experiment_id: str,
    req: CreateRunRequest,
    _role: str = rbac.require(rbac.PERM_EVAL_WRITE),
) -> dict[str, Any]:
    """登记一次实验运行；实验首次运行后引用被冻结。"""
    run = experiment_service.create_run(
        experiment_id,
        units=req.units,
        status=req.status,
        summary=req.summary,
        detail=req.detail,
    )
    return ok(run)


@router.get("/{experiment_id}/runs")
async def list_runs(experiment_id: str, limit: int = Query(50, ge=1, le=200)) -> dict[str, Any]:
    """某实验的运行列表（新的在前）。"""
    runs = experiment_service.list_runs(experiment_id, limit=limit)
    return ok({"experimentId": experiment_id, "runs": runs, "total": len(runs)})


@router.get("/runs/{run_id}")
async def get_run(run_id: str) -> dict[str, Any]:
    """单次运行详情（含 summary / detail 结果）。"""
    run = experiment_service.get_run(run_id)
    if not run:
        raise ServiceError(f"运行 '{run_id}' 不存在", 404)
    return ok(run)


@router.put("/runs/{run_id}")
async def update_run(
    run_id: str,
    req: UpdateRunRequest,
    _role: str = rbac.require(rbac.PERM_EVAL_WRITE),
) -> dict[str, Any]:
    """更新运行进度与结果（供运行器回写）。"""
    run = experiment_service.update_run(
        run_id,
        status=req.status,
        done_units=req.doneUnits,
        errors=req.errors,
        cost=req.cost,
        summary=req.summary,
        detail=req.detail,
        finished=req.finished,
    )
    if not run:
        raise ServiceError(f"运行 '{run_id}' 不存在", 404)
    return ok(run)
