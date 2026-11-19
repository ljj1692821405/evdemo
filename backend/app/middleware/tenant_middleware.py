# -*- coding: utf-8 -*-
"""租户隔离中间件。"""
from __future__ import annotations

import logging

from starlette.datastructures import Headers, QueryParams
from starlette.types import ASGIApp, Receive, Scope, Send

from ..tenant import DEFAULT_ORG_ID, Tenant, reset_tenant, set_tenant

log = logging.getLogger("eval.tenant")

# 对外约定的请求头（前端 / 网关注入）
HEADER_ORG = "x-org-id"
HEADER_LINE = "x-product-line-id"
HEADER_AGENT = "x-agent-id"
HEADER_USER = "x-user-id"


def _pick(headers: Headers, query: QueryParams, header: str, param: str) -> str:
    """请求头优先，其次 query 参数（便于 curl / Swagger 手工验证）。"""
    return (headers.get(header) or query.get(param) or "").strip()


def _session_open_id(headers: Headers) -> str:
    """从 Authorization: Bearer <token> 反查登录用户。

    延迟导入避免循环依赖（auth_service -> pg_service -> config，与中间件无环，
    但导入放模块顶层会让启动期的中间件注册依赖数据库模块）。
    """
    raw = headers.get("authorization") or ""
    parts = raw.split(None, 1)
    token = parts[1].strip() if len(parts) == 2 and parts[0].lower() == "bearer" else ""
    token = token or (headers.get("x-session-token") or "").strip()
    if not token:
        return ""
    try:
        from ..services import auth_service

        user = auth_service.resolve_session(token)
        return (user or {}).get("openId") or ""
    except Exception:  # 数据库不可用时不阻断请求，退化为无用户态
        log.debug("解析会话用户失败", exc_info=True)
        return ""


class TenantMiddleware:
    """解析隔离维度并写入 ContextVar。

    用纯 ASGI 实现而非 BaseHTTPMiddleware：后者会把下游放到子任务里执行，
    ContextVar 的传递依赖实现细节，容易在流式响应下丢失。
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return

        headers = Headers(scope=scope)
        query = QueryParams(scope.get("query_string", b""))

        # 显式请求头优先；没有则从登录会话取，保证用户身份自动落到上下文
        user = _pick(headers, query, HEADER_USER, "user_id") or _session_open_id(headers)

        tenant = Tenant(
            org_id=_pick(headers, query, HEADER_ORG, "org_id") or DEFAULT_ORG_ID,
            product_line_id=_pick(headers, query, HEADER_LINE, "product_line_id"),
            agent_id=_pick(headers, query, HEADER_AGENT, "agent_id"),
            user=user,
        )

        token = set_tenant(tenant)
        try:
            await self.app(scope, receive, send)
        finally:
            reset_tenant(token)
