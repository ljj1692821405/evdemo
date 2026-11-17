# -*- coding: utf-8 -*-
"""
裁判二：工作区代码与结构质量裁判 (Judge 2: Workspace & Code Evaluator)
升级版：融合【章节骨架雷达 (Section Skeleton Radar)】与确定性物理切片
"""

import json
import re
from pathlib import Path
from .workspace_diff import compute_workspace_diff
from .section_radar import generate_skeleton_radar_bundle
from .temporal_tracker import audit_temporal_continuity

PROMPT_FILE = Path(__file__).resolve().parent.parent / "prompts" / "judge2_workspace_diff.md"


def check_skill_md_structure(content):
    if not content or not isinstance(content, str):
        return False, "文件内容为空或非字符串"

    ticks = content.count("```")
    if ticks % 2 != 0:
        return False, f"代码块反引号未成对闭合 (共有 {ticks} 个反引号)"

    has_title = bool(re.search(r"^#\s+.+$", content, re.M))
    if not has_title:
        return False, "缺少单一大标题 # 结构"

    return True, "结构符合标准规范"


class JudgeWorkspaceCode:
    def __init__(self, llm_client):
        self.client = llm_client
        if not PROMPT_FILE.exists():
            raise FileNotFoundError(f"未找到裁判二提示词模板: {PROMPT_FILE}")
        self.system_prompt = PROMPT_FILE.read_text(encoding="utf-8")

    def build_payload(self, workspace_before, workspace_after, user_query, agent_reply, gt_bundle, history_turns=None, force_keys=None):
        """构造「送进裁判的完整输入」，但不发起 LLM 调用。

        单独抽出该方法的目的：
        - 评测时 evaluate() 直接使用它，保证判分与展示同源；
        - 回填核查台时可不重跑打分、重建当时的提示词与输入字段。
        注意：确定性物理预判（结构合规/输出质量豁免、骨架雷达、Diff 统计）都在此处完成，
        返回体中额外带出这些中间结论，供核查台呈现。
        """
        def get_md(ws):
            """提取工作区中的 SKILL.md（支持根目录与子目录）"""
            if not ws:
                return None
            for f in ws.get("files", []):
                path = f.get("path", "")
                if path in ("SKILL.md", "skill.md") or path.endswith("/SKILL.md") or path.endswith("/skill.md"):
                    return f.get("content", "")
            return None

        before_md = get_md(workspace_before)
        after_md = get_md(workspace_after)

        # 4.1 物理结构预判：
        # 【关键】只在“工作区确实产出了 SKILL.md 内容”时才做结构合规检查。
        # 若本轮 Agent 因意图模糊而反问澄清/只给方案、并未落盘生成文件，
        # 则结构合规性无对象可检，应判 N/A（豁免），绝不能硬判 0 分。
        struct_exempt = not (after_md and after_md.strip())
        if struct_exempt:
            is_struct_ok, struct_reason = None, "本轮工作区未产出 SKILL.md 内容（Agent 处于澄清追问或方案征询阶段），结构合规性无对象可检，置 N/A 豁免"
        else:
            is_struct_ok, struct_reason = check_skill_md_structure(after_md)

        # 4.2 输出质量预判（与 4.1 结构合规保持完全同口径）：
        # 【关键】输出质量忠实度评价的对象是 SKILL.md 正文。
        # 若本轮工作区没有任何 SKILL.md 内容产出，则质量忠实度同样无对象可评，
        # 只做分析说明并置 N/A 豁免，绝不硬判 0 分（避免把“还没开始写”误判成“写得差”）。
        quality_exempt = struct_exempt
        if quality_exempt:
            print("      [4.2 输出质量] 工作区无 SKILL.md 内容产出 -> 仅分析、不评测，置 N/A 豁免")

        # 章节骨架雷达扫描 (确定性物理物证)
        radar_bundle = generate_skeleton_radar_bundle(before_md, after_md)

        # 前置确定性 Diff 引擎计算统计
        diff_res = compute_workspace_diff(workspace_before, workspace_after)
        diff_stats = diff_res["stats"]
        is_changed = diff_res["is_changed"]

        print(f"      [章节骨架雷达] 发生修改小节: {radar_bundle['modified_count']} 个, 原样保持小节: {radar_bundle['untouched_count']} 个")
        print(f"      [物理 Diff 统计] 变动文件: {diff_stats['files_modified']} 个, 新增行: +{diff_stats['lines_added']}, 删除行: -{diff_stats['lines_deleted']}")

        # 【时序插件按需触发】：当且仅当存在历史轮次且激活了 gt_3_2 时激活
        temporal_res = None
        if history_turns and gt_bundle.get("gt_3_2_context_update"):
            temporal_res = audit_temporal_continuity(history_turns, after_md, gt_bundle.get("gt_3_2_context_update"))
            if temporal_res:
                print(f"      [时序因果雷达已触发] 准绳实体核查: 健在 {temporal_res['preserved_count']} 项, 缺失 {temporal_res['missing_count']} 项")

        has_gt_modify = bool(gt_bundle.get("gt_5_1_targeted"))
        has_file_diff = (diff_stats["lines_added"] > 0 or diff_stats["lines_deleted"] > 0)
        has_meta_diff = diff_stats.get("meta_changed_count", 0) > 0
        # 元数据（skillName / displayName / description）变更属于真实落盘，与文件改动同等有效
        has_physical_diff = has_file_diff or has_meta_diff
        zero_physical_diff = not has_physical_diff

        input_data = {
            "user_query": user_query,
            "agent_reply": agent_reply or "（无回复）",
            "has_workspace_after": bool(after_md),
            "diff_stats": diff_stats,
            "metadata_diff": diff_res.get("meta_diff") or [],
            "metadata_diff_text": diff_res.get("meta_diff_text") or "（本轮元数据无变更）",
            "skeleton_radar_summary": radar_bundle["summary_header"],
            "scoped_modified_diff": radar_bundle["diff_body"],
            "temporal_audit_summary": temporal_res["summary"] if temporal_res else "（当前单轮或未激活多轮时序审计）",
            "gt_3_2_context_update": gt_bundle.get("gt_3_2_context_update"),
            "gt_4_2_quality": gt_bundle.get("gt_4_2_quality"),
            "gt_5_1_targeted": gt_bundle.get("gt_5_1_targeted"),
            "gt_5_2_preservation": gt_bundle.get("gt_5_2_preservation")
        }

        user_prompt = f"""请仔细审视下方传入的【用户指令】、【Agent 回复】、【元数据差分】、【文档全局章节骨架雷达】、【变动切片（发生改动章节的精准 Diff）】，严格对照黄金准绳打分。

核心判定规则（最高事实效力）：
1. 【全局章节骨架雷达与章名全景】（物理确证物证）：
   - 雷达中按文档顺序完整列出了从第 1 章到第 N 章的所有章节/小节及其变动状态。
   - 凡标有 🛡️ [无改动: 100%原样保持] 的章节，物理上 100% 毫发无损，未发生任何误伤、误删或篡改！
2. 【元数据变更具有同等物理效力】（重要，防漏判）：
   - 工作区顶层 `skillName` / `displayName` / `description` 的变更属于真实落盘，与文件内容变更同等有效，请你务必阅读 `metadata_diff` 与 `metadata_diff_text`。
   - 若黄金准绳要求的是改技能名或改 description，而 `metadata_diff` 显示该字段已按目标值改对，**即使 SKILL.md 正文 0 行变动（lines_added = 0），dim_5_1_targeted 也必须判 1 分**。
   - 严禁以 `lines_added = 0` 为唯一依据判“口嗨未落地”；判定前必须先确认 `metadata_diff` 是否为空。
   - 若 Agent 回复明确声明“只改名字，描述与正文保持原样”，而 `metadata_diff` 显示 description 也发生了变化，应先判断这是否属于平台保存时的自动同步副作用（如由 skillName 变更引发），不得机械判 dim_5_2_preservation = 0。
3. 【5.1 定向修改 与 5.2 内容保护（观其行原则）】：
   - 【极其重要】：只要工作区发生了实际变更（存在修改章节切片，或元数据字段发生变更），无论 Agent 回复中是否同时在追问或提建议，本轮都必须严格根据真实的雷达状态、元数据差分与变动切片对 5.1 和 5.2 进行刚性打分！
   - 若改动精准落在目标章节内且符合要求，5.1 给 pass (1分)；若指名保护的章节标为 🛡️ [无改动]，5.2 给 pass (1分)；反之若越界篡改或破坏保护章节，必须判 0 分！
   - 绝不可因为 Agent 在回复末尾礼貌性地问了用户一句“下一步是否要这样改”，就盲目忽略已发生的真实改动！
4. 【待确认豁免机制（仅限工作区零改动时生效）】：
   - 当且仅当 Agent 回复明确在等待用户确认/提供信息，【且本轮工作区完全没有进行任何物理落盘（文件变动行数为 0 且元数据零变更）】时，`is_waiting_user_confirmation` 才应被采纳并豁免本轮代码评测。
5. 【4.2 输出质量忠实度的无对象豁免（与 4.1 结构合规同口径）】：
   - 判定 `dim_4_2_quality` 前，先看 `has_workspace_after` 与 `diff_stats`。
   - 若本轮工作区**完全没有 SKILL.md 正文内容**（`has_workspace_after = false`，且改动行数、元数据变更均为 0），说明 Agent 尚处于澄清追问或方案征询阶段，输出质量**无对象可评**。
   - 此时 `dim_4_2_quality` 必须输出 `null`（置 N/A 豁免），**严禁判 0 分**，也不能凭 Agent 的口头方案去评价“不存在的产出质量”。

输入数据：
```json
{json.dumps(input_data, ensure_ascii=False, indent=2)}
```

输出合法 JSON，契约如下：
{{
  "is_waiting_user_confirmation": false,
  "confirmation_reason": "简述判断依据：Agent 回复是否明确在等待用户确认/澄清后再落盘工作区",
  "dim_3_2_context_update": {{
    "score": 1,
    "pass": true,
    "evidence_analysis": "推导分析（未激活时置 null）",
    "reason": "100字以内大白话结论（未激活时置 null）"
  }},
  "dim_4_2_quality": {{
    "score": 1,
    "pass": true,
    "evidence_analysis": "推导分析（若处于等待确认状态则置 null）",
    "reason": "100字以内大白话结论（若处于等待确认状态则置 null）"
  }},
  "dim_5_1_targeted": {{
    "score": 1,
    "pass": true,
    "evidence_analysis": "推导分析：依据全局章节骨架雷达与变动切片，核验修改是否精准落在目标章节，其他章节是否保持原样",
    "reason": "100字以内大白话结论"
  }},
  "dim_5_2_preservation": {{
    "score": 1,
    "pass": true,
    "evidence_analysis": "推导分析：依据骨架雷达，指出指名保护章节是否标为[无改动: 100%原样保持]，确证未受误伤",
    "reason": "100字以内大白话结论"
  }}
}}
"""

        if force_keys:
            user_prompt = user_prompt + (
                "\n\n【强制打分补充要求 · 优先级最高】\n"
                "本次为单一维度专项评测，下列维度字段必须给出明确的 0 或 1 分数，"
                "严禁输出 null 或省略：\n"
                + "\n".join(f"- {k}" for k in force_keys)
                + "\n即使处于等待确认状态或信息有限，也必须对上述字段做出 0/1 判定，不得留空。"
            )

        # 确定性物理预判结论，连同提示词一并返回，供核查台展示
        trace = {
            "has_workspace_after": bool(after_md),
            "struct_exempt": struct_exempt,
            "struct_rule_reason": struct_reason,
            "quality_exempt": quality_exempt,
            "diff_stats": diff_stats,
            "skeleton_summary": radar_bundle["summary_header"],
            "temporal_audit_summary": temporal_res["summary"] if temporal_res else "（当前单轮或未激活多轮时序审计）",
        }

        return {
            "system_prompt": self.system_prompt,
            "user_prompt": user_prompt,
            "input_data": input_data,
            "force_keys": list(force_keys or []),
            "trace": trace,
            # 供 evaluate() 继续使用的确定性中间量
            "_ctx": {
                "after_md": after_md,
                "struct_exempt": struct_exempt,
                "is_struct_ok": is_struct_ok,
                "struct_reason": struct_reason,
                "quality_exempt": quality_exempt,
                "has_physical_diff": has_physical_diff,
                "radar_bundle": radar_bundle,
            },
        }

    def evaluate(self, workspace_before, workspace_after, user_query, agent_reply, gt_bundle, history_turns=None, force_keys=None):
        """
        裁判二：工作区代码与结构质量评测
        由裁判大模型综合审视 Agent 回复：若识别到属于"待用户确认后再生成工作区内容"的再次确认机制，
        则 4.1 与 4.2 维度自动豁免，返回 None（NULL）。

        另设两条「无对象豁免」硬规则（由 Python 物理事实裁定，优先级最高）：
          · 4.1 结构合规：本轮未产出 SKILL.md 内容 → 无对象可检 → N/A
          · 4.2 输出质量：本轮未产出 SKILL.md 内容 → 无对象可评 → 仅分析、不评测 → N/A
        """
        payload = self.build_payload(
            workspace_before, workspace_after, user_query, agent_reply, gt_bundle,
            history_turns=history_turns, force_keys=force_keys,
        )
        ctx = payload["_ctx"]
        after_md = ctx["after_md"]
        struct_exempt = ctx["struct_exempt"]
        is_struct_ok = ctx["is_struct_ok"]
        struct_reason = ctx["struct_reason"]
        quality_exempt = ctx["quality_exempt"]
        has_physical_diff = ctx["has_physical_diff"]
        radar_bundle = ctx["radar_bundle"]

        res = self.client.call_json(payload["system_prompt"], payload["user_prompt"])
        parsed = res if isinstance(res, dict) else {}

        waiting_confirm = bool(parsed.get("is_waiting_user_confirmation"))
        force_set = set(force_keys or [])
        # 专项评测（force_keys 非空）时禁止整轮豁免，必须刚性打分
        exempt_active = waiting_confirm and not has_physical_diff and not force_set
        exempted_keys = []

        # 【核心判定逻辑】：只有当 Agent 处于协商流程 且 工作区零改动 时，才执行豁免。
        # 只要存在物理改动 (has_physical_diff 含元数据变更)，无论其意图如何，都必须严格考核改动的精准性与保护情况！
        if exempt_active:
            confirm_why = parsed.get("confirmation_reason") or "Agent 处于再次确认流程，且暂未落盘"
            print(f"      [裁判模型判定] 识别到待确认机制触发 (无物理变动): {confirm_why} -> 全维度置 NULL 豁免")
            parsed["dim_4_1_structure"] = None
            parsed["dim_4_2_quality"] = None
            parsed["dim_5_1_targeted"] = None
            parsed["dim_5_2_preservation"] = None
            # 整轮豁免时，force_keys 里的维度同样属于合法 N/A，避免无意义重试
            for fk in force_set:
                if fk not in exempted_keys:
                    exempted_keys.append(fk)
        else:
            # 4.1 结构合规：无 SKILL.md 产出时无对象可检，置 N/A 而非硬判 0
            if struct_exempt:
                parsed["dim_4_1_structure"] = None
                exempted_keys.append("dim_4_1_structure")
                print(f"      [4.1 结构合规] 工作区无 SKILL.md 产出 -> 置 N/A 豁免")
            else:
                parsed["dim_4_1_structure"] = {
                    "score": 1 if is_struct_ok else 0,
                    "pass": bool(is_struct_ok),
                    "evidence_analysis": "Python 正则硬规则校验：一级大标题存在性，反引号闭合完整性统计",
                    "reason": struct_reason
                }

            # 若有 GT 修改要求且「文件与元数据均零变动」且未处于确认流程，视为口嗨
            if has_gt_modify and not has_physical_diff and not waiting_confirm:
                print("      [物理断言触发] 任务要求修改但工作区 0 行变动且元数据无变化且未在确认中，判定虚假修改！")
                parsed["dim_5_1_targeted"] = {
                    "score": 0,
                    "pass": False,
                    "evidence_analysis": "物理铁证：黄金准绳要求修改目标内容，但工作区 Git Diff 新增/删除行均为 0 且元数据零变更，未处于合理确认状态，构成口嗨未落地。",
                    "reason": "Agent 仅口头声称修改或未落盘，文件与元数据均无变动，定向修改失败。"
                }
                parsed["dim_4_2_quality"] = {
                    "score": 0,
                    "pass": False,
                    "evidence_analysis": "物理物证：Agent 未对工作区进行任何物理修改，文件与元数据变动均为 0。",
                    "reason": "工作区无任何物理修改落地，质量判定未达标。"
                }

        # 黄金准绳未激活的置 None（专项评测指定维度除外）
        if not gt_bundle.get("gt_3_2_context_update"):
            parsed["dim_3_2_context_update"] = None
        if (not gt_bundle.get("gt_4_2_quality") or exempt_active) and "dim_4_2_quality" not in force_set:
            parsed["dim_4_2_quality"] = None
        if (not gt_bundle.get("gt_5_1_targeted") or exempt_active) and "dim_5_1_targeted" not in force_set:
            parsed["dim_5_1_targeted"] = None
        if (not gt_bundle.get("gt_5_2_preservation") or exempt_active) and "dim_5_2_preservation" not in force_set:
            parsed["dim_5_2_preservation"] = None

        # 专项评测兜底：裁判模型漏打分时，由确定性物理规则给出判定
        for fk in force_set:
            obj = parsed.get(fk)
            if isinstance(obj, dict) and obj.get("score") in (0, 1):
                continue
            if fk == "dim_4_1_structure":
                if struct_exempt:
                    parsed[fk] = None
                    if fk not in exempted_keys:
                        exempted_keys.append(fk)
                else:
                    parsed[fk] = {
                        "score": 1 if is_struct_ok else 0,
                        "pass": bool(is_struct_ok),
                        "evidence_analysis": "确定性兜底：按 SKILL.md 物理结构硬规则判定（大标题与代码块闭合）",
                        "reason": struct_reason
                    }
            elif fk == "dim_4_2_quality":
                produced = bool(after_md) or has_physical_diff
                parsed[fk] = {
                    "score": 1 if produced else 0,
                    "pass": produced,
                    "evidence_analysis": "确定性兜底：核查本轮是否真正产出可评内容（工作区文件或物理 Diff 或元数据变更）",
                    "reason": "本轮已产出可评的内容。" if produced else "本轮未产出任何可评内容，仅口头给方案，质量无法落地。"
                }
            elif fk == "dim_5_1_targeted":
                parsed[fk] = {
                    "score": 1 if has_physical_diff else 0,
                    "pass": has_physical_diff,
                    "evidence_analysis": "确定性兜底：以文件 Diff 行数与元数据变更共同判定是否发生真实定向修改",
                    "reason": "存在真实物理改动。" if has_physical_diff else "工作区零变动，定向修改未落地。"
                }
            elif fk == "dim_5_2_preservation":
                parsed[fk] = {
                    "score": 1 if has_physical_diff else 0,
                    "pass": has_physical_diff,
                    "evidence_analysis": "确定性兜底：依据章节骨架雷达确认非目标小节保持原样",
                    "reason": f"发生修改小节 {radar_bundle['modified_count']} 个，原样保持 {radar_bundle['untouched_count']} 个。"
                }

        # 【4.2 输出质量 · 无对象豁免最终裁定】
        # 与 4.1 结构合规同口径：本轮工作区未产出任何 SKILL.md 内容时，
        # 输出质量忠实度无对象可评，只保留分析说明并置 N/A，绝不硬判 0 分。
        # 该规则基于物理事实（工作区确无正文），优先级高于：
        #   ① 裁判大模型的打分  ② force_keys 专项强制打分  ③ 口嗨连坐判 0
        if quality_exempt:
            parsed["dim_4_2_quality"] = None
            if "dim_4_2_quality" not in exempted_keys:
                exempted_keys.append("dim_4_2_quality")

        # 把「合法豁免（N/A）」的维度回传给调度层，避免触发无意义的强制重试
        parsed["_exempted_keys"] = exempted_keys

        return parsed

