# -*- coding: utf-8 -*-
"""评分器版本 API 路由。

前端「评分器调试台」里的草稿只存在于浏览内存；本路由只处理**发布后的不可变版本**。
前后端分工：
  · 前端负责草稿编辑、试跑、发布门禁的交互体验
  · 后端负责版本固化（append-only）、历史查询、差异对比、实验引用解析
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field

from .. import rbac
from ..responses import ServiceError, ok
from ..services.scorer_management import scorer_version_service

router = APIRouter(prefix="/api/scorers", tags=["评分器版本"])


# ========== 请求模型 ==========

class PublishScorerRequest(BaseModel):
    """发布评分器：把前端草稿固化成不可变版本。"""

    config: dict[str, Any] = Field(
        description="完整配置快照（name / inputs / promptTemplate / capabilityRef / judgeModel ...）"
    )
    version: int | None = Field(
        default=None, description="目标版本号；留空则自动取 max(version)+1"
    )
    name: str = Field(default="", description="评分器名称；留空取 config.name")
    capabilityId: str = Field(default="", alias="capability_id", description="绑定的能力 ID")
    capabilityVersion: str = Field(default="", alias="capability_version", description="绑定的能力版本")
    promptVersion: str = Field(default="", alias="prompt_version", description="提示词版本标签")
    trialPassed: bool = Field(
        default=False, alias="trial_passed", description="试跑是否通过；未通过一律拒绝发布"
    )
    note: str = Field(default="", description="发布说明，建议写清本次改了什么")
    createdBy: str = Field(default="system", alias="created_by", description="发布人")

    model_config = {"populate_by_name": True}


# ========== 发布 ==========

@router.post("/{scorer_id}/publish")
async def publish_scorer_version(
    scorer_id: str,
    req: PublishScorerRequest,
    _role: str = rbac.require(rbac.PERM_EVAL_WRITE),
) -> dict[str, Any]:
    """发布评分器版本（append-only，同一版本号不可覆盖）。"""
    published = scorer_version_service.publish_version(
        scorer_id,
        req.config,
        version=req.version,
        name=req.name,
        capability_id=req.capabilityId,
        capability_version=req.capabilityVersion,
        prompt_version=req.promptVersion,
        trial_passed=req.trialPassed,
        note=req.note,
        created_by=req.createdBy,
    )
    return ok(published)


# ========== 查询 ==========

@router.get("/{scorer_id}/versions")
async def list_scorer_versions(
    scorer_id: str,
    limit: int = Query(50, ge=1, le=200),
) -> dict[str, Any]:
    """列出评分器历史版本（新的在前，不含 config 大字段）。"""
    versions = scorer_version_service.list_versions(scorer_id, limit=limit)
    return ok({"scorerId": scorer_id, "versions": versions, "total": len(versions)})


@router.get("/{scorer_id}/versions/latest")
async def get_latest_scorer_version(scorer_id: str) -> dict[str, Any]:
    """取最新已发布版本（升版派生草稿时复制用）。"""
    latest = scorer_version_service.latest_version(scorer_id)
    if not latest:
        raise ServiceError(f"评分器 {scorer_id} 还没有任何已发布版本", 404)
    return ok(latest)


@router.get("/{scorer_id}/versions/{version}")
async def get_scorer_version(scorer_id: str, version: int) -> dict[str, Any]:
    """取指定版本的完整快照（实验运行、回溯查看的权威来源）。"""
    snapshot = scorer_version_service.get_version(scorer_id, version)
    if not snapshot:
        raise ServiceError(f"评分器 {scorer_id} 的版本 {version} 不存在", 404)
    return ok(snapshot)


# ========== 差异对比 ==========

@router.get("/{scorer_id}/diff")
async def diff_scorer_versions(
    scorer_id: str,
    from_version: int = Query(..., alias="from", description="基准版本"),
    to_version: int = Query(..., alias="to", description="对比版本"),
) -> dict[str, Any]:
    """对比两个已发布版本，返回字段级差异（只读）。"""
    return ok(scorer_version_service.diff_versions(scorer_id, from_version, to_version))


# ========== 回溯 ==========

@router.post("/{scorer_id}/versions/{version}/restore")
async def restore_scorer_version(
    scorer_id: str,
    version: int,
    _role: str = rbac.require(rbac.PERM_EVAL_WRITE),
) -> dict[str, Any]:
    """取回历史版本内容，供前端派生新草稿（不写库、不改历史）。"""
    return ok(scorer_version_service.restore_payload(scorer_id, version))
