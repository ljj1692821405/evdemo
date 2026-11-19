# -*- coding: utf-8 -*-
"""结果查询服务。"""
from __future__ import annotations

from typing import Any

from ..pg_service import query, execute
from ...responses import ServiceError
from ...tenant import get_tenant, resolve_org, scope_conditions


def row_to_result(row: dict[str, Any]) -> dict[str, Any]:
    """数据库行 → 前端 DTO（snake_case 转 camelCase）。

    与 dataset_service._row_to_case / task_executor_service.row_to_task 同约定。
    """
    return {
        "id": row.get("id"),
        "taskId": row.get("task_id"),
        "flowId": row.get("flow_id"),
        "inputData": row.get("input_data"),
        "rawOutput": row.get("raw_output"),
        "processedOutput": row.get("processed_output"),
        "status": row.get("status"),
        "latencyMs": int(row.get("latency_ms") or 0),
        "errorMessage": row.get("error_message") or "",
        "createdAt": str(row.get("created_at") or ""),
    }


def get_result(result_id: int) -> dict[str, Any] | None:
    """查询单个结果详情（限定在当前租户内）。"""
    conditions, params = scope_conditions()
    sql = f"""
        SELECT 
            id, task_id, flow_id, org_id, product_line_id, agent_id,
            input_data, raw_output, processed_output,
            status, latency_ms, error_message, created_at
        FROM eval_results
        WHERE id = %s AND {' AND '.join(conditions)}
    """
    
    try:
        rows = query(sql, params=(result_id, *params), limit=1)
        return rows[0] if rows else None
    except Exception as e:
        raise ServiceError(f"查询结果失败：{e}", 500) from e


def list_results(
    task_id: str | None = None,
    flow_id: str | None = None,
    org_id: str | None = None,
    status: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> list[dict[str, Any]]:
    """查询结果列表。"""
    conditions, params = scope_conditions(org_id=org_id)
    
    if task_id:
        conditions.append("task_id = %s")
        params.append(task_id)
    
    if flow_id:
        conditions.append("flow_id = %s")
        params.append(flow_id)
    
    if status:
        conditions.append("status = %s")
        params.append(status)
    
    where_clause = " AND ".join(conditions)
    
    sql = f"""
        SELECT 
            id, task_id, flow_id, org_id,
            input_data, processed_output,
            status, latency_ms, created_at
        FROM eval_results
        WHERE {where_clause}
        ORDER BY created_at DESC
        LIMIT %s OFFSET %s
    """
    params.extend([limit, offset])
    
    try:
        return query(sql, params=tuple(params))
    except Exception as e:
        raise ServiceError(f"查询结果列表失败：{e}", 500) from e


def create_result(
    task_id: str,
    flow_id: str,
    org_id: str,
    input_data: dict[str, Any],
    raw_output: dict[str, Any],
    processed_output: dict[str, Any],
    status: str = "completed",
    latency_ms: int = 0,
    error_message: str = "",
) -> int:
    """创建结果记录。"""
    import json

    org_id = resolve_org(org_id)
    tenant = get_tenant()

    sql = """
        INSERT INTO eval_results (
            task_id, flow_id, org_id, product_line_id, agent_id,
            input_data, raw_output, processed_output,
            status, latency_ms, error_message
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        RETURNING id
    """
    params = (
        task_id,
        flow_id,
        org_id,
        tenant.product_line_id,
        tenant.agent_id,
        json.dumps(input_data),
        json.dumps(raw_output),
        json.dumps(processed_output),
        status,
        latency_ms,
        error_message,
    )
    
    try:
        rows = execute(sql, params=params, fetch=True)
        return int(rows[0]["id"]) if rows else 0
    except Exception as e:
        raise ServiceError(f"创建结果记录失败：{e}", 500) from e
