# -*- coding: utf-8 -*-
"""租户隔离验证：真实 PostgreSQL，验证跨组织数据不可见、不可改、不可删。"""
from __future__ import annotations

import sys
import uuid

from fastapi.testclient import TestClient

from app.main import app

AGENT = "ag_skill"
ORG_A = "org_alpha"
ORG_B = "org_beta"
LINE_1 = "pl_heyreel"
LINE_2 = "pl_doc"
AGENT_2 = "ag_doc_qa"


def hdr(org: str, agent: str = AGENT, line: str = LINE_1) -> dict[str, str]:
    return {"x-org-id": org, "x-agent-id": agent, "x-product-line-id": line}


def section(t: str) -> None:
    print(f"\n{'=' * 58}\n{t}\n{'=' * 58}")


def check(cond: bool, label: str, detail: str = "") -> None:
    if not cond:
        raise AssertionError(f"{label} 失败 {detail}")
    print(f"  OK {label} {detail}")


def main() -> int:
    c = TestClient(app)
    suffix = uuid.uuid4().hex[:6]
    ds_a, ds_b = f"ds_a_{suffix}", f"ds_b_{suffix}"
    case_a = f"case_a_{suffix}"

    section("1. 请求头解析")
    r = c.get("/api/tenant/context", headers=hdr(ORG_A))
    body = r.json()["data"]
    check(body["org_id"] == ORG_A and body["agent_id"] == AGENT, "x-org-id 生效", str(body))
    r = c.get("/api/tenant/context")
    check(r.json()["data"]["org_id"] == "default", "无请求头回落 default")

    section("2. 各建一个数据集")
    r = c.post("/api/datasets", headers=hdr(ORG_A), json={
        "id": ds_a, "name": "A 组织数据集", "agentId": AGENT,
    })
    check(r.status_code == 200, "组织 A 创建数据集")
    r = c.post("/api/datasets", headers=hdr(ORG_B), json={
        "id": ds_b, "name": "B 组织数据集", "agentId": AGENT,
    })
    check(r.status_code == 200, "组织 B 创建数据集")

    c.post(f"/api/datasets/{ds_a}/cases", headers=hdr(ORG_A), json={
        "agentId": AGENT,
        "cases": [{"id": case_a, "query": ["A 的私有数据"], "valid": True}],
    })

    section("3. 列表隔离")
    ids_a = {d["id"] for d in c.get("/api/datasets", headers=hdr(ORG_A)).json()["data"]["datasets"]}
    ids_b = {d["id"] for d in c.get("/api/datasets", headers=hdr(ORG_B)).json()["data"]["datasets"]}
    check(ds_a in ids_a and ds_b not in ids_a, "A 看不到 B 的数据集")
    check(ds_b in ids_b and ds_a not in ids_b, "B 看不到 A 的数据集")

    section("4. Case 隔离")
    cases_b = c.get(f"/api/cases?agent_id={AGENT}", headers=hdr(ORG_B)).json()["data"]["cases"]
    check(not any(x["id"] == case_a for x in cases_b), "B 看不到 A 的 case")
    cases_a = c.get(f"/api/cases?agent_id={AGENT}", headers=hdr(ORG_A)).json()["data"]["cases"]
    check(any(x["id"] == case_a for x in cases_a), "A 能看到自己的 case")

    section("5. 跨租户删除被拒")
    r = c.delete(f"/api/datasets/{ds_b}", headers=hdr(ORG_A))
    check(r.status_code == 404, "A 删 B 的数据集 -> 404", f"-> {r.status_code}")
    r = c.delete(f"/api/cases/{case_a}", headers=hdr(ORG_B))
    check(r.status_code == 404, "B 删 A 的 case -> 404", f"-> {r.status_code}")

    section("6. 任务隔离")
    flow_id = f"flow_t_{suffix}"
    c.post("/api/flows", headers=hdr(ORG_A), json={
        "flow_id": flow_id, "name": "A 流程", "org_id": ORG_A,
        "input_schema": {"required_fields": ["q"]},
        "simulation_config": {"api_url": "http://x", "timeout": 1},
        "output_schema": {"display_fields": []},
    })
    r = c.post("/api/tasks", headers=hdr(ORG_A), json={
        "flow_id": flow_id, "input_data": [{"q": "1"}], "org_id": ORG_A,
    })
    task_id = r.json()["data"]["task_id"]
    r = c.get(f"/api/tasks/{task_id}", headers=hdr(ORG_B))
    check(r.status_code == 404, "B 查 A 的任务 -> 404", f"-> {r.status_code}")
    r = c.get(f"/api/tasks/{task_id}", headers=hdr(ORG_A))
    check(r.status_code == 200, "A 能查自己的任务")

    section("7. 同一组织内的产线隔离")
    ds_line1 = f"ds_l1_{suffix}"
    ds_line2 = f"ds_l2_{suffix}"
    c.post("/api/datasets", headers=hdr(ORG_A, AGENT, LINE_1), json={
        "id": ds_line1, "name": "产线1 数据集", "agentId": AGENT,
    })
    c.post("/api/datasets", headers=hdr(ORG_A, AGENT, LINE_2), json={
        "id": ds_line2, "name": "产线2 数据集", "agentId": AGENT,
    })
    ids_l1 = {d["id"] for d in c.get("/api/datasets", headers=hdr(ORG_A, AGENT, LINE_1)).json()["data"]["datasets"]}
    ids_l2 = {d["id"] for d in c.get("/api/datasets", headers=hdr(ORG_A, AGENT, LINE_2)).json()["data"]["datasets"]}
    check(ds_line1 in ids_l1 and ds_line2 not in ids_l1, "产线1 看不到产线2 的数据集")
    check(ds_line2 in ids_l2 and ds_line1 not in ids_l2, "产线2 看不到产线1 的数据集")

    section("8. 同一产线内的 Agent 隔离")
    ds_agent2 = f"ds_a2_{suffix}"
    c.post("/api/datasets", headers=hdr(ORG_A, AGENT_2, LINE_1), json={
        "id": ds_agent2, "name": "Agent2 数据集", "agentId": AGENT_2,
    })
    ids_ag1 = {d["id"] for d in c.get("/api/datasets", headers=hdr(ORG_A, AGENT, LINE_1)).json()["data"]["datasets"]}
    ids_ag2 = {d["id"] for d in c.get("/api/datasets", headers=hdr(ORG_A, AGENT_2, LINE_1)).json()["data"]["datasets"]}
    check(ds_agent2 in ids_ag2 and ds_agent2 not in ids_ag1, "Agent1 看不到 Agent2 的数据集")
    check(ds_line1 in ids_ag1 and ds_line1 not in ids_ag2, "Agent2 看不到 Agent1 的数据集")

    section("9. 同 Agent 内不做用户级隔离")
    u1 = {**hdr(ORG_A, AGENT, LINE_1), "x-user-id": "user_zhang"}
    u2 = {**hdr(ORG_A, AGENT, LINE_1), "x-user-id": "user_li"}
    ids_u1 = {d["id"] for d in c.get("/api/datasets", headers=u1).json()["data"]["datasets"]}
    ids_u2 = {d["id"] for d in c.get("/api/datasets", headers=u2).json()["data"]["datasets"]}
    check(ids_u1 == ids_u2 and ds_line1 in ids_u1, "不同用户看到同一份数据（设计如此）")

    section("10. 流程配置同样隔离")
    flow_l1 = f"flow_l1_{suffix}"
    c.post("/api/flows", headers=hdr(ORG_A, AGENT, LINE_1), json={
        "flow_id": flow_l1, "name": "产线1 流程",
        "input_schema": {"required_fields": ["q"]},
        "simulation_config": {"api_url": "http://x", "timeout": 1},
        "output_schema": {"display_fields": []},
    })
    flows_l1 = {f["flow_id"] for f in c.get("/api/flows", headers=hdr(ORG_A, AGENT, LINE_1)).json()["data"]["flows"]}
    flows_l2 = {f["flow_id"] for f in c.get("/api/flows", headers=hdr(ORG_A, AGENT, LINE_2)).json()["data"]["flows"]}
    check(flow_l1 in flows_l1 and flow_l1 not in flows_l2, "流程配置按产线隔离")
    r = c.get(f"/api/flows/{flow_l1}", headers=hdr(ORG_A, AGENT, LINE_2))
    check(r.status_code == 404, "跨产线读取流程详情 -> 404", f"-> {r.status_code}")

    section("11. 清理")
    check(c.delete(f"/api/datasets/{ds_a}", headers=hdr(ORG_A)).status_code == 200, "清理 A 数据集")
    check(c.delete(f"/api/datasets/{ds_b}", headers=hdr(ORG_B)).status_code == 200, "清理 B 数据集")
    check(c.delete(f"/api/flows/{flow_id}", headers=hdr(ORG_A)).status_code == 200, "清理 A 流程")
    c.delete(f"/api/datasets/{ds_line1}", headers=hdr(ORG_A, AGENT, LINE_1))
    c.delete(f"/api/datasets/{ds_line2}", headers=hdr(ORG_A, AGENT, LINE_2))
    c.delete(f"/api/datasets/{ds_agent2}", headers=hdr(ORG_A, AGENT_2, LINE_1))
    c.delete(f"/api/flows/{flow_l1}", headers=hdr(ORG_A, AGENT, LINE_1))

    print(f"\n{'=' * 58}\n租户隔离验证通过\n{'=' * 58}")
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
