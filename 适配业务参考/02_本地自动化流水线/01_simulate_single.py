# -*- coding: utf-8 -*-
"""
自动推进仿真执行引擎 (01_simulate_auto_resume.py)
特性：
  1. 默认开启 auto_first 自动推进模式（遇见澄清卡自动选推荐项或首项，遇见写入确认卡自动确认覆盖）；
  2. 支持在批量调度下作为底层驱动，卡片一旦弹出立即自动签收并唤醒 Agent 继续执行；
  3. 捕获完整的交互闭环与多轮挂起轨迹，生成标准化 sim_traj 供后续评测裁判审计；
  4. 完美向下兼容所有不弹卡的老用例。
"""
import json
import time
import re
import sys
import argparse
from datetime import datetime
from pathlib import Path
from curl_cffi import requests as cf

# Windows 终端/重定向默认 GBK，遇到 emoji 会 UnicodeEncodeError，强制 UTF-8 兜底
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

sys.path.insert(0, str(Path(__file__).resolve().parent))
import clarification as clarity

CLARIFY_POLICIES = ("skip", "auto_first", "answer_from_case")
CLARIFY_POLICY = "auto_first"  # 核心差异：副本默认设为自动推进 auto_first
CLARIFY_MAX_ROUNDS = 5


def collect_pending_writes(raw_lines):
    """
    收集流中由于 emitSkillFile 被挂起（处于 tool-call-suspended 阶段）而尚未真正落盘的待写文件。
    与真正通过 tool-result 落盘的已执行文件严格区分！
    实现统一收敛到 clarification.file_actions，避免协议字段变动时改一处漏一处。
    """
    return clarity.file_actions(raw_lines, pending=True)

BASE_DIR = Path(__file__).resolve().parent
ROOT_DIR = BASE_DIR.parent
CONFIG_PATH = BASE_DIR / "config.json"
if not CONFIG_PATH.exists():
    CONFIG_PATH = ROOT_DIR / "config.json"
OUTPUT_DIR = BASE_DIR / "outputs"
OUTPUT_DIR.mkdir(exist_ok=True)
TIMING_LOG_PATH = OUTPUT_DIR / "timing_log.txt"


def load_config():
    if not CONFIG_PATH.exists():
        raise FileNotFoundError(f"未找到配置文件: {CONFIG_PATH}")
    return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))


def create_session(base_url, cookie, title="标准仿真评测会话"):
    url = f"{base_url}/bff/agent/v1/sessions"
    headers = {"Content-Type": "application/json", "Cookie": cookie, "x-client-platform": "web"}
    resp = cf.post(url, headers=headers, json={"agentId": "skill-edit-agent", "title": title}, impersonate="chrome", timeout=15)
    if resp.status_code not in (200, 201):
        raise RuntimeError(f"创建会话失败 HTTP {resp.status_code}: {resp.text}")
    res_data = resp.json()
    sid = (res_data.get("result") or {}).get("id") or res_data.get("sessionId")
    if not sid:
        raise ValueError(f"无法从响应中解析 sessionId: {res_data}")
    return sid


def strip_frontmatter(md_text):
    """剥离 YAML frontmatter，还原纯正文"""
    matched = re.match(r"^\ufeff?---[ \t]*\r?\n.*?\r?\n---[ \t]*\r?\n?", md_text, re.S)
    if matched:
        return md_text[matched.end():].lstrip("\r\n")
    return md_text.lstrip("\ufeff").lstrip("\r\n")


def collect_written_files_from_stream(raw_lines):
    """
    扫完本轮整条 SSE 流，收集所有 emitSkillFile 落盘动作（多文件全部捕获，绝不提前 return）
    返回: [{"path": "...", "op": "...", "content": "..."}, ...]
    实现统一收敛到 clarification.file_actions，与挂起态收集共用同一份协议解析。
    """
    return clarity.file_actions(raw_lines, pending=False)


def normalize_workspace_format(ws):
    """
    工作区快照格式严苛对齐器（保证与 Case 的 initial_workspace 7 字段 Schema 100% 对齐）
    必须包含:
      1. skillId (str)
      2. skillName (str)
      3. displayName (str)
      4. description (str)
      5. status (str)
      6. editable (bool)
      7. files (list[dict])
      + contentLength (int)
    且 files 中的 content 必须彻底剥离 YAML frontmatter 还原为纯正文！
    """
    if not ws or not isinstance(ws, dict):
        return None

    clean_files = []
    for f in ws.get("files", []):
        raw_c = f.get("content", "")
        clean_c = strip_frontmatter(raw_c) if raw_c else ""
        clean_files.append({
            "path": f.get("path", "SKILL.md"),
            "content": clean_c
        })

    norm_ws = {
        "skillId": str(ws.get("skillId", "1")),
        "skillName": ws.get("skillName", "unnamed-skill"),
        "displayName": ws.get("displayName") or ws.get("skillName") or "未命名技能",
        "description": ws.get("description", ""),
        "status": ws.get("status", "active"),
        "editable": bool(ws.get("editable", True)),
        "files": clean_files,
        "contentLength": sum(len(f["content"]) for f in clean_files)
    }
    return norm_ws


def apply_actions_to_workspace(prev_workspace, actions):
    """
    动态状态机：根据本轮收集的全部动作更新工作区
      - op == 'delete': 删除对应 path
      - op == 'upsert': 存在覆盖、不存在追加
      - 元数据与正文归一化：若有 frontmatter 提取到顶层，正文剥离为纯正文
      - 产物强制经过 normalize_workspace_format 保证 100% 对齐 7 字段规范
    """
    if not prev_workspace:
        # 自愈构建符合 7 字段标准的基础工作区
        base_ws = {
            "skillId": "1",
            "skillName": "auto-created-skill",
            "displayName": "新建技能",
            "description": "",
            "status": "active",
            "editable": True,
            "files": []
        }
    else:
        base_ws = prev_workspace

    ws = json.loads(json.dumps(base_ws))

    for act in actions:
        path = act.get("path", "SKILL.md")
        op = act.get("op", "upsert")
        raw_content = act.get("content", "")

        if op == "delete":
            ws["files"] = [f for f in ws.get("files", []) if f.get("path") != path]
            continue

        clean_content = raw_content
        if path == "SKILL.md" and raw_content.lstrip().startswith("---"):
            m_name = re.search(r"^name:\s*(.+)$", raw_content, re.M)
            if m_name:
                ws["skillName"] = m_name.group(1).strip().strip("\"'")
            m_desc = re.search(r"^description:\s*(.+)$", raw_content, re.M)
            if m_desc:
                ws["description"] = m_desc.group(1).strip().strip("\"'")
            clean_content = strip_frontmatter(raw_content)

        for fl in ws.get("files", []):
            if fl.get("path") == path:
                fl["content"] = clean_content
                break
        else:
            ws.setdefault("files", []).append({"path": path, "content": clean_content})

    return normalize_workspace_format(ws)


def _extract_texts(raw_lines):
    """从一轮 SSE 裸流中提炼 text-delta 纯文本回复"""
    texts = []
    for l in raw_lines:
        if l.startswith("data:"):
            p_str = l[5:].strip()
            if p_str and p_str != "[DONE]":
                try:
                    c_obj = json.loads(p_str)
                    if c_obj.get("type") == "text-delta":
                        texts.append(c_obj.get("payload", {}).get("text", ""))
                except Exception:
                    pass
    return "".join(texts)


def _extract_tool_names(raw_lines):
    """从一轮 SSE 裸流中提炼 tool-call 工具名序列"""
    names = []
    for l in raw_lines:
        if l.startswith("data:") and "tool-call" in l:
            try:
                c_obj = json.loads(l[5:])
            except Exception:
                continue
            if c_obj.get("type") == "tool-call":
                names.append((c_obj.get("payload") or {}).get("toolName"))
    return names


def build_sim_trajectory(case, collected_turns_raw, session_id=None):
    """
    构建带真实状态机镜像的 turns 轨迹（与 case 规范 100% 对齐）
      - 每轮 workspace_before = 上一轮 workspace_after（透传继承）
      - 每轮 workspace_after = 应用本轮全部 emitSkillFile 动作后的快照
      - 无动作的轮次（答疑/追问/口头承诺）状态直通，不污染快照
    该函数与网络层解耦，便于离线校验回填逻辑。
    """
    sim_turns_trajectory = []
    raw_init_ws = case.get("initial_workspace")
    ws_cursor = normalize_workspace_format(raw_init_ws) if raw_init_ws else None

    for t_item in collected_turns_raw:
        # 1. 本轮输入快照 = 当前状态机游标
        wb = json.loads(json.dumps(ws_cursor)) if ws_cursor else None

        # 2. 收集本轮动作并打补丁
        raw_lines = t_item.get("raw_lines") or []
        acts = collect_written_files_from_stream(raw_lines)
        if acts:
            ws_cursor = apply_actions_to_workspace(ws_cursor, acts)

        # 3. 本轮产出快照 = 补丁后游标（无动作则原样透传）
        wa = json.loads(json.dumps(ws_cursor)) if ws_cursor else None

        raw_reply = _extract_texts(raw_lines)
        icards = t_item.get("interactive_cards") or []
        card_summary = clarity.format_card_summary(icards)
        augmented_reply = raw_reply + card_summary if card_summary else raw_reply

        sim_turns_trajectory.append({
            "turn": t_item["turn"],
            "query": t_item.get("query", ""),
            "agent_reply": augmented_reply,
            "status": t_item.get("status", "unknown"),
            "latency": {
                "first_char_sec": t_item.get("first_char_sec"),
                "last_char_sec": t_item.get("last_char_sec"),
                "stream_sec": t_item.get("stream_sec")
            },
            "action_sequence": _extract_tool_names(raw_lines),
            "file_actions": acts,
            "has_interactive_cards": bool(icards or t_item.get("final_write_confirm")),
            "interactive_cards": icards,
            "write_confirm": t_item.get("final_write_confirm"),
            "pending_writes": t_item.get("pending_writes") or [],
            "suspension_context": {
                "is_suspended": t_item.get("final_is_suspended", False),
                "suspend_tool": t_item.get("final_suspend_tool"),
                "clarify_policy": t_item.get("clarify_policy", CLARIFY_POLICY),
                "auto_resume_rounds": t_item.get("suspension_rounds") or []
            },
            # 兼容字段，确保旧评测工具读取无碍
            "is_suspended": t_item.get("final_is_suspended", False),
            "suspend_tool": t_item.get("final_suspend_tool"),
            "clarification_cards": t_item.get("final_clarification_cards") or [],
            "write_blocked_by_confirm": bool(t_item.get("pending_writes")),
            "suspension_rounds": t_item.get("suspension_rounds") or [],
            "clarify_policy": t_item.get("clarify_policy", CLARIFY_POLICY),
            "workspace_before": wb,
            "workspace_after": wa
        })

    return sim_turns_trajectory


def write_trajectory(case, collected_turns_raw, traj_output_path, session_id=None):
    """深度克隆原案卷 + 回填仿真轨迹与手记，落盘 sim_traj_{case_id}.json"""
    case_with_sim = json.loads(json.dumps(case))
    case_with_sim["simulation_meta"] = {
        "sessionId": session_id,
        "run_time": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    }
    case_with_sim["turns"] = build_sim_trajectory(case, collected_turns_raw, session_id)
    Path(traj_output_path).write_text(json.dumps(case_with_sim, ensure_ascii=False, indent=2), encoding="utf-8")
    return Path(traj_output_path)


def write_timing_log(log_line, log_path=None):
    print(log_line)
    target_path = Path(log_path) if log_path else TIMING_LOG_PATH
    try:
        with open(target_path, "a", encoding="utf-8") as f:
            f.write(log_line + "\n")
    except Exception:
        pass


def run_simulation(case_path, interval_sec=10, output_dir=None, clarify_policy=None, max_cards=None):
    global CLARIFY_POLICY, CLARIFY_MAX_ROUNDS
    if clarify_policy:
        if clarify_policy not in CLARIFY_POLICIES:
            raise ValueError(f"未知澄清策略: {clarify_policy}，可选 {CLARIFY_POLICIES}")
        CLARIFY_POLICY = clarify_policy
    if max_cards:
        CLARIFY_MAX_ROUNDS = int(max_cards)

    cfg = load_config()
    base_url = cfg["base_url"]
    cookie = cfg["cookie"]

    target_out_dir = Path(output_dir) if output_dir else OUTPUT_DIR
    target_out_dir.mkdir(parents=True, exist_ok=True)
    target_traj_dir = target_out_dir / "sim_trajectories"
    target_traj_dir.mkdir(parents=True, exist_ok=True)

    case = json.loads(Path(case_path).read_text(encoding="utf-8"))
    case_id = case.get("case_id", "demo_case")
    print(f"\n🚀 开始执行用例: {case_id}")


    sid = create_session(base_url, cookie, title=f"评测_{case_id}")
    print(f"已创建会话, sessionId: {sid}")

    # --------------------------------------------------------------------------
    # 快照协调核心规则（适配 04 架构标准用例）：
    #   1. 若用例是 04 标准 Schema：读取顶层 initial_workspace 与 user_query
    #   2. 单轮用例 (len == 1)：仅在 Turn 1 上传初始快照，无多轮级联
    #   3. 多轮用例 (len > 1)：
    #      - Turn 1：上传首轮初始快照（若有）；
    #      - Turn 2+：
    #          * 若前一轮发生文件改动 (emitSkillFile) -> 动态打补丁，将更新后的快照喂给下一轮；
    #          * 若前一轮未发生改动 (如平台答疑/追问澄清) -> 状态直通，继续把原版快照回填继承喂给下一轮。
    # --------------------------------------------------------------------------
    query_dict = case.get("user_query")
    if query_dict and isinstance(query_dict, dict):
        # 04 生成的标准 21 字段用例适配，按数值顺序排序（避免字符串排序出现 turn_1 -> turn_10）
        def _get_turn_num(k):
            m = re.search(r'\d+', str(k))
            return int(m.group()) if m else 999
        turns = [{"turn": _get_turn_num(k), "query": v} for k, v in sorted(query_dict.items(), key=lambda item: _get_turn_num(item[0]))]
        current_workspace = case.get("initial_workspace")
    else:
        # 兼容旧版 demo 结构
        turns = case.get("turns", [])
        current_workspace = case.get("initial_workspace")

    collected_turns_raw = []

    msg_url = f"{base_url}/bff/agent/v1/sessions/{sid}/messages"
    headers = {
        "accept": "text/event-stream",
        "content-type": "application/json",
        "cookie": cookie,
        "origin": base_url,
        "x-client-platform": "web",
    }

    for idx, turn_spec in enumerate(turns):
        t_num = turn_spec.get("turn", idx + 1)
        query = turn_spec["query"]

        # 兼容旧用例中单轮显式覆盖 workspace 的场景
        if "workspace" in turn_spec and turn_spec["workspace"] is not None:
            current_workspace = turn_spec["workspace"]

        # 破坏性变更适配：content 必须是 {"prompt": query, "refs": []} 对象
        body = {"content": {"prompt": query, "refs": []}}
        if current_workspace:
            body["editingSkill"] = current_workspace
            print(f"-> [Turn {t_num}/{len(turns)}] 携带工作区: skillName='{current_workspace.get('skillName')}', files={len(current_workspace.get('files', []))}个")
        else:
            print(f"-> [Turn {t_num}/{len(turns)}] 无工作区 (纯文本发起)")

        round_res = clarity.request_round(msg_url, headers, body)
        raw_lines = round_res["raw_lines"]
        turn_status = round_res["status"]
        first_char_sec = round_res["first_char_sec"]
        last_char_sec = round_res["last_char_sec"]
        t_stream_sec = round_res["stream_sec"]

        if round_res["status"].startswith("http_error"):
            now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            log_str = f"[{now_str}] case={case_id} turn={t_num}/{len(turns)} 结果={turn_status} 首字=None 末字=None 流式=0.0s session={sid}"
            write_timing_log(log_str)
            break

        susp = clarity.suspension(raw_lines)
        if susp["is_suspended"] and not susp["suspend_payload"]:
            try:
                fallback = clarity.get_suspension(base_url, cookie, sid) or {}
                susp = clarity.suspension(raw_lines, fallback)
            except Exception as exc:
                print(f"  [挂起] GET /suspension 兜底失败: {exc}")

        # ---- 挂起恢复往返：已全面接入官方真实 POST /resume（澄清卡 & 写入确认卡均支持）----
        rounds = []
        resume_url = f"{base_url}/bff/agent/v1/sessions/{sid}/resume"
        while (susp["is_suspended"] and CLARIFY_POLICY != "skip"
               and len(rounds) < CLARIFY_MAX_ROUNDS):
            current_cards = susp.get("clarification_cards") or []
            current_confirm = susp.get("write_confirm")
            # 1. 澄清卡片恢复
            if susp["suspend_tool"] == "askClarification" and current_cards:
                resume_body = clarity.build_resume_payload(susp, CLARIFY_POLICY,
                                                           case.get("clarify_answers") or {})
                if not resume_body:
                    print(f"  [澄清·{CLARIFY_POLICY}] 用例未提供可用答案，停止代答")
                    break
                print(f"  [澄清·{CLARIFY_POLICY}] 第 {len(rounds) + 1} 次恢复(POST /resume clarification): "
                      f"deckId={resume_body['answer']['deckId']}, 卡片数={len(resume_body['answer']['answers'])}")
            # 2. 覆盖写入确认恢复 (emitSkillFile)
            elif susp["suspend_tool"] == "emitSkillFile" or current_confirm:
                resume_body = clarity.build_resume_payload(susp, confirm_overwrite=True)
                print(f"  [写入确认] 第 {len(rounds) + 1} 次恢复(POST /resume overwrite): confirmed=True")
            else:
                break

            rnd = clarity.request_round(resume_url, headers, resume_body)
            next_susp = clarity.suspension(rnd["raw_lines"])
            if next_susp["is_suspended"] and not next_susp["suspend_payload"]:
                try:
                    fallback = clarity.get_suspension(base_url, cookie, sid) or {}
                    next_susp = clarity.suspension(rnd["raw_lines"], fallback)
                except Exception as exc:
                    print(f"  [恢复] GET /suspension 兜底失败: {exc}")
            rounds.append({
                "round": len(rounds) + 1,
                "resume_body": resume_body,
                "status": rnd["status"],
                "is_suspended": next_susp["is_suspended"],
                "suspend_tool": next_susp["suspend_tool"],
                "clarification_cards": current_cards,
                "write_confirm": current_confirm,
            })
            raw_lines = raw_lines + rnd["raw_lines"]
            turn_status = rnd["status"]
            if first_char_sec is None:
                first_char_sec = rnd["first_char_sec"]
            if rnd["last_char_sec"] is not None:
                last_char_sec = rnd["last_char_sec"]
            t_stream_sec = round(t_stream_sec + rnd["stream_sec"], 2)
            susp = next_susp

        # 实时时序格式化打印
        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        fc_str = f"{first_char_sec:.2f}s" if first_char_sec is not None else "None"
        lc_str = f"{last_char_sec:.2f}s" if last_char_sec is not None else "None"
        log_str = f"[{now_str}] case={case_id} turn={t_num}/{len(turns)} 结果={turn_status} 首字={fc_str} 末字={lc_str} 流式={t_stream_sec:.1f}s session={sid}"
        write_timing_log(log_str)

        # ---- 挂起信息即时播报（澄清卡 / 写入确认卡）----
        if susp["is_suspended"]:
            if susp["clarification_cards"]:
                print(f"  [挂起·澄清] {susp['suspend_tool']} 下发 {len(susp['clarification_cards'])} 张卡 "
                      f"(deck={susp['clarification_cards'][0].get('deck_id')})")
                for c in susp["clarification_cards"]:
                    opts = " / ".join(o.get("label", "") for o in c.get("options", []))
                    print(f"    卡{c['step_index']}/{c['step_total']} {c['title']} [{c['selection_mode']}] 选项: {opts}")
            if susp["write_confirm"]:
                wc = susp["write_confirm"]
                print(f"  [挂起·写入确认] {wc.get('title')}  {wc.get('confirmLabel')} / {wc.get('declineLabel')}  "
                      f"影响文件: {wc.get('affectedPaths')}")
        pending = collect_pending_writes(raw_lines)
        if pending:
            print(f"  [待确认写入] {len(pending)} 个文件等待确认，本次不计入已落盘工作区: "
                  f"{[p['path'] for p in pending]}")

        # ----------------------------------------------------------------------
        # ----------------------------------------------------------------------
        # 工作区快照流转状态机（严格对齐业务规则）：
        #   单轮或多轮，只要本轮产生了文件落盘 (emitSkillFile 动作)，均聚合更新工作区快照
        #   供后续轮次或评测裁判作为 workspace_after 进行全维度比对！
        # ----------------------------------------------------------------------
        mod_actions = collect_written_files_from_stream(raw_lines)
        if mod_actions:
            current_workspace = apply_actions_to_workspace(current_workspace, mod_actions)
            print(f"  [工作区状态机] 检测到文件改动 ({len(mod_actions)} 个动作)，已生成最新工作区 (files={len(current_workspace.get('files', []))})")
        else:
            print(f"  [工作区状态机] 本轮无文件改动（如答疑/意图澄清/未落盘），维持当前工作区")

        # 结构化卡片全量清单提取（提取本轮触发过的全部卡片，供2.1卡片质量评分器消费）
        all_cards_in_turn = []
        turn_write_confirm = None
        for r_item in rounds:
            rb = r_item.get("resume_body") or {}
            if rb.get("type") == "clarification":
                # 从当轮下发的卡片列表构建
                c_list = r_item.get("clarification_cards") or []
                s_mock = {
                    "is_suspended": True,
                    "run_id": rb.get("runId"),
                    "tool_call_id": rb.get("toolCallId"),
                    "clarification_cards": c_list
                }
                all_cards_in_turn.extend(clarity.build_interactive_cards(s_mock))
            elif rb.get("type") == "overwrite":
                turn_write_confirm = r_item.get("write_confirm") or {
                    "title": "文件写入确认",
                    "confirmLabel": "覆盖写入",
                    "declineLabel": "先不写入",
                    "affectedPaths": ["SKILL.md"]
                }
        if not all_cards_in_turn and susp["is_suspended"]:
            all_cards_in_turn = clarity.build_interactive_cards(susp)
        if not turn_write_confirm and susp.get("write_confirm"):
            turn_write_confirm = susp.get("write_confirm")

        collected_turns_raw.append({
            "turn": t_num,
            "query": query,
            "status": turn_status,
            "first_char_sec": first_char_sec,
            "last_char_sec": last_char_sec,
            "stream_sec": t_stream_sec,
            "clarify_policy": CLARIFY_POLICY,
            "interactive_cards": all_cards_in_turn,
            "suspension_rounds": rounds,
            "pending_writes": pending,
            "final_is_suspended": susp["is_suspended"],
            "final_suspend_tool": susp["suspend_tool"],
            "final_clarification_cards": susp["clarification_cards"],
            "final_write_confirm": turn_write_confirm,
            "request_body": body,
            "raw_lines": raw_lines
        })

        if idx < len(turns) - 1:
            print(f"⏳ 轮间平稳等待 {interval_sec} 秒...")
            time.sleep(interval_sec)

    raw_output_path = target_out_dir / f"raw_{case_id}.json"
    raw_output_path.write_text(json.dumps({
        "case_id": case_id,
        "sessionId": sid,
        "initial_workspace": case.get("initial_workspace"),
        "turns": collected_turns_raw
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"✅ 一手数据已保存至: {raw_output_path}")
    # --------------------------------------------------------------------------
    # 同步回填并生成“真实运行轨迹镜像” (del_mock_workspace 对应物证)
    # 将原始输入的用例元数据，与动态状态机实机流转产生的每轮 input/output 工作区严格回填！
    # --------------------------------------------------------------------------
    traj_output_path = target_traj_dir / f"sim_traj_{case_id}.json"

    # 基于原始 case 深度克隆 -> 构建真实状态机镜像轨迹 -> 回填并落盘
    write_trajectory(case, collected_turns_raw, traj_output_path, session_id=sid)
    print(f"✅ 真实运行轨迹镜像 (对齐Case 7字段规范) 已保存至: {traj_output_path}")

    return raw_output_path


def resolve_case_path(spec):
    """
    将用户传入的 case 规格解析为真实文件路径，支持三种写法：
      1. 完整路径：.../01_data/dim_2_1_澄清追问准确率/case_clarification_0001.json
      2. 相对路径：01_data/dim_2_1_澄清追问准确率/case_clarification_0001.json（相对本目录）
      3. 简称 / Case ID：clarification_0001 或 case_clarification_0001 或 0001
         会在 01_data 下按目录顺序查找首个命中，命中多个时提示列表并取第一个
    命中失败时抛 FileNotFoundError，并把可选样本一并打印出来，避免用户盲猜。
    """
    raw = str(spec).strip().strip('"').strip("'")

    # 1. 直接命中（绝对路径 / 相对当前工作目录）
    p = Path(raw)
    if p.is_file():
        return p.resolve()

    # 2. 相对本脚本目录
    p2 = BASE_DIR / raw
    if p2.is_file():
        return p2.resolve()

    # 3. 不带后缀时自动补 .json
    if not raw.lower().endswith(".json"):
        p3 = BASE_DIR / (raw + ".json")
        if p3.is_file():
            return p3.resolve()

    # 4. 按 Case ID / 关键字在 01_data 下模糊查找
    data_dir = BASE_DIR / "01_data"
    if data_dir.is_dir():
        key = raw[:-5] if raw.lower().endswith(".json") else raw
        key_l = key.lower()
        matched = []
        for f in sorted(data_dir.rglob("case_*.json")):
            stem = f.stem.lower()
            # 匹配 "case_xxx" 全名、"xxx" 主体名、"0001" 编号
            body = stem[5:] if stem.startswith("case_") else stem
            if key_l in (stem, body) or key_l == body.split("_")[-1]:
                matched.append(f)
        if len(matched) == 1:
            return matched[0].resolve()
        if len(matched) > 1:
            # 命中多个（如只写 "0003" 会跨 8 个维度各命中一条），静默取第一个会跑错维度、
            # 白耗一次真实仿真，因此直接报错并列出全部候选，要求写得更具体。
            print(f"⚠️  '{raw}' 命中 {len(matched)} 个用例，无法确定目标，请写得更具体：")
            for m in matched:
                rel = m.relative_to(BASE_DIR)
                print(f"     - {rel.parent.name}\\{m.stem}")
            raise FileNotFoundError(
                f"用例 '{raw}' 有歧义（{len(matched)} 个匹配）。"
                f"可改用完整 Case ID（如 case_{matched[0].stem[5:]}）或带维度目录的路径。"
            )

        # 全部提示可选项，帮助用户快速重试
        avail = [f.stem for f in sorted(data_dir.rglob("case_*.json"))]
        raise FileNotFoundError(
            f"未找到用例: {raw}\n"
            f"可用用例（{len(avail)} 个，位于 01_data/ 下）示例: "
            + ", ".join(avail[:10]) + (" ..." if len(avail) > 10 else "")
        )

    raise FileNotFoundError(f"未找到用例: {raw}（且 {data_dir} 不存在）")


def print_card_summary(traj_path):
    """
    读取刚落盘的 sim_traj，按轮汇总澄清卡/写入确认卡的识别结果，
    让单 case 跑完就能直接看到“卡有没有被识别、识别出了什么”。
    """
    try:
        data = json.loads(Path(traj_path).read_text(encoding="utf-8"))
    except Exception as exc:
        print(f"⚠️  读取轨迹失败，跳过卡片汇总: {exc}")
        return

    turns = data.get("turns") or []
    n_clarify = 0
    n_confirm = 0
    for t in turns:
        n_clarify += len(t.get("interactive_cards") or [])
        if t.get("write_confirm"):
            n_confirm += 1

    print("\n" + "=" * 68)
    print(f"📋 卡片识别汇总  case={data.get('case_id')}  轮数={len(turns)}")
    print("=" * 68)

    if not n_clarify and not n_confirm:
        print("本轮未出现任何交互卡片（纯文本作答，或模型未触发澄清/确认）")

    for t in turns:
        cards = t.get("interactive_cards") or []
        wc = t.get("write_confirm")
        if not cards and not wc:
            continue
        print(f"\n[Turn {t.get('turn')}] status={t.get('status')} "
              f"挂起工具={t.get('suspend_tool')} 澄清卡={len(cards)} 确认卡={1 if wc else 0}")
        for c in cards:
            mode = "多选" if c.get("selection_mode") == "multi" else "单选"
            print(f"  · 澄清卡 {c.get('card_id')}  [{mode}] {c.get('title')}")
            for o in c.get("options") or []:
                rec = "[推荐] " if o.get("is_recommended") else ""
                desc = f" — {o['description']}" if o.get("description") else ""
                print(f"      - {rec}{o.get('label')}{desc}")
        if wc:
            print(f"  · 写入确认卡: {wc.get('title')} "
                  f"({wc.get('confirmLabel')}/{wc.get('declineLabel')}) 影响={wc.get('affectedPaths')}")

    print("\n" + "-" * 68)
    print(f"合计：澄清卡 {n_clarify} 张，写入确认卡 {n_confirm} 张")
    print(f"轨迹文件：{traj_path}")
    print("下一步：python 03_eval_dimensions.py --dim <维度> --case_id <case_id>")
    print("=" * 68)


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="单 Case 仿真执行引擎（上传工作区 → 跑 → 识别澄清卡/写入确认卡 → 出轨迹）")
    ap.add_argument("--case", required=True,
                    help="Case 文件路径、相对路径或 Case ID（如 clarification_0001）")
    ap.add_argument("--interval", type=int, default=10, help="轮间等待秒数")
    ap.add_argument("--clarify_policy", default="auto_first", choices=list(CLARIFY_POLICIES),
                    help="作答策略: auto_first(默认自动选推荐推进) / skip / answer_from_case")
    ap.add_argument("--max_cards", type=int, default=5, help="代答最大往返次数")
    args = ap.parse_args()

    case_file = resolve_case_path(args.case)
    print(f"📂 用例文件: {case_file}")
    case_id = json.loads(case_file.read_text(encoding="utf-8")).get("case_id", case_file.stem)

    raw_path = run_simulation(case_file, args.interval,
                              clarify_policy=args.clarify_policy, max_cards=args.max_cards)
    print_card_summary(Path(raw_path).parent / "sim_trajectories" / f"sim_traj_{case_id}.json")


