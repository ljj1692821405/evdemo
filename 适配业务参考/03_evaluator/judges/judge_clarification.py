# -*- coding: utf-8 -*-
"""
裁判三：澄清卡内容质量审计裁判 (Judge Clarification Quality)
聚焦三大核心指标（仅比对 Query 与卡片，不依赖工作区）：
  1. 标题相关度 (check_title_relevance)
  2. 防显式重复 (check_no_explicit_redundancy)
  3. 选项相关度与可用性 (check_options_relevance)
"""

import json
from pathlib import Path

PROMPT_FILE = Path(__file__).resolve().parent.parent / "prompts" / "judge_clarification.md"


class JudgeClarificationQuality:
    def __init__(self, llm_client):
        self.client = llm_client
        if not PROMPT_FILE.exists():
            raise FileNotFoundError(f"未找到澄清卡质量裁判提示词模板: {PROMPT_FILE}")
        self.system_prompt = PROMPT_FILE.read_text(encoding="utf-8")

    def build_payload(self, user_query, interactive_cards, gt_clarification=None):
        """构造「送进裁判的完整输入」，但不发起 LLM 调用。

        未下发卡片时裁判根本不调用模型，此时返回 skipped=True，
        由调用方标注为「未调用裁判」，避免被误读成裁判看过输入却判了 0。
        """
        # 若本轮未触发任何交互卡片
        if not interactive_cards:
            return {
                "skipped": True,
                "skip_reason": "本轮未下发任何交互卡片，裁判不调用模型，直接按确定性规则判 0",
                "system_prompt": self.system_prompt,
                "user_prompt": "",
                "input_data": {
                    "user_query": user_query,
                    "ground_truth_requirement": gt_clarification or "",
                    "interactive_cards": [],
                },
                "force_keys": ["dim_2_1_clarification"],
            }

        # 精简卡片结构，仅保留与质量评测强相关的字段
        clean_cards = []
        for c in interactive_cards:
            clean_cards.append({
                "card_id": c.get("card_id"),
                "title": c.get("title"),
                "selection_mode": c.get("selection_mode"),
                "recommended_option_id": c.get("recommended_option_id"),
                "allow_custom_input": c.get("allow_custom_input"),
                "options": [
                    {
                        "option_id": o.get("option_id"),
                        "label": o.get("label"),
                        "description": o.get("description", ""),
                        "is_recommended": o.get("is_recommended", False)
                    }
                    for o in c.get("options") or []
                ]
            })

        input_data = {
            "user_query": user_query,
            "ground_truth_requirement": gt_clarification or "用例未特别指定准绳，请基于常识与澄清规则独立审计",
            "interactive_cards": clean_cards
        }

        user_prompt = f"""请对以下用户输入与 Agent 下发的交互澄清卡片进行严格的 0/1 审计打分：

```json
{json.dumps(input_data, ensure_ascii=False, indent=2)}
```

请严格对照三大核心指标（标题相关度、防显式重复、选项相关度）输出合法的 JSON 契约。
"""

        return {
            "skipped": False,
            "system_prompt": self.system_prompt,
            "user_prompt": user_prompt,
            "input_data": input_data,
            "force_keys": ["dim_2_1_clarification"],
        }

    def evaluate(self, user_query, interactive_cards, gt_clarification=None):
        """
        仅依据用户输入与卡片内容，评估澄清卡的质量（标题相关度、防显式重复、选项相关度）
        """
        payload = self.build_payload(user_query, interactive_cards, gt_clarification)

        # 未下发卡片：不调用模型，按确定性规则直接给结论（与历史行为一致）
        if payload.get("skipped"):
            return {
                "dim_2_1_card_quality": {
                    "score": 0 if gt_clarification else 1,
                    "pass": not bool(gt_clarification),
                    "checkpoints": {
                        "check_title_relevance": {
                            "pass": not bool(gt_clarification),
                            "reason": "准绳要求澄清但未发卡" if gt_clarification else "无需澄清，未发卡符合预期"
                        },
                        "check_no_explicit_redundancy": {"pass": True, "reason": "未发卡不适用"},
                        "check_options_relevance": {"pass": True, "reason": "未发卡不适用"}
                    },
                    "evidence_analysis": "本轮会话未触发交互卡片下发。",
                    "reason": "未触发交互澄清卡片。"
                }
            }

        res = self.client.call_json(payload["system_prompt"], payload["user_prompt"])
        return res or {}
