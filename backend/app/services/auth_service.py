# -*- coding: utf-8 -*-
"""认证服务：飞书扫码登录 + 本地会话。

设计要点：
1. 飞书 open_id 在单个应用内稳定且唯一，直接作为用户唯一键，不引入第二套 ID。
2. 会话 token 只把 sha256 存库，明文仅返回给浏览器一次，库被拖也无法冒用。
3. 用 users 表的 upsert 记录首次/最近登录与登录次数，满足「记录用户身份」的需求。
"""
from __future__ import annotations

import hashlib
import json
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlencode

import httpx

from ..config import feishu_settings
from ..responses import ServiceError
from .pg_service import execute, query

# 飞书接口返回 200 也可能是业务错误，用 code 判断
_OK_CODES = {0, None}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


# ========== 飞书 OAuth ==========

def build_authorize_url(state: str = "", scope: str = "") -> str:
    """拼装飞书授权页地址，浏览器跳过去即出现扫码登录。

    state 原样回传，前端借此防 CSRF 并回跳原始目标页。
    """
    cfg = feishu_settings()
    if not cfg.ready:
        raise ServiceError("飞书登录未配置（需要 FEISHU_APP_ID / FEISHU_APP_SECRET）", 503)

    params = {
        "client_id": cfg.app_id,
        "redirect_uri": cfg.redirect_uri,
        "response_type": "code",
        "state": state or secrets.token_urlsafe(16),
    }
    if scope:
        params["scope"] = scope
    return f"{cfg.authorize_url}?{urlencode(params)}"


async def exchange_code_for_token(code: str) -> dict[str, Any]:
    """用授权码换 user_access_token。

    注意飞书这里用 JSON body 而非表单，凭据放在 body 里（不是 HTTP Basic）。
    """
    cfg = feishu_settings()
    if not cfg.ready:
        raise ServiceError("飞书登录未配置", 503)

    payload = {
        "grant_type": "authorization_code",
        "client_id": cfg.app_id,
        "client_secret": cfg.app_secret,
        "code": code,
        "redirect_uri": cfg.redirect_uri,
    }

    async with httpx.AsyncClient(timeout=15) as client:
        try:
            resp = await client.post(cfg.token_url, json=payload)
        except httpx.HTTPError as exc:
            raise ServiceError(f"请求飞书 token 接口失败：{exc}", 502) from exc

    try:
        body = resp.json()
    except ValueError as exc:
        raise ServiceError(f"飞书 token 接口返回非 JSON（HTTP {resp.status_code}）", 502) from exc

    if body.get("code") not in _OK_CODES:
        raise ServiceError(
            f"飞书换取 token 失败：{body.get('error_description') or body.get('msg') or body}",
            401,
        )

    data = body.get("data") or body
    if not data.get("access_token"):
        raise ServiceError("飞书未返回 access_token，请确认应用类型为「网页应用」", 401)
    return data


async def fetch_userinfo(access_token: str) -> dict[str, Any]:
    """拉取飞书用户信息（昵称、头像、邮箱等）。"""
    cfg = feishu_settings()
    async with httpx.AsyncClient(timeout=15) as client:
        try:
            resp = await client.get(
                cfg.userinfo_url,
                headers={"Authorization": f"Bearer {access_token}"},
            )
        except httpx.HTTPError as exc:
            raise ServiceError(f"请求飞书 user_info 失败：{exc}", 502) from exc

    try:
        body = resp.json()
    except ValueError as exc:
        raise ServiceError(f"飞书 user_info 返回非 JSON（HTTP {resp.status_code}）", 502) from exc

    if body.get("code") not in _OK_CODES:
        raise ServiceError(f"获取飞书用户信息失败：{body.get('msg') or body}", 401)

    return body.get("data") or {}


# ========== 用户 ==========

def upsert_user(info: dict[str, Any]) -> dict[str, Any]:
    """按 open_id 落库：首次登录插入，再次登录累加登录次数并刷新最近登录时间。"""
    open_id = info.get("open_id")
    if not open_id:
        raise ServiceError("飞书用户信息缺少 open_id", 502)

    sql = """
        INSERT INTO eval_users (
            open_id, union_id, user_id, name, en_name, avatar_url,
            email, mobile, tenant_key, raw
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)
        ON CONFLICT (open_id) DO UPDATE SET
            union_id      = COALESCE(EXCLUDED.union_id, eval_users.union_id),
            user_id       = COALESCE(EXCLUDED.user_id, eval_users.user_id),
            name          = COALESCE(EXCLUDED.name, eval_users.name),
            en_name       = COALESCE(EXCLUDED.en_name, eval_users.en_name),
            avatar_url    = COALESCE(EXCLUDED.avatar_url, eval_users.avatar_url),
            email         = COALESCE(EXCLUDED.email, eval_users.email),
            mobile        = COALESCE(EXCLUDED.mobile, eval_users.mobile),
            tenant_key    = COALESCE(EXCLUDED.tenant_key, eval_users.tenant_key),
            raw           = EXCLUDED.raw,
            last_login_at = CURRENT_TIMESTAMP,
            login_count   = eval_users.login_count + 1
        RETURNING id, open_id, union_id, user_id, name, en_name, avatar_url,
                  email, mobile, role, org_id, first_login_at, last_login_at, login_count
    """
    rows = execute(sql, params=(
        open_id,
        info.get("union_id"),
        info.get("user_id"),
        info.get("name"),
        info.get("en_name"),
        info.get("avatar_url"),
        info.get("email"),
        info.get("mobile"),
        info.get("tenant_key"),
        json.dumps(info, ensure_ascii=False),
    ), fetch=True)
    if not rows:
        raise ServiceError("用户信息写入失败", 500)
    return rows[0]


def get_user_by_open_id(open_id: str) -> dict[str, Any] | None:
    rows = query(
        "SELECT id, open_id, union_id, user_id, name, en_name, avatar_url, email, "
        "mobile, role, org_id, first_login_at, last_login_at, login_count "
        "FROM eval_users WHERE open_id = %s",
        params=(open_id,),
        limit=1,
    )
    return rows[0] if rows else None


def list_users(limit: int = 100, offset: int = 0) -> list[dict[str, Any]]:
    """已登录过的用户列表，方便确认「身份是否被记录」。"""
    rows = query(
        "SELECT id, open_id, name, en_name, email, avatar_url, role, org_id, "
        "first_login_at, last_login_at, login_count "
        "FROM eval_users ORDER BY last_login_at DESC LIMIT %s OFFSET %s",
        params=(limit, offset),
    )
    return [user_public(r) for r in rows]


def user_public(row: dict[str, Any]) -> dict[str, Any]:
    """对外输出的用户结构（前端 auth store 直接用）。"""
    return {
        "openId": row.get("open_id") or row.get("u_open_id"),
        "unionId": row.get("union_id"),
        "userId": row.get("user_id"),
        "name": row.get("name") or row.get("en_name") or "未命名用户",
        "enName": row.get("en_name"),
        "avatarUrl": row.get("avatar_url"),
        "email": row.get("email"),
        "role": row.get("role") or "member",
        "orgId": row.get("org_id") or "default",
        "firstLoginAt": str(row.get("first_login_at") or ""),
        "lastLoginAt": str(row.get("last_login_at") or ""),
        "loginCount": row.get("login_count") or 0,
    }


# ========== 会话 ==========

def create_session(
    open_id: str,
    ip: str = "",
    user_agent: str = "",
    hours: int | None = None,
) -> dict[str, Any]:
    """签发会话 token，返回明文（仅此一次）与过期时间。"""
    cfg = feishu_settings()
    ttl = hours or cfg.session_hours
    token = secrets.token_urlsafe(32)
    expires_at = _now() + timedelta(hours=ttl)

    execute(
        "INSERT INTO eval_sessions (token_hash, open_id, expires_at, ip, user_agent) "
        "VALUES (%s, %s, %s, %s, %s)",
        params=(hash_token(token), open_id, expires_at, (ip or "")[:64], (user_agent or "")[:500]),
    )
    return {
        "token": token,
        "expiresAt": expires_at.isoformat(),
        "expiresIn": ttl * 3600,
    }


def resolve_session(token: str) -> dict[str, Any] | None:
    """校验 token 是否有效，返回关联用户。

    每次请求都查库，保证被吊销或过期的会话立即失效。
    """
    if not token:
        return None
    rows = query(
        "SELECT s.open_id, s.expires_at, s.revoked, "
        "       u.union_id, u.user_id, u.name, u.en_name, u.avatar_url, u.email, "
        "       u.role, u.org_id, u.first_login_at, u.last_login_at, u.login_count "
        "FROM eval_sessions s JOIN eval_users u ON u.open_id = s.open_id "
        "WHERE s.token_hash = %s",
        params=(hash_token(token),),
        limit=1,
    )
    if not rows:
        return None

    row = rows[0]
    if row.get("revoked"):
        return None

    expires_at = row.get("expires_at")
    if expires_at is not None and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at is None or expires_at < _now():
        return None

    return user_public(row)


def revoke_session(token: str) -> bool:
    if not token:
        return False
    affected = execute(
        "UPDATE eval_sessions SET revoked = TRUE WHERE token_hash = %s",
        params=(hash_token(token),),
    )
    return bool(affected)


def purge_expired_sessions() -> int:
    """清理过期会话，避免表无限增长。可挂定时任务，也可在登录时顺手调用。"""
    return int(execute("DELETE FROM eval_sessions WHERE expires_at < CURRENT_TIMESTAMP") or 0)


def auth_status() -> dict[str, Any]:
    """给前端探测用：飞书是否配置好，以及回调地址（便于对照开放平台配置）。"""
    cfg = feishu_settings()
    return {
        "feishuConfigured": cfg.ready,
        "redirectUri": cfg.redirect_uri,
    }


