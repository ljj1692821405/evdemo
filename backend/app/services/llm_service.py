# -*- coding: utf-8 -*-
"""LLM 服务层：OpenAI 兼容协议，支持流式与非流式。
核心特性：
- 全进程共用一个 httpx.AsyncClient，避免每次重建连接
- 对 429、5xx 和超时做指数退避重试
- 信号量限制并发数，避免冲击上游
- 自定义 SSE 事件格式，支持部分失败重试
- call_json 结构化输出，带格式校验
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any, AsyncIterator

import httpx
from pydantic import BaseModel, Field, field_validator

from ..config import llm_settings
from ..responses import ServiceError

log = logging.getLogger(__name__)

# ---- 全局客户端与并发限制 ----
_client: httpx.AsyncClient | None = None
_semaphore: asyncio.Semaphore | None = None


async def _get_client() -> httpx.AsyncClient:
    """全进程共用的 httpx 客户端，复用连接池。"""
    global _client
    if _client is None:
        _client = httpx.AsyncClient(
            timeout=120.0,
            limits=httpx.Limits(max_connections=10, max_keepalive_connections=5),
        )
    return _client


async def _get_semaphore() -> asyncio.Semaphore:
    """并发限制信号量：同时最多 3 个请求。"""
    global _semaphore
    if _semaphore is None:
        _semaphore = asyncio.Semaphore(3)
    return _semaphore


async def close_client() -> None:
    """服务关闭时调用，释放客户端。"""
    global _client
    if _client:
        await _client.aclose()
        _client = None


def _headers() -> dict[str, str]:
    cfg = llm_settings()
    return {
        "Authorization": f"Bearer {cfg.api_key}",
        "Content-Type": "application/json",
        "User-Agent": "EvalPlatformBackend/1.0",
    }


def _ensure_ready() -> None:
    cfg = llm_settings()
    if not cfg.base_url:
        raise ServiceError("未配置 LLM base_url（config.json 的 llm.base_url 或环境变量 LLM_BASE_URL）", 500)
    if not cfg.api_key:
        raise ServiceError("未配置 LLM api_key（config.json 的 llm.api_key 或环境变量 LLM_API_KEY）", 500)


def _unwrap_error(status: int, body: str) -> str:
    snippet = " ".join(body.split())[:500]
    return f"上游 LLM 返回 HTTP {status}" + (f"：{snippet}" if snippet else "")


async def _retry_with_backoff(
    fn,
    max_retries: int = 2,
    base_delay: float = 0.5,
) -> Any:
    """
    对 fn() 做指数退避重试。
    重试条件：429（限流）、5xx（服务端错误）、超时异常。
    """
    attempt = 0
    while attempt <= max_retries:
        try:
            return await fn()
        except (httpx.HTTPError, asyncio.TimeoutError) as exc:
            attempt += 1
            if attempt > max_retries:
                raise
            # 判断是否值得重试
            if isinstance(exc, httpx.HTTPStatusError):
                if exc.response.status_code not in (429, 500, 502, 503, 504):
                    raise
            delay = base_delay * (2 ** (attempt - 1))
            log.warning(
                f"LLM 请求失败，将在 {delay:.1f}s 后重试（第 {attempt} 次）：{type(exc).__name__}"
            )
            await asyncio.sleep(delay)


# ---- 结构化输出验证 ----


class JudgeScore(BaseModel):
    """裁判打分输出契约。"""

    score: int = Field(..., ge=0, le=1, description="必须为 0 或 1")
    pass_: bool = Field(alias="pass", description="是否通过")
    evidence_analysis: str = Field(default="", description="推导过程")
    reason: str = Field(default="", description="结论")

    @field_validator("score")
    def validate_score(cls, v):
        if v not in (0, 1):
            raise ValueError("score 必须为 0 或 1")
        return v


async def call_json(
    messages: list[dict[str, str]],
    model: str | None = None,
    temperature: float = 0.2,
    response_schema: type[BaseModel] | None = None,
) -> dict[str, Any]:
    """
    调用 LLM 并解析为结构化 JSON。
    如果响应包含 ```json 代码块，自动剥掉。
    如果解析失败，尝试重新要求纠正（目前先直接失败，可后续改成重试）。
    """
    _ensure_ready()
    cfg = llm_settings()
    payload: dict[str, Any] = {
        "model": model or cfg.model,
        "messages": messages,
        "temperature": temperature,
        "stream": False,
        "response_format": {"type": "json_object"},
    }

    client = await _get_client()
    sem = await _get_semaphore()

    started = time.perf_counter()

    async def _call():
        async with sem:
            resp = await client.post(
                f"{cfg.base_url}/chat/completions", headers=_headers(), json=payload
            )
            if resp.status_code >= 400:
                raise ServiceError(_unwrap_error(resp.status_code, resp.text), resp.status_code)
            return resp.json()

    try:
        data = await _retry_with_backoff(_call, max_retries=cfg.max_retries)
    except ServiceError:
        raise
    except Exception as exc:
        raise ServiceError(f"连接上游 LLM 失败：{exc}", 502) from exc

    choices = data.get("choices") or [{}]
    raw_content = (choices[0].get("message") or {}).get("content", "")

    # 剥掉代码块包裹
    content = raw_content
    if content.startswith("```json"):
        content = content[7:]
    if content.startswith("```"):
        content = content[3:]
    if content.endswith("```"):
        content = content[:-3]
    content = content.strip()

    # 解析 JSON
    try:
        parsed = json.loads(content)
    except json.JSONDecodeError as exc:
        raise ServiceError(
            f"LLM 返回的 JSON 无法解析：{exc}。原始内容：{raw_content[:200]}",
            502,
        ) from exc

    # 可选：用 pydantic 验证
    if response_schema:
        try:
            validated = response_schema(**parsed)
            parsed = validated.model_dump(by_alias=True, exclude_unset=False)
        except Exception as exc:
            raise ServiceError(
                f"LLM 返回的 JSON 不符合契约：{exc}。收到：{json.dumps(parsed)[:200]}",
                502,
            ) from exc

    return {
        "model": data.get("model") or payload["model"],
        "content": content,
        "parsed": parsed,
        "usage": data.get("usage"),
        "latency_ms": int((time.perf_counter() - started) * 1000),
    }


async def chat(
    messages: list[dict[str, str]],
    model: str | None = None,
    temperature: float = 0.2,
    json_mode: bool = False,
) -> dict[str, Any]:
    """非流式对话，返回 content / usage / 耗时。"""
    _ensure_ready()
    cfg = llm_settings()
    payload: dict[str, Any] = {
        "model": model or cfg.model,
        "messages": messages,
        "temperature": temperature,
        "stream": False,
    }
    if json_mode:
        payload["response_format"] = {"type": "json_object"}

    client = await _get_client()
    sem = await _get_semaphore()

    started = time.perf_counter()

    async def _call():
        async with sem:
            resp = await client.post(
                f"{cfg.base_url}/chat/completions", headers=_headers(), json=payload
            )
            if resp.status_code >= 400:
                raise ServiceError(_unwrap_error(resp.status_code, resp.text), resp.status_code)
            return resp.json()

    try:
        data = await _retry_with_backoff(_call, max_retries=cfg.max_retries)
    except ServiceError:
        raise
    except Exception as exc:
        raise ServiceError(f"连接上游 LLM 失败：{exc}", 502) from exc

    choices = data.get("choices") or [{}]
    return {
        "model": data.get("model") or payload["model"],
        "content": (choices[0].get("message") or {}).get("content", ""),
        "usage": data.get("usage"),
        "latency_ms": int((time.perf_counter() - started) * 1000),
    }


async def chat(
    messages: list[dict[str, str]],
    model: str | None = None,
    temperature: float = 0.2,
    json_mode: bool = False,
) -> dict[str, Any]:
    """非流式对话，返回 content / usage / 耗时。"""
    _ensure_ready()
    cfg = llm_settings()
    payload: dict[str, Any] = {
        "model": model or cfg.model,
        "messages": messages,
        "temperature": temperature,
        "stream": False,
    }
    if json_mode:
        payload["response_format"] = {"type": "json_object"}

    started = time.perf_counter()
    try:
        async with httpx.AsyncClient(timeout=cfg.timeout) as client:
            resp = await client.post(
                f"{cfg.base_url}/chat/completions", headers=_headers(), json=payload
            )
    except httpx.HTTPError as exc:
        raise ServiceError(f"连接上游 LLM 失败：{exc}", 502) from exc

    if resp.status_code >= 400:
        raise ServiceError(_unwrap_error(resp.status_code, resp.text), resp.status_code)

    data = resp.json()
    choices = data.get("choices") or [{}]
    return {
        "model": data.get("model") or payload["model"],
        "content": (choices[0].get("message") or {}).get("content", ""),
        "usage": data.get("usage"),
        "latency_ms": int((time.perf_counter() - started) * 1000),
    }


async def chat_stream(
    messages: list[dict[str, Any]],
    model: str | None = None,
    temperature: float = 0.2,
) -> AsyncIterator[dict[str, Any]]:
    """
    流式对话，产出自定义事件格式。
    事件顺序：meta → delta* → usage → done / error
    每个事件都是一个 dict，由路由层序列化为 SSE。
    """
    _ensure_ready()
    cfg = llm_settings()
    payload = {
        "model": model or cfg.model,
        "messages": messages,
        "temperature": temperature,
        "stream": True,
    }

    started = time.perf_counter()

    # 先产出 meta 事件
    yield {
        "event": "meta",
        "model": payload["model"],
        "timestamp": int(time.time() * 1000),
    }

    accumulated_content = ""
    total_tokens = 0

    try:
        async with httpx.AsyncClient(timeout=cfg.timeout) as client:
            async with client.stream(
                "POST",
                f"{cfg.base_url}/chat/completions",
                headers=_headers(),
                json=payload,
            ) as resp:
                if resp.status_code >= 400:
                    body = (await resp.aread()).decode("utf-8", "replace")
                    raise ServiceError(_unwrap_error(resp.status_code, body), resp.status_code)

                # 逐行解析上游 SSE
                async for line in resp.aiter_lines():
                    if not line.startswith("data: "):
                        continue
                    if line.strip() == "data: [DONE]":
                        continue

                    try:
                        chunk = json.loads(line[6:])
                    except json.JSONDecodeError:
                        continue

                    # 提取 delta 内容
                    if chunk.get("choices"):
                        delta = chunk["choices"][0].get("delta", {})
                        if "content" in delta and delta["content"]:
                            accumulated_content += delta["content"]
                            yield {
                                "event": "delta",
                                "content": delta["content"],
                            }

                    # 提取 usage 信息
                    if chunk.get("usage"):
                        total_tokens = chunk["usage"].get("total_tokens", 0)
                        yield {
                            "event": "usage",
                            "prompt_tokens": chunk["usage"].get("prompt_tokens", 0),
                            "completion_tokens": chunk["usage"].get("completion_tokens", 0),
                            "total_tokens": total_tokens,
                        }

        # 流结束正常
        yield {
            "event": "done",
            "content": accumulated_content,
            "latency_ms": int((time.perf_counter() - started) * 1000),
        }

    except ServiceError as exc:
        yield {
            "event": "error",
            "message": exc.message,
            "latency_ms": int((time.perf_counter() - started) * 1000),
        }
    except Exception as exc:
        log.exception(f"流式对话异常：{exc}")
        yield {
            "event": "error",
            "message": f"流式处理异常：{type(exc).__name__}: {exc}",
            "latency_ms": int((time.perf_counter() - started) * 1000),
        }



async def list_models() -> list[dict[str, Any]]:
    """拉取上游可用模型 ID 列表，并标注能力。"""
    _ensure_ready()
    cfg = llm_settings()
    try:
        async with httpx.AsyncClient(timeout=cfg.timeout) as client:
            resp = await client.get(f"{cfg.base_url}/models", headers=_headers())
    except httpx.HTTPError as exc:
        raise ServiceError(f"连接上游 LLM 失败：{exc}", 502) from exc

    if resp.status_code >= 400:
        raise ServiceError(_unwrap_error(resp.status_code, resp.text), resp.status_code)

    data = resp.json()
    items = data.get("data") or []
    models = []
    
    for m in items:
        if not isinstance(m, dict) or not m.get("id"):
            continue
        
        model_id = str(m["id"])
        capabilities = _detect_capabilities(model_id)
        
        models.append({
            "id": model_id,
            "name": model_id,  # 可选：从上游解析更友好的名称
            "capabilities": capabilities
        })
    
    return models


def _detect_capabilities(model_id: str) -> list[str]:
    """根据模型 ID 检测其支持的能力。"""
    model_lower = model_id.lower()
    capabilities = ["text"]  # 所有模型默认支持文本
    
    # 图像理解能力检测
    vision_keywords = [
        "vision", "vlm", "claude-3", "gemini", "qwen-vl", 
        "deepseek-v", "gpt-4-turbo", "gpt-4-vision", "gpt-4o"
    ]
    if any(kw in model_lower for kw in vision_keywords):
        if "image" not in capabilities:
            capabilities.append("image")
    
    # 视频理解能力检测（未来扩展）
    video_keywords = [
        "video", "gemini-1.5", "gpt-4o"
    ]
    if any(kw in model_lower for kw in video_keywords):
        if "video" not in capabilities:
            capabilities.append("video")
    
    return capabilities


async def probe() -> dict[str, Any]:
    """连通性自检：发一个极小的请求，验证 key 与网络是否真的可用。"""
    cfg = llm_settings()
    if not cfg.ready:
        return {"ok": False, "stage": "config", "error": "base_url 或 api_key 未配置"}

    started = time.perf_counter()
    try:
        result = await chat([{"role": "user", "content": "ping"}], temperature=0.0)
    except ServiceError as exc:
        return {"ok": False, "stage": "request", "error": exc.message, "base_url": cfg.base_url}

    return {
        "ok": True,
        "stage": "chat",
        "base_url": cfg.base_url,
        "model": result["model"],
        "api_key_masked": cfg.masked_key,
        "latency_ms": result["latency_ms"],
        "reply_preview": (result["content"] or "")[:80],
        "roundtrip_ms": int((time.perf_counter() - started) * 1000),
    }

