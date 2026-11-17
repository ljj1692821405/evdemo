# -*- coding: utf-8 -*-
"""
把「适配业务参考」里的仿真轨迹与评测结果压缩成前端演示用的 lib/real/demo.json。
用法：python3 scripts/build-demo-data.py
"""
import glob
import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REF = os.path.join(ROOT, "适配业务参考")
OUT = os.path.join(ROOT, "lib", "real", "demo.json")

DROP_INPUTS = {"user_query", "agent_reply", "has_workspace_after", "interactive_cards", "metadata_diff"}


def workspace_text(ws):
    if not isinstance(ws, dict):
        return ""
    files = [f for f in ws.get("files") or [] if isinstance(f, dict)]
    if len(files) == 1:
        return files[0].get("content") or ""
    return "\n\n".join("===== %s =====\n%s" % (f.get("path"), f.get("content") or "") for f in files)


def workspace_meta(before, after):
    out = []
    for key in ("displayName", "skillName", "description"):
        b = (before or {}).get(key)
        a = (after or {}).get(key)
        if b != a:
            out.append({"key": key, "before": str(b or ""), "after": str(a or "")})
    return out


def points(value):
    if value is None:
        return []
    if isinstance(value, str):
        return [value] if value.strip() else []
    if isinstance(value, list):
        return [str(v) for v in value]
    if isinstance(value, dict):
        return [v if isinstance(v, str) else json.dumps(v, ensure_ascii=False) for v in value.values()]
    return [str(value)]


def cards_of(turn):
    cards = {}
    for source in [r.get("clarification_cards") or [] for r in turn.get("suspension_rounds") or []] + [turn.get("interactive_cards") or []]:
        for c in source:
            qid = c.get("question_id") or c.get("card_id")
            if not qid or (qid in cards and cards[qid]["options"]):
                continue
            cards[qid] = {
                "title": c.get("title") or "",
                "options": [
                    {"id": o.get("option_id"), "label": o.get("label") or "", "recommended": bool(o.get("is_recommended"))}
                    for o in c.get("options") or []
                ],
                "selected": [],
            }
    for r in turn.get("suspension_rounds") or []:
        body = r.get("resume_body") or {}
        if body.get("type") != "clarification":
            continue
        for a in (body.get("answer") or {}).get("answers") or []:
            card = cards.get(a.get("questionId"))
            if not card:
                continue
            labels = {o["id"]: o["label"] for o in card["options"]}
            card["selected"] = [labels.get(i, i) for i in a.get("selectedOptionIds") or []]
    return [
        {"title": c["title"], "options": [{"label": o["label"], "recommended": o["recommended"]} for o in c["options"]], "selected": c["selected"]}
        for c in cards.values()
    ]


def write_confirmed(turn):
    for r in turn.get("suspension_rounds") or []:
        body = r.get("resume_body") or {}
        if body.get("type") == "overwrite":
            return bool((body.get("answer") or {}).get("confirmed"))
    return False


def main():
    evals = {}
    for path in glob.glob(os.path.join(REF, "05_eval_results", "*.json")):
        data = json.load(open(path, encoding="utf-8"))
        evals[data["source_traj"]] = data

    judges = {}
    cases = []
    for path in sorted(glob.glob(os.path.join(REF, "04_sim_demo", "*.json"))):
        traj = json.load(open(path, encoding="utf-8"))
        ev = evals.get(os.path.basename(path))
        ev_turns = {t["turn"]: t for t in (ev or {}).get("turns") or []}
        labels = {
            k: v
            for k, v in traj.items()
            if isinstance(v, (str, int, float, bool)) and k not in ("case_id", "legacy_id")
        }
        turns = []
        for t in traj["turns"]:
            no = t["turn"]
            et = ev_turns.get(no) or {}
            trace = et.get("judge_trace") or {}
            if trace.get("judge") and trace["judge"] not in judges:
                judges[trace["judge"]] = {
                    "label": trace.get("judge_label") or trace["judge"],
                    "promptFile": trace.get("prompt_file") or "",
                    "systemPrompt": trace.get("system_prompt") or "",
                }
            inputs = {k: v for k, v in (trace.get("input_data") or {}).items() if k not in DROP_INPUTS and not k.startswith("gt_")}
            gt = (traj.get("turns_gt") or {}).get("turn_%d" % no) or {}
            turns.append(
                {
                    "turn": no,
                    "query": t.get("query") or "",
                    "agentReply": t.get("agent_reply") or "",
                    "status": t.get("status") or "",
                    "latency": t.get("latency") or {},
                    "actions": t.get("action_sequence") or [],
                    "cards": cards_of(t),
                    "writeConfirm": (t.get("write_confirm") or {}).get("title"),
                    "writeConfirmed": write_confirmed(t),
                    "fileOps": [{"path": f.get("path"), "op": f.get("op"), "chars": len(f.get("content") or "")} for f in t.get("file_actions") or []],
                    "wsBefore": workspace_text(t.get("workspace_before")),
                    "wsAfter": workspace_text(t.get("workspace_after")),
                    "wsMeta": workspace_meta(t.get("workspace_before"), t.get("workspace_after")),
                    "gt": {k: points(v) for k, v in gt.items()},
                    "judge": trace.get("judge"),
                    "skipped": bool(trace.get("skipped")),
                    "skipReason": trace.get("skip_reason") or "",
                    "scores": {
                        k: (None if v is None else {"pass": bool(v.get("pass")), "reason": v.get("reason") or "", "evidence": v.get("evidence_analysis") or ""})
                        for k, v in (et.get("scores") or {}).items()
                    },
                    "inputs": inputs,
                }
            )
        cases.append(
            {
                "caseId": traj["case_id"],
                "sessionId": (traj.get("simulation_meta") or {}).get("sessionId") or "",
                "runTime": (traj.get("simulation_meta") or {}).get("run_time") or "",
                "labels": labels,
                "dimensions": traj.get("activated_dimensions") or [],
                "eval": None
                if not ev
                else {
                    "target": ev.get("target_dimension") or "",
                    "passed": bool(ev.get("passed")),
                    "checkTotal": ev.get("check_total") or 0,
                    "checkPassed": ev.get("check_passed") or 0,
                    "summary": {
                        k: {"failedTurns": v.get("failed_turns") or [], "flawBrief": v.get("flaw_brief") or ""}
                        for k, v in (ev.get("dimension_summary") or {}).items()
                    },
                },
                "turns": turns,
            }
        )

    def read(rel):
        return open(os.path.join(REF, rel), encoding="utf-8").read()

    eval_src = read("02_本地自动化流水线/03_eval_dimensions.py")
    flow = re.search(r"^def _extract_clarification_flow\(.*?(?=^def )", eval_src, re.S | re.M)
    scripts = {
        "workspace_diff": read("03_evaluator/judges/workspace_diff.py"),
        "section_radar": read("03_evaluator/judges/section_radar.py"),
        "temporal_tracker": read("03_evaluator/judges/temporal_tracker.py"),
        "interaction_flow": flow.group(0).rstrip() if flow else "",
    }

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"judges": judges, "scripts": scripts, "cases": cases}, f, ensure_ascii=False, separators=(",", ":"))
    print("cases", len(cases), "judges", list(judges), "bytes", os.path.getsize(OUT))


if __name__ == "__main__":
    main()
