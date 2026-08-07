from __future__ import annotations

import asyncio
import json
import unittest
from types import SimpleNamespace

from app.deepgram_pool import (
    DeepgramWarmPool,
    WarmDeepgramConnection,
    build_deepgram_flux_url,
    reset_global_deepgram_warm_pool_for_tests,
)


class FakeWebsocket:
    def __init__(self, messages: list[object] | None = None) -> None:
        self.messages = list(messages or [])
        self.sent: list[object] = []
        self.ping_calls = 0
        self.close_calls = 0
        self.state = SimpleNamespace(name="OPEN")
        self.closed = False

    async def recv(self) -> object:
        if not self.messages:
            await asyncio.sleep(3600)
            return ""
        return self.messages.pop(0)

    async def send(self, payload: object) -> None:
        self.sent.append(payload)

    def ping(self) -> asyncio.Future[None]:
        self.ping_calls += 1
        loop = asyncio.get_running_loop()
        future: asyncio.Future[None] = loop.create_future()
        future.set_result(None)
        return future

    async def close(self) -> None:
        self.close_calls += 1
        self.closed = True
        self.state = SimpleNamespace(name="CLOSED")


class DeepgramWarmPoolTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        reset_global_deepgram_warm_pool_for_tests()

    def tearDown(self) -> None:
        reset_global_deepgram_warm_pool_for_tests()

    def test_build_deepgram_flux_url(self) -> None:
        url = build_deepgram_flux_url(model="flux-general-en", sample_rate=16000)
        self.assertEqual(
            url,
            "wss://api.deepgram.com/v2/listen?model=flux-general-en&sample_rate=16000&encoding=linear16",
        )

    async def test_start_creates_ready_connection(self) -> None:
        created: list[FakeWebsocket] = []

        async def fake_connect(url: str, additional_headers: dict[str, str] | None = None) -> FakeWebsocket:
            websocket = FakeWebsocket(messages=[json.dumps({"type": "Connected"})])
            created.append(websocket)
            self.assertIn("flux-general-en", url)
            self.assertEqual((additional_headers or {}).get("Authorization"), "Token dg-key")
            return websocket

        pool = DeepgramWarmPool(
            api_key="dg-key",
            model="flux-general-en",
            pool_size=1,
            websocket_connect=fake_connect,
        )
        await pool.start()
        self.assertEqual(pool.size, 1)
        self.assertEqual(len(created), 1)

        warm = await pool.acquire()
        assert warm is not None
        self.assertIs(warm.websocket, created[0])
        self.assertEqual(pool.size, 0)

        await pool.stop()

    async def test_acquire_skips_closed_sockets(self) -> None:
        async def reject_refill(url: str, additional_headers: dict[str, str] | None = None) -> FakeWebsocket:
            raise RuntimeError("refill should not be required for this test")

        pool = DeepgramWarmPool(
            api_key="dg-key",
            model="flux-general-en",
            pool_size=1,
            websocket_connect=reject_refill,
        )
        closed = FakeWebsocket()
        await closed.close()
        open_ws = FakeWebsocket()
        await pool._available.put(
            WarmDeepgramConnection(
                websocket=closed,
                url=pool.url,
                model="flux-general-en",
                sample_rate=16000,
            )
        )
        await pool._available.put(
            WarmDeepgramConnection(
                websocket=open_ws,
                url=pool.url,
                model="flux-general-en",
                sample_rate=16000,
            )
        )

        warm = await pool.acquire()
        assert warm is not None
        self.assertIs(warm.websocket, open_ws)
        await pool.stop()

    async def test_requeue_returns_open_socket(self) -> None:
        async def reject_refill(url: str, additional_headers: dict[str, str] | None = None) -> FakeWebsocket:
            raise RuntimeError("refill should not be required for this test")

        pool = DeepgramWarmPool(
            api_key="dg-key",
            model="flux-general-en",
            pool_size=1,
            websocket_connect=reject_refill,
        )
        websocket = FakeWebsocket()
        warm = WarmDeepgramConnection(
            websocket=websocket,
            url=pool.url,
            model="flux-general-en",
            sample_rate=16000,
        )
        await pool.requeue(warm)
        self.assertEqual(pool.size, 1)
        acquired = await pool.acquire()
        assert acquired is not None
        self.assertIs(acquired.websocket, websocket)
        await pool.stop()


if __name__ == "__main__":
    unittest.main()
