# -*- coding: utf-8 -*-
"""
build_review_html.py —— 生成人工核查用的离线单文件 HTML 核查台

设计目标（针对"工作区内容太多、人工看不清改了哪里"的痛点）：
1. 左栏用例清单：按维度分组，默认只看失败；支持搜索、键盘上下切换
2. 右栏逐轮卡片：用户原话 / Agent 回复 / 工具调用 / **工作区精准行级 diff** / 裁判结论
3. 未发生改动的文件折叠成一行，只把真正变动的 hunk 展开
4. 可勾选「只看被扣分轮次」，直接跳到问题点
5. 人工复核结论可一键导出 JSON

用法：
    python -X utf8 build_review_html.py
产物：
    eval_results/review_report.html   （双击即可用浏览器打开，无需服务器）
"""

import json
import difflib
import hashlib
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
GOLDEN_ROOT = BASE_DIR
OUTPUT_DIR = GOLDEN_ROOT / "eval_results"
TRAJ_DIR = GOLDEN_ROOT / "outputs" / "sim_trajectories"


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

CTX = 3            # diff 上下文行数


def _files_map(ws):
    """把 workspace 结构压成 {path: content}"""
    if not isinstance(ws, dict):
        return {}
    out = {}
    for f in ws.get("files") or []:
        if isinstance(f, dict) and f.get("path"):
            out[f["path"]] = f.get("content") or ""
    return out


def _diff_rows(old_lines, new_lines, ctx=CTX):
    """基于 SequenceMatcher 生成带行号的 diff 行，仅保留变更处 ±ctx 行"""
    sm = difflib.SequenceMatcher(None, old_lines, new_lines, autojunk=False)
    rows = []
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            for k in range(i2 - i1):
                rows.append([" ", i1 + k + 1, j1 + k + 1, old_lines[i1 + k]])
        else:
            if tag in ("replace", "delete"):
                for k in range(i1, i2):
                    rows.append(["-", k + 1, None, old_lines[k]])
            if tag in ("replace", "insert"):
                for k in range(j1, j2):
                    rows.append(["+", None, k + 1, new_lines[k]])

    keep = set()
    for idx, r in enumerate(rows):
        if r[0] != " ":
            keep.update(range(max(0, idx - ctx), min(len(rows), idx + ctx + 1)))

    compact, skipped = [], 0
    for idx, r in enumerate(rows):
        if idx in keep:
            if skipped:
                compact.append(["~", skipped, None, f"⋯ 此处 {skipped} 行未改动"])
                skipped = 0
            compact.append(r)
        else:
            skipped += 1
    if skipped:
        compact.append(["~", skipped, None, f"⋯ 此处 {skipped} 行未改动"])
    return compact
def build_workspace_diff(turn):
    """产出本轮工作区变更摘要 + 逐文件 diff"""
    before = _files_map(turn.get("workspace_before"))
    after = _files_map(turn.get("workspace_after"))

    files = []
    added_total = deleted_total = 0

    for path in sorted(set(before) | set(after)):
        b, a = before.get(path), after.get(path)

        if b is None and a is not None:
            lines = [["+", None, i + 1, ln] for i, ln in enumerate(a.splitlines())]
            files.append({"path": path, "status": "added", "add": len(lines), "del": 0, "rows": lines})
            added_total += len(lines)

        elif a is None and b is not None:
            lines = [["-", i + 1, None, ln] for i, ln in enumerate(b.splitlines())]
            files.append({"path": path, "status": "deleted", "add": 0, "del": len(lines), "rows": lines})
            deleted_total += len(lines)

        elif b == a:
            files.append({"path": path, "status": "same", "add": 0, "del": 0,
                          "rows": [], "line_total": len((b or "").splitlines())})

        else:
            rows = _diff_rows(b.splitlines(), a.splitlines())
            add = sum(1 for r in rows if r[0] == "+")
            dele = sum(1 for r in rows if r[0] == "-")
            files.append({"path": path, "status": "modified", "add": add, "del": dele, "rows": rows})
            added_total += add
            deleted_total += dele

    meta_diff = []
    wb = turn.get("workspace_before") or {}
    wa = turn.get("workspace_after") or {}
    for key, label in [("skillName", "Skill Name"), ("displayName", "Display Name"), ("description", "Description")]:
        vb, va = wb.get(key), wa.get(key)
        if vb != va:
            meta_diff.append({"field": key, "label": label, "before": vb, "after": va, "changed": True})
        elif vb is not None or va is not None:
            meta_diff.append({"field": key, "label": label, "before": vb, "after": va, "changed": False})

    ref_files = [f for f in files if "reference" in f["path"].lower()]

    # 完整内容前后对照：SKILL 与 References 分开
    def _pair(path):
        b, a = before.get(path), after.get(path)
        if b is None and a is not None:
            st = "added"
        elif a is None and b is not None:
            st = "deleted"
        elif b == a:
            st = "same"
        else:
            st = "modified"
        return {
            "path": path,
            "status": st,
            "before": b,
            "after": a,
            "before_lines": len(b.splitlines()) if b is not None else 0,
            "after_lines": len(a.splitlines()) if a is not None else 0,
            "before_chars": len(b) if b is not None else 0,
            "after_chars": len(a) if a is not None else 0,
        }

    all_paths = sorted(set(before) | set(after))
    skill_pairs = [_pair(p) for p in all_paths if p.lower().endswith("skill.md")]
    ref_pairs = [_pair(p) for p in all_paths if "reference" in p.lower()]

    return {
        "files": files,
        "add": added_total,
        "del": deleted_total,
        "changed_files": sum(1 for f in files if f["status"] != "same"),
        "has_workspace": bool(before or after),
        "meta_diff": meta_diff,
        "meta_changed": any(m["changed"] for m in meta_diff),
        "ref_files": ref_files,
        "ref_changed": any(rf["status"] != "same" for rf in ref_files),
        "skill_pairs": skill_pairs,
        "ref_pairs": ref_pairs,
    }


def build_cards(cards):
    """精简澄清卡结构，只保留人工核对需要的字段（标题/模式/选项/推荐项）"""
    out = []
    for c in cards or []:
        if not isinstance(c, dict):
            continue
        opts = []
        for o in c.get("options") or []:
            if not isinstance(o, dict):
                continue
            opts.append({
                "id": o.get("option_id"),
                "label": o.get("label") or "",
                "desc": o.get("description") or "",
                "recommended": bool(o.get("is_recommended")),
            })
        out.append({
            "card_id": c.get("card_id"),
            "title": c.get("title") or "",
            "mode": c.get("selection_mode") or "single",
            "allow_custom_input": bool(c.get("allow_custom_input")),
            "step_index": c.get("step_index"),
            "step_total": c.get("step_total"),
            "options": opts,
        })
    return out


def build_write_confirm(wc, susp_rounds=None):
    """精简写入确认卡结构，并附上仿真器实际做出的选择"""
    if not isinstance(wc, dict) or not wc:
        return None

    # 从挂起轮次里找出 overwrite 类型的作答（仿真代答结果）
    chosen = None
    for r in susp_rounds or []:
        if not isinstance(r, dict):
            continue
        rb = r.get("resume_body") or {}
        if rb.get("type") != "overwrite":
            continue
        ans = rb.get("answer") or {}
        if "confirmed" in ans:
            chosen = {
                "confirmed": bool(ans.get("confirmed")),
                "round": r.get("round"),
                "status": r.get("status") or "",
            }
            break

    if chosen is not None:
        confirm_label = wc.get("confirmLabel") or "确认写入"
        decline_label = wc.get("declineLabel") or "先不写入"
        chosen["label"] = confirm_label if chosen["confirmed"] else decline_label

    return {
        "title": wc.get("title") or "文件写入确认",
        "confirm_label": wc.get("confirmLabel") or "",
        "decline_label": wc.get("declineLabel") or "",
        "affected_paths": wc.get("affectedPaths") or [],
        "chosen": chosen,
    }


def build_judge_trace(jt):
    """精简裁判轨迹结构：保留提示词全文与输入字段，供核查台展开查看。

    体积控制：输入字段里那些超长文本（Agent 回复、Diff 切片、骨架雷达）原样保留，
    它们是判分依据，删了就没法复核；整体由页面折叠承载，不占首屏。
    """
    if not isinstance(jt, dict) or not jt:
        return None

    return {
        "judge": jt.get("judge") or "",
        "judge_label": jt.get("judge_label") or "",
        "prompt_file": jt.get("prompt_file") or "",
        "system_prompt": jt.get("system_prompt") or "",
        "user_prompt": jt.get("user_prompt") or "",
        "input_data": jt.get("input_data"),
        "force_keys": jt.get("force_keys") or [],
        "skipped": bool(jt.get("skipped")),
        "skip_reason": jt.get("skip_reason") or "",
        "interaction_flow": jt.get("interaction_flow"),
        "trace": jt.get("trace"),
    }


def build_case(dim_key, dim_desc, summary_rep):
    """合并 评测报告 + 轨迹 + 原始 case，产出单个 case 的核查数据"""
    case_id = summary_rep.get("case_id")
    if not case_id:
        return None

    base = case_id.replace("case_", "")
    eval_files = [f for f in OUTPUT_DIR.glob(f"eval_{base}_*.json")]
    if not eval_files:
        return None
    eval_data = json.loads(sorted(eval_files)[0].read_text(encoding="utf-8"))

    # 定位原始 case（用文件名，不用 case_id 字段，避免 case_ 前缀不一致）
    # 兼容两种布局：01_data/dim_* 与根目录 dim_*
    case_path = None
    for pattern in (f"01_data/dim_*/case_{base}.json", f"dim_*/case_{base}.json"):
        for cand in GOLDEN_ROOT.glob(pattern):
            case_path = cand
            break
        if case_path:
            break
    case_data = {}
    case_rel = ""
    if case_path:
        case_data = json.loads(case_path.read_text(encoding="utf-8"))
        case_rel = str(case_path.relative_to(GOLDEN_ROOT)).replace("\\", "/")
    turns_gt = case_data.get("turns_gt") or {}

    traj = None
    for name in (f"sim_traj_{base}.json", f"sim_traj_case_{base}.json"):
        f = TRAJ_DIR / name
        if f.exists():
            traj = json.loads(f.read_text(encoding="utf-8"))
            break
    if traj is None:
        for f in TRAJ_DIR.glob("*.json"):
            if base in f.name:
                traj = json.loads(f.read_text(encoding="utf-8"))
                break

    traj_turns = {t.get("turn"): t for t in ((traj or {}).get("turns") or [])}

    dim_summary = eval_data.get("dimension_summary") or {}
    fail_turns = set()
    for v in dim_summary.values():
        for tn in v.get("failed_turns") or []:
            fail_turns.add(str(tn))

    turns = []
    for t in eval_data.get("turns") or []:
        tn = t.get("turn")
        raw = traj_turns.get(tn, {})
        wdiff = build_workspace_diff(raw) if raw else None

        scores = []
        for k, obj in (t.get("scores") or {}).items():
            if isinstance(obj, dict) and obj.get("score") in (0, 1):
                scores.append({"key": k, "score": obj.get("score"),
                               "reason": obj.get("reason") or "",
                               "evidence": obj.get("evidence_analysis") or ""})
            else:
                scores.append({"key": k, "score": None, "reason": "本轮未激活（N/A）", "evidence": ""})

        turn_gt_raw = (turns_gt.get(f"turn_{tn}") or {})
        gt_data = {}
        for k, v in turn_gt_raw.items():
            if k != "human_review" and v is not None:
                gt_data[k] = v

        turns.append({
            "turn": tn,
            "query": t.get("user_query") or "",
            "reply": t.get("agent_reply") or "",
            "actions": t.get("actions") or [],
            "file_actions": [{"path": fa.get("path"), "op": fa.get("op"),
                              "size": len(fa.get("content") or "")}
                             for fa in (raw.get("file_actions") or [])],
            "gt": gt_data,
            "scores": scores,
            "failed": str(tn) in fail_turns,
            "workspace": wdiff,
            # 交互卡片：澄清卡与写入确认卡（来自轨迹回填，供人工核对卡片内容）
            "interactive_cards": build_cards(raw.get("interactive_cards")),
            "write_confirm": build_write_confirm(raw.get("write_confirm"), raw.get("suspension_rounds")),
            # 裁判的提示词与送进裁判的输入字段（来自 07_backfill_judge_trace.py 回填）
            "judge_trace": build_judge_trace(t.get("judge_trace")),
            # 回填过的历史人工标注（用于页面回显）
            "existing_review": turn_gt_raw.get("human_review"),
        })

    return {
        "id": base,
        "case_file": case_rel,
        "dim": dim_key,
        "dim_desc": dim_desc,
        "status": eval_data.get("status") or summary_rep.get("status"),
        "passed": eval_data.get("passed"),
        "rate": eval_data.get("overall_pass_rate"),
        "check_total": eval_data.get("check_total"),
        "check_passed": eval_data.get("check_passed"),
        "dim_summary": dim_summary,
        "turns": turns,
    }


def main():
    cases = []
    for dim_key, dim_desc in DIM_ORDER:
        f = OUTPUT_DIR / f"summary_{dim_key}.json"
        if not f.exists():
            print(f"[跳过] 缺少 {f.name}")
            continue
        reps = json.loads(f.read_text(encoding="utf-8"))
        for r in reps:
            c = build_case(dim_key, dim_desc, r)
            if c:
                cases.append(c)
        print(f"[{dim_key}] 已载入 {sum(1 for c in cases if c['dim'] == dim_key)} 条")

    total_turns = sum(len(c["turns"]) for c in cases)
    print(f"\n合计 {len(cases)} 条用例 / {total_turns} 轮")

    # 模板位于 evaluator/ 下；兼容早期放在根目录的布局
    template_candidates = [
        BASE_DIR / "evaluator" / "review_template.html",
        BASE_DIR / "review_template.html",
    ]
    tpl_path = next((p for p in template_candidates if p.exists()), None)
    if tpl_path is None:
        raise FileNotFoundError(
            "未找到 review_template.html，已尝试: "
            + ", ".join(str(p) for p in template_candidates)
        )
    template = tpl_path.read_text(encoding="utf-8")
    payload = json.dumps(cases, ensure_ascii=False, separators=(",", ":"))
    payload = payload.replace("</script>", "<\\/script>")

    # 批次指纹：由数据内容决定，与生成时间无关。
    # 同一批数据重跑生成 → 指纹相同（保留人工标记）；数据变了 → 指纹变化（自动隔离）。
    batch_id = hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]

    html = template.replace("/*__DATA__*/", payload)
    # 首次构建内嵌空的标记容器；"下载带标记的 HTML" 会替换它
    html = html.replace("/*__VOTES__*/", "{}")
    # 把批次指纹写到 data 属性上，供页面读取
    html = html.replace(
        '<script id="DATA" type="application/json">',
        f'<script id="DATA" type="application/json" data-batch="{batch_id}">',
    )

    out = OUTPUT_DIR / "review_report.html"
    out.write_text(html, encoding="utf-8")
    print(f"批次指纹: {batch_id}")
    print(f"已生成: {out}  ({out.stat().st_size / 1024 / 1024:.2f} MB)")
    print("双击用浏览器打开即可，无需启动服务。")


if __name__ == "__main__":
    main()

