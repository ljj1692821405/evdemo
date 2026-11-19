# -*- coding: utf-8 -*-
"""流程配置数据库操作服务。"""
from __future__ import annotations

import json
from typing import Any

from ..pg_service import query, execute
from ...responses import ServiceError
from ...tenant import get_tenant, resolve_agent, resolve_org, resolve_product_line, scope_conditions


def create_flow_config(
    flow_id: str,
    name: str,
    description: str,
    version: str,
    org_id: str,
    input_schema: dict[str, Any],
    simulation_config: dict[str, Any],
    output_schema: dict[str, Any],
    created_by: str = "system",
    product_line_id: str | None = None,
    agent_id: str | None = None,
) -> str:
    """创建流程配置，返回 flow_id。"""
    org_id = resolve_org(org_id)
    product_line_id = resolve_product_line(product_line_id)
    agent_id = resolve_agent(agent_id)

    sql = """
        INSERT INTO eval_flow_configs (
            flow_id, name, description, version, status, org_id,
            product_line_id, agent_id,
            input_schema, simulation_config, output_schema, created_by
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        RETURNING flow_id
    """
    params = (
        flow_id,
        name,
        description,
        version,
        "active",
        org_id,
        product_line_id,
        agent_id,
        json.dumps(input_schema),
        json.dumps(simulation_config),
        json.dumps(output_schema),
        created_by,
    )
    
    try:
        execute(sql, params=params)
        return flow_id
    except ServiceError as e:
        raise ServiceError(f"创建流程配置失败：{e.message}", 500) from e


def get_flow_config(flow_id: str) -> dict[str, Any] | None:
    """获取单个流程配置（限定在当前租户内）。"""
    conditions, params = scope_conditions()
    sql = f"""
        SELECT 
            flow_id, name, description, version, status, org_id,
            product_line_id, agent_id,
            input_schema, simulation_config, output_schema, judge_config,
            created_by, created_at, updated_at
        FROM eval_flow_configs
        WHERE flow_id = %s AND status = 'active' AND {' AND '.join(conditions)}
    """
    
    try:
        rows = query(sql, params=(flow_id, *params), limit=1)
        return rows[0] if rows else None
    except ServiceError as e:
        raise ServiceError(f"查询流程配置失败：{e.message}", 500) from e


def list_flow_configs(
    org_id: str | None = None,
    status: str | None = None,
    limit: int = 50,
    offset: int = 0,
    product_line_id: str | None = None,
    agent_id: str | None = None,
) -> list[dict[str, Any]]:
    """查询流程配置列表（限定在当前租户内）。"""
    conditions, params = scope_conditions(
        org_id=org_id,
        product_line_id=product_line_id,
        agent_id=agent_id,
    )

    if status:
        conditions.append("status = %s")
        params.append(status)
    else:
        conditions.append("status = 'active'")
    
    where_clause = " AND ".join(conditions)
    
    sql = f"""
        SELECT 
            flow_id, name, description, version, status, org_id,
            product_line_id, agent_id, created_by, created_at
        FROM eval_flow_configs
        WHERE {where_clause}
        ORDER BY created_at DESC
        LIMIT %s OFFSET %s
    """
    params.extend([limit, offset])
    
    try:
        return query(sql, params=tuple(params))
    except ServiceError as e:
        raise ServiceError(f"查询流程配置列表失败：{e.message}", 500) from e


def update_flow_config(
    flow_id: str,
    **updates: Any,
) -> bool:
    """更新流程配置（除了 flow_id）。"""
    if not updates:
        return False
    
    allowed_fields = {"name", "description", "version", "status", "input_schema", "simulation_config", "output_schema", "judge_config"}
    updates = {k: v for k, v in updates.items() if k in allowed_fields and v is not None}
    
    if not updates:
        return False
    
    # JSON 字段需要转换
    for json_field in {"input_schema", "simulation_config", "output_schema", "judge_config"}:
        if json_field in updates:
            updates[json_field] = json.dumps(updates[json_field], ensure_ascii=False)
    
    set_clause = ", ".join([f"{k} = %s" for k in updates.keys()])
    conditions, scope_params = scope_conditions()
    params = list(updates.values()) + [flow_id, *scope_params]
    
    sql = f"""
        UPDATE eval_flow_configs 
        SET {set_clause}, updated_at = CURRENT_TIMESTAMP
        WHERE flow_id = %s AND {' AND '.join(conditions)}
    """
    
    try:
        affected = execute(sql, params=tuple(params))
        return affected > 0
    except ServiceError as e:
        raise ServiceError(f"更新流程配置失败：{e.message}", 500) from e


def soft_delete_flow_config(flow_id: str) -> bool:
    """软删除流程配置（设置为 inactive，限定在当前租户内）。"""
    conditions, params = scope_conditions()
    sql = f"""
        UPDATE eval_flow_configs
        SET status = 'inactive', updated_at = CURRENT_TIMESTAMP
        WHERE flow_id = %s AND {' AND '.join(conditions)}
    """
    
    try:
        affected = execute(sql, params=(flow_id, *params))
        return affected > 0
    except ServiceError as e:
        raise ServiceError(f"删除流程配置失败：{e.message}", 500) from e


# ========== 版本控制 ==========

def snapshot_version(flow_id: str, created_by: str = "system") -> str | None:
    """把流程的当前状态写进 eval_flow_versions 快照表。

    为什么不复用 update 里的 version 字段：version 是「当前指向」，快照表是「历史留档」。
    评测任务引用的历史配置必须可追溯，所以每次改动前先落一份快照。
    返回快照的 version 号；流程不存在返回 None。
    """
    flow = get_flow_config(flow_id)
    if not flow:
        return None

    version = str(flow.get("version") or "1.0")
    tenant = get_tenant()

    def _json(value: Any) -> str:
        if isinstance(value, str):
            return value
        return json.dumps(value or {}, ensure_ascii=False)

    sql = """
        INSERT INTO eval_flow_versions (
            flow_id, version, org_id, product_line_id, agent_id,
            name, description, input_schema, simulation_config,
            output_schema, judge_config, created_by
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (flow_id, version) DO NOTHING
    """
    params = (
        flow_id,
        version,
        flow.get("org_id") or tenant.org_id,
        flow.get("product_line_id") or tenant.product_line_id,
        flow.get("agent_id") or tenant.agent_id,
        flow.get("name") or "",
        flow.get("description") or "",
        _json(flow.get("input_schema")),
        _json(flow.get("simulation_config")),
        _json(flow.get("output_schema")),
        _json(flow.get("judge_config")),
        created_by,
    )

    try:
        execute(sql, params=params)
        return version
    except ServiceError as e:
        raise ServiceError(f"创建流程版本快照失败：{e.message}", 500) from e


def list_versions(flow_id: str, limit: int = 50) -> list[dict[str, Any]]:
    """列出某个流程的所有历史版本（新的在前）。"""
    sql = """
        SELECT id, flow_id, version, name, created_by, created_at
        FROM eval_flow_versions
        WHERE flow_id = %s
        ORDER BY created_at DESC
        LIMIT %s
    """
    try:
        return query(sql, params=(flow_id, limit), limit=limit)
    except ServiceError as e:
        raise ServiceError(f"查询流程版本失败：{e.message}", 500) from e


def get_version(flow_id: str, version: str) -> dict[str, Any] | None:
    """取某个具体版本的完整快照，用于回滚或审计。"""
    sql = """
        SELECT id, flow_id, version, org_id, product_line_id, agent_id,
               name, description, input_schema, simulation_config,
               output_schema, judge_config, created_by, created_at
        FROM eval_flow_versions
        WHERE flow_id = %s AND version = %s
        LIMIT 1
    """
    try:
        rows = query(sql, params=(flow_id, version), limit=1)
        return rows[0] if rows else None
    except ServiceError as e:
        raise ServiceError(f"查询流程版本详情失败：{e.message}", 500) from e


def rollback_to_version(flow_id: str, version: str) -> bool:
    """把流程配置回滚到某个历史版本。

    回滚前先把「当前状态」也存一份快照，避免回滚本身变成不可逆操作。
    """
    target = get_version(flow_id, version)
    if not target:
        return False

    snapshot_version(flow_id)  # 先留档当前

    def _load(value: Any) -> Any:
        if isinstance(value, str):
            try:
                return json.loads(value)
            except json.JSONDecodeError:
                return value
        return value

    return update_flow_config(
        flow_id,
        name=target.get("name"),
        description=target.get("description"),
        version=target.get("version"),
        input_schema=_load(target.get("input_schema")),
        simulation_config=_load(target.get("simulation_config")),
        output_schema=_load(target.get("output_schema")),
        judge_config=_load(target.get("judge_config")),
    )

