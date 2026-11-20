# -*- coding: utf-8 -*-
"""能力版本 API 路由。

能力 = 纯引擎（executionType + outputSchema）。草稿在前端，发布后的版本固化在这里，
供评分器的 capabilityRef 引用。版本号是语义化字符串（v3.0.0）。
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field

from .. import rbac
from ..responses import ServiceError, ok
from ..services.capability_management import capability_version_service

router = APIRouter(prefix="/api/capabilities", tags=["能力版本"])


class PublishCapabilityRequest(BaseModel):
    """发布能力版本。"""

    config: dict[str, Any] = Field(
        description="完整配置快照（executionType / outputSchema / entrypoint / httpConfig ...）"
    )
    version: str = Field(default="", description="语义化版本号，如 v3.0.0；留空自动推导下一个主版本")
    name: str = Field(default="", description="能力名称；留空取 config.name")
    executionType: str = Field(default="", alias="execution_type", description="执行类型")
    trialPassed: bool = Field(default=False, alias="trial_passed", description="调试台是否试跑通过（仅记录）")
    createdBy: str = Field(default="system", alias="created_by")

    model_config = {"populate_by_name": True}


@router.post("/{capability_id}/publish")
async def publish_capability_version(
    capability_id: str,
    req: PublishCapabilityRequest,
    _role: str = rbac.require(rbac.PERM_EVAL_WRITE),
) -> dict[str, Any]:
    """发布能力版本（append-only，同一版本号不可覆盖）。"""
    published = capability_version_service.publish_version(
        capability_id,
        req.config,
        version=req.version,
        name=req.name,
        execution_type=req.executionType,
        trial_passed=req.trialPassed,
        created_by=req.createdBy,
    )
    return ok(published)


@router.get("/{capability_id}/versions")
async def list_capability_versions(
    capability_id: str,
    limit: int = Query(50, ge=1, le=200),
) -> dict[str, Any]:
    """列出能力历史版本（新的在前）。"""
    versions = capability_version_service.list_versions(capability_id, limit=limit)
    return ok({"capabilityId": capability_id, "versions": versions, "total": len(versions)})


@router.get("/{capability_id}/versions/latest")
async def get_latest_capability_version(capability_id: str) -> dict[str, Any]:
    """取最新发布版本（注意：必须定义在 /versions/{version} 之前）。"""
    latest = capability_version_service.latest_version(capability_id)
    if not latest:
        raise ServiceError(f"能力 {capability_id} 还没有任何已发布版本", 404)
    return ok(latest)


@router.get("/{capability_id}/versions/{version}")
async def get_capability_version(capability_id: str, version: str) -> dict[str, Any]:
    """取指定版本完整快照。"""
    snapshot = capability_version_service.get_version(capability_id, version)
    if not snapshot:
        raise ServiceError(f"能力 {capability_id} 的版本 {version} 不存在", 404)
    return ok(snapshot)


@router.get("/{capability_id}/diff")
async def diff_capability_versions(
    capability_id: str,
    from_version: str = Query(..., alias="from", description="基准版本，如 v3.0.0"),
    to_version: str = Query(..., alias="to", description="对比版本，如 v3.1.0"),
) -> dict[str, Any]:
    """对比两个能力版本；breaking 表示执行入口 / 输出契约变了。"""
    return ok(capability_version_service.diff_versions(capability_id, from_version, to_version))


@router.post("/{capability_id}/versions/{version}/restore")
async def restore_capability_version(
    capability_id: str,
    version: str,
    _role: str = rbac.require(rbac.PERM_EVAL_WRITE),
) -> dict[str, Any]:
    """取回历史版本内容，供前端派生新草稿（不写库、不改历史）。"""
    return ok(capability_version_service.restore_payload(capability_id, version))
