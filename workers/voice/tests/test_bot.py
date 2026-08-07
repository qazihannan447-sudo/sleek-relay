from __future__ import annotations

import asyncio
import sys
import unittest
from types import SimpleNamespace
from unittest import mock

from app.bot import (
    _import_pipecat_dependencies,
    adopt_warm_deepgram_websocket,
    attach_deepgram_warm_pool,
    bot,
    build_user_turn_detection,
    build_deepgram_flux_settings_kwargs,
    build_pipeline_task,
    cancel_pipeline_task,
    create_deterministic_end_session_processor,
    create_vad_user_stop_adapter_processor,
    DeepgramStartupController,
    defer_deepgram_connect_during_startframe,
    emit_runtime_config_error_and_disconnect,
    instrument_service_connect,
    instrument_google_llm_service,
    is_deterministic_end_session_request,
    is_deepgram_handshake_error_message,
    is_rejected_end_session_request,
    LOCAL_FALLBACK_GREETING,
    normalize_end_session_text,
    OpeningGreetingController,
    preload_pipecat_dependencies,
    queue_opening_greeting,
    resolve_opening_greeting,
    SessionTerminationController,
    SILERO_VAD_CONFIDENCE,
    SILERO_VAD_MIN_VOLUME,
    SILERO_VAD_START_SECS,
    SILERO_VAD_STOP_SECS,
    start_provider_preconnects,
    VoiceStartupTimingTracker,
    VoiceTurnLatencyRecord,
    VoiceTurnLatencyTracker,
    wait_for_smallwebrtc_connection,
)
from app.runtime_config import RuntimeConfigLoadError
from app.prompt import SYSTEM_PROMPT


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
        self.assertIn("DailyTransport", modules)
        self.assertIn("DailyRunnerArguments", modules)

    def test_preload_pipecat_dependencies_reuses_cached_modules(self) -> None:
        modules = preload_pipecat_dependencies()
        self.assertIs(modules, _import_pipecat_dependencies())

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

        class FakeFrameProcessor:
            def __init__(self, **kwargs: object) -> None:
                self.kwargs = kwargs

        class FakeLLMContext:
            def __init__(self, messages: list[object] | None = None, tools: list[object] | None = None) -> None:
                self.messages = messages or []
                self.tools = tools or []

        class FakeAggregatorParams:
            def __init__(self, **kwargs: object) -> None:
                self.kwargs = kwargs

        class FakeUserTurnStrategies:
            def __init__(self, *, start: list[object], stop: list[object]) -> None:
                self.start = start
                self.stop = stop

        class FakeVADUserTurnStartStrategy:
            pass

        class FakeTranscriptionUserTurnStartStrategy:
            pass

        class FakeExternalUserTurnStopStrategy:
            def __init__(self, **kwargs: object) -> None:
                self.kwargs = kwargs

        class FakeVADParams:
            def __init__(self, **kwargs: object) -> None:
                self.kwargs = kwargs

        class FakeSileroVADAnalyzer:
            def __init__(self, *, params: object) -> None:
                self.params = params

        class FakeTextAggregationMode:
            TOKEN = "token"

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

        class FakeFunctionSchema:
            def __init__(
                self,
                name: str,
                description: str,
                properties: dict[str, object],
                required: list[str],
                handler: object | None = None,
            ) -> None:
                self.name = name
                self.description = description
                self.properties = properties
                self.required = required
                self.handler = handler

        class FakeTransport:
            def input(self) -> str:
                return "transport-input"

            def output(self) -> str:
                return "transport-output"

        modules = {
            "BaseObserver": FakeObserver,
            "BotStartedSpeakingFrame": type("BotStartedSpeakingFrame", (), {}),
            "BotStoppedSpeakingFrame": type("BotStoppedSpeakingFrame", (), {}),
            "FrameDirection": SimpleNamespace(DOWNSTREAM="downstream"),
            "FrameProcessor": FakeFrameProcessor,
            "FramePushed": FakeFramePushed,
            "InputAudioRawFrame": type("InputAudioRawFrame", (), {}),
            "InterimTranscriptionFrame": type("InterimTranscriptionFrame", (), {}),
            "LLMContextFrame": type("LLMContextFrame", (), {}),
            "LLMFullResponseEndFrame": type("LLMFullResponseEndFrame", (), {}),
            "LLMTextFrame": type("LLMTextFrame", (), {}),
            "TranscriptionFrame": type("TranscriptionFrame", (), {}),
            "VADUserStoppedSpeakingFrame": type("VADUserStoppedSpeakingFrame", (), {}),
            "TTSAudioRawFrame": type("TTSAudioRawFrame", (), {}),
            "TTSStartedFrame": type("TTSStartedFrame", (), {}),
            "UserStartedSpeakingFrame": type("UserStartedSpeakingFrame", (), {}),
            "UserStoppedSpeakingFrame": type("UserStoppedSpeakingFrame", (), {}),
            "Pipeline": FakePipeline,
            "PipelineParams": FakePipelineParams,
            "PipelineTask": FakePipelineTask,
            "FunctionSchema": FakeFunctionSchema,
            "FunctionCallResultProperties": type(
                "FunctionCallResultProperties",
                (),
                {"__init__": lambda self, **kwargs: setattr(self, "kwargs", kwargs)},
            ),
            "EndFrame": type("EndFrame", (), {}),
            "LLMContext": FakeLLMContext,
            "LLMContextAggregatorPair": fake_aggregator_pair,
            "LLMUserAggregatorParams": FakeAggregatorParams,
            "DeepgramFluxSTTService": FakeService,
            "GoogleLLMService": FakeService,
            "CartesiaTTSService": FakeService,
            "TextAggregationMode": FakeTextAggregationMode,
            "ExternalUserTurnStopStrategy": FakeExternalUserTurnStopStrategy,
            "TranscriptionUserTurnStartStrategy": FakeTranscriptionUserTurnStartStrategy,
            "UserTurnStrategies": FakeUserTurnStrategies,
            "VADParams": FakeVADParams,
            "VADUserTurnStartStrategy": FakeVADUserTurnStartStrategy,
            "SileroVADAnalyzer": FakeSileroVADAnalyzer,
            "TTSSpeakFrame": type(
                "TTSSpeakFrame",
                (),
                {"__init__": lambda self, text, append_to_context=True: setattr(self, "text", text)},
            ),
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
        self.assertEqual(type(task.pipeline.processors[2]).__name__, "DeterministicEndSessionProcessor")
        self.assertEqual(type(task.pipeline.processors[3]).__name__, "VADUserStopAdapterProcessor")
        self.assertEqual(type(task.pipeline.processors[4]).__name__, "StartupTurnGateProcessor")
        self.assertEqual(task.pipeline.processors[8], "transport-output")
        self.assertEqual(task.pipeline.processors[9], "assistant-aggregator")
        self.assertEqual(len(task.pipeline.processors), 10)
        self.assertEqual(len(task.kwargs["observers"]), 1)
        self.assertTrue(task.kwargs["params"].kwargs["enable_metrics"])
        self.assertTrue(task.kwargs["params"].kwargs["enable_usage_metrics"])
        self.assertTrue(hasattr(task, "_sleek_relay_termination_controller"))
        self.assertTrue(hasattr(task, "_sleek_relay_startup_turn_gate"))
        self.assertEqual(task.pipeline.processors[5].kwargs["user_turn_stop_timeout"], 0.25)
        self.assertEqual(len(task.pipeline.processors[5].kwargs["user_turn_strategies"].start), 1)
        self.assertEqual(len(task.pipeline.processors[5].kwargs["user_turn_strategies"].stop), 1)
        self.assertEqual(
            task.pipeline.processors[5].kwargs["vad_analyzer"].params.kwargs,
            {
                "confidence": SILERO_VAD_CONFIDENCE,
                "start_secs": SILERO_VAD_START_SECS,
                "stop_secs": SILERO_VAD_STOP_SECS,
                "min_volume": SILERO_VAD_MIN_VOLUME,
            },
        )
        self.assertEqual(
            task.pipeline.processors[5].kwargs["user_turn_strategies"].stop[0].kwargs["timeout"],
            0.05,
        )
        self.assertEqual(
            task.pipeline.processors[6].kwargs["settings"].kwargs["system_instruction"],
            SYSTEM_PROMPT,
        )
        self.assertEqual(task.pipeline.processors[7].kwargs["settings"].kwargs["voice"], "voice")
        self.assertEqual(task.pipeline.processors[7].kwargs["settings"].kwargs["language"], "en")
        self.assertEqual(task.pipeline.processors[7].kwargs["text_aggregation_mode"], "token")
        self.assertTrue(hasattr(task, "_sleek_relay_runtime_config"))
        self.assertTrue(hasattr(task, "_sleek_relay_startup_timing_tracker"))
        self.assertTrue(hasattr(task, "_sleek_relay_tts"))

    def test_build_pipeline_task_preserves_runtime_config_turn_stop_override(self) -> None:
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

        class FakeFrameProcessor:
            def __init__(self, **kwargs: object) -> None:
                self.kwargs = kwargs

        class FakeLLMContext:
            def __init__(self, messages: list[object] | None = None, tools: list[object] | None = None) -> None:
                self.messages = messages or []
                self.tools = tools or []

        class FakeAggregatorParams:
            def __init__(self, **kwargs: object) -> None:
                self.kwargs = kwargs

        class FakeUserTurnStrategies:
            def __init__(self, *, start: list[object], stop: list[object]) -> None:
                self.start = start
                self.stop = stop

        class FakeVADUserTurnStartStrategy:
            pass

        class FakeTranscriptionUserTurnStartStrategy:
            pass

        class FakeExternalUserTurnStopStrategy:
            def __init__(self, **kwargs: object) -> None:
                self.kwargs = kwargs

        class FakeVADParams:
            def __init__(self, **kwargs: object) -> None:
                self.kwargs = kwargs

        class FakeSileroVADAnalyzer:
            def __init__(self, *, params: object) -> None:
                self.params = params

        class FakeTextAggregationMode:
            TOKEN = "token"

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

        class FakeFunctionSchema:
            def __init__(
                self,
                name: str,
                description: str,
                properties: dict[str, object],
                required: list[str],
                handler: object | None = None,
            ) -> None:
                self.name = name
                self.description = description
                self.properties = properties
                self.required = required
                self.handler = handler

        class FakeTransport:
            def input(self) -> str:
                return "transport-input"

            def output(self) -> str:
                return "transport-output"

        modules = {
            "BaseObserver": FakeObserver,
            "BotStartedSpeakingFrame": type("BotStartedSpeakingFrame", (), {}),
            "BotStoppedSpeakingFrame": type("BotStoppedSpeakingFrame", (), {}),
            "FrameDirection": SimpleNamespace(DOWNSTREAM="downstream"),
            "FrameProcessor": FakeFrameProcessor,
            "FramePushed": FakeFramePushed,
            "InputAudioRawFrame": type("InputAudioRawFrame", (), {}),
            "InterimTranscriptionFrame": type("InterimTranscriptionFrame", (), {}),
            "LLMContextFrame": type("LLMContextFrame", (), {}),
            "LLMFullResponseEndFrame": type("LLMFullResponseEndFrame", (), {}),
            "LLMTextFrame": type("LLMTextFrame", (), {}),
            "TranscriptionFrame": type("TranscriptionFrame", (), {}),
            "VADUserStoppedSpeakingFrame": type("VADUserStoppedSpeakingFrame", (), {}),
            "TTSAudioRawFrame": type("TTSAudioRawFrame", (), {}),
            "TTSStartedFrame": type("TTSStartedFrame", (), {}),
            "UserStartedSpeakingFrame": type("UserStartedSpeakingFrame", (), {}),
            "UserStoppedSpeakingFrame": type("UserStoppedSpeakingFrame", (), {}),
            "Pipeline": FakePipeline,
            "PipelineParams": FakePipelineParams,
            "PipelineTask": FakePipelineTask,
            "FunctionSchema": FakeFunctionSchema,
            "FunctionCallResultProperties": type(
                "FunctionCallResultProperties",
                (),
                {"__init__": lambda self, **kwargs: setattr(self, "kwargs", kwargs)},
            ),
            "EndFrame": type("EndFrame", (), {}),
            "LLMContext": FakeLLMContext,
            "LLMContextAggregatorPair": fake_aggregator_pair,
            "LLMUserAggregatorParams": FakeAggregatorParams,
            "DeepgramFluxSTTService": FakeService,
            "GoogleLLMService": FakeService,
            "CartesiaTTSService": FakeService,
            "TextAggregationMode": FakeTextAggregationMode,
            "ExternalUserTurnStopStrategy": FakeExternalUserTurnStopStrategy,
            "TranscriptionUserTurnStartStrategy": FakeTranscriptionUserTurnStartStrategy,
            "UserTurnStrategies": FakeUserTurnStrategies,
            "VADParams": FakeVADParams,
            "VADUserTurnStartStrategy": FakeVADUserTurnStartStrategy,
            "SileroVADAnalyzer": FakeSileroVADAnalyzer,
            "TTSSpeakFrame": type(
                "TTSSpeakFrame",
                (),
                {"__init__": lambda self, text, append_to_context=True: setattr(self, "text", text)},
            ),
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
        runtime_config = SimpleNamespace(
            promptText=SYSTEM_PROMPT,
            ttsLanguage="en",
            agent=SimpleNamespace(
                fallbackMessage="",
                greeting="",
                id="agent-id",
                interruptionEnabled=True,
                language="en",
                maximumSessionDurationSeconds=None,
                name="Agent",
                role="assistant",
                silenceTimeoutSeconds=0.22,
                specialInstructions="",
                status="active",
                tone="",
                voiceId="voice",
            ),
            tenant=SimpleNamespace(id="tenant-id"),
            source="test-runtime",
        )

        task = build_pipeline_task(FakeTransport(), modules, config, runtime_config)

        self.assertEqual(task.pipeline.processors[5].kwargs["user_turn_stop_timeout"], 0.22)

    def test_build_user_turn_detection_uses_vad_start_only_and_external_stop(self) -> None:
        class FakeUserTurnStrategies:
            def __init__(self, *, start: list[object], stop: list[object]) -> None:
                self.start = start
                self.stop = stop

        class FakeVADUserTurnStartStrategy:
            pass

        class FakeExternalUserTurnStopStrategy:
            def __init__(self, **kwargs: object) -> None:
                self.kwargs = kwargs

        class FakeVADParams:
            def __init__(self, **kwargs: object) -> None:
                self.kwargs = kwargs

        class FakeSileroVADAnalyzer:
            def __init__(self, *, params: object) -> None:
                self.params = params

        strategies, vad_analyzer = build_user_turn_detection(
            {
                "ExternalUserTurnStopStrategy": FakeExternalUserTurnStopStrategy,
                "UserTurnStrategies": FakeUserTurnStrategies,
                "VADParams": FakeVADParams,
                "VADUserTurnStartStrategy": FakeVADUserTurnStartStrategy,
                "SileroVADAnalyzer": FakeSileroVADAnalyzer,
            }
        )

        # Only VAD drives turn-start; transcription-based start is intentionally absent.
        self.assertEqual(
            [type(item).__name__ for item in strategies.start],
            ["FakeVADUserTurnStartStrategy"],
        )
        self.assertEqual([type(item).__name__ for item in strategies.stop], [
            "FakeExternalUserTurnStopStrategy",
        ])
        self.assertEqual(strategies.stop[0].kwargs["timeout"], 0.05)
        self.assertEqual(
            vad_analyzer.params.kwargs,
            {
                "confidence": SILERO_VAD_CONFIDENCE,
                "start_secs": SILERO_VAD_START_SECS,
                "stop_secs": SILERO_VAD_STOP_SECS,
                "min_volume": SILERO_VAD_MIN_VOLUME,
            },
        )

    def test_real_cartesia_tts_default_aggregation_mode_is_sentence(self) -> None:
        if sys.version_info[:2] != (3, 12):
            self.skipTest(
                "Real Cartesia TTS aggregation verification requires the uv-managed Python 3.12 worker runtime."
            )

        modules = _import_pipecat_dependencies()
        cartesia_tts_service_cls = modules["CartesiaTTSService"]
        text_aggregation_mode_cls = modules["TextAggregationMode"]

        service = cartesia_tts_service_cls(api_key="cartesia-key")

        self.assertEqual(service._text_aggregation_mode, text_aggregation_mode_cls.SENTENCE)

    def test_deepgram_flux_settings_kwargs_construct_real_settings(self) -> None:
        if sys.version_info[:2] != (3, 12):
            self.skipTest(
                "Real Deepgram Flux settings construction requires the uv-managed Python 3.12 worker runtime."
            )

        modules = _import_pipecat_dependencies()
        settings_cls = modules["DeepgramFluxSTTService"].Settings
        config = SimpleNamespace(deepgram_model="flux-general-en")

        kwargs = build_deepgram_flux_settings_kwargs(config)
        settings = settings_cls(**kwargs)

        self.assertEqual(kwargs, {"model": "flux-general-en"})
        self.assertEqual(settings.model, "flux-general-en")


class BotRuntimeConfigLoadingTests(unittest.IsolatedAsyncioTestCase):
    async def test_bot_loads_runtime_config_before_starting_pipeline(self) -> None:
        runtime_config = SimpleNamespace(source="portal-runtime-package", conversation_id=None)
        fake_connection = object()
        fake_runner_args = self._build_runner_args(fake_connection, {"voiceSessionToken": "token-123"})
        fake_config = SimpleNamespace(
            cartesia_voice_id="voice-default",
            cartesia_model="sonic-3.5",
            deepgram_model="flux-general-en",
            google_model="gemini-2.5-flash",
        )

        async_mock = mock.AsyncMock(return_value=runtime_config)
        run_bot_mock = mock.AsyncMock(return_value=(None, None))

        with (
            mock.patch("app.bot._import_pipecat_dependencies", return_value=self._modules()),
            mock.patch("app.bot.load_config", return_value=fake_config),
            mock.patch("app.bot.load_session_runtime_config", async_mock),
            mock.patch("app.bot.run_bot", run_bot_mock),
        ):
            await bot(fake_runner_args)

        async_mock.assert_awaited_once_with(fake_config, fake_runner_args.body)
        run_bot_mock.assert_awaited_once()
        self.assertIs(run_bot_mock.await_args.args[0].webrtc_connection, fake_connection)
        self.assertEqual(run_bot_mock.await_args.kwargs["config"], fake_config)
        self.assertEqual(run_bot_mock.await_args.kwargs["runtime_config"], runtime_config)
        self.assertTrue(run_bot_mock.await_args.args[0].params.audio_in_enabled)
        self.assertTrue(run_bot_mock.await_args.args[0].params.audio_out_enabled)

    async def test_bot_sends_safe_error_and_disconnects_when_runtime_loading_fails(self) -> None:
        fake_connection = FakeSmallWebRTCConnection(connected=True)
        fake_runner_args = self._build_runner_args(
            fake_connection,
            {"metadata": {"voiceSessionToken": "token-123"}},
        )
        fake_config = SimpleNamespace(
            cartesia_voice_id="voice-default",
            cartesia_model="sonic-3.5",
            deepgram_model="flux-general-en",
            google_model="gemini-2.5-flash",
        )
        run_bot_mock = mock.AsyncMock()

        with (
            mock.patch("app.bot._import_pipecat_dependencies", return_value=self._modules()),
            mock.patch("app.bot.load_config", return_value=fake_config),
            mock.patch(
                "app.bot.load_session_runtime_config",
                mock.AsyncMock(
                    side_effect=RuntimeConfigLoadError(
                        "The requested voice session is unavailable."
                    )
                ),
            ),
            mock.patch("app.bot.run_bot", run_bot_mock),
        ):
            await bot(fake_runner_args)

        run_bot_mock.assert_not_called()
        self.assertEqual(
            fake_connection.messages,
            [
                {
                    "data": {
                        "error": "The requested voice session is unavailable.",
                        "fatal": True,
                    },
                    "label": "rtvi-ai",
                    "type": "error",
                }
            ],
        )
        self.assertEqual(fake_connection.disconnect_calls, 1)

    async def test_wait_for_smallwebrtc_connection_resolves_after_connected_event(self) -> None:
        connection = FakeSmallWebRTCConnection(connected=False)
        wait_task = asyncio.create_task(wait_for_smallwebrtc_connection(connection))
        await asyncio.sleep(0)
        connection.connected = True
        connection.emit("connected")

        self.assertTrue(await wait_task)

    async def test_emit_runtime_config_error_and_disconnect_closes_connection(self) -> None:
        connection = FakeSmallWebRTCConnection(connected=True)

        await emit_runtime_config_error_and_disconnect(
            connection,
            "Voice session setup is unavailable right now.",
        )

        self.assertEqual(connection.disconnect_calls, 1)
        self.assertEqual(connection.messages[0]["type"], "error")

    def _modules(self) -> dict[str, object]:
        if hasattr(self, "_modules_cache"):
            return self._modules_cache  # type: ignore[return-value]

        class FakeSmallWebRTCRunnerArguments:
            def __init__(self, *, webrtc_connection: object, body: object) -> None:
                self.webrtc_connection = webrtc_connection
                self.body = body

        class FakeDailyRunnerArguments:
            def __init__(self, *, room_url: str, token: str, body: object) -> None:
                self.room_url = room_url
                self.token = token
                self.body = body

        class FakeTransportParams:
            def __init__(self, **kwargs: object) -> None:
                self.audio_in_enabled = kwargs["audio_in_enabled"]
                self.audio_out_enabled = kwargs["audio_out_enabled"]

        class FakeDailyParams(FakeTransportParams):
            pass

        class FakeSmallWebRTCTransport:
            def __init__(self, *, params: object, webrtc_connection: object) -> None:
                self.params = params
                self.webrtc_connection = webrtc_connection

        class FakeDailyTransport:
            def __init__(
                self,
                room_url: str,
                token: str,
                bot_name: str,
                params: object,
            ) -> None:
                self.room_url = room_url
                self.token = token
                self.bot_name = bot_name
                self.params = params

        self._modules_cache = {
            "DailyParams": FakeDailyParams,
            "DailyRunnerArguments": FakeDailyRunnerArguments,
            "DailyTransport": FakeDailyTransport,
            "SmallWebRTCRunnerArguments": FakeSmallWebRTCRunnerArguments,
            "SmallWebRTCTransport": FakeSmallWebRTCTransport,
            "TransportParams": FakeTransportParams,
        }
        return self._modules_cache  # type: ignore[return-value]

    def _build_runner_args(self, connection: object, body: object) -> object:
        runner_args_cls = self._modules()["SmallWebRTCRunnerArguments"]
        return runner_args_cls(webrtc_connection=connection, body=body)


class OpeningGreetingControllerTests(unittest.IsolatedAsyncioTestCase):
    async def test_greeting_plays_after_pipeline_and_client_without_deepgram(self) -> None:
        controller, task = self._build_controller("Welcome to Greenleaf Dental.")

        await controller.handle_client_connected()
        self.assertEqual(task.queued_frames, [])

        await controller.handle_pipeline_started()

        self.assertEqual(len(task.queued_frames), 1)
        self.assertEqual(task.queued_frames[0].text, "Welcome to Greenleaf Dental.")
        self.assertTrue(task.queued_frames[0].append_to_context)

    async def test_greeting_plays_once_even_with_duplicate_callbacks(self) -> None:
        controller, task = self._build_controller("Welcome to Greenleaf Dental.")

        await controller.handle_pipeline_started()
        await controller.handle_pipeline_started()
        await controller.handle_client_connected()
        await controller.handle_client_connected()
        await controller.handle_client_connected()

        self.assertEqual(len(task.queued_frames), 1)

    async def test_greeting_queues_only_once_under_concurrent_ready_events(self) -> None:
        controller, task = self._build_controller("Welcome to Greenleaf Dental.")
        await controller.handle_pipeline_started()

        await asyncio.gather(
            *[controller.handle_client_connected() for _ in range(12)]
        )

        self.assertEqual(len(task.queued_frames), 1)

    async def test_no_user_transcript_is_required_for_greeting(self) -> None:
        controller, task = self._build_controller("")

        await controller.handle_pipeline_started()
        await controller.handle_client_connected()

        self.assertEqual(len(task.queued_frames), 1)
        self.assertEqual(task.queued_frames[0].text, LOCAL_FALLBACK_GREETING)

    async def test_two_sessions_get_their_own_greetings(self) -> None:
        first_controller, first_task = self._build_controller("Welcome to Greenleaf Dental.")
        second_controller, second_task = self._build_controller("Hello from the backup desk.")

        await first_controller.handle_pipeline_started()
        await first_controller.handle_client_connected()
        await second_controller.handle_client_connected()
        await second_controller.handle_pipeline_started()

        self.assertEqual(first_task.queued_frames[0].text, "Welcome to Greenleaf Dental.")
        self.assertEqual(second_task.queued_frames[0].text, "Hello from the backup desk.")

    async def test_greeting_playback_opens_startup_turn_gate(self) -> None:
        gate = SimpleNamespace(
            greeting_done=False,
            deepgram_ready=False,
            mark_greeting_playback_done=lambda: None,
            mark_deepgram_ready=lambda: None,
        )
        state = {"greeting_done": False, "deepgram_ready": False}

        def mark_greeting() -> None:
            state["greeting_done"] = True

        def mark_deepgram() -> None:
            state["deepgram_ready"] = True

        gate.mark_greeting_playback_done = mark_greeting
        gate.mark_deepgram_ready = mark_deepgram

        controller, task = self._build_controller(
            "Welcome to Greenleaf Dental.",
            startup_turn_gate=gate,
        )
        await controller.handle_pipeline_started()
        await controller.handle_client_connected()
        self.assertEqual(len(task.queued_frames), 1)

        controller.handle_greeting_playback_finished()
        self.assertTrue(state["greeting_done"])

        # Idempotent: second BotStoppedSpeaking must not re-mark.
        state["greeting_done"] = False
        controller.handle_greeting_playback_finished()
        self.assertFalse(state["greeting_done"])

    async def test_greeting_can_be_interrupted_normally(self) -> None:
        controller, task = self._build_controller("Welcome to Greenleaf Dental.")
        tracker = VoiceTurnLatencyTracker(monotonic_clock=FakeMonotonicClock())

        await controller.handle_pipeline_started()
        await controller.handle_client_connected()

        self.assertEqual(len(task.queued_frames), 1)

        tracker.handle_user_started_speaking()
        tracker.handle_user_stopped_speaking()
        tracker.handle_accepted_final_transcript("hello")
        tracker.handle_llm_request_started()
        tracker.handle_tts_request_started()
        tracker.handle_bot_started_speaking()
        tracker.handle_user_started_speaking()
        interrupted_turn = tracker.handle_bot_stopped_speaking()

        assert interrupted_turn is not None
        self.assertEqual(interrupted_turn.status, "interrupted")
        self.assertTrue(interrupted_turn.interrupted)

    async def test_queue_opening_greeting_uses_fallback_and_adds_context_once(self) -> None:
        task = self._build_task()
        modules = self._build_modules()

        await queue_opening_greeting(task, modules, self._runtime_config(""))

        self.assertEqual(task.queued_frames[0].text, LOCAL_FALLBACK_GREETING)
        self.assertTrue(task.queued_frames[0].append_to_context)
        self.assertEqual(resolve_opening_greeting(self._runtime_config("  ")), LOCAL_FALLBACK_GREETING)

    def _build_controller(
        self,
        greeting: str,
        *,
        startup_turn_gate: object | None = None,
    ) -> tuple[OpeningGreetingController, object]:
        task = self._build_task()
        controller = OpeningGreetingController(
            task,
            self._build_modules(),
            self._runtime_config(greeting),
            startup_turn_gate=startup_turn_gate,
        )
        return controller, task

    def _build_modules(self) -> dict[str, object]:
        class FakeTTSSpeakFrame:
            def __init__(self, text: str, append_to_context: bool = True) -> None:
                self.append_to_context = append_to_context
                self.text = text

        return {
            "TTSSpeakFrame": FakeTTSSpeakFrame,
        }

    def _build_task(self) -> object:
        class FakeTask:
            def __init__(self) -> None:
                self.queued_frames: list[object] = []

            async def queue_frame(self, frame: object) -> None:
                self.queued_frames.append(frame)

        return FakeTask()

    def _runtime_config(self, greeting: str) -> object:
        return SimpleNamespace(
            source="test",
            agent=SimpleNamespace(greeting=greeting, id="agent-test"),
        )


class StartupTurnGateProcessorTests(unittest.IsolatedAsyncioTestCase):
    async def test_blocks_user_turn_frames_until_greeting_and_deepgram_ready(self) -> None:
        from app.bot import create_startup_turn_gate_processor

        class FakeFrameProcessor:
            def __init__(self, **kwargs: object) -> None:
                self.name = kwargs.get("name")
                self.pushed: list[tuple[object, object]] = []

            async def process_frame(self, frame: object, direction: object) -> None:
                return None

            async def push_frame(self, frame: object, direction: object) -> None:
                self.pushed.append((frame, direction))

        direction = SimpleNamespace(DOWNSTREAM="downstream", UPSTREAM="upstream")
        Interim = type("InterimTranscriptionFrame", (), {})
        Final = type("TranscriptionFrame", (), {})
        UserStart = type("UserStartedSpeakingFrame", (), {})
        UserStop = type("UserStoppedSpeakingFrame", (), {})
        VadStop = type("VADUserStoppedSpeakingFrame", (), {})
        Other = type("OtherFrame", (), {})

        modules = {
            "FrameDirection": direction,
            "FrameProcessor": FakeFrameProcessor,
            "InterimTranscriptionFrame": Interim,
            "TranscriptionFrame": Final,
            "UserStartedSpeakingFrame": UserStart,
            "UserStoppedSpeakingFrame": UserStop,
            "VADUserStoppedSpeakingFrame": VadStop,
        }
        gate = create_startup_turn_gate_processor(modules)
        other = Other()
        blocked = UserStart()

        await gate.process_frame(other, direction.DOWNSTREAM)
        await gate.process_frame(blocked, direction.DOWNSTREAM)
        self.assertEqual(len(gate.pushed), 1)
        self.assertIs(gate.pushed[0][0], other)
        self.assertFalse(gate.allow_user_turns)

        gate.mark_deepgram_ready()
        self.assertFalse(gate.allow_user_turns)
        await gate.process_frame(UserStop(), direction.DOWNSTREAM)
        self.assertEqual(len(gate.pushed), 1)

        gate.mark_greeting_playback_done()
        self.assertTrue(gate.allow_user_turns)
        await gate.process_frame(Final(), direction.DOWNSTREAM)
        self.assertEqual(len(gate.pushed), 2)


class EndSessionIntentTests(unittest.TestCase):
    def test_normalize_end_session_text(self) -> None:
        self.assertEqual(
            normalize_end_session_text("Please, end the call now!"),
            "please end the call now",
        )

    def test_end_session_variants_are_accepted(self) -> None:
        for phrase in (
            "Bye.",
            "Goodbye.",
            "Hello, bye.",
            "No, that is all. Goodbye.",
            "Please end this call now.",
            "I think I am done here.",
        ):
            with self.subTest(phrase=phrase):
                self.assertTrue(is_deterministic_end_session_request(phrase))

    def test_false_positive_phrases_are_rejected(self) -> None:
        for phrase in (
            "What does goodbye mean?",
            "Explain the phrase hang up.",
            "We offer a goodbye package.",
            "Do not end the call.",
            "Do not hang up.",
            "I am not done.",
        ):
            with self.subTest(phrase=phrase):
                self.assertFalse(is_deterministic_end_session_request(phrase))
                self.assertTrue(is_rejected_end_session_request(phrase))


class DeepgramHandshakeDetectionTests(unittest.TestCase):
    def test_detects_opening_handshake_timeout(self) -> None:
        self.assertTrue(
            is_deepgram_handshake_error_message(
                "timed out during opening handshake"
            )
        )

    def test_rejects_non_handshake_errors(self) -> None:
        self.assertFalse(
            is_deepgram_handshake_error_message("transcription confidence below threshold")
        )


class VoiceTurnLatencyTrackerTests(unittest.TestCase):
    def test_timestamp_ordering_and_duration_calculations(self) -> None:
        tracker = self._build_tracker()

        tracker.handle_user_started_speaking()
        tracker.handle_user_stopped_speaking()
        tracker.handle_first_interim_transcript()
        tracker.handle_accepted_final_transcript("hello")
        tracker.handle_llm_request_started()
        tracker.handle_llm_first_token()
        tracker.handle_llm_response_completed()
        tracker.handle_tts_request_started()
        tracker.handle_first_tts_audio()
        tracker.handle_bot_started_speaking()
        turn = tracker.handle_bot_stopped_speaking()

        assert turn is not None
        summary = tracker.summarize_turn(turn)

        self.assertEqual(turn.turn_id, "s1-t1")
        self.assertEqual(turn.status, "completed")
        self.assertEqual(summary["speech_stop_to_stt_final_ms"], 200)
        self.assertEqual(summary["stt_final_to_llm_first_token_ms"], 200)
        self.assertEqual(summary["llm_first_token_to_first_tts_audio_ms"], 300)
        self.assertEqual(summary["final_transcript_to_bot_speaking_ms"], 600)
        self.assertEqual(summary["speech_stop_to_bot_speaking_ms"], 800)
        self.assertIsNone(summary["barge_in_to_bot_silence_ms"])
        self.assertEqual(summary["bot_speaking_duration_ms"], 100)
        self.assertEqual(summary["total_turn_duration_ms"], 1000)

    def test_separate_turn_isolation(self) -> None:
        tracker = self._build_tracker()

        tracker.handle_user_started_speaking()
        tracker.handle_user_stopped_speaking()
        tracker.handle_accepted_final_transcript("first")
        tracker.handle_llm_request_started()
        tracker.handle_llm_first_token()
        tracker.handle_bot_started_speaking()
        first_turn = tracker.handle_bot_stopped_speaking()

        tracker.handle_user_started_speaking()
        tracker.handle_user_stopped_speaking()
        tracker.handle_accepted_final_transcript("second")
        tracker.handle_llm_request_started()
        tracker.handle_bot_started_speaking()
        second_turn = tracker.handle_bot_stopped_speaking()

        assert first_turn is not None
        assert second_turn is not None
        self.assertEqual(first_turn.turn_id, "s1-t1")
        self.assertEqual(second_turn.turn_id, "s1-t2")
        self.assertEqual(len(tracker.completed_turns), 2)

    def test_duplicate_event_suppression(self) -> None:
        tracker = self._build_tracker()

        tracker.handle_user_started_speaking()
        tracker.handle_user_started_speaking()
        tracker.handle_user_stopped_speaking()
        tracker.handle_user_stopped_speaking()
        tracker.handle_accepted_final_transcript("hello")
        tracker.handle_accepted_final_transcript("hello again")
        tracker.handle_bot_started_speaking()
        tracker.handle_bot_started_speaking()
        turn = tracker.handle_bot_stopped_speaking()

        assert turn is not None
        self.assertEqual(turn.final_transcript_text, "hello")
        self.assertEqual(len(tracker.completed_turns), 1)

    def test_no_ghost_completed_turn_during_interruption(self) -> None:
        tracker = self._build_tracker()

        tracker.handle_user_started_speaking()
        tracker.handle_user_stopped_speaking()
        tracker.handle_accepted_final_transcript("hello")
        tracker.handle_llm_request_started()
        tracker.handle_bot_started_speaking()
        tracker.handle_user_started_speaking()

        self.assertEqual(len(tracker.completed_turns), 0)
        self.assertEqual(tracker.current_turn.turn_id if tracker.current_turn else None, "s1-t2")

        interrupted_turn = tracker.handle_bot_stopped_speaking()

        assert interrupted_turn is not None
        self.assertEqual(len(tracker.completed_turns), 1)
        self.assertEqual(interrupted_turn.turn_id, "s1-t1")
        self.assertEqual(interrupted_turn.status, "interrupted")
        self.assertTrue(interrupted_turn.interrupted)
        self.assertIsNone(tracker.handle_bot_stopped_speaking())
        self.assertEqual(tracker.current_turn.turn_id if tracker.current_turn else None, "s1-t2")

    def test_interrupted_turn_followed_by_valid_new_user_turn(self) -> None:
        tracker = self._build_tracker()

        tracker.handle_user_started_speaking()
        tracker.handle_user_stopped_speaking()
        tracker.handle_accepted_final_transcript("hello")
        tracker.handle_llm_request_started()
        tracker.handle_bot_started_speaking()
        tracker.handle_user_started_speaking()
        interrupted_turn = tracker.handle_bot_stopped_speaking()

        tracker.handle_user_stopped_speaking()
        tracker.handle_accepted_final_transcript("second")
        tracker.handle_llm_request_started()
        tracker.handle_llm_first_token()
        tracker.handle_tts_request_started()
        tracker.handle_first_tts_audio()
        tracker.handle_bot_started_speaking()
        completed_turn = tracker.handle_bot_stopped_speaking()

        assert interrupted_turn is not None
        assert completed_turn is not None
        interrupted_summary = tracker.summarize_turn(interrupted_turn)
        completed_summary = tracker.summarize_turn(completed_turn)

        self.assertEqual(interrupted_turn.turn_id, "s1-t1")
        self.assertEqual(completed_turn.turn_id, "s1-t2")
        self.assertEqual(interrupted_summary["barge_in_to_bot_silence_ms"], 100)
        self.assertEqual(completed_summary["total_turn_duration_ms"], 600)
        self.assertEqual([turn.turn_id for turn in tracker.completed_turns], ["s1-t1", "s1-t2"])

    def test_provider_error_turn(self) -> None:
        tracker = self._build_tracker()

        tracker.handle_user_started_speaking()
        tracker.handle_user_stopped_speaking()
        tracker.handle_accepted_final_transcript("hello")
        turn = tracker.mark_provider_error_turn()

        assert turn is not None
        self.assertEqual(turn.status, "provider-error")
        self.assertTrue(turn.provider_error)

    def test_end_session_turn(self) -> None:
        tracker = self._build_tracker()

        tracker.handle_user_started_speaking()
        tracker.handle_user_stopped_speaking()
        tracker.handle_accepted_final_transcript("goodbye")
        tracker.mark_end_session_turn()
        tracker.handle_tts_request_started()
        tracker.handle_first_tts_audio()
        tracker.handle_bot_started_speaking()
        turn = tracker.handle_bot_stopped_speaking()

        assert turn is not None
        self.assertEqual(turn.status, "end-session")
        self.assertTrue(turn.end_session)

    def test_incomplete_metrics_classification(self) -> None:
        tracker = self._build_tracker()

        tracker._current_turn = VoiceTurnLatencyRecord(  # type: ignore[attr-defined]
            turn_id="s1-t1",
            accepted_final_transcript_at=0.2,
            bot_speaking_started_at=0.4,
        )
        turn = tracker.handle_bot_stopped_speaking()

        assert turn is not None
        summary = tracker.summarize_turn(turn)

        self.assertEqual(turn.status, "incomplete-metrics")
        self.assertIsNone(summary["total_turn_duration_ms"])

    def test_duplicate_bot_stopped_speaking_is_suppressed_after_interruption(self) -> None:
        tracker = self._build_tracker()

        tracker.handle_user_started_speaking()
        tracker.handle_user_stopped_speaking()
        tracker.handle_accepted_final_transcript("hello")
        tracker.handle_bot_started_speaking()
        tracker.handle_user_started_speaking()

        first_stop = tracker.handle_bot_stopped_speaking()
        second_stop = tracker.handle_bot_stopped_speaking()

        assert first_stop is not None
        self.assertIsNone(second_stop)
        self.assertEqual(len(tracker.completed_turns), 1)

    def test_reset_between_sessions(self) -> None:
        tracker = self._build_tracker()

        tracker.handle_user_started_speaking()
        tracker.handle_user_stopped_speaking()
        tracker.handle_accepted_final_transcript("one")
        tracker.handle_bot_started_speaking()
        tracker.handle_bot_stopped_speaking()
        tracker.reset_session()

        tracker.handle_user_started_speaking()
        current_turn = tracker.current_turn

        self.assertEqual(current_turn.turn_id if current_turn else None, "s2-t1")

    def test_turn_ordering_and_session_reset(self) -> None:
        tracker = self._build_tracker()

        tracker.handle_user_started_speaking()
        tracker.handle_user_stopped_speaking()
        tracker.handle_accepted_final_transcript("one")
        tracker.handle_bot_started_speaking()
        first_turn = tracker.handle_bot_stopped_speaking()
        tracker.reset_session()
        tracker.handle_user_started_speaking()
        tracker.handle_user_stopped_speaking()
        tracker.handle_accepted_final_transcript("two")
        tracker.handle_bot_started_speaking()
        second_turn = tracker.handle_bot_stopped_speaking()

        assert first_turn is not None
        assert second_turn is not None
        self.assertEqual(first_turn.turn_id, "s1-t1")
        self.assertEqual(second_turn.turn_id, "s2-t1")

    def test_ten_sequential_completed_turns_emit_once_each_without_state_leakage(self) -> None:
        tracker = SummaryCapturingLatencyTracker(monotonic_clock=FakeMonotonicClock())

        for index in range(10):
            turn = self._run_completed_turn(tracker, f"turn-{index + 1}")
            assert turn is not None

        self.assertEqual(len(tracker.completed_turns), 10)
        self.assertEqual(len(tracker.logged_summaries), 10)
        self.assertEqual(
            [turn.turn_id for turn in tracker.completed_turns],
            [f"s1-t{index}" for index in range(1, 11)],
        )
        self.assertEqual(
            [summary["turn_id"] for summary in tracker.logged_summaries],
            [f"s1-t{index}" for index in range(1, 11)],
        )
        self.assertEqual(
            [turn.final_transcript_text for turn in tracker.completed_turns],
            [f"turn-{index}" for index in range(1, 11)],
        )
        self.assertTrue(all(turn.status == "completed" for turn in tracker.completed_turns))
        self.assertTrue(all(not turn.provider_error for turn in tracker.completed_turns))
        self.assertTrue(all(summary["barge_in_to_bot_silence_ms"] is None for summary in tracker.logged_summaries))

    def test_five_sequential_interruptions_emit_once_each_and_keep_follow_up_turns_valid(self) -> None:
        tracker = SummaryCapturingLatencyTracker(monotonic_clock=FakeMonotonicClock())

        for index in range(5):
            tracker.handle_user_started_speaking()
            tracker.handle_user_stopped_speaking()
            tracker.handle_accepted_final_transcript(f"interrupt-{index + 1}")
            tracker.handle_llm_request_started()
            tracker.handle_tts_request_started()
            tracker.handle_bot_started_speaking()
            tracker.handle_user_started_speaking()
            interrupted_turn = tracker.handle_bot_stopped_speaking()

            tracker.handle_user_stopped_speaking()
            tracker.handle_accepted_final_transcript(f"follow-up-{index + 1}")
            tracker.handle_llm_request_started()
            tracker.handle_llm_first_token()
            tracker.handle_tts_request_started()
            tracker.handle_first_tts_audio()
            tracker.handle_bot_started_speaking()
            completed_turn = tracker.handle_bot_stopped_speaking()

            assert interrupted_turn is not None
            assert completed_turn is not None

        interrupted_turns = [turn for turn in tracker.completed_turns if turn.status == "interrupted"]
        completed_turns = [turn for turn in tracker.completed_turns if turn.status == "completed"]

        self.assertEqual(len(tracker.completed_turns), 10)
        self.assertEqual(len(tracker.logged_summaries), 10)
        self.assertEqual(len(interrupted_turns), 5)
        self.assertEqual(len(completed_turns), 5)
        self.assertEqual([turn.turn_id for turn in interrupted_turns], [f"s1-t{index}" for index in (1, 3, 5, 7, 9)])
        self.assertEqual([turn.turn_id for turn in completed_turns], [f"s1-t{index}" for index in (2, 4, 6, 8, 10)])
        self.assertTrue(all(summary["barge_in_to_bot_silence_ms"] is not None for summary in tracker.logged_summaries[0::2]))
        self.assertTrue(all(summary["barge_in_to_bot_silence_ms"] is None for summary in tracker.logged_summaries[1::2]))
        self.assertEqual(len({summary["turn_id"] for summary in tracker.logged_summaries}), 10)

    def test_interrupted_then_completed_follow_up_then_end_session_ordering(self) -> None:
        tracker = self._build_tracker()

        tracker.handle_user_started_speaking()
        tracker.handle_user_stopped_speaking()
        tracker.handle_accepted_final_transcript("first")
        tracker.handle_llm_request_started()
        tracker.handle_bot_started_speaking()
        tracker.handle_user_started_speaking()
        interrupted_turn = tracker.handle_bot_stopped_speaking()

        tracker.handle_user_stopped_speaking()
        tracker.handle_llm_request_started()
        tracker.handle_llm_first_token()
        tracker.handle_tts_request_started()
        tracker.handle_first_tts_audio()
        tracker.handle_bot_started_speaking()
        follow_up_turn = tracker.handle_bot_stopped_speaking()

        tracker.handle_user_started_speaking()
        tracker.handle_user_stopped_speaking()
        tracker.handle_accepted_final_transcript("goodbye")
        tracker.mark_end_session_turn()
        tracker.handle_tts_request_started()
        tracker.handle_first_tts_audio()
        tracker.handle_bot_started_speaking()
        end_session_turn = tracker.handle_bot_stopped_speaking()

        assert interrupted_turn is not None
        assert follow_up_turn is not None
        assert end_session_turn is not None
        self.assertEqual(interrupted_turn.status, "interrupted")
        self.assertEqual(follow_up_turn.status, "incomplete-metrics")
        self.assertEqual(end_session_turn.status, "end-session")
        self.assertEqual(
            [turn.turn_id for turn in tracker.completed_turns],
            ["s1-t1", "s1-t2", "s1-t3"],
        )

    def test_reset_session_clears_old_completed_turn_state(self) -> None:
        tracker = self._build_tracker()

        first_turn = self._run_completed_turn(tracker, "before-reset")
        tracker.reset_session()
        second_turn = self._run_completed_turn(tracker, "after-reset")

        assert first_turn is not None
        assert second_turn is not None
        self.assertEqual([turn.turn_id for turn in tracker.completed_turns], ["s2-t1"])
        self.assertEqual(second_turn.final_transcript_text, "after-reset")

    def _build_tracker(self) -> VoiceTurnLatencyTracker:
        return VoiceTurnLatencyTracker(monotonic_clock=FakeMonotonicClock())

    def _run_completed_turn(
        self,
        tracker: VoiceTurnLatencyTracker,
        transcript_text: str,
    ) -> VoiceTurnLatencyRecord | None:
        tracker.handle_user_started_speaking()
        tracker.handle_user_stopped_speaking()
        tracker.handle_accepted_final_transcript(transcript_text)
        tracker.handle_llm_request_started()
        tracker.handle_llm_first_token()
        tracker.handle_tts_request_started()
        tracker.handle_first_tts_audio()
        tracker.handle_bot_started_speaking()
        return tracker.handle_bot_stopped_speaking()


class DeterministicEndSessionProcessorTests(unittest.IsolatedAsyncioTestCase):
    async def test_accepted_end_turn_does_not_reach_llm_boundary(self) -> None:
        modules = self._modules()
        controller = FakeTerminationController()
        processor = create_deterministic_end_session_processor(modules, controller)
        pushed: list[tuple[object, object]] = []
        processor.push_frame = self._make_push_frame(pushed)  # type: ignore[method-assign]

        await processor.process_frame(
            self._transcription_frame(modules, "Bye."),
            modules["FrameDirection"].DOWNSTREAM,
        )

        self.assertEqual(pushed, [])
        self.assertEqual(controller.requests, ["deterministic-final-transcript"])

    async def test_rejected_end_turn_reaches_llm_boundary(self) -> None:
        modules = self._modules()
        controller = FakeTerminationController()
        processor = create_deterministic_end_session_processor(modules, controller)
        pushed: list[tuple[object, object]] = []
        processor.push_frame = self._make_push_frame(pushed)  # type: ignore[method-assign]

        frame = self._transcription_frame(modules, "What does goodbye mean?")
        direction = modules["FrameDirection"].DOWNSTREAM
        await processor.process_frame(frame, direction)

        self.assertEqual(pushed, [(frame, direction)])
        self.assertEqual(controller.requests, [])

    async def test_repeated_bye_messages_trigger_cleanup_only_once(self) -> None:
        modules = self._modules()
        controller = FakeTerminationController(ending=True)
        processor = create_deterministic_end_session_processor(modules, controller)
        pushed: list[tuple[object, object]] = []
        processor.push_frame = self._make_push_frame(pushed)  # type: ignore[method-assign]

        await processor.process_frame(
            self._transcription_frame(modules, "Bye."),
            modules["FrameDirection"].DOWNSTREAM,
        )

        self.assertEqual(pushed, [])
        self.assertEqual(controller.requests, ["deterministic-repeat"])

    def _modules(self) -> dict[str, object]:
        class FakeFrameProcessor:
            def __init__(self, **kwargs: object) -> None:
                self.kwargs = kwargs

            async def process_frame(self, frame: object, direction: object) -> None:
                return None

            async def push_frame(self, frame: object, direction: object) -> None:
                return None

        class FakeTranscriptionFrame:
            def __init__(self, text: str) -> None:
                self.text = text

        return {
            "FrameDirection": SimpleNamespace(DOWNSTREAM="downstream", UPSTREAM="upstream"),
            "FrameProcessor": FakeFrameProcessor,
            "TranscriptionFrame": FakeTranscriptionFrame,
        }

    def _transcription_frame(self, modules: dict[str, object], text: str) -> object:
        return modules["TranscriptionFrame"](text)

    def _make_push_frame(
        self,
        pushed: list[tuple[object, object]],
    ):
        async def push_frame(frame: object, direction: object) -> None:
            pushed.append((frame, direction))

        return push_frame


class VADUserStopAdapterProcessorTests(unittest.IsolatedAsyncioTestCase):
    async def test_single_utterance_final_transcript_reaches_llm_once(self) -> None:
        modules = self._modules()
        processor = create_vad_user_stop_adapter_processor(modules)
        direction = modules["FrameDirection"].DOWNSTREAM
        llm_requests = 0
        transcript_text = ""
        pushed_frames: list[object] = []

        async def push_frame(frame: object, pushed_direction: object) -> None:
            nonlocal llm_requests, transcript_text
            self.assertEqual(pushed_direction, direction)
            pushed_frames.append(frame)

            if isinstance(frame, modules["UserStoppedSpeakingFrame"]):
                return

            if isinstance(frame, modules["TranscriptionFrame"]):
                transcript_text += frame.text
                if any(isinstance(item, modules["UserStoppedSpeakingFrame"]) for item in pushed_frames):
                    llm_requests += 1

        processor.push_frame = push_frame  # type: ignore[method-assign]

        other_frame = modules["OtherFrame"]()
        await processor.process_frame(other_frame, direction)
        await processor.process_frame(modules["VADUserStoppedSpeakingFrame"](), direction)
        await processor.process_frame(modules["TranscriptionFrame"]("hello there"), direction)

        self.assertIs(pushed_frames[0], other_frame)
        self.assertIsInstance(pushed_frames[1], modules["VADUserStoppedSpeakingFrame"])
        self.assertIsInstance(pushed_frames[2], modules["UserStoppedSpeakingFrame"])
        self.assertEqual(
            sum(isinstance(frame, modules["UserStoppedSpeakingFrame"]) for frame in pushed_frames),
            1,
        )
        self.assertEqual(transcript_text, "hello there")
        self.assertEqual(llm_requests, 1)

    def _modules(self) -> dict[str, object]:
        class FakeFrameProcessor:
            def __init__(self, **kwargs: object) -> None:
                self.kwargs = kwargs

            async def process_frame(self, frame: object, direction: object) -> None:
                return None

            async def push_frame(self, frame: object, direction: object) -> None:
                return None

        class FakeTranscriptionFrame:
            def __init__(self, text: str) -> None:
                self.text = text

        class FakeUserStoppedSpeakingFrame:
            pass

        class FakeVADUserStoppedSpeakingFrame:
            pass

        class FakeOtherFrame:
            pass

        return {
            "FrameDirection": SimpleNamespace(DOWNSTREAM="downstream", UPSTREAM="upstream"),
            "FrameProcessor": FakeFrameProcessor,
            "OtherFrame": FakeOtherFrame,
            "TranscriptionFrame": FakeTranscriptionFrame,
            "UserStoppedSpeakingFrame": FakeUserStoppedSpeakingFrame,
            "VADUserStoppedSpeakingFrame": FakeVADUserStoppedSpeakingFrame,
        }


class SessionTerminationControllerTests(unittest.IsolatedAsyncioTestCase):
    async def test_explicit_end_call_request_queues_goodbye_then_end_frame(self) -> None:
        controller, task, params, result_calls = self._build_controller("let's wrap this up now")

        await controller.handle_end_session_tool_call(params)
        await asyncio.sleep(0)

        self.assertEqual(result_calls[0]["result"]["ended"], True)
        self.assertEqual(result_calls[0]["properties"].kwargs["run_llm"], False)
        self.assertEqual(task.server_messages, [{"reason": "user-requested", "type": "session-ending"}])
        self.assertEqual(task.queued_frames[0].text, "Goodbye.")

        controller.handle_bot_stopped_speaking()
        await controller.wait_for_shutdown()

        self.assertEqual(task.queued_frames[1].reason, "user-requested-end-session")

    async def test_rejected_tool_request_does_not_end_session(self) -> None:
        controller, task, params, result_calls = self._build_controller("do not hang up")

        await controller.handle_end_session_tool_call(params)

        self.assertEqual(result_calls[0]["result"]["ended"], False)
        self.assertEqual(result_calls[0]["properties"].kwargs["run_llm"], True)
        self.assertEqual(task.queued_frames, [])
        self.assertEqual(task.server_messages, [])

    async def test_duplicate_end_session_requests_do_not_duplicate_cleanup(self) -> None:
        controller, task, params, first_calls = self._build_controller("let's wrap this up now")
        _, _, duplicate_params, second_calls = self._build_controller(
            "let's wrap this up now",
            task=task,
            controller=controller,
        )

        await controller.handle_end_session_tool_call(params)
        await controller.handle_end_session_tool_call(duplicate_params)
        await asyncio.sleep(0)

        self.assertEqual(len(task.queued_frames), 1)
        self.assertEqual(first_calls[0]["result"]["alreadyEnding"], False)
        self.assertEqual(second_calls[0]["result"]["alreadyEnding"], True)

        controller.handle_bot_stopped_speaking()
        await controller.wait_for_shutdown()
        self.assertEqual(len(task.queued_frames), 2)

    async def test_cancel_pipeline_task_awaits_async_cancel(self) -> None:
        calls: list[str | None] = []

        class FakeTask:
            async def cancel(self, *, reason: str | None = None) -> None:
                calls.append(reason)

        await cancel_pipeline_task(FakeTask(), reason="client-disconnected")
        self.assertEqual(calls, ["client-disconnected"])

    async def test_end_session_then_reconnect_starts_fresh_controller_state(self) -> None:
        first_controller, first_task, params, _ = self._build_controller("goodbye")

        await first_controller.handle_end_session_tool_call(params)
        await asyncio.sleep(0)
        first_controller.handle_bot_stopped_speaking()
        await first_controller.wait_for_shutdown()

        second_controller, second_task, second_params, second_calls = self._build_controller("goodbye")
        await second_controller.handle_end_session_tool_call(second_params)
        await asyncio.sleep(0)

        self.assertTrue(first_controller.is_ending)
        self.assertFalse(second_calls[0]["result"]["alreadyEnding"])
        self.assertEqual(len(first_task.queued_frames), 2)
        self.assertEqual(len(second_task.queued_frames), 1)

        second_controller.handle_bot_stopped_speaking()
        await second_controller.wait_for_shutdown()
        self.assertEqual(len(second_task.queued_frames), 2)

    async def test_two_concurrent_session_termination_controllers_remain_isolated(self) -> None:
        first_controller, first_task, first_params, first_calls = self._build_controller("bye")
        second_controller, second_task, second_params, second_calls = self._build_controller("bye")

        await first_controller.handle_end_session_tool_call(first_params)
        await asyncio.sleep(0)

        self.assertTrue(first_controller.is_ending)
        self.assertFalse(second_controller.is_ending)
        self.assertEqual(first_calls[0]["result"]["ended"], True)
        self.assertEqual(second_calls, [])
        self.assertEqual(len(first_task.queued_frames), 1)
        self.assertEqual(second_task.queued_frames, [])

        await second_controller.handle_end_session_tool_call(second_params)
        await asyncio.sleep(0)
        self.assertEqual(len(second_task.queued_frames), 1)

    def _build_controller(
        self,
        user_request_text: str,
        *,
        task: object | None = None,
        controller: SessionTerminationController | None = None,
    ) -> tuple[SessionTerminationController, object, object, list[dict[str, object]]]:
        class FakeFunctionCallResultProperties:
            def __init__(self, **kwargs: object) -> None:
                self.kwargs = kwargs

        class FakeTTSSpeakFrame:
            def __init__(self, text: str, append_to_context: bool = True) -> None:
                self.text = text
                self.append_to_context = append_to_context

        class FakeEndFrame:
            def __init__(self, reason: str | None = None) -> None:
                self.reason = reason

        class FakeRTVI:
            def __init__(self) -> None:
                self.messages: list[dict[str, object]] = []

            async def send_server_message(self, data: dict[str, object]) -> None:
                self.messages.append(data)

        class FakeTask:
            def __init__(self) -> None:
                self.queued_frames: list[object] = []
                self._rtvi = FakeRTVI()
                self.server_messages = self._rtvi.messages

            @property
            def rtvi(self) -> FakeRTVI:
                return self._rtvi

            async def queue_frame(self, frame: object) -> None:
                self.queued_frames.append(frame)

        modules = {
            "FunctionCallResultProperties": FakeFunctionCallResultProperties,
            "TTSSpeakFrame": FakeTTSSpeakFrame,
            "EndFrame": FakeEndFrame,
        }

        next_task = task or FakeTask()
        next_controller = controller or SessionTerminationController(modules)
        next_controller.attach_task(next_task)

        result_calls: list[dict[str, object]] = []

        async def result_callback(result: object, *, properties: object | None = None) -> None:
            result_calls.append({"properties": properties, "result": result})

        params = SimpleNamespace(
            arguments={"user_request_text": user_request_text},
            result_callback=result_callback,
        )
        return next_controller, next_task, params, result_calls


class DeepgramStartupControllerTests(unittest.IsolatedAsyncioTestCase):
    async def test_success_on_first_connection_marks_ready(self) -> None:
        controller, _, _ = self._build_controller()

        controller.note_initial_connection_attempt()
        controller.handle_connected()

        self.assertEqual(controller.attempt_count, 1)
        self.assertTrue(controller.startup_ready)

    async def test_timeout_then_successful_retry(self) -> None:
        controller, stt, _ = self._build_controller(connect_outcomes=[True])

        controller.note_initial_connection_attempt()
        handled = await controller.handle_connection_error(
            "timed out during opening handshake",
            source="stt-event",
        )
        await controller.wait_for_retry_completion()

        self.assertTrue(handled)
        self.assertEqual(controller.attempt_count, 2)
        self.assertTrue(controller.startup_ready)
        self.assertEqual(stt.connect_calls, 1)
        self.assertEqual(stt.disconnect_calls, 1)

    async def test_all_retries_exhausted_cancel_pipeline_and_emit_provider_error(self) -> None:
        controller, stt, task = self._build_controller(connect_outcomes=[False, False])

        controller.note_initial_connection_attempt()
        handled = await controller.handle_connection_error(
            "timed out during opening handshake",
            source="stt-event",
        )
        await controller.wait_for_retry_completion()

        self.assertTrue(handled)
        self.assertEqual(controller.attempt_count, 3)
        self.assertFalse(controller.startup_ready)
        self.assertEqual(stt.connect_calls, 2)
        self.assertEqual(stt.disconnect_calls, 2)
        self.assertEqual(task.cancel_reasons, ["deepgram-startup-handshake-failed"])
        self.assertEqual(
            task.server_messages,
            [{"provider": "deepgram", "stage": "startup", "type": "provider-error"}],
        )
        self.assertEqual(
            task.error_messages,
            ["Deepgram transcription could not connect. Please disconnect and connect again."],
        )

    async def test_disconnect_during_backoff_cancels_retry(self) -> None:
        controller, stt, task = self._build_controller(
            connect_outcomes=[True],
            backoff_delays=(0.2, 0.2),
        )

        controller.note_initial_connection_attempt()
        handled = await controller.handle_connection_error(
            "timed out during opening handshake",
            source="stt-event",
        )
        await controller.handle_client_disconnected()
        await controller.wait_for_retry_completion()

        self.assertTrue(handled)
        self.assertEqual(stt.connect_calls, 0)
        self.assertEqual(stt.disconnect_calls, 0)
        self.assertEqual(task.cancel_reasons, [])

    async def test_duplicate_retry_prevention(self) -> None:
        controller, stt, _ = self._build_controller(
            connect_outcomes=[True],
            backoff_delays=(0.2, 0.2),
        )

        controller.note_initial_connection_attempt()
        first = await controller.handle_connection_error(
            "timed out during opening handshake",
            source="stt-event",
        )
        second = await controller.handle_connection_error(
            "timed out during opening handshake",
            source="pipeline-error",
        )
        await controller.wait_for_retry_completion()

        self.assertTrue(first)
        self.assertTrue(second)
        self.assertEqual(stt.connect_calls, 1)
        self.assertEqual(stt.disconnect_calls, 1)

    async def test_fresh_retry_state_after_reconnect(self) -> None:
        first_controller, _, first_task = self._build_controller(connect_outcomes=[False, False])
        first_controller.note_initial_connection_attempt()
        await first_controller.handle_connection_error(
            "timed out during opening handshake",
            source="stt-event",
        )
        await first_controller.wait_for_retry_completion()

        second_controller, second_stt, second_task = self._build_controller(connect_outcomes=[True])
        second_controller.note_initial_connection_attempt()
        await second_controller.handle_connection_error(
            "timed out during opening handshake",
            source="stt-event",
        )
        await second_controller.wait_for_retry_completion()

        self.assertEqual(first_task.cancel_reasons, ["deepgram-startup-handshake-failed"])
        self.assertEqual(second_controller.attempt_count, 2)
        self.assertTrue(second_controller.startup_ready)
        self.assertEqual(second_stt.connect_calls, 1)
        self.assertEqual(second_task.cancel_reasons, [])

    async def test_disconnect_during_retry_backoff_clears_retry_task_state(self) -> None:
        controller, stt, _ = self._build_controller(
            connect_outcomes=[True],
            backoff_delays=(0.2, 0.2),
        )

        controller.note_initial_connection_attempt()
        handled = await controller.handle_connection_error(
            "timed out during opening handshake",
            source="stt-event",
        )
        await controller.handle_client_disconnected()
        await controller.wait_for_retry_completion()
        await asyncio.sleep(0)

        self.assertTrue(handled)
        self.assertIsNone(controller.retry_task)
        self.assertEqual(controller.attempt_count, 1)
        self.assertEqual(stt.connect_calls, 0)
        self.assertEqual(stt.disconnect_calls, 0)

    async def test_provider_error_lifecycle_emits_once_and_cleans_up_once(self) -> None:
        latency_tracker = SummaryCapturingLatencyTracker(monotonic_clock=FakeMonotonicClock())
        latency_tracker.handle_user_started_speaking()
        latency_tracker.handle_user_stopped_speaking()
        latency_tracker.handle_accepted_final_transcript("hello")

        controller, stt, task = self._build_controller(
            connect_outcomes=[False, False],
            latency_tracker=latency_tracker,
        )

        controller.note_initial_connection_attempt()
        handled = await controller.handle_connection_error(
            "timed out during opening handshake",
            source="stt-event",
        )
        await controller.wait_for_retry_completion()

        self.assertTrue(handled)
        self.assertEqual(stt.connect_calls, 2)
        self.assertEqual(stt.disconnect_calls, 2)
        self.assertEqual(task.cancel_reasons, ["deepgram-startup-handshake-failed"])
        self.assertEqual(len(task.server_messages), 1)
        self.assertEqual(len(task.error_messages), 1)
        self.assertEqual(len(latency_tracker.completed_turns), 1)
        self.assertEqual(len(latency_tracker.logged_summaries), 1)
        self.assertEqual(latency_tracker.completed_turns[0].status, "provider-error")
        self.assertEqual(
            [summary["status"] for summary in latency_tracker.logged_summaries],
            ["provider-error"],
        )

    async def test_two_concurrent_session_state_objects_remain_isolated(self) -> None:
        first_tracker = SummaryCapturingLatencyTracker(monotonic_clock=FakeMonotonicClock())
        second_tracker = SummaryCapturingLatencyTracker(monotonic_clock=FakeMonotonicClock())
        first_tracker.reset_session()

        first_turn = run_completed_turn(first_tracker, "first")
        second_turn = run_completed_turn(second_tracker, "second")

        first_controller, first_stt, first_task = self._build_controller(
            connect_outcomes=[False, False],
            latency_tracker=first_tracker,
        )
        second_controller, second_stt, second_task = self._build_controller(
            connect_outcomes=[True],
            latency_tracker=second_tracker,
        )

        first_controller.note_initial_connection_attempt()
        await first_controller.handle_connection_error(
            "timed out during opening handshake",
            source="stt-event",
        )
        await first_controller.wait_for_retry_completion()

        second_controller.note_initial_connection_attempt()
        await second_controller.handle_connection_error(
            "timed out during opening handshake",
            source="stt-event",
        )
        await second_controller.wait_for_retry_completion()

        assert first_turn is not None
        assert second_turn is not None
        self.assertEqual(first_turn.turn_id, "s2-t1")
        self.assertEqual(second_turn.turn_id, "s1-t1")
        self.assertEqual(first_task.cancel_reasons, ["deepgram-startup-handshake-failed"])
        self.assertEqual(second_task.cancel_reasons, [])
        self.assertEqual(first_stt.connect_calls, 2)
        self.assertEqual(second_stt.connect_calls, 1)
        self.assertEqual(len(first_tracker.logged_summaries), 1)
        self.assertEqual(len(second_tracker.logged_summaries), 1)

    async def test_accepted_first_user_turn_blocks_startup_retry(self) -> None:
        controller, stt, task = self._build_controller(connect_outcomes=[True])

        controller.note_initial_connection_attempt()
        controller.mark_first_user_turn_accepted("hello there")
        handled = await controller.handle_connection_error(
            "timed out during opening handshake",
            source="stt-event",
        )
        await controller.wait_for_retry_completion()

        self.assertTrue(handled)
        self.assertEqual(stt.connect_calls, 0)
        self.assertEqual(task.cancel_reasons, [])

    def _build_controller(
        self,
        *,
        connect_outcomes: list[bool] | None = None,
        backoff_delays: tuple[float, ...] = (0.0, 0.0),
        latency_tracker: VoiceTurnLatencyTracker | None = None,
    ) -> tuple[DeepgramStartupController, object, object]:
        class FakeRTVI:
            def __init__(self) -> None:
                self.messages: list[dict[str, object]] = []
                self.errors: list[str] = []

            async def send_server_message(self, data: dict[str, object]) -> None:
                self.messages.append(data)

            async def send_error(self, error: str) -> None:
                self.errors.append(error)

        class FakeTask:
            def __init__(self) -> None:
                self._rtvi = FakeRTVI()
                self.cancel_reasons: list[str | None] = []

            @property
            def rtvi(self) -> FakeRTVI:
                return self._rtvi

            @property
            def server_messages(self) -> list[dict[str, object]]:
                return self._rtvi.messages

            @property
            def error_messages(self) -> list[str]:
                return self._rtvi.errors

            async def cancel(self, *, reason: str | None = None) -> None:
                self.cancel_reasons.append(reason)

        class FakeSTT:
            def __init__(self, controller: DeepgramStartupController | None = None) -> None:
                self.controller = controller
                self.connect_calls = 0
                self.disconnect_calls = 0
                self.outcomes = list(connect_outcomes or [])

            async def _connect(self) -> None:
                self.connect_calls += 1
                outcome = self.outcomes.pop(0) if self.outcomes else False
                if outcome and self.controller is not None:
                    self.controller.handle_connected()

            async def _disconnect(self) -> None:
                self.disconnect_calls += 1

        fake_stt = FakeSTT()
        controller = DeepgramStartupController(
            fake_stt,
            latency_tracker=latency_tracker,
            backoff_delays=backoff_delays,
            jitter_max=0.0,
        )
        fake_stt.controller = controller
        task = FakeTask()
        controller.attach_task(task)
        return controller, fake_stt, task


class VoiceStartupTimingTrackerTests(unittest.TestCase):
    def test_tracker_records_startup_milestones_once(self) -> None:
        tracker = VoiceStartupTimingTracker(monotonic_clock=FakeMonotonicClock())

        tracker.mark_runtime_config_loaded()
        tracker.mark_transport_created()
        tracker.mark_stt_created()
        tracker.mark_llm_created()
        tracker.mark_tts_created()
        tracker.mark_deepgram_connect_started()
        tracker.mark_deepgram_connect_completed()
        tracker.mark_cartesia_connect_started()
        tracker.mark_cartesia_connect_completed()
        tracker.mark_context_created()
        tracker.mark_vad_created()
        tracker.mark_aggregators_created()
        tracker.mark_pipeline_constructed()
        tracker.mark_task_constructed()
        tracker.mark_event_handlers_registered()
        tracker.mark_pipeline_runner_created()
        tracker.mark_provider_preconnect_task_scheduled()
        tracker.mark_pipeline_run_started()
        tracker.mark_pipeline_ready()
        tracker.mark_greeting_first_audio()
        tracker.mark_runtime_config_loaded()

        self.assertEqual(
            tracker.summarize(),
            {
                "runtime_config_loaded_ms": 100,
                "deepgram_connect_start_ms": 600,
                "deepgram_connect_end_ms": 700,
                "cartesia_connect_start_ms": 800,
                "cartesia_connect_end_ms": 900,
                "pipeline_ready_ms": 1900,
                "greeting_first_audio_ms": 2000,
                "transport_created_ms": 200,
                "stt_created_ms": 300,
                "llm_created_ms": 400,
                "tts_created_ms": 500,
                "context_created_ms": 1000,
                "vad_created_ms": 1100,
                "aggregators_created_ms": 1200,
                "pipeline_constructed_ms": 1300,
                "task_constructed_ms": 1400,
                "event_handlers_registered_ms": 1500,
                "pipeline_runner_created_ms": 1600,
                "provider_preconnect_task_scheduled_ms": 1700,
                "pipeline_run_started_ms": 1800,
                "runtime_config_to_deepgram_connect_gap_ms": 500,
                "deepgram_ready_to_pipeline_ready_gap_ms": 1200,
                "cartesia_ready_to_pipeline_ready_gap_ms": 1000,
                "pipeline_start_wait_ms": 100,
                "startframe_last_handoff_to_pipeline_ready_ms": None,
                "startframe_slowest_processor": None,
                "startframe_slowest_processor_handoff_ms": None,
            },
        )

    def test_tracker_summarizes_startframe_processor_handoffs(self) -> None:
        tracker = VoiceStartupTimingTracker(monotonic_clock=FakeMonotonicClock())

        for label in (
            "transport_input",
            "stt",
            "deterministic_end_session",
            "user_aggregator",
        ):
            tracker.register_startframe_processor(label)

        tracker.mark_startframe_processor_entered("transport_input")
        tracker.mark_startframe_processor_pushed("transport_input")
        tracker.mark_startframe_processor_entered("stt")
        tracker.mark_startframe_processor_pushed("stt")
        tracker.mark_startframe_processor_entered("deterministic_end_session")
        tracker.mark_startframe_processor_pushed("deterministic_end_session")
        tracker.mark_startframe_processor_entered("user_aggregator")
        tracker.mark_startframe_processor_pushed("user_aggregator")
        tracker.mark_pipeline_ready()

        self.assertEqual(
            tracker.summarize_startframe(),
            {
                "startframe_transport_input_handoff_ms": 100,
                "startframe_stt_handoff_ms": 100,
                "startframe_deterministic_end_session_handoff_ms": 100,
                "startframe_user_aggregator_handoff_ms": 100,
                "startframe_last_handoff_to_pipeline_ready_ms": 100,
                "startframe_slowest_processor": "transport_input",
                "startframe_slowest_processor_handoff_ms": 100,
            },
        )

    def test_build_pipeline_task_marks_construction_stages(self) -> None:
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

        class FakeFrameProcessor:
            def __init__(self, **kwargs: object) -> None:
                self.kwargs = kwargs

        class FakeLLMContext:
            def __init__(self, messages: list[object] | None = None, tools: list[object] | None = None) -> None:
                self.messages = messages or []
                self.tools = tools or []

        class FakeAggregatorParams:
            def __init__(self, **kwargs: object) -> None:
                self.kwargs = kwargs

        class FakeUserTurnStrategies:
            def __init__(self, *, start: list[object], stop: list[object]) -> None:
                self.start = start
                self.stop = stop

        class FakeVADUserTurnStartStrategy:
            pass

        class FakeTranscriptionUserTurnStartStrategy:
            pass

        class FakeExternalUserTurnStopStrategy:
            def __init__(self, **kwargs: object) -> None:
                self.kwargs = kwargs

        class FakeVADParams:
            def __init__(self, **kwargs: object) -> None:
                self.kwargs = kwargs

        class FakeSileroVADAnalyzer:
            def __init__(self, *, params: object) -> None:
                self.params = params

        class FakeTextAggregationMode:
            TOKEN = "token"

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

        class FakeFunctionSchema:
            def __init__(
                self,
                name: str,
                description: str,
                properties: dict[str, object],
                required: list[str],
                handler: object | None = None,
            ) -> None:
                self.name = name
                self.description = description
                self.properties = properties
                self.required = required
                self.handler = handler

        class FakeTransport:
            def input(self) -> str:
                return "transport-input"

            def output(self) -> str:
                return "transport-output"

        modules = {
            "BaseObserver": FakeObserver,
            "BotStartedSpeakingFrame": type("BotStartedSpeakingFrame", (), {}),
            "BotStoppedSpeakingFrame": type("BotStoppedSpeakingFrame", (), {}),
            "FrameDirection": SimpleNamespace(DOWNSTREAM="downstream"),
            "FrameProcessor": FakeFrameProcessor,
            "FramePushed": FakeFramePushed,
            "InputAudioRawFrame": type("InputAudioRawFrame", (), {}),
            "InterimTranscriptionFrame": type("InterimTranscriptionFrame", (), {}),
            "LLMContextFrame": type("LLMContextFrame", (), {}),
            "LLMFullResponseEndFrame": type("LLMFullResponseEndFrame", (), {}),
            "LLMTextFrame": type("LLMTextFrame", (), {}),
            "TranscriptionFrame": type("TranscriptionFrame", (), {}),
            "VADUserStoppedSpeakingFrame": type("VADUserStoppedSpeakingFrame", (), {}),
            "TTSAudioRawFrame": type("TTSAudioRawFrame", (), {}),
            "TTSStartedFrame": type("TTSStartedFrame", (), {}),
            "UserStartedSpeakingFrame": type("UserStartedSpeakingFrame", (), {}),
            "UserStoppedSpeakingFrame": type("UserStoppedSpeakingFrame", (), {}),
            "Pipeline": FakePipeline,
            "PipelineParams": FakePipelineParams,
            "PipelineTask": FakePipelineTask,
            "FunctionSchema": FakeFunctionSchema,
            "FunctionCallResultProperties": type(
                "FunctionCallResultProperties",
                (),
                {"__init__": lambda self, **kwargs: setattr(self, "kwargs", kwargs)},
            ),
            "EndFrame": type("EndFrame", (), {}),
            "LLMContext": FakeLLMContext,
            "LLMContextAggregatorPair": fake_aggregator_pair,
            "LLMUserAggregatorParams": FakeAggregatorParams,
            "DeepgramFluxSTTService": FakeService,
            "GoogleLLMService": FakeService,
            "CartesiaTTSService": FakeService,
            "TextAggregationMode": FakeTextAggregationMode,
            "ExternalUserTurnStopStrategy": FakeExternalUserTurnStopStrategy,
            "TranscriptionUserTurnStartStrategy": FakeTranscriptionUserTurnStartStrategy,
            "UserTurnStrategies": FakeUserTurnStrategies,
            "VADParams": FakeVADParams,
            "VADUserTurnStartStrategy": FakeVADUserTurnStartStrategy,
            "SileroVADAnalyzer": FakeSileroVADAnalyzer,
            "TTSSpeakFrame": type(
                "TTSSpeakFrame",
                (),
                {"__init__": lambda self, text, append_to_context=True: setattr(self, "text", text)},
            ),
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
        tracker = VoiceStartupTimingTracker(monotonic_clock=FakeMonotonicClock())

        build_pipeline_task(FakeTransport(), modules, config, startup_timing_tracker=tracker)

        summary = tracker.summarize()
        self.assertEqual(summary["stt_created_ms"], 100)
        self.assertEqual(summary["llm_created_ms"], 200)
        self.assertEqual(summary["tts_created_ms"], 300)
        self.assertEqual(summary["context_created_ms"], 400)
        self.assertEqual(summary["vad_created_ms"], 500)
        self.assertEqual(summary["aggregators_created_ms"], 600)
        self.assertEqual(summary["pipeline_constructed_ms"], 700)
        self.assertEqual(summary["task_constructed_ms"], 800)


class ProviderPreconnectTests(unittest.IsolatedAsyncioTestCase):
    async def test_start_provider_preconnects_starts_deepgram_when_task_manager_ready(
        self,
    ) -> None:
        class FakeDeepgramService:
            def __init__(self) -> None:
                self.connect_calls = 0
                self._task_manager = object()

            async def _connect(self) -> None:
                self.connect_calls += 1

        class FakeCartesiaService:
            def __init__(self) -> None:
                self.connect_calls = 0

            async def _connect(self) -> None:
                self.connect_calls += 1

        deepgram_service = FakeDeepgramService()
        cartesia_service = FakeCartesiaService()
        controller = SimpleNamespace(_stt_service=deepgram_service)

        await start_provider_preconnects(
            deepgram_startup_controller=controller,
            tts_service=cartesia_service,
        )

        self.assertEqual(deepgram_service.connect_calls, 1)
        self.assertEqual(cartesia_service.connect_calls, 1)

    async def test_start_provider_preconnects_skips_deepgram_without_task_manager(self) -> None:
        class FakeDeepgramService:
            def __init__(self) -> None:
                self.connect_calls = 0
                self._task_manager = None

            async def _connect(self) -> None:
                self.connect_calls += 1

        class FakeCartesiaService:
            def __init__(self) -> None:
                self.connect_calls = 0

            async def _connect(self) -> None:
                self.connect_calls += 1

        deepgram_service = FakeDeepgramService()
        cartesia_service = FakeCartesiaService()
        controller = SimpleNamespace(_stt_service=deepgram_service)

        await start_provider_preconnects(
            deepgram_startup_controller=controller,
            tts_service=cartesia_service,
        )

        self.assertEqual(deepgram_service.connect_calls, 0)
        self.assertEqual(cartesia_service.connect_calls, 1)

    async def test_defer_deepgram_connect_during_startframe_does_not_block_start(self) -> None:
        connect_started = asyncio.Event()
        connect_release = asyncio.Event()
        call_order: list[str] = []

        class FakeService:
            async def start(self, frame: object) -> None:
                call_order.append("start-begin")
                await self._connect()
                call_order.append("start-end")

            async def _connect(self) -> None:
                call_order.append("connect")
                connect_started.set()
                await connect_release.wait()

        service = FakeService()
        defer_deepgram_connect_during_startframe(service)

        start_task = asyncio.create_task(service.start(object()))
        await asyncio.sleep(0)
        self.assertTrue(start_task.done(), "StartFrame must finish without awaiting Deepgram")
        self.assertEqual(call_order, ["start-begin", "start-end"])

        # Background connect should still be scheduled.
        await connect_started.wait()
        connect_release.set()
        await asyncio.sleep(0)
        self.assertIn("connect", call_order)

    async def test_adopt_warm_deepgram_websocket_marks_service_connected(self) -> None:
        class FakeWebsocket:
            def __init__(self) -> None:
                self.state = SimpleNamespace(name="OPEN")

        class FakeService:
            def __init__(self) -> None:
                self._websocket = None
                self._connection_established_event = asyncio.Event()
                self._receive_task = None
                self._watchdog_task = None
                self._task_manager = object()
                self.connected_events = 0
                self.created_tasks = 0

            def create_task(self, coro: object) -> str:
                if asyncio.iscoroutine(coro):
                    coro.close()
                self.created_tasks += 1
                return f"task-{self.created_tasks}"

            async def _receive_task_handler(self, report_error: object) -> None:
                return None

            async def _watchdog_task_handler(self) -> None:
                return None

            def _report_error(self, error: object) -> None:
                return None

            async def _call_event_handler(self, name: str, *args: object) -> None:
                if name == "on_connected":
                    self.connected_events += 1

        from app.deepgram_pool import WarmDeepgramConnection

        service = FakeService()
        warm = WarmDeepgramConnection(
            websocket=FakeWebsocket(),
            url="wss://example/listen",
            model="flux-general-en",
            sample_rate=16000,
        )
        await adopt_warm_deepgram_websocket(service, warm)

        self.assertIs(service._websocket, warm.websocket)
        self.assertTrue(service._connection_established_event.is_set())
        self.assertEqual(service.connected_events, 1)
        self.assertEqual(service.created_tasks, 2)

    async def test_adopt_warm_deepgram_websocket_rolls_back_on_create_task_failure(self) -> None:
        class FakeWebsocket:
            def __init__(self) -> None:
                self.state = SimpleNamespace(name="OPEN")

        class FakeService:
            def __init__(self) -> None:
                self._websocket = None
                self._connection_established_event = asyncio.Event()
                self._receive_task = None
                self._watchdog_task = None
                self._task_manager = object()
                self._user_is_speaking = False

            def create_task(self, coro: object) -> str:
                if asyncio.iscoroutine(coro):
                    coro.close()
                raise RuntimeError("task manager not ready")

            async def _receive_task_handler(self, report_error: object) -> None:
                return None

            async def _watchdog_task_handler(self) -> None:
                return None

            def _report_error(self, error: object) -> None:
                return None

            async def _call_event_handler(self, name: str, *args: object) -> None:
                return None

        from app.deepgram_pool import WarmDeepgramConnection

        service = FakeService()
        warm = WarmDeepgramConnection(
            websocket=FakeWebsocket(),
            url="wss://example/listen",
            model="flux-general-en",
            sample_rate=16000,
        )
        with self.assertRaisesRegex(RuntimeError, "task manager not ready"):
            await adopt_warm_deepgram_websocket(service, warm)

        self.assertIsNone(service._websocket)
        self.assertFalse(service._connection_established_event.is_set())
        self.assertIsNone(service._receive_task)

    async def test_attach_deepgram_warm_pool_uses_pool_before_cold_connect(self) -> None:
        from app.deepgram_pool import DeepgramWarmPool, WarmDeepgramConnection

        class FakeService:
            def __init__(self) -> None:
                self._websocket = None
                self._websocket_url = (
                    "wss://api.deepgram.com/v2/listen?"
                    "model=flux-general-en&sample_rate=16000&encoding=linear16"
                )
                self.original_connect_calls = 0

            async def _connect_websocket(self) -> None:
                self.original_connect_calls += 1

        service = FakeService()
        pool = DeepgramWarmPool(api_key="dg-key", model="flux-general-en", pool_size=1)
        warm_socket = object()
        await pool._available.put(
            WarmDeepgramConnection(
                websocket=warm_socket,
                url=service._websocket_url,
                model="flux-general-en",
                sample_rate=16000,
            )
        )

        adopted: list[object] = []

        async def fake_adopt(stt: object, warm: WarmDeepgramConnection) -> None:
            adopted.append(warm.websocket)
            stt._websocket = warm.websocket  # type: ignore[attr-defined]

        attach_deepgram_warm_pool(service, pool)
        with mock.patch("app.bot.adopt_warm_deepgram_websocket", side_effect=fake_adopt):
            await service._connect_websocket()

        self.assertEqual(service.original_connect_calls, 0)
        self.assertEqual(adopted, [warm_socket])
        self.assertIs(service._websocket, warm_socket)

    async def test_instrument_service_connect_records_start_and_end(self) -> None:
        call_order: list[str] = []
        tracker = VoiceStartupTimingTracker(monotonic_clock=FakeMonotonicClock())

        class FakeService:
            async def _connect(self) -> None:
                call_order.append("connect")

        service = FakeService()
        instrument_service_connect(
            service,
            on_connect_start=lambda: (
                call_order.append("start"),
                tracker.mark_deepgram_connect_started(),
            ),
            on_connect_end=lambda: (
                call_order.append("end"),
                tracker.mark_deepgram_connect_completed(),
            ),
        )

        await service._connect()

        self.assertEqual(call_order, ["start", "connect", "end"])
        self.assertEqual(tracker.summarize()["deepgram_connect_start_ms"], 100)
        self.assertEqual(tracker.summarize()["deepgram_connect_end_ms"], 200)

    async def test_instrument_service_connect_is_idempotent_after_preconnect(self) -> None:
        """Second _connect() call (from StartFrame lifecycle) must be a no-op.

        The preconnect task calls _connect() before StartFrame propagates.
        Pipecat's service.start() then calls _connect() again.  With the fix,
        the second call returns immediately without opening a second WebSocket.
        """
        call_order: list[str] = []

        class FakeService:
            async def _connect(self) -> None:
                call_order.append("connect")

        service = FakeService()
        instrument_service_connect(
            service,
            on_connect_start=lambda: call_order.append("start"),
            on_connect_end=lambda: call_order.append("end"),
        )

        # First call: preconnect path
        await service._connect()
        # Second call: StartFrame lifecycle (should be a no-op)
        await service._connect()
        # Third call: still no-op
        await service._connect()

        self.assertEqual(
            call_order,
            ["start", "connect", "end"],
            "Only the first _connect() call should open a connection",
        )

    async def test_instrument_service_connect_simultaneous_callers_share_one_attempt(
        self,
    ) -> None:
        """Two concurrent _connect() calls must trigger exactly one real connect.

        Simulates the preconnect task and StartFrame lifecycle both racing to
        call _connect() before the first completes.
        """
        connect_count = 0
        connect_started = asyncio.Event()
        connect_proceed = asyncio.Event()

        class FakeService:
            async def _connect(self) -> None:
                nonlocal connect_count
                connect_count += 1
                connect_started.set()
                await connect_proceed.wait()

        service = FakeService()
        instrument_service_connect(
            service,
            on_connect_start=lambda: None,
            on_connect_end=lambda: None,
        )

        # Launch two concurrent callers.
        task_a = asyncio.create_task(service._connect())
        await connect_started.wait()  # first caller is inside connect()
        task_b = asyncio.create_task(service._connect())

        # Let the first connect finish.
        connect_proceed.set()
        await asyncio.gather(task_a, task_b)

        self.assertEqual(connect_count, 1, "Only one real connect should have been made")

    async def test_instrument_service_connect_failed_first_connect_allows_retry(
        self,
    ) -> None:
        """A failed first _connect() must not block subsequent retry attempts.

        This is the core regression: the old code set _already_connected=True
        before connect() succeeded, turning all retries into silent no-ops.
        """
        attempt = 0

        class FakeService:
            async def _connect(self) -> None:
                nonlocal attempt
                attempt += 1
                if attempt == 1:
                    raise ConnectionError("handshake timeout")

        service = FakeService()
        call_log: list[str] = []
        instrument_service_connect(
            service,
            on_connect_start=lambda: call_log.append("start"),
            on_connect_end=lambda: call_log.append("end"),
        )

        # First attempt fails.
        with self.assertRaises(ConnectionError):
            await service._connect()

        # Second attempt (retry) must not be a no-op.
        await service._connect()

        self.assertEqual(attempt, 2, "Retry must reach the real _connect()")
        self.assertEqual(call_log, ["start", "start", "end"])

    async def test_instrument_service_connect_disconnect_then_reconnect(
        self,
    ) -> None:
        """connect -> disconnect -> connect must open a real new connection.

        This is the state-invalidation fix: _disconnect must clear the resolved
        future so the subsequent _connect() does not reuse stale connected state.
        """
        connect_count = 0

        class FakeService:
            async def _connect(self) -> None:
                nonlocal connect_count
                connect_count += 1

            async def _disconnect(self) -> None:
                pass

        service = FakeService()
        instrument_service_connect(
            service,
            on_connect_start=lambda: None,
            on_connect_end=lambda: None,
        )

        # First connect: real.
        await service._connect()
        self.assertEqual(connect_count, 1)

        # Disconnect invalidates state.
        await service._disconnect()

        # Second connect after disconnect: must be a real new connection.
        await service._connect()
        self.assertEqual(connect_count, 2, "connect after disconnect must open a new connection")

    async def test_instrument_service_connect_successful_preconnect_reused_by_startframe(
        self,
    ) -> None:
        """Successful preconnect is reused when StartFrame lifecycle calls _connect."""
        call_log: list[str] = []

        class FakeService:
            async def _connect(self) -> None:
                call_log.append("connect")

        service = FakeService()
        instrument_service_connect(
            service,
            on_connect_start=lambda: call_log.append("start"),
            on_connect_end=lambda: call_log.append("end"),
        )

        # Preconnect path.
        await service._connect()
        # StartFrame lifecycle path (should be a no-op).
        await service._connect()
        # Any further calls also no-ops.
        await service._connect()

        self.assertEqual(
            call_log,
            ["start", "connect", "end"],
            "Only the preconnect call should open a connection",
        )

    def test_log_summary_does_not_raise_type_error(self) -> None:
        """log_summary must not raise TypeError from extra logging args."""
        tracker = VoiceStartupTimingTracker(monotonic_clock=FakeMonotonicClock())
        tracker.mark_runtime_config_loaded()
        tracker.mark_transport_created()
        tracker.mark_stt_created()
        tracker.mark_llm_created()
        tracker.mark_tts_created()
        tracker.mark_deepgram_connect_started()
        tracker.mark_deepgram_connect_completed()
        tracker.mark_cartesia_connect_started()
        tracker.mark_cartesia_connect_completed()
        tracker.mark_context_created()
        tracker.mark_vad_created()
        tracker.mark_aggregators_created()
        tracker.mark_pipeline_constructed()
        tracker.mark_task_constructed()
        tracker.mark_event_handlers_registered()
        tracker.mark_pipeline_runner_created()
        tracker.mark_provider_preconnect_task_scheduled()
        tracker.mark_pipeline_run_started()
        tracker.mark_pipeline_ready()
        tracker.mark_greeting_first_audio()
        # Must not raise TypeError
        tracker.log_summary()

    def test_log_startframe_summary_does_not_raise_type_error(self) -> None:
        """log_startframe_summary must not raise TypeError from extra logging args."""
        tracker = VoiceStartupTimingTracker(monotonic_clock=FakeMonotonicClock())
        tracker.register_startframe_processor("transport_input")
        tracker.register_startframe_processor("stt")
        tracker.mark_startframe_processor_entered("transport_input")
        tracker.mark_startframe_processor_pushed("transport_input")
        tracker.mark_startframe_processor_entered("stt")
        tracker.mark_startframe_processor_pushed("stt")
        tracker.mark_pipeline_ready()
        # Must not raise TypeError
        tracker.log_startframe_summary()


class FakeMonotonicClock:
    def __init__(self, *, step: float = 0.1) -> None:
        self._step = step
        self._current = 0.0

    def __call__(self) -> float:
        value = self._current
        self._current += self._step
        return value


class SummaryCapturingLatencyTracker(VoiceTurnLatencyTracker):
    def __init__(self, *, monotonic_clock: object | None = None) -> None:
        super().__init__(monotonic_clock=monotonic_clock)
        self.logged_summaries: list[dict[str, int | str | None]] = []

    def log_turn_summary(self, turn: VoiceTurnLatencyRecord) -> None:
        self.logged_summaries.append(self.summarize_turn(turn))


def run_completed_turn(
    tracker: VoiceTurnLatencyTracker,
    transcript_text: str,
) -> VoiceTurnLatencyRecord | None:
    tracker.handle_user_started_speaking()
    tracker.handle_user_stopped_speaking()
    tracker.handle_accepted_final_transcript(transcript_text)
    tracker.handle_llm_request_started()
    tracker.handle_llm_first_token()
    tracker.handle_tts_request_started()
    tracker.handle_first_tts_audio()
    tracker.handle_bot_started_speaking()
    return tracker.handle_bot_stopped_speaking()


class FakeTerminationController:
    def __init__(self, ending: bool = False) -> None:
        self._ending = ending
        self.requests: list[str] = []

    @property
    def is_ending(self) -> bool:
        return self._ending

    async def request_end_session(self, *, source: str, log_message: str) -> bool:
        self.requests.append(source)
        self._ending = True
        return False


class FakeSmallWebRTCConnection:
    def __init__(self, *, connected: bool) -> None:
        self.connected = connected
        self.disconnect_calls = 0
        self.handlers: dict[str, list[object]] = {}
        self.messages: list[dict[str, object]] = []

    def is_connected(self) -> bool:
        return self.connected

    def add_event_handler(self, event_name: str, handler: object) -> None:
        self.handlers.setdefault(event_name, []).append(handler)

    def remove_event_handler(self, event_name: str, handler: object) -> None:
        handlers = self.handlers.get(event_name, [])
        if handler in handlers:
            handlers.remove(handler)

    def emit(self, event_name: str) -> None:
        for handler in list(self.handlers.get(event_name, [])):
            handler(self)

    def send_app_message(self, message: dict[str, object]) -> None:
        self.messages.append(message)

    async def disconnect(self) -> None:
        self.disconnect_calls += 1


if __name__ == "__main__":
    unittest.main()
