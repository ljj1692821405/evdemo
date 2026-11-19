# -*- coding: utf-8 -*-
"""LLM 评判 API 路由。"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field

from .. import rbac
from ..responses import ServiceError, ok
from ..services.judging import judge_service

router = APIRouter(prefix="/api/judges", tags=["LLM 评判"])


class JudgeRequest(BaseModel):
    """即时评判请求：对已落库的一条结果重跑裁判。"""
    resultId: int = Field(alias="result_id", description="eval_results.id")
    rubric: str = Field(default="", description="自定义评分标准，留空用默认")
    model: str = Field(default="", description="裁判模型，留空用 config.json 的 llm.model")
    gtField: str = Field(default="gt", alias="gt_field", description="input_data 中参考答案的键")
    replyField: str = Field(default="final_reply", alias="reply_field", description="待评回复的键")
    dimension: str = Field(default="answer_quality", description="打分维度名")

    model_config = {"populate_by_name": True}


class BatchJudgeRequest(BaseModel):
    """批量评判：给一个任务下的所有成功结果打分。"""
    taskId: str = Field(alias="task_id")
    rubric: str = ""
    model: str = ""
    dimension: str = "answer_quality"

    model_config = {"populate_by_name": True}


@router.get("")
async def list_judgements(
    result_id: int | None = Query(None, description="按结果 ID 过滤"),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> dict[str, Any]:
    """查询评判记录。"""
    rows = judge_service.list_judgements(result_id=result_id, limit=limit, offset=offset)
    return ok({
        "judgements": [judge_service.row_to_judgement(r) for r in rows],
        "total": len(rows),
        "limit": limit,
        "offset": offset,
    })


@router.post("")
async def judge_single(req: JudgeRequest, _role: str = rbac.require(rbac.PERM_JUDGE_RUN)) -> dict[str, Any]:
    """对单条结果执行一次评判（不影响已有仿真数据）。"""
    from ..services.result_processing import result_service

    result = result_service.get_result(req.resultId)
    if not result:
        raise ServiceError(f"结果记录 {req.resultId} 不存在", 404)

    processed = result.get("processed_output") or {}
    if isinstance(processed, str):
        import json
        processed = json.loads(processed)

    cfg = {
        "rubric": req.rubric,
        "model": req.model,
        "gt_field": req.gtField,
        "reply_field": req.replyField,
        "dimension": req.dimension,
        "enabled": True,
    }

    judgement = await judge_service.judge_one(result.get("input_data") or {}, processed, cfg)
    judge_id = judge_service.save_judgement(
        result_id=req.resultId,
        case_id=str((result.get("input_data") or {}).get("case_id") or ""),
        dimension=req.dimension,
        judgement=judgement,
    )

    return ok({"judgementId": judge_id, **judgement})


class DryRunJudgeRequest(BaseModel):
    """即席试跑评判：不依赖落库结果，直接传入 case 输入与待评回复。

    供「评分器调试台」使用——选一条 golden case 即时跑真实裁判 LLM，
    结果只返回给前端展示，不写 judge_results 表、不需要 result_id。
    """
    userQuery: str = Field(default="", alias="user_query", description="任务要求/用户诉求")
    groundTruth: str = Field(default="", alias="ground_truth", description="参考答案，可空")
    agentReply: str = Field(default="", alias="agent_reply", description="待评回复")
    rubric: str = Field(default="", description="自定义评分标准，留空用默认")
    model: str = Field(default="", description="裁判模型，留空用 config.json 的 llm.model")
    dimension: str = Field(default="answer_quality", description="打分维度名")

    model_config = {"populate_by_name": True}


@router.post("/dry-run")
async def judge_dry_run(
    req: DryRunJudgeRequest, _role: str = rbac.require(rbac.PERM_JUDGE_RUN)
) -> dict[str, Any]:
    """即席试跑一次评判（不落库）。复用 judge_service.judge_one 的真实裁判逻辑。"""
    case_input = {
        "user_query": req.userQuery,
        "gt": req.groundTruth,
    }
    processed_output = {"final_reply": req.agentReply}
    cfg = {
        "rubric": req.rubric,
        "model": req.model,
        "gt_field": "gt",
        "reply_field": "final_reply",
        "dimension": req.dimension,
        "enabled": True,
    }

    judgement = await judge_service.judge_one(case_input, processed_output, cfg)
    return ok(judgement)


@router.post("/batch")
async def judge_batch(req: BatchJudgeRequest, _role: str = rbac.require(rbac.PERM_JUDGE_RUN)) -> dict[str, Any]:
    """对一个任务下所有 completed 结果批量打分，返回汇总。"""
    from ..services.result_processing import result_service

    results = result_service.list_results(task_id=req.taskId, status="completed", limit=200)
    cfg = {
        "rubric": req.rubric,
        "model": req.model,
        "dimension": req.dimension,
        "enabled": True,
    }

    judged_ids: list[int] = []
    failures: list[dict[str, Any]] = []

    for row in results:
        processed = row.get("processed_output") or {}
        if isinstance(processed, str):
            import json
            processed = json.loads(processed)
        try:
            judgement = await judge_service.judge_one(row.get("input_data") or {}, processed, cfg)
            judge_service.save_judgement(
                result_id=int(row["id"]),
                case_id="",
                dimension=req.dimension,
                judgement=judgement,
            )
            judged_ids.append(int(row["id"]))
        except Exception as exc:  # noqa: BLE001 单条失败不影响整批
            failures.append({"resultId": row.get("id"), "error": str(exc)[:300]})

    return ok({
        "taskId": req.taskId,
        "judged": len(judged_ids),
        "failed": len(failures),
        "failures": failures,
        "summary": judge_service.summarise(judged_ids),
    })
