# -*- coding: utf-8 -*-
"""
export_failures.py —— 导出全部未通过用例清单（Markdown）
按维度分组，列出每条失败用例的扣分轮次与裁判原因，便于逐条定位修复
"""

import json
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
GOLDEN_ROOT = BASE_DIR.parent
OUTPUT_DIR = GOLDEN_ROOT / "eval_results"

DIM_ORDER = [
    ("dim_1_1", "1.1 意图识别准确率"),
    ("dim_2_1", "2.1 澄清追问准确率"),
    ("dim_3_2", "3.2 多轮上下文更新与回退"),
    ("dim_4_1", "4.1 SKILL结构合规率"),
    ("dim_4_2", "4.2 输出质量忠实度"),
    ("dim_5_1", "5.1 定向修改与内容保护率"),
    ("dim_6_1", "6.1 职责边界遵循率"),
    ("dim_6_2", "6.2 安全合规处理"),
]


def main():
    lines = ["# 黄金集评测 · 未通过用例清单", ""]
    grand_fail = 0
    for key, desc in DIM_ORDER:
        f = OUTPUT_DIR / f"summary_{key}.json"
        if not f.exists():
            continue
        reps = json.loads(f.read_text(encoding="utf-8"))
        fails = [r for r in reps if r.get("status") == "FAIL"]
        unscored = [r for r in reps if r.get("status") == "UNSCORED"]
        lines.append(f"## {key} {desc}")
        lines.append("")
        lines.append(f"- 用例总数：{len(reps)}　未通过：{len(fails)}　未打分：{len(unscored)}")
        lines.append("")
        if not fails:
            lines.append("_本维度全部用例通过。_")
            lines.append("")
            continue
        lines.append("| Case | 得分比 | 失败轮次 | 裁判原因（每轮） |")
        lines.append("| :--- | :--- | :--- | :--- |")
        for r in sorted(fails, key=lambda x: str(x.get("case_id"))):
            dsums = r.get("dimension_summary") or {}
            ratios = " / ".join(v.get("score_ratio", "-") for v in dsums.values())
            fturns = []
            reasons = []
            for v in dsums.values():
                for tl in v.get("timeline") or []:
                    if tl.get("verdict") == "FAIL":
                        fturns.append(str(tl.get("turn")))
                        reasons.append(f"T{tl.get('turn')}: {tl.get('flaw', '')}")
            lines.append(
                f"| {r.get('case_id')} | {ratios} | {'、'.join(fturns)} | "
                f"{'；'.join(reasons).replace('|', '/')} |"
            )
            grand_fail += 1
        lines.append("")

    lines.insert(2, f"**未通过用例合计：{grand_fail} 条**\n")
    out = OUTPUT_DIR / "failed_cases_report.md"
    out.write_text("\n".join(lines), encoding="utf-8")
    print(f"已生成: {out}")
    print(f"未通过用例合计: {grand_fail} 条")


if __name__ == "__main__":
    main()
