# -*- coding: utf-8 -*-
"""仿真引擎封装测试（mock httpx，不碰真实 Agent 服务与数据库）。

覆盖三层：
  1. SSE 解析与文本抽取的纯函数
  2. run_simulation 多轮会话编排（mock httpx 建会话 + 发消息）
  3. post_process 按 output_schema 提字段

运行：python simulation_test.py
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


# ---- mock httpx：模拟建会话响应 + SSE 流 ----

class _FakeResponse:
    def __init__(self, status_code, json_data=None, lines=None):
        self.status_code = status_code
        self._json = json_data or {}
        self._lines = lines or []

    def json(self):
        return self._json

    @property
    def text(self):
        return str(self._json)

    async def aread(self):
        return b"error body"

    async def aiter_lines(self):
        for ln in self._lines:
            yield ln

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False


class _FakeClient:
    """按调用顺序回放预设响应：post=建会话，stream=发消息。"""

    def __init__(self, session_resp, stream_resps):
        self._session_resp = session_resp
        self._stream_resps = list(stream_resps)

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def post(self, url, **kw):
        return self._session_resp

    def stream(self, method, url, **kw):
        return self._stream_resps.pop(0)


def test_sse_parsing() -> None:
    section("1. SSE 解析与文本抽取纯函数")
    from app.services.simulation import simulation_service as sim

    check(sim._parse_sse_line("") is None, "空行返回 None")
    check(sim._parse_sse_line(": comment") is None, "注释行返回 None")
    check(sim._parse_sse_line("data: [DONE]") is None, "[DONE] 返回 None")
    check(sim._parse_sse_line('data: {"content":"hi"}') == {"content": "hi"}, "data 行解析为 dict")
    check(sim._parse_sse_line("data: not json") is None, "坏 JSON 返回 None（不抛错）")

    # 真实协议：type=text-delta 的 payload.text 才是正式回复
    check(sim._extract_text({"type": "text-delta", "payload": {"text": "你好"}}) == "你好", "text-delta 抽正式回复")
    check(sim._extract_text({"type": "reasoning-delta", "payload": {"text": "思考"}}) == "", "reasoning-delta 不算正式回复")
    check(sim._extract_reasoning({"type": "reasoning-delta", "payload": {"text": "思考"}}) == "思考", "reasoning-delta 单独抽取")
    check(sim._extract_reasoning({"type": "text-delta", "payload": {"text": "你好"}}) == "", "text-delta 不算思考")
    # 兜底：非本协议的通用字段
    check(sim._extract_text({"content": "A"}) == "A", "兜底 content 字段抽取")
    check(sim._extract_text({"delta": {"content": "B"}}) == "B", "兜底 delta.content 抽取")
    check(sim._extract_text({"foo": "bar"}) == "", "无匹配字段返回空串")


def test_messages_from_input() -> None:
    section("2. case 输入 → 多轮消息解析")
    from app.services.simulation import simulation_service as sim
    from app.responses import ServiceError

    check(sim._messages_from_input({"messages": ["a", "b"]}) == ["a", "b"], "messages[] 原样")
    check(sim._messages_from_input({"user_query": "q"}) == ["q"], "user_query 单轮")
    check(sim._messages_from_input({"query": "q2"}) == ["q2"], "query 单轮")
    check(sim._messages_from_input({"prompt": "q3"}) == ["q3"], "prompt 单轮")
    try:
        sim._messages_from_input({"nothing": 1})
        check(False, "缺消息应抛 ServiceError")
    except ServiceError:
        check(True, "缺消息抛 ServiceError")


def test_run_simulation() -> None:
    section("3. run_simulation 多轮编排（mock httpx）")
    from app.services.simulation import simulation_service as sim
    import httpx

    session_resp = _FakeResponse(200, json_data={"result": {"id": "sess_123"}})
    turn1 = _FakeResponse(200, lines=[
        'data: {"type":"text-delta","payload":{"text":"你好"}}',
        'data: {"type":"text-delta","payload":{"text":"世界"}}',
        "data: [DONE]",
    ])
    turn2 = _FakeResponse(200, lines=[
        'data: {"type":"reasoning-delta","payload":{"text":"思考中"}}',
        'data: {"type":"text-delta","payload":{"text":"第二轮回复"}}',
        "data: [DONE]",
    ])
    fake_client = _FakeClient(session_resp, [turn1, turn2])

    orig = httpx.AsyncClient
    httpx.AsyncClient = lambda *a, **k: fake_client  # type: ignore[assignment]
    # 本用例只验证多轮编排与 SSE 抽取，mock httpx 不真连服务；
    # 因此把 _ensure_ready 的真实配置校验也 patch 掉，避免 CI 等无 config.json 环境误报 500。
    orig_ensure = sim._ensure_ready
    sim._ensure_ready = lambda: None  # type: ignore[assignment]
    try:
        traj = asyncio.run(sim.run_simulation({"messages": ["第一轮", "第二轮"]}))
    finally:
        httpx.AsyncClient = orig  # type: ignore[assignment]
        sim._ensure_ready = orig_ensure  # type: ignore[assignment]

    check(traj["session_id"] == "sess_123", "会话 id 解析正确")
    check(len(traj["turns"]) == 2, "两轮都执行", f"-> {len(traj['turns'])}")
    check(traj["turns"][0]["reply"] == "你好世界", "第一轮文本累积", f"-> {traj['turns'][0]['reply']}")
    check(traj["turns"][1]["reply"] == "第二轮回复", "第二轮 text-delta 抽取")
    check(traj["turns"][1]["reasoning"] == "思考中", "第二轮 reasoning 单独收集")
    check(traj["final_reply"] == "第二轮回复", "final_reply 取最后一轮")


def test_post_process() -> None:
    section("4. post_process 按 output_schema 提字段")
    from app.services.result_processing import post_processor as pp

    traj = {
        "session_id": "s1",
        "turns": [{"turn": 1, "reply": "r1"}, {"turn": 2, "reply": "r2"}],
        "final_reply": "r2",
        "total_latency_ms": 500,
    }

    # 无 schema → 默认摘要
    summary = pp.post_process(traj, None)
    check(summary["final_reply"] == "r2", "默认摘要含 final_reply")
    check(summary["turn_count"] == 2, "默认摘要含 turn_count")

    # 带 schema → 精确提取
    schema = {
        "fields": [
            {"name": "ans", "source": "final_reply"},
            {"name": "n", "source": "turns_count"},
            {"name": "first", "source": "turns.0.reply"},
            {"name": "sid", "source": "session_id"},
        ]
    }
    out = pp.post_process(traj, schema)
    check(out["ans"] == "r2", "final_reply 映射到 ans")
    check(out["n"] == 2, "turns_count 映射到 n")
    check(out["first"] == "r1", "turns.0.reply 取第一轮")
    check(out["sid"] == "s1", "session_id 提取")

    # 越界 turns 索引 → None，不抛错
    out2 = pp.post_process(traj, {"fields": [{"name": "x", "source": "turns.9.reply"}]})
    check(out2["x"] is None, "越界索引返回 None（不抛错）")


def main() -> int:
    print("开始仿真引擎封装测试（mock httpx，无需真实 Agent / DB）")
    test_sse_parsing()
    test_messages_from_input()
    test_run_simulation()
    test_post_process()

    print(f"\n{'=' * 58}")
    print(f"结果：通过 {PASSED}，失败 {FAILED}")
    print(f"{'=' * 58}")
    return 1 if FAILED else 0


if __name__ == "__main__":
    sys.exit(main())

