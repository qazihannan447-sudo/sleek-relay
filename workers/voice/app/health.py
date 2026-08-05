from __future__ import annotations

from datetime import UTC, datetime


def get_health_payload() -> dict[str, object]:
    return {
        "ok": True,
        "service": "voice-worker",
        "timestamp": datetime.now(UTC).isoformat(),
    }

