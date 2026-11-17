# -*- coding: utf-8 -*-
"""
工作区 Git Diff 计算引擎 (workspace_diff.py)
在评测前提供轻量、确定性、高可读性的物理代码差分，彻底解决大模型“长文大海捞针”与“注意力幻觉”问题。
"""

import difflib

# 工作区顶层元数据字段（不属于 files[]，但同样是 Agent 的真实产出）
META_FIELDS = [
    ("skillName", "技能名 skillName"),
    ("displayName", "中文展示名 displayName"),
    ("description", "技能描述 description"),
]


def compute_meta_diff(workspace_before, workspace_after):
    """
    比对工作区顶层元数据字段（skillName / displayName / description）。

    背景：5.1/5.2 的黄金准绳经常直接考核「改技能名」「改 description」，
    这类改动不会在 files[].content 里产生任何行级 diff，必须单独计算，
    否则裁判只能看到 lines_added = 0，从而误判为「口嗨未落地」。

    返回:
      - changes: [{"field","label","before","after"}]，仅含真实发生变更的字段
      - text:    便于裁判直接阅读的 -/+ 元数据差分文本（无变更时为空串）
    """
    wb = workspace_before or {}
    wa = workspace_after or {}
    changes, lines = [], []

    for key, label in META_FIELDS:
        vb, va = wb.get(key), wa.get(key)
        if vb == va:
            continue
        changes.append({"field": key, "label": label, "before": vb, "after": va})
        lines.append(f"- {label}: {vb if vb is not None else '（未设置）'}")
        lines.append(f"+ {label}: {va if va is not None else '（未设置）'}")

    if not lines:
        return [], ""
    return changes, "=== 元数据变更（工作区顶层字段） ===\n" + "\n".join(lines)


def compute_workspace_diff(workspace_before, workspace_after, context_lines=3):
    """
    计算两个 7 字段标准工作区之间的物理差分
    返回:
      - diff_text: 标准统一 Git Diff 格式文本 (--- a/file +++ b/file)，前置元数据差分段落
      - stats: 变更统计指标 {"files_added", "files_deleted", "files_modified",
                             "lines_added", "lines_deleted",
                             "meta_changed_fields", "meta_changed_count"}
      - is_changed: bool 文件内容或元数据是否有任何变动
      - meta_diff: [{"field","label","before","after"}]
      - meta_diff_text: str 元数据差分文本
    """
    files_before = {f.get("path"): f.get("content", "") for f in (workspace_before or {}).get("files", [])}
    files_after = {f.get("path"): f.get("content", "") for f in (workspace_after or {}).get("files", [])}

    meta_changes, meta_text = compute_meta_diff(workspace_before, workspace_after)

    all_paths = sorted(list(set(files_before.keys()) | set(files_after.keys())))

    diff_chunks = []
    stats = {
        "files_added": 0,
        "files_deleted": 0,
        "files_modified": 0,
        "lines_added": 0,
        "lines_deleted": 0,
        "meta_changed_fields": [c["field"] for c in meta_changes],
        "meta_changed_count": len(meta_changes),
    }

    for path in all_paths:
        content_before = files_before.get(path)
        content_after = files_after.get(path)

        if content_before is None and content_after is not None:
            stats["files_added"] += 1
            lines_a = []
            lines_b = content_after.splitlines(keepends=True)
            diff_lines = list(difflib.unified_diff(
                lines_a, lines_b,
                fromfile=f"a/{path} (新建前不存在)",
                tofile=f"b/{path} (新建)",
                n=context_lines
            ))
            diff_chunks.append("".join(diff_lines))
            stats["lines_added"] += len(lines_b)

        elif content_before is not None and content_after is None:
            stats["files_deleted"] += 1
            lines_a = content_before.splitlines(keepends=True)
            lines_b = []
            diff_lines = list(difflib.unified_diff(
                lines_a, lines_b,
                fromfile=f"a/{path} (删除)",
                tofile=f"b/{path} (已移除)",
                n=context_lines
            ))
            diff_chunks.append("".join(diff_lines))
            stats["lines_deleted"] += len(lines_a)

        elif content_before != content_after:
            stats["files_modified"] += 1
            lines_a = content_before.splitlines(keepends=True)
            lines_b = content_after.splitlines(keepends=True)

            diff_lines = list(difflib.unified_diff(
                lines_a, lines_b,
                fromfile=f"a/{path}",
                tofile=f"b/{path}",
                n=context_lines
            ))
            diff_chunks.append("".join(diff_lines))

            for l in diff_lines:
                if l.startswith("+") and not l.startswith("+++"):
                    stats["lines_added"] += 1
                elif l.startswith("-") and not l.startswith("---"):
                    stats["lines_deleted"] += 1

    if meta_text:
        diff_chunks.insert(0, meta_text)

    diff_text = "\n".join(diff_chunks) if diff_chunks else ""
    is_changed = (
        (stats["files_added"] + stats["files_deleted"] + stats["files_modified"]) > 0
        or stats["meta_changed_count"] > 0
    )

    return {
        "diff_text": diff_text,
        "stats": stats,
        "is_changed": is_changed,
        "meta_diff": meta_changes,
        "meta_diff_text": meta_text,
    }
