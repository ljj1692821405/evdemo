# -*- coding: utf-8 -*-
"""任务执行服务：管理评测任务的异步执行。"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from ..pg_service import query, execute
from ...responses import ServiceError
from ...tenant import (
    Tenant,
    get_tenant,
    reset_tenant,
    resolve_agent,
    resolve_org,
    resolve_product_line,
    scope_conditions,
    set_tenant,
)

log = logging.getLogger(__name__)

# 全局任务队列和执行状态
_task_queue: asyncio.Queue | None = None
_running_tasks: dict[str, asyncio.Task] = {}
_max_concurrent_tasks = 5

# 后台执行协程脱离了请求上下文（ContextVar 丢失），这里按 task_id 记住
# 提交时的租户三元组，执行时再恢复，保证写 eval_results 落到正确的组织/产线/Agent。
_task_tenants: dict[str, Tenant] = {}


def row_to_task(row: dict[str, Any]) -> dict[str, Any]:
    """数据库行 → 前端 DTO（snake_case 转 camelCase）。

    与 dataset_service 的 _row_to_xxx 保持同一约定：接口层统一输出 camelCase，
    前端 api-client 不需要再做键名映射。
    """
    total = int(row.get("total_cases") or 0)
    completed = int(row.get("completed_cases") or 0)
    return {
        "taskId": row.get("task_id"),
        "flowId": row.get("flow_id"),
        "status": row.get("status"),
        "totalCases": total,
        "completedCases": completed,
        "failedCases": int(row.get("failed_cases") or 0),
        # 进度百分比：前端直接用于进度条，不用自己算
        "progress": int((completed / total) * 100) if total > 0 else 0,
        "createdBy": row.get("created_by"),
        "createdAt": str(row.get("created_at") or ""),
        "updatedAt": str(row.get("updated_at") or ""),
    }


# ========== 单 case 失败重试 ==========
#
# 为什么只重试「部分」错误：仿真失败里有一类是确定性的（输入不合法、cookie 过期到
# 401/403、配置缺失），重试只是浪费时间并放大对上游的压力；网络抖动、超时、5xx
# 才有重试价值。默认 retries 取流程 simulation_config.retries（0~3）。

_RETRYABLE_STATUS = (429, 500, 502, 503, 504)


def _is_retryable(exc: Exception) -> bool:
    """判断单 case 的失败是否值得重试。"""
    if isinstance(exc, ServiceError):
        # ServiceError 带 status_code：只有限流/服务端错误才重试
        return exc.status_code in _RETRYABLE_STATUS
    # 非业务异常（httpx 超时、连接重置等）一律重试
    return isinstance(exc, (asyncio.TimeoutError, TimeoutError, OSError)) or exc.__class__.__name__ in (
        "ConnectError",
        "ReadTimeout",
        "WriteTimeout",
        "PoolTimeout",
        "RemoteProtocolError",
        "HTTPError",
    )


def _retry_count(sim_cfg: dict[str, Any]) -> int:
    """重试次数来自流程配置，夹在 0~3 之间，避免配错导致长时间卡死。"""
    try:
        n = int(sim_cfg.get("retries", 0) or 0)
    except (TypeError, ValueError):
        return 0
    return max(0, min(n, 3))


async def _run_case_with_retry(
    case_input: dict[str, Any],
    sim_cfg: dict[str, Any],
    *,
    title: str,
    retries: int,
    base_delay: float = 1.0,
) -> tuple[dict[str, Any], int]:
    """跑单个 case，可重试错误按指数退避重试。

    返回 (轨迹, 重试次数)。最后一次仍失败则原样抛出，由调用方记 failed。
    """
    from ..simulation import simulation_service  # 延迟导入，避免模块级循环依赖

    attempt = 0
    while True:
        try:
            trajectory = await simulation_service.run_simulation(case_input, sim_cfg, title=title)
            return trajectory, attempt
        except Exception as exc:  # noqa: BLE001
            if attempt >= retries or not _is_retryable(exc):
                raise
            delay = base_delay * (2**attempt)
            attempt += 1
            log.warning(
                f"[任务执行器] {title} 第 {attempt} 次重试（{delay:.1f}s 后）：{type(exc).__name__}: {exc}"
            )
            await asyncio.sleep(delay)


async def _judge_result_safely(
    result_id: int,
    case_input: dict[str, Any],
    processed: dict[str, Any],
    judge_cfg: dict[str, Any],
    task_id: str,
    idx: int,
) -> None:
    """跑一次 LLM 评判；任何异常只记日志，绝不影响已成功的仿真结果。"""
    if not judge_cfg.get("enabled", True):
        return
    from ..judging import judge_service  # 延迟导入

    try:
        judgement = await judge_service.judge_one(case_input, processed, judge_cfg)
        judge_service.save_judgement(
            result_id=result_id,
            case_id=str(case_input.get("case_id") or case_input.get("id") or ""),
            dimension=str(judge_cfg.get("dimension") or "default"),
            judgement=judgement,
        )
        log.info(
            f"[任务执行器] {task_id}#{idx + 1} 评判完成：score={judgement['score']} "
            f"pass={judgement['pass']}"
        )
    except Exception as exc:  # noqa: BLE001 评判是增强项，失败不降级主流程
        log.warning(f"[任务执行器] {task_id}#{idx + 1} 评判失败（忽略）：{exc}")


async def _get_task_queue() -> asyncio.Queue:
    """获取全局任务队列。"""
    global _task_queue
    if _task_queue is None:
        _task_queue = asyncio.Queue()
    return _task_queue


def create_task(
    task_id: str,
    flow_id: str,
    input_data: list[dict[str, Any]],
    org_id: str,
    created_by: str = "system",
) -> str:
    """创建评测任务。"""
    total_cases = len(input_data)
    org_id = resolve_org(org_id)
    product_line_id = resolve_product_line(None)
    agent_id = resolve_agent(None)

    # 快照当前请求的租户，供后台执行协程恢复上下文
    _task_tenants[task_id] = Tenant(
        org_id=org_id,
        product_line_id=product_line_id,
        agent_id=agent_id,
        user=get_tenant().user,
    )

    sql = """
        INSERT INTO eval_tasks (
            task_id, flow_id, org_id, product_line_id, agent_id, status, 
            total_cases, completed_cases, failed_cases,
            input_data, created_by
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        RETURNING task_id
    """
    params = (
        task_id,
        flow_id,
        org_id,
        product_line_id,
        agent_id,
        "pending",
        total_cases,
        0,
        0,
        json.dumps(input_data),
        created_by,
    )
    
    try:
        execute(sql, params=params)
        return task_id
    except Exception as e:
        raise ServiceError(f"创建任务失败：{e}", 500) from e


def get_task(task_id: str) -> dict[str, Any] | None:
    """查询任务详情（自动附加租户过滤）。"""
    conditions, params = scope_conditions()
    sql = f"""
        SELECT 
            task_id, flow_id, org_id, product_line_id, agent_id, status,
            total_cases, completed_cases, failed_cases,
            input_data, created_by, created_at, updated_at
        FROM eval_tasks
        WHERE task_id = %s AND {' AND '.join(conditions)}
    """
    
    try:
        rows = query(sql, params=(task_id, *params), limit=1)
        return rows[0] if rows else None
    except Exception as e:
        raise ServiceError(f"查询任务失败：{e}", 500) from e


def list_tasks(
    org_id: str | None = None,
    status: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> list[dict[str, Any]]:
    """查询任务列表（默认限制在当前租户内）。"""
    conditions = ["org_id = %s"]
    params = [resolve_org(org_id)]
    line = resolve_product_line(None)
    if line:
        conditions.append("product_line_id = %s")
        params.append(line)
    agent = resolve_agent(None)
    if agent:
        conditions.append("agent_id = %s")
        params.append(agent)
    
    if status:
        conditions.append("status = %s")
        params.append(status)
    
    where_clause = " AND ".join(conditions)
    
    sql = f"""
        SELECT 
            task_id, flow_id, org_id, status,
            total_cases, completed_cases, failed_cases,
            created_by, created_at, updated_at
        FROM eval_tasks
        WHERE {where_clause}
        ORDER BY created_at DESC
        LIMIT %s OFFSET %s
    """
    params.extend([limit, offset])
    
    try:
        return query(sql, params=tuple(params))
    except Exception as e:
        raise ServiceError(f"查询任务列表失败：{e}", 500) from e


def update_task_status(
    task_id: str,
    status: str,
    completed_cases: int | None = None,
    failed_cases: int | None = None,
) -> bool:
    """更新任务状态（限定在当前租户内）。"""
    updates = ["status = %s", "updated_at = CURRENT_TIMESTAMP"]
    params = [status]
    
    if completed_cases is not None:
        updates.append("completed_cases = %s")
        params.append(completed_cases)
    
    if failed_cases is not None:
        updates.append("failed_cases = %s")
        params.append(failed_cases)
    
    conditions, scope_params = scope_conditions()
    params.extend([task_id, *scope_params])
    
    sql = f"UPDATE eval_tasks SET {', '.join(updates)} WHERE task_id = %s AND {' AND '.join(conditions)}"
    
    try:
        affected = execute(sql, params=tuple(params))
        return affected > 0
    except Exception as e:
        raise ServiceError(f"更新任务状态失败：{e}", 500) from e


async def submit_task_for_execution(task_id: str) -> None:
    """提交任务到执行队列。"""
    queue = await _get_task_queue()
    await queue.put(task_id)
    log.info(f"[任务执行器] 任务 {task_id} 已加入队列")


async def execute_single_task(task_id: str) -> None:
    """执行单个评测任务：逐 case 跑仿真 → 后处理 → 写 eval_results。

    后台协程脱离了请求上下文，先恢复提交时快照的租户，保证查配置、写结果
    都落在正确的 (org, product_line, agent) 三元组内。单个 case 失败不中断
    整批，仅累加 failed_cases 并把错误信息写进该 case 的结果行。
    """
    # 延迟导入：避免模块级 import 把仿真/后处理的依赖问题带到任务执行器导入期
    from ..simulation import simulation_service
    from ..flow_management import flow_config_service
    from ..result_processing import post_processor, result_service

    log.info(f"[任务执行器] 开始执行任务 {task_id}")

    tenant = _task_tenants.get(task_id, Tenant())
    token = set_tenant(tenant)
    try:
        task = get_task(task_id)
        if not task:
            log.error(f"[任务执行器] 任务 {task_id} 不存在，跳过")
            return

        update_task_status(task_id, "running")

        flow_id = task["flow_id"]
        input_list: list[dict[str, Any]] = task.get("input_data") or []
        if isinstance(input_list, str):
            input_list = json.loads(input_list)

        # 取流程配置，拿仿真参数与输出 schema
        flow = flow_config_service.get_flow_config(flow_id)
        sim_cfg = (flow or {}).get("simulation_config") or {}
        out_schema = (flow or {}).get("output_schema") or {}
        judge_cfg = (flow or {}).get("judge_config") or {}
        if isinstance(sim_cfg, str):
            sim_cfg = json.loads(sim_cfg)
        if isinstance(out_schema, str):
            out_schema = json.loads(out_schema)
        if isinstance(judge_cfg, str):
            judge_cfg = json.loads(judge_cfg)

        completed = 0
        failed = 0
        retries = _retry_count(sim_cfg)

        for idx, case_input in enumerate(input_list):
            try:
                trajectory, retried = await _run_case_with_retry(
                    case_input,
                    sim_cfg,
                    title=f"{task_id}#{idx + 1}",
                    retries=retries,
                )
                processed = post_processor.post_process(trajectory, out_schema)
                result_id = result_service.create_result(
                    task_id=task_id,
                    flow_id=flow_id,
                    org_id=tenant.org_id,
                    input_data=case_input,
                    raw_output=trajectory,
                    processed_output=processed,
                    status="completed",
                    latency_ms=int(trajectory.get("total_latency_ms") or 0),
                )

                # 流程配了 judge（裁判）就跑一次打分；失败不影响结果落库
                if judge_cfg:
                    await _judge_result_safely(result_id, case_input, processed, judge_cfg, task_id, idx)

                if retried:
                    log.info(f"[任务执行器] {task_id}#{idx + 1} 重试 {retried} 次后成功")
                completed += 1
            except Exception as case_err:  # noqa: BLE001 单 case 失败不拖垮整批
                log.warning(f"[任务执行器] 任务 {task_id} 第 {idx + 1} 个 case 失败：{case_err}")
                failed += 1
                try:
                    result_service.create_result(
                        task_id=task_id,
                        flow_id=flow_id,
                        org_id=tenant.org_id,
                        input_data=case_input,
                        raw_output={},
                        processed_output={},
                        status="failed",
                        error_message=str(case_err)[:1000],
                    )
                except Exception as save_err:  # noqa: BLE001
                    log.error(f"[任务执行器] 失败结果落库也失败：{save_err}")
            finally:
                update_task_status(task_id, "running", completed_cases=completed, failed_cases=failed)

        final_status = "completed" if failed == 0 else ("partial_failed" if completed > 0 else "failed")
        update_task_status(task_id, final_status, completed_cases=completed, failed_cases=failed)
        log.info(f"[任务执行器] 任务 {task_id} 结束：成功 {completed}，失败 {failed}，状态 {final_status}")

    except Exception as e:  # noqa: BLE001
        log.error(f"[任务执行器] 任务 {task_id} 执行失败：{e}")
        try:
            update_task_status(task_id, "failed")
        except Exception:  # noqa: BLE001
            pass
    finally:
        reset_tenant(token)
        _task_tenants.pop(task_id, None)


async def start_task_executor() -> None:
    """启动任务执行器（后台协程）。"""
    log.info("[任务执行器] 启动")
    queue = await _get_task_queue()
    
    while True:
        try:
            # 控制并发数量
            while len(_running_tasks) >= _max_concurrent_tasks:
                await asyncio.sleep(1)
            
            # 从队列获取任务
            task_id = await queue.get()
            
            # 启动异步执行
            task = asyncio.create_task(execute_single_task(task_id))
            _running_tasks[task_id] = task
            
            # 清理已完成的任务
            for tid, t in list(_running_tasks.items()):
                if t.done():
                    del _running_tasks[tid]
            
        except Exception as e:
            log.error(f"[任务执行器] 发生错误：{e}")
            await asyncio.sleep(1)
