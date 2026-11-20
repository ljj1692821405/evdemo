# -*- coding: utf-8 -*-
"""模型能力登记表（权威查表，数据源：模型多模态能力与上限说明.md §3 实测结论）。

字段：provider(阵营 openai/gemini)、modalities(text/image/video)、video_endpoint、note。
未登记模型 → 保守降级为仅 text。
"""
from __future__ import annotations

from typing import Any

PROVIDER_OPENAI = "openai"
PROVIDER_GEMINI = "gemini"

MODEL_CAPABILITIES: dict[str, dict[str, Any]] = {}


def _o(mods, ve=None, note=""):
    return {"provider": PROVIDER_OPENAI, "modalities": mods, "video_endpoint": ve, "note": note}


def _g(mods, ve=None, note=""):
    return {"provider": PROVIDER_GEMINI, "modalities": mods, "video_endpoint": ve, "note": note}


MODEL_CAPABILITIES.update({
    # gpt 系：文+图，不支持视频
    "gpt-5.4":       _o(["text", "image"], note="视频400拒绝"),
    "gpt-5.4-mini":  _o(["text", "image"], note="视频400拒绝"),
    "gpt-5.5":       _o(["text", "image"], note="视频400拒绝"),
    "gpt-5.6-luna":  _o(["text", "image"], note="视频400拒绝"),
    "gpt-5.6-sol":   _o(["text", "image"], note="视频静默丢弃，判不支持"),
    "gpt-5.6-terra": _o(["text", "image"], note="视频静默丢弃，判不支持"),
    "gpt-6.1-sol":   _o(["text", "image"], note="官方明确不支持video/audio"),
    # claude 系：文+图，不支持视频
    "claude-fable-5":    _o(["text", "image"], note="无视频输入"),
    "claude-fable-5-1":  _o(["text", "image"], note="无视频输入"),
    "claude-opus-4-7":   _o(["text", "image"], note="无视频输入"),
    "claude-opus-4-8":   _o(["text", "image"], note="无视频输入"),
    "claude-opus-5":     _o(["text", "image"], note="无视频输入"),
    "claude-opus-5-5":   _o(["text", "image"], note="无视频输入"),
    "claude-sonnet-4-6": _o(["text", "image"], note="无视频输入"),
    "claude-sonnet-5":   _o(["text", "image"], note="无视频输入"),
    # qwen：部分支持视频（门A）
    "qwen3.8-max":  _o(["text", "image", "video"], "openai", "门A可看视频"),
    "qwen3.7-plus": _o(["text", "image", "video"], "openai", "门A可看视频"),
    "qwen-turbo":   _o(["text", "image", "video"], "openai", "门A可看视频"),
    "qwen3.7-max":  _o(["text"], note="图/视频均400，仅文本"),
    # doubao：支持视频，门A最稳
    "doubao-seed-2.1-pro":   _o(["text", "image", "video"], "openai", "门A视频最稳，推荐裁判"),
    "doubao-seed-2.1-turbo": _o(["text", "image", "video"], "openai", "门A可看视频"),
    # deepseek：网关实测图+视频可用
    "deepseek-v4-flash":   _o(["text", "image", "video"], "openai", "网关实测图/视频可用"),
    "deepseek-v4.1-flash": _o(["text", "image", "video"], "openai", "网关实测图/视频可用"),
    "deepseek-v4-pro":     _o(["text", "image", "video"], "openai", "图/视频可用，图偶发404"),
    # glm：仅文本
    "glm-5.2": _o(["text"], note="官方仅支持文本"),
    "glm-5.3": _o(["text"], note="官方仅支持文本"),
    # grok：文+图，不支持视频输入
    "grok-4.6": _o(["text", "image"], note="视频仅生成API，非输入"),
    "grok-4.7": _o(["text", "image"], note="视频静默丢弃，判不支持"),
    # gemini：视频必须走原生门B
    "gemini-2.5-pro":         _g(["text", "image", "video"], "gemini-native", "原生门看视频，稳"),
    "gemini-2.5-flash":       _g(["text", "image"], note="原生门base64视频500，不支持"),
    "gemini-3-flash-preview": _g(["text", "image", "video"], "gemini-native", "原生门看视频"),
    "gemini-3.1-flash-lite":  _g(["text", "image"], note="网关解析异常，视频待修"),
    "gemini-3.1-pro-preview": _g(["text", "image", "video"], "gemini-native", "原生门看视频"),
    "gemini-3.5-flash":       _g(["text", "image", "video"], "gemini-native", "原生门看视频"),
    "gemini-3.5-flash-lite":  _g(["text", "image"], note="网关解析异常，视频待修"),
    "gemini-3.6-flash":       _g(["text", "image", "video"], "gemini-native", "原生门看视频"),
    "gemini-3.7-flash":       _g(["text", "image", "video"], "gemini-native", "原生门看视频，偶发503"),
    "gemini-3.8-flash":       _g(["text", "image", "video"], "gemini-native", "原生门看视频，已实测"),
    "gemini-4-argon":         _g(["text", "image"], note="base64视频500，需File/URL"),
    "gemini-4-hydrogen":      _g(["text"], note="404无权限，待网关开通"),
})


def _family_fallback(model_id: str) -> dict[str, Any]:
    """未登记模型保守降级：按前缀归阵营，模态只给 text。"""
    low = model_id.lower()
    provider = PROVIDER_GEMINI if low.startswith("gemini") else PROVIDER_OPENAI
    return {"provider": provider, "modalities": ["text"], "video_endpoint": None,
            "note": "未登记，保守降级为仅文本（需实测后补登记）"}


def get_capability(model_id: str) -> dict[str, Any]:
    """查表获取模型能力；未登记则保守降级。"""
    cap = MODEL_CAPABILITIES.get(model_id) or _family_fallback(model_id)
    return {
        "provider": cap["provider"],
        "modalities": list(cap["modalities"]),
        "video_endpoint": cap["video_endpoint"],
        "note": cap.get("note", ""),
        "registered": model_id in MODEL_CAPABILITIES,
    }

