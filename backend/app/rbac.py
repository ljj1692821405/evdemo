# -*- coding: utf-8 -*-
"""简单 RBAC：角色 → 权限点映射 + FastAPI 依赖。

设计取舍（刻意的「简单」）：
- 不做资源级 ACL，只做「这个角色的用户能否调用这类接口」。评测平台的写操作集中在
  流程配置 / 任务提交 / 数据集维护 / 用户管理，按这四类切权限点足够用。
- 权限点用字符串常量而非枚举：数据库里的 role 是自由文本，用枚举反而需要额外的
  转换层，且新增角色要改代码。
- 当前边界：角色只存在 eval_users.role，管理员需手工 UPDATE 提升；
  不做管理界面、不做审批流。
"""
from __future__ import annotations

import logging
from typing import Any

from fastapi import Depends, Request

from .responses import ServiceError

log = logging.getLogger("eval.rbac")

# ---- 角色 ----
ROLE_ADMIN = "admin"
ROLE_EDITOR = "editor"
ROLE_MEMBER = "member"
ROLE_VIEWER = "viewer"

# ---- 权限点 ----
PERM_FLOW_WRITE = "flow:write"
PERM_TASK_WRITE = "task:write"
PERM_DATASET_WRITE = "dataset:write"
PERM_JUDGE_RUN = "judge:run"
PERM_USER_ADMIN = "user:admin"

# 角色 → 权限点。admin 额外在 is_admin() 里单独放行，避免这里重复列出全部。
ROLE_PERMISSIONS: dict[str, set[str]] = {
    ROLE_ADMIN: {PERM_FLOW_WRITE, PERM_TASK_WRITE, PERM_DATASET_WRITE, PERM_JUDGE_RUN, PERM_USER_ADMIN},
    ROLE_EDITOR: {PERM_FLOW_WRITE, PERM_TASK_WRITE, PERM_DATASET_WRITE, PERM_JUDGE_RUN},
    ROLE_MEMBER: {PERM_TASK_WRITE, PERM_JUDGE_RUN},
    ROLE_VIEWER: set(),
}

# 兼容历史 role 值：数据库里可能有 'user' / 'manager' 这类旧写法
_ROLE_ALIASES = {
    "": ROLE_MEMBER,
    "user": ROLE_MEMBER,
    "normal": ROLE_MEMBER,
    "manager": ROLE_EDITOR,
    "owner": ROLE_ADMIN,
    "superadmin": ROLE_ADMIN,
}


def normalise_role(role: str | None) -> str:
    """把数据库里的 role 文本规整成四类标准角色之一。"""
    key = (role or "").strip().lower()
    if key in ROLE_PERMISSIONS:
        return key
    return _ROLE_ALIASES.get(key, ROLE_MEMBER)


def permissions_for(role: str | None) -> set[str]:
    return ROLE_PERMISSIONS.get(normalise_role(role), set())


def has_permission(role: str | None, perm: str) -> bool:
    return perm in permissions_for(role)


def is_admin(role: str | None) -> bool:
    return normalise_role(role) == ROLE_ADMIN


def current_role(request: Request) -> str:
    """读取当前请求的用户角色。

    会话解析放在中间件里做过一次（写进了 ContextVar 的 user），但角色不在 Tenant 上，
    这里按需再查一次；查询失败退化为 member，宁可少放权也不 500。
    """
    header_role = (request.headers.get("x-user-role") or "").strip()
    if header_role:
        return normalise_role(header_role)

    from .tenant import get_tenant

    open_id = get_tenant().user
    if not open_id:
        # 未登录（本地开发）视为 member，保持与现有「不做权限控制」行为一致
        return ROLE_MEMBER

    try:
        from .services import auth_service

        user = auth_service.get_user_by_open_id(open_id)
        return normalise_role((user or {}).get("role"))
    except Exception:  # noqa: BLE001 数据库抖动不应把请求打成 500
        log.debug("读取用户角色失败，按 member 处理", exc_info=True)
        return ROLE_MEMBER


def require(perm: str):
    """生成一个 FastAPI 依赖：要求当前用户具备某权限点。"""

    async def _checker(request: Request) -> str:
        role = current_role(request)
        if not has_permission(role, perm):
            raise ServiceError(
                f"当前角色 '{role}' 无权执行该操作（需要 {perm}）",
                403,
                requiredPermission=perm,
                role=role,
            )
        return role

    return Depends(_checker)


def describe(role: str | None) -> dict[str, Any]:
    """给前端渲染「我能做什么」用的能力描述。"""
    norm = normalise_role(role)
    return {
        "role": norm,
        "isAdmin": norm == ROLE_ADMIN,
        "permissions": sorted(permissions_for(norm)),
    }
