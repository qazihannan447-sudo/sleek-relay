"""Boot-time Daily room pool.

Creating a Daily room on every Connect (POST /rooms) is a major latency cost.
This pool pre-creates rooms when the worker starts, hands one out on /start,
mints a fresh meeting token at adopt time, and refills in the background.
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
import uuid
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlparse


LOGGER = logging.getLogger("sleek_relay.voice.daily_room_pool")

DEFAULT_DAILY_API_URL = "https://api.daily.co/v1"
DEFAULT_POOL_SIZE = 1
DEFAULT_ROOM_TTL_HOURS = 1.0
# Discard pooled rooms that would expire too soon after Connect.
DEFAULT_MIN_REMAINING_SECS = 5 * 60
DEFAULT_TOKEN_EXP_HOURS = 2.0

_GLOBAL_POOL: "DailyRoomPool | None" = None
_GLOBAL_POOL_LOCK = asyncio.Lock()


@dataclass(frozen=True)
class PooledDailyRoom:
    name: str
    url: str
    exp_at: float


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
        return int(raw)
    except ValueError:
        return default


def _env_float(name: str, default: float) -> float:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def room_name_from_url(room_url: str) -> str:
    path = urlparse(room_url).path.strip("/")
    return path.split("/")[-1] if path else ""


class DailyRoomPool:
    """Maintain ready Daily rooms for near-instant /start adopt."""

    def __init__(
        self,
        *,
        api_key: str,
        api_url: str = DEFAULT_DAILY_API_URL,
        pool_size: int = DEFAULT_POOL_SIZE,
        room_ttl_hours: float = DEFAULT_ROOM_TTL_HOURS,
        min_remaining_secs: float = DEFAULT_MIN_REMAINING_SECS,
        create_room: Any | None = None,
        delete_room: Any | None = None,
        monotonic_clock: Any | None = None,
    ) -> None:
        self._api_key = api_key
        self._api_url = api_url.rstrip("/")
        self._pool_size = max(0, pool_size)
        self._room_ttl_hours = max(0.25, room_ttl_hours)
        self._min_remaining_secs = max(30.0, min_remaining_secs)
        self._create_room = create_room
        self._delete_room = delete_room
        self._monotonic = monotonic_clock or time.time
        self._available: asyncio.Queue[PooledDailyRoom] = asyncio.Queue()
        self._lock = asyncio.Lock()
        self._refill_task: asyncio.Task[None] | None = None
        self._stopped = False
        self._inflight_creates = 0
        self._http_session: Any | None = None

    @property
    def size(self) -> int:
        return self._available.qsize()

    async def start(self) -> None:
        if self._pool_size <= 0:
            LOGGER.info("voice worker: Daily room pool disabled (size=0)")
            return

        LOGGER.info(
            "voice worker: Daily room pool starting size=%s ttl_hours=%s",
            self._pool_size,
            self._room_ttl_hours,
        )
        await self._fill_to_target()
        LOGGER.info(
            "voice worker: Daily room pool ready available=%s",
            self._available.qsize(),
        )

    async def stop(self) -> None:
        self._stopped = True
        if self._refill_task is not None:
            self._refill_task.cancel()
            try:
                await self._refill_task
            except asyncio.CancelledError:
                pass
            self._refill_task = None

        while not self._available.empty():
            try:
                room = self._available.get_nowait()
            except asyncio.QueueEmpty:
                break
            await self._discard_room(room)

        await self._close_http_session()

    async def acquire(self) -> PooledDailyRoom | None:
        if self._stopped or self._pool_size <= 0:
            return None

        now = float(self._monotonic())
        while True:
            try:
                room = self._available.get_nowait()
            except asyncio.QueueEmpty:
                self._schedule_refill()
                return None

            remaining = room.exp_at - now
            if remaining < self._min_remaining_secs:
                LOGGER.info(
                    "voice worker: discarding soon-to-expire pooled Daily room name=%s remaining_s=%.0f",
                    room.name,
                    remaining,
                )
                await self._discard_room(room)
                continue

            self._schedule_refill()
            LOGGER.info(
                "voice worker: adopted pooled Daily room name=%s remaining_s=%.0f",
                room.name,
                remaining,
            )
            return room

    def _schedule_refill(self) -> None:
        if self._stopped or self._pool_size <= 0:
            return
        if self._refill_task is not None and not self._refill_task.done():
            return
        self._refill_task = asyncio.create_task(
            self._fill_to_target(),
            name="daily-room-pool-refill",
        )

    async def _fill_to_target(self) -> None:
        async with self._lock:
            while (
                not self._stopped
                and (self._available.qsize() + self._inflight_creates) < self._pool_size
            ):
                self._inflight_creates += 1
                try:
                    room = await self._create_pooled_room()
                    if self._stopped:
                        await self._discard_room(room)
                        return
                    await self._available.put(room)
                    LOGGER.info(
                        "voice worker: pooled Daily room ready name=%s available=%s",
                        room.name,
                        self._available.qsize(),
                    )
                except Exception:  # noqa: BLE001
                    LOGGER.exception("voice worker: Daily room pool create failed")
                    return
                finally:
                    self._inflight_creates = max(0, self._inflight_creates - 1)

    async def _create_pooled_room(self) -> PooledDailyRoom:
        name = f"sleek-{uuid.uuid4().hex[:8]}"
        exp_at = float(self._monotonic()) + (self._room_ttl_hours * 60 * 60)

        if self._create_room is not None:
            url = await self._create_room(name=name, exp_at=exp_at)
            return PooledDailyRoom(name=name, url=str(url), exp_at=exp_at)

        payload = {
            "name": name,
            "privacy": "private",
            "properties": {
                "exp": exp_at,
                "eject_at_room_exp": True,
            },
        }
        data = await self._request_json("POST", "/rooms", payload)
        url = str(data.get("url") or "")
        if not url:
            raise RuntimeError("Daily create room response missing url")
        return PooledDailyRoom(name=name, url=url, exp_at=exp_at)

    async def _discard_room(self, room: PooledDailyRoom) -> None:
        try:
            if self._delete_room is not None:
                await self._delete_room(room.name)
                return
            await self._request_json("DELETE", f"/rooms/{room.name}")
        except Exception:  # noqa: BLE001
            LOGGER.warning(
                "voice worker: failed to delete pooled Daily room name=%s",
                room.name,
                exc_info=True,
            )

    async def _ensure_http_session(self) -> Any:
        if self._http_session is not None and not getattr(self._http_session, "closed", False):
            return self._http_session

        import aiohttp

        self._http_session = aiohttp.ClientSession()
        return self._http_session

    async def _close_http_session(self) -> None:
        session = self._http_session
        self._http_session = None
        if session is None:
            return
        close = getattr(session, "close", None)
        if not callable(close):
            return
        try:
            result = close()
            if asyncio.iscoroutine(result):
                await result
        except Exception:  # noqa: BLE001
            pass

    async def _request_json(
        self,
        method: str,
        path: str,
        payload: dict[str, object] | None = None,
    ) -> dict[str, object]:
        session = await self._ensure_http_session()
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }
        url = f"{self._api_url}{path}"
        async with session.request(method, url, headers=headers, json=payload) as response:
            text = await response.text()
            if response.status >= 400:
                raise RuntimeError(
                    f"Daily API {method} {path} failed status={response.status} body={text[:300]}"
                )
            if not text:
                return {}
            import json

            data = json.loads(text)
            if not isinstance(data, dict):
                return {}
            return data


async def get_or_start_global_daily_room_pool(
    *,
    api_key: str | None = None,
) -> DailyRoomPool | None:
    """Start (or return) the process-wide Daily room pool."""
    global _GLOBAL_POOL

    if not _env_flag("DAILY_ROOM_POOL_ENABLED", default=True):
        LOGGER.info("voice worker: Daily room pool disabled by DAILY_ROOM_POOL_ENABLED")
        return None

    resolved_key = (api_key or os.getenv("DAILY_API_KEY") or "").strip()
    if not resolved_key:
        LOGGER.warning("voice worker: Daily room pool skipped (DAILY_API_KEY missing)")
        return None

    async with _GLOBAL_POOL_LOCK:
        if _GLOBAL_POOL is not None:
            return _GLOBAL_POOL

        pool = DailyRoomPool(
            api_key=resolved_key,
            api_url=os.getenv("DAILY_API_URL", DEFAULT_DAILY_API_URL).strip()
            or DEFAULT_DAILY_API_URL,
            pool_size=_env_int("DAILY_ROOM_POOL_SIZE", DEFAULT_POOL_SIZE),
            room_ttl_hours=_env_float("DAILY_ROOM_POOL_TTL_HOURS", DEFAULT_ROOM_TTL_HOURS),
            min_remaining_secs=_env_float(
                "DAILY_ROOM_POOL_MIN_REMAINING_SECS",
                DEFAULT_MIN_REMAINING_SECS,
            ),
        )
        try:
            await pool.start()
        except Exception:  # noqa: BLE001
            LOGGER.exception("voice worker: Daily room pool failed to start")
            await pool.stop()
            return None

        _GLOBAL_POOL = pool
        return _GLOBAL_POOL


def get_global_daily_room_pool() -> DailyRoomPool | None:
    return _GLOBAL_POOL


async def stop_global_daily_room_pool() -> None:
    global _GLOBAL_POOL
    async with _GLOBAL_POOL_LOCK:
        pool = _GLOBAL_POOL
        _GLOBAL_POOL = None
    if pool is not None:
        await pool.stop()


def reset_global_daily_room_pool_for_tests() -> None:
    global _GLOBAL_POOL
    _GLOBAL_POOL = None


def install_daily_room_pool_lifespan() -> None:
    """Warm Daily rooms at worker boot and adopt them from Pipecat configure()."""
    try:
        from contextlib import asynccontextmanager

        from pipecat.runner import run as runner_run
        import pipecat.runner.daily as daily_runner
    except ImportError:
        LOGGER.warning("voice worker: cannot install Daily room pool (import failed)")
        return

    if getattr(daily_runner, "_sleek_relay_daily_room_pool_installed", False):
        return

    original_configure = daily_runner.configure

    async def pooled_configure(aiohttp_session: object, *args: object, **kwargs: object):
        sip_caller_phone = kwargs.get("sip_caller_phone")
        room_properties = kwargs.get("room_properties")
        sip_enabled = sip_caller_phone is not None
        if room_properties is not None and getattr(room_properties, "sip", None) is not None:
            sip_enabled = True

        existing_room_url = os.getenv("DAILY_ROOM_URL")
        if sip_enabled or existing_room_url:
            return await original_configure(aiohttp_session, *args, **kwargs)

        pool = get_global_daily_room_pool()
        room = await pool.acquire() if pool is not None else None
        if room is None:
            return await original_configure(aiohttp_session, *args, **kwargs)

        try:
            from pipecat.runner.daily import DailyRoomConfig
            from pipecat.transports.daily.utils import (
                DailyMeetingTokenParams,
                DailyRESTHelper,
            )
        except ImportError:
            return await original_configure(aiohttp_session, *args, **kwargs)

        api_key = kwargs.get("api_key") or os.getenv("DAILY_API_KEY")
        if not api_key:
            return await original_configure(aiohttp_session, *args, **kwargs)

        token_exp_duration = float(kwargs.get("token_exp_duration") or DEFAULT_TOKEN_EXP_HOURS)
        token_properties = kwargs.get("token_properties")
        helper = DailyRESTHelper(
            daily_api_key=str(api_key),
            daily_api_url=os.getenv("DAILY_API_URL", DEFAULT_DAILY_API_URL),
            aiohttp_session=aiohttp_session,
        )
        token_params = None
        if token_properties is not None:
            token_params = DailyMeetingTokenParams(properties=token_properties)
        token = await helper.get_token(
            room.url,
            token_exp_duration * 60 * 60,
            params=token_params,
        )
        LOGGER.info("voice worker: /start using pooled Daily room name=%s", room.name)
        return DailyRoomConfig(room_url=room.url, token=token)

    daily_runner.configure = pooled_configure  # type: ignore[assignment]

    @asynccontextmanager
    async def daily_room_pool_lifespan(app: object):
        try:
            await get_or_start_global_daily_room_pool()
        except Exception:  # noqa: BLE001
            LOGGER.exception("voice worker: Daily room pool lifespan start failed")
        try:
            yield
        finally:
            await stop_global_daily_room_pool()

    original_configure_server = getattr(runner_run, "_configure_server_app", None)
    original_add = getattr(runner_run, "_add_lifespan_to_app", None)

    if callable(original_configure_server) and callable(original_add):
        def patched_configure_server(args: object) -> None:
            original_configure_server(args)
            app = getattr(runner_run, "app", None)
            if app is not None and not getattr(app, "_sleek_relay_daily_room_pool_lifespan", False):
                original_add(app, daily_room_pool_lifespan)
                try:
                    setattr(app, "_sleek_relay_daily_room_pool_lifespan", True)
                except Exception:  # noqa: BLE001
                    pass

        setattr(runner_run, "_configure_server_app", patched_configure_server)
    elif callable(original_add):
        def patched_add_lifespan(app: object, new_lifespan: object) -> None:
            @asynccontextmanager
            async def combined_lifespan(app_inner: object):
                async with daily_room_pool_lifespan(app_inner):
                    async with new_lifespan(app_inner):  # type: ignore[misc]
                        yield

            original_add(app, combined_lifespan)

        setattr(runner_run, "_add_lifespan_to_app", patched_add_lifespan)
    else:
        LOGGER.warning("voice worker: Pipecat runner has no lifespan hook for Daily room pool")

    setattr(daily_runner, "_sleek_relay_daily_room_pool_installed", True)
    LOGGER.info("voice worker: Daily room pool configure patch + lifespan hook installed")
