# -*- coding: utf-8 -*-
"""llm_service 事件循环亲和性验证：跨事件循环复用 httpx 客户端不再报错。

背景：`_get_client()` 曾是裸的进程级单例，client 绑定「第一个创建它的事件循环」。
uvicorn 单循环下没问题，但测试（每个 TestClient 各一个循环）、脚本里连续
`asyncio.run`、`--reload` 重启都会换循环，于是第二次起就
`RuntimeError: Event loop is closed`（对外表现为 502「连接上游 LLM 失败」）。

本测试不联网：假上游跑在独立线程的事件循环里，被测客户端在多个
`asyncio.run` 里反复创建/销毁，真正走 httpx 连接池，
所以验证的是「换循环后连接确实还能用」，而不只是对象引用变了。

运行：cd backend && python loop_affinity_test.py
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
import threading
from typing import Any

try:
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
except Exception:  # noqa: BLE001
    pass

OK_BODY = json.dumps(
    {"score": 1, "pass": True, "evidence_analysis": "ok", "reason": "ok"}, ensure_ascii=False
)


def check(cond: bool, label: str, detail: str = "") -> None:
    if not cond:
        raise AssertionError(f"[FAIL] {label} {detail}")
    print(f"  OK {label} {detail}")


def section(title: str) -> None:
    print(f"\n{'=' * 62}\n{title}\n{'=' * 62}")


# ── 假上游：独立线程 + 独立事件循环，与被测循环彻底隔离 ──
async def _handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    """keep-alive 应答：同一条连接上反复服务，让客户端真的把连接放进池子里复用。

    这一点很关键——只有池中存在「属于旧事件循环的连接」，
    换循环后再用才会触发 Event loop is closed。
    """
    try:
        while True:
            head = await reader.readuntil(b"\r\n\r\n")
            text = head.decode("latin-1", "replace").lower()
            length = 0
            for line in text.split("\r\n"):
                if line.startswith("content-length:"):
                    length = int(line.split(":", 1)[1].strip())
            if length:
                await reader.readexactly(length)

            body = json.dumps(
                {
                    "model": "fake-upstream",
                    "choices": [{"message": {"content": OK_BODY}}],
                    "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
                }
            ).encode()
            writer.write(
                b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n"
                + f"Content-Length: {len(body)}\r\nConnection: keep-alive\r\n\r\n".encode()
                + body
            )
            await writer.drain()
    except (asyncio.IncompleteReadError, ConnectionResetError):
        pass
    except Exception:  # noqa: BLE001
        pass
    finally:
        try:
            writer.close()
        except Exception:  # noqa: BLE001
            pass


class FakeUpstream:
    """在后台线程里跑 asyncio server，主线程可随意创建/销毁事件循环。"""

    def __init__(self) -> None:
        self.port = 0
        self._ready = threading.Event()
        self._stop: asyncio.Event | None = None
        self._loop: asyncio.AbstractEventLoop | None = None
        self._thread = threading.Thread(target=self._run, daemon=True)

    def _run(self) -> None:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        self._loop = loop
        self._stop = asyncio.Event()

        async def serve() -> None:
            server = await asyncio.start_server(_handle, "127.0.0.1", 0)
            self.port = server.sockets[0].getsockname()[1]
            self._ready.set()
            async with server:
                await self._stop.wait()  # type: ignore[union-attr]

        loop.run_until_complete(serve())
        loop.close()

    def start(self) -> "FakeUpstream":
        self._thread.start()
        if not self._ready.wait(10):
            raise RuntimeError("假上游启动超时")
        return self

    def stop(self) -> None:
        # Event.set() 必须回到它所属的循环线程执行
        if self._loop is not None and self._stop is not None:
            try:
                self._loop.call_soon_threadsafe(self._stop.set)
            except RuntimeError:
                pass
        self._thread.join(timeout=5)


def set_env(port: int) -> None:
    os.environ["LLM_BASE_URL"] = f"http://127.0.0.1:{port}/v1"
    os.environ["LLM_API_KEY"] = "sk-loop-test"
    from app.config import llm_settings

    llm_settings.cache_clear()



async def one_round(tag: str) -> dict[str, Any]:
    """在「当前这个事件循环」里跑一次真实 HTTP 调用。"""
    from app.services import llm_service

    result = await llm_service.chat([{"role": "user", "content": "hi"}], model="gpt-5.6-sol")
    print(f"  [{tag}] adapter={result['adapter_used']} model={result['model']}")
    return result


async def loop_a() -> None:
    """第一个事件循环：建 client、真实调用一次。"""
    from app.services import llm_service

    section("1. 同一事件循环内复用 client")
    c1 = await llm_service._get_client()
    c2 = await llm_service._get_client()
    check(c1 is c2, "同一循环内 client 复用（连接池不重建）")
    check(not c1.is_closed, "client 处于可用状态")

    section("2. 第一个事件循环里真实调用")
    r = await one_round("loop-A")
    check(r["adapter_used"] == "openai", "调用成功")


async def loop_b() -> None:
    """全新的第二个事件循环：修复前这里必然 Event loop is closed。"""
    from app.services import llm_service

    section("3. 第二个事件循环再调用（关键回归点）")
    try:
        r = await one_round("loop-B")
    except Exception as exc:  # noqa: BLE001
        raise AssertionError(
            f"[FAIL] 换循环后调用失败（修复前正是这个症状）：{type(exc).__name__}: {exc}"
        ) from exc
    check(r["adapter_used"] == "openai", "未报 Event loop is closed")

    section("4. 信号量同样跟随循环")
    s1 = await llm_service._get_semaphore()
    check(isinstance(s1, asyncio.Semaphore), "semaphore 可用")

    section("5. close_client 幂等且清空归属")
    await llm_service.close_client()
    check(llm_service._client is None, "close_client 后 _client 已清空")
    check(llm_service._client_loop is None, "close_client 后 _client_loop 已清空")
    await llm_service.close_client()
    print("  OK close_client 可重复调用")

    section("6. close_client 之后继续工作（自动重建）")
    r3 = await one_round("after-close")
    check(r3["adapter_used"] == "openai", "关闭后自动重建，调用仍成功")


async def loop_c() -> None:
    """第三个循环：确认前面循环已销毁，这里仍然能跑。"""
    from app.services import llm_service

    section("7. 第三个事件循环（模拟测试串跑）")
    r = await one_round("loop-C")
    check(r["adapter_used"] == "openai", "第三个循环依然可用")
    await llm_service.close_client()


def main() -> int:
    upstream = FakeUpstream().start()
    print(f"  假上游已启动：127.0.0.1:{upstream.port}")
    set_env(upstream.port)
    try:
        rc = 0
        for name, fn in (("A", loop_a), ("B", loop_b), ("C", loop_c)):
            print(f"\n>>> asyncio.run({name})：一个全新事件循环")
            rc = asyncio.run(fn()) or rc
        print("\n全部通过：httpx client / 信号量已与事件循环解耦。")
        return int(rc or 0)
    finally:
        upstream.stop()


if __name__ == "__main__":
    raise SystemExit(main())
