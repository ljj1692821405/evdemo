# -*- coding: utf-8 -*-
"""请求级租户上下文。

中间件在请求入口解析隔离维度写入 ContextVar，服务层在未显式传参时回退到这里取值，
避免每个函数都透传 org_id / agent_id。
"""
from __future__ import annotations

from contextvars import ContextVar, Token
from dataclasses import dataclass

DEFAULT_ORG_ID = "default"


@dataclass(frozen=True)
class Tenant:
    org_id: str = DEFAULT_ORG_ID
    product_line_id: str = ""
    agent_id: str = ""
    user: str = ""

    @property
    def scoped(self) -> bool:
        """是否带上了显式的租户标识（用于日志/审计）。"""
        return bool(self.org_id != DEFAULT_ORG_ID or self.agent_id or self.product_line_id)


_current: ContextVar[Tenant] = ContextVar("eval_tenant", default=Tenant())


def get_tenant() -> Tenant:
    return _current.get()


def set_tenant(tenant: Tenant) -> Token[Tenant]:
    return _current.set(tenant)


def reset_tenant(token: Token[Tenant]) -> None:
    _current.reset(token)


def resolve_org(org_id: str | None) -> str:
    """显式参数优先，其次请求上下文，最后默认组织。"""
    if org_id:
        return org_id
    return get_tenant().org_id or DEFAULT_ORG_ID


def resolve_agent(agent_id: str | None) -> str:
    if agent_id:
        return agent_id
    return get_tenant().agent_id


def resolve_product_line(product_line_id: str | None) -> str:
    """产线维度。空串表示「未归属产线」，此时查询不加产线条件。

    之所以不用「请求头没带就默认某个产线」，是因为历史数据 product_line_id 是空串，
    强制过滤会让它们全部不可见。
    """
    if product_line_id is not None:
        return product_line_id
    return get_tenant().product_line_id


def scope_conditions(
    *,
    org_id: str | None = None,
    product_line_id: str | None = None,
    agent_id: str | None = None,
    prefix: str = "",
    alias_prefix: bool = False,
) -> tuple[list[str], list[object]]:
    """构造统一的租户过滤条件。

    隔离维度固定为三元组 (org_id, product_line_id, agent_id)，同一 Agent 内不做用户级隔离。

    org_id 始终参与过滤（默认 'default'）。
    product_line_id 为空串时不加条件——历史数据没有产线归属，强制过滤会导致它们全部不可见。
    agent_id 同理。
    """
    col = f"{prefix}." if alias_prefix else ""

    org = resolve_org(org_id)
    line = resolve_product_line(product_line_id)
    agent = resolve_agent(agent_id)

    conditions = [f"{col}org_id = %s"]
    params: list[object] = [org]

    if line:
        conditions.append(f"{col}product_line_id = %s")
        params.append(line)

    if agent:
        conditions.append(f"{col}agent_id = %s")
        params.append(agent)

    return conditions, params


