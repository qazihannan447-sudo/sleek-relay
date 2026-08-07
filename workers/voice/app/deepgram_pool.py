"""Boot-time Deepgram Flux WebSocket warm pool.

Deepgram connection latency (DNS + TCP + TLS + WebSocket + Flux Connected) is a
one-time cost that otherwise blocks every Connect. This pool opens Flux sockets
when the worker process starts, keeps them alive, and hands a ready socket to
each session so StartFrame does not pay a cold handshake.

Flux does not accept Nova's JSON KeepAlive. Idle sockets are kept alive with
native WebSocket pings.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlencode


LOGGER = logging.getLogger("sleek_relay.voice.deepgram_pool")

DEFAULT_DEEPGRAM_FLUX_URL = "wss://api.deepgram.com/v2/listen"
DEFAULT_SAMPLE_RATE = 16000
DEFAULT_ENCODING = "linear16"
DEFAULT_POOL_SIZE = 1
DEFAULT_KEEPALIVE_SECS = 10.0
DEFAULT_CONNECT_TIMEOUT_SECS = 20.0

_GLOBAL_POOL: "DeepgramWarmPool | None" = None
_GLOBAL_POOL_LOCK = asyncio.Lock()


@dataclass
class WarmDeepgramConnection:
    websocket: Any
    url: str
    model: str
    sample_rate: int


def build_deepgram_flux_url(
    *,
    model: str,
    sample_rate: int = DEFAULT_SAMPLE_RATE,
    encoding: str = DEFAULT_ENCODING,
    base_url: str = DEFAULT_DEEPGRAM_FLUX_URL,
) -> str:
    query = urlencode(
        {
            "model": model,
            "sample_rate": str(sample_rate),
            "encoding": encoding,
        }
    )
    return f"{base_url}?{query}"


def _env_flag(name: str, default: bool = True) -> bool:
    raw = os.environ.get(name, "1" if default else "0").strip().lower()
    if not raw:
        return default
    return raw not in {"0", "false", "no", "off"}


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError:
        return default
    return value


def _env_float(name: str, default: float) -> float:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        value = float(raw)
    except ValueError:
        return default
    return value


class DeepgramWarmPool:
    """Maintain ready Deepgram Flux WebSockets for near-instant session acquire."""

    def __init__(
        self,
        *,
        api_key: str,
        model: str,
        sample_rate: int = DEFAULT_SAMPLE_RATE,
        pool_size: int = DEFAULT_POOL_SIZE,
        keepalive_secs: float = DEFAULT_KEEPALIVE_SECS,
        connect_timeout_secs: float = DEFAULT_CONNECT_TIMEOUT_SECS,
        base_url: str = DEFAULT_DEEPGRAM_FLUX_URL,
        websocket_connect: Any | None = None,
    ) -> None:
        self._api_key = api_key
        self._model = model
        self._sample_rate = sample_rate
        self._pool_size = max(0, pool_size)
        self._keepalive_secs = max(1.0, keepalive_secs)
        self._connect_timeout_secs = max(1.0, connect_timeout_secs)
        self._base_url = base_url
        self._websocket_connect = websocket_connect
        self._url = build_deepgram_flux_url(
            model=model,
            sample_rate=sample_rate,
            base_url=base_url,
        )
        self._available: asyncio.Queue[WarmDeepgramConnection] = asyncio.Queue()
        self._lock = asyncio.Lock()
        # Serializes acquire/keepalive so ping cannot drain the queue out from
        # under a concurrent session acquire (which forced cold connects).
        self._sockets_lock = asyncio.Lock()
        self._keepalive_task: asyncio.Task[None] | None = None
        self._refill_task: asyncio.Task[None] | None = None
        self._stopped = False
        self._inflight_creates = 0

    @property
    def url(self) -> str:
        return self._url

    @property
    def size(self) -> int:
        return self._available.qsize()

    async def start(self) -> None:
        if self._pool_size <= 0:
            LOGGER.info("voice worker: Deepgram warm pool disabled (size=0)")
            return

        LOGGER.info(
            "voice worker: Deepgram warm pool starting size=%s model=%s sample_rate=%s",
            self._pool_size,
            self._model,
            self._sample_rate,
        )
        await self._fill_to_target()
        if self._keepalive_task is None:
            self._keepalive_task = asyncio.create_task(
                self._keepalive_loop(),
                name="deepgram-warm-pool-keepalive",
            )
        LOGGER.info(
            "voice worker: Deepgram warm pool ready available=%s",
            self._available.qsize(),
        )

    async def stop(self) -> None:
        self._stopped = True
        if self._keepalive_task is not None:
            self._keepalive_task.cancel()
            try:
                await self._keepalive_task
            except asyncio.CancelledError:
                pass
            self._keepalive_task = None

        if self._refill_task is not None:
            self._refill_task.cancel()
            try:
                await self._refill_task
            except asyncio.CancelledError:
                pass
            self._refill_task = None

        async with self._sockets_lock:
            while not self._available.empty():
                try:
                    warm = self._available.get_nowait()
                except asyncio.QueueEmpty:
                    break
                await self._close_websocket(warm.websocket)

    async def acquire(self, *, url: str | None = None) -> WarmDeepgramConnection | None:
        """Take one ready connection. Returns None if none match / available."""
        if self._stopped or self._pool_size <= 0:
            return None

        expected_url = url or self._url

        async with self._sockets_lock:
            while True:
                try:
                    warm = self._available.get_nowait()
                except asyncio.QueueEmpty:
                    self._schedule_refill()
                    return None

                if warm.url != expected_url or not self._is_open(warm.websocket):
                    await self._close_websocket(warm.websocket)
                    continue

                self._schedule_refill()
                LOGGER.info(
                    "voice worker: Deepgram warm pool acquired available=%s",
                    self._available.qsize(),
                )
                return warm

    def _schedule_refill(self) -> None:
        if self._stopped or self._pool_size <= 0:
            return
        if self._refill_task is not None and not self._refill_task.done():
            return
        self._refill_task = asyncio.create_task(
            self._fill_to_target(),
            name="deepgram-warm-pool-refill",
        )

    async def _fill_to_target(self) -> None:
        async with self._lock:
            while (
                not self._stopped
                and (self._available.qsize() + self._inflight_creates) < self._pool_size
            ):
                self._inflight_creates += 1
                try:
                    warm = await self._create_connection()
                except Exception:  # noqa: BLE001
                    LOGGER.exception("voice worker: Deepgram warm pool create failed")
                    self._inflight_creates -= 1
                    break
                else:
                    self._inflight_creates -= 1
                    if self._stopped:
                        await self._close_websocket(warm.websocket)
                        break
                    await self._available.put(warm)

    async def _create_connection(self) -> WarmDeepgramConnection:
        connect = self._websocket_connect
        if connect is None:
            from websockets.asyncio.client import connect as websocket_connect

            connect = websocket_connect

        websocket = await asyncio.wait_for(
            connect(
                self._url,
                additional_headers={"Authorization": f"Token {self._api_key}"},
            ),
            timeout=self._connect_timeout_secs,
        )

        try:
            await asyncio.wait_for(
                self._wait_for_connected_message(websocket),
                timeout=self._connect_timeout_secs,
            )
        except Exception:
            await self._close_websocket(websocket)
            raise

        LOGGER.info("voice worker: Deepgram warm pool connection established")
        return WarmDeepgramConnection(
            websocket=websocket,
            url=self._url,
            model=self._model,
            sample_rate=self._sample_rate,
        )

    async def _wait_for_connected_message(self, websocket: Any) -> None:
        while True:
            message = await websocket.recv()
            if isinstance(message, bytes):
                continue
            try:
                payload = json.loads(message)
            except json.JSONDecodeError:
                continue
            if not isinstance(payload, dict):
                continue
            message_type = payload.get("type")
            if message_type == "Connected":
                return
            if message_type == "Error":
                raise RuntimeError(f"Deepgram Flux warm connect error: {payload}")

    async def _keepalive_loop(self) -> None:
        while not self._stopped:
            await asyncio.sleep(self._keepalive_secs)
            await self._ping_available()

    async def _ping_available(self) -> None:
        async with self._sockets_lock:
            retained: list[WarmDeepgramConnection] = []
            while True:
                try:
                    warm = self._available.get_nowait()
                except asyncio.QueueEmpty:
                    break

                if not self._is_open(warm.websocket):
                    await self._close_websocket(warm.websocket)
                    continue

                try:
                    # Flux keepalive is native WebSocket ping (not Nova JSON KeepAlive).
                    ping = getattr(warm.websocket, "ping", None)
                    if callable(ping):
                        result = ping()
                        if asyncio.iscoroutine(result):
                            await result
                        elif asyncio.isfuture(result) or isinstance(result, asyncio.Task):
                            await result
                    retained.append(warm)
                except Exception:  # noqa: BLE001
                    LOGGER.warning(
                        "voice worker: Deepgram warm pool keepalive failed; dropping socket"
                    )
                    await self._close_websocket(warm.websocket)

            for warm in retained:
                await self._available.put(warm)

            if len(retained) < self._pool_size:
                self._schedule_refill()

    async def requeue(self, warm: WarmDeepgramConnection) -> None:
        """Return a connection to the pool when session adopt fails early."""
        if self._stopped or not self._is_open(warm.websocket):
            await self._close_websocket(warm.websocket)
            self._schedule_refill()
            return
        async with self._sockets_lock:
            await self._available.put(warm)

    @staticmethod
    def _is_open(websocket: Any) -> bool:
        state = getattr(websocket, "state", None)
        if state is not None:
            name = getattr(state, "name", str(state))
            return str(name).upper() == "OPEN"
        closed = getattr(websocket, "closed", None)
        if closed is None:
            # Some test doubles / wrappers expose neither state nor closed.
            return True
        return closed is False

    @staticmethod
    async def _close_websocket(websocket: Any) -> None:
        close = getattr(websocket, "close", None)
        if not callable(close):
            return
        try:
            result = close()
            if asyncio.iscoroutine(result):
                await result
        except Exception:  # noqa: BLE001
            pass


async def get_or_start_global_deepgram_warm_pool(
    *,
    api_key: str,
    model: str,
    sample_rate: int | None = None,
) -> DeepgramWarmPool | None:
    """Start (or return) the process-wide warm pool on the current event loop."""
    global _GLOBAL_POOL

    if not _env_flag("DEEPGRAM_WARM_POOL_ENABLED", default=True):
        LOGGER.info("voice worker: Deepgram warm pool disabled by DEEPGRAM_WARM_POOL_ENABLED")
        return None

    async with _GLOBAL_POOL_LOCK:
        if _GLOBAL_POOL is not None:
            return _GLOBAL_POOL

        pool = DeepgramWarmPool(
            api_key=api_key,
            model=model,
            sample_rate=sample_rate
            if sample_rate is not None
            else _env_int("DEEPGRAM_WARM_SAMPLE_RATE", DEFAULT_SAMPLE_RATE),
            pool_size=_env_int("DEEPGRAM_WARM_POOL_SIZE", DEFAULT_POOL_SIZE),
            keepalive_secs=_env_float("DEEPGRAM_WARM_KEEPALIVE_SECS", DEFAULT_KEEPALIVE_SECS),
        )
        try:
            await pool.start()
        except Exception:  # noqa: BLE001
            LOGGER.exception("voice worker: Deepgram warm pool failed to start")
            await pool.stop()
            return None

        _GLOBAL_POOL = pool
        return _GLOBAL_POOL


def get_global_deepgram_warm_pool() -> DeepgramWarmPool | None:
    return _GLOBAL_POOL


async def stop_global_deepgram_warm_pool() -> None:
    global _GLOBAL_POOL
    async with _GLOBAL_POOL_LOCK:
        pool = _GLOBAL_POOL
        _GLOBAL_POOL = None
    if pool is not None:
        await pool.stop()


def reset_global_deepgram_warm_pool_for_tests() -> None:
    """Test helper — drop the process singleton without awaiting stop."""
    global _GLOBAL_POOL
    _GLOBAL_POOL = None
