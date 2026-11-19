# -*- coding: utf-8 -*-
"""Phase 2 增强功能测试（纯逻辑 + mock，不碰真实 DB / LLM）。

覆盖：
  1. RBAC 角色归一化、权限矩阵、admin 放行
  2. 任务执行器的重试判定（_is_retryable / _retry_count）
  3. 重试执行流（mock 仿真，验证真的会重试/不重试）
  4. 评判提示词拼装（judge_service._build_messages）

运行：python enhancement_test.py
"""
from __future__ import annotations

import asyncio
import sys

PASSED = 0
FAILED = 0


def check(cond: bool, label: str, detail: str = "") -> None:
    global PASSED, FAILED
    if cond:
        PASSED += 1
        print(f"  OK {label}{(' ' + detail) if detail else ''}")
    else:
        FAILED += 1
        print(f"  FAILED: {label} {detail}")


def section(title: str) -> None:
    print(f"\n{'=' * 58}\n{title}\n{'=' * 58}")


def test_rbac() -> None:
    section("RBAC 角色与权限")
    from app import rbac

    check(rbac.normalise_role("ADMIN") == "admin", "大小写归一")
    check(rbac.normalise_role("owner") == "admin", "别名 owner→admin")
    check(rbac.normalise_role("") == "member", "空角色默认 member")
    check(rbac.normalise_role("不存在的角色") == "member", "未知角色退回 member")

    check(rbac.has_permission("admin", rbac.PERM_USER_ADMIN), "admin 有用户管理权")
    check(rbac.has_permission("editor", rbac.PERM_FLOW_WRITE), "editor 可写流程")
    check(not rbac.has_permission("editor", rbac.PERM_USER_ADMIN), "editor 无用户管理权")
    check(not rbac.has_permission("viewer", rbac.PERM_TASK_WRITE), "viewer 不可提交任务")
    check(rbac.has_permission("member", rbac.PERM_TASK_WRITE), "member 可提交任务")
    check(not rbac.has_permission("member", rbac.PERM_FLOW_WRITE), "member 不可写流程")

    desc = rbac.describe("admin")
    check(desc["isAdmin"] is True, "describe 标记 admin")
    check(rbac.PERM_USER_ADMIN in desc["permissions"], "describe 列出权限点")


def test_retry_logic() -> None:
    section("任务重试判定")
    from app.responses import ServiceError
    from app.services.task_execution import task_executor_service as te

    check(te._is_retryable(ServiceError("limit", 429)), "429 可重试")
    check(te._is_retryable(ServiceError("bad gateway", 502)), "502 可重试")
    check(te._is_retryable(asyncio.TimeoutError()), "超时可重试")
    check(te._is_retryable(TimeoutError()), "内置 TimeoutError 可重试")

    check(not te._is_retryable(ServiceError("参数错误", 400)), "400 不重试")
    check(not te._is_retryable(ServiceError("未授权", 401)), "401 不重试")
    check(not te._is_retryable(ServiceError("forbidden", 403)), "403 不重试")
    check(not te._is_retryable(ValueError("x")), "普通 ValueError 不重试")

    check(te._retry_count({"retries": 2}) == 2, "retries=2 生效")
    check(te._retry_count({"retries": 99}) == 3, "retries 上限夹到 3")
    check(te._retry_count({"retries": -1}) == 0, "retries 负数夹到 0")


async def _run_retry_flow() -> None:
    """验证 _run_case_with_retry 真的会重试并最终成功。"""
    from app.responses import ServiceError
    from app.services.task_execution import task_executor_service as te
    import app.services.simulation.simulation_service as sim

    calls = {"n": 0}

    async def fake_run_sim(case_input, sim_cfg, title=""):
        calls["n"] += 1
        if calls["n"] < 3:
            raise ServiceError("上游抖动", 503)
        return {"final_reply": "ok", "turns": [], "total_latency_ms": 1}

    original = sim.run_simulation
    sim.run_simulation = fake_run_sim
    try:
        traj, retried = await te._run_case_with_retry(
            {"user_query": "hi"}, {"retries": 3}, title="t#1", retries=3, base_delay=0.0
        )
        check(traj["final_reply"] == "ok", "重试后拿到成功轨迹")
        check(retried == 2, "恰好重试 2 次", f"retried={retried}")
        check(calls["n"] == 3, "总共调用 3 次")
    finally:
        sim.run_simulation = original


async def _run_retry_exhausted() -> None:
    """超过重试上限仍失败时，原样抛出。"""
    from app.responses import ServiceError
    from app.services.task_execution import task_executor_service as te
    import app.services.simulation.simulation_service as sim

    async def always_fail(case_input, sim_cfg, title=""):
        raise ServiceError("一直 500", 500)

    original = sim.run_simulation
    sim.run_simulation = always_fail
    try:
        raised = False
        try:
            await te._run_case_with_retry({}, {}, title="t#2", retries=1, base_delay=0.0)
        except ServiceError:
            raised = True
        check(raised, "耗尽重试后抛出异常")
    finally:
        sim.run_simulation = original


async def _run_no_retry_on_client_error() -> None:
    """400 这类错误不该重试，第一次就抛。"""
    from app.responses import ServiceError
    from app.services.task_execution import task_executor_service as te
    import app.services.simulation.simulation_service as sim

    calls = {"n": 0}

    async def client_error(case_input, sim_cfg, title=""):
        calls["n"] += 1
        raise ServiceError("输入不合法", 400)

    original = sim.run_simulation
    sim.run_simulation = client_error
    try:
        try:
            await te._run_case_with_retry({}, {}, title="t#3", retries=3, base_delay=0.0)
        except ServiceError:
            pass
        check(calls["n"] == 1, "400 只调用一次（不重试）", f"calls={calls['n']}")
    finally:
        sim.run_simulation = original


def test_retry_flow() -> None:
    section("任务重试执行（mock 仿真）")
    asyncio.run(_run_retry_flow())
    asyncio.run(_run_retry_exhausted())
    asyncio.run(_run_no_retry_on_client_error())


def test_judge_prompt() -> None:
    section("评判提示词拼装")
    from app.services.judging import judge_service as js

    msgs = js._build_messages(
        {"user_query": "北京是哪国首都", "gt": "中国"},
        {"final_reply": "中国"},
        {},
    )
    check(len(msgs) == 2, "两段消息（system + user）")
    check(msgs[0]["role"] == "system", "首段是 system")
    check("裁判" in msgs[0]["content"], "默认 rubric 生效")
    check("北京是哪国首都" in msgs[1]["content"], "任务要求进入提示词")
    check("中国" in msgs[1]["content"], "参考答案进入提示词")

    msgs2 = js._build_messages({"query": ["仅问题"]}, {"final_reply": "x"}, {})
    check("未提供参考答案" in msgs2[1]["content"], "缺 GT 时给占位说明")

    msgs3 = js._build_messages(
        {"q": "问", "answer": "参考"},
        {"reply": "作答"},
        {"gt_field": "answer", "reply_field": "reply", "rubric": "自定义标准"},
    )
    check(msgs3[0]["content"] == "自定义标准", "自定义 rubric 覆盖默认")
    check("参考" in msgs3[1]["content"], "自定义 gt_field 生效")
    check("作答" in msgs3[1]["content"], "自定义 reply_field 生效")


def test_summarise() -> None:
    section("评判汇总边界")
    from app.services.judging import judge_service as js

    empty = js.summarise([])
    check(empty["judged"] == 0 and empty["passRate"] == 0.0, "空列表汇总安全")


def main() -> int:
    print("开始 Phase 2 增强功能测试（纯逻辑 + mock）")
    test_rbac()
    test_retry_logic()
    test_retry_flow()
    test_judge_prompt()
    test_summarise()

    print(f"\n{'=' * 58}")
    print(f"结果：通过 {PASSED}，失败 {FAILED}")
    print(f"{'=' * 58}")
    return 1 if FAILED else 0


if __name__ == "__main__":
    sys.exit(main())

    check(te._retry_count({}) == 0, "无 retries 默认 0")
    check(te._retry_count({"retries": "abc"}) == 0, "非法 retries 降级 0")
