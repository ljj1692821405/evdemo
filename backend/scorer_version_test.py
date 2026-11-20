# -*- coding: utf-8 -*-
"""评分器版本管理「发布 / 回溯」端点冒烟测试。

验证点：
  1. 6 个路由已注册到 OpenAPI。
  2. 发布门禁：trial_passed=False 一律拒绝（服务端兜底，不依赖前端按钮）。
  3. append-only：同一版本号二次发布返回 409，且原快照不被覆盖。
  4. 版本列表倒序、latest 指向最新版本。
  5. diff 能识别入参与评分准绳变化。
  6. restore 只读：取回旧版本内容，不产生任何写入，draftVersion = max+1。

运行：python scorer_version_test.py
"""
from __future__ import annotations

import sys
import time

# Windows 控制台默认 GBK，强制 stdout 用 UTF-8，避免中文/✓ 触发 UnicodeEncodeError
try:
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
except Exception:  # noqa: BLE001
    pass

from fastapi.testclient import TestClient

from app.main import app
from app.services.pg_service import execute

client = TestClient(app)

# 版本写入需要 eval:write 权限 → 测试用 admin
HEADERS = {"x-user-role": "admin"}

SCORER_ID = f"sc_smoke_{int(time.time())}"

CONFIG_V1 = {
    "name": "冒烟评分器",
    "implType": "llm_judge",
    "capabilityRef": {"id": "cap_qa_judge", "version": "v3.0.0"},
    "inputs": [
        {"name": "用户诉求", "field": "user_query", "modality": "text"},
        {"name": "待评回复", "field": "agent_reply", "modality": "text"},
    ],
    "promptTemplate": "# 判定准绳\n只要命中诉求即 1 分。",
    "background": "冒烟测试背景",
    "judgeModel": "gpt-4o-mini",
    "outputs": ["5.1_定向修改成功率"],
}

CONFIG_V2 = {
    "name": "冒烟评分器",
    "implType": "llm_judge",
    "capabilityRef": {"id": "cap_qa_judge", "version": "v3.1.0"},
    "inputs": [
        {"name": "用户诉求", "field": "user_query", "modality": "text"},
        {"name": "待评回复", "field": "agent_reply", "modality": "text"},
        {"name": "参考要点", "field": "ground_truth", "modality": "text"},
    ],
    "promptTemplate": "# 判定准绳\n必须命中诉求且不越权才 1 分。",
    "background": "冒烟测试背景",
    "judgeModel": "gpt-4o-mini",
    "outputs": ["5.1_定向修改成功率"],
}


def section(title: str) -> None:
    print(f"\n{'=' * 58}\n{title}\n{'=' * 58}")


def check(cond: bool, label: str, detail: str = "") -> None:
    if not cond:
        raise AssertionError(f"{label} 失败 {detail}")
    print(f"  OK {label} {detail}")


def cleanup() -> None:
    """删掉本次冒烟产生的版本记录，保持库干净。"""
    execute("DELETE FROM eval_scorer_versions WHERE scorer_id = %s", params=(SCORER_ID,))


def main() -> int:
    section("测试 0: 健康检查")
    r = client.get("/api/health")
    check(r.status_code == 200, "GET /api/health", f"-> {r.status_code}")

    section("测试 1: 路由已注册")
    paths = client.get("/openapi.json").json().get("paths", {})
    base = "/api/scorers/{scorer_id}"
    for path, method in [
        (f"{base}/publish", "post"),
        (f"{base}/versions", "get"),
        (f"{base}/versions/latest", "get"),
        (f"{base}/versions/{{version}}", "get"),
        (f"{base}/diff", "get"),
        (f"{base}/versions/{{version}}/restore", "post"),
    ]:
        check(path in paths and method in paths[path], f"{method.upper()} {path} 已注册")

    section("测试 2: 发布门禁（未试跑通过必须拒绝）")
    r = client.post(
        f"/api/scorers/{SCORER_ID}/publish",
        json={"config": CONFIG_V1, "trial_passed": False},
        headers=HEADERS,
    )
    body = r.json()
    print(f"  -> HTTP {r.status_code}: {str(body)[:160]}")
    check(r.status_code == 400, "未通过试跑被拒绝", f"-> {r.status_code}")
    check(body.get("code") == "TRIAL_REQUIRED", "返回 TRIAL_REQUIRED", str(body.get("code")))

    section("测试 3: 发布 v1")
    r = client.post(
        f"/api/scorers/{SCORER_ID}/publish",
        json={
            "config": CONFIG_V1,
            "trial_passed": True,
            "note": "首个发布版本",
            "prompt_version": "pt_smoke@v1",
        },
        headers=HEADERS,
    )
    body = r.json()
    print(f"  -> HTTP {r.status_code}: {str(body)[:200]}")
    check(r.status_code == 200, "发布成功", f"-> {r.status_code}")
    v1 = body.get("data") or {}
    check(v1.get("version") == 1, "自动分配版本号 1", str(v1.get("version")))
    check(v1.get("trialPassed") is True, "记录 trialPassed=true")
    check((v1.get("config") or {}).get("judgeModel") == "gpt-4o-mini", "快照含完整配置")

    section("测试 4: append-only（同版本号二次发布必须 409）")
    r = client.post(
        f"/api/scorers/{SCORER_ID}/publish",
        json={"config": {**CONFIG_V1, "judgeModel": "被覆盖了吗"}, "trial_passed": True, "version": 1},
        headers=HEADERS,
    )
    body = r.json()
    print(f"  -> HTTP {r.status_code}: {str(body)[:160]}")
    check(r.status_code == 409, "重复版本被拒绝", f"-> {r.status_code}")
    check(body.get("code") == "VERSION_IMMUTABLE", "返回 VERSION_IMMUTABLE", str(body.get("code")))

    # 不可变性：再读 v1，内容必须还是发布时的样子
    r = client.get(f"/api/scorers/{SCORER_ID}/versions/1")
    check(r.status_code == 200, "GET v1 成功")
    check(
        (r.json().get("data") or {}).get("config", {}).get("judgeModel") == "gpt-4o-mini",
        "v1 内容未被覆盖",
    )

    section("测试 5: 发布 v2（改入参 / 准绳 / 能力版本）")
    r = client.post(
        f"/api/scorers/{SCORER_ID}/publish",
        json={"config": CONFIG_V2, "trial_passed": True, "note": "新增参考要点入参"},
        headers=HEADERS,
    )
    body = r.json()
    check(r.status_code == 200, "发布 v2 成功", f"-> {r.status_code}")
    check((body.get("data") or {}).get("version") == 2, "版本号为 2")

    section("测试 6: 版本列表倒序 + latest")
    r = client.get(f"/api/scorers/{SCORER_ID}/versions")
    data = r.json().get("data") or {}
    versions = [v.get("version") for v in data.get("versions", [])]
    print(f"  -> versions={versions}")
    check(versions == [2, 1], "列表为 [2, 1]（新的在前）", str(versions))

    r = client.get(f"/api/scorers/{SCORER_ID}/versions/latest")
    check((r.json().get("data") or {}).get("version") == 2, "latest 指向 v2")

    section("测试 7: 版本差异对比")
    r = client.get(f"/api/scorers/{SCORER_ID}/diff", params={"from": 1, "to": 2})
    diff = r.json().get("data") or {}
    print(f"  -> changes={[c.get('field') for c in diff.get('changes', [])]}")
    check(r.status_code == 200, "diff 成功", f"-> {r.status_code}")
    check(diff.get("identical") is False, "识别出版本不同")
    fields = {c.get("field") for c in diff.get("changes", [])}
    check("capabilityRef" in fields, "识别出绑定引擎版本变化", str(fields))
    check("promptTemplate" in fields, "识别出评分准绳变化", str(fields))
    check("inputs" in fields, "识别出入参变化", str(fields))
    added = [i.get("name") for i in (diff.get("inputs") or {}).get("added", [])]
    check(added == ["参考要点"], "新增入参被识别为「参考要点」", str(added))

    section("测试 8: 回溯（只读，不改历史）")
    r = client.post(f"/api/scorers/{SCORER_ID}/versions/1/restore", headers=HEADERS)
    payload = r.json().get("data") or {}
    check(r.status_code == 200, "restore 成功", f"-> {r.status_code}")
    restored_inputs = (payload.get("config") or {}).get("inputs", [])
    check(
        (payload.get("config") or {}).get("judgeModel") == "gpt-4o-mini" and len(restored_inputs) == 2,
        "取回的是 v1 内容（2 个入参）",
        f"inputs={len(restored_inputs)}",
    )
    check(payload.get("draftVersion") == 3, "建议新草稿版本号 3", str(payload.get("draftVersion")))

    # restore 不写库：版本总数应仍为 2
    r = client.get(f"/api/scorers/{SCORER_ID}/versions")
    total = (r.json().get("data") or {}).get("total")
    check(total == 2, "restore 未产生新版本", f"total={total}")

    section("测试 9: 权限校验（member 无 eval:write）")
    r = client.post(
        f"/api/scorers/{SCORER_ID}/publish",
        json={"config": CONFIG_V1, "trial_passed": True},
        headers={"x-user-role": "member"},
    )
    check(r.status_code == 403, "member 发布被拒绝", f"-> {r.status_code}")

    section("收尾: 清理测试数据")
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

