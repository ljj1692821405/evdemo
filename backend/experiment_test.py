# -*- coding: utf-8 -*-
"""实验管理端点冒烟测试：/api/experiments/...

验证点：
  1. 路由已注册。
  2. 创建实验时校验 scorerRefs 版本存在——引用不存在版本整体拒绝 400。
  3. 引用已发布版本可成功创建；snapshot_id 必填。
  4. /resolved 能把引用解析成完整版本快照。
  5. 创建 run 后实验状态 draft → running。
  6. update run 可回写结果；get run 读回。
  7. 路由顺序：/runs/{run_id} 不被 /{experiment_id} 吞掉。
  8. 权限：member 无 eval:write → 403。

运行：python experiment_test.py
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

STAMP = int(time.time())
SCORER_ID = f"sc_exp_{STAMP}"
EXP_ID = f"exp_smoke_{STAMP}"

SCORER_CONFIG = {
    "name": "实验用评分器",
    "implType": "llm_judge",
    "capabilityRef": {"id": "cap_qa_judge", "version": "v3.0.0"},
    "inputs": [{"name": "待评回复", "field": "agent_reply", "modality": "text"}],
    "promptTemplate": "# 准绳\n命中即 1 分。",
    "judgeModel": "gpt-4o-mini",
    "outputs": ["answer_quality"],
}


def section(title: str) -> None:
    print(f"\n{'=' * 58}\n{title}\n{'=' * 58}")


def check(cond: bool, label: str, detail: str = "") -> None:
    if not cond:
        raise AssertionError(f"{label} 失败 {detail}")
    print(f"  OK {label} {detail}")


def cleanup() -> None:
    execute("DELETE FROM eval_experiments WHERE experiment_id = %s", params=(EXP_ID,))
    execute("DELETE FROM eval_scorer_versions WHERE scorer_id = %s", params=(SCORER_ID,))


def main() -> int:
    cleanup()  # 防止上次残留

    section("准备: 发布一个评分器 v1")
    r = client.post(
        f"/api/scorers/{SCORER_ID}/publish",
        json={"config": SCORER_CONFIG, "trial_passed": True},
        headers=HEADERS,
    )
    check(r.status_code == 200, "评分器 v1 发布成功", f"-> {r.status_code}")

    section("测试 1: 路由已注册")
    paths = client.get("/openapi.json").json().get("paths", {})
    for path, method in [
        ("/api/experiments", "post"),
        ("/api/experiments", "get"),
        ("/api/experiments/{experiment_id}", "get"),
        ("/api/experiments/{experiment_id}/resolved", "get"),
        ("/api/experiments/{experiment_id}/runs", "post"),
        ("/api/experiments/runs/{run_id}", "get"),
    ]:
        check(path in paths and method in paths[path], f"{method.upper()} {path} 已注册")

    section("测试 2: 引用不存在的版本必须整体拒绝")
    r = client.post(
        "/api/experiments",
        json={"name": "坏实验", "scorer_refs": [{"id": SCORER_ID, "version": 999}], "snapshot_id": "snap_x"},
        headers=HEADERS,
    )
    body = r.json()
    print(f"  -> HTTP {r.status_code}: {str(body)[:160]}")
    check(r.status_code == 400, "缺版本被拒绝", f"-> {r.status_code}")
    check(body.get("code") == "SCORER_VERSION_MISSING", "返回 SCORER_VERSION_MISSING")

    section("测试 3: snapshot_id 必填")
    r = client.post(
        "/api/experiments",
        json={"name": "无快照", "scorer_refs": [{"id": SCORER_ID, "version": 1}]},
        headers=HEADERS,
    )
    check(r.status_code == 400, "缺 snapshot_id 被拒绝", f"-> {r.status_code}")

    section("测试 4: 正常创建实验")
    r = client.post(
        "/api/experiments",
        json={
            "experiment_id": EXP_ID,
            "name": "冒烟实验",
            "scorer_refs": [{"id": SCORER_ID, "version": 1}],
            "snapshot_id": "snap_smoke",
            "field_dict_version": "fd_v1",
            "weights": {"answer_quality": 1.0},
        },
        headers=HEADERS,
    )
    body = r.json()
    check(r.status_code == 200, "创建成功", f"-> {r.status_code}")
    exp = body.get("data") or {}
    check(exp.get("experimentId") == EXP_ID, "实验 ID 正确")
    check(exp.get("status") == "draft", "初始状态 draft")
    check(exp.get("scorerRefs") == [{"id": SCORER_ID, "version": 1}], "引用已写入", str(exp.get("scorerRefs")))

    section("测试 5: /resolved 解析版本快照")
    r = client.get(f"/api/experiments/{EXP_ID}/resolved")
    data = r.json().get("data") or {}
    resolved = data.get("resolvedScorers") or []
    check(r.status_code == 200, "resolved 成功", f"-> {r.status_code}")
    check(len(resolved) == 1, "解析出 1 个评分器")
    check((resolved[0].get("config") or {}).get("judgeModel") == "gpt-4o-mini", "快照含完整配置")

    section("测试 6: 创建 run → 实验状态变 running")
    r = client.post(f"/api/experiments/{EXP_ID}/runs", json={"units": 5}, headers=HEADERS)
    run = r.json().get("data") or {}
    run_id = run.get("runId")
    check(r.status_code == 200, "创建 run 成功", f"-> {r.status_code}")
    check(run.get("status") == "queued", "run 初始 queued")
    check(bool(run_id), "返回 runId", str(run_id))

    r = client.get(f"/api/experiments/{EXP_ID}")
    check((r.json().get("data") or {}).get("status") == "running", "实验状态已变 running")

    section("测试 7: 回写结果 + 路由顺序（/runs/{run_id} 不被吞）")
    r = client.put(
        f"/api/experiments/runs/{run_id}",
        json={"status": "completed", "done_units": 5, "cost": "¥0.18",
              "summary": {"pass": 4, "total": 5, "rate": 0.8}, "finished": True},
        headers=HEADERS,
    )
    updated = r.json().get("data") or {}
    check(r.status_code == 200, "update run 成功", f"-> {r.status_code}")
    check(updated.get("status") == "completed", "状态 completed")
    check((updated.get("summary") or {}).get("rate") == 0.8, "结果已落库")

    r = client.get(f"/api/experiments/runs/{run_id}")
    got = r.json().get("data") or {}
    check(r.status_code == 200, "get run 成功（路由未被吞）", f"-> {r.status_code}")
    check(got.get("doneUnits") == 5, "doneUnits 读回正确")
    check(bool(got.get("finishedAt")), "finishedAt 已写入")

    section("测试 8: 实验列表 + 运行列表")
    r = client.get("/api/experiments")
    ids = [e.get("experimentId") for e in (r.json().get("data") or {}).get("experiments", [])]
    check(EXP_ID in ids, "实验出现在列表中")

    r = client.get(f"/api/experiments/{EXP_ID}/runs")
    check((r.json().get("data") or {}).get("total") == 1, "运行列表有 1 条")

    section("测试 9: 权限校验")
    r = client.post(
        "/api/experiments",
        json={"name": "x", "scorer_refs": [{"id": SCORER_ID, "version": 1}], "snapshot_id": "s"},
        headers={"x-user-role": "member"},
    )
    check(r.status_code == 403, "member 创建被拒绝", f"-> {r.status_code}")

    section("收尾: 清理")
    cleanup()
    print("  已删除本次冒烟数据")
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

