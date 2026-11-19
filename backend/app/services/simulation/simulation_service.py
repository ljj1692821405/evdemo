# -*- coding: utf-8 -*-
"""Agent 仿真服务：驱动被评测的 Agent 跑多轮会话，产出标准化轨迹。

对接协议（参考 适配业务参考/02_本地自动化流水线/01_simulate_single.py）：
  1. 建会话：POST {base_url}/bff/agent/v1/sessions  -> 拿 session_id
  2. 发消息：POST {base_url}/bff/agent/v1/sessions/{sid}/messages  -> 返回 SSE 流
  3. 逐行解析 SSE，累积本轮回复文本与工具事件，得到一轮的结果
  4. 多轮按顺序发送，拼成一条 trajectory

凭据（base_url / cookie）来自 config.json 顶层，由 sim_settings() 统一读取。
全程只做"把 Agent 跑起来并收集产出"，不做评分——评分是后续裁判环节的事。
"""
from __future__ import annotations

import json
import logging
import time
from typing import Any

import httpx

from ...config import sim_settings
from ...responses import ServiceError

log = logging.getLogger(__name__)


def _headers() -> dict[str, str]:
    cfg = sim_settings()
    return {
        "Content-Type": "application/json",
        "Cookie": cfg.cookie,
        "x-client-platform": "web",
        "User-Agent": "EvalPlatformBackend/1.0",
    }


def _ensure_ready() -> None:
    cfg = sim_settings()
    if not cfg.base_url:
        raise ServiceError("未配置仿真 base_url（config.json 顶层 base_url 或环境变量 SIM_BASE_URL）", 500)
    if not cfg.cookie:
        raise ServiceError("未配置仿真 cookie（config.json 顶层 cookie 或环境变量 SIM_COOKIE）", 500)


async def _create_session(client: httpx.AsyncClient, title: str) -> str:
    """建立一次会话，返回 session_id。"""
    cfg = sim_settings()
    url = f"{cfg.base_url}/bff/agent/v1/sessions"
    payload = {"agentId": cfg.agent_id, "title": title}
    try:
        resp = await client.post(url, headers=_headers(), json=payload)
    except httpx.HTTPError as exc:
        raise ServiceError(f"连接仿真服务失败：{exc}", 502) from exc

    if resp.status_code not in (200, 201):
        raise ServiceError(f"创建仿真会话失败 HTTP {resp.status_code}：{resp.text[:300]}", 502)

    data = resp.json()
    sid = (data.get("result") or {}).get("id") or data.get("sessionId")
    if not sid:
        raise ServiceError(f"无法从仿真响应解析 sessionId：{str(data)[:300]}", 502)
    return str(sid)


def _parse_sse_line(line: str) -> dict[str, Any] | None:
    """解析单行 SSE。只认 data: 行，忽略事件名/注释/空行。"""
    line = line.strip()
    if not line or line.startswith(":"):
        return None
    if line.startswith("data:"):
        payload = line[len("data:"):].strip()
        if not payload or payload == "[DONE]":
            return None
        try:
            return json.loads(payload)
        except json.JSONDecodeError:
            return None
    return None


def _extract_text(chunk: dict[str, Any]) -> str:
    """从一个 SSE chunk 抽取"正式回复"的文本增量。

    真实协议（comic-toc bff，2026-11 抓取确认）：
      {"type": "text-delta", "payload": {"id": "txt-0", "text": "你好"}, ...}
    只认 type=text-delta 的 payload.text。reasoning-delta 是模型思考过程，
    由 _extract_reasoning 单独收集，不混进正式回复。

    同时保留对几种通用字段的兜底（delta.content / content / text），
    便于将来 Agent 直连接口若用别的结构也能尽量抽到。
    """
    if chunk.get("type") == "text-delta":
        payload = chunk.get("payload")
        if isinstance(payload, dict) and isinstance(payload.get("text"), str):
            return payload["text"]
        return ""

    # 兜底：非本协议时按常见字段尝试
    for path in (
        ("delta", "content"),
        ("content",),
        ("text",),
        ("message", "content"),
        ("result", "content"),
    ):
        node: Any = chunk
        hit = True
        for key in path:
            if isinstance(node, dict) and key in node:
                node = node[key]
            else:
                hit = False
                break
        if hit and isinstance(node, str) and node:
            return node
    return ""


def _extract_reasoning(chunk: dict[str, Any]) -> str:
    """抽取模型思考过程增量（type=reasoning-delta 的 payload.text）。"""
    if chunk.get("type") == "reasoning-delta":
        payload = chunk.get("payload")
        if isinstance(payload, dict) and isinstance(payload.get("text"), str):
            return payload["text"]
    return ""



async def _send_message(client: httpx.AsyncClient, session_id: str, message: str) -> dict[str, Any]:
    """发一轮消息并消费 SSE 流，返回这一轮的汇总结果。"""
    cfg = sim_settings()
    url = f"{cfg.base_url}/bff/agent/v1/sessions/{session_id}/messages"
    payload = {"content": {"prompt": message, "refs": []}}

    started = time.perf_counter()
    text_parts: list[str] = []
    reasoning_parts: list[str] = []
    events: list[dict[str, Any]] = []

    try:
        async with client.stream("POST", url, headers=_headers(), json=payload) as resp:
            if resp.status_code >= 400:
                body = await resp.aread()
                raise ServiceError(
                    f"仿真发送消息失败 HTTP {resp.status_code}：{body.decode('utf-8', 'replace')[:300]}",
                    502,
                )
            async for raw in resp.aiter_lines():
                chunk = _parse_sse_line(raw)
                if chunk is None:
                    continue
                events.append(chunk)
                piece = _extract_text(chunk)
                if piece:
                    text_parts.append(piece)
                think = _extract_reasoning(chunk)
                if think:
                    reasoning_parts.append(think)
    except httpx.HTTPError as exc:
        raise ServiceError(f"仿真流式请求失败：{exc}", 502) from exc

    return {
        "message": message,
        "reply": "".join(text_parts),
        "reasoning": "".join(reasoning_parts),
        "event_count": len(events),
        "latency_ms": int((time.perf_counter() - started) * 1000),
    }


def _messages_from_input(input_data: dict[str, Any]) -> list[str]:
    """从一个 case 的输入里解析出"要依次发送的多轮消息"。

    兼容几种常见写法：
      - {"messages": ["第一轮", "第二轮"]}
      - {"user_query": "单轮问题"} / {"query": ...} / {"prompt": ...}
    """
    msgs = input_data.get("messages")
    if isinstance(msgs, list) and msgs:
        return [str(m) for m in msgs if str(m).strip()]

    for key in ("user_query", "query", "prompt"):
        val = input_data.get(key)
        if isinstance(val, str) and val.strip():
            return [val.strip()]

    raise ServiceError(
        "case 输入缺少可发送的消息（需 messages[] 或 user_query / query / prompt）", 400
    )


async def run_simulation(
    input_data: dict[str, Any],
    simulation_config: dict[str, Any] | None = None,
    title: str = "评测平台仿真会话",
) -> dict[str, Any]:
    """对单个 case 跑一次完整仿真，返回标准化轨迹。

    返回结构：
      {
        "session_id": "...",
        "turns": [{"turn": 1, "message": "...", "reply": "...", ...}, ...],
        "final_reply": "最后一轮回复",
        "total_latency_ms": 1234
      }
    """
    _ensure_ready()
    cfg = sim_settings()
    simulation_config = simulation_config or {}

    messages = _messages_from_input(input_data)
    max_turns = int(simulation_config.get("max_turns") or cfg.max_turns)
    if len(messages) > max_turns:
        messages = messages[:max_turns]

    started = time.perf_counter()
    turns: list[dict[str, Any]] = []

    async with httpx.AsyncClient(
        timeout=cfg.timeout,
        limits=httpx.Limits(max_connections=10, max_keepalive_connections=5),
    ) as client:
        session_id = await _create_session(client, title)
        for idx, msg in enumerate(messages, start=1):
            result = await _send_message(client, session_id, msg)
            result["turn"] = idx
            turns.append(result)

    return {
        "session_id": session_id,
        "turns": turns,
        "final_reply": turns[-1]["reply"] if turns else "",
        "total_latency_ms": int((time.perf_counter() - started) * 1000),
    }


async def probe() -> dict[str, Any]:
    """连通性自检：建一个会话即可验证 base_url 与 cookie 是否有效。"""
    cfg = sim_settings()
    if not cfg.ready:
        return {"ok": False, "stage": "config", "error": "base_url 或 cookie 未配置"}

    started = time.perf_counter()
    try:
        async with httpx.AsyncClient(timeout=cfg.timeout) as client:
            session_id = await _create_session(client, "连通性自检")
    except ServiceError as exc:
        return {"ok": False, "stage": "session", "error": exc.message, "base_url": cfg.base_url}

    return {
        "ok": True,
        "stage": "session",
        "base_url": cfg.base_url,
        "agent_id": cfg.agent_id,
        "cookie_masked": cfg.masked_cookie,
        "session_id": session_id,
        "latency_ms": int((time.perf_counter() - started) * 1000),
    }

