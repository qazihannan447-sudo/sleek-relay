from __future__ import annotations

import importlib.util
import runpy
import sys
import types
import unittest
from pathlib import Path


class WorkerRunnerEntrypointTests(unittest.TestCase):
    def setUp(self) -> None:
        self.entrypoint_path = Path(__file__).resolve().parents[1] / "bot.py"

    def test_bot_py_exists(self) -> None:
        self.assertTrue(self.entrypoint_path.is_file())

    def test_bot_py_exposes_imported_bot_callback(self) -> None:
        expected_bot = object()
        fake_app_bot = types.ModuleType("app.bot")
        fake_app_bot.bot = expected_bot
        fake_app_bot.configure_logging = lambda: None
        fake_app_bot.preload_pipecat_dependencies = lambda: None
        fake_app_bot.install_deepgram_warm_pool_lifespan = lambda: None

        fake_app_config = types.ModuleType("app.config")
        fake_app_config.load_worker_env = lambda: None

        fake_daily_pool = types.ModuleType("app.daily_room_pool")
        fake_daily_pool.install_daily_room_pool_lifespan = lambda: None

        fake_health_route = types.ModuleType("app.health_route")
        fake_health_route.install_health_route = lambda: None

        previous_modules = {
            key: sys.modules.get(key)
            for key in (
                "app.bot",
                "app.config",
                "app.daily_room_pool",
                "app.health_route",
                "worker_voice_bot_entry",
            )
        }
        try:
            sys.modules["app.bot"] = fake_app_bot
            sys.modules["app.config"] = fake_app_config
            sys.modules["app.daily_room_pool"] = fake_daily_pool
            sys.modules["app.health_route"] = fake_health_route

            spec = importlib.util.spec_from_file_location(
                "worker_voice_bot_entry",
                self.entrypoint_path,
            )
            self.assertIsNotNone(spec)
            self.assertIsNotNone(spec.loader)
            module = importlib.util.module_from_spec(spec)
            sys.modules["worker_voice_bot_entry"] = module
            spec.loader.exec_module(module)

            self.assertIs(module.bot, expected_bot)
        finally:
            for key, value in previous_modules.items():
                if value is None:
                    sys.modules.pop(key, None)
                else:
                    sys.modules[key] = value

    def test_bot_py_invokes_runner_only_when_executed_as_main_script(self) -> None:
        calls: list[str] = []

        fake_app_bot = types.ModuleType("app.bot")
        fake_app_bot.bot = object()
        fake_app_bot.configure_logging = lambda: calls.append("configure_logging")
        fake_app_bot.preload_pipecat_dependencies = lambda: calls.append("preload_pipecat_dependencies")
        fake_app_bot.install_deepgram_warm_pool_lifespan = lambda: calls.append(
            "install_deepgram_warm_pool_lifespan"
        )

        fake_app_config = types.ModuleType("app.config")
        fake_app_config.load_worker_env = lambda: calls.append("load_worker_env")

        fake_daily_pool = types.ModuleType("app.daily_room_pool")
        fake_daily_pool.install_daily_room_pool_lifespan = lambda: calls.append(
            "install_daily_room_pool_lifespan"
        )

        fake_health_route = types.ModuleType("app.health_route")
        fake_health_route.install_health_route = lambda: calls.append("install_health_route")

        fake_runner_module = types.ModuleType("pipecat.runner.run")
        fake_runner_module.main = lambda: calls.append("runner_main")

        previous_modules = {
            key: sys.modules.get(key)
            for key in (
                "app.bot",
                "app.config",
                "app.daily_room_pool",
                "app.health_route",
                "pipecat.runner.run",
            )
        }
        try:
            sys.modules["app.bot"] = fake_app_bot
            sys.modules["app.config"] = fake_app_config
            sys.modules["app.daily_room_pool"] = fake_daily_pool
            sys.modules["app.health_route"] = fake_health_route
            sys.modules["pipecat.runner.run"] = fake_runner_module

            runpy.run_path(str(self.entrypoint_path), run_name="worker_voice_not_main")
            self.assertEqual(calls, [])

            runpy.run_path(str(self.entrypoint_path), run_name="__main__")
            self.assertEqual(
                calls,
                [
                    "load_worker_env",
                    "configure_logging",
                    "preload_pipecat_dependencies",
                    "install_deepgram_warm_pool_lifespan",
                    "install_daily_room_pool_lifespan",
                    "install_health_route",
                    "runner_main",
                ],
            )
        finally:
            for key, value in previous_modules.items():
                if value is None:
                    sys.modules.pop(key, None)
                else:
                    sys.modules[key] = value


if __name__ == "__main__":
    unittest.main()
