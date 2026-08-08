"""Lightweight /health endpoint for the Pipecat runner app.

The dashboard pings /health to wake and keep-warm the hosted runner (Render
free instances spin down when idle). The stock Pipecat runner has no health
route, so this installs one on the runner's FastAPI app after it is built.
"""

from __future__ import annotations

import logging

LOGGER = logging.getLogger("sleek_relay.voice.health_route")


def _build_health_payload() -> dict[str, object]:
    payload: dict[str, object] = {"status": "ok"}
    try:
        from .daily_room_pool import get_global_daily_room_pool

        pool = get_global_daily_room_pool()
        if pool is not None:
            payload["dailyRoomPoolAvailable"] = pool.size
    except Exception:  # noqa: BLE001
        pass
    return payload


def add_health_route_to_app(app: object) -> bool:
    """Attach GET /health to a FastAPI-style app. Returns True when added."""
    if app is None or getattr(app, "_sleek_relay_health_route", False):
        return False

    add_api_route = getattr(app, "add_api_route", None)
    if not callable(add_api_route):
        LOGGER.warning("voice worker: runner app does not support add_api_route; /health skipped")
        return False

    async def health() -> dict[str, object]:
        return _build_health_payload()

    add_api_route("/health", health, methods=["GET"])
    try:
        setattr(app, "_sleek_relay_health_route", True)
    except Exception:  # noqa: BLE001
        pass
    LOGGER.info("voice worker: /health route installed")
    return True


def install_health_route() -> None:
    """Hook Pipecat's runner server configuration to expose GET /health."""
    try:
        from pipecat.runner import run as runner_run
    except ImportError:
        LOGGER.warning("voice worker: cannot install /health route (import failed)")
        return

    if getattr(runner_run, "_sleek_relay_health_route_installed", False):
        return

    original_configure = getattr(runner_run, "_configure_server_app", None)
    if not callable(original_configure):
        LOGGER.warning("voice worker: Pipecat runner has no server hook for /health route")
        return

    def patched_configure_server(args: object) -> None:
        original_configure(args)
        app = getattr(runner_run, "app", None)
        try:
            add_health_route_to_app(app)
        except Exception:  # noqa: BLE001
            LOGGER.exception("voice worker: failed to install /health route")

    setattr(runner_run, "_configure_server_app", patched_configure_server)
    setattr(runner_run, "_sleek_relay_health_route_installed", True)
    LOGGER.info("voice worker: /health route hook installed")
