# -*- coding: utf-8 -*-
"""快照服务：固化仿真结果（sim_traj）为只读副本，供实验重打分使用。

设计要点：
- 快照是实验的引用锚点，一旦固化内容不可变（只读副本）。
- items 存 sim_traj 的 turn 级结构，供离线重打分，不含 raw SSE。
"""
from __future__ import annotations

import json
import uuid
from typing import Any

from ..pg_service import execute, query
from ...responses import ServiceError
from ...tenant import resolve_agent, resolve_org, resolve_product_line, scope_conditions


def _json(value: Any) -> str:
    if isinstance(value, str):
        return value or "[]"
    return json.dumps(value if value is not None else [], ensure_ascii=False)


def _load(value: Any, default: Any) -> Any:
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return default
    return value if value is not None else default


def row_to_snapshot(row: dict[str, Any], *, with_items: bool = True) -> dict[str, Any]:
    """数据库行 → 前端结构。"""
    result = {
        "snapshotId": row.get("snapshot_id"),
        "sourceTaskId": row.get("source_task_id") or "",
        "datasetId": row.get("dataset_id") or "",
        "frozenAt": str(row.get("frozen_at") or ""),
        "orgId": row.get("org_id") or "",
        "productLineId": row.get("product_line_id") or "",
        "agentId": row.get("agent_id") or "",
        "createdBy": row.get("created_by") or "",
        "createdAt": str(row.get("created_at") or ""),
    }
    if with_items:
        items = _load(row.get("items"), [])
        result["items"] = items
        result["itemsCount"] = len(items) if isinstance(items, list) else 0
    else:
        result["itemsCount"] = int(row.get("items_count") or 0)
    return result


def freeze_snapshot(
    source_task_id: str,
    items: list[dict[str, Any]],
    *,
    dataset_id: str = "",
    created_by: str = "system",
    org_id: str | None = None,
    product_line_id: str | None = None,
    agent_id: str | None = None,
) -> dict[str, Any]:
    """固化快照：拷贝 sim_traj 进 eval_snapshots（只读副本）。

    Args:
        source_task_id: 来源仿真任务 ID（溯源用）
        items: 快照内容（sim_traj 结构）
               [{case_id, turns_gt, turns:[{turn, query, agent_reply, action_sequence, interaction_flow, ...}]}]
        dataset_id: 数据集 ID（可选）
        created_by: 创建人

    Returns:
        前端结构的快照对象
    """
    if not isinstance(items, list):
        raise ServiceError("items 必须是数组", 400)

    snapshot_id = f"snap-{uuid.uuid4().hex[:16]}"
    org = resolve_org(org_id)
    line = resolve_product_line(product_line_id)
    agent = resolve_agent(agent_id)

    rows = execute(
        """
        INSERT INTO eval_snapshots
            (snapshot_id, source_task_id, dataset_id, items,
             org_id, product_line_id, agent_id, created_by)
        VALUES (%s, %s, %s, %s::jsonb, %s, %s, %s, %s)
        RETURNING snapshot_id, source_task_id, dataset_id, items, frozen_at,
                  org_id, product_line_id, agent_id, created_by, created_at
        """,
        params=(
            snapshot_id,
            source_task_id,
            dataset_id,
            _json(items),
            org,
            line,
            agent,
            created_by,
        ),
        fetch=True,
    )
    if not rows:
        raise ServiceError("快照固化失败", 500)
    return row_to_snapshot(rows[0])


def get_snapshot(snapshot_id: str) -> dict[str, Any] | None:
    """读取快照内容（items + 元信息）。

    注意：快照是实验的引用锚点，必须任何上下文都能解析，所以不过滤租户。
    """
    rows = query(
        """
        SELECT snapshot_id, source_task_id, dataset_id, items, frozen_at,
               org_id, product_line_id, agent_id, created_by, created_at
        FROM eval_snapshots
        WHERE snapshot_id = %s
        """,
        params=(snapshot_id,),
    )
    if not rows:
        return None
    return row_to_snapshot(rows[0])


def list_snapshots(*, limit: int = 50, offset: int = 0) -> list[dict[str, Any]]:
    """列出快照列表（按租户过滤，降序，不含 items 明细）。"""
    conditions, params = scope_conditions()
    where = " AND ".join(conditions)

    rows = query(
        f"""
        SELECT snapshot_id, source_task_id, dataset_id,
               jsonb_array_length(items) AS items_count,
               frozen_at, org_id, product_line_id, agent_id, created_by, created_at
        FROM eval_snapshots
        WHERE {where}
        ORDER BY created_at DESC
        LIMIT %s OFFSET %s
        """,
        params=(*params, limit, offset),
    )
    return [row_to_snapshot(r, with_items=False) for r in rows]
