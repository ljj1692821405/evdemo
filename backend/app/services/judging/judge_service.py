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


async def judge_one(
    case_input: dict[str, Any],
    processed_output: dict[str, Any],
    cfg: dict[str, Any],
) -> dict[str, Any]:
    """对单条结果打分，返回统一结构（camelCase）。"""
    messages = _build_messages(case_input, processed_output, cfg)
    result = await call_json(
        messages,
        model=cfg.get("model") or None,
        temperature=0.0,
        response_schema=JudgeScore,
    )
    parsed = result["parsed"]
    return {
        "score": int(parsed.get("score", 0)),
        "pass": bool(parsed.get("pass", parsed.get("pass_", False))),
        "evidenceAnalysis": parsed.get("evidence_analysis") or "",
        "reason": parsed.get("reason") or "",
        "model": result.get("model"),
        "latencyMs": int(result.get("latency_ms") or 0),
        "usage": result.get("usage"),
    }


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
