# -*- coding: utf-8 -*-
"""LLM 调用记录服务层：持久化存储所有调用到 PostgreSQL。"""
from __future__ import annotations

import hashlib
import time
import uuid
from typing import Any

from ..config import pg_settings
from ..responses import ServiceError

try:
    import psycopg
    from psycopg.rows import dict_row
except ImportError:
    psycopg = None
    dict_row = None


def _conninfo() -> str:
    cfg = pg_settings()
    if not cfg.host:
        raise ServiceError("未配置 PG host", 500)
    return (
        f"host={cfg.host} port={cfg.port} user={cfg.user} "
        f"password={cfg.pwd} dbname={cfg.db} connect_timeout=5"
    )


def log_llm_call(
    scene: str,
    model: str,
    temperature: float,
    prompt_tokens: int | None = None,
    completion_tokens: int | None = None,
    total_tokens: int | None = None,
    latency_ms: int | None = None,
    status: str = "success",
    error_message: str | None = None,
    prompt_text: str | None = None,
    response_key: str | None = None,
) -> dict[str, Any]:
    """
    记录一次 LLM 调用。
    prompt_text 过大时不存数据库，改存 OSS 或本地文件，只存 key。
    """
    if psycopg is None:
        return {"call_id": str(uuid.uuid4()), "stored": False}

    call_id = str(uuid.uuid4())
    prompt_hash = hashlib.sha256((prompt_text or "").encode()).hexdigest()[:16] if prompt_text else None

    try:
        with psycopg.connect(_conninfo(), row_factory=dict_row) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO llm_calls (
                        call_id, scene, model, temperature,
                        prompt_tokens, completion_tokens, total_tokens,
                        latency_ms, status, error_message,
                        prompt_hash, response_key
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        call_id,
                        scene,
                        model,
                        temperature,
                        prompt_tokens,
                        completion_tokens,
                        total_tokens,
                        latency_ms,
                        status,
                        error_message,
                        prompt_hash,
                        response_key,
                    ),
                )
            conn.commit()
        return {
            "call_id": call_id,
            "stored": True,
        }
    except Exception as exc:
        # 不中断主业务，只记录日志
        import logging

        logging.error(f"记录 LLM 调用失败：{exc}")
        return {"call_id": call_id, "stored": False}


def log_judge_result(
    run_id: str,
    case_id: str,
    turn_no: int,
    judge_dim: str,
    llm_call_id: int | None,
    score: int,
    pass_: bool,
    evidence: str,
    reason: str,
) -> None:
    """记录一次裁判打分结果。"""
    if psycopg is None:
        return

    try:
        with psycopg.connect(_conninfo()) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO judge_results (
                        run_id, case_id, turn_no, judge_dim,
                        llm_call_id, score, pass, evidence, reason
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        run_id,
                        case_id,
                        turn_no,
                        judge_dim,
                        llm_call_id,
                        score,
                        pass_,
                        evidence,
                        reason,
                    ),
                )
            conn.commit()
    except Exception as exc:
        import logging

        logging.error(f"记录评分结果失败：{exc}")


def get_llm_stats(start_time: int | None = None, end_time: int | None = None) -> dict[str, Any]:
    """查询 LLM 调用统计：按模型分组的 token 总数、调用数、平均延迟等。"""
    if psycopg is None:
        return {}

    try:
        with psycopg.connect(_conninfo(), row_factory=dict_row) as conn:
            with conn.cursor() as cur:
                sql = """
                    SELECT
                        model,
                        COUNT(*) as call_count,
                        SUM(prompt_tokens) as total_prompt_tokens,
                        SUM(completion_tokens) as total_completion_tokens,
                        SUM(total_tokens) as total_tokens,
                        AVG(latency_ms) as avg_latency_ms,
                        MAX(latency_ms) as max_latency_ms,
                        COUNT(*) FILTER (WHERE status = 'success') as success_count,
                        COUNT(*) FILTER (WHERE status != 'success') as error_count
                    FROM llm_calls
                    WHERE 1=1
                """
                params = []
                if start_time:
                    sql += " AND EXTRACT(EPOCH FROM created_at) >= %s"
                    params.append(start_time)
                if end_time:
                    sql += " AND EXTRACT(EPOCH FROM created_at) <= %s"
                    params.append(end_time)
                sql += " GROUP BY model ORDER BY call_count DESC"

                cur.execute(sql, params)
                rows = cur.fetchall()
        return {row["model"]: dict(row) for row in rows}
    except Exception as exc:
        import logging

        logging.error(f"查询 LLM 统计失败：{exc}")
        return {}
