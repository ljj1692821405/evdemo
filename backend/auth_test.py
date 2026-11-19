# -*- coding: utf-8 -*-
"""飞书登录链路测试（真实 PostgreSQL + mock 飞书 HTTP）。

飞书开放平台无法在本地真实调用，因此只替换两个对外 HTTP 调用
（exchange_code_for_token / fetch_userinfo），其余全部走真实代码路径：
回调 → 用户落库 → 会话签发 → /me 校验 → 登出 → 会话失效。

运行：python auth_test.py
"""
from __future__ import annotations

import sys
from typing import Any

from fastapi.testclient import TestClient

from app.main import app
from app.services import auth_service

PASSED = 0
FAILED = 0


def check(cond: bool, label: str, detail: str = "") -> None:
    global PASSED, FAILED
    if cond:
        PASSED += 1
        print(f"  OK {label}{(' ' + detail) if detail else ''}")
    else:
        FAILED += 1
        print(f"  FAILED: {label} {detail}")


def section(title: str) -> None:
    print(f"\n{'=' * 58}\n{title}\n{'=' * 58}")


FAKE_USERINFO: dict[str, Any] = {
    "open_id": "ou_test_open_id_001",
    "union_id": "on_test_union_001",
    "user_id": "u_test_001",
    "name": "测试用户",
    "en_name": "Test User",
    "avatar_url": "https://example.com/avatar.png",
    "email": "test.user@example.com",
    "mobile": "13800000000",
    "tenant_key": "tk_test",
}


async def fake_exchange(code: str) -> dict[str, Any]:
    from app.responses import ServiceError

    if code == "bad_code":
        raise ServiceError("飞书换取 token 失败：invalid code", 401)
    return {"access_token": "fake_access_token", "expires_in": 7200}


async def fake_userinfo(access_token: str) -> dict[str, Any]:
    from app.responses import ServiceError

    if access_token != "fake_access_token":
        raise ServiceError("获取飞书用户信息失败：bad token", 401)
    return FAKE_USERINFO


def test_unconfigured() -> None:
    section("1. 未配置飞书凭据时的行为")

    # 显式清掉可能存在的环境变量，避免受运行终端影响
    # （PowerShell 的 $env: 赋值会跨命令保留，曾导致此项误判）
    import os

    saved = {k: os.environ.pop(k, None) for k in ("FEISHU_APP_ID", "FEISHU_APP_SECRET")}
    from app.config import feishu_settings

    feishu_settings.cache_clear()
    try:
        with TestClient(app) as c:
            r = c.get("/api/auth/status")
            check(r.status_code == 200, "GET /api/auth/status", f"-> {r.status_code}")
            check(isinstance(r.json()["data"]["feishuConfigured"], bool), "飞书配置状态是布尔值")

            # 未配置必须明确失败，不能给一个跳过去也会报错的地址
            r = c.get("/api/auth/login-url")
            check(r.status_code == 503, "未配置时 login-url 返回 503", f"-> {r.status_code}")

            r = c.get("/api/auth/me")
            check(r.status_code == 401, "无 token 访问 /me 返回 401", f"-> {r.status_code}")
    finally:
        for k, v in saved.items():
            if v is not None:
                os.environ[k] = v
        feishu_settings.cache_clear()


def test_login_flow() -> None:
    from app.services.pg_service import execute, query

    section("2. 配置后能生成授权地址")
    with TestClient(app) as c:
        r = c.get("/api/auth/login-url", params={"state": "nonce123", "redirect": "/datasets"})
        check(r.status_code == 200, "GET /api/auth/login-url", f"-> {r.status_code}")
        url = r.json()["data"]["url"]
        check("client_id=cli_test_app" in url, "authorize URL 含 client_id")
        check("response_type=code" in url, "authorize URL 含 response_type=code")
        check("nonce123" in url, "state 透传用于防 CSRF")

        section("3. 完整登录链路")
        r = c.post("/api/auth/feishu/callback", json={"code": "good_code", "state": "nonce123|/datasets"})
        check(r.status_code == 200, "POST /api/auth/feishu/callback", f"-> {r.status_code}")
        body = r.json()["data"]
        token = body["sessionToken"]
        user = body["user"]

        check(bool(token), "返回会话 token")
        check(user["openId"] == FAKE_USERINFO["open_id"], "用户 open_id 正确", f"-> {user['openId']}")
        check(user["name"] == "测试用户", "昵称已记录", f"-> {user['name']}")
        check(user["email"] == "test.user@example.com", "邮箱已记录")
        check(user["loginCount"] == 1, "首次登录 loginCount=1", f"-> {user['loginCount']}")
        check(body["redirect"] == "/datasets", "state 中的回跳路径被解析", f"-> {body['redirect']}")

        section("4. 会话校验与安全")
        r = c.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
        check(r.status_code == 200, "带 token 访问 /me", f"-> {r.status_code}")
        check(r.json()["data"]["user"]["name"] == "测试用户", "me 返回正确用户")

        rows = query(
            "SELECT token_hash FROM eval_sessions WHERE token_hash = %s",
            params=(auth_service.hash_token(token),), limit=1,
        )
        check(len(rows) == 1, "会话已落库（按 sha256 索引）")
        plain = query(
            "SELECT token_hash FROM eval_sessions WHERE token_hash = %s",
            params=(token,), limit=1,
        )
        check(len(plain) == 0, "库中不存在明文 token（只存哈希）")

        section("5. 重复登录累加计数")
        r2 = c.post("/api/auth/feishu/callback", json={"code": "good_code", "state": "x|/"})
        check(r2.status_code == 200, "再次登录成功", f"-> {r2.status_code}")
        cnt = r2.json()["data"]["user"]["loginCount"]
        check(cnt == 2, "loginCount 累加到 2", f"-> {cnt}")

        r = c.get("/api/auth/users")
        check(r.status_code == 200, "GET /api/auth/users", f"-> {r.status_code}")
        mine = [u for u in r.json()["data"]["users"] if u["openId"] == FAKE_USERINFO["open_id"]]
        check(len(mine) == 1, "同一 open_id 只有一条用户记录（upsert 生效）", f"-> {len(mine)} 条")

        section("6. 登出使会话失效")
        r = c.post("/api/auth/logout", headers={"Authorization": f"Bearer {token}"})
        check(r.status_code == 200, "POST /api/auth/logout", f"-> {r.status_code}")
        r = c.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
        check(r.status_code == 401, "登出后原 token 失效", f"-> {r.status_code}")

        section("7. 非法凭据被拒")
        r = c.post("/api/auth/feishu/callback", json={"code": "bad_code", "state": ""})
        check(r.status_code == 401, "无效 code 返回 401", f"-> {r.status_code}")

        section("8. 清理")
        execute("DELETE FROM eval_sessions WHERE open_id = %s", params=(FAKE_USERINFO["open_id"],))
        execute("DELETE FROM eval_users WHERE open_id = %s", params=(FAKE_USERINFO["open_id"],))
        left = query(
            "SELECT open_id FROM eval_users WHERE open_id = %s",
            params=(FAKE_USERINFO["open_id"],), limit=1,
        )
        check(len(left) == 0, "测试用户已清理")


def main() -> None:
    import os

    test_unconfigured()

    # 注入假凭据以测试后续链路
    from app.config import feishu_settings

    os.environ["FEISHU_APP_ID"] = "cli_test_app"
    os.environ["FEISHU_APP_SECRET"] = "test_secret_value"
    feishu_settings.cache_clear()

    # 替换飞书 HTTP 调用，其余逻辑全真
    auth_service.exchange_code_for_token = fake_exchange  # type: ignore[assignment]
    auth_service.fetch_userinfo = fake_userinfo  # type: ignore[assignment]

    test_login_flow()

    print(f"\n{'=' * 58}")
    print(f"通过 {PASSED} 项，失败 {FAILED} 项")
    print("=" * 58)
    sys.exit(0 if FAILED == 0 else 1)


if __name__ == "__main__":
    main()

