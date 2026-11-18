# -*- coding: utf-8 -*-
"""OSS 相关接口。"""
from __future__ import annotations

from fastapi import APIRouter, File, UploadFile
from pydantic import BaseModel

from ..responses import ok
from ..services import oss_service

router = APIRouter(prefix="/api/oss", tags=["oss"])


class SignRequest(BaseModel):
    key: str
    expires_sec: int = 900


@router.get("/probe")
def probe() -> dict:
    """内网 endpoint 优先，失败自动回退公网域名。"""
    return ok(oss_service.probe())


@router.get("/objects")
def objects(prefix: str = "", max_keys: int = 100) -> dict:
    items = oss_service.list_objects(prefix=prefix, max_keys=max(1, min(max_keys, 1000)))
    return ok({"items": items, "count": len(items)})


@router.post("/upload")
async def upload(file: UploadFile = File(...), key: str | None = None) -> dict:
    content = await file.read()
    target = key or f"uploads/{file.filename}"
    saved = oss_service.put_object(
        target, content, content_type=file.content_type or "application/octet-stream"
    )
    return ok({"key": saved, "size": len(content)})


@router.post("/sign")
def sign(req: SignRequest) -> dict:
    return ok({"url": oss_service.sign_url(req.key, req.expires_sec)})
