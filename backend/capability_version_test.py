# -*- coding: utf-8 -*-
"""能力版本管理端点冒烟测试：/api/capabilities/{id}/...

验证点：
  1. 6 个路由已注册。
  2. 发布 v1.0.0 成功；重复发布同版本 409（append-only）。
  3. 不传 version 时自动推导 v2.0.0。
  4. latest 指向最新版本。
  5. diff 能识别输出契约变化并标记 breaking。
  6. restore 只读返回旧版内容，nextVersion = v3.0.0。
  7. member 无 eval:write → 403。

运行：python capability_version_test.py
"""
from __future__ import annotations

import sys
import time

try:
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
except Exception:  # noqa: BLE001
    pass

from fastapi.testclient import TestClient

from app.main import app
from app.services.pg_service import execute

client = TestClient(app)
HEADERS = {"x-user-role": "admin"}

CAP_ID = f"cap_smoke_{int(time.time())}"

CONFIG_V1 = {
    "name": "冒烟能力",
    "executionType": "llm_chat",
    "entrypoint": "",
    "model": "gpt-4o-mini",
    "scenario": "通用问答",
    "outputSchema": {"fields": [{"key": "text", "type": "string"}]},
}

CONFIG_V2 = {
    "name": "冒烟能力",
    "executionType": "llm_chat",
    "entrypoint": "",
    "model": "gpt-4o",
    "scenario": "通用问答",
    "outputSchema": {"fields": [{"key": "text", "type": "string"}, {"key": "score", "type": "number"}]},
}


def section(title: str) -> None:
    print(f"\n{'=' * 58}\n{title}\n{'=' * 58}")


def check(cond: bool, label: str, detail: str = "") -> None:
    if not cond:
        raise AssertionError(f"{label} 失败 {detail}")
    print(f"  OK {label} {detail}")


def cleanup() -> None:
    execute("DELETE FROM eval_capability_versions WHERE capability_id = %s", params=(CAP_ID,))


def main() -> int:
    section("测试 0: 健康检查")
    r = client.get("/api/health")
    check(r.status_code == 200, "GET /api/health", f"-> {r.status_code}")

    section("测试 1: 路由已注册")
    paths = client.get("/openapi.json").json().get("paths", {})
    base = "/api/capabilities/{capability_id}"
    for path, method in [
        (f"{base}/publish", "post"),
        (f"{base}/versions", "get"),
        (f"{base}/versions/latest", "get"),
        (f"{base}/versions/{{version}}", "get"),
        (f"{base}/diff", "get"),
        (f"{base}/versions/{{version}}/restore", "post"),
    ]:
        check(path in paths and method in paths[path], f"{method.upper()} {path} 已注册")

    section("测试 2: 发布 v1.0.0")
    r = client.post(
        f"/api/capabilities/{CAP_ID}/publish",
        json={"config": CONFIG_V1, "version": "v1.0.0"},
        headers=HEADERS,
    )
    body = r.json()
    print(f"  -> HTTP {r.status_code}: {str(body)[:160]}")
    check(r.status_code == 200, "发布成功", f"-> {r.status_code}")
    check((body.get("data") or {}).get("version") == "v1.0.0", "版本号 v1.0.0")
    check((body.get("data") or {}).get("executionType") == "llm_chat", "记录执行类型")

    section("测试 3: append-only（重复发布同版本 409）")
    r = client.post(
        f"/api/capabilities/{CAP_ID}/publish",
        json={"config": {**CONFIG_V1, "model": "被覆盖了吗"}, "version": "v1.0.0"},
        headers=HEADERS,
    )
    check(r.status_code == 409, "重复版本被拒绝", f"-> {r.status_code}")
    check(r.json().get("code") == "VERSION_IMMUTABLE", "返回 VERSION_IMMUTABLE")

    r = client.get(f"/api/capabilities/{CAP_ID}/versions/v1.0.0")
    check(
        (r.json().get("data") or {}).get("config", {}).get("model") == "gpt-4o-mini",
        "v1.0.0 内容未被覆盖",
    )

    section("测试 4: 不传 version 自动推导下一版本")
    r = client.post(
        f"/api/capabilities/{CAP_ID}/publish",
        json={"config": CONFIG_V2},
        headers=HEADERS,
    )
    body = r.json()
    check(r.status_code == 200, "发布成功", f"-> {r.status_code}")
    check((body.get("data") or {}).get("version") == "v2.0.0", "自动推导为 v2.0.0", str((body.get("data") or {}).get("version")))

    section("测试 5: latest")
    r = client.get(f"/api/capabilities/{CAP_ID}/versions/latest")
    check((r.json().get("data") or {}).get("version") == "v2.0.0", "latest 指向 v2.0.0")

    section("测试 6: 版本差异（breaking）")
    r = client.get(f"/api/capabilities/{CAP_ID}/diff", params={"from": "v1.0.0", "to": "v2.0.0"})
    diff = r.json().get("data") or {}
    fields = {c.get("field") for c in diff.get("changes", [])}
    print(f"  -> changes={sorted(fields)} breaking={diff.get('breaking')}")
    check(r.status_code == 200, "diff 成功", f"-> {r.status_code}")
    check("outputSchema" in fields, "识别出输出契约变化", str(fields))
    check("model" in fields, "识别出默认模型变化", str(fields))
    check(diff.get("breaking") is True, "标记为 breaking")

    section("测试 7: 回溯（只读）")
    r = client.post(f"/api/capabilities/{CAP_ID}/versions/v1.0.0/restore", headers=HEADERS)
    payload = r.json().get("data") or {}
    check(r.status_code == 200, "restore 成功", f"-> {r.status_code}")
    check((payload.get("config") or {}).get("model") == "gpt-4o-mini", "取回 v1.0.0 内容")
    check(payload.get("nextVersion") == "v3.0.0", "下一版本建议 v3.0.0", str(payload.get("nextVersion")))

    r = client.get(f"/api/capabilities/{CAP_ID}/versions")
    check((r.json().get("data") or {}).get("total") == 2, "restore 未产生新版本")

    section("测试 8: 权限校验")
    r = client.post(
        f"/api/capabilities/{CAP_ID}/publish",
        json={"config": CONFIG_V1, "version": "v9.9.9"},
        headers={"x-user-role": "member"},
    )
    check(r.status_code == 403, "member 发布被拒绝", f"-> {r.status_code}")

    section("收尾: 清理")
    cleanup()
    print("  已删除本次冒烟产生的版本记录")
    print("\n全部通过 ✅")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    finally:
        try:
            cleanup()
        except Exception as exc:  # noqa: BLE001
            print(f"[warn] 清理失败：{exc}")
