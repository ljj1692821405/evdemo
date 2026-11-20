# -*- coding: utf-8 -*-
"""实验服务：唯一持久化的评测对象。

与版本表的区别：
- 版本表存「已发布配置」，append-only
- 实验表存「一次评测的意图与结果」：引用 scorerRefs（带版本）+ snapshotId + fieldDictVersion

实验创建时就把引用写死成 (id, version)，之后评分器升版不会改变历史实验的含义。
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


def _json_obj(value: Any) -> str:
    if isinstance(value, str):
        return value or "{}"
    return json.dumps(value if value is not None else {}, ensure_ascii=False)


def _load(value: Any, default: Any) -> Any:
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return default
    return value if value is not None else default


def row_to_experiment(row: dict[str, Any]) -> dict[str, Any]:
    """数据库行 → 前端结构。scorerRefs 保持 {id, version} 原样。"""
    return {
        "experimentId": row.get("experiment_id"),
        "name": row.get("name") or "",
        "description": row.get("description") or "",
        "snapshotId": row.get("snapshot_id") or "",
        "fieldDictVersion": row.get("field_dict_version") or "",
        "scorerRefs": _load(row.get("scorer_refs"), []),
        "weights": _load(row.get("weights"), {}),
        "status": row.get("status") or "draft",
        "orgId": row.get("org_id") or "",
        "productLineId": row.get("product_line_id") or "",
        "agentId": row.get("agent_id") or "",
        "createdBy": row.get("created_by") or "",
        "createdAt": str(row.get("created_at") or ""),
        "updatedAt": str(row.get("updated_at") or ""),
    }


def row_to_run(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "runId": row.get("run_id"),
        "experimentId": row.get("experiment_id"),
        "status": row.get("status") or "queued",
        "units": int(row.get("units") or 0),
        "doneUnits": int(row.get("done_units") or 0),
        "errors": int(row.get("errors") or 0),
        "cost": row.get("cost") or "",
        "summary": _load(row.get("summary"), {}),
        "detail": _load(row.get("detail"), []),
        "startedAt": str(row.get("started_at") or ""),
        "finishedAt": str(row.get("finished_at") or ""),
    }


_EXP_FIELDS = """
    experiment_id, name, description, snapshot_id, field_dict_version,
    scorer_refs, weights, status, org_id, product_line_id, agent_id,
    created_by, created_at, updated_at
"""

_RUN_FIELDS = """
    run_id, experiment_id, status, units, done_units, errors, cost,
    summary, detail, started_at, finished_at
"""


# ========== 实验 CRUD ==========

def create_experiment(
    name: str,
    scorer_refs: list[dict[str, Any]],
    *,
    experiment_id: str = "",
    description: str = "",
    snapshot_id: str = "",
    field_dict_version: str = "",
    weights: dict[str, Any] | None = None,
    created_by: str = "system",
    org_id: str | None = None,
    product_line_id: str | None = None,
    agent_id: str | None = None,
) -> dict[str, Any]:
    """创建实验。scorerRefs 的完整性由调用方（router）先校验。"""
    if not name.strip():
        raise ServiceError("实验名称不能为空", 400)
    if not scorer_refs:
        raise ServiceError("实验至少要引用一个评分器版本", 400)
    if not snapshot_id:
        raise ServiceError("实验必须绑定仿真数据快照 snapshot_id，否则结果无法复现", 400)

    exp_id = (experiment_id or "").strip() or f"exp_{uuid.uuid4().hex[:12]}"

    sql = f"""
        INSERT INTO eval_experiments (
            experiment_id, name, description, snapshot_id, field_dict_version,
            scorer_refs, weights, status, org_id, product_line_id, agent_id, created_by
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, 'draft', %s, %s, %s, %s)
        ON CONFLICT (experiment_id) DO NOTHING
        RETURNING {_EXP_FIELDS}
    """
    params = (
        exp_id,
        name.strip(),
        description or "",
        snapshot_id,
        field_dict_version or "",
        _json(scorer_refs),
        _json_obj(weights or {}),
        resolve_org(org_id),
        resolve_product_line(product_line_id),
        resolve_agent(agent_id),
        created_by,
    )

    try:
        rows = execute(sql, params=params, fetch=True, limit=1)
    except ServiceError as exc:
        raise ServiceError(f"创建实验失败：{exc.message}", 500) from exc
    if not rows:
        raise ServiceError(f"实验 ID '{exp_id}' 已存在", 409, code="EXPERIMENT_EXISTS")
    return row_to_experiment(rows[0])


def get_experiment(experiment_id: str) -> dict[str, Any] | None:
    conditions, params = scope_conditions()
    sql = f"""
        SELECT {_EXP_FIELDS}
        FROM eval_experiments
        WHERE experiment_id = %s AND {' AND '.join(conditions)}
    """
    try:
        rows = query(sql, params=(experiment_id, *params), limit=1)
    except ServiceError as exc:
        raise ServiceError(f"查询实验失败：{exc.message}", 500) from exc
    return row_to_experiment(rows[0]) if rows else None


def list_experiments(limit: int = 50, offset: int = 0) -> list[dict[str, Any]]:
    conditions, params = scope_conditions()
    sql = f"""
        SELECT {_EXP_FIELDS}
        FROM eval_experiments
        WHERE {' AND '.join(conditions)}
        ORDER BY created_at DESC
        LIMIT %s OFFSET %s
    """
    try:
        rows = query(sql, params=(*params, limit, offset), limit=limit)
    except ServiceError as exc:
        raise ServiceError(f"查询实验列表失败：{exc.message}", 500) from exc
    return [row_to_experiment(r) for r in rows]


def delete_experiment(experiment_id: str) -> bool:
    """删除实验（其 runs 由外键 CASCADE 一并清理）。"""
    conditions, params = scope_conditions()
    sql = f"DELETE FROM eval_experiments WHERE experiment_id = %s AND {' AND '.join(conditions)}"
    try:
        return bool(execute(sql, params=(experiment_id, *params)))
    except ServiceError as exc:
        raise ServiceError(f"删除实验失败：{exc.message}", 500) from exc


# ========== 实验运行（结果落库） ==========

def create_run(
    experiment_id: str,
    *,
    units: int = 0,
    status: str = "queued",
    summary: dict[str, Any] | None = None,
    detail: list[Any] | None = None,
) -> dict[str, Any]:
    """为实验登记一次运行。实验首次运行后状态从 draft 变为 running，引用从此冻结。"""
    exp = get_experiment(experiment_id)
    if not exp:
        raise ServiceError(f"实验 '{experiment_id}' 不存在", 404)

    run_id = f"run_{uuid.uuid4().hex[:12]}"
    sql = f"""
        INSERT INTO eval_experiment_runs (
            run_id, experiment_id, status, units, done_units, errors, summary, detail
        ) VALUES (%s, %s, %s, %s, 0, 0, %s, %s)
        RETURNING {_RUN_FIELDS}
    """
    params = (
        run_id,
        experiment_id,
        status,
        int(units),
        _json_obj(summary or {}),
        _json(detail or []),
    )
    try:
        rows = execute(sql, params=params, fetch=True, limit=1)
    except ServiceError as exc:
        raise ServiceError(f"创建实验运行失败：{exc.message}", 500) from exc

    # 实验首次进入运行态：锁定引用
    if exp.get("status") == "draft":
        execute(
            "UPDATE eval_experiments SET status = 'running', updated_at = CURRENT_TIMESTAMP WHERE experiment_id = %s",
            params=(experiment_id,),
        )
    return row_to_run(rows[0])


def update_run(
    run_id: str,
    *,
    status: str | None = None,
    done_units: int | None = None,
    errors: int | None = None,
    cost: str | None = None,
    summary: dict[str, Any] | None = None,
    detail: list[Any] | None = None,
    finished: bool = False,
) -> dict[str, Any] | None:
    """更新运行进度/结果。finished=True 时写入 finished_at。"""
    sets: list[str] = []
    params: list[Any] = []
    if status is not None:
        sets.append("status = %s")
        params.append(status)
    if done_units is not None:
        sets.append("done_units = %s")
        params.append(int(done_units))
    if errors is not None:
        sets.append("errors = %s")
        params.append(int(errors))
    if cost is not None:
        sets.append("cost = %s")
        params.append(cost)
    if summary is not None:
        sets.append("summary = %s")
        params.append(_json_obj(summary))
    if detail is not None:
        sets.append("detail = %s")
        params.append(_json(detail))
    if finished:
        sets.append("finished_at = CURRENT_TIMESTAMP")
    if not sets:
        return get_run(run_id)

    sql = f"UPDATE eval_experiment_runs SET {', '.join(sets)} WHERE run_id = %s RETURNING {_RUN_FIELDS}"
    try:
        rows = execute(sql, params=(*params, run_id), fetch=True, limit=1)
    except ServiceError as exc:
        raise ServiceError(f"更新实验运行失败：{exc.message}", 500) from exc
    return row_to_run(rows[0]) if rows else None


def get_run(run_id: str) -> dict[str, Any] | None:
    sql = f"SELECT {_RUN_FIELDS} FROM eval_experiment_runs WHERE run_id = %s LIMIT 1"
    try:
        rows = query(sql, params=(run_id,), limit=1)
    except ServiceError as exc:
        raise ServiceError(f"查询实验运行失败：{exc.message}", 500) from exc
    return row_to_run(rows[0]) if rows else None


def list_runs(experiment_id: str, limit: int = 50) -> list[dict[str, Any]]:
    sql = f"""
        SELECT {_RUN_FIELDS}
        FROM eval_experiment_runs
        WHERE experiment_id = %s
        ORDER BY started_at DESC
        LIMIT %s
    """
    try:
        rows = query(sql, params=(experiment_id, limit), limit=limit)
    except ServiceError as exc:
        raise ServiceError(f"查询实验运行列表失败：{exc.message}", 500) from exc
    return [row_to_run(r) for r in rows]


