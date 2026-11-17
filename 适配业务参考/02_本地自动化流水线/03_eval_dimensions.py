# -*- coding: utf-8 -*-
"""
黄金集【单维度专注目证评测引擎】run_dim_evaluator.py
核心设计：
1. 彻底停止与独立于仿真：基于已落盘的 156 个 sim_trajectories 轨迹文件进行纯离线评测
2. 严格按维度专评（One Dimension per Case）：
   - dim_1_1 只评 dim_1_1_intent，不评其他维度
   - dim_2_1 只评 dim_2_1_clarification
   - dim_3_2 只评 dim_3_2_context_update
   - dim_4_1 只评 dim_4_1_structure
   - dim_4_2 只评 dim_4_2_quality
   - dim_5_1 只评 dim_5_1_targeted & dim_5_2_preservation
   - dim_6_1 只评 dim_6_1_boundary
   - dim_6_2 只评 dim_6_2_safety
3. 准确按需调用裁判：
   - 纯对话/意图/安全类（1.1, 2.1, 6.1, 6.2）只调 Judge 1
   - 工作区/代码/结构/多轮修改类（3.2, 4.1, 4.2, 5.1/5.2）只调 Judge 2
4. 每轮给出大白话物证与 0/1 判定，输出专项目录
"""

import sys
import json
import argparse
import threading
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

# Windows 终端/重定向默认 GBK，遇到 emoji 会 UnicodeEncodeError，强制 UTF-8 兜底
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

BASE_DIR = Path(__file__).resolve().parent
GOLDEN_ROOT = BASE_DIR
CONFIG_PATH = GOLDEN_ROOT / "config.json"
TRAJ_DIR = GOLDEN_ROOT / "outputs" / "sim_trajectories"
OUTPUT_DIR = GOLDEN_ROOT / "eval_results"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

sys.path.insert(0, str(GOLDEN_ROOT / "evaluator"))
from judges.llm_client import JudgeLLMClient
from judges.judge1_dialogue_safety import JudgeDialogueSafety
from judges.judge2_workspace_code import JudgeWorkspaceCode, check_skill_md_structure
from judges.judge_clarification import JudgeClarificationQuality


# 维度与评测裁判映射表
DIM_CONFIG_MAP = {
    "dim_1_1": {
        "folder_pattern": "01_data/dim_1_1",
        "target_key": "dim_1_1_intent",
        "gt_key": "gt_1_1_intent",
        "judge_type": "judge1",
        "desc": "1.1 意图识别准确率"
    },
    "dim_2_1": {
        "folder_pattern": "01_data/dim_2_1",
        "target_key": "dim_2_1_clarification",
        "gt_key": "gt_2_1_clarification",
        "judge_type": "judge_clarification",
        "desc": "2.1 澄清追问准确率"
    },
    "dim_3_2": {
        "folder_pattern": "01_data/dim_3_2",
        "target_key": "dim_3_2_context_update",
        "gt_key": "gt_3_2_context_update",
        "judge_type": "judge2",
        "desc": "3.2 多轮上下文更新与回退"
    },
    "dim_4_1": {
        "folder_pattern": "01_data/dim_4_1",
        "target_key": "dim_4_1_structure",
        "gt_key": "gt_4_1_structure",
        "judge_type": "rule_and_judge2",
        "desc": "4.1 SKILL结构合规率"
    },
    "dim_4_2": {
        "folder_pattern": "01_data/dim_4_2",
        "target_key": "dim_4_2_quality",
        "gt_key": "gt_4_2_quality",
        "judge_type": "judge2",
        "desc": "4.2 输出质量忠实度"
    },
    "dim_5_1": {
        "folder_pattern": "01_data/dim_5_1",
        "target_key": ["dim_5_1_targeted", "dim_5_2_preservation"],
        "gt_key": ["gt_5_1_targeted", "gt_5_2_preservation"],
        "judge_type": "judge2",
        "desc": "5.1 定向修改与内容保护率"
    },
    "dim_6_1": {
        "folder_pattern": "01_data/dim_6_1",
        "target_key": "dim_6_1_boundary",
        "gt_key": "gt_6_1_boundary",
        "judge_type": "judge1",
        "desc": "6.1 职责边界遵循率"
    },
    "dim_6_2": {
        "folder_pattern": "01_data/dim_6_2",
        "target_key": "dim_6_2_safety",
        "gt_key": "gt_6_2_safety",
        "judge_type": "judge1",
        "desc": "6.2 安全合规处理"
    }
}


def _extract_clarification_flow(turn):
    """从轨迹轮次中提取「澄清卡挂起 → 用户选卡 → 恢复 → 写入」的闭环证据。

    裁判只看扁平的 action_sequence（如 ['askClarification','emitSkillFile']），
    无法区分「用户选完卡后才写入」与「问完就抢先写入」，会误判后者。
    这里把 suspension_rounds 里的选卡记录还原成裁判可读的事实。

    返回 dict，字段含义：
      suspended_rounds     挂起轮次总数
      clarification_answers 澄清卡的作答记录（问题/选项）
      confirm_rounds       写入确认卡（overwrite）的回答轮次
      user_answered_before_write
                           写入前是否已获得用户选卡答复（True 即合法闭环）
      write_blocked_by_confirm
                           写入是否曾被确认卡拦截
      written_paths        本轮最终写入的文件
    """
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
            clar_answers.append({
                "question": qid,
                "selected": sel,
                "custom_input": custom,
            })

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


def _is_scored(res, keys):
    if not isinstance(res, dict):
        return False
    # 裁判层显式声明为「合法豁免（N/A）」的维度不要求 0/1 分数
    exempted = set(res.get("_exempted_keys") or [])
    for k in keys:
        if k in exempted:
            continue
        obj = res.get(k)
        if not isinstance(obj, dict):
            return False
        if obj.get("score") not in (0, 1):
            return False
    return True


def _call_with_force_retry(invoke, target_keys, max_retry=3):
    """调用裁判；若目标维度未给出 0/1 分数，则带强制提示重试"""
    res = invoke()
    if _is_scored(res, target_keys):
        return res
    for attempt in range(max_retry):
        print(f"      [裁判重试 {attempt + 1}/{max_retry}] 目标维度未打分，追加强制指令重试...")
        res2 = invoke(target_keys)
        if _is_scored(res2, target_keys):
            return res2
        if isinstance(res2, dict) and res2:
            res = res2
    return res


def evaluate_case_for_dimension(case_info, dim_info, client, judge1, judge2, judge_clarify=None):
    """专门针对该 Case 所属的单一维度执行评测"""
    case_id = case_info["case_id"]
    case_path = case_info["case_file"]
    traj_path = case_info["traj_file"]

    if not traj_path or not traj_path.exists():
        return {"case_id": case_id, "status": "SKIPPED", "reason": f"未找到轨迹文件: {traj_path}"}

    case_data = json.loads(case_path.read_text(encoding="utf-8"))
    traj_data = json.loads(traj_path.read_text(encoding="utf-8"))

    turns = traj_data.get("turns", [])
    if not turns:
        return {"case_id": case_id, "status": "SKIPPED", "reason": "轨迹中无有效轮次"}

    gt_bundle = {k: case_data.get(k) for k in case_data if k.startswith("gt_")}
    turns_gt = case_data.get("turns_gt") or {}

    target_keys = dim_info["target_key"]
    if isinstance(target_keys, str):
        target_keys = [target_keys]

    turn_eval_reports = []
    print(f"\n==================================================")
    print(f"  [专注目证评测] 维度: {dim_info['desc']}")
    print(f"  用例 ID: {case_id} | 轮数: {len(turns)}")
    print(f"==================================================")

    for idx, t in enumerate(turns):
        turn_num = t.get("turn", idx + 1)
        query = t.get("query", "")
        reply = t.get("agent_reply", "")
        actions = t.get("action_sequence", [])
        ws_before = t.get("workspace_before")
        ws_after = t.get("workspace_after")
        icards = t.get("interactive_cards") or []

        print(f"  -> 审计 Turn {turn_num}/{len(turns)}...")

        turn_key = f"turn_{turn_num}"
        if turn_key in turns_gt:
            t_gt = dict(turns_gt[turn_key])
        else:
            t_gt = dict(gt_bundle)

        scores = {}
        if dim_info["judge_type"] == "judge_clarification":
            # 专属 2.1 澄清卡裁判：聚焦标题、防重复、选项可用性
            gt_clarify_req = t_gt.get("gt_2_1_clarification")
            if isinstance(gt_clarify_req, dict):
                gt_clarify_req = gt_clarify_req.get("point_1") or json.dumps(gt_clarify_req, ensure_ascii=False)

            def _invoke_clarify(_fk=None):
                r = judge_clarify.evaluate(query, icards, gt_clarification=gt_clarify_req)
                return {"dim_2_1_clarification": r.get("dim_2_1_card_quality") or {}}

            # 与其它裁判保持一致：未给出 0/1 时强制重试，避免静默落 0
            res_clarify = _call_with_force_retry(
                _invoke_clarify, ["dim_2_1_clarification"], max_retry=3
            )
            card_res = res_clarify.get("dim_2_1_clarification") or {}
            scored_ok = card_res.get("score") in (0, 1)
            scores["dim_2_1_clarification"] = {
                "score": card_res.get("score") if scored_ok else None,
                "pass": card_res.get("pass") if scored_ok else None,
                "reason": card_res.get("reason") or ("裁判未返回有效判定（已重试 3 次）" if not scored_ok else "无说明"),
                "evidence_analysis": card_res.get("evidence_analysis", ""),
                "checkpoints": card_res.get("checkpoints", {})
            }
        elif dim_info["judge_type"] == "judge1":
            flow = _extract_clarification_flow(t)
            res = _call_with_force_retry(
                lambda fk=None: judge1.evaluate(
                    user_query=query, agent_reply=reply,
                    tool_sequence=actions, gt_bundle=t_gt, force_keys=fk,
                    interaction_flow=flow
                ),
                target_keys
            )
            for k in target_keys:
                scores[k] = (res or {}).get(k)
        else:
            history_turns = turns[:idx] if idx > 0 else None
            res = _call_with_force_retry(
                lambda fk=None: judge2.evaluate(
                    workspace_before=ws_before, workspace_after=ws_after,
                    user_query=query, agent_reply=reply,
                    gt_bundle=t_gt, history_turns=history_turns, force_keys=fk
                ),
                target_keys
            )
            for k in target_keys:
                scores[k] = (res or {}).get(k)


        turn_eval_reports.append({
            "turn": turn_num,
            "user_query": query,
            "agent_reply": reply,
            "actions": actions,
            "scores": scores
        })

    # 汇总各考核维度的结论
    dim_summary = {}
    total_checks = 0
    passed_checks = 0

    for k in target_keys:
        valid_turns = 0
        passed_turns = 0
        failed_turns = []
        flaw_notes = []
        timeline = []

        for t in turn_eval_reports:
            t_num = t["turn"]
            sc_obj = t["scores"].get(k)
            if not isinstance(sc_obj, dict):
                continue
            sc = sc_obj.get("score")
            if sc not in (0, 1):
                continue
            valid_turns += 1
            total_checks += 1
            reason = sc_obj.get("reason", "")

            if sc == 1:
                passed_turns += 1
                passed_checks += 1
                timeline.append({"turn": t_num, "score": 1, "verdict": "PASS", "evidence": reason})
            else:
                failed_turns.append(t_num)
                timeline.append({"turn": t_num, "score": 0, "verdict": "FAIL", "flaw": reason})
                flaw_notes.append(f"Turn {t_num}: {reason}")

        status = "CLEAN" if len(failed_turns) == 0 and valid_turns > 0 else ("FLAW_DETECTED" if failed_turns else "N/A")
        dim_summary[k] = {
            "score_ratio": f"{passed_turns}/{valid_turns}" if valid_turns > 0 else "N/A",
            "status": status,
            "failed_turns": failed_turns,
            "flaw_brief": "；".join(flaw_notes) if flaw_notes else "全轮次达标通过",
            "timeline": timeline
        }

    overall_pass_rate = round(passed_checks / total_checks * 100, 2) if total_checks > 0 else 0.0

    if total_checks == 0:
        verdict_status = "UNSCORED"
        passed_flag = None
    else:
        verdict_status = "PASS" if passed_checks == total_checks else "FAIL"
        passed_flag = (passed_checks == total_checks)

    final_report = {
        "case_id": case_id,
        "target_dimension": dim_info["desc"],
        "source_case": str(case_path.name),
        "source_traj": str(traj_path.name),
        "overall_pass_rate": f"{overall_pass_rate}%" if total_checks > 0 else "N/A",
        "status": verdict_status,
        "passed": passed_flag,
        "check_total": total_checks,
        "check_passed": passed_checks,
        "dimension_summary": dim_summary,
        "turns": turn_eval_reports
    }

    out_file = OUTPUT_DIR / f"eval_{case_id}_{dim_info['target_key'] if isinstance(dim_info['target_key'], str) else 'targeted_preserve'}.json"
    out_file.write_text(json.dumps(final_report, ensure_ascii=False, indent=2), encoding="utf-8")
    label = f"{overall_pass_rate}%" if total_checks > 0 else "UNSCORED(未打分)"
    print(f"  [完成] 评测报告落盘: {out_file.name} | {verdict_status} {label}\n")
    return final_report


def main():
    parser = argparse.ArgumentParser(description="黄金集【单维度专注目证评测引擎】")
    parser.add_argument("--dim", type=str, default="dim_1_1", help="指定评测维度简称: dim_1_1, dim_2_1, dim_3_2, dim_4_1, dim_4_2, dim_5_1, dim_6_1, dim_6_2 / sample / all")
    parser.add_argument("--case_id", type=str, default=None, help="指定评测单个 Case ID（如 intent_0001）")
    parser.add_argument("--limit", type=int, default=None, help="每个维度的最大用例限制")
    parser.add_argument("--workers", type=int, default=4, help="并发线程数（默认 4）")
    parser.add_argument("--model", type=str, default="gpt-5.4-mini", help="裁判模型名")
    args = parser.parse_args()

    config_data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    client = JudgeLLMClient(config_data, active_model=args.model, temperature=0.0)
    judge1 = JudgeDialogueSafety(client)
    judge2 = JudgeWorkspaceCode(client)
    judge_clarify = JudgeClarificationQuality(client)

    # 全维度批量模式
    if args.dim == "all":
        print("\n🔁 启动 8 大维度全量专项评测（逐维度串行，维度内并发）...")
        board = {}
        all_reports = {}
        for dim_key, dim_info in DIM_CONFIG_MAP.items():
            reps = run_one_dimension(dim_key, args.case_id, args.limit, args.workers,
                                     client, judge1, judge2, judge_clarify) or []
            all_reports[dim_key] = reps

            case_total = len(reps)
            case_passed = sum(1 for r in reps if r.get("passed") is True)
            case_unscored = sum(1 for r in reps if r.get("status") == "UNSCORED")
            check_total = 0
            check_failed = 0
            for r in reps:
                check_total += int(r.get("check_total") or 0)
                check_passed_i = int(r.get("check_passed") or 0)
                check_failed += int(r.get("check_total") or 0) - check_passed_i
            board[dim_key] = {
                "desc": dim_info["desc"],
                "case_total": case_total,
                "case_passed": case_passed,
                "case_unscored": case_unscored,
                "check_total": check_total,
                "check_failed": check_failed,
            }

        board_path = OUTPUT_DIR / "final_board_all_dims.json"
        board_path.write_text(json.dumps(board, ensure_ascii=False, indent=2), encoding="utf-8")
        print_final_board(board)
        print(f"\n📁 各维度明细: eval_results/summary_<dim>.json  总报表: {board_path.name}")

        # 生成便于速览的 Markdown 报表
        md_lines = [
            "# 黄金集 8 维度专项评测总报",
            "",
            "| 维度代码 | 维度名称 | 用例数 | 通过 | 未打分 | 用例通过率 | 检查项 | 失败检查 |",
            "| :--- | :--- | ---: | ---: | ---: | ---: | ---: | ---: |",
        ]
        for key, info in board.items():
            scored = info["case_total"] - info.get("case_unscored", 0)
            rate = f"{info['case_passed'] / scored * 100:.1f}%" if scored else "N/A"
            md_lines.append(
                f"| {key} | {info['desc']} | {info['case_total']} | {info['case_passed']} | "
                f"{info.get('case_unscored', 0)} | {rate} | {info['check_total']} | {info['check_failed']} |"
            )
        md_path = OUTPUT_DIR / "final_board_all_dims.md"
        md_path.write_text("\n".join(md_lines), encoding="utf-8")
        print(f"📝 Markdown 报表已生成: {md_path.name}")
        return board

    # 抽样模式：8 个维度各测 1 条
    if args.dim == "sample":
        print("\n🎯 启动 8 维度各 1 条专项抽样体检...")
        summary = []
        for dim_key, dim_info in DIM_CONFIG_MAP.items():
            matched_dirs = list(GOLDEN_ROOT.glob(f"{dim_info['folder_pattern']}*"))
            if not matched_dirs:
                continue
            dim_dir = matched_dirs[0]
            cases = sorted(dim_dir.glob("case_*.json"))
            if not cases:
                continue
            target_case = cases[0]
            c_base = target_case.stem.replace("case_", "")
            candidates = [
                TRAJ_DIR / f"sim_traj_{target_case.name}",
                TRAJ_DIR / f"sim_traj_{c_base}.json",
                TRAJ_DIR / f"sim_traj_case_{c_base}.json",
            ]
            traj_path = next((cand for cand in candidates if cand.exists()), None)
            case_info = {"case_id": c_base, "case_file": target_case, "traj_file": traj_path}
            rep = evaluate_case_for_dimension(case_info, dim_info, client, judge1, judge2, judge_clarify)
            summary.append(rep)
        
        sum_path = OUTPUT_DIR / "sample_8dims_summary.json"
        sum_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"\n🏁 8 维度专项抽样体检完成！结果保存在: {sum_path.name}")
        return

    # 单维度专项
    if args.dim not in DIM_CONFIG_MAP:
        print(f"❌ 未知维度: {args.dim}，可选: {list(DIM_CONFIG_MAP.keys())}")
        return

    results = run_one_dimension(args.dim, args.case_id, args.limit, args.workers,
                                client, judge1, judge2, judge_clarify)
    return results


def run_one_dimension(dim_key, case_id_filter, limit, workers, client, judge1, judge2, judge_clarify=None):
    """跑单个维度的全部（或筛选后的）用例，返回汇总列表"""
    dim_info = DIM_CONFIG_MAP[dim_key]
    matched_dirs = list(GOLDEN_ROOT.glob(f"{dim_info['folder_pattern']}*"))
    if not matched_dirs:
        print(f"❌ 未找到对应目录: {dim_info['folder_pattern']}")
        return []

    dim_dir = matched_dirs[0]
    all_cases = sorted(dim_dir.glob("case_*.json"))
    if case_id_filter:
        all_cases = [c for c in all_cases if case_id_filter in c.name]
    if limit:
        all_cases = all_cases[:limit]

    print(f"\n{'=' * 70}")
    print(f"🚀 维度专测: [{dim_info['desc']}] | 用例 {len(all_cases)} 条 | 并发 {workers}")
    print(f"{'=' * 70}")

    tasks = []
    for c in all_cases:
        c_base = c.stem.replace("case_", "")
        candidates = [
            TRAJ_DIR / f"sim_traj_{c.name}",
            TRAJ_DIR / f"sim_traj_{c_base}.json",
            TRAJ_DIR / f"sim_traj_case_{c_base}.json",
        ]
        traj_path = next((cand for cand in candidates if cand.exists()), None)
        tasks.append({"case_id": c_base, "case_file": c, "traj_file": traj_path})

    dim_summary_list = []
    lock = threading.Lock()

    def _worker(case_info):
        try:
            rep = evaluate_case_for_dimension(case_info, dim_info, client, judge1, judge2, judge_clarify)

            with lock:
                print(f"  [OK] {case_info['case_id']} -> {rep.get('overall_pass_rate')}")
            return rep
        except Exception as e:
            with lock:
                print(f"  [ERR] {case_info['case_id']} -> {e}")
            return {"case_id": case_info["case_id"], "status": "ERROR", "reason": str(e)}

    if workers <= 1:
        for ci in tasks:
            dim_summary_list.append(_worker(ci))
    else:
        with ThreadPoolExecutor(max_workers=workers) as ex:
            futures = [ex.submit(_worker, ci) for ci in tasks]
            for fut in as_completed(futures):
                dim_summary_list.append(fut.result())

    dim_summary_list.sort(key=lambda r: str(r.get("case_id", "")))
    sum_path = OUTPUT_DIR / f"summary_{dim_key}.json"
    sum_path.write_text(json.dumps(dim_summary_list, ensure_ascii=False, indent=2), encoding="utf-8")

    ok_cnt = sum(1 for r in dim_summary_list if r.get("passed") is True)
    unscored_cnt = sum(1 for r in dim_summary_list if r.get("status") == "UNSCORED")
    print(f"\n🏁 [{dim_info['desc']}] 完成: 通过 {ok_cnt}/{len(dim_summary_list)} 条"
          f"（未打分 {unscored_cnt} 条）| 汇总 -> {sum_path.name}")
    return dim_summary_list


def print_final_board(board):
    """打印 8 维度总报表"""
    print("\n" + "=" * 96)
    print("📊 黄金集 8 维度专项评测总报（一个 Case 只评其所属维度）")
    print("=" * 96)
    print(f"{'维度代码':<10} {'维度名称':<22} {'用例':>4} {'通过':>4} {'未打分':>6} {'通过率':>8} {'检查项':>6} {'失败检查':>8}")
    print("-" * 96)
    total_cases = 0
    total_ok = 0
    total_unscored = 0
    total_checks = 0
    total_failed_checks = 0
    for key, info in board.items():
        total_cases += info["case_total"]
        total_ok += info["case_passed"]
        total_unscored += info.get("case_unscored", 0)
        total_checks += info["check_total"]
        total_failed_checks += info["check_failed"]
        scored = info["case_total"] - info.get("case_unscored", 0)
        rate = f"{info['case_passed'] / scored * 100:.1f}%" if scored else "N/A"
        print(f"{key:<10} {info['desc']:<22} {info['case_total']:>4} {info['case_passed']:>4} "
              f"{info.get('case_unscored', 0):>6} {rate:>8} {info['check_total']:>6} {info['check_failed']:>8}")
    print("-" * 96)
    scored_all = total_cases - total_unscored
    overall = f"{total_ok / scored_all * 100:.1f}%" if scored_all else "N/A"
    print(f"{'合计':<10} {'8 大维度':<22} {total_cases:>4} {total_ok:>4} {total_unscored:>6} "
          f"{overall:>8} {total_checks:>6} {total_failed_checks:>8}")
    print("=" * 96)


if __name__ == "__main__":
    main()
