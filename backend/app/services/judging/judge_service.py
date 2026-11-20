# -*- coding: utf-8 -*-
"""LLM 评判（裁判）服务。

把一条评测结果交给 LLM，按流程配置的打分规则输出 0/1 与理由，落 judge_results 表。

judge_config 约定（宽松，缺省即关闭评判）：
  {
    "enabled": true,
    "model": "gpt-5.6-sol",          # 留空取 config.json 的 llm.model
    "rubric": "评分标准正文",          # 可写多条，建议用 1. 2. 3. 编号
    "gt_field": "gt",                 # input_data 中放参考答案的键，可空
    "reply_field": "final_reply",     # processed_output 中放待评回复的键
    "dimension": "answer_quality"     # 打分维度名，写入 judge_dim
  }

设计取舍：评判失败不能影响已成功的仿真结果，调用方用 try/except 包住。
"""
from __future__ import annotations

import json
import logging
from typing import Any

from ..llm_service import JudgeScore, call_json
from ..pg_service import execute, query
from ...responses import ServiceError

log = logging.getLogger(__name__)

DEFAULT_RUBRIC = (
    "你是严格的评测裁判。请判断【待评回复】是否满足【任务要求】。\n"
    "判定原则：\n"
    "1. 事实正确优先：出现与参考答案矛盾的关键事实，判 0。\n"
    "2. 允许表述差异：意思一致但措辞不同，判 1。\n"
    "3. 拒绝臆测：未被要求但未提及的内容，不作为扣分依据。\n"
    '只输出 JSON：{"score": 0或1, "pass": true或false, '
    '"evidence_analysis": "推导过程", "reason": "一句话结论"}'
)


def _build_messages(
    case_input: dict[str, Any],
    processed_output: dict[str, Any],
    cfg: dict[str, Any],
) -> list[dict[str, str]]:
    """拼裁判提示词。字段缺失时用占位说明，避免提示词结构残缺。"""
    rubric = (cfg.get("rubric") or DEFAULT_RUBRIC).strip()
    gt_field = cfg.get("gt_field") or "gt"
    reply_field = cfg.get("reply_field") or "final_reply"

    reference = case_input.get(gt_field)
    if reference in (None, "", [], {}):
        reference_text = "（本条 case 未提供参考答案，请仅依据任务要求判断）"
    else:
        reference_text = (
            reference if isinstance(reference, str) else json.dumps(reference, ensure_ascii=False)
        )

    reply = processed_output.get(reply_field)
    reply_text = reply if isinstance(reply, str) else json.dumps(reply, ensure_ascii=False)

    question = ""
    for key in ("user_query", "query", "question", "input"):
        value = case_input.get(key)
        if value:
            question = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
            break

    return [
        {"role": "system", "content": rubric},
        {
            "role": "user",
            "content": (
                f"【任务要求】\n{question or '（未提供，请按回复自身质量判断）'}\n\n"
                f"【参考答案】\n{reference_text}\n\n"
                f"【待评回复】\n{reply_text}\n\n"
                "请只输出 JSON 对象，结构为："
                '{"score": 0或1, "pass": true或false, '
                '"evidence_analysis": "推导过程", "reason": "一句话结论"}'
            ),
        },
    ]


def _coerce_text(value: Any) -> str:
    """把任意入参值规整成可读文本。"""
    if value in (None, "", [], {}):
        return ""
    return value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)


def build_messages_from_inputs(
    inputs: list[dict[str, Any]],
    rubric: str = "",
) -> list[dict[str, Any]]:
    """通用判决引擎的提示词组装：N 个命名入参（可多模态）+ 评分准绳 → messages。

    inputs 每项：{"name": 展示名, "modality": "text"|"image"|"video", "value": 值}
    - text  入参 → user content 里一段带小标题的文本块
    - image 入参 → user content 里一个 image_url 块（value 为 URL 或 data URL）
    - video 入参 → user content 里一个 video_url 块（同上）

    与旧的「固定三槽」相比，这里不预设入参个数与命名，
    意图识别(1 槽)、安全性(2 槽)、忠实度(5 槽)、图文/视频混合都走同一条路径。
    """
    rubric_text = (rubric or DEFAULT_RUBRIC).strip()

    # user content 组装成多模态数组（纯文本时压回字符串，含图/视频才用数组）
    parts: list[dict[str, Any]] = []
    has_media = False
    for item in inputs or []:
        name = str(item.get("name") or "入参")
        modality = (item.get("modality") or "text").lower()
        value = item.get("value")

        if modality in ("image", "video"):
            url = _coerce_text(value)
            if not url:
                continue
            parts.append({"type": "text", "text": f"【{name}】"})
            parts.append({"type": f"{modality}_url", f"{modality}_url": {"url": url}})
            has_media = True
        else:
            text = _coerce_text(value) or "（未提供）"
            parts.append({"type": "text", "text": f"【{name}】\n{text}"})

    parts.append(
        {
            "type": "text",
            "text": (
                "请只输出 JSON 对象，结构为："
                '{"score": 0或1, "pass": true或false, '
                '"evidence_analysis": "推导过程", "reason": "一句话结论"}'
            ),
        }
    )

    # 纯文本场景把数组压回字符串，保持与旧链路/旧日志一致；含图/视频才用多模态数组
    if has_media:
        user_content: Any = parts
    else:
        user_content = "\n\n".join(p["text"] for p in parts)

    return [
        {"role": "system", "content": rubric_text},
        {"role": "user", "content": user_content},
    ]


async def judge_inputs(
    inputs: list[dict[str, Any]],
    *,
    rubric: str = "",
    model: str | None = None,
    dimension: str = "answer_quality",
) -> dict[str, Any]:
    """通用判决引擎主干：N 个命名入参（可多模态）→ 真实裁判 LLM → 统一结构。

    这是「能力=纯引擎」契约在后端的落点：调用方（评分器/调试台）决定有哪些入参，
    引擎只负责组装、调模型、产出 score/pass/evidence。
    """
    messages = build_messages_from_inputs(inputs, rubric)
    result = await call_json(
        messages,
        model=model or None,
        temperature=0.0,
        response_schema=JudgeScore,
    )
    parsed = result["parsed"]
    return {
        "score": int(parsed.get("score", 0)),
        "pass": bool(parsed.get("pass", parsed.get("pass_", False))),
        "evidenceAnalysis": parsed.get("evidence_analysis") or "",
        "reason": parsed.get("reason") or "",
        "dimension": dimension,
        "model": result.get("model"),
        "latencyMs": int(result.get("latency_ms") or 0),
        "usage": result.get("usage"),
    }


async def judge_one(
    case_input: dict[str, Any],
    processed_output: dict[str, Any],
    cfg: dict[str, Any],
) -> dict[str, Any]:
    """对单条结果打分，返回统一结构（camelCase）。

    向后兼容适配器：把旧的「任务要求/参考答案/待评回复」三槽转成通用 inputs，
    再委托 judge_inputs。批量评判、落库链路沿用此函数，无需改动。
    """
    gt_field = cfg.get("gt_field") or "gt"
    reply_field = cfg.get("reply_field") or "final_reply"

    reference = case_input.get(gt_field)
    if reference in (None, "", [], {}):
        reference_text = "（本条 case 未提供参考答案，请仅依据任务要求判断）"
    else:
        reference_text = _coerce_text(reference)

    reply_text = _coerce_text(processed_output.get(reply_field))

    question = ""
    for key in ("user_query", "query", "question", "input"):
        value = case_input.get(key)
        if value:
            question = _coerce_text(value)
            break

    inputs = [
        {"name": "任务要求", "modality": "text", "value": question or "（未提供，请按回复自身质量判断）"},
        {"name": "参考答案", "modality": "text", "value": reference_text},
        {"name": "待评回复", "modality": "text", "value": reply_text},
    ]
    judgement = await judge_inputs(
        inputs,
        rubric=cfg.get("rubric") or "",
        model=cfg.get("model") or None,
        dimension=cfg.get("dimension") or "answer_quality",
    )
    # 旧调用方不消费 dimension 字段，这里保留其余键，行为与此前一致
    return judgement


def save_judgement(
    *,
    result_id: int,
    case_id: str,
    dimension: str,
    judgement: dict[str, Any],
) -> int:
    """把一次打分写入 judge_results，返回记录 id。

    run_id 存 result_id（便于反查），case_id 存业务侧 id（没有就留空）。
    """
    sql = """
        INSERT INTO judge_results (
            run_id, case_id, turn_no, judge_dim,
            score, pass, evidence, reason
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        RETURNING id
    """
    params = (
        str(result_id),
        case_id or "",
        0,
        dimension or "default",
        int(judgement.get("score") or 0),
        bool(judgement.get("pass")),
        judgement.get("evidenceAnalysis") or "",
        judgement.get("reason") or "",
    )
    rows = execute(sql, params=params, fetch=True)
    return int(rows[0]["id"]) if rows else 0


def row_to_judgement(row: dict[str, Any]) -> dict[str, Any]:
    """数据库行 → 前端 DTO（camelCase）。"""
    return {
        "id": row.get("id"),
        "resultId": row.get("run_id"),
        "caseId": row.get("case_id"),
        "dimension": row.get("judge_dim"),
        "score": row.get("score"),
        "pass": bool(row.get("pass")),
        "evidence": row.get("evidence") or "",
        "reason": row.get("reason") or "",
        "createdAt": str(row.get("created_at") or ""),
    }


def list_judgements(
    result_id: int | None = None, limit: int = 100, offset: int = 0
) -> list[dict[str, Any]]:
    """按结果 id 查打分记录；不传则返回最近记录。"""
    if result_id is not None:
        sql = """
            SELECT id, run_id, case_id, judge_dim, score, pass, evidence, reason, created_at
            FROM judge_results WHERE run_id = %s
            ORDER BY created_at DESC LIMIT %s OFFSET %s
        """
        params = (str(result_id), limit, offset)
    else:
        sql = """
            SELECT id, run_id, case_id, judge_dim, score, pass, evidence, reason, created_at
            FROM judge_results ORDER BY created_at DESC LIMIT %s OFFSET %s
        """
        params = (limit, offset)

    try:
        return query(sql, params=params, limit=limit)
    except Exception as exc:  # noqa: BLE001
        raise ServiceError(f"查询评判记录失败：{exc}", 500) from exc


def summarise(result_ids: list[int]) -> dict[str, Any]:
    """汇总一组结果的通过率，用于任务级报表。"""
    if not result_ids:
        return {"judged": 0, "passed": 0, "passRate": 0.0, "avgScore": 0.0}

    placeholders = ",".join(["%s"] * len(result_ids))
    sql = f"""
        SELECT COUNT(*) AS judged,
               COALESCE(SUM(CASE WHEN pass THEN 1 ELSE 0 END), 0) AS passed,
               COALESCE(AVG(score), 0) AS avg_score
        FROM judge_results WHERE run_id IN ({placeholders})
    """
    rows = query(sql, params=tuple(str(rid) for rid in result_ids), limit=1)
    row = rows[0] if rows else {}
    judged = int(row.get("judged") or 0)
    passed = int(row.get("passed") or 0)
    return {
        "judged": judged,
        "passed": passed,
        "passRate": round(passed / judged, 4) if judged else 0.0,
        "avgScore": round(float(row.get("avg_score") or 0), 4),
    }
