# -*- coding: utf-8 -*-
"""统一响应结构与异常处理。"""
from __future__ import annotations

from typing import Any


def ok(data: Any = None, **extra: Any) -> dict[str, Any]:
    body: dict[str, Any] = {"ok": True}
    if data is not None:
        body["data"] = data
    body.update(extra)
    return body


def fail(message: str, **extra: Any) -> dict[str, Any]:
    body: dict[str, Any] = {"ok": False, "error": message}
    body.update(extra)
    return body


class ServiceError(Exception):
    """业务异常：由全局处理器转成统一 JSON，避免 500 裸栈。"""

    def __init__(self, message: str, status_code: int = 400, **extra: Any) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.extra = extra
