# -*- coding: utf-8 -*-
"""任务管理 API 路由。"""
from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field

from .. import rbac
from ..responses import ServiceError, ok
from ..services.task_execution import task_executor_service

router = APIRouter(prefix="/api/tasks", tags=["任务管理"])


# ========== 请求/响应模型 ==========

class SubmitTaskRequest(BaseModel):
    """提交评测任务请求。

    字段用 camelCase（与前端 DTO 一致）；同时允许 snake_case 别名，兼容旧调用方。
    """
    flowId: str = Field(alias="flow_id", description="流程配置 ID")
    inputData: list[dict[str, Any]] = Field(alias="input_data", description="输入数据列表（每个元素一个 case）")
    orgId: str = Field(default="", alias="org_id", description="组织 ID（留空则取请求头 x-org-id）")
    createdBy: str = Field(default="system", alias="created_by", description="创建人")

    model_config = {"populate_by_name": True}


# ========== API 端点 ==========

@router.post("")
async def submit_task(req: SubmitTaskRequest, _role: str = rbac.require(rbac.PERM_TASK_WRITE)) -> dict[str, Any]:
    """提交评测任务。
    
    示例请求：
    ```json
    {
        "flow_id": "agent_multi_turn_eval",
        "input_data": [
            {
                "user_query": "帮我生成一个故事大纲",
                "initial_workspace": "{}"
            },
            {
                "user_query": "把主角改成女性",
                "initial_workspace": "{}"
            }
        ],
        "org_id": "comic_toc",
        "created_by": "admin"
    }
    ```
    """
    if not req.inputData:
        raise ServiceError("inputData 不能为空", 400)

    # 生成任务 ID
    task_id = f"task_{uuid.uuid4().hex[:12]}"

    # 创建任务记录
    task_executor_service.create_task(
        task_id=task_id,
        flow_id=req.flowId,
        input_data=req.inputData,
        org_id=req.orgId or "",
        created_by=req.createdBy,
    )

    # 提交到执行队列
    await task_executor_service.submit_task_for_execution(task_id)

    return ok({
        "taskId": task_id,
        "message": f"任务已提交，共 {len(req.inputData)} 个 case",
    })


@router.get("")
async def list_tasks(
    org_id: str | None = Query(None, description="按组织过滤"),
    status: str | None = Query(None, description="按状态过滤: pending/running/completed/failed"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> dict[str, Any]:
    """查询任务列表。"""
    tasks = task_executor_service.list_tasks(org_id, status, limit, offset)

    return ok({
        "tasks": [task_executor_service.row_to_task(t) for t in tasks],
        "total": len(tasks),
        "limit": limit,
        "offset": offset,
    })


@router.get("/{task_id}")
async def get_task(task_id: str) -> dict[str, Any]:
    """查询任务详情和进度。"""
    task = task_executor_service.get_task(task_id)

    if not task:
        raise ServiceError(f"任务 '{task_id}' 不存在", 404)

    return ok(task_executor_service.row_to_task(task))


@router.delete("/{task_id}")
async def cancel_task(task_id: str, _role: str = rbac.require(rbac.PERM_TASK_WRITE)) -> dict[str, Any]:
    """取消任务（仅限 pending 状态的任务）。"""
    task = task_executor_service.get_task(task_id)

    if not task:
        raise ServiceError(f"任务 '{task_id}' 不存在", 404)

    if task["status"] != "pending":
        raise ServiceError(f"任务状态为 {task['status']}，无法取消", 400)

    # 更新状态为 cancelled
    success = task_executor_service.update_task_status(task_id, "cancelled")

    if not success:
        raise ServiceError("取消任务失败", 500)

    return ok({"taskId": task_id, "message": "任务已取消"})
