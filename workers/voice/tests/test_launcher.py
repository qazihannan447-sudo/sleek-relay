from __future__ import annotations

import unittest
from pathlib import Path


class WorkerLauncherContractTests(unittest.TestCase):
    def test_run_voice_worker_script_contains_expected_startup_contract(self) -> None:
        script_path = Path(__file__).resolve().parents[3] / "run-voice-worker.ps1"
        script_text = script_path.read_text(encoding="utf-8")

        self.assertIn("Ubuntu-24.04", script_text)
        self.assertIn(".env.voice", script_text)
        self.assertIn("UV_PROJECT_ENVIRONMENT", script_text)
        self.assertIn('exec "$uv_bin" run --python 3.12 bot.py -t webrtc', script_text)
        self.assertNotIn('-m app.bot', script_text)
        self.assertNotIn("source /mnt/c/sleek-relay/.env.voice", script_text)
        self.assertNotIn("set -a", script_text)
        self.assertNotIn("set +a", script_text)


if __name__ == "__main__":
    unittest.main()
