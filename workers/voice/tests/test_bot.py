from __future__ import annotations

import sys
import unittest
from types import SimpleNamespace

from app.bot import _import_pipecat_dependencies, _register_runner_bot_alias, build_pipeline_task


class PipecatDependencyImportTests(unittest.TestCase):
    def test_import_pipecat_dependencies_returns_expected_runtime_symbols(self) -> None:
        if sys.version_info[:2] != (3, 12):
            self.skipTest(
                "Pipecat dependency import verification requires the uv-managed Python 3.12 worker runtime."
            )

        modules = _import_pipecat_dependencies()

        self.assertIn("DeepgramFluxSTTService", modules)
        self.assertIn("GoogleLLMService", modules)
        self.assertIn("CartesiaTTSService", modules)
        self.assertIn("SmallWebRTCTransport", modules)
        self.assertIn("runner_main", modules)

    def test_register_runner_bot_alias_exposes_current_module_for_pipecat_runner(self) -> None:
        previous = sys.modules.get("bot")
        try:
            sys.modules.pop("bot", None)

            _register_runner_bot_alias()

            self.assertIs(sys.modules["bot"], sys.modules["app.bot"])
        finally:
            if previous is None:
                sys.modules.pop("bot", None)
            else:
                sys.modules["bot"] = previous

    def test_build_pipeline_task_preserves_expected_processor_order(self) -> None:
        class FakeObserver:
            pass

        class FakeFramePushed:
            pass

        class FakePipeline:
            def __init__(self, processors: list[object]) -> None:
                self.processors = processors

        class FakePipelineParams:
            def __init__(self, **kwargs: object) -> None:
                self.kwargs = kwargs

        class FakePipelineTask:
            def __init__(self, pipeline: object, **kwargs: object) -> None:
                self.pipeline = pipeline
                self.kwargs = kwargs

        class FakeLLMContext:
            pass

        class FakeAggregatorParams:
            def __init__(self, **kwargs: object) -> None:
                self.kwargs = kwargs

        class FakeExternalUserTurnStrategies:
            pass

        def fake_aggregator_pair(
            context: object,
            user_params: object,
        ) -> tuple[object, object]:
            return (user_params, "assistant-aggregator")

        class FakeService:
            class Settings:
                def __init__(self, **kwargs: object) -> None:
                    self.kwargs = kwargs

            def __init__(self, **kwargs: object) -> None:
                self.kwargs = kwargs

        class FakeTransport:
            def input(self) -> str:
                return "transport-input"

            def output(self) -> str:
                return "transport-output"

        modules = {
            "BaseObserver": FakeObserver,
            "FrameDirection": SimpleNamespace(DOWNSTREAM="downstream"),
            "FramePushed": FakeFramePushed,
            "InputAudioRawFrame": type("InputAudioRawFrame", (), {}),
            "InterimTranscriptionFrame": type("InterimTranscriptionFrame", (), {}),
            "TranscriptionFrame": type("TranscriptionFrame", (), {}),
            "UserStartedSpeakingFrame": type("UserStartedSpeakingFrame", (), {}),
            "UserStoppedSpeakingFrame": type("UserStoppedSpeakingFrame", (), {}),
            "Pipeline": FakePipeline,
            "PipelineParams": FakePipelineParams,
            "PipelineTask": FakePipelineTask,
            "LLMContext": FakeLLMContext,
            "LLMContextAggregatorPair": fake_aggregator_pair,
            "LLMUserAggregatorParams": FakeAggregatorParams,
            "DeepgramFluxSTTService": FakeService,
            "GoogleLLMService": FakeService,
            "CartesiaTTSService": FakeService,
            "ExternalUserTurnStrategies": FakeExternalUserTurnStrategies,
        }
        config = SimpleNamespace(
            deepgram_api_key="dg",
            deepgram_model="flux-general-en",
            google_api_key="google",
            google_model="gemini-2.5-flash",
            cartesia_api_key="cartesia",
            cartesia_model="sonic-2",
            cartesia_voice_id="voice",
        )

        task = build_pipeline_task(FakeTransport(), modules, config)

        self.assertEqual(task.pipeline.processors[0], "transport-input")
        self.assertEqual(task.pipeline.processors[5], "transport-output")
        self.assertEqual(task.pipeline.processors[6], "assistant-aggregator")
        self.assertEqual(len(task.pipeline.processors), 7)
        self.assertEqual(len(task.kwargs["observers"]), 1)
        self.assertTrue(task.kwargs["params"].kwargs["enable_metrics"])
        self.assertTrue(task.kwargs["params"].kwargs["enable_usage_metrics"])


if __name__ == "__main__":
    unittest.main()
