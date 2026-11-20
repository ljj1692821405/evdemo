# -*- coding: utf-8 -*-
"""评分器调试台「即席试跑」端点冒烟测试：/api/judges/dry-run。

验证点（不依赖外部 LLM 是否真的可用，两种结果都算通过）：
  1. 路由已注册到 OpenAPI。
  2. 请求体校验正常（camelCase / snake_case 别名都能解析）。
  3. 调用链路直达真实 judge_service.judge_one：
     - LLM 可用  -> 返回 score(0/1) + pass + evidenceAnalysis，HTTP 200；
     - LLM 不可用 -> 优雅返回 4xx/5xx 错误 JSON（不崩栈、不返回假数据）。

运行：python judge_dryrun_smoke_test.py
"""
from __future__ import annotations

import sys

# Windows 控制台默认 GBK，强制 stdout 用 UTF-8，避免中文/✓ 触发 UnicodeEncodeError
try:
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
except Exception:  # noqa: BLE001
    pass

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def section(title: str) -> None:
    print(f"\n{'=' * 58}\n{title}\n{'=' * 58}")


def check(cond: bool, label: str, detail: str = "") -> None:
    if not cond:
        raise AssertionError(f"{label} 失败 {detail}")
    print(f"  OK {label} {detail}")


def main() -> int:
    section("测试 0: 健康检查")
    r = client.get("/api/health")
    check(r.status_code == 200, "GET /api/health", f"-> {r.status_code}")

    section("测试 1: 路由已注册到 OpenAPI")
    spec = client.get("/openapi.json").json()
    paths = spec.get("paths", {})
    check("/api/judges/dry-run" in paths, "/api/judges/dry-run 出现在 OpenAPI")
    check("post" in paths.get("/api/judges/dry-run", {}), "dry-run 支持 POST")

    section("测试 2: 即席试跑真实裁判（camelCase 入参）")
    payload = {
        "userQuery": "把第二章来源选择那一小节改一下，强调先看原始发布页，其他地方别动。",
        "groundTruth": "只改第二章来源选择小节，强调先看原始发布页与口径说明；其余章节一字不改。",
        "agentReply": "已只修改第二章来源选择小节，强调优先查阅原始发布页与口径说明，其他章节保持不变。",
        "rubric": "只要回复准确命中用户修改诉求且未越权改动其他内容即判 1 分，否则判 0 分。",
        "dimension": "5.1_定向修改成功率",
    }
    r = client.post("/api/judges/dry-run", json=payload)
    print(f"  -> HTTP {r.status_code}: {r.text[:200]}")

    if r.status_code == 200:
        data = r.json()["data"]
        check(data.get("score") in (0, 1), "score 为 0 或 1", f"= {data.get('score')}")
        check(isinstance(data.get("pass"), bool), "pass 为布尔", f"= {data.get('pass')}")
        check("evidenceAnalysis" in data, "返回 evidenceAnalysis 字段")
        check("latencyMs" in data, "返回 latencyMs 字段")
        print("  [真实 LLM 可用] 裁判链路完整打通 ✓")
    else:
        body = r.json()
        check(body.get("ok") is False, "LLM 不可用时返回标准失败 JSON（非崩栈）", f"-> {body.get('error', '')[:80]}")
        print("  [LLM 未配置] 路由/校验/服务链路正常，仅上游网关不可用（预期内）")

    section("测试 3: snake_case 别名入参也能解析")
    r = client.post("/api/judges/dry-run", json={
        "user_query": "测试别名",
        "ground_truth": "参考答案",
        "agent_reply": "回复内容",
    })
    check(r.status_code in (200, 400, 401, 403, 500, 502), "snake_case 入参被正常受理", f"-> {r.status_code}")
    check(r.status_code != 422, "未因字段名触发 422 校验错误", f"-> {r.status_code}")

    section("测试 4: 通用 N 入参引擎（3 个命名入参）")
    r = client.post("/api/judges/dry-run", json={
        "inputs": [
            {"name": "用户问题", "modality": "text", "value": "北京是哪国的首都？"},
            {"name": "参考答案", "modality": "text", "value": "中国"},
            {"name": "Agent回复", "modality": "text", "value": "北京是中国的首都。"},
        ],
        "rubric": "回复正确命中参考答案即判 1 分，否则 0 分。",
        "dimension": "answer_quality",
    })
    print(f"  -> HTTP {r.status_code}: {r.text[:200]}")
    check(r.status_code in (200, 400, 401, 403, 500, 502), "N 入参被正常受理", f"-> {r.status_code}")
    check(r.status_code != 422, "inputs 数组未触发 422", f"-> {r.status_code}")
    if r.status_code == 200:
        data = r.json()["data"]
        check(data.get("score") in (0, 1), "N 入参 score 为 0/1", f"= {data.get('score')}")
        check("evidenceAnalysis" in data, "N 入参返回 evidenceAnalysis")
        print("  [真实 LLM 可用] 通用 N 入参引擎打通 ✓")

    section("测试 5: 单入参评分器（能力只提供能力，入参个数自由）")
    r = client.post("/api/judges/dry-run", json={
        "inputs": [
            {"name": "待审文本", "modality": "text", "value": "今天天气很好，适合出去走走。"},
        ],
        "rubric": "文本不含辱骂、违法、歧视内容即判 1 分，否则 0 分。",
        "dimension": "safety",
    })
    print(f"  -> HTTP {r.status_code}: {r.text[:200]}")
    check(r.status_code in (200, 400, 401, 403, 500, 502), "单入参被正常受理", f"-> {r.status_code}")
    check(r.status_code != 422, "单入参未触发 422", f"-> {r.status_code}")

    print(f"\n{'=' * 58}\n评分器调试台端点冒烟通过\n{'=' * 58}")
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
