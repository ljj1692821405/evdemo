# -*- coding: utf-8 -*-
"""认证 API 路由：飞书扫码登录、会话校验、登出。"""
from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Header, Query, Request
from pydantic import BaseModel, Field

from .. import rbac
from ..responses import ServiceError, ok
from ..services import auth_service

log = logging.getLogger("eval.auth")

router = APIRouter(prefix="/api/auth", tags=["认证"])


class CallbackRequest(BaseModel):
    """飞书回调换会话。前端拿到 code 后转给后端，避免 app_secret 出现在浏览器。"""
    code: str = Field(description="飞书授权码")
    state: str = Field(default="", description="原样回传的 state")


def _bearer(authorization: str | None, fallback: str | None = None) -> str:
    if fallback:
        return fallback.strip()
    if not authorization:
        return ""
    parts = authorization.split(None, 1)
    if len(parts) == 2 and parts[0].lower() == "bearer":
        return parts[1].strip()
    return authorization.strip()


# ========== API 端点 ==========

@router.get("/status")
async def auth_status() -> dict[str, Any]:
    """探测飞书是否已配置，登录页据此决定是否显示「去飞书登录」。"""
    return ok(auth_service.auth_status())


@router.get("/login-url")
async def login_url(
    state: str = Query("", description="防 CSRF 的随机值，登录后原样回传"),
    redirect: str = Query("", description="登录成功后前端回跳的路径"),
) -> dict[str, Any]:
    """返回飞书授权页地址，前端 window.location.href 跳过去即可扫码。"""
    # 把回跳路径塞进 state，格式 <nonce>|<path>，回调时拆开
    payload = f"{state or ''}|{redirect or '/'}"
    url = auth_service.build_authorize_url(state=payload)
    return ok({"url": url})


@router.post("/feishu/callback")
async def feishu_callback(req: CallbackRequest, request: Request) -> dict[str, Any]:
    """用授权码换 token → 拉用户信息 → 落库 → 签发本地会话。

    返回 sessionToken，前端存 localStorage 并在后续请求里带 Authorization: Bearer。
    """
    if not req.code:
        raise ServiceError("缺少飞书授权码 code", 400)

    token_data = await auth_service.exchange_code_for_token(req.code)
    userinfo = await auth_service.fetch_userinfo(token_data["access_token"])
    row = auth_service.upsert_user(userinfo)

    client_ip = request.client.host if request.client else ""
    session = auth_service.create_session(
        open_id=row["open_id"],
        ip=client_ip,
        user_agent=request.headers.get("user-agent", ""),
    )

    # 顺手清理过期会话，登录是低频操作，放这里成本可忽略
    try:
        auth_service.purge_expired_sessions()
    except Exception:  # pragma: no cover - 清理失败不影响登录
        log.warning("清理过期会话失败", exc_info=True)

    redirect = ""
    if "|" in req.state:
        redirect = req.state.split("|", 1)[1] or ""

    return ok({
        "sessionToken": session["token"],
        "expiresAt": session["expiresAt"],
        "expiresIn": session["expiresIn"],
        "user": auth_service.user_public(row),
        "redirect": redirect,
    })


@router.get("/me")
async def me(
    authorization: str | None = Header(None),
    x_session_token: str | None = Header(None),
) -> dict[str, Any]:
    """校验当前会话并返回用户信息。前端启动时调用一次判断是否已登录。"""
    token = _bearer(authorization, x_session_token)
    user = auth_service.resolve_session(token)
    if not user:
        raise ServiceError("未登录或登录已过期", 401)
    return ok({"user": user})


@router.post("/logout")
async def logout(
    authorization: str | None = Header(None),
    x_session_token: str | None = Header(None),
) -> dict[str, Any]:
    """吊销当前会话。"""
    token = _bearer(authorization, x_session_token)
    auth_service.revoke_session(token)
    return ok({"message": "已退出登录"})


@router.get("/capabilities")
async def capabilities(request: Request) -> dict[str, Any]:
    """返回当前用户的角色与权限点，前端据此隐藏/禁用按钮。"""
    from .. import rbac

    return ok(rbac.describe(rbac.current_role(request)))


@router.get("/users")
async def users(
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    _role: str = rbac.require(rbac.PERM_USER_ADMIN),
) -> dict[str, Any]:
    """已登录用户列表 —— 仅管理员可见。"""
    rows = auth_service.list_users(limit=limit, offset=offset)
    return ok({"users": rows, "total": len(rows), "limit": limit, "offset": offset})
