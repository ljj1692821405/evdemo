# -*- coding: utf-8 -*-
"""模型路由验证：chat() 与 call_json() 是否共用同一条三层路由。

不联网：用假的 httpx 客户端拦截上游请求，只验「路由决策」本身：
  1. 模态检测：text / image / video 三态识别是否正确。
  2. 能力表前置拦截：登记为不支持的组合必须 400，绝不落到上游。
  3. 适配器选择：video + gemini-native 登记 → 原生门；其余 → OpenAI 兼容门。
  4. call_json 与 chat 同源：评分器链路（judge_service.judge_inputs）也走 detect → validate → route。
  5. 返回值透传：model 必须等于请求的 model（防「假切换」）。

运行：cd backend && python model_route_test.py
"""
from __future__ import annotations

import asyncio
import json
import sys
import types
from typing import Any

try:
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
except Exception:  # noqa: BLE001
    pass

from app.responses import ServiceError
from app.services import llm_service
from app.services.judging import judge_service

JUDGE_JSON = json.dumps(
    {"score": 1, "pass": True, "evidence_analysis": "入参已覆盖要点", "reason": "满足要求"},
    ensure_ascii=False,
)

calls: list[dict[str, Any]] = []


class FakeResponse:
    def __init__(self, status: int, payload: dict) -> None:
        self.status_code = status
        self._payload = payload
        self.text = json.dumps(payload, ensure_ascii=False)

    def json(self) -> dict:
        return self._payload


class FakeAsyncClient:
    """拦截所有上游 HTTP，按 URL 区分 Gemini 原生门与 OpenAI 兼容门。"""

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        pass

    async def __aenter__(self) -> "FakeAsyncClient":
        return self

    async def __aexit__(self, *exc: Any) -> bool:
        return False

    async def aclose(self) -> None:
        pass

    async def post(self, url: str, headers=None, json=None) -> FakeResponse:  # noqa: A002
        body = json or {}
        calls.append({"url": url, "payload": body})
        if ":generateContent" in url:
            return FakeResponse(
                200,
                {
                    "candidates": [{"content": {"parts": [{"text": JUDGE_JSON}]}}],
                    "usageMetadata": {
                        "promptTokenCount": 10,
                        "candidatesTokenCount": 5,
                        "totalTokenCount": 15,
                    },
                },
            )
        return FakeResponse(
            200,
            {
                "model": body.get("model"),
                "choices": [{"message": {"content": JUDGE_JSON}}],
                "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
            },
        )


_ORIGINAL_GET_CLIENT = llm_service._get_client


def install_fakes() -> Any:
    """把 httpx 换成假实现，返回还原函数。"""
    real_httpx = llm_service.httpx
    shim = types.SimpleNamespace()
    for name in dir(real_httpx):
        if not name.startswith("__"):
            setattr(shim, name, getattr(real_httpx, name))
    shim.AsyncClient = FakeAsyncClient  # type: ignore[attr-defined]

    async def fake_get_client() -> FakeAsyncClient:
        return FakeAsyncClient()

    llm_service.httpx = shim  # type: ignore[assignment]
    llm_service._get_client = fake_get_client  # type: ignore[assignment]

    def restore() -> None:
        llm_service.httpx = real_httpx  # type: ignore[assignment]
        llm_service._get_client = _ORIGINAL_GET_CLIENT  # type: ignore[assignment]

    return restore


def check(cond: bool, label: str, detail: str = "") -> None:
    if not cond:
        raise AssertionError(f"[FAIL] {label} {detail}")
    print(f"  OK {label} {detail}")


def section(title: str) -> None:
    print(f"\n{'=' * 66}\n{title}\n{'=' * 66}")


async def main() -> int:
    restore = install_fakes()
    try:
        section("1. 模态检测")
        check(llm_service._detect_modalities(msgs_text()) == {"text"}, "纯文本")
        check(llm_service._detect_modalities(msgs_image()) == {"text", "image"}, "文本+图片")
        check(llm_service._detect_modalities(msgs_video()) == {"text", "video"}, "文本+视频")

        section("2. 能力表前置拦截（不落到上游）")
        before = len(calls)
        await expect_error(
            llm_service.chat(msgs_image(), model="glm-5.3"), 400, "glm-5.3 + 图片 → 400"
        )
        await expect_error(
            llm_service.chat(msgs_video(), model="gpt-5.6-sol"), 400, "gpt-5.6-sol + 视频 → 400"
        )
        await expect_error(
            llm_service.chat(msgs_video(), model="gemini-2.5-flash"),
            400,
            "gemini-2.5-flash（视频登记为不支持）→ 400",
        )
        check(len(calls) == before, "拦截阶段零上游请求", f"calls={len(calls) - before}")

        section("3. 适配器选择：OpenAI 兼容门")
        calls.clear()
        r = await llm_service.chat(msgs_text(), model="gpt-5.6-sol")
        check(r["adapter_used"] == "openai", "纯文本 → openai 门")
        check(r["model"] == "gpt-5.6-sol", "返回 model 等于请求 model", f"-> {r['model']}")
        check(calls[-1]["url"].endswith("/chat/completions"), "URL 为 /chat/completions")

        calls.clear()
        r = await llm_service.chat(msgs_image(), model="deepseek-v4-pro")
        check(r["adapter_used"] == "openai", "图片 + deepseek → openai 门")
        check(
            calls[-1]["payload"]["messages"][0]["content"][1]["type"] == "image_url",
            "image_url 原样透传给上游",
        )

        calls.clear()
        r = await llm_service.chat(msgs_video(), model="doubao-seed-2.1-pro")
        check(r["adapter_used"] == "openai", "视频 + doubao（门A 登记）→ openai 门")
        check(r["model"] == "doubao-seed-2.1-pro", "返回 model 等于请求 model")

        section("4. 适配器选择：Gemini 原生门")
        calls.clear()
        r = await llm_service.chat(msgs_video(), model="gemini-3.8-flash")
        check(r["adapter_used"] == "gemini-native", "视频 + gemini-3.8-flash → 原生门")
        url = calls[-1]["url"]
        check(
            url.split("?")[0].endswith("/v1beta/models/gemini-3.8-flash:generateContent"),
            "URL 为 v1beta:generateContent",
            f"-> {url}",
        )
        inline = [p for p in calls[-1]["payload"]["contents"][0]["parts"] if "inline_data" in p]
        check(bool(inline), "视频以 inline_data 送达（未丢失）")
        check(
            inline[0]["inline_data"]["mime_type"] == "video/mp4",
            "mime_type 识别为 video/mp4",
        )

        section("5. call_json 与 chat 同源（评分器链路）")
        calls.clear()
        result = await llm_service.call_json(
            [{"role": "user", "content": "打分"}],
            model="gpt-5.5",
            response_schema=llm_service.JudgeScore,
        )
        check(result["parsed"]["score"] == 1, "call_json 解析出 score")
        check(result["adapter_used"] == "openai", "call_json 返回值带 adapter_used")
        check(result["model"] == "gpt-5.5", "call_json 返回 model 等于请求 model")

        before = len(calls)
        await expect_error(
            llm_service.call_json(msgs_image(), model="glm-5.3"),
            400,
            "call_json + glm-5.3 + 图片 → 400（改造前会直接打上游）",
        )
        check(len(calls) == before, "call_json 拦截阶段零上游请求")

        section("6. 端到端：judge_inputs 走能力表")
        calls.clear()
        verdict = await judge_service.judge_inputs(
            [
                {"name": "任务要求", "modality": "text", "value": "理解视频内容并概括"},
                {"name": "待评回复", "modality": "text", "value": "视频里有人在走路"},
            ],
            rubric="命中要点即 1 分",
            model="gpt-5.5",
        )
        check(verdict["score"] == 1, "judge_inputs（纯文本）返回 score")
        check(verdict["model"] == "gpt-5.5", "judge_inputs 返回 model 等于选中的裁判模型")

        msgs = judge_service.build_messages_from_inputs(
            [{"name": "待评视频", "modality": "video", "value": "https://example.com/a.mp4"}],
            rubric="看视频判分",
        )
        parts = msgs[-1]["content"]
        check(
            isinstance(parts, list) and any(p.get("type") == "video_url" for p in parts),
            "video 入参组装成 video_url 块",
        )

        await expect_error(
            judge_service.judge_inputs(
                [{"name": "待评图片", "modality": "image", "value": "data:image/png;base64,AA=="}],
                rubric="看图判分",
                model="glm-5.3",
            ),
            400,
            "裁判选 glm-5.3 + 图片入参 → 400",
        )

        section("7. 流式前置校验")
        try:
            llm_service.validate_stream_request(msgs_video(), model="gemini-3.8-flash")
        except ServiceError as exc:
            check(exc.status_code == 400, "流式 + 视频 → 400（不再静默丢视频）", exc.message[:50])
        else:
            raise AssertionError("[FAIL] 流式 + 视频未被拦截")

        cap = llm_service.validate_stream_request(msgs_image(), model="gpt-5.6-sol")
        check(cap["provider"] == "openai", "流式 + 图片放行（图片可透传）")

        print("\n全部通过：chat / call_json / judge_inputs 共用同一条三层路由。")
        return 0
    finally:
        restore()


def msgs_text() -> list[dict[str, Any]]:
    return [{"role": "user", "content": "请回答：1+1=?"}]


def msgs_image() -> list[dict[str, Any]]:
    return [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "这张图里是什么？"},
                {"type": "image_url", "image_url": {"url": "data:image/png;base64,iVBORw0KGgo="}},
            ],
        }
    ]


def msgs_video() -> list[dict[str, Any]]:
    return [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "这段视频发生了什么？"},
                {"type": "video_url", "video_url": {"url": "data:video/mp4;base64,AAAAIGZ0eXA="}},
            ],
        }
    ]


async def expect_error(coro, status: int, label: str) -> None:
    try:
        await coro
    except ServiceError as exc:
        check(exc.status_code == status, label, f"-> {exc.status_code} {exc.message[:60]}")
        return
    raise AssertionError(f"[FAIL] {label}：未拦截，请求被放行")


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
