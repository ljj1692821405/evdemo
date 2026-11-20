# -*- coding: utf-8 -*-
"""能力版本快照服务（append-only）。

与评分器版本的区别：
- 能力 = 纯引擎（executionType + outputSchema），版本号是语义化字符串（v3.0.0）
- 能力**不强制**试跑门禁：引擎配置好即可发布，trial_passed 仅作记录
- 能力草稿同样不落库；发布后的版本被评分器的 capabilityRef 引用

引用方向：评分器 → 能力版本。因此能力版本一旦发布也必须不可变，
否则历史评分器引用的引擎会被悄悄改掉。
"""
from __future__ import annotations

import json
from typing import Any

from ..pg_service import execute, query
from ...responses import ServiceError
from ...tenant import resolve_agent, resolve_org, resolve_product_line


def _json(value: Any) -> str:
    if isinstance(value, str):
        return value or "{}"
    return json.dumps(value if value is not None else {}, ensure_ascii=False)


def _load(value: Any) -> Any:
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return value
    return value


def row_to_version(row: dict[str, Any], *, with_config: bool = True) -> dict[str, Any]:
    """数据库行 → 前端友好的 camelCase 结构。"""
    out: dict[str, Any] = {
        "id": row.get("id"),
        "capabilityId": row.get("capability_id"),
        "version": row.get("version"),
        "name": row.get("name") or "",
        "executionType": row.get("execution_type") or "",
        "createdBy": row.get("created_by") or "",
        "createdAt": str(row.get("created_at") or ""),
    }
    if with_config:
        out["config"] = _load(row.get("config"))
    return out


# ========== 发布 ==========

def publish_version(
    capability_id: str,
    config: dict[str, Any],
    *,
    version: str = "",
    name: str = "",
    execution_type: str = "",
    trial_passed: bool = False,
    created_by: str = "system",
    org_id: str | None = None,
    product_line_id: str | None = None,
    agent_id: str | None = None,
) -> dict[str, Any]:
    """把能力配置固化成不可变版本。

    version 留空时自动推导下一个 vN.0.0（按已存在的最大主版本号 + 1）。
    """
    if not capability_id:
        raise ServiceError("capability_id 不能为空", 400)
    if not isinstance(config, dict) or not config:
        raise ServiceError("config 不能为空：发布必须携带完整的能力配置快照", 400)

    target = (version or "").strip() or next_version(capability_id)

    sql = """
        INSERT INTO eval_capability_versions (
            capability_id, version, org_id, product_line_id, agent_id,
            name, execution_type, config, created_by
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (capability_id, version) DO NOTHING
        RETURNING id, capability_id, version, name, execution_type, config, created_by, created_at
    """
    params = (
        capability_id,
        target,
        resolve_org(org_id),
        resolve_product_line(product_line_id),
        resolve_agent(agent_id),
        name or str(config.get("name") or ""),
        execution_type or str(config.get("executionType") or ""),
        _json({**config, "trialPassed": bool(trial_passed)}),
        created_by,
    )

    try:
        rows = execute(sql, params=params, fetch=True, limit=1)
    except ServiceError as exc:
        raise ServiceError(f"写入能力版本失败：{exc.message}", 500) from exc

    if not rows:
        raise ServiceError(
            f"能力 {capability_id} 的版本 {target} 已存在，版本记录不可覆盖",
            409,
            code="VERSION_IMMUTABLE",
        )
    return row_to_version(rows[0])


def next_version(capability_id: str) -> str:
    """推导下一个版本号：取已存在版本里最大的主版本号 + 1，形如 v4.0.0。"""
    rows = query(
        "SELECT version FROM eval_capability_versions WHERE capability_id = %s",
        params=(capability_id,),
        limit=200,
    )
    major = 0
    for row in rows:
        raw = str(row.get("version") or "")
        digits = raw.lstrip("vV").split(".")[0]
        if digits.isdigit():
            major = max(major, int(digits))
    return f"v{major + 1}.0.0"


# ========== 查询 ==========

def list_versions(capability_id: str, limit: int = 50) -> list[dict[str, Any]]:
    """列出某能力的历史版本（created_at 倒序）。"""
    sql = """
        SELECT id, capability_id, version, name, execution_type, created_by, created_at
        FROM eval_capability_versions
        WHERE capability_id = %s
        ORDER BY created_at DESC, id DESC
        LIMIT %s
    """
    try:
        rows = query(sql, params=(capability_id, limit), limit=limit)
    except ServiceError as exc:
        raise ServiceError(f"查询能力版本失败：{exc.message}", 500) from exc
    return [row_to_version(r, with_config=False) for r in rows]


def get_version(capability_id: str, version: str) -> dict[str, Any] | None:
    """取指定版本的完整快照（评分器绑定、运行时解析都走这里）。"""
    sql = """
        SELECT id, capability_id, version, org_id, product_line_id, agent_id,
               name, execution_type, config, created_by, created_at
        FROM eval_capability_versions
        WHERE capability_id = %s AND version = %s
        LIMIT 1
    """
    try:
        rows = query(sql, params=(capability_id, str(version)), limit=1)
    except ServiceError as exc:
        raise ServiceError(f"查询能力版本详情失败：{exc.message}", 500) from exc
    return row_to_version(rows[0]) if rows else None


def latest_version(capability_id: str) -> dict[str, Any] | None:
    """最新发布版本（评分器「绑定能力」选择器默认值）。"""
    sql = """
        SELECT id, capability_id, version, org_id, product_line_id, agent_id,
               name, execution_type, config, created_by, created_at
        FROM eval_capability_versions
        WHERE capability_id = %s
        ORDER BY created_at DESC, id DESC
        LIMIT 1
    """
    try:
        rows = query(sql, params=(capability_id,), limit=1)
    except ServiceError as exc:
        raise ServiceError(f"查询最新能力版本失败：{exc.message}", 500) from exc
    return row_to_version(rows[0]) if rows else None


# ========== 差异对比 ==========

_ENGINE_FIELDS: list[tuple[str, str]] = [
    ("name", "能力名称"),
    ("executionType", "执行类型"),
    ("entrypoint", "入口"),
    ("httpConfig", "HTTP 配置"),
    ("scriptId", "脚本 ID"),
    ("scriptHash", "脚本指纹"),
    ("outputSchema", "输出结构"),
    ("model", "默认模型"),
    ("scenario", "适用场景"),
]


def diff_versions(capability_id: str, from_version: str, to_version: str) -> dict[str, Any]:
    """对比两个能力版本，重点关注「入参形状 / 输出契约 / 执行入口」是否变了。"""
    base = get_version(capability_id, from_version)
    if not base:
        raise ServiceError(f"能力 {capability_id} 的版本 {from_version} 不存在", 404)
    target = get_version(capability_id, to_version)
    if not target:
        raise ServiceError(f"能力 {capability_id} 的版本 {to_version} 不存在", 404)

    a = base.get("config") or {}
    b = target.get("config") or {}
    if not isinstance(a, dict):
        a = {}
    if not isinstance(b, dict):
        b = {}

    changes: list[dict[str, Any]] = []
    for key, label in _ENGINE_FIELDS:
        before = a.get(key)
        after = b.get(key)
        if before != after:
            changes.append({
                "field": key,
                "label": label,
                "kind": "changed",
                "before": before,
                "after": after,
            })

    return {
        "capabilityId": capability_id,
        "from": from_version,
        "to": to_version,
        "identical": not changes,
        "changes": changes,
        "breaking": any(c["field"] in {"executionType", "entrypoint", "outputSchema"} for c in changes),
    }


# ========== 回溯（不写库） ==========

def restore_payload(capability_id: str, version: str) -> dict[str, Any]:
    """取回历史版本内容，供前端作为新草稿打开。不写库。"""
    source = get_version(capability_id, version)
    if not source:
        raise ServiceError(f"能力 {capability_id} 的版本 {version} 不存在", 404)
    return {
        "capabilityId": capability_id,
        "source": {
            "version": source.get("version"),
            "name": source.get("name"),
            "executionType": source.get("executionType"),
            "createdAt": source.get("createdAt"),
            "createdBy": source.get("createdBy"),
        },
        "config": source.get("config"),
        "nextVersion": next_version(capability_id),
        "hint": "已取回该版本内容，请在前端作为新草稿打开；原版本不会被修改。",
    }

