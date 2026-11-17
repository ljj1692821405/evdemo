# -*- coding: utf-8 -*-
"""
纯粹的 LLM API 客户端封装 (05_评测评分器 专用)
"""

import json
import threading
import time
import urllib.request
import urllib.error


class JudgeLLMClient:
    def __init__(self, config_data, active_model=None, temperature=0.0):
        llm_cfg = config_data.get("llm", {})
        self.base_url = llm_cfg.get("base_url", "https://jzapi.duanju.com/v1").rstrip("/")
        self.api_key = llm_cfg.get("api_key", "")
        self.model = active_model or llm_cfg.get("model", "gpt-5.4-mini")
        self.temperature = temperature

        if not self.api_key:
            raise ValueError("[X] 未在 config.json 中检测到有效 api_key！")

    def call_json(self, system_prompt, user_prompt, timeout=45):
        url = f"{self.base_url}/chat/completions"
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "User-Agent": "SkillAgentJudge/3.0"
        }
        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            "temperature": self.temperature,
            "response_format": {"type": "json_object"}
        }

        data_bytes = json.dumps(payload).encode("utf-8")
        box = {}

        def worker():
            try:
                req = urllib.request.Request(url, data=data_bytes, headers=headers, method="POST")
                with urllib.request.urlopen(req, timeout=timeout) as res:
                    box["body"] = res.read().decode("utf-8")
            except Exception as e:
                box["err"] = e

        t = threading.Thread(target=worker, daemon=True)
        t.start()
        t.join(timeout + 5)

        if "body" in box:
            try:
                res_obj = json.loads(box["body"])
                raw_txt = res_obj["choices"][0]["message"]["content"].strip()
                if raw_txt.startswith("```json"):
                    raw_txt = raw_txt[7:]
                if raw_txt.startswith("```"):
                    raw_txt = raw_txt[3:]
                if raw_txt.endswith("```"):
                    raw_txt = raw_txt[:-3]
                return json.loads(raw_txt.strip())
            except Exception:
                return None
        return None
