# -*- coding: utf-8 -*-
"""真实端到端冒烟测试：真实 PostgreSQL + 真实 FastAPI（TestClient 走完整 HTTP 栈）。

运行：python e2e_smoke_test.py
"""
from __future__ import annotations

import sys
import uuid

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)
AGENT_ID = "ag_skill"


def section(title: str) -> None:
    print(f"\n{'=' * 58}\n{title}\n{'=' * 58}")


def check(cond: bool, label: str, detail: str = "") -> None:
    if not cond:
        raise AssertionError(f"{label} 失败 {detail}")
    print(f"  OK {label} {detail}")


def main() -> int:
    suffix = uuid.uuid4().hex[:6]
    ds_id = f"ds_e2e_{suffix}"
    case_id = f"case_e2e_{suffix}"
    flow_id = f"flow_e2e_{suffix}"

    section("测试 0: 健康检查")
    r = client.get("/api/health")
    check(r.status_code == 200, "GET /api/health", f"-> {r.status_code}")

    section("Week 1: 流程配置 API（真实 PG）")
    payload = {
        "flow_id": flow_id,
        "name": "E2E 测试流程",
        "description": "冒烟测试创建",
        "version": "1.0",
        "org_id": "default",
        "input_schema": {"required_fields": ["user_query"], "optional_fields": []},
        "simulation_config": {"api_url": "http://localhost:8080/simulate", "timeout": 120},
        "output_schema": {"display_fields": [{"name": "result", "source_path": "result", "type": "string"}]},
        "created_by": "e2e",
    }
    r = client.post("/api/flows", json=payload)
    check(r.status_code == 200, "POST /api/flows", r.text[:120])

    r = client.get(f"/api/flows/{flow_id}")
    check(r.status_code == 200 and r.json()["data"]["flow_id"] == flow_id, "GET /api/flows/{id}")

    r = client.get("/api/flows")
    check(r.status_code == 200 and any(f["flow_id"] == flow_id for f in r.json()["data"]["flows"]), "GET /api/flows 列表")

    r = client.put(f"/api/flows/{flow_id}", json={"description": "冒烟测试更新"})
    check(r.status_code == 200, "PUT /api/flows/{id}")

    r = client.post("/api/flows", json=payload)
    check(r.status_code == 400, "重复创建被拒（400）", f"-> {r.status_code}")

    section("数据集 / Case API（前端联调链路）")
    r = client.post("/api/datasets", json={
        "id": ds_id, "name": "E2E 数据集", "agentId": AGENT_ID,
        "version": "v1", "tags": ["e2e"], "defaultGt": False,
    })
    check(r.status_code == 200 and r.json()["data"]["id"] == ds_id, "POST /api/datasets", r.text[:120])

    r = client.post(f"/api/datasets/{ds_id}/cases", json={
        "agentId": AGENT_ID,
        "cases": [{
            "id": case_id,
            "query": ["帮我生成一个故事大纲", "把主角改成女性"],
            "tags": ["多轮"],
            "workspaceSize": "1.2 KB",
            "gtSource": "case",
            "gtKeys": ["outline"],
            "valid": True,
            "raw": {"turn": 2},
        }],
    })
    check(r.status_code == 200 and r.json()["data"]["added"] == 1, "POST /api/datasets/{id}/cases", r.text[:120])

    r = client.get(f"/api/datasets?agent_id={AGENT_ID}")
    mine = next((d for d in r.json()["data"]["datasets"] if d["id"] == ds_id), None)
    check(mine is not None and mine["caseCount"] == 1, "GET /api/datasets 含 caseCount=1")

    r = client.get(f"/api/cases?agent_id={AGENT_ID}")
    c = next((x for x in r.json()["data"]["cases"] if x["id"] == case_id), None)
    check(c is not None and c["query"][1] == "把主角改成女性", "GET /api/cases 内容回读正确")

    fresh = TestClient(app)
    r = fresh.get(f"/api/cases?agent_id={AGENT_ID}")
    check(any(x["id"] == case_id for x in r.json()["data"]["cases"]), "刷新后数据仍存在（持久化生效）")

    section("Week 2: 任务 / 结果 API（真实 PG）")
    r = client.post("/api/tasks", json={
        "flow_id": flow_id,
        "input_data": [{"user_query": "测试 1"}, {"user_query": "测试 2"}],
        "org_id": "default",
        "created_by": "e2e",
    })
    check(r.status_code == 200, "POST /api/tasks", r.text[:120])
    task_id = r.json()["data"]["task_id"]

    r = client.get(f"/api/tasks/{task_id}")
    body = r.json()["data"]
    check(r.status_code == 200 and body["total_cases"] == 2 and body["progress"] == 0, "GET /api/tasks/{id} 进度=0%")

    r = client.get("/api/tasks")
    check(any(t["task_id"] == task_id for t in r.json()["data"]["tasks"]), "GET /api/tasks 列表")

    r = client.get("/api/results")
    check(r.status_code == 200, "GET /api/results", r.text[:120])

    section("清理测试数据")
    check(client.delete(f"/api/cases/{case_id}").status_code == 200, "DELETE /api/cases/{id}")
    check(client.delete(f"/api/datasets/{ds_id}").status_code == 200, "DELETE /api/datasets/{id}")
    check(client.delete(f"/api/flows/{flow_id}").status_code == 200, "DELETE /api/flows/{id}")
    client.delete(f"/api/tasks/{task_id}")

    print(f"\n{'=' * 58}\n全部通过（真实 PostgreSQL）\n{'=' * 58}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except AssertionError as exc:
        print(f"\nFAILED: {exc}")
        sys.exit(1)
    except Exception:  # noqa: BLE001
        import traceback
        traceback.print_exc()
        sys.exit(1)
