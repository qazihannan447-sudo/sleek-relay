from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from app.config import (
    ConfigurationError,
    get_public_config_status,
    load_config,
    load_worker_env,
    resolve_worker_env_path,
)


class VoiceWorkerConfigTests(unittest.TestCase):
    def test_resolve_worker_env_path_prefers_repo_root_dotenv_voice(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir)
            worker_app_dir = repo_root / "workers" / "voice" / "app"
            worker_app_dir.mkdir(parents=True)

            repo_env = repo_root / ".env.voice"
            repo_env.write_text("DEEPGRAM_API_KEY=repo-key\n", encoding="utf-8")
            (worker_app_dir.parent / ".env").write_text(
                "DEEPGRAM_API_KEY=worker-key\n",
                encoding="utf-8",
            )

            resolved = resolve_worker_env_path(worker_app_dir / "config.py")

            self.assertEqual(resolved, repo_env)

    def test_load_worker_env_keeps_process_env_higher_priority_than_repo_root_file(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir)
            worker_app_dir = repo_root / "workers" / "voice" / "app"
            worker_app_dir.mkdir(parents=True)
            (repo_root / ".env.voice").write_text(
                "DEEPGRAM_API_KEY=repo-file-value\nGOOGLE_MODEL=repo-model\n",
                encoding="utf-8",
            )

            with mock.patch.dict(
                os.environ,
                {
                    "DEEPGRAM_API_KEY": "process-value",
                },
                clear=True,
            ):
                env_path = load_worker_env(worker_app_dir / "config.py")

                self.assertEqual(env_path, repo_root / ".env.voice")
                self.assertEqual(os.environ["DEEPGRAM_API_KEY"], "process-value")
                self.assertEqual(os.environ["GOOGLE_MODEL"], "repo-model")

    def test_load_config_uses_defaults(self) -> None:
        config = load_config(
            {
                "DEEPGRAM_API_KEY": "dg-key",
                "DEEPGRAM_MODEL": "flux-general-en",
                "GOOGLE_API_KEY": "google-key",
                "GOOGLE_MODEL": "gemini-2.5-flash",
                "CARTESIA_API_KEY": "cartesia-key",
                "CARTESIA_MODEL": "sonic-3.5",
                "CARTESIA_VOICE_ID": "voice-123",
            }
        )

        self.assertEqual(config.host, "127.0.0.1")
        self.assertEqual(config.port, 8000)
        self.assertEqual(config.runner_host, "127.0.0.1")
        self.assertEqual(config.runner_port, 7860)
        self.assertEqual(config.runner_base_url, "http://127.0.0.1:7860")
        self.assertEqual(config.client_url, "http://127.0.0.1:7860/client")

    def test_load_config_rejects_missing_provider_values(self) -> None:
        with self.assertRaisesRegex(
            ConfigurationError,
            "Missing required environment variable\\(s\\): DEEPGRAM_API_KEY, DEEPGRAM_MODEL",
        ):
            load_config(
                {
                    "GOOGLE_API_KEY": "google-key",
                    "GOOGLE_MODEL": "gemini-2.5-flash",
                    "CARTESIA_API_KEY": "cartesia-key",
                    "CARTESIA_MODEL": "sonic-3.5",
                    "CARTESIA_VOICE_ID": "voice-123",
                }
            )

    def test_load_config_reports_all_missing_provider_values(self) -> None:
        with self.assertRaisesRegex(
            ConfigurationError,
            (
                "Missing required environment variable\\(s\\): "
                "DEEPGRAM_API_KEY, DEEPGRAM_MODEL, GOOGLE_API_KEY, GOOGLE_MODEL, "
                "CARTESIA_API_KEY, CARTESIA_MODEL, CARTESIA_VOICE_ID"
            ),
        ):
            load_config({})

    def test_load_config_rejects_invalid_port(self) -> None:
        with self.assertRaisesRegex(
            ConfigurationError,
            "VOICE_WORKER_RUNNER_PORT must be between 1 and 65535.",
        ):
            load_config(
                {
                    "VOICE_WORKER_RUNNER_PORT": "70000",
                    "DEEPGRAM_API_KEY": "dg-key",
                    "DEEPGRAM_MODEL": "flux-general-en",
                    "GOOGLE_API_KEY": "google-key",
                    "GOOGLE_MODEL": "gemini-2.5-flash",
                    "CARTESIA_API_KEY": "cartesia-key",
                    "CARTESIA_MODEL": "sonic-3.5",
                    "CARTESIA_VOICE_ID": "voice-123",
                }
            )

    def test_public_config_status_does_not_expose_secrets(self) -> None:
        status = get_public_config_status(
            {
                "VOICE_WORKER_RUNNER_HOST": "localhost",
                "VOICE_WORKER_RUNNER_PORT": "9000",
                "DEEPGRAM_API_KEY": "dg-key",
                "DEEPGRAM_MODEL": "flux-general-en",
                "GOOGLE_API_KEY": "google-key",
                "GOOGLE_MODEL": "gemini-2.5-flash",
                "CARTESIA_API_KEY": "cartesia-key",
                "CARTESIA_MODEL": "sonic-3.5",
                "CARTESIA_VOICE_ID": "voice-123",
            }
        )

        self.assertTrue(status["ok"])
        self.assertEqual(status["runnerBaseUrl"], "http://localhost:9000")
        self.assertEqual(status["clientUrl"], "http://localhost:9000/client")
        self.assertEqual(status["missing"], [])
        self.assertNotIn("dg-key", str(status))
        self.assertNotIn("google-key", str(status))
        self.assertNotIn("cartesia-key", str(status))


if __name__ == "__main__":
    unittest.main()
