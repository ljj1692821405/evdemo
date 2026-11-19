# -*- coding: utf-8 -*-
"""结果后处理：按 output_schema 从仿真轨迹里提取结构化字段。

output_schema 约定（宽松，缺省也能跑）：
  {
    "fields": [
      {"name": "final_reply", "source": "final_reply"},
      {"name": "turn_count",  "source": "turns_count"},
      {"name": "first_reply", "source": "turns.0.reply"}
    ]
  }

source 取值规则（按优先级）：
  - "final_reply"            -> 轨迹最终回复
  - "turns_count"            -> 轮数
  - "session_id"             -> 会话 id
  - "total_latency_ms"       -> 总耗时
  - "turns.{i}.{key}"        -> 第 i 轮（0 基）的某字段，如 turns.0.reply
  - 其它                      -> 直接按 key 从轨迹顶层取，取不到记为 None

没有 output_schema 或 fields 为空时，返回一份默认摘要，保证结果页永远有东西可看。
"""
from __future__ import annotations

from typing import Any


def _get_by_source(trajectory: dict[str, Any], source: str) -> Any:
    """按 source 规则从轨迹取值，取不到返回 None。"""
    if source == "final_reply":
        return trajectory.get("final_reply")
    if source == "turns_count":
        return len(trajectory.get("turns") or [])
    if source in ("session_id", "total_latency_ms"):
        return trajectory.get(source)

    if source.startswith("turns."):
        parts = source.split(".")
        turns = trajectory.get("turns") or []
        if len(parts) >= 2 and parts[1].isdigit():
            idx = int(parts[1])
            if 0 <= idx < len(turns):
                turn = turns[idx]
                if len(parts) >= 3:
                    return turn.get(parts[2])
                return turn
        return None

    return trajectory.get(source)


def _default_summary(trajectory: dict[str, Any]) -> dict[str, Any]:
    """没有 output_schema 时的兜底摘要。"""
    return {
        "final_reply": trajectory.get("final_reply", ""),
        "turn_count": len(trajectory.get("turns") or []),
        "total_latency_ms": trajectory.get("total_latency_ms", 0),
    }


def post_process(
    trajectory: dict[str, Any],
    output_schema: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """把仿真轨迹按 output_schema 提取成结构化结果。

    schema 缺省 / 字段为空时退回默认摘要，绝不抛错——后处理失败不该拖垮整条任务。
    """
    output_schema = output_schema or {}
    fields = output_schema.get("fields")

    if not isinstance(fields, list) or not fields:
        return _default_summary(trajectory)

    processed: dict[str, Any] = {}
    for field in fields:
        if not isinstance(field, dict):
            continue
        name = field.get("name")
        source = field.get("source") or name
        if not name:
            continue
        processed[name] = _get_by_source(trajectory, str(source))

    # 一个字段都没提到，仍给默认摘要，避免结果页空白
    return processed or _default_summary(trajectory)
