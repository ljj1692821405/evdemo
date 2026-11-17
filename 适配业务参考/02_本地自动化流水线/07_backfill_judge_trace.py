# -*- coding: utf-8 -*-
"""
07_backfill_judge_trace.py —— 把「裁判的提示词 + 送进裁判的输入字段」回填到评测报告

背景：
    评测时送给裁判的 system_prompt 与 input_data 此前没有被落盘，
    导致核查台只能看到裁判的结论，看不到它到底看了什么、被要求怎么判。

做法（重要）：
    本脚本 **不调用裁判模型、不修改任何分数**。
    它用与 03_eval_dimensions.py 完全相同的取数逻辑和裁判的 build_payload()，
    把当时的输入确定性地重建出来，写入每份 eval_*.json 的 turns[].judge_trace。
    因此分数与结论保持原样，只是把「判分依据」补全。

用法：
    python -X utf8 07_backfill_judge_trace.py                # 回填全部
    python -X utf8 07_backfill_judge_trace.py --dim dim_2_1  # 只回填某维度
    python -X utf8 07_backfill_judge_trace.py --dry-run      # 只看统计不写盘
"""

import sys
import json
import argparse
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

BASE_DIR = Path(__file__).resolve().parent
GOLDEN_ROOT = BASE_DIR
TRAJ_DIR = GOLDEN_ROOT / "outputs" / "sim_trajectories"
OUTPUT_DIR = GOLDEN_ROOT / "eval_results"

sys.path.insert(0, str(GOLDEN_ROOT / "evaluator"))
from judges.judge1_dialogue_safety import JudgeDialogueSafety
from judges.judge2_workspace_code import JudgeWorkspaceCode
from judges.judge_clarification import JudgeClarificationQuality

# 维度表与 03_eval_dimensions.py 保持一致（仅取回填所需字段）
DIM_CONFIG_MAP = {
    "dim_1_1": {"target_key": "dim_1_1_intent", "judge_type": "judge1"},
    "dim_2_1": {"target_key": "dim_2_1_clarification", "judge_type": "judge_clarification"},
    "dim_3_2": {"target_key": "dim_3_2_context_update", "judge_type": "judge2"},
    "dim_4_1": {"target_key": "dim_4_1_structure", "judge_type": "judge2"},
    "dim_4_2": {"target_key": "dim_4_2_quality", "judge_type": "judge2"},
    "dim_5_1": {"target_key": ["dim_5_1_targeted", "dim_5_2_preservation"], "judge_type": "judge2"},
    "dim_6_1": {"target_key": "dim_6_1_boundary", "judge_type": "judge1"},
    "dim_6_2": {"target_key": "dim_6_2_safety", "judge_type": "judge1"},
}

DIM_DESC = {
    "dim_1_1": "1.1 意图识别准确率", "dim_2_1": "2.1 澄清追问准确率",
    "dim_3_2": "3.2 多轮上下文更新与回退", "dim_4_1": "4.1 SKILL结构合规率",
    "dim_4_2": "4.2 输出质量忠实度", "dim_5_1": "5.1 定向修改与内容保护率",
    "dim_6_1": "6.1 职责边界遵循率", "dim_6_2": "6.2 安全合规处理",
}

JUDGE_LABELS = {
    "judge1": "裁判一：对话交互与安全",
    "judge2": "裁判二：工作区内容与结构",
    "judge_clarification": "裁判三：澄清卡内容质量",
}

PROMPT_FILES = {
    "judge1": "judge1_dialogue_safety.md",
    "judge2": "judge2_workspace_diff.md",
    "judge_clarification": "judge_clarification.md",
}



def extract_clarification_flow(turn):
    """与 03_eval_dimensions.py 的 _extract_clarification_flow 保持完全一致"""
    rounds = turn.get("suspension_rounds") or []
    clar_answers = []
    confirm_rounds = 0

    for r in rounds:
        body = (r.get("resume_body") or {})
        rtype = body.get("type")
        answer = (body.get("answer") or {})
        answers = answer.get("answers") or []

        if rtype == "overwrite":
            confirm_rounds += 1
            continue
        if rtype != "clarification":
            continue
        for a in answers:
            qid = a.get("questionId") or a.get("question_id") or a.get("cardId") or a.get("card_id")
            sel = (a.get("selectedOptionIds") or a.get("selected_option_ids")
                   or a.get("selected") or a.get("optionIds"))
            custom = a.get("customInput") or a.get("custom_input")
            clar_answers.append({"question": qid, "selected": sel, "custom_input": custom})

    actions = turn.get("action_sequence") or []
    asked = "askClarification" in actions
    wrote = "emitSkillFile" in actions

    return {
        "suspended_rounds": len(rounds),
        "clarification_answers": clar_answers,
        "confirm_rounds": confirm_rounds,
        "clarification_answered": bool(clar_answers),
        "user_answered_before_write": bool(asked and wrote and clar_answers),
        "write_blocked_by_confirm": bool(turn.get("write_blocked_by_confirm")),
        "written_paths": [f.get("path") for f in (turn.get("file_actions") or []) if f.get("path")],
    }


def find_case_file(case_id):
    base = case_id.replace("case_", "")
    for pattern in (f"01_data/dim_*/case_{base}.json", f"dim_*/case_{base}.json"):
        for cand in GOLDEN_ROOT.glob(pattern):
            return cand
    return None


def find_traj_file(case_id):
    base = case_id.replace("case_", "")
    for name in (f"sim_traj_{base}.json", f"sim_traj_case_{base}.json"):
        f = TRAJ_DIR / name
        if f.exists():
            return f
    for f in TRAJ_DIR.glob("*.json"):
        if base in f.name:
            return f
    return None


def _pack(judge_type, payload, extra_trace=False):
    """把 build_payload 的产出整理成写进 JSON 的 judge_trace 结构"""
    trace = {
        "judge": judge_type,
        "judge_label": JUDGE_LABELS[judge_type],
        "prompt_file": f"evaluator/prompts/{PROMPT_FILES[judge_type]}",
        "system_prompt": payload["system_prompt"],
        "user_prompt": payload["user_prompt"],
        "input_data": payload["input_data"],
        "force_keys": payload.get("force_keys") or [],
        "skipped": bool(payload.get("skipped")),
        "skip_reason": payload.get("skip_reason") or "",
    }
    if extra_trace and payload.get("trace"):
        trace["trace"] = payload["trace"]
    return trace



def backfill_one(eval_data, eval_path, dim_key, judges):
    """为一份评测报告的每一轮补上 judge_trace；就地修改 eval_data，不触碰分数"""
    dim_info = DIM_CONFIG_MAP[dim_key]
    case_id = eval_data.get("case_id")
    if not case_id:
        return 0, "无 case_id"

    case_path = find_case_file(case_id)
    traj_path = find_traj_file(case_id)
    if not case_path or not traj_path:
        return 0, "缺少 case 或轨迹文件"

    case_data = json.loads(case_path.read_text(encoding="utf-8"))
    traj_data = json.loads(traj_path.read_text(encoding="utf-8"))
    turns = traj_data.get("turns") or []
    if not turns:
        return 0, "轨迹无轮次"

    gt_bundle = {k: case_data.get(k) for k in case_data if k.startswith("gt_")}
    turns_gt = case_data.get("turns_gt") or {}

    target_keys = dim_info["target_key"]
    if isinstance(target_keys, str):
        target_keys = [target_keys]

    by_turn = {t.get("turn"): t for t in turns}
    filled = 0

    for report in eval_data.get("turns") or []:
        tn = report.get("turn")
        raw = by_turn.get(tn)
        if raw is None:
            continue

        query = raw.get("query", "")
        reply = raw.get("agent_reply", "")
        actions = raw.get("action_sequence", [])
        icards = raw.get("interactive_cards") or []
        ws_before = raw.get("workspace_before")
        ws_after = raw.get("workspace_after")

        t_gt = dict(turns_gt[f"turn_{tn}"]) if f"turn_{tn}" in turns_gt else dict(gt_bundle)
        judge_type = dim_info["judge_type"]

        if judge_type == "judge_clarification":
            gt_req = t_gt.get("gt_2_1_clarification")
            if isinstance(gt_req, dict):
                gt_req = gt_req.get("point_1") or json.dumps(gt_req, ensure_ascii=False)
            p = judges["clarify"].build_payload(query, icards, gt_clarification=gt_req)
            report["judge_trace"] = _pack("judge_clarification", p)

        elif judge_type == "judge1":
            flow = extract_clarification_flow(raw)
            p = judges["judge1"].build_payload(
                user_query=query, agent_reply=reply,
                tool_sequence=actions, gt_bundle=t_gt,
                force_keys=target_keys, interaction_flow=flow,
            )
            # 交互闭环事实单独带出，核查台可独立展示
            tr = _pack("judge1", p)
            tr["interaction_flow"] = flow
            report["judge_trace"] = tr

        else:  # judge2（含 4.1/4.2/5.1/3.2）
            history = turns[:tn - 1] if tn > 1 else None
            p = judges["judge2"].build_payload(
                workspace_before=ws_before, workspace_after=ws_after,
                user_query=query, agent_reply=reply,
                gt_bundle=t_gt, history_turns=history, force_keys=target_keys,
            )
            report["judge_trace"] = _pack("judge2", p, extra_trace=True)

        filled += 1

    return filled, "ok"



def main():
    ap = argparse.ArgumentParser(description="回填裁判提示词与输入字段（不重跑打分）")
    ap.add_argument("--dim", default=None, help="只回填指定维度，如 dim_2_1")
    ap.add_argument("--dry-run", action="store_true", help="只看统计，不写盘")
    args = ap.parse_args()

    # build_payload 不发请求，llm_client 传 None 即可
    judges = {
        "judge1": JudgeDialogueSafety(None),
        "judge2": JudgeWorkspaceCode(None),
        "clarify": JudgeClarificationQuality(None),
    }

    dims = [args.dim] if args.dim else list(DIM_CONFIG_MAP)
    want_desc = {DIM_DESC[d] for d in dims if d in DIM_DESC}

    total_cases = total_turns = 0
    per_dim = {}
    skipped = []

    for ef in sorted(OUTPUT_DIR.glob("eval_*.json")):
        try:
            d = json.loads(ef.read_text(encoding="utf-8"))
        except Exception as e:
            skipped.append(f"{ef.name}: 解析失败 {e}")
            continue

        desc = d.get("target_dimension", "")
        if desc not in want_desc:
            continue
        dim_key = next((k for k, v in DIM_DESC.items() if v == desc), None)
        if not dim_key:
            continue

        filled, reason = backfill_one(d, ef, dim_key, judges)
        if filled:
            total_cases += 1
            total_turns += filled
            per_dim[dim_key] = per_dim.get(dim_key, 0) + 1
            if not args.dry_run:
                ef.write_text(json.dumps(d, ensure_ascii=False, indent=2), encoding="utf-8")
        else:
            skipped.append(f"{ef.name}: {reason}")

    for k in sorted(per_dim):
        print(f"  [{k}] 已回填 {per_dim[k]} 个用例")

    print(f"\n合计回填 {total_cases} 个用例 / {total_turns} 轮")
    if skipped:
        print(f"跳过 {len(skipped)} 个：")
        for s in skipped[:10]:
            print("  -", s)
    if args.dry_run:
        print("\n（dry-run，未写盘）")
    else:
        print("\n完成。请运行 python 04_build_review_html.py 重新生成核查台。")


if __name__ == "__main__":
    main()
