# -*- coding: utf-8 -*-
"""
rebuild_board.py —— 从各维度 summary_*.json 重新汇总生成 8 维度总报
用途：局部补跑某个维度后，无需全量重跑即可刷新总账
"""

import json
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
GOLDEN_ROOT = BASE_DIR
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
    board = {}
    for key, desc in DIM_ORDER:
        f = OUTPUT_DIR / f"summary_{key}.json"
        if not f.exists():
            continue
        reps = json.loads(f.read_text(encoding="utf-8"))
        case_total = len(reps)
        case_passed = sum(1 for r in reps if r.get("passed") is True)
        case_unscored = sum(1 for r in reps if r.get("status") == "UNSCORED")
        check_total = sum(int(r.get("check_total") or 0) for r in reps)
        check_passed = sum(int(r.get("check_passed") or 0) for r in reps)
        board[key] = {
            "desc": desc,
            "case_total": case_total,
            "case_passed": case_passed,
            "case_unscored": case_unscored,
            "check_total": check_total,
            "check_passed": check_passed,
            "check_failed": check_total - check_passed,
        }

    (OUTPUT_DIR / "final_board_all_dims.json").write_text(
        json.dumps(board, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    lines = [
        "# 黄金集 8 维度专项评测总报",
        "",
        "评测口径：一个 Case 只评其所属的单一维度（分桶专项）。",
        "",
        "| 维度代码 | 维度名称 | 用例数 | 通过 | 未打分 | 用例通过率 | 检查项 | 失败检查 |",
        "| :--- | :--- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    tot = dict(case_total=0, case_passed=0, case_unscored=0, check_total=0, check_passed=0, check_failed=0)
    for key, info in board.items():
        scored = info["case_total"] - info["case_unscored"]
        rate = f"{info['case_passed'] / scored * 100:.1f}%" if scored else "N/A"
        lines.append(
            f"| {key} | {info['desc']} | {info['case_total']} | {info['case_passed']} | "
            f"{info['case_unscored']} | {rate} | {info['check_total']} | {info['check_failed']} |"
        )
        for k in tot:
            tot[k] += info[k]
    scored_all = tot["case_total"] - tot["case_unscored"]
    overall = f"{tot['case_passed'] / scored_all * 100:.1f}%" if scored_all else "N/A"
    lines.append(
        f"| **合计** | **8 大维度** | **{tot['case_total']}** | **{tot['case_passed']}** | "
        f"**{tot['case_unscored']}** | **{overall}** | **{tot['check_total']}** | **{tot['check_failed']}** |"
    )
    (OUTPUT_DIR / "final_board_all_dims.md").write_text("\n".join(lines), encoding="utf-8")

    print(f"{'维度':<10} {'用例':>4} {'通过':>4} {'未打分':>6} {'通过率':>8} {'检查项':>6} {'失败':>5}")
    print("-" * 60)
    for key, info in board.items():
        scored = info["case_total"] - info["case_unscored"]
        rate = f"{info['case_passed'] / scored * 100:.1f}%" if scored else "N/A"
        print(f"{key:<10} {info['case_total']:>4} {info['case_passed']:>4} {info['case_unscored']:>6} "
              f"{rate:>8} {info['check_total']:>6} {info['check_failed']:>5}")
    print("-" * 60)
    print(f"{'合计':<10} {tot['case_total']:>4} {tot['case_passed']:>4} {tot['case_unscored']:>6} "
          f"{overall:>8} {tot['check_total']:>6} {tot['check_failed']:>5}")
    print("\n已更新: final_board_all_dims.json / final_board_all_dims.md")


if __name__ == "__main__":
    main()
