# -*- coding: utf-8 -*-
"""
时序因果穿透雷达插件 (Multi-turn Temporal Trajectory Tracker)
仅在多轮交互（turn >= 2）且激活 gt_3_2_context_update 时按需触发。
负责物理比对前轮确认项与后轮终态文本，判定是“继承保留”、“脏数据残留”还是“前轮被违规覆盖”。
"""
import re


def extract_keywords_from_gt_points(gt_dict):
    """
    从 gt_3_2 的 point 中智能提取关键短语/实体词，用于物理命中检测
    """
    if not isinstance(gt_dict, dict):
        return []
    keywords = []
    for k, text in gt_dict.items():
        if not isinstance(text, str):
            continue
        # 提取引号内的实体词：如 “微表情特写”、“4:5 竖屏比例”
        quotes = re.findall(r'“([^”]+)”|"([^"]+)"', text)
        for q1, q2 in quotes:
            w = q1 or q2
            if len(w) >= 2:
                keywords.append(w.strip())
    return list(dict.fromkeys(keywords))


def audit_temporal_continuity(history_turns, current_turn_md, gt_3_2):
    """
    时序因果物理审计引擎
    :param history_turns: 历史轮次列表 [{'turn': 1, 'query': '...', 'workspace_after': {...}}]
    :param current_turn_md: 当前轮改后的 SKILL.md 终态正文
    :param gt_3_2: 黄金准绳 gt_3_2_context_update
    :return: 结构化物证字典
    """
    if not history_turns or not current_turn_md or not gt_3_2:
        return None

    # 提取准绳关注的实体关键词
    target_keywords = extract_keywords_from_gt_points(gt_3_2)

    audit_lines = []
    preserved_count = 0
    missing_count = 0

    lines = current_turn_md.splitlines()

    for kw in target_keywords:
        matched_lines = []
        for idx, line in enumerate(lines, 1):
            if kw in line:
                matched_lines.append(idx)

        if matched_lines:
            preserved_count += 1
            line_str = ", ".join([f"第{ln}行" for ln in matched_lines[:3]])
            audit_lines.append(f"  - 准绳核验项【{kw}】--> 🛡️ [终态依然健在: 位于 {line_str}]")
        else:
            missing_count += 1
            audit_lines.append(f"  - 准绳核验项【{kw}】--> ⚠️ [终态未检索到该关键词: 疑似被本轮冲刷覆盖或遗漏!]")

    summary = (
        f"【多轮时序因果穿透雷达 (历史轮数: {len(history_turns)} 轮)】\n"
        f"时序准绳实体监控: 成功健在 = {preserved_count} 项, 终态缺失 = {missing_count} 项\n"
        "实体在当前终态文本中的物理存在性清单:\n" + "\n".join(audit_lines)
    )

    return {
        "summary": summary,
        "preserved_count": preserved_count,
        "missing_count": missing_count,
        "keywords_checked": target_keywords
    }
