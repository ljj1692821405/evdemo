# -*- coding: utf-8 -*-
"""本地启动：python run.py [--reload]"""
from __future__ import annotations

import argparse

import uvicorn

from app.config import server_settings


def main() -> None:
    parser = argparse.ArgumentParser(description="评测平台后端启动器")
    parser.add_argument("--reload", action="store_true", help="代码变更自动重载（开发用）")
    parser.add_argument("--host", default=None)
    parser.add_argument("--port", type=int, default=None)
    args = parser.parse_args()

    settings = server_settings()
    uvicorn.run(
        "app.main:app",
        host=args.host or settings.host,
        port=args.port or settings.port,
        reload=args.reload,
        log_level="info",
    )


if __name__ == "__main__":
    main()
