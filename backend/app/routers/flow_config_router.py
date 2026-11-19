# -*- coding: utf-8 -*-
"""流程配置 API 路由。"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field

from .. import rbac
from ..responses import ServiceError, ok
from ..services.flow_management import flow_config_service

router = APIRouter(prefix="/api/flows", tags=["流程配置"])


# ========== 请求/响应模型 ==========

class FlowInputSchema(BaseModel):
    """流程输入字段定义。"""
    required_fields: list[str] = Field(description="必需字段列表")
    optional_fields: list[str] = Field(default_factory=list, description="可选字段列表")


class FlowSimulationConfig(BaseModel):
    """仿真服务配置。"""
    api_url: str = Field(description="仿真服务 API 地址")
    timeout: int = Field(default=120, description="超时秒数")
    headers: dict[str, str] = Field(default_factory=dict, description="自定义请求头")
    retries: int = Field(default=1, description="失败重试次数")


class FlowOutputField(BaseModel):
    """输出字段映射规则。"""
    name: str = Field(description="输出字段名")
    source_path: str = Field(description="raw_output 中的 JSONPath")
    type: str = Field(default="string", description="字段类型")
    transform: str | None = Field(default=None, description="转换规则")


class FlowOutputSchema(BaseModel):
    """流程输出字段定义。"""
    display_fields: list[FlowOutputField] = Field(description="要提取的字段列表")


class FlowJudgeConfig(BaseModel):
    """LLM 评判配置（可选，不填则不评判）。"""
    enabled: bool = Field(default=True, description="是否启用评判")
    model: str = Field(default="", description="裁判模型，留空用全局 llm.model")
    rubric: str = Field(default="", description="评分标准正文，留空用内置默认")
    gt_field: str = Field(default="gt", description="input_data 中参考答案的键")
    reply_field: str = Field(default="final_reply", description="processed_output 中待评回复的键")
    dimension: str = Field(default="answer_quality", description="打分维度名")


class CreateFlowRequest(BaseModel):
    """创建流程配置请求。"""
    flow_id: str = Field(description="流程唯一标识")
    name: str = Field(description="流程名称")
    description: str = Field(default="", description="流程描述")
    version: str = Field(default="1.0", description="版本号")
    org_id: str = Field(default="", description="组织 ID（留空则取请求头 x-org-id）")
    product_line_id: str = Field(default="", description="产线 ID（留空则取请求头）")
    agent_id: str = Field(default="", description="Agent ID（留空则取请求头）")
    input_schema: FlowInputSchema
    simulation_config: FlowSimulationConfig
    output_schema: FlowOutputSchema
    judge_config: FlowJudgeConfig | None = Field(default=None, description="裁判配置，不填不评判")
    created_by: str = Field(default="system", description="创建人")


class UpdateFlowRequest(BaseModel):
    """更新流程配置请求。"""
    name: str | None = None
    description: str | None = None
    version: str | None = None
    status: str | None = None
    input_schema: FlowInputSchema | None = None
    simulation_config: FlowSimulationConfig | None = None
    output_schema: FlowOutputSchema | None = None
    judge_config: FlowJudgeConfig | None = None


# ========== API 端点 ==========

@router.post("")
async def create_flow(req: CreateFlowRequest, _role: str = rbac.require(rbac.PERM_FLOW_WRITE)) -> dict[str, Any]:
    """创建评测流程配置。"""
    existing = flow_config_service.get_flow_config(req.flow_id)
    if existing:
        raise ServiceError(f"流程 ID '{req.flow_id}' 已存在", 400)
    
    # 请求体未显式指定时传 None，交由 resolve_* 回落到请求头
    flow_id = flow_config_service.create_flow_config(
        flow_id=req.flow_id,
        name=req.name,
        description=req.description,
        version=req.version,
        org_id=req.org_id or None,
        input_schema=req.input_schema.model_dump(),
        simulation_config=req.simulation_config.model_dump(),
        output_schema=req.output_schema.model_dump(),
        created_by=req.created_by,
        product_line_id=req.product_line_id or None,
        agent_id=req.agent_id or None,
    )

    # 裁判配置单独写：为空表示该流程不评判，避免无谓的 LLM 调用
    if req.judge_config:
        flow_config_service.update_flow_config(
            flow_id, judge_config=req.judge_config.model_dump()
        )

    # 首次创建也留一个版本快照，保证历史可追溯
    flow_config_service.snapshot_version(flow_id, created_by=req.created_by)

    return ok({"flow_id": flow_id, "message": "流程配置创建成功"})


@router.get("")
async def list_flows(
    org_id: str | None = Query(None),
    product_line_id: str | None = Query(None),
    agent_id: str | None = Query(None),
    status: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> dict[str, Any]:
    """查询流程配置列表（默认限定在当前请求的租户内）。"""
    flows = flow_config_service.list_flow_configs(
        org_id, status, limit, offset, product_line_id, agent_id
    )
    return ok({"flows": flows, "total": len(flows), "limit": limit, "offset": offset})


@router.get("/{flow_id}")
async def get_flow(flow_id: str) -> dict[str, Any]:
    """查询单个流程配置详情。"""
    flow = flow_config_service.get_flow_config(flow_id)
    if not flow:
        raise ServiceError(f"流程配置 '{flow_id}' 不存在", 404)
    return ok(flow)


@router.put("/{flow_id}")
async def update_flow(flow_id: str, req: UpdateFlowRequest, _role: str = rbac.require(rbac.PERM_FLOW_WRITE)) -> dict[str, Any]:
    """更新流程配置。"""
    existing = flow_config_service.get_flow_config(flow_id)
    if not existing:
        raise ServiceError(f"流程配置 '{flow_id}' 不存在", 404)
    
    updates = req.model_dump(exclude_none=True)
    if not updates:
        raise ServiceError("没有提供要更新的字段", 400)

    # 更新前先快照当前状态，否则旧配置被覆盖后无法回溯
    flow_config_service.snapshot_version(flow_id)

    success = flow_config_service.update_flow_config(flow_id, **updates)
    if not success:
        raise ServiceError("更新失败", 500)

    return ok({"flow_id": flow_id, "message": "流程配置更新成功"})


# ========== 版本控制 ==========

@router.get("/{flow_id}/versions")
async def list_flow_versions(flow_id: str, limit: int = Query(50, ge=1, le=200)) -> dict[str, Any]:
    """列出流程的历史版本（新的在前）。"""
    versions = flow_config_service.list_versions(flow_id, limit=limit)
    return ok({"flowId": flow_id, "versions": versions, "total": len(versions)})


@router.get("/{flow_id}/versions/{version}")
async def get_flow_version(flow_id: str, version: str) -> dict[str, Any]:
    """取某个版本的完整快照。"""
    snapshot = flow_config_service.get_version(flow_id, version)
    if not snapshot:
        raise ServiceError(f"流程 '{flow_id}' 的版本 '{version}' 不存在", 404)
    return ok(snapshot)


@router.post("/{flow_id}/rollback/{version}")
async def rollback_flow(flow_id: str, version: str, _role: str = rbac.require(rbac.PERM_FLOW_WRITE)) -> dict[str, Any]:
    """回滚到指定历史版本（回滚前会自动留档当前状态）。"""
    success = flow_config_service.rollback_to_version(flow_id, version)
    if not success:
        raise ServiceError(f"回滚失败：流程 '{flow_id}' 或版本 '{version}' 不存在", 404)
    return ok({"flowId": flow_id, "version": version, "message": f"已回滚到版本 {version}"})


@router.delete("/{flow_id}")
async def delete_flow(flow_id: str, _role: str = rbac.require(rbac.PERM_FLOW_WRITE)) -> dict[str, Any]:
    """删除流程配置（软删除）。"""
    success = flow_config_service.soft_delete_flow_config(flow_id)
    if not success:
        raise ServiceError(f"流程配置 '{flow_id}' 不存在或已删除", 404)
    return ok({"flow_id": flow_id, "message": "流程配置已删除"})

