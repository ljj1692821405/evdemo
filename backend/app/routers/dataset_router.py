# -*- coding: utf-8 -*-
"""数据集 / Case API 路由。"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field

from .. import rbac
from ..responses import ServiceError, ok
from ..services.dataset_management import dataset_service
from ..tenant import get_tenant

router = APIRouter(tags=["数据集"])


class CreateDatasetRequest(BaseModel):
    id: str = Field(description="前端生成的数据集唯一 ID")
    name: str
    agentId: str = Field(default="ag_skill", description="所属 Agent")
    version: str = "v1"
    tags: list[str] = Field(default_factory=list)
    defaultGt: bool = False


class CasePayload(BaseModel):
    id: str
    query: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    workspaceSize: str = "—"
    gtSource: str = "missing"
    gtKeys: list[str] = Field(default_factory=list)
    valid: bool = True
    invalidReason: str | None = None
    raw: dict[str, Any] = Field(default_factory=dict)


class AddCasesRequest(BaseModel):
    cases: list[CasePayload]
    agentId: str = "ag_skill"


# ========== 数据集 ==========

@router.get("/api/datasets")
async def list_datasets(
    agent_id: str | None = Query(None),
    org_id: str | None = Query(None),
) -> dict[str, Any]:
    return ok({"datasets": dataset_service.list_datasets(agent_id, org_id)})


@router.post("/api/datasets")
async def create_dataset(req: CreateDatasetRequest, _role: str = rbac.require(rbac.PERM_DATASET_WRITE)) -> dict[str, Any]:
    if not req.name.strip():
        raise ServiceError("数据集名称不能为空", 400)
    dataset = dataset_service.create_dataset(
        dataset_id=req.id,
        name=req.name.strip(),
        agent_id=req.agentId,
        version=req.version,
        tags=req.tags,
        default_gt=req.defaultGt,
    )
    return ok(dataset)


@router.delete("/api/datasets/{dataset_id}")
async def delete_dataset(dataset_id: str, _role: str = rbac.require(rbac.PERM_DATASET_WRITE)) -> dict[str, Any]:
    if not dataset_service.delete_dataset(dataset_id):
        raise ServiceError(f"数据集 {dataset_id} 不存在", 404)
    return ok({"id": dataset_id, "message": "已删除"})


# ========== Case ==========

@router.get("/api/cases")
async def list_all_cases(
    agent_id: str | None = Query(None),
    dataset_id: str | None = Query(None),
) -> dict[str, Any]:
    return ok({"cases": dataset_service.list_cases(dataset_id, agent_id)})


@router.get("/api/tenant/context")
async def tenant_context() -> dict[str, Any]:
    """调试用：返回当前请求解析出的租户上下文（前端联调时确认请求头生效）。"""
    tenant = get_tenant()
    return ok({
        "org_id": tenant.org_id,
        "product_line_id": tenant.product_line_id,
        "agent_id": tenant.agent_id,
        "user": tenant.user,
        "scoped": tenant.scoped,
    })


@router.get("/api/datasets/{dataset_id}/cases")
async def list_dataset_cases(dataset_id: str) -> dict[str, Any]:
    return ok({"cases": dataset_service.list_cases(dataset_id)})


@router.post("/api/datasets/{dataset_id}/cases")
async def add_cases(dataset_id: str, req: AddCasesRequest, _role: str = rbac.require(rbac.PERM_DATASET_WRITE)) -> dict[str, Any]:
    if not req.cases:
        raise ServiceError("cases 不能为空", 400)
    added = dataset_service.add_cases(
        dataset_id,
        req.agentId,
        [c.model_dump() for c in req.cases],
    )
    return ok({"added": added, "cases": dataset_service.list_cases(dataset_id)})


@router.delete("/api/cases/{case_id}")
async def delete_case(case_id: str, _role: str = rbac.require(rbac.PERM_DATASET_WRITE)) -> dict[str, Any]:
    if not dataset_service.delete_case(case_id):
        raise ServiceError(f"Case {case_id} 不存在", 404)
    return ok({"id": case_id, "message": "已删除"})
