# -*- coding: utf-8 -*-
"""评分器版本快照服务（append-only）。

设计约束（前后端分离的关键）：
- 评分器「草稿」不落库，只活在前端内存；本服务只负责**已发布版本**的固化与读取。
- 版本记录只追加：同一 (scorer_id, version) 不允许二次写入。
- 实验通过 (scorer_id, version) 引用版本，因此快照必须完整且不可变。

关于租户：版本表记录了 org_id / product_line_id / agent_id 便于审计，
但查询**不按租户过滤**——版本是实验的引用锚点，必须能被任何上下文解析到，
否则实验换个人看就解释不了自己的结果。
"""
from __future__ import annotations

import json
from typing import Any

from ..pg_service import execute, query
from ...responses import ServiceError
from ...tenant import resolve_agent, resolve_org, resolve_product_line


# ========== 通用工具 ==========

def _json(value: Any) -> str:
    """把 dict/list 序列化成 JSONB 文本；已是字符串则透传（避免二次编码）。"""
    if isinstance(value, str):
        return value or "{}"
    return json.dumps(value if value is not None else {}, ensure_ascii=False)


def _load(value: Any) -> Any:
    """把 JSONB 列还原成 Python 对象；解析失败时原样返回，避免脏数据炸接口。"""
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
        "scorerId": row.get("scorer_id"),
        "version": row.get("version"),
        "name": row.get("name") or "",
        "capabilityId": row.get("capability_id") or "",
        "capabilityVersion": row.get("capability_version") or "",
        "promptVersion": row.get("prompt_version") or "",
        "trialPassed": bool(row.get("trial_passed")),
        "note": row.get("note") or "",
        "createdBy": row.get("created_by") or "",
        "createdAt": str(row.get("created_at") or ""),
    }
    if with_config:
        out["config"] = _load(row.get("config"))
    return out


# ========== 版本号 ==========

def next_version(scorer_id: str) -> int:
    """该评分器的下一个版本号（当前最大 + 1）。"""
    rows = query(
        "SELECT COALESCE(MAX(version), 0) AS v FROM eval_scorer_versions WHERE scorer_id = %s",
        params=(scorer_id,),
        limit=1,
    )
    return int((rows[0] or {}).get("v") or 0) + 1


# ========== 发布（固化） ==========

def publish_version(
    scorer_id: str,
    config: dict[str, Any],
    *,
    version: int | None = None,
    name: str = "",
    capability_id: str = "",
    capability_version: str = "",
    prompt_version: str = "",
    trial_passed: bool = False,
    note: str = "",
    created_by: str = "system",
    org_id: str | None = None,
    product_line_id: str | None = None,
    agent_id: str | None = None,
) -> dict[str, Any]:
    """把一个已通过试跑的评分器配置固化成不可变版本。

    门禁：trial_passed 为 False 一律拒绝——前端禁用按钮只是体验，服务端才是底线。
    """
    if not scorer_id:
        raise ServiceError("scorer_id 不能为空", 400)
    if not isinstance(config, dict) or not config:
        raise ServiceError("config 不能为空：发布必须携带完整的评分器配置快照", 400)
    if not trial_passed:
        raise ServiceError("评分器未通过试跑，不允许发布", 400, code="TRIAL_REQUIRED")

    target = int(version) if version is not None else next_version(scorer_id)

    # capabilityRef 允许写在 config 里，兼容两种写法
    ref = config.get("capabilityRef")
    if isinstance(ref, dict):
        capability_id = capability_id or str(ref.get("id") or "")
        capability_version = capability_version or str(ref.get("version") or "")
    if not capability_id:
        capability_id = str(config.get("referenceCapabilityId") or "")

    sql = """
        INSERT INTO eval_scorer_versions (
            scorer_id, version, org_id, product_line_id, agent_id,
            name, capability_id, capability_version, prompt_version,
            config, trial_passed, note, created_by
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (scorer_id, version) DO NOTHING
        RETURNING id, scorer_id, version, name, capability_id, capability_version,
                  prompt_version, config, trial_passed, note, created_by, created_at
    """
    params = (
        scorer_id,
        target,
        resolve_org(org_id),
        resolve_product_line(product_line_id),
        resolve_agent(agent_id),
        name or str(config.get("name") or ""),
        capability_id,
        capability_version,
        prompt_version,
        _json(config),
        bool(trial_passed),
        note or "",
        created_by,
    )

    try:
        rows = execute(sql, params=params, fetch=True, limit=1)
    except ServiceError as exc:
        raise ServiceError(f"写入评分器版本失败：{exc.message}", 500) from exc

    if not rows:
        # ON CONFLICT DO NOTHING 命中：版本已存在，拒绝覆盖（append-only）
        raise ServiceError(
            f"评分器 {scorer_id} 的版本 {target} 已存在，版本记录不可覆盖",
            409,
            code="VERSION_IMMUTABLE",
        )

    return row_to_version(rows[0])


# ========== 查询 ==========

def list_versions(scorer_id: str, limit: int = 50) -> list[dict[str, Any]]:
    """列出某评分器的历史版本（新的在前），不含 config 大字段。"""
    sql = """
        SELECT id, scorer_id, version, name, capability_id, capability_version,
               prompt_version, trial_passed, note, created_by, created_at
        FROM eval_scorer_versions
        WHERE scorer_id = %s
        ORDER BY version DESC
        LIMIT %s
    """
    try:
        rows = query(sql, params=(scorer_id, limit), limit=limit)
    except ServiceError as exc:
        raise ServiceError(f"查询评分器版本失败：{exc.message}", 500) from exc
    return [row_to_version(r, with_config=False) for r in rows]


def get_version(scorer_id: str, version: int) -> dict[str, Any] | None:
    """取某个版本的完整快照；实验运行、回溯查看都走这里，**不读当前草稿**。"""
    sql = """
        SELECT id, scorer_id, version, org_id, product_line_id, agent_id,
               name, capability_id, capability_version, prompt_version,
               config, trial_passed, note, created_by, created_at
        FROM eval_scorer_versions
        WHERE scorer_id = %s AND version = %s
        LIMIT 1
    """
    try:
        rows = query(sql, params=(scorer_id, int(version)), limit=1)
    except ServiceError as exc:
        raise ServiceError(f"查询评分器版本详情失败：{exc.message}", 500) from exc
    return row_to_version(rows[0]) if rows else None


def latest_version(scorer_id: str) -> dict[str, Any] | None:
    """最新已发布版本，供「升版」派生草稿时复制。"""
    sql = """
        SELECT id, scorer_id, version, org_id, product_line_id, agent_id,
               name, capability_id, capability_version, prompt_version,
               config, trial_passed, note, created_by, created_at
        FROM eval_scorer_versions
        WHERE scorer_id = %s
        ORDER BY version DESC
        LIMIT 1
    """
    try:
        rows = query(sql, params=(scorer_id,), limit=1)
    except ServiceError as exc:
        raise ServiceError(f"查询最新评分器版本失败：{exc.message}", 500) from exc
    return row_to_version(rows[0]) if rows else None


# ========== 差异对比 ==========

_SCALAR_FIELDS: list[tuple[str, str]] = [
    ("name", "名称"),
    ("capabilityRef", "绑定引擎"),
    ("promptTemplate", "评分准绳"),
    ("background", "背景说明"),
    ("judgeModel", "裁判模型"),
    ("implType", "执行类型"),
    ("scriptId", "脚本 ID"),
    ("scriptHash", "脚本指纹"),
    ("evidenceScript", "证据脚本"),
    ("outputs", "输出维度"),
    ("promptVersion", "提示词版本"),
]


def _normalise_capability(config: dict[str, Any]) -> dict[str, str] | None:
    """把两种能力引用写法统一成 {id, version}。"""
    ref = config.get("capabilityRef")
    if isinstance(ref, dict) and ref.get("id"):
        return {"id": str(ref.get("id")), "version": str(ref.get("version") or "")}
    legacy = config.get("referenceCapabilityId")
    if legacy:
        return {"id": str(legacy), "version": ""}
    return None


def _inputs_map(config: dict[str, Any]) -> dict[str, dict[str, str]]:
    """把 inputs 归一到「按名字索引」，便于识别新增 / 删除 / 改名 / 改含义。"""
    raw = config.get("inputs")
    if isinstance(raw, list) and raw:
        out: dict[str, dict[str, str]] = {}
        for item in raw:
            if not isinstance(item, dict):
                continue
            name = str(item.get("name") or "")
            if not name:
                continue
            out[name] = {
                "field": str(item.get("field") or ""),
                "modality": str(item.get("modality") or "text"),
            }
        return out
    # 兼容旧结构：inputFields 里名字即字段名
    fields = config.get("inputFields") or []
    if isinstance(fields, list):
        return {str(f): {"field": str(f), "modality": "text"} for f in fields}
    return {}


def diff_versions(scorer_id: str, from_version: int, to_version: int) -> dict[str, Any]:
    """对比两个已发布版本，输出结构化差异（只读，不改任何数据）。"""
    base = get_version(scorer_id, from_version)
    if not base:
        raise ServiceError(f"评分器 {scorer_id} 的版本 {from_version} 不存在", 404)
    target = get_version(scorer_id, to_version)
    if not target:
        raise ServiceError(f"评分器 {scorer_id} 的版本 {to_version} 不存在", 404)

    a = base.get("config") or {}
    b = target.get("config") or {}
    if not isinstance(a, dict):
        a = {}
    if not isinstance(b, dict):
        b = {}

    changes: list[dict[str, Any]] = []

    for key, label in _SCALAR_FIELDS:
        if key == "capabilityRef":
            before = _normalise_capability(a)
            after = _normalise_capability(b)
        else:
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

    # 入参：按名字对齐（PM 调整顺序不算变更）
    in_a = _inputs_map(a)
    in_b = _inputs_map(b)
    added = [n for n in in_b if n not in in_a]
    removed = [n for n in in_a if n not in in_b]
    changed_inputs: list[dict[str, Any]] = []
    for name in in_a.keys() & in_b.keys():
        if in_a[name] != in_b[name]:
            changed_inputs.append({"name": name, "before": in_a[name], "after": in_b[name]})

    inputs_diff = {
        "added": [{"name": n, **in_b[n]} for n in added],
        "removed": [{"name": n, **in_a[n]} for n in removed],
        "changed": changed_inputs,
    }
    if added or removed or changed_inputs:
        changes.append({
            "field": "inputs",
            "label": "入参",
            "kind": "changed",
            "before": in_a,
            "after": in_b,
        })

    return {
        "scorerId": scorer_id,
        "from": int(from_version),
        "to": int(to_version),
        "identical": not changes,
        "changes": changes,
        "inputs": inputs_diff,
        "fromMeta": {
            "trialPassed": base.get("trialPassed"),
            "createdAt": base.get("createdAt"),
            "createdBy": base.get("createdBy"),
        },
        "toMeta": {
            "trialPassed": target.get("trialPassed"),
            "createdAt": target.get("createdAt"),
            "createdBy": target.get("createdBy"),
        },
    }


# ========== 回溯（不写库） ==========

def restore_payload(scorer_id: str, version: int) -> dict[str, Any]:
    """读取历史版本，返回给前端用于「派生新草稿」。

    刻意不写库：草稿属于临时态，由前端创建；后端只提供不可变的事实来源。
    """
    source = get_version(scorer_id, version)
    if not source:
        raise ServiceError(f"评分器 {scorer_id} 的版本 {version} 不存在", 404)
    return {
        "scorerId": scorer_id,
        "source": {
            "version": source.get("version"),
            "name": source.get("name"),
            "trialPassed": source.get("trialPassed"),
            "createdAt": source.get("createdAt"),
            "createdBy": source.get("createdBy"),
        },
        "config": source.get("config"),
        "draftVersion": next_version(scorer_id),
        "hint": "已取回历史版本内容，请在前端作为新草稿打开；原版本不会被修改。",
    }


# ========== 供实验使用的版本解析 ==========

def resolve_refs(scorer_refs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """按 (id, version) 批量取版本快照，供实验创建与运行使用。

    引用缺失时抛 400，避免实验拿着不存在的版本静默跑出无法解释的结果。
    """
    resolved: list[dict[str, Any]] = []
    missing: list[str] = []
    for ref in scorer_refs or []:
        if not isinstance(ref, dict):
            continue
        sid = str(ref.get("id") or "")
        ver = ref.get("version")
        if not sid or ver is None:
            missing.append(f"{sid or '?'}@{ver if ver is not None else '?'}")
            continue
        try:
            ver_int = int(ver)
        except (TypeError, ValueError):
            missing.append(f"{sid}@{ver}")
            continue
        snap = get_version(sid, ver_int)
        if not snap:
            missing.append(f"{sid}@{ver_int}")
            continue
        resolved.append({
            "scorerId": sid,
            "version": ver_int,
            "name": snap.get("name"),
            "capability": {
                "id": snap.get("capabilityId"),
                "version": snap.get("capabilityVersion"),
            },
            "config": snap.get("config"),
        })
    if missing:
        raise ServiceError(
            "以下评分器版本不存在，实验无法创建：" + "、".join(missing),
            400,
            code="SCORER_VERSION_MISSING",
            missing=missing,
        )
    return resolved



