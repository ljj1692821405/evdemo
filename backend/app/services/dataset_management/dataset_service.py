# -*- coding: utf-8 -*-
"""数据集 / Case 服务层。"""
from __future__ import annotations

import json
from typing import Any

from ..pg_service import execute, query
from ...responses import ServiceError
from ...tenant import resolve_agent, resolve_org, resolve_product_line, scope_conditions


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


def _row_to_dataset(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "name": row["name"],
        "version": row.get("version") or "v1",
        "caseCount": row.get("case_count") or 0,
        "tags": row.get("tags") or [],
        "defaultGt": bool(row.get("default_gt")),
        "updatedAt": str(row.get("updated_at") or "")[:10],
    }


def _row_to_case(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "datasetId": row["dataset_id"],
        "query": row.get("query") or [],
        "tags": row.get("tags") or [],
        "workspaceSize": row.get("workspace_size") or "—",
        "gtSource": row.get("gt_source") or "missing",
        "gtKeys": row.get("gt_keys") or [],
        "valid": bool(row.get("valid")),
        "invalidReason": row.get("invalid_reason") or None,
        "raw": row.get("raw") or {},
    }


# ========== 数据集 ==========

def list_datasets(
    agent_id: str | None = None,
    org_id: str | None = None,
    product_line_id: str | None = None,
) -> list[dict[str, Any]]:
    conditions, params = scope_conditions(
        org_id=org_id,
        product_line_id=product_line_id,
        agent_id=agent_id,
        prefix="d",
        alias_prefix=True,
    )
    conditions.insert(0, "d.status = 'active'")

    sql = f"""
        SELECT d.id, d.name, d.version, d.tags, d.default_gt, d.updated_at,
               (SELECT count(*) FROM eval_cases c WHERE c.dataset_id = d.id) AS case_count
        FROM eval_datasets d
        WHERE {' AND '.join(conditions)}
        ORDER BY d.created_at DESC
    """
    return [_row_to_dataset(r) for r in query(sql, params=tuple(params), limit=500)]


def create_dataset(
    dataset_id: str,
    name: str,
    agent_id: str,
    version: str = "v1",
    tags: list[str] | None = None,
    default_gt: bool = False,
    org_id: str | None = None,
    product_line_id: str | None = None,
) -> dict[str, Any]:
    agent_id = resolve_agent(agent_id)
    org_id = resolve_org(org_id)
    product_line_id = resolve_product_line(product_line_id)

    sql = """
        INSERT INTO eval_datasets (id, name, agent_id, org_id, product_line_id, version, tags, default_gt)
        VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb, %s)
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, tags = EXCLUDED.tags
        RETURNING id
    """
    execute(
        sql,
        params=(dataset_id, name, agent_id, org_id, product_line_id, version, _json(tags or []), default_gt),
        fetch=True,
    )

    rows = query(
        "SELECT id, name, version, tags, default_gt, updated_at FROM eval_datasets WHERE id = %s AND org_id = %s",
        params=(dataset_id, org_id),
        limit=1,
    )
    if not rows:
        raise ServiceError("数据集创建后无法读回", 500)
    data = _row_to_dataset(rows[0])
    data["caseCount"] = 0
    return data


def delete_dataset(dataset_id: str) -> bool:
    conditions, params = scope_conditions()
    where = " AND ".join(conditions)

    execute(f"DELETE FROM eval_cases WHERE dataset_id = %s AND {where}", params=(dataset_id, *params))
    affected = execute(
        f"UPDATE eval_datasets SET status = 'deleted', updated_at = CURRENT_TIMESTAMP "
        f"WHERE id = %s AND {where}",
        params=(dataset_id, *params),
    )
    return bool(affected)


# ========== Case ==========

def list_cases(
    dataset_id: str | None = None,
    agent_id: str | None = None,
    org_id: str | None = None,
    product_line_id: str | None = None,
) -> list[dict[str, Any]]:
    conditions, params = scope_conditions(
        org_id=org_id,
        product_line_id=product_line_id,
        agent_id=agent_id,
    )
    if dataset_id:
        conditions.append("dataset_id = %s")
        params.append(dataset_id)

    sql = f"""
        SELECT id, dataset_id, query, tags, workspace_size, gt_source,
               gt_keys, valid, invalid_reason, raw
        FROM eval_cases
        WHERE {' AND '.join(conditions)}
        ORDER BY created_at ASC
    """
    return [_row_to_case(r) for r in query(sql, params=tuple(params), limit=5000)]


def add_cases(dataset_id: str, agent_id: str, cases: list[dict[str, Any]]) -> int:
    if not cases:
        return 0

    agent_id = resolve_agent(agent_id)
    org_id = resolve_org(None)
    product_line_id = resolve_product_line(None)

    sql = """
        INSERT INTO eval_cases (
            id, dataset_id, agent_id, org_id, product_line_id, query, tags, workspace_size,
            gt_source, gt_keys, valid, invalid_reason, raw
        ) VALUES (%s, %s, %s, %s, %s, %s::jsonb, %s::jsonb, %s, %s, %s::jsonb, %s, %s, %s::jsonb)
        ON CONFLICT (id) DO NOTHING
    """
    count = 0
    for c in cases:
        count += int(execute(sql, params=(
            c["id"],
            dataset_id,
            agent_id,
            org_id,
            product_line_id,
            _json(c.get("query") or []),
            _json(c.get("tags") or []),
            c.get("workspaceSize") or "—",
            c.get("gtSource") or "missing",
            _json(c.get("gtKeys") or []),
            bool(c.get("valid", True)),
            c.get("invalidReason"),
            _json(c.get("raw") or {}),
        )) or 0)
    execute(
        "UPDATE eval_datasets SET updated_at = CURRENT_TIMESTAMP WHERE id = %s AND org_id = %s",
        params=(dataset_id, org_id),
    )
    return count


def delete_case(case_id: str) -> bool:
    conditions, params = scope_conditions()
    return bool(execute(
        f"DELETE FROM eval_cases WHERE id = %s AND {' AND '.join(conditions)}",
        params=(case_id, *params),
    ))
