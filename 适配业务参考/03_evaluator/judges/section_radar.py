# -*- coding: utf-8 -*-
"""
章节骨架与物理变动雷达 (section_radar.py)
用于在评测代码维度（5.1、5.2、4.1、4.2）前，对修改前后工作区进行 100% 确定性的结构透视与状态标记。
"""

import re
import difflib


def extract_document_sections(markdown_text):
    """
    自适应提取文档章节切片（优先按 ## 或 ### 提取，无标题自动按段落块兜底）
    返回: list of dict: [{"title": "## 一、原则", "content": "..."}]
    """
    if not markdown_text or not isinstance(markdown_text, str):
        return []

    lines = markdown_text.splitlines()
    sections = []
    current_title = "【文档前言/概要】"
    current_lines = []

    for idx, line in enumerate(lines, start=1):
        # 匹配 #, ##, ### 等标题
        m = re.match(r"^(#{1,4})\s+(.+)$", line.strip())
        if m:
            if current_lines:
                sections.append({
                    "title": current_title,
                    "content": "\n".join(current_lines)
                })
            current_title = line.strip()
            current_lines = [line]
        else:
            current_lines.append(line)

    if current_lines:
        sections.append({
            "title": current_title,
            "content": "\n".join(current_lines)
        })

    # 兜底：如果完全没有任何标题，则按每 30 行划分为一个逻辑块
    if len(sections) == 1 and sections[0]["title"] == "【文档前言/概要】" and len(lines) > 30:
        blocks = []
        chunk_size = 30
        for i in range(0, len(lines), chunk_size):
            chunk_lines = lines[i:i + chunk_size]
            b_name = f"【文本段落第 {i+1} - {min(i + chunk_size, len(lines))} 行】"
            blocks.append({
                "title": b_name,
                "content": "\n".join(chunk_lines)
            })
        return blocks

    return sections


def generate_skeleton_radar_bundle(content_before, content_after):
    """
    比对修改前后文本，生成给裁判模型的【骨架状态清单】与【聚焦切片】
    """
    before_secs = {s["title"]: s["content"] for s in extract_document_sections(content_before)}
    after_secs = {s["title"]: s["content"] for s in extract_document_sections(content_after)}

    all_titles = list(dict.fromkeys(list(before_secs.keys()) + list(after_secs.keys())))

    radar_lines = []
    modified_slices = []

    modified_count = 0
    untouched_count = 0
    added_count = 0
    deleted_count = 0

    for title in all_titles:
        cb = before_secs.get(title)
        ca = after_secs.get(title)

        if cb is not None and ca is None:
            deleted_count += 1
            radar_lines.append(f"  - {title} --> ❌ [已被删除]")
            modified_slices.append(f">>> 章节删除: {title}\n(整段在修改后已被移除)")
        elif cb is None and ca is not None:
            added_count += 1
            radar_lines.append(f"  - {title} --> ➕ [全新增章节]")
            sample_lines = "\n".join([f"+ {l}" for l in ca.splitlines()[:10]])
            modified_slices.append(f">>> 全增章节: {title}\n{sample_lines}")
        elif cb == ca:
            untouched_count += 1
            radar_lines.append(f"  - {title} --> 🛡️ [无改动: 100%原样保持]")
        else:
            modified_count += 1
            # 物理萎缩检测：判断非目标小节是否遭到大幅掏空/删除
            char_before = len(cb or "")
            char_after = len(ca or "")
            shrink_warning = ""
            if char_before > 80 and char_after < char_before * 0.4:
                shrink_pct = round((1 - char_after / char_before) * 100)
                shrink_warning = f" ⚠️【高危: 内容严重萎缩掏空! 原{char_before}字->现{char_after}字 (缩减{shrink_pct}%)】"

            radar_lines.append(f"  - {title} --> ✏️ [发生局部修改]{shrink_warning}")
            # 提取该小节局部的精简 Diff
            diff = list(difflib.unified_diff(
                cb.splitlines(), ca.splitlines(),
                n=2, lineterm=""
            ))
            # 过滤掉文件头部
            clean_diff = [l for l in diff if not (l.startswith("---") or l.startswith("+++"))]
            modified_slices.append(f">>> 修改章节切片: {title}{shrink_warning}\n" + "\n".join(clean_diff[:25]))


    summary_header = (
        f"【文档全局章节骨架雷达 (共扫描 {len(all_titles)} 个章节/小节)】\n"
        f"全局概览: 发生修改章节数 = {modified_count}, 原样保持 = {untouched_count}, 新增 = {added_count}, 删除 = {deleted_count}\n"
        "章节骨架列表及变动状态 (请严格依据此状态进行后续判定):\n" + "\n".join(radar_lines)
    )

    diff_body = "\n\n".join(modified_slices) if modified_slices else "（无任何章节内容发生变动）"

    return {
        "summary_header": summary_header,
        "diff_body": diff_body,
        "modified_count": modified_count,
        "untouched_count": untouched_count
    }
