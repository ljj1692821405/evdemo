# -*- coding: utf-8 -*-
"""FastAPI 应用装配。"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import __version__
from .config import server_settings
from .middleware.tenant_middleware import TenantMiddleware
from .responses import ServiceError, fail
from .routers import llm, oss, pg, system
from .services import llm_service
from .routers import (
    auth_router,
    capability_router,
    dataset_router,
    experiment_router,
    flow_config_router,
    judge_router,
    result_router,
    scorer_router,
    snapshot_router,
    task_router,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s - %(message)s")
log = logging.getLogger("eval.backend")


@asynccontextmanager
async def lifespan(_: FastAPI):
    """应用生命周期：关闭时释放 LLM 的 httpx 连接池与信号量。"""
    yield
    await llm_service.close_client()


def create_app() -> FastAPI:
    settings = server_settings()
    app = FastAPI(
        title="评测平台后端",
        version=__version__,
        description="前后端分离后端服务：LLM 代理 / PostgreSQL / OSS",
        docs_url="/docs",
        openapi_url="/openapi.json",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins or ["http://localhost:3000"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    # 租户上下文：解析 x-org-id / x-product-line-id / x-agent-id
    app.add_middleware(TenantMiddleware)

    @app.middleware("http")
    async def token_guard(request: Request, call_next):
        """可选内部令牌校验：API_TOKEN 为空时不做任何拦截（本地开发）。"""
        token = server_settings().api_token
        if token and not request.url.path.startswith(("/docs", "/openapi.json", "/api/health")):
            if request.headers.get("x-api-token") != token:
                return JSONResponse(status_code=401, content=fail("缺少或错误的 x-api-token"))
        return await call_next(request)

    @app.exception_handler(ServiceError)
    async def handle_service_error(_: Request, exc: ServiceError) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content=fail(exc.message, **exc.extra))

    app.include_router(system.router)
    app.include_router(llm.router)
    app.include_router(pg.router)
    app.include_router(oss.router)

    # 评测平台 API 路由
    app.include_router(auth_router.router)
    app.include_router(flow_config_router.router)
    app.include_router(task_router.router)
    app.include_router(result_router.router)
    app.include_router(dataset_router.router)
    app.include_router(judge_router.router)
    app.include_router(scorer_router.router)
    app.include_router(capability_router.router)
    app.include_router(experiment_router.router)
    app.include_router(snapshot_router.router)

    return app


app = create_app()
