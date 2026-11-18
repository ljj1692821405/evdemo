# -*- coding: utf-8 -*-
"""LLM 相关接口。"""
from __future__ import annotations

import json
from typing import Union

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from ..config import llm_settings
from ..responses import ok
from ..services import llm_service

router = APIRouter(prefix="/api/llm", tags=["llm"])


class MessageContent(BaseModel):
    """多模态消息内容元素"""
    type: str = Field(..., pattern="^(text|image_url)$")
    text: str | None = None
    image_url: dict[str, str] | None = None


class Message(BaseModel):
    role: str = Field(..., pattern="^(system|user|assistant)$")
    content: Union[str, list[MessageContent]]  # 支持字符串或多模态数组


class ChatRequest(BaseModel):
    messages: list[Message]
    model: str | None = None
    temperature: float = 0.2
    stream: bool = False
    json_mode: bool = False


@router.get("/status")
async def status() -> dict:
    """只回配置状态，绝不回传明文 key。"""
    cfg = llm_settings()
    return ok(
        {
            "ready": cfg.ready,
            "base_url": cfg.base_url,
            "model": cfg.model,
            "api_key_masked": cfg.masked_key,
        }
    )


@router.get("/probe")
async def probe() -> dict:
    """真实发一次请求，验证 key 与网络是否可用。"""
    return ok(await llm_service.probe())


@router.get("/models")
async def models() -> dict:
    return ok({"models": await llm_service.list_models()})


@router.post("/chat")
async def chat(req: ChatRequest) -> dict:
    messages = [m.model_dump() for m in req.messages]
    result = await llm_service.chat(
        messages,
        model=req.model,
        temperature=req.temperature,
        json_mode=req.json_mode,
    )
    return ok(result)


@router.post("/chat/stream")
async def chat_stream(req: ChatRequest) -> StreamingResponse:
    """流式对话，返回自定义 SSE 格式。"""
    messages = [m.model_dump() for m in req.messages]
    
    async def event_generator():
        async for event in llm_service.chat_stream(
            messages, model=req.model, temperature=req.temperature
        ):
            # 每个事件都序列化为 SSE 格式
            yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
    
    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"},
    )
