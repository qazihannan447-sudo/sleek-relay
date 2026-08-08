from __future__ import annotations

import asyncio
import os
import unittest
from unittest.mock import patch

from app.bot import (
    DEFAULT_CLIENT_NO_SHOW_TIMEOUT_SECS,
    enforce_client_no_show_timeout,
    resolve_client_no_show_timeout_secs,
)


class FakePipelineTask:
    def __init__(self) -> None:
        self.cancel_reasons: list[str | None] = []

    async def cancel(self, reason: str | None = None) -> None:
        self.cancel_reasons.append(reason)


class ResolveClientNoShowTimeoutTests(unittest.TestCase):
    def test_defaults_without_env(self) -> None:
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("VOICE_CLIENT_NO_SHOW_TIMEOUT_SECS", None)
            self.assertEqual(
                resolve_client_no_show_timeout_secs(),
                DEFAULT_CLIENT_NO_SHOW_TIMEOUT_SECS,
            )

    def test_env_override(self) -> None:
        with patch.dict(os.environ, {"VOICE_CLIENT_NO_SHOW_TIMEOUT_SECS": "45.5"}):
            self.assertEqual(resolve_client_no_show_timeout_secs(), 45.5)

    def test_invalid_and_non_positive_values_fall_back(self) -> None:
        for raw in ("abc", "0", "-3"):
            with patch.dict(os.environ, {"VOICE_CLIENT_NO_SHOW_TIMEOUT_SECS": raw}):
                self.assertEqual(
                    resolve_client_no_show_timeout_secs(),
                    DEFAULT_CLIENT_NO_SHOW_TIMEOUT_SECS,
                )


class EnforceClientNoShowTimeoutTests(unittest.TestCase):
    def test_cancels_session_when_no_client_joined(self) -> None:
        task = FakePipelineTask()

        asyncio.run(
            enforce_client_no_show_timeout(
                task,
                timeout_secs=0.01,
                client_connected=lambda: False,
            )
        )

        self.assertEqual(task.cancel_reasons, ["client-no-show"])

    def test_leaves_session_alone_when_client_connected(self) -> None:
        task = FakePipelineTask()

        asyncio.run(
            enforce_client_no_show_timeout(
                task,
                timeout_secs=0.01,
                client_connected=lambda: True,
            )
        )

        self.assertEqual(task.cancel_reasons, [])


if __name__ == "__main__":
    unittest.main()
