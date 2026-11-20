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
import base64
from .model_capabilities import get_capability
from ..responses import ServiceError

log = logging.getLogger(__name__)

# ---- 全局客户端与并发限制 ----
# httpx.AsyncClient 的连接池与 asyncio.Semaphore 都会绑定到「创建它们的事件循环」：
# 循环一关，再拿去用就报 RuntimeError: Event loop is closed。
# uvicorn 正常跑只有一个循环，但测试（TestClient 每个实例一个循环）、
# 脚本里多次 asyncio.run、--reload 重启都会换循环，所以这里必须记住归属循环。
_client: httpx.AsyncClient | None = None
_client_loop: asyncio.AbstractEventLoop | None = None
_semaphore: asyncio.Semaphore | None = None
_semaphore_loop: asyncio.AbstractEventLoop | None = None


async def _get_client() -> httpx.AsyncClient:
    """取得当前事件循环专属的 httpx 客户端，复用连接池。

    归属循环变了就重建；旧客户端所属的循环多半已关闭，不能 await aclose()，
    直接丢引用（其 socket 随循环一起没了）。
    """
    global _client, _client_loop
    loop = asyncio.get_running_loop()
    if _client is None or _client.is_closed or _client_loop is not loop:
        _client = httpx.AsyncClient(
            timeout=120.0,
            limits=httpx.Limits(max_connections=10, max_keepalive_connections=5),
        )
        _client_loop = loop
    return _client


async def _get_semaphore() -> asyncio.Semaphore:
    """取得当前事件循环专属的并发信号量：同时最多 3 个请求。"""
    global _semaphore, _semaphore_loop
    loop = asyncio.get_running_loop()
    if _semaphore is None or _semaphore_loop is not loop:
        _semaphore = asyncio.Semaphore(3)
        _semaphore_loop = loop
    return _semaphore


async def close_client() -> None:
    """服务关闭时调用，释放客户端与信号量。

    只关闭当前循环持有的那两个；属于其他（多半已关闭的）循环的对象直接丢引用。
    """
    global _client, _client_loop, _semaphore, _semaphore_loop
    loop = asyncio.get_running_loop()
    if _client is not None and not _client.is_closed and _client_loop is loop:
        await _client.aclose()
    _client = None
    _client_loop = None
    _semaphore = None
    _semaphore_loop = None


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
    messages: list[dict[str, Any]],
    model: str | None = None,
    temperature: float = 0.2,
    response_schema: type[BaseModel] | None = None,
    max_tokens: int = 4096,
) -> dict[str, Any]:
    """
    调用 LLM 并解析为结构化 JSON。

    与 chat() 共用同一条三层路由（detect → validate → route），
    区别只在收尾：这里强制 json_object，并把正文解析成 dict / pydantic。
    如果响应包含 ```json 代码块，自动剥掉。
    """
    result = await _dispatch(
        messages,
        model=model,
        temperature=temperature,
        json_mode=True,
        max_tokens=max_tokens,
    )

    raw_content = result.get("content") or ""

    # 剥掉代码块包裹
    content = raw_content.strip()
    if content.startswith("```json"):
        content = content[7:]
    elif content.startswith("```"):
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
                f"LLM 返回的 JSON 不符合契约：{exc}。收到：{json.dumps(parsed, ensure_ascii=False)[:200]}",
                502,
            ) from exc

    return {
        "model": result.get("model"),
        "content": content,
        "parsed": parsed,
        "usage": result.get("usage"),
        "latency_ms": int(result.get("latency_ms") or 0),
        "adapter_used": result.get("adapter_used"),
    }




# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 多模态三层处理：detect → validate → route
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def _detect_modalities(messages: list) -> set:
    """扫描 messages，返回本次请求实际用到的模态集合。"""
    mods: set = {"text"}
    for msg in messages:
        content = msg.get("content", "")
        if not isinstance(content, list):
            continue
        for part in content:
            t = part.get("type", "")
            if t == "image_url":
                mods.add("image")
            elif t == "video_url":
                mods.add("video")
    return mods


def _validate_capability(model_id: str, required: set) -> dict:
    """查能力表；若模型不支持所需模态，抛 ServiceError(400)。"""
    cap = get_capability(model_id)
    unsupported = required - set(cap["modalities"])
    if unsupported:
        raise ServiceError(
            f"模型 {model_id} 不支持 {sorted(unsupported)} 输入"
            f"（该模型支持：{sorted(cap['modalities'])}）",
            400,
        )
    return cap


def _build_openai_payload(model_id, messages, temperature, json_mode, max_tokens):
    payload = {"model": model_id, "messages": messages,
               "temperature": temperature, "max_tokens": max_tokens, "stream": False}
    if json_mode:
        payload["response_format"] = {"type": "json_object"}
    return payload


def _build_gemini_payload(model_id, messages, temperature, max_tokens):
    """OpenAI messages → Gemini contents/parts + inline_data。"""
    def to_parts(content):
        if isinstance(content, str):
            return [{"text": content}]
        parts = []
        for p in content:
            t = p.get("type", "")
            if t == "text":
                parts.append({"text": p["text"]})
            elif t in ("image_url", "video_url"):
                url = p[t]["url"]
                if url.startswith("data:"):
                    header, data = url.split(",", 1)
                    mime = header.split(":")[1].split(";")[0]
                    parts.append({"inline_data": {"mime_type": mime, "data": data}})
                else:
                    mime = "video/mp4" if t == "video_url" else "image/jpeg"
                    parts.append({"file_data": {"mime_type": mime, "file_uri": url}})
        return parts

    contents = []
    for msg in messages:
        role = "user" if msg.get("role") == "user" else "model"
        contents.append({"role": role, "parts": to_parts(msg.get("content", ""))})
    return {"contents": contents,
            "generationConfig": {"maxOutputTokens": max_tokens, "temperature": temperature}}


def _parse_gemini_response(j: dict) -> tuple:
    """解析 Gemini 原生响应，过滤 thought part。"""
    cand0 = (j.get("candidates") or [{}])[0]
    parts = (cand0.get("content") or {}).get("parts") or []
    texts = [p.get("text", "") for p in parts if p.get("text") and not p.get("thought")]
    text = "".join(texts).strip()
    meta = j.get("usageMetadata") or {}
    usage = {"prompt_tokens": meta.get("promptTokenCount"),
             "completion_tokens": meta.get("candidatesTokenCount"),
             "total_tokens": meta.get("totalTokenCount")}
    return text, usage

async def _dispatch(
    messages: list[Any],
    model: str | None = None,
    temperature: float = 0.2,
    json_mode: bool = False,
    max_tokens: int = 4096,
) -> dict[str, Any]:
    """
    三层路由主干：detect → validate → route。

    chat() 与 call_json() 共用这一条路径，保证「改模型服务只改一处」：
    对话测试 UI、评分器调试台、批量评判、实验跑分自动获得同一套
    模态检测、能力表校验与适配器选择。

    返回统一结构：{model, content, usage, latency_ms, adapter_used}
    """
    _ensure_ready()
    cfg = llm_settings()
    model_id = model or cfg.model

    # ① 检测本次请求用到的模态
    required = _detect_modalities(messages)

    # ② 校验能力表（不支持则抛 400 ServiceError）
    cap = _validate_capability(model_id, required)
    video_ep = cap["video_endpoint"]

    started = time.perf_counter()

    # ③ 路由：Gemini 原生门 vs OpenAI 兼容门
    use_gemini_native = (
        cap["provider"] == "gemini"
        and "video" in required
        and video_ep == "gemini-native"
    )

    if use_gemini_native:
        root = cfg.base_url.rstrip("/")
        if root.endswith("/v1"):
            root = root[:-3]
        url = f"{root}/v1beta/models/{model_id}:generateContent"
        hdr = {"x-goog-api-key": cfg.api_key, "Content-Type": "application/json"}
        payload = _build_gemini_payload(model_id, messages, temperature, max_tokens)
        async with httpx.AsyncClient(timeout=cfg.timeout) as c:
            try:
                resp = await c.post(url, headers=hdr, json=payload)
            except httpx.HTTPError as exc:
                raise ServiceError(f"连接 Gemini 原生端点失败：{exc}", 502) from exc
        if resp.status_code >= 400:
            raise ServiceError(_unwrap_error(resp.status_code, resp.text), resp.status_code)
        content, usage = _parse_gemini_response(resp.json())
        return {"model": model_id, "content": content, "usage": usage,
                "latency_ms": int((time.perf_counter() - started) * 1000),
                "adapter_used": "gemini-native"}

    # OpenAI 兼容门
    payload = _build_openai_payload(model_id, messages, temperature, json_mode, max_tokens)
    client = await _get_client()
    sem = await _get_semaphore()

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
    return {"model": data.get("model") or model_id,
            "content": (choices[0].get("message") or {}).get("content", ""),
            "usage": data.get("usage"),
            "latency_ms": int((time.perf_counter() - started) * 1000),
            "adapter_used": "openai"}


async def chat(
    messages: list,
    model: str | None = None,
    temperature: float = 0.2,
    json_mode: bool = False,
    max_tokens: int = 4096,
) -> dict[str, Any]:
    """非流式对话，统一入口。三层路由全部委托 _dispatch，本函数只做转发。"""
    return await _dispatch(
        messages,
        model=model,
        temperature=temperature,
        json_mode=json_mode,
        max_tokens=max_tokens,
    )


def validate_stream_request(messages: list, model: str | None = None) -> dict[str, Any]:
    """流式请求的前置校验：模态检测 + 能力表。

    流式链路只走 OpenAI 兼容门，无法表达 Gemini 原生门，
    所以视频输入在这里直接抛 400，避免「正常返回但模型根本没看到视频」的静默失败。
    图片可正常透传，不拦截。
    """
    model_id = model or llm_settings().model
    required = _detect_modalities(messages)
    cap = _validate_capability(model_id, required)
    if "video" in required:
        raise ServiceError(
            f"流式接口暂不支持视频输入（模型 {model_id}），请改用非流式 /api/llm/chat",
            400,
        )
    return cap


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
        cap = get_capability(model_id)
        
        models.append({
            "id": model_id,
            "name": model_id,
            "capabilities": cap["modalities"],
            "provider": cap["provider"],
            "videoEndpoint": cap["video_endpoint"],
            "note": cap["note"],
            "registered": cap["registered"],
        })
    
    return models




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

