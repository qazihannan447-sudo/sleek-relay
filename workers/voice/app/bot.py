from __future__ import annotations

import asyncio
import logging
import sys

from app.config import ConfigurationError, load_config, load_worker_env
from app.prompt import SYSTEM_PROMPT


LOGGER = logging.getLogger("sleek_relay.voice.bot")
sys.modules.setdefault("bot", sys.modules[__name__])


def configure_logging() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )


def _import_pipecat_dependencies() -> dict[str, object]:
    try:
        from pipecat.pipeline.pipeline import Pipeline
        from pipecat.pipeline.runner import PipelineRunner
        from pipecat.pipeline.task import PipelineParams, PipelineTask
        from pipecat.observers.base_observer import BaseObserver, FramePushed
        from pipecat.processors.aggregators.llm_context import LLMContext
        from pipecat.processors.aggregators.llm_response_universal import (
            LLMContextAggregatorPair,
            LLMUserAggregatorParams,
        )
        from pipecat.processors.frame_processor import FrameDirection
        from pipecat.frames.frames import (
            InputAudioRawFrame,
            InterimTranscriptionFrame,
            TranscriptionFrame,
            UserStartedSpeakingFrame,
            UserStoppedSpeakingFrame,
        )
        from pipecat.runner.run import main as runner_main
        from pipecat.runner.types import RunnerArguments, SmallWebRTCRunnerArguments
        from pipecat.services.cartesia.tts import CartesiaTTSService
        from pipecat.services.deepgram.flux.stt import DeepgramFluxSTTService
        from pipecat.services.google.llm import GoogleLLMService
        from pipecat.transports.base_transport import BaseTransport, TransportParams
        from pipecat.transports.smallwebrtc.transport import SmallWebRTCTransport
        from pipecat.turns.user_turn_strategies import ExternalUserTurnStrategies
    except ImportError as exc:
        raise ConfigurationError(
            "Pipecat worker dependencies are not installed. "
            "Install workers/voice dependencies before running the bot."
        ) from exc

    return {
        "Pipeline": Pipeline,
        "PipelineRunner": PipelineRunner,
        "PipelineParams": PipelineParams,
        "PipelineTask": PipelineTask,
        "BaseObserver": BaseObserver,
        "FramePushed": FramePushed,
        "FrameDirection": FrameDirection,
        "InputAudioRawFrame": InputAudioRawFrame,
        "InterimTranscriptionFrame": InterimTranscriptionFrame,
        "TranscriptionFrame": TranscriptionFrame,
        "UserStartedSpeakingFrame": UserStartedSpeakingFrame,
        "UserStoppedSpeakingFrame": UserStoppedSpeakingFrame,
        "LLMContext": LLMContext,
        "LLMContextAggregatorPair": LLMContextAggregatorPair,
        "LLMUserAggregatorParams": LLMUserAggregatorParams,
        "runner_main": runner_main,
        "RunnerArguments": RunnerArguments,
        "SmallWebRTCRunnerArguments": SmallWebRTCRunnerArguments,
        "CartesiaTTSService": CartesiaTTSService,
        "DeepgramFluxSTTService": DeepgramFluxSTTService,
        "GoogleLLMService": GoogleLLMService,
        "BaseTransport": BaseTransport,
        "TransportParams": TransportParams,
        "SmallWebRTCTransport": SmallWebRTCTransport,
        "ExternalUserTurnStrategies": ExternalUserTurnStrategies,
    }


def _register_runner_bot_alias() -> None:
    sys.modules["bot"] = sys.modules[__name__]


def _build_diagnostics_observer(modules: dict[str, object]) -> object:
    base_observer_cls = modules["BaseObserver"]
    frame_pushed_cls = modules["FramePushed"]
    input_audio_raw_frame_cls = modules["InputAudioRawFrame"]
    interim_transcription_frame_cls = modules["InterimTranscriptionFrame"]
    transcription_frame_cls = modules["TranscriptionFrame"]
    user_started_speaking_frame_cls = modules["UserStartedSpeakingFrame"]
    user_stopped_speaking_frame_cls = modules["UserStoppedSpeakingFrame"]
    frame_direction_cls = modules["FrameDirection"]

    class VoiceDiagnosticsObserver(base_observer_cls):
        def __init__(self) -> None:
            super().__init__()
            self._logged_first_audio = False
            self._logged_first_interim = False
            self._logged_first_final = False
            self._seen_frame_ids: set[int] = set()

        async def on_push_frame(self, data: object) -> None:
            if not isinstance(data, frame_pushed_cls):
                return

            frame = data.frame
            if frame.id in self._seen_frame_ids:
                return
            self._seen_frame_ids.add(frame.id)

            if (
                isinstance(frame, input_audio_raw_frame_cls)
                and data.direction is frame_direction_cls.DOWNSTREAM
                and not self._logged_first_audio
            ):
                self._logged_first_audio = True
                LOGGER.info(
                    "voice diagnostics: first browser audio frame received source=%s sample_rate=%s channels=%s bytes=%s",
                    getattr(frame, "transport_source", None),
                    frame.sample_rate,
                    frame.num_channels,
                    len(frame.audio),
                )
            elif isinstance(frame, user_started_speaking_frame_cls):
                LOGGER.info("voice diagnostics: user-started-speaking")
            elif isinstance(frame, user_stopped_speaking_frame_cls):
                LOGGER.info("voice diagnostics: user-stopped-speaking")
            elif isinstance(frame, interim_transcription_frame_cls) and not self._logged_first_interim:
                self._logged_first_interim = True
                LOGGER.info(
                    "voice diagnostics: first Deepgram interim transcription text=%r",
                    frame.text,
                )
            elif isinstance(frame, transcription_frame_cls) and not self._logged_first_final:
                self._logged_first_final = True
                LOGGER.info(
                    "voice diagnostics: first Deepgram final transcription text=%r",
                    frame.text,
                )

    return VoiceDiagnosticsObserver()


def build_pipeline_task(transport: object, modules: dict[str, object], config: object) -> object:
    llm_context_cls = modules["LLMContext"]
    llm_context_aggregator_pair_cls = modules["LLMContextAggregatorPair"]
    llm_user_aggregator_params_cls = modules["LLMUserAggregatorParams"]
    pipeline_cls = modules["Pipeline"]
    pipeline_params_cls = modules["PipelineParams"]
    pipeline_task_cls = modules["PipelineTask"]
    deepgram_flux_stt_service_cls = modules["DeepgramFluxSTTService"]
    google_llm_service_cls = modules["GoogleLLMService"]
    cartesia_tts_service_cls = modules["CartesiaTTSService"]
    external_user_turn_strategies_cls = modules["ExternalUserTurnStrategies"]

    LOGGER.info("voice worker: constructing provider services")

    stt = deepgram_flux_stt_service_cls(
        api_key=config.deepgram_api_key,
        settings=deepgram_flux_stt_service_cls.Settings(
            model=config.deepgram_model,
            smart_format=True,
            should_interrupt=True,
        ),
    )
    llm = google_llm_service_cls(
        api_key=config.google_api_key,
        settings=google_llm_service_cls.Settings(
            model=config.google_model,
            system_instruction=SYSTEM_PROMPT,
            temperature=0.3,
        ),
    )
    tts = cartesia_tts_service_cls(
        api_key=config.cartesia_api_key,
        settings=cartesia_tts_service_cls.Settings(
            model=config.cartesia_model,
            voice=config.cartesia_voice_id,
            language="en",
        ),
    )

    context = llm_context_cls()
    user_aggregator, assistant_aggregator = llm_context_aggregator_pair_cls(
        context,
        user_params=llm_user_aggregator_params_cls(
            user_turn_strategies=external_user_turn_strategies_cls(),
            user_turn_stop_timeout=6.0,
        ),
    )

    LOGGER.info("voice worker: building pipeline")
    pipeline = pipeline_cls(
        [
            transport.input(),
            stt,
            user_aggregator,
            llm,
            tts,
            transport.output(),
            assistant_aggregator,
        ]
    )
    task = pipeline_task_cls(
        pipeline,
        observers=[_build_diagnostics_observer(modules)],
        params=pipeline_params_cls(
            enable_metrics=True,
            enable_usage_metrics=True,
        ),
    )
    return task


async def run_bot(transport: object) -> None:
    config = load_config()
    modules = _import_pipecat_dependencies()
    pipeline_runner_cls = modules["PipelineRunner"]

    task = build_pipeline_task(transport, modules, config)

    @transport.event_handler("on_client_connected")
    async def on_client_connected(transport_instance: object, client: object) -> None:
        LOGGER.info("WebRTC client connected: %s", client)

    @transport.event_handler("on_client_disconnected")
    async def on_client_disconnected(transport_instance: object, client: object) -> None:
        LOGGER.info("WebRTC client disconnected: %s", client)
        cancel = getattr(task, "cancel", None)
        if callable(cancel):
            result = cancel()
            if asyncio.iscoroutine(result):
                await result

    @task.event_handler("on_pipeline_started")
    async def on_pipeline_started(worker: object, frame: object) -> None:
        LOGGER.info("voice worker: pipeline task started")

    @task.event_handler("on_pipeline_finished")
    async def on_pipeline_finished(worker: object, frame: object) -> None:
        LOGGER.info("voice worker: pipeline task finished with %s", type(frame).__name__)

    runner = pipeline_runner_cls()
    LOGGER.info("voice worker: starting PipelineRunner task")
    await runner.run(task)
    LOGGER.info("voice worker: PipelineRunner task exited")


async def bot(runner_args: object) -> None:
    LOGGER.info("voice worker: bot callback invoked with %s", type(runner_args).__name__)
    modules = _import_pipecat_dependencies()
    small_webrtc_runner_arguments_cls = modules["SmallWebRTCRunnerArguments"]
    small_webrtc_transport_cls = modules["SmallWebRTCTransport"]
    transport_params_cls = modules["TransportParams"]

    if not isinstance(runner_args, small_webrtc_runner_arguments_cls):
        raise ConfigurationError(
            "This proof of concept supports only SmallWebRTC transport for local browser demos."
        )

    transport = small_webrtc_transport_cls(
        params=transport_params_cls(
            audio_in_enabled=True,
            audio_out_enabled=True,
        ),
        webrtc_connection=runner_args.webrtc_connection,
    )
    await run_bot(transport)


def main() -> None:
    load_worker_env()
    configure_logging()
    _register_runner_bot_alias()

    try:
        load_config()
        runner_main = _import_pipecat_dependencies()["runner_main"]
    except ConfigurationError as exc:
        print(f"voice worker configuration error: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc

    runner_main()


if __name__ == "__main__":
    main()
