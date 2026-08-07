from __future__ import annotations

import asyncio
import logging
import random
import re
import time
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from app.config import ConfigurationError, load_config, load_worker_env
from app.deepgram_pool import (
    DeepgramWarmPool,
    WarmDeepgramConnection,
    get_global_deepgram_warm_pool,
    get_or_start_global_deepgram_warm_pool,
    stop_global_deepgram_warm_pool,
)
from app.prompt import SYSTEM_PROMPT
from app.runtime_config import (
    DEFAULT_PROVIDER_ERROR_MESSAGE,
    RuntimeConfigLoadError,
    VoiceSessionRuntimeConfig,
    build_runtime_config,
    load_session_runtime_config,
)
from app.transcript import try_persist_session_results


LOGGER = logging.getLogger("sleek_relay.voice.bot")
_PIPECAT_DEPENDENCIES_CACHE: dict[str, object] | None = None
FINAL_GOODBYE_TEXT = "Goodbye."
FINAL_GOODBYE_TIMEOUT_SECS = 15.0
LOCAL_FALLBACK_GREETING = "Hello, how can I help you today?"
RUNTIME_CONFIG_CONNECTION_WAIT_TIMEOUT_SECS = 5.0
RTVI_MESSAGE_LABEL = "rtvi-ai"
DEEPGRAM_STARTUP_MAX_ATTEMPTS = 3
DEEPGRAM_STARTUP_BACKOFF_SECS = (1.0, 2.0)
DEEPGRAM_STARTUP_JITTER_SECS = 0.25
# Match browser SmallWebRTC / warm-pool Flux sockets so preconnect URLs align.
DEEPGRAM_BROWSER_SAMPLE_RATE = 16000
SESSION_ENDING_SERVER_MESSAGE = {
    "reason": "user-requested",
    "type": "session-ending",
}
DEEPGRAM_PROVIDER_ERROR_SERVER_MESSAGE_TYPE = "provider-error"
SILERO_VAD_CONFIDENCE = 0.75
SILERO_VAD_START_SECS = 0.15
SILERO_VAD_STOP_SECS = 0.25
SILERO_VAD_MIN_VOLUME = 0.65
_DEEPGRAM_HANDSHAKE_ERROR_PATTERNS = (
    re.compile(r"timed out during opening handshake"),
    re.compile(r"opening handshake", re.IGNORECASE),
)
_LEADING_END_SESSION_FILLER_PATTERN = re.compile(
    r"^(?:(?:hello|hi|hey|okay|ok|well|so)\s+)+"
)
_REJECTED_END_SESSION_PATTERNS = (
    re.compile(r"\bwhat does (?:good ?bye|bye|hang up)\b"),
    re.compile(r"\bexplain (?:the phrase )?(?:hang up|good ?bye|bye)\b"),
    re.compile(r"\bwe offer (?:a |our )?good ?bye package\b"),
    re.compile(r"\bdo not (?:end (?:the |this )?(?:call|conversation|session)|hang up|disconnect)\b"),
    re.compile(r"\b(?:don't|dont) (?:end (?:the |this )?(?:call|conversation|session)|hang up|disconnect)\b"),
    re.compile(r"\b(?:i am|i'm|im) not done\b"),
)
_ACCEPTED_END_SESSION_PATTERNS = (
    re.compile(r"^(?:bye|good ?bye)$"),
    re.compile(r"^(?:please )?(?:end|stop) (?:the |this )?(?:call|conversation|session)(?: now)?$"),
    re.compile(r"^(?:please )?hang up(?: now)?$"),
    re.compile(r"^(?:please )?disconnect(?: now)?$"),
    re.compile(r"^(?:i think )?(?:i am|i'm|im|we are|we're) done(?: here| now)?$"),
    re.compile(r"^(?:no )?(?:that is all|that's all)(?: goodbye| bye)?$"),
)

def configure_logging() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )


def _import_pipecat_dependencies() -> dict[str, object]:
    global _PIPECAT_DEPENDENCIES_CACHE
    if _PIPECAT_DEPENDENCIES_CACHE is not None:
        return _PIPECAT_DEPENDENCIES_CACHE

    try:
        from pipecat.adapters.schemas.function_schema import FunctionSchema
        from pipecat.pipeline.pipeline import Pipeline
        from pipecat.pipeline.runner import PipelineRunner
        from pipecat.pipeline.task import PipelineParams, PipelineTask
        from pipecat.observers.base_observer import BaseObserver, FramePushed
        from pipecat.processors.aggregators.llm_context import LLMContext
        from pipecat.processors.aggregators.llm_response_universal import (
            LLMContextAggregatorPair,
            LLMUserAggregatorParams,
        )
        from pipecat.processors.frame_processor import FrameDirection, FrameProcessor
        from pipecat.frames.frames import (
            BotStartedSpeakingFrame,
            BotStoppedSpeakingFrame,
            EndFrame,
            ErrorFrame,
            FunctionCallResultProperties,
            InputAudioRawFrame,
            InterimTranscriptionFrame,
            LLMContextFrame,
            LLMFullResponseEndFrame,
            LLMTextFrame,
            TTSSpeakFrame,
            TTSAudioRawFrame,
            TTSStartedFrame,
            TranscriptionFrame,
            VADUserStoppedSpeakingFrame,
            UserStartedSpeakingFrame,
            UserStoppedSpeakingFrame,
        )
        from pipecat.runner.types import (
            DailyRunnerArguments,
            RunnerArguments,
            SmallWebRTCRunnerArguments,
        )
        from pipecat.audio.vad.silero import SileroVADAnalyzer
        from pipecat.audio.vad.vad_analyzer import VADParams
        from pipecat.services.cartesia.tts import CartesiaTTSService
        from pipecat.services.deepgram.flux.stt import DeepgramFluxSTTService
        from pipecat.services.google.llm import GoogleLLMService
        from pipecat.services.tts_service import TextAggregationMode
        from pipecat.transports.base_transport import BaseTransport, TransportParams
        from pipecat.transports.daily.transport import DailyParams, DailyTransport
        from pipecat.transports.smallwebrtc.transport import SmallWebRTCTransport
        from pipecat.turns.user_stop.external_user_turn_stop_strategy import (
            ExternalUserTurnStopStrategy,
        )
        from pipecat.turns.user_start.vad_user_turn_start_strategy import (
            VADUserTurnStartStrategy,
        )
        from pipecat.turns.user_turn_strategies import UserTurnStrategies
    except ImportError as exc:
        raise ConfigurationError(
            "Pipecat worker dependencies are not installed. "
            "Install workers/voice dependencies before running the bot."
        ) from exc

    _PIPECAT_DEPENDENCIES_CACHE = {
        "Pipeline": Pipeline,
        "PipelineRunner": PipelineRunner,
        "PipelineParams": PipelineParams,
        "PipelineTask": PipelineTask,
        "FunctionSchema": FunctionSchema,
        "BaseObserver": BaseObserver,
        "FramePushed": FramePushed,
        "FrameDirection": FrameDirection,
        "FrameProcessor": FrameProcessor,
        "BotStartedSpeakingFrame": BotStartedSpeakingFrame,
        "BotStoppedSpeakingFrame": BotStoppedSpeakingFrame,
        "EndFrame": EndFrame,
        "ErrorFrame": ErrorFrame,
        "FunctionCallResultProperties": FunctionCallResultProperties,
        "InputAudioRawFrame": InputAudioRawFrame,
        "InterimTranscriptionFrame": InterimTranscriptionFrame,
        "LLMContextFrame": LLMContextFrame,
        "LLMFullResponseEndFrame": LLMFullResponseEndFrame,
        "LLMTextFrame": LLMTextFrame,
        "TTSSpeakFrame": TTSSpeakFrame,
        "TTSAudioRawFrame": TTSAudioRawFrame,
        "TTSStartedFrame": TTSStartedFrame,
        "TranscriptionFrame": TranscriptionFrame,
        "VADUserStoppedSpeakingFrame": VADUserStoppedSpeakingFrame,
        "UserStartedSpeakingFrame": UserStartedSpeakingFrame,
        "UserStoppedSpeakingFrame": UserStoppedSpeakingFrame,
        "LLMContext": LLMContext,
        "LLMContextAggregatorPair": LLMContextAggregatorPair,
        "LLMUserAggregatorParams": LLMUserAggregatorParams,
        "DailyRunnerArguments": DailyRunnerArguments,
        "RunnerArguments": RunnerArguments,
        "SmallWebRTCRunnerArguments": SmallWebRTCRunnerArguments,
        "SileroVADAnalyzer": SileroVADAnalyzer,
        "VADParams": VADParams,
        "CartesiaTTSService": CartesiaTTSService,
        "DeepgramFluxSTTService": DeepgramFluxSTTService,
        "GoogleLLMService": GoogleLLMService,
        "TextAggregationMode": TextAggregationMode,
        "BaseTransport": BaseTransport,
        "DailyParams": DailyParams,
        "DailyTransport": DailyTransport,
        "TransportParams": TransportParams,
        "SmallWebRTCTransport": SmallWebRTCTransport,
        "ExternalUserTurnStopStrategy": ExternalUserTurnStopStrategy,
        "VADUserTurnStartStrategy": VADUserTurnStartStrategy,
        "UserTurnStrategies": UserTurnStrategies,
    }
    return _PIPECAT_DEPENDENCIES_CACHE


def preload_pipecat_dependencies() -> dict[str, object]:
    started_at = time.monotonic()
    try:
        modules = _import_pipecat_dependencies()
    except Exception:  # noqa: BLE001
        LOGGER.exception(
            "voice worker: Pipecat dependency preload failed duration_ms=%s",
            int(round((time.monotonic() - started_at) * 1000)),
        )
        return {}

    LOGGER.info(
        "voice worker: Pipecat dependency preload completed duration_ms=%s",
        int(round((time.monotonic() - started_at) * 1000)),
    )
    return modules


def normalize_end_session_text(value: str) -> str:
    normalized = re.sub(r"[^a-z0-9\s']", " ", value.lower())
    return re.sub(r"\s+", " ", normalized).strip()


def strip_leading_end_session_fillers(value: str) -> str:
    stripped = value
    while True:
        next_value = _LEADING_END_SESSION_FILLER_PATTERN.sub("", stripped).strip()
        if next_value == stripped:
            return stripped
        stripped = next_value


def is_rejected_end_session_request(value: str) -> bool:
    normalized = normalize_end_session_text(value)
    if not normalized:
        return False

    return any(pattern.search(normalized) for pattern in _REJECTED_END_SESSION_PATTERNS)


def is_deterministic_end_session_request(value: str) -> bool:
    normalized = normalize_end_session_text(value)
    if not normalized or is_rejected_end_session_request(normalized):
        return False

    candidate = strip_leading_end_session_fillers(normalized)
    return any(
        pattern.fullmatch(candidate) or pattern.fullmatch(normalized)
        for pattern in _ACCEPTED_END_SESSION_PATTERNS
    )


def is_deepgram_handshake_error_message(error_message: str) -> bool:
    normalized = error_message.strip()
    if not normalized:
        return False

    return any(pattern.search(normalized) for pattern in _DEEPGRAM_HANDSHAKE_ERROR_PATTERNS)


@dataclass
class VoiceTurnLatencyRecord:
    turn_id: str
    status: str = "in-progress"
    user_speech_started_at: float | None = None
    user_speech_stopped_at: float | None = None
    first_interim_transcript_at: float | None = None
    accepted_final_transcript_at: float | None = None
    llm_request_started_at: float | None = None
    llm_first_token_at: float | None = None
    llm_response_completed_at: float | None = None
    tts_request_started_at: float | None = None
    first_tts_audio_at: float | None = None
    bot_speaking_started_at: float | None = None
    bot_speaking_stopped_at: float | None = None
    barge_in_started_at: float | None = None
    completed_at: float | None = None
    final_transcript_text: str | None = None
    interrupted: bool = False
    end_session: bool = False
    provider_error: bool = False
    started_during_interruption: bool = False

    @property
    def is_terminal(self) -> bool:
        return self.completed_at is not None


class VoiceTurnLatencyTracker:
    def __init__(self, *, monotonic_clock: Any | None = None) -> None:
        self._monotonic_clock = monotonic_clock or time.monotonic
        self._session_index = 1
        self._turn_index = 0
        self._current_turn: VoiceTurnLatencyRecord | None = None
        self._completed_turns: list[VoiceTurnLatencyRecord] = []
        self._pending_interrupted_turn: VoiceTurnLatencyRecord | None = None

    @property
    def current_turn(self) -> VoiceTurnLatencyRecord | None:
        return self._current_turn

    @property
    def completed_turns(self) -> list[VoiceTurnLatencyRecord]:
        return list(self._completed_turns)

    def reset_session(self) -> None:
        self._session_index += 1
        self._turn_index = 0
        self._current_turn = None
        self._completed_turns = []
        self._pending_interrupted_turn = None

    def handle_user_started_speaking(self) -> VoiceTurnLatencyRecord:
        now = self._now()
        current_turn = self._current_turn
        if current_turn is not None and not current_turn.is_terminal:
            if self._should_interrupt_current_turn(current_turn):
                if (
                    current_turn.bot_speaking_started_at is not None
                    and current_turn.bot_speaking_stopped_at is None
                ):
                    current_turn.status = "interrupted"
                    current_turn.interrupted = True
                    current_turn.barge_in_started_at = now
                    self._pending_interrupted_turn = current_turn
                    self._current_turn = None
                else:
                    self._finalize_specific_turn(
                        current_turn,
                        "interrupted",
                        completed_at=now,
                    )
                current_turn = None
            elif current_turn.user_speech_started_at is not None:
                return current_turn

        if current_turn is None or current_turn.is_terminal:
            current_turn = self._start_new_turn()
            if self._pending_interrupted_turn is not None:
                current_turn.started_during_interruption = True

        if current_turn.user_speech_started_at is None:
            current_turn.user_speech_started_at = now
        self._current_turn = current_turn
        return current_turn

    def handle_user_stopped_speaking(self) -> VoiceTurnLatencyRecord | None:
        current_turn = self._current_turn
        if current_turn is None or current_turn.is_terminal:
            return None

        if current_turn.user_speech_stopped_at is None:
            current_turn.user_speech_stopped_at = self._now()
        return current_turn

    def handle_first_interim_transcript(self) -> VoiceTurnLatencyRecord | None:
        current_turn = self._current_turn
        if current_turn is None or current_turn.is_terminal:
            return None

        if current_turn.first_interim_transcript_at is None:
            current_turn.first_interim_transcript_at = self._now()
        return current_turn

    def handle_accepted_final_transcript(self, transcript_text: str) -> VoiceTurnLatencyRecord | None:
        current_turn = self._current_turn
        if current_turn is None or current_turn.is_terminal:
            return None

        if current_turn.accepted_final_transcript_at is None:
            current_turn.accepted_final_transcript_at = self._now()
            current_turn.final_transcript_text = transcript_text
        return current_turn

    def handle_llm_request_started(self) -> VoiceTurnLatencyRecord | None:
        return self._mark_timestamp_once("llm_request_started_at")

    def handle_llm_first_token(self) -> VoiceTurnLatencyRecord | None:
        return self._mark_timestamp_once("llm_first_token_at")

    def handle_llm_response_completed(self) -> VoiceTurnLatencyRecord | None:
        return self._mark_timestamp_once("llm_response_completed_at")

    def handle_tts_request_started(self) -> VoiceTurnLatencyRecord | None:
        return self._mark_timestamp_once("tts_request_started_at")

    def handle_first_tts_audio(self) -> VoiceTurnLatencyRecord | None:
        return self._mark_timestamp_once("first_tts_audio_at")

    def handle_bot_started_speaking(self) -> VoiceTurnLatencyRecord | None:
        return self._mark_timestamp_once("bot_speaking_started_at")

    def handle_bot_stopped_speaking(self) -> VoiceTurnLatencyRecord | None:
        pending_interrupted_turn = self._pending_interrupted_turn
        if pending_interrupted_turn is not None and not pending_interrupted_turn.is_terminal:
            now = self._now()
            if pending_interrupted_turn.bot_speaking_stopped_at is None:
                pending_interrupted_turn.bot_speaking_stopped_at = now
            return self._finalize_specific_turn(
                pending_interrupted_turn,
                "interrupted",
                completed_at=now,
            )

        current_turn = self._current_turn
        if current_turn is None or current_turn.is_terminal:
            return None

        if current_turn.bot_speaking_started_at is None:
            return None

        now = self._now()
        if current_turn.bot_speaking_stopped_at is None:
            current_turn.bot_speaking_stopped_at = now

        status = "end-session" if current_turn.end_session else "completed"
        return self._finalize_specific_turn(current_turn, status, completed_at=now)

    def mark_end_session_turn(self) -> VoiceTurnLatencyRecord | None:
        current_turn = self._current_turn
        if current_turn is None or current_turn.is_terminal:
            return None

        current_turn.end_session = True
        return current_turn

    def mark_provider_error_turn(self) -> VoiceTurnLatencyRecord | None:
        current_turn = self._current_turn
        if current_turn is None or current_turn.is_terminal:
            return None

        current_turn.provider_error = True
        return self._finalize_specific_turn(
            current_turn,
            "provider-error",
            completed_at=self._now(),
        )

    def summarize_turn(self, turn: VoiceTurnLatencyRecord) -> dict[str, int | str | None]:
        return {
            "turn_id": turn.turn_id,
            "status": turn.status,
            "speech_stop_to_stt_final_ms": self._duration_ms(
                turn.user_speech_stopped_at,
                turn.accepted_final_transcript_at,
            ),
            "stt_final_to_llm_first_token_ms": self._duration_ms(
                turn.accepted_final_transcript_at,
                turn.llm_first_token_at,
            ),
            "llm_first_token_to_first_tts_audio_ms": self._duration_ms(
                turn.llm_first_token_at,
                turn.first_tts_audio_at,
            ),
            "final_transcript_to_bot_speaking_ms": self._duration_ms(
                turn.accepted_final_transcript_at,
                turn.bot_speaking_started_at,
            ),
            "speech_stop_to_bot_speaking_ms": self._duration_ms(
                turn.user_speech_stopped_at,
                turn.bot_speaking_started_at,
            ),
            "barge_in_to_bot_silence_ms": self._duration_ms(
                turn.barge_in_started_at,
                turn.bot_speaking_stopped_at,
            ),
            "bot_speaking_duration_ms": self._duration_ms(
                turn.bot_speaking_started_at,
                turn.bot_speaking_stopped_at,
            ),
            "total_turn_duration_ms": self._duration_ms(
                self._resolve_total_turn_start(turn),
                turn.completed_at,
            ),
        }

    def log_turn_summary(self, turn: VoiceTurnLatencyRecord) -> None:
        summary = self.summarize_turn(turn)
        LOGGER.info(
            "voice latency:\n"
            "turn_id=%s\n"
            "status=%s\n"
            "speech_stop_to_stt_final_ms=%s\n"
            "stt_final_to_llm_first_token_ms=%s\n"
            "llm_first_token_to_tts_first_audio_ms=%s\n"
            "final_transcript_to_bot_speaking_ms=%s\n"
            "speech_stop_to_bot_speaking_ms=%s\n"
            "barge_in_to_bot_silence_ms=%s\n"
            "bot_speaking_duration_ms=%s\n"
            "total_turn_duration_ms=%s",
            summary["turn_id"],
            summary["status"],
            summary["speech_stop_to_stt_final_ms"],
            summary["stt_final_to_llm_first_token_ms"],
            summary["llm_first_token_to_first_tts_audio_ms"],
            summary["final_transcript_to_bot_speaking_ms"],
            summary["speech_stop_to_bot_speaking_ms"],
            summary["barge_in_to_bot_silence_ms"],
            summary["bot_speaking_duration_ms"],
            summary["total_turn_duration_ms"],
        )

    def _mark_timestamp_once(self, attribute_name: str) -> VoiceTurnLatencyRecord | None:
        current_turn = self._current_turn
        if current_turn is None or current_turn.is_terminal:
            return None

        if getattr(current_turn, attribute_name) is None:
            setattr(current_turn, attribute_name, self._now())
        return current_turn

    def _start_new_turn(self) -> VoiceTurnLatencyRecord:
        self._turn_index += 1
        return VoiceTurnLatencyRecord(
            turn_id=f"s{self._session_index}-t{self._turn_index}",
        )

    def _should_interrupt_current_turn(self, turn: VoiceTurnLatencyRecord) -> bool:
        return any(
            value is not None
            for value in (
                turn.accepted_final_transcript_at,
                turn.llm_request_started_at,
                turn.tts_request_started_at,
                turn.bot_speaking_started_at,
            )
        )

    def _finalize_specific_turn(
        self,
        turn: VoiceTurnLatencyRecord,
        status: str,
        *,
        completed_at: float,
    ) -> VoiceTurnLatencyRecord | None:
        if turn.is_terminal:
            return turn

        resolved_status = self._resolve_terminal_status(turn, requested_status=status)
        if resolved_status is None:
            if self._current_turn is turn:
                self._current_turn = None
            if self._pending_interrupted_turn is turn:
                self._pending_interrupted_turn = None
            return None

        turn.status = resolved_status
        turn.interrupted = status == "interrupted" or turn.interrupted
        turn.provider_error = status == "provider-error" or turn.provider_error
        turn.completed_at = completed_at
        if turn.bot_speaking_started_at is not None and turn.bot_speaking_stopped_at is None:
            turn.bot_speaking_stopped_at = completed_at

        self._completed_turns.append(turn)
        self.log_turn_summary(turn)
        if self._current_turn is turn:
            self._current_turn = None
        if self._pending_interrupted_turn is turn:
            self._pending_interrupted_turn = None
        return turn

    def _resolve_terminal_status(
        self,
        turn: VoiceTurnLatencyRecord,
        *,
        requested_status: str,
    ) -> str | None:
        if requested_status == "provider-error":
            return "provider-error"
        if requested_status == "interrupted":
            return "interrupted"
        if not self._has_reportable_lifecycle(turn):
            return None
        if turn.user_speech_started_at is None or turn.accepted_final_transcript_at is None:
            return "incomplete-metrics"
        return requested_status

    def _has_reportable_lifecycle(self, turn: VoiceTurnLatencyRecord) -> bool:
        return any(
            (
                turn.accepted_final_transcript_at is not None,
                turn.llm_request_started_at is not None,
                turn.llm_first_token_at is not None,
                turn.llm_response_completed_at is not None,
                turn.tts_request_started_at is not None,
                turn.first_tts_audio_at is not None,
                turn.bot_speaking_started_at is not None,
                turn.bot_speaking_stopped_at is not None,
                turn.end_session,
                turn.provider_error,
            )
        )

    def _duration_ms(self, start: float | None, end: float | None) -> int | None:
        if start is None or end is None:
            return None
        return max(0, int(round((end - start) * 1000)))

    def _resolve_total_turn_start(self, turn: VoiceTurnLatencyRecord) -> float | None:
        if turn.started_during_interruption and turn.accepted_final_transcript_at is not None:
            return turn.accepted_final_transcript_at
        return turn.user_speech_started_at

    def _now(self) -> float:
        return float(self._monotonic_clock())

class SessionTerminationController:
    def __init__(
        self,
        modules: dict[str, object],
        *,
        latency_tracker: VoiceTurnLatencyTracker | None = None,
    ) -> None:
        self._task: object | None = None
        self._tts_speak_frame_cls = modules["TTSSpeakFrame"]
        self._end_frame_cls = modules["EndFrame"]
        self._function_call_result_properties_cls = modules["FunctionCallResultProperties"]
        self._latency_tracker = latency_tracker
        self._shutdown_lock = asyncio.Lock()
        self._shutdown_task: asyncio.Task[None] | None = None
        self._final_goodbye_completed = asyncio.Event()
        self._end_session_requested = False
        self._cleanup_started = False

    @property
    def shutdown_task(self) -> asyncio.Task[None] | None:
        return self._shutdown_task

    def attach_task(self, task: object) -> None:
        self._task = task

    @property
    def is_ending(self) -> bool:
        return self._end_session_requested

    async def handle_end_session_tool_call(self, params: object) -> None:
        arguments = getattr(params, "arguments", {})
        result_callback = getattr(params, "result_callback")
        user_request_text = str(arguments.get("user_request_text", ""))

        if is_rejected_end_session_request(user_request_text):
            await result_callback(
                {
                    "ended": False,
                    "reason": "rejected_end_session_request",
                },
                properties=self._function_call_result_properties_cls(run_llm=True),
            )
            return

        already_ending = await self.request_end_session(
            source="llm-tool",
            log_message="voice worker: fallback end-session tool accepted",
        )
        await result_callback(
            {
                "ended": True,
                "alreadyEnding": already_ending,
            },
            properties=self._function_call_result_properties_cls(run_llm=False),
        )

    async def request_end_session(self, *, source: str, log_message: str) -> bool:
        schedule_shutdown = False
        already_ending = False

        async with self._shutdown_lock:
            if self._end_session_requested:
                already_ending = True
            else:
                self._end_session_requested = True
                self._final_goodbye_completed.clear()
                schedule_shutdown = True

        if schedule_shutdown and self._latency_tracker is not None:
            self._latency_tracker.mark_end_session_turn()

        LOGGER.info("%s source=%s", log_message, source)
        if schedule_shutdown:
            self._shutdown_task = asyncio.create_task(self._perform_shutdown())

        return already_ending

    def handle_bot_stopped_speaking(self) -> None:
        if self._end_session_requested and not self._final_goodbye_completed.is_set():
            self._final_goodbye_completed.set()

    async def wait_for_shutdown(self) -> None:
        if self._shutdown_task is not None:
            await self._shutdown_task

    async def _emit_session_ending_message(self) -> None:
        if self._task is None:
            return

        try:
            rtvi = getattr(self._task, "rtvi")
        except Exception:
            rtvi = None

        if rtvi is None:
            return

        await rtvi.send_server_message(SESSION_ENDING_SERVER_MESSAGE)

    async def _perform_shutdown(self) -> None:
        if self._task is None:
            raise RuntimeError("Session termination controller requires an attached pipeline task.")

        await self._emit_session_ending_message()
        LOGGER.info("voice worker: final goodbye queued")
        await self._task.queue_frame(
            self._tts_speak_frame_cls(
                text=FINAL_GOODBYE_TEXT,
                append_to_context=False,
            )
        )

        try:
            await asyncio.wait_for(
                self._final_goodbye_completed.wait(),
                timeout=FINAL_GOODBYE_TIMEOUT_SECS,
            )
        except asyncio.TimeoutError:
            LOGGER.warning(
                "voice worker: final goodbye audio completion timed out after %.1f seconds",
                FINAL_GOODBYE_TIMEOUT_SECS,
            )

        LOGGER.info("voice worker: final goodbye playback completed")

        async with self._shutdown_lock:
            if self._cleanup_started:
                return
            self._cleanup_started = True

        LOGGER.info("voice worker: EndFrame queued")
        await self._task.queue_frame(self._end_frame_cls(reason="user-requested-end-session"))


@dataclass
class VoiceStartupTimingRecord:
    runtime_config_loaded_at: float | None = None
    deepgram_connect_started_at: float | None = None
    deepgram_connect_completed_at: float | None = None
    cartesia_connect_started_at: float | None = None
    cartesia_connect_completed_at: float | None = None
    pipeline_ready_at: float | None = None
    greeting_first_audio_at: float | None = None


class VoiceStartupTimingTracker:
    _NAMED_STAGE_ORDER = (
        ("transport_created", "transport_created_ms"),
        ("stt_created", "stt_created_ms"),
        ("llm_created", "llm_created_ms"),
        ("tts_created", "tts_created_ms"),
        ("context_created", "context_created_ms"),
        ("vad_created", "vad_created_ms"),
        ("aggregators_created", "aggregators_created_ms"),
        ("pipeline_constructed", "pipeline_constructed_ms"),
        ("task_constructed", "task_constructed_ms"),
        ("event_handlers_registered", "event_handlers_registered_ms"),
        ("pipeline_runner_created", "pipeline_runner_created_ms"),
        ("provider_preconnect_task_scheduled", "provider_preconnect_task_scheduled_ms"),
        ("pipeline_run_started", "pipeline_run_started_ms"),
    )
    _DERIVED_DURATION_ORDER = (
        ("runtime_config_loaded_at", "deepgram_connect_started_at", "runtime_config_to_deepgram_connect_gap_ms"),
        ("deepgram_connect_completed_at", "pipeline_ready_at", "deepgram_ready_to_pipeline_ready_gap_ms"),
        ("cartesia_connect_completed_at", "pipeline_ready_at", "cartesia_ready_to_pipeline_ready_gap_ms"),
        ("pipeline_run_started", "pipeline_ready_at", "pipeline_start_wait_ms"),
    )

    def __init__(self, *, monotonic_clock: Any | None = None) -> None:
        self._monotonic_clock = monotonic_clock or time.monotonic
        self._session_started_at = self._monotonic_clock()
        self._record = VoiceStartupTimingRecord()
        self._named_marks: dict[str, float] = {}
        self._startframe_processor_order: list[str] = []
        self._startframe_entered_at: dict[str, float] = {}
        self._startframe_pushed_at: dict[str, float] = {}
        self._startframe_summary_logged = False

    @property
    def record(self) -> VoiceStartupTimingRecord:
        return self._record

    def mark_runtime_config_loaded(self) -> None:
        self._mark_once("runtime_config_loaded_at", "runtime config loaded")

    def mark_deepgram_connect_started(self) -> None:
        self._mark_once("deepgram_connect_started_at", "Deepgram connect start")

    def mark_deepgram_connect_completed(self) -> None:
        self._mark_once("deepgram_connect_completed_at", "Deepgram connect end")

    def mark_cartesia_connect_started(self) -> None:
        self._mark_once("cartesia_connect_started_at", "Cartesia connect start")

    def mark_cartesia_connect_completed(self) -> None:
        self._mark_once("cartesia_connect_completed_at", "Cartesia connect end")

    def mark_pipeline_ready(self) -> None:
        self._mark_once("pipeline_ready_at", "pipeline ready")

    def mark_greeting_first_audio(self) -> None:
        already_marked = self._record.greeting_first_audio_at is not None
        self._mark_once("greeting_first_audio_at", "greeting first audio")
        if not already_marked:
            self.log_summary()

    def mark_transport_created(self) -> None:
        self._mark_named_stage("transport_created", "transport created")

    def mark_stt_created(self) -> None:
        self._mark_named_stage("stt_created", "STT object created")

    def mark_llm_created(self) -> None:
        self._mark_named_stage("llm_created", "LLM object created")

    def mark_tts_created(self) -> None:
        self._mark_named_stage("tts_created", "TTS object created")

    def mark_context_created(self) -> None:
        self._mark_named_stage("context_created", "LLM context created")

    def mark_vad_created(self) -> None:
        self._mark_named_stage("vad_created", "VAD created")

    def mark_aggregators_created(self) -> None:
        self._mark_named_stage("aggregators_created", "context aggregators created")

    def mark_pipeline_constructed(self) -> None:
        self._mark_named_stage("pipeline_constructed", "pipeline constructed")

    def mark_task_constructed(self) -> None:
        self._mark_named_stage("task_constructed", "pipeline task constructed")

    def mark_event_handlers_registered(self) -> None:
        self._mark_named_stage("event_handlers_registered", "event handlers registered")

    def mark_pipeline_runner_created(self) -> None:
        self._mark_named_stage("pipeline_runner_created", "pipeline runner created")

    def mark_provider_preconnect_task_scheduled(self) -> None:
        self._mark_named_stage(
            "provider_preconnect_task_scheduled",
            "provider preconnect task scheduled",
        )

    def mark_pipeline_run_started(self) -> None:
        self._mark_named_stage("pipeline_run_started", "pipeline run awaited")

    def register_startframe_processor(self, label: str) -> None:
        if label not in self._startframe_processor_order:
            self._startframe_processor_order.append(label)

    def mark_startframe_processor_entered(self, label: str) -> None:
        self.register_startframe_processor(label)
        if label in self._startframe_entered_at:
            return
        self._startframe_entered_at[label] = self._monotonic_clock()

    def mark_startframe_processor_pushed(self, label: str) -> None:
        self.register_startframe_processor(label)
        if label in self._startframe_pushed_at:
            return
        self._startframe_pushed_at[label] = self._monotonic_clock()

    def summarize_startframe(self) -> dict[str, int | str | None]:
        summary: dict[str, int | str | None] = {}
        slowest_label: str | None = None
        slowest_duration: int | None = None

        for label in self._startframe_processor_order:
            handoff_duration = self._duration_ms(
                self._startframe_entered_at.get(label),
                self._startframe_pushed_at.get(label),
            )
            summary[f"startframe_{label}_handoff_ms"] = handoff_duration
            if handoff_duration is not None and (
                slowest_duration is None or handoff_duration > slowest_duration
            ):
                slowest_label = label
                slowest_duration = handoff_duration

        last_push_label = next(
            (
                label
                for label in reversed(self._startframe_processor_order)
                if label in self._startframe_pushed_at
            ),
            None,
        )
        summary["startframe_last_handoff_to_pipeline_ready_ms"] = self._duration_ms(
            self._startframe_pushed_at.get(last_push_label) if last_push_label else None,
            self._record.pipeline_ready_at,
        )
        summary["startframe_slowest_processor"] = slowest_label
        summary["startframe_slowest_processor_handoff_ms"] = slowest_duration
        return summary

    def log_startframe_summary(self) -> None:
        if self._startframe_summary_logged:
            return

        self._startframe_summary_logged = True
        summary = self.summarize_startframe()
        ordered_keys = [
            *[
                f"startframe_{label}_handoff_ms"
                for label in self._startframe_processor_order
            ],
            "startframe_last_handoff_to_pipeline_ready_ms",
            "startframe_slowest_processor",
            "startframe_slowest_processor_handoff_ms",
        ]
        summary_lines = "\n".join(
            f"{key}={summary.get(key)}" for key in ordered_keys
        )
        LOGGER.info("voice startframe timing:\n%s", summary_lines)

    def summarize(self) -> dict[str, int | None]:
        record = self._record
        summary = {
            "runtime_config_loaded_ms": self._elapsed_ms(record.runtime_config_loaded_at),
            "deepgram_connect_start_ms": self._elapsed_ms(record.deepgram_connect_started_at),
            "deepgram_connect_end_ms": self._elapsed_ms(record.deepgram_connect_completed_at),
            "cartesia_connect_start_ms": self._elapsed_ms(record.cartesia_connect_started_at),
            "cartesia_connect_end_ms": self._elapsed_ms(record.cartesia_connect_completed_at),
            "pipeline_ready_ms": self._elapsed_ms(record.pipeline_ready_at),
            "greeting_first_audio_ms": self._elapsed_ms(record.greeting_first_audio_at),
        }
        for stage_name, summary_key in self._NAMED_STAGE_ORDER:
            summary[summary_key] = self._elapsed_ms(self._named_marks.get(stage_name))
        for start_name, end_name, summary_key in self._DERIVED_DURATION_ORDER:
            summary[summary_key] = self._duration_ms(self._get_mark(start_name), self._get_mark(end_name))
        for key, value in self.summarize_startframe().items():
            if isinstance(value, int) or value is None:
                summary[key] = value
        return summary

    def log_summary(self) -> None:
        summary = self.summarize()
        ordered_keys = [
            "runtime_config_loaded_ms",
            "transport_created_ms",
            "stt_created_ms",
            "llm_created_ms",
            "tts_created_ms",
            "deepgram_connect_start_ms",
            "deepgram_connect_end_ms",
            "cartesia_connect_start_ms",
            "cartesia_connect_end_ms",
            "context_created_ms",
            "vad_created_ms",
            "aggregators_created_ms",
            "pipeline_constructed_ms",
            "task_constructed_ms",
            "event_handlers_registered_ms",
            "pipeline_runner_created_ms",
            "provider_preconnect_task_scheduled_ms",
            "pipeline_run_started_ms",
            "pipeline_ready_ms",
            "greeting_first_audio_ms",
            "runtime_config_to_deepgram_connect_gap_ms",
            "deepgram_ready_to_pipeline_ready_gap_ms",
            "cartesia_ready_to_pipeline_ready_gap_ms",
            "pipeline_start_wait_ms",
        ]
        summary_lines = "\n".join(
            f"{key}={summary.get(key)}" for key in ordered_keys
        )
        LOGGER.info("voice startup timing:\n%s", summary_lines)

    def _mark_once(self, attribute_name: str, label: str) -> None:
        if getattr(self._record, attribute_name) is not None:
            return

        timestamp = self._monotonic_clock()
        setattr(self._record, attribute_name, timestamp)
        LOGGER.info(
            "voice startup timing: %s elapsed_ms=%s",
            label,
            self._elapsed_ms(timestamp),
        )

    def _mark_named_stage(self, stage_name: str, label: str) -> None:
        if stage_name in self._named_marks:
            return

        timestamp = self._monotonic_clock()
        self._named_marks[stage_name] = timestamp
        LOGGER.info(
            "voice startup timing: %s elapsed_ms=%s",
            label,
            self._elapsed_ms(timestamp),
        )

    def _get_mark(self, name: str) -> float | None:
        if name.endswith("_at"):
            return getattr(self._record, name)
        return self._named_marks.get(name)

    def _elapsed_ms(self, timestamp: float | None) -> int | None:
        if timestamp is None:
            return None
        return int(round((timestamp - self._session_started_at) * 1000))

    def _duration_ms(self, started_at: float | None, ended_at: float | None) -> int | None:
        if started_at is None or ended_at is None:
            return None
        return int(round((ended_at - started_at) * 1000))


def instrument_service_connect(
    service: object,
    *,
    on_connect_start: Any,
    on_connect_end: Any,
) -> None:
    """Wrap service._connect to record timing and deduplicate calls.

    If the preconnect task connects the service before StartFrame propagates,
    Pipecat's start() method will also call _connect as part of the standard
    service lifecycle.

    Deduplication semantics (Future-based):
    - No active future → start a real connect attempt.
    - Future pending   → another caller is already in flight; await it (share result).
    - Future resolved  → already connected successfully; return immediately.
    - Future failed    → cleared after failure so the next retry attempt proceeds.
    - _disconnect()    → clears the future so the next _connect() opens fresh.

    This fixes a regression where the old boolean flag was set *before*
    connect() completed, causing all retry calls to silently become no-ops
    after a failed first attempt.

    A second fix wraps _disconnect so that successful-connect state is
    invalidated on disconnect, allowing disconnect → reconnect cycles used
    by DeepgramStartupController to open a real new connection each time.
    """
    connect = getattr(service, "_connect", None)
    if not callable(connect):
        return

    _connect_future: asyncio.Future[object] | None = None

    async def wrapped_connect() -> object:
        nonlocal _connect_future

        # Already connected successfully: StartFrame lifecycle calling _connect
        # a second time after a successful preconnect.  Skip it.
        if (
            _connect_future is not None
            and _connect_future.done()
            and not _connect_future.cancelled()
        ):
            try:
                return _connect_future.result()
            except Exception:
                # Previous attempt failed and was not yet cleared; fall through
                # so this call starts a fresh attempt below.
                pass

        # Another coroutine is already running connect() — join it.
        if _connect_future is not None and not _connect_future.done():
            return await asyncio.shield(_connect_future)

        # No in-flight attempt; start one.
        loop = asyncio.get_event_loop()
        fut: asyncio.Future[object] = loop.create_future()
        _connect_future = fut

        try:
            on_connect_start()
            result = connect()
            if asyncio.iscoroutine(result):
                result = await result
            on_connect_end()
            fut.set_result(result)
            return result
        except BaseException as exc:
            # Resolve the future so waiting callers also surface the failure,
            # then clear it so a later retry call can proceed normally.
            if not fut.done():
                fut.set_exception(
                    exc if isinstance(exc, Exception) else Exception(str(exc))
                )
            _connect_future = None
            raise

    setattr(service, "_connect", wrapped_connect)

    disconnect = getattr(service, "_disconnect", None)
    if callable(disconnect):
        async def wrapped_disconnect() -> object:
            nonlocal _connect_future
            result = disconnect()
            if asyncio.iscoroutine(result):
                result = await result
            # Invalidate the connect state so the next _connect() call
            # opens a real new connection rather than reusing the stale future.
            _connect_future = None
            return result

        setattr(service, "_disconnect", wrapped_disconnect)


async def adopt_warm_deepgram_websocket(
    stt_service: object,
    warm: WarmDeepgramConnection,
) -> None:
    """Attach a pre-opened Flux socket to a Pipecat STT service.

    Adoption is atomic from the caller's perspective: on failure the service is
    left without a half-bound websocket (which would otherwise make the cold
    reconnect path no-op and leave STT deaf).
    """
    try:
        from websockets.protocol import State
    except ImportError:  # pragma: no cover - dependency should exist with Pipecat
        State = None  # type: ignore[assignment]

    existing = getattr(stt_service, "_websocket", None)
    if existing is not None and State is not None:
        state = getattr(existing, "state", None)
        if state is State.OPEN:
            await DeepgramWarmPool._close_websocket(warm.websocket)
            return

    # Pipecat FrameProcessor.create_task requires setup(task_manager) first.
    # Fail before mutating service state when the pipeline is not ready yet.
    task_manager = getattr(stt_service, "_task_manager", None)
    if task_manager is None:
        raise RuntimeError("Deepgram warm adopt requires an initialized task manager")

    create_task = getattr(stt_service, "create_task", None)
    receive_handler = getattr(stt_service, "_receive_task_handler", None)
    watchdog_handler = getattr(stt_service, "_watchdog_task_handler", None)
    report_error = getattr(stt_service, "_report_error", None)
    if not callable(create_task) or not callable(receive_handler) or not callable(watchdog_handler):
        raise RuntimeError("Deepgram warm adopt requires receive/watchdog task helpers")

    previous_websocket = getattr(stt_service, "_websocket", None)
    previous_receive_task = getattr(stt_service, "_receive_task", None)
    previous_watchdog_task = getattr(stt_service, "_watchdog_task", None)
    previous_speaking = getattr(stt_service, "_user_is_speaking", False)
    established = getattr(stt_service, "_connection_established_event", None)
    previous_established = False
    if established is not None:
        is_set = getattr(established, "is_set", None)
        previous_established = bool(is_set()) if callable(is_set) else False

    try:
        setattr(stt_service, "_websocket", warm.websocket)
        setattr(stt_service, "_user_is_speaking", False)

        if established is not None:
            clear = getattr(established, "clear", None)
            if callable(clear):
                clear()
            set_event = getattr(established, "set", None)
            if callable(set_event):
                set_event()

        if not previous_receive_task:
            setattr(
                stt_service,
                "_receive_task",
                create_task(receive_handler(report_error)),
            )
        if not previous_watchdog_task:
            setattr(
                stt_service,
                "_watchdog_task",
                create_task(watchdog_handler()),
            )
    except Exception:
        setattr(stt_service, "_websocket", previous_websocket)
        setattr(stt_service, "_receive_task", previous_receive_task)
        setattr(stt_service, "_watchdog_task", previous_watchdog_task)
        setattr(stt_service, "_user_is_speaking", previous_speaking)
        if established is not None:
            clear = getattr(established, "clear", None)
            set_event = getattr(established, "set", None)
            if previous_established:
                if callable(set_event):
                    set_event()
            elif callable(clear):
                clear()
        raise

    call_event_handler = getattr(stt_service, "_call_event_handler", None)
    if callable(call_event_handler):
        await call_event_handler("on_connected")

    LOGGER.info("voice worker: adopted Deepgram warm-pool WebSocket")


def attach_deepgram_warm_pool(
    stt_service: object,
    pool: DeepgramWarmPool | None,
) -> None:
    """Prefer a warm Flux socket inside ``_connect_websocket`` when available."""
    if pool is None:
        return

    original = getattr(stt_service, "_connect_websocket", None)
    if not callable(original):
        return

    async def wrapped_connect_websocket() -> object:
        existing = getattr(stt_service, "_websocket", None)
        try:
            from websockets.protocol import State

            if existing is not None and getattr(existing, "state", None) is State.OPEN:
                # Only treat an existing socket as connected when receive is alive.
                if getattr(stt_service, "_receive_task", None):
                    return None
        except ImportError:
            pass

        websocket_url = getattr(stt_service, "_websocket_url", None)
        warm = await pool.acquire(url=str(websocket_url) if websocket_url else None)
        if warm is not None:
            try:
                await adopt_warm_deepgram_websocket(stt_service, warm)
                return None
            except Exception:  # noqa: BLE001
                LOGGER.exception(
                    "voice worker: failed to adopt Deepgram warm-pool socket; falling back"
                )
                await pool.requeue(warm)

        result = original()
        if asyncio.iscoroutine(result):
            return await result
        return result

    setattr(stt_service, "_connect_websocket", wrapped_connect_websocket)


def defer_deepgram_connect_during_startframe(stt_service: object) -> None:
    """Do not block StartFrame on the Deepgram handshake.

    Pipeline ready + opening greeting can proceed while Flux connects in the
    background (preconnect / warm-pool adopt still share one real connect via
    ``instrument_service_connect``).
    """
    original_start = getattr(stt_service, "start", None)
    if not callable(original_start):
        return

    async def wrapped_start(frame: object, *args: object, **kwargs: object) -> object:
        connect = getattr(stt_service, "_connect", None)

        async def noop_connect() -> None:
            return None

        if callable(connect):
            setattr(stt_service, "_connect", noop_connect)
        start_succeeded = False
        try:
            result = original_start(frame, *args, **kwargs)
            if asyncio.iscoroutine(result):
                result = await result
            start_succeeded = True
            return result
        finally:
            if callable(connect):
                setattr(stt_service, "_connect", connect)
            if start_succeeded and callable(connect):
                task = asyncio.create_task(
                    connect(),
                    name="deepgram-startframe-deferred-connect",
                )

                def _log_deferred_connect_result(done: asyncio.Task[object]) -> None:
                    try:
                        done.result()
                    except asyncio.CancelledError:
                        return
                    except Exception:  # noqa: BLE001
                        LOGGER.exception(
                            "voice worker: deferred Deepgram connect failed after StartFrame"
                        )

                task.add_done_callback(_log_deferred_connect_result)

    setattr(stt_service, "start", wrapped_start)


def install_deepgram_warm_pool_lifespan() -> None:
    """Hook Pipecat runner lifespan so Flux sockets warm before the first Connect."""
    try:
        from contextlib import asynccontextmanager

        from pipecat.runner import run as runner_run
    except ImportError:
        LOGGER.warning("voice worker: cannot install Deepgram warm pool lifespan (import failed)")
        return

    if getattr(runner_run, "_sleek_relay_warm_pool_lifespan_installed", False):
        return

    @asynccontextmanager
    async def deepgram_warm_pool_lifespan(app: object):
        try:
            config = load_config()
            await get_or_start_global_deepgram_warm_pool(
                api_key=config.deepgram_api_key,
                model=config.deepgram_model,
                sample_rate=DEEPGRAM_BROWSER_SAMPLE_RATE,
            )
        except Exception:  # noqa: BLE001
            LOGGER.exception("voice worker: Deepgram warm pool lifespan start failed")
        try:
            yield
        finally:
            await stop_global_deepgram_warm_pool()

    original_configure = getattr(runner_run, "_configure_server_app", None)
    original_add = getattr(runner_run, "_add_lifespan_to_app", None)

    if callable(original_configure) and callable(original_add):
        def patched_configure(args: object) -> None:
            original_configure(args)
            app = getattr(runner_run, "app", None)
            if app is not None:
                original_add(app, deepgram_warm_pool_lifespan)

        setattr(runner_run, "_configure_server_app", patched_configure)
    elif callable(original_add):
        def patched_add_lifespan(app: object, new_lifespan: object) -> None:
            @asynccontextmanager
            async def combined_lifespan(app_inner: object):
                async with deepgram_warm_pool_lifespan(app_inner):
                    async with new_lifespan(app_inner):  # type: ignore[misc]
                        yield

            original_add(app, combined_lifespan)

        setattr(runner_run, "_add_lifespan_to_app", patched_add_lifespan)
    else:
        LOGGER.warning("voice worker: Pipecat runner has no lifespan hook to patch")
        return

    setattr(runner_run, "_sleek_relay_warm_pool_lifespan_installed", True)
    LOGGER.info("voice worker: Deepgram warm pool lifespan hook installed")


async def start_provider_preconnects(
    *,
    deepgram_startup_controller: "DeepgramStartupController",
    tts_service: object,
) -> None:
    async def connect_service(label: str, service: object) -> None:
        connect = getattr(service, "_connect", None)
        if not callable(connect):
            return

        try:
            result = connect()
            if asyncio.iscoroutine(result):
                await result
        except Exception as exc:  # noqa: BLE001
            LOGGER.warning(
                "voice worker: early %s preconnect did not finish before pipeline startup: %s",
                label,
                exc,
            )

    stt_service = getattr(deepgram_startup_controller, "_stt_service", None)
    deepgram_preconnect: asyncio.Future[None] | asyncio.Task[None] | Any
    if stt_service is not None and getattr(stt_service, "_task_manager", None) is not None:
        deepgram_preconnect = connect_service("Deepgram", stt_service)
    else:
        if stt_service is not None:
            LOGGER.info(
                "voice worker: deferring Deepgram preconnect until pipeline task manager is ready"
            )
        deepgram_preconnect = asyncio.sleep(0)

    await asyncio.gather(
        deepgram_preconnect,
        connect_service("Cartesia", tts_service),
    )


class DeepgramStartupController:
    def __init__(
        self,
        stt_service: object,
        *,
        latency_tracker: VoiceTurnLatencyTracker | None = None,
        fallback_message: str = DEFAULT_PROVIDER_ERROR_MESSAGE,
        max_attempts: int = DEEPGRAM_STARTUP_MAX_ATTEMPTS,
        backoff_delays: tuple[float, ...] = DEEPGRAM_STARTUP_BACKOFF_SECS,
        jitter_max: float = DEEPGRAM_STARTUP_JITTER_SECS,
    ) -> None:
        self._stt_service = stt_service
        self._latency_tracker = latency_tracker
        self._fallback_message = fallback_message.strip() or DEFAULT_PROVIDER_ERROR_MESSAGE
        self._max_attempts = max_attempts
        self._backoff_delays = backoff_delays
        self._jitter_max = jitter_max
        self._task: object | None = None
        self._attempt_count = 0
        self._startup_ready = False
        self._accepted_first_user_turn = False
        self._client_disconnected = False
        self._cleanup_started = False
        self._retry_task: asyncio.Task[None] | None = None
        self._disconnect_event = asyncio.Event()
        self._state_lock = asyncio.Lock()
        self._last_handshake_error = ""

    @property
    def attempt_count(self) -> int:
        return self._attempt_count

    @property
    def startup_ready(self) -> bool:
        return self._startup_ready

    @property
    def retry_task(self) -> asyncio.Task[None] | None:
        return self._retry_task

    def attach_task(self, task: object) -> None:
        self._task = task

    def note_initial_connection_attempt(self) -> None:
        if self._attempt_count == 0:
            self._attempt_count = 1
            LOGGER.info(
                "voice worker: Deepgram connection attempt %s/%s",
                self._attempt_count,
                self._max_attempts,
            )

    def mark_first_user_turn_accepted(self, transcript_text: str) -> None:
        if self._accepted_first_user_turn:
            return

        self._accepted_first_user_turn = True
        LOGGER.info(
            "voice worker: Deepgram startup window closed after first accepted transcript text=%r",
            transcript_text,
        )

    def handle_connected(self) -> None:
        self._startup_ready = True
        if self._attempt_count > 1:
            LOGGER.info(
                "voice worker: Deepgram connection recovered on attempt %s/%s",
                self._attempt_count,
                self._max_attempts,
            )
        else:
            LOGGER.info("voice worker: Deepgram connection established on first attempt")

    async def handle_client_disconnected(self) -> None:
        self._client_disconnected = True
        self._disconnect_event.set()

        retry_task = self._retry_task
        if retry_task is not None:
            retry_task.cancel()
            try:
                await retry_task
            except asyncio.CancelledError:
                pass
            finally:
                if self._retry_task is retry_task:
                    self._retry_task = None

    async def handle_connection_error(self, error_message: str, *, source: str) -> bool:
        if not is_deepgram_handshake_error_message(error_message):
            return False

        LOGGER.warning(
            "voice worker: Deepgram handshake timeout source=%s attempt=%s/%s error=%r",
            source,
            max(self._attempt_count, 1),
            self._max_attempts,
            error_message,
        )

        async with self._state_lock:
            self._last_handshake_error = error_message

            if (
                self._startup_ready
                or self._accepted_first_user_turn
                or self._client_disconnected
                or self._cleanup_started
            ):
                return True

            if self._retry_task is not None and not self._retry_task.done():
                LOGGER.info("voice worker: Deepgram retry already in progress; suppressing duplicate")
                return True

            if self._attempt_count >= self._max_attempts:
                self._retry_task = asyncio.create_task(
                    self._handle_retries_exhausted(),
                    name="deepgram-startup-exhausted",
                )
                return True

            self._retry_task = asyncio.create_task(
                self._retry_until_ready(),
                name="deepgram-startup-retry",
            )
            return True

    async def wait_for_retry_completion(self) -> None:
        retry_task = self._retry_task
        if retry_task is None:
            return

        try:
            await retry_task
        except asyncio.CancelledError:
            pass

    async def _retry_until_ready(self) -> None:
        try:
            while (
                not self._startup_ready
                and not self._accepted_first_user_turn
                and not self._client_disconnected
                and not self._cleanup_started
                and self._attempt_count < self._max_attempts
            ):
                next_attempt = self._attempt_count + 1
                delay = self._compute_retry_delay(next_attempt)
                LOGGER.info(
                    "voice worker: Deepgram retry delay %.2fs before attempt %s/%s",
                    delay,
                    next_attempt,
                    self._max_attempts,
                )

                try:
                    await asyncio.wait_for(self._disconnect_event.wait(), timeout=delay)
                except TimeoutError:
                    pass

                if self._client_disconnected:
                    LOGGER.info("voice worker: Deepgram retry cancelled because client disconnected")
                    return

                self._attempt_count = next_attempt
                LOGGER.info(
                    "voice worker: Deepgram connection attempt %s/%s",
                    self._attempt_count,
                    self._max_attempts,
                )

                await self._disconnect_stt_service()
                await self._connect_stt_service()

                if self._startup_ready:
                    return

            if not self._startup_ready and not self._client_disconnected and not self._cleanup_started:
                await self._handle_retries_exhausted()
        except asyncio.CancelledError:
            LOGGER.info("voice worker: Deepgram retry cancelled because client disconnected")
            raise
        finally:
            if self._retry_task is asyncio.current_task():
                self._retry_task = None

    def _compute_retry_delay(self, next_attempt: int) -> float:
        delay_index = max(0, next_attempt - 2)
        base_delay = self._backoff_delays[min(delay_index, len(self._backoff_delays) - 1)]
        jitter = random.uniform(0.0, self._jitter_max) if self._jitter_max > 0 else 0.0
        return base_delay + jitter

    async def _connect_stt_service(self) -> None:
        connect = getattr(self._stt_service, "_connect", None)
        if callable(connect):
            await connect()

    async def _disconnect_stt_service(self) -> None:
        disconnect = getattr(self._stt_service, "_disconnect", None)
        if callable(disconnect):
            await disconnect()

    async def _handle_retries_exhausted(self) -> None:
        async with self._state_lock:
            if self._cleanup_started:
                return
            self._cleanup_started = True

        LOGGER.error(
            "voice worker: Deepgram retries exhausted after %s attempts",
            max(self._attempt_count, 1),
        )
        if self._latency_tracker is not None:
            self._latency_tracker.mark_provider_error_turn()
        await self._emit_provider_error()
        await self._cancel_pipeline()
        LOGGER.info("voice worker: provider cleanup completed")

    async def _emit_provider_error(self) -> None:
        if self._task is None:
            return

        rtvi_accessor = getattr(self._task, "rtvi", None)
        if rtvi_accessor is None:
            return
        rtvi = rtvi_accessor() if callable(rtvi_accessor) else rtvi_accessor

        error_message = self._fallback_message
        await rtvi.send_server_message(
            {
                "provider": "deepgram",
                "stage": "startup",
                "type": DEEPGRAM_PROVIDER_ERROR_SERVER_MESSAGE_TYPE,
            }
        )
        await rtvi.send_error(error_message)

    async def _cancel_pipeline(self) -> None:
        if self._task is None:
            return

        await cancel_pipeline_task(
            self._task,
            reason="deepgram-startup-handshake-failed",
        )


def build_end_session_tool_schema(
    modules: dict[str, object],
    termination_controller: SessionTerminationController,
) -> object:
    function_schema_cls = modules["FunctionSchema"]
    return function_schema_cls(
        name="end_session",
        description=(
            "End the current live conversation only when the user clearly asks to stop, "
            "hang up, disconnect, or finish this conversation. Do not use this tool when "
            "the user is only mentioning these words in another context. Pass the user's "
            "latest end-conversation wording exactly."
        ),
        properties={
            "user_request_text": {
                "description": "The user's exact latest words asking to end the current conversation.",
                "type": "string",
            }
        },
        required=["user_request_text"],
        handler=termination_controller.handle_end_session_tool_call,
    )


def create_deterministic_end_session_processor(
    modules: dict[str, object],
    termination_controller: SessionTerminationController,
    *,
    deepgram_startup_controller: DeepgramStartupController | None = None,
) -> object:
    frame_direction_cls = modules["FrameDirection"]
    frame_processor_cls = modules["FrameProcessor"]
    transcription_frame_cls = modules["TranscriptionFrame"]

    class DeterministicEndSessionProcessor(frame_processor_cls):
        async def process_frame(self, frame: object, direction: object) -> None:
            await super().process_frame(frame, direction)

            if direction is frame_direction_cls.DOWNSTREAM and isinstance(frame, transcription_frame_cls):
                if deepgram_startup_controller is not None:
                    deepgram_startup_controller.mark_first_user_turn_accepted(frame.text)

                normalized_text = normalize_end_session_text(frame.text)
                LOGGER.info(
                    "voice worker: final user text evaluated for end intent normalized=%r",
                    normalized_text,
                )

                if termination_controller.is_ending:
                    LOGGER.info(
                        "voice worker: deterministic end intent accepted normalized=%r",
                        normalized_text,
                    )
                    await termination_controller.request_end_session(
                        source="deterministic-repeat",
                        log_message="voice worker: deterministic end intent accepted",
                    )
                    return

                if is_deterministic_end_session_request(frame.text):
                    LOGGER.info(
                        "voice worker: deterministic end intent accepted normalized=%r",
                        normalized_text,
                    )
                    await termination_controller.request_end_session(
                        source="deterministic-final-transcript",
                        log_message="voice worker: deterministic end intent accepted",
                    )
                    return

                LOGGER.info(
                    "voice worker: deterministic end intent rejected normalized=%r",
                    normalized_text,
                )

            await self.push_frame(frame, direction)

    return DeterministicEndSessionProcessor(name="DeterministicEndSessionProcessor")


def create_vad_user_stop_adapter_processor(modules: dict[str, object]) -> object:
    frame_direction_cls = modules["FrameDirection"]
    frame_processor_cls = modules["FrameProcessor"]
    transcription_frame_cls = modules["TranscriptionFrame"]
    vad_user_stopped_speaking_frame_cls = modules["VADUserStoppedSpeakingFrame"]
    user_stopped_speaking_frame_cls = modules["UserStoppedSpeakingFrame"]

    class VADUserStopAdapterProcessor(frame_processor_cls):
        async def process_frame(self, frame: object, direction: object) -> None:
            await super().process_frame(frame, direction)

            await self.push_frame(frame, direction)

            if direction is not frame_direction_cls.DOWNSTREAM:
                return

            if isinstance(frame, transcription_frame_cls):
                LOGGER.info(
                    "voice diagnostics: turn adapter forwarded final TranscriptionFrame to user aggregator text=%r",
                    frame.text,
                )
            elif isinstance(frame, vad_user_stopped_speaking_frame_cls):
                LOGGER.info(
                    "voice diagnostics: turn adapter emitted UserStoppedSpeakingFrame from VAD stop",
                )
                await self.push_frame(user_stopped_speaking_frame_cls(), direction)

    return VADUserStopAdapterProcessor(name="VADUserStopAdapterProcessor")


def instrument_google_llm_service(modules: dict[str, object], llm: object) -> None:
    llm_context_frame_cls = modules["LLMContextFrame"]
    process_frame = getattr(llm, "process_frame", None)
    if not callable(process_frame):
        return

    async def logged_process_frame(frame: object, direction: object, *args: object, **kwargs: object) -> object:
        if isinstance(frame, llm_context_frame_cls):
            LOGGER.info(
                "voice diagnostics: GoogleLLMService invoked from LLMContextFrame",
            )
        result = process_frame(frame, direction, *args, **kwargs)
        if asyncio.iscoroutine(result):
            return await result
        return result

    setattr(llm, "process_frame", logged_process_frame)


def _build_diagnostics_observer(
    modules: dict[str, object],
    latency_tracker: VoiceTurnLatencyTracker,
    startup_timing_tracker: VoiceStartupTimingTracker,
) -> object:
    base_observer_cls = modules["BaseObserver"]
    bot_started_speaking_frame_cls = modules["BotStartedSpeakingFrame"]
    bot_stopped_speaking_frame_cls = modules["BotStoppedSpeakingFrame"]
    frame_pushed_cls = modules["FramePushed"]
    input_audio_raw_frame_cls = modules["InputAudioRawFrame"]
    interim_transcription_frame_cls = modules["InterimTranscriptionFrame"]
    llm_context_frame_cls = modules["LLMContextFrame"]
    llm_full_response_end_frame_cls = modules["LLMFullResponseEndFrame"]
    llm_text_frame_cls = modules["LLMTextFrame"]
    transcription_frame_cls = modules["TranscriptionFrame"]
    tts_audio_raw_frame_cls = modules["TTSAudioRawFrame"]
    tts_started_frame_cls = modules["TTSStartedFrame"]
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

        async def on_process_frame(self, data: object) -> None:
            processor = getattr(data, "processor", None)
            frame = getattr(data, "frame", None)
            direction = getattr(data, "direction", None)
            if (
                processor is None
                or frame is None
                or direction is not frame_direction_cls.DOWNSTREAM
                or type(frame).__name__ != "StartFrame"
            ):
                return

            label = getattr(processor, "_sleek_relay_startframe_label", None)
            if label:
                startup_timing_tracker.mark_startframe_processor_entered(label)
                if label == "stt":
                    startup_timing_tracker.mark_deepgram_connect_started()

        async def on_push_frame(self, data: object) -> None:
            if not isinstance(data, frame_pushed_cls):
                return

            frame = data.frame
            if (
                data.direction is frame_direction_cls.DOWNSTREAM
                and type(frame).__name__ == "StartFrame"
            ):
                source_label = getattr(data.source, "_sleek_relay_startframe_label", None)
                if source_label:
                    startup_timing_tracker.mark_startframe_processor_pushed(source_label)
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
                latency_tracker.handle_user_started_speaking()
            elif isinstance(frame, user_stopped_speaking_frame_cls):
                latency_tracker.handle_user_stopped_speaking()
            elif isinstance(frame, interim_transcription_frame_cls):
                latency_tracker.handle_first_interim_transcript()
                if not self._logged_first_interim:
                    self._logged_first_interim = True
                    LOGGER.info(
                        "voice diagnostics: first Deepgram interim transcription text=%r",
                        frame.text,
                    )
            elif isinstance(frame, transcription_frame_cls):
                latency_tracker.handle_accepted_final_transcript(frame.text)
                LOGGER.info(
                    "voice diagnostics: TranscriptionFrame received text=%r",
                    frame.text,
                )
                self._logged_first_final = True
            elif (
                isinstance(frame, llm_context_frame_cls)
                and data.direction is frame_direction_cls.DOWNSTREAM
            ):
                latency_tracker.handle_llm_request_started()
                LOGGER.info(
                    "voice diagnostics: user turn finalized and LLMContextFrame emitted",
                )
            elif isinstance(frame, llm_text_frame_cls):
                latency_tracker.handle_llm_first_token()
            elif isinstance(frame, llm_full_response_end_frame_cls):
                latency_tracker.handle_llm_response_completed()
            elif isinstance(frame, tts_started_frame_cls):
                latency_tracker.handle_tts_request_started()
            elif isinstance(frame, tts_audio_raw_frame_cls):
                latency_tracker.handle_first_tts_audio()
                startup_timing_tracker.mark_greeting_first_audio()
            elif isinstance(frame, bot_started_speaking_frame_cls):
                latency_tracker.handle_bot_started_speaking()
            elif isinstance(frame, bot_stopped_speaking_frame_cls):
                latency_tracker.handle_bot_stopped_speaking()

    return VoiceDiagnosticsObserver()


def build_deepgram_flux_settings_kwargs(config: object) -> dict[str, object]:
    return {
        "model": config.deepgram_model,
    }


def build_user_turn_detection(modules: dict[str, object]) -> tuple[object, object]:
    user_turn_strategies_cls = modules["UserTurnStrategies"]
    vad_user_turn_start_strategy_cls = modules["VADUserTurnStartStrategy"]
    external_user_turn_stop_strategy_cls = modules["ExternalUserTurnStopStrategy"]
    silero_vad_analyzer_cls = modules["SileroVADAnalyzer"]
    vad_params_cls = modules["VADParams"]

    # VADUserTurnStartStrategy fires UserStartedSpeakingFrame on voice-activity onset
    # and drives barge-in interruption.  Deepgram Flux owns transcription and signals
    # turn-end via ExternalUserTurnStopStrategy; a second transcription-based
    # turn-start for the same utterance is therefore both redundant and harmful
    # (it produces duplicate interruptions, broken turn metrics, and negative TTFB).
    return (
        user_turn_strategies_cls(
            start=[vad_user_turn_start_strategy_cls()],
            stop=[external_user_turn_stop_strategy_cls(timeout=0.05)],
        ),
        silero_vad_analyzer_cls(
            params=vad_params_cls(
                confidence=SILERO_VAD_CONFIDENCE,
                start_secs=SILERO_VAD_START_SECS,
                stop_secs=SILERO_VAD_STOP_SECS,
                min_volume=SILERO_VAD_MIN_VOLUME,
            )
        ),
    )


async def cancel_pipeline_task(task: object, *, reason: str | None = None) -> None:
    cancel = getattr(task, "cancel", None)
    if not callable(cancel):
        return

    result = cancel(reason=reason)
    if asyncio.iscoroutine(result):
        await result


def resolve_opening_greeting(runtime_config: VoiceSessionRuntimeConfig) -> str:
    greeting = runtime_config.agent.greeting.strip()
    if greeting:
        return greeting

    return LOCAL_FALLBACK_GREETING


async def queue_opening_greeting(
    task: object,
    modules: dict[str, object],
    runtime_config: VoiceSessionRuntimeConfig,
) -> None:
    queue_frame = getattr(task, "queue_frame", None)
    if not callable(queue_frame):
        return

    greeting = resolve_opening_greeting(runtime_config)
    LOGGER.info(
        "voice worker: queueing opening greeting source=%s agent_id=%s text=%r",
        runtime_config.source,
        runtime_config.agent.id,
        greeting,
    )
    tts_speak_frame_cls = modules["TTSSpeakFrame"]
    await queue_frame(
        tts_speak_frame_cls(
            greeting,
            append_to_context=True,
        )
    )


class OpeningGreetingController:
    def __init__(
        self,
        task: object,
        modules: dict[str, object],
        runtime_config: VoiceSessionRuntimeConfig,
    ) -> None:
        self._client_connected = False
        self._greeting_queued = False
        self._modules = modules
        self._pipeline_started = False
        self._runtime_config = runtime_config
        self._task = task

    async def handle_client_connected(self) -> None:
        self._client_connected = True
        await self._maybe_queue_greeting()

    async def handle_pipeline_started(self) -> None:
        self._pipeline_started = True
        await self._maybe_queue_greeting()

    async def _maybe_queue_greeting(self) -> None:
        if self._greeting_queued:
            return

        if not self._client_connected or not self._pipeline_started:
            return

        await queue_opening_greeting(
            self._task,
            self._modules,
            self._runtime_config,
        )
        self._greeting_queued = True


async def enforce_maximum_session_duration(
    termination_controller: SessionTerminationController,
    runtime_config: VoiceSessionRuntimeConfig,
) -> None:
    maximum_session_duration_seconds = runtime_config.agent.maximumSessionDurationSeconds
    if maximum_session_duration_seconds is None:
        return

    await asyncio.sleep(maximum_session_duration_seconds)
    await termination_controller.request_end_session(
        source="maximum-session-duration",
        log_message=(
            "voice worker: maximum session duration reached "
            f"tenant_id={runtime_config.tenant.id} agent_id={runtime_config.agent.id}"
        ),
    )


def build_pipeline_task(
    transport: object,
    modules: dict[str, object],
    config: object,
    runtime_config: VoiceSessionRuntimeConfig | None = None,
    startup_timing_tracker: VoiceStartupTimingTracker | None = None,
) -> object:
    runtime_config = runtime_config or build_runtime_config(config)
    startup_timing_tracker = startup_timing_tracker or VoiceStartupTimingTracker()
    llm_context_cls = modules["LLMContext"]
    llm_context_aggregator_pair_cls = modules["LLMContextAggregatorPair"]
    llm_user_aggregator_params_cls = modules["LLMUserAggregatorParams"]
    pipeline_cls = modules["Pipeline"]
    pipeline_params_cls = modules["PipelineParams"]
    pipeline_task_cls = modules["PipelineTask"]
    deepgram_flux_stt_service_cls = modules["DeepgramFluxSTTService"]
    google_llm_service_cls = modules["GoogleLLMService"]
    cartesia_tts_service_cls = modules["CartesiaTTSService"]
    text_aggregation_mode_cls = modules["TextAggregationMode"]
    latency_tracker = VoiceTurnLatencyTracker()
    termination_controller = SessionTerminationController(
        modules,
        latency_tracker=latency_tracker,
    )
    deepgram_startup_controller: DeepgramStartupController | None = None
    end_session_tool = build_end_session_tool_schema(modules, termination_controller)

    LOGGER.info("voice worker: constructing provider services")

    stt = deepgram_flux_stt_service_cls(
        api_key=config.deepgram_api_key,
        sample_rate=DEEPGRAM_BROWSER_SAMPLE_RATE,
        settings=deepgram_flux_stt_service_cls.Settings(
            **build_deepgram_flux_settings_kwargs(config)
        ),
    )
    startup_timing_tracker.mark_stt_created()
    deepgram_startup_controller = DeepgramStartupController(
        stt,
        latency_tracker=latency_tracker,
        fallback_message=runtime_config.agent.fallbackMessage,
    )
    instrument_service_connect(
        stt,
        on_connect_start=startup_timing_tracker.mark_deepgram_connect_started,
        on_connect_end=startup_timing_tracker.mark_deepgram_connect_completed,
    )
    defer_deepgram_connect_during_startframe(stt)
    attach_deepgram_warm_pool(stt, get_global_deepgram_warm_pool())
    llm = google_llm_service_cls(
        api_key=config.google_api_key,
        settings=google_llm_service_cls.Settings(
            model=config.google_model,
            system_instruction=runtime_config.promptText or SYSTEM_PROMPT,
            temperature=0.3,
        ),
    )
    startup_timing_tracker.mark_llm_created()
    tts = cartesia_tts_service_cls(
        api_key=config.cartesia_api_key,
        text_aggregation_mode=text_aggregation_mode_cls.TOKEN,
        settings=cartesia_tts_service_cls.Settings(
            model=config.cartesia_model,
            voice=runtime_config.agent.voiceId,
            language=runtime_config.ttsLanguage,
        ),
    )
    startup_timing_tracker.mark_tts_created()
    instrument_google_llm_service(modules, llm)
    instrument_service_connect(
        tts,
        on_connect_start=startup_timing_tracker.mark_cartesia_connect_started,
        on_connect_end=startup_timing_tracker.mark_cartesia_connect_completed,
    )
    deterministic_end_session_processor = create_deterministic_end_session_processor(
        modules,
        termination_controller,
        deepgram_startup_controller=deepgram_startup_controller,
    )
    vad_user_stop_adapter_processor = create_vad_user_stop_adapter_processor(modules)

    context = llm_context_cls(tools=[end_session_tool])
    startup_timing_tracker.mark_context_created()
    user_turn_strategies, vad_analyzer = build_user_turn_detection(modules)
    startup_timing_tracker.mark_vad_created()
    user_aggregator, assistant_aggregator = llm_context_aggregator_pair_cls(
        context,
        user_params=llm_user_aggregator_params_cls(
            user_turn_strategies=user_turn_strategies,
            user_turn_stop_timeout=float(runtime_config.agent.silenceTimeoutSeconds),
            vad_analyzer=vad_analyzer,
        ),
    )
    startup_timing_tracker.mark_aggregators_created()

    transport_input = transport.input()
    transport_output = transport.output()
    startframe_processors = (
        ("transport_input", transport_input),
        ("stt", stt),
        ("deterministic_end_session", deterministic_end_session_processor),
        ("vad_user_stop_adapter", vad_user_stop_adapter_processor),
        ("user_aggregator", user_aggregator),
        ("llm", llm),
        ("tts", tts),
        ("transport_output", transport_output),
        ("assistant_aggregator", assistant_aggregator),
    )
    for label, processor in startframe_processors:
        try:
            setattr(processor, "_sleek_relay_startframe_label", label)
        except Exception:  # noqa: BLE001
            pass
        startup_timing_tracker.register_startframe_processor(label)

    LOGGER.info("voice worker: building pipeline")
    pipeline = pipeline_cls(
        [
            transport_input,
            stt,
            deterministic_end_session_processor,
            vad_user_stop_adapter_processor,
            user_aggregator,
            llm,
            tts,
            transport_output,
            assistant_aggregator,
        ]
    )
    startup_timing_tracker.mark_pipeline_constructed()
    task = pipeline_task_cls(
        pipeline,
        observers=[_build_diagnostics_observer(modules, latency_tracker, startup_timing_tracker)],
        params=pipeline_params_cls(
            enable_metrics=True,
            enable_usage_metrics=True,
        ),
    )
    startup_timing_tracker.mark_task_constructed()
    termination_controller.attach_task(task)
    deepgram_startup_controller.attach_task(task)
    task._sleek_relay_latency_tracker = latency_tracker
    task._sleek_relay_llm_context = context
    task._sleek_relay_runtime_config = runtime_config
    task._sleek_relay_startup_timing_tracker = startup_timing_tracker
    task._sleek_relay_stt = stt
    task._sleek_relay_tts = tts
    task._sleek_relay_deepgram_startup_controller = deepgram_startup_controller
    task._sleek_relay_termination_controller = termination_controller
    return task


async def run_bot(
    transport: object,
    *,
    config: object | None = None,
    runtime_package: Mapping[str, object] | None = None,
    runtime_config: VoiceSessionRuntimeConfig | None = None,
    startup_timing_tracker: VoiceStartupTimingTracker | None = None,
) -> tuple[object | None, VoiceTurnLatencyTracker | None]:
    """Run the voice pipeline and return (llm_context, latency_tracker) after it finishes.

    Returns the ``LLMContext`` and ``VoiceTurnLatencyTracker`` objects so callers
    can persist the transcript and turn latency metrics.  Returns ``(None, None)``
    on early exit.
    """
    config = config or load_config()
    runtime_config = runtime_config or build_runtime_config(
        config,
        runtime_package=runtime_package,
    )
    startup_timing_tracker = startup_timing_tracker or VoiceStartupTimingTracker()
    startup_timing_tracker.mark_runtime_config_loaded()
    modules = _import_pipecat_dependencies()
    bot_stopped_speaking_frame_cls = modules["BotStoppedSpeakingFrame"]
    error_frame_cls = modules["ErrorFrame"]
    pipeline_runner_cls = modules["PipelineRunner"]

    task = build_pipeline_task(
        transport,
        modules,
        config,
        runtime_config,
        startup_timing_tracker=startup_timing_tracker,
    )
    deepgram_startup_controller = getattr(task, "_sleek_relay_deepgram_startup_controller")
    greeting_controller = OpeningGreetingController(task, modules, runtime_config)
    latency_tracker = getattr(task, "_sleek_relay_latency_tracker")
    llm_context = getattr(task, "_sleek_relay_llm_context", None)
    stt = getattr(task, "_sleek_relay_stt")
    tts = getattr(task, "_sleek_relay_tts")
    termination_controller = getattr(task, "_sleek_relay_termination_controller")
    task.add_reached_downstream_filter((bot_stopped_speaking_frame_cls,))
    duration_task: asyncio.Task[None] | None = None
    preconnect_task: asyncio.Task[None] | None = None

    LOGGER.info(
        "voice worker: runtime configuration ready source=%s tenant_id=%s agent_id=%s language=%s voice_id=%s",
        runtime_config.source,
        runtime_config.tenant.id,
        runtime_config.agent.id,
        runtime_config.agent.language,
        runtime_config.agent.voiceId,
    )

    @stt.event_handler("on_connected")
    async def on_stt_connected(service: object) -> None:
        deepgram_startup_controller.handle_connected()
        startup_timing_tracker.mark_deepgram_connect_completed()

    @stt.event_handler("on_connection_error")
    async def on_stt_connection_error(service: object, error: str) -> None:
        await deepgram_startup_controller.handle_connection_error(
            error,
            source="stt-event",
        )

    @transport.event_handler("on_client_connected")
    async def on_client_connected(transport_instance: object, client: object) -> None:
        nonlocal duration_task
        LOGGER.info("WebRTC client connected: %s", client)
        await greeting_controller.handle_client_connected()
        if duration_task is None and runtime_config.agent.maximumSessionDurationSeconds is not None:
            duration_task = asyncio.create_task(
                enforce_maximum_session_duration(termination_controller, runtime_config)
            )

    @transport.event_handler("on_client_disconnected")
    async def on_client_disconnected(transport_instance: object, client: object) -> None:
        nonlocal duration_task
        LOGGER.info("WebRTC client disconnected: %s", client)
        if duration_task is not None:
            duration_task.cancel()
            duration_task = None
        await deepgram_startup_controller.handle_client_disconnected()
        await cancel_pipeline_task(task, reason="client-disconnected")

    @task.event_handler("on_frame_reached_downstream")
    async def on_frame_reached_downstream(worker: object, frame: object) -> None:
        if isinstance(frame, bot_stopped_speaking_frame_cls):
            termination_controller.handle_bot_stopped_speaking()

    @task.event_handler("on_pipeline_error")
    async def on_pipeline_error(worker: object, frame: object) -> None:
        if isinstance(frame, error_frame_cls) and getattr(frame, "processor", None) is stt:
            await deepgram_startup_controller.handle_connection_error(
                frame.error,
                source="pipeline-error",
            )
            if not is_deepgram_handshake_error_message(frame.error):
                latency_tracker.mark_provider_error_turn()

    @task.event_handler("on_pipeline_started")
    async def on_pipeline_started(worker: object, frame: object) -> None:
        startup_timing_tracker.mark_pipeline_ready()
        startup_timing_tracker.log_startframe_summary()
        LOGGER.info("voice worker: pipeline task started")
        await greeting_controller.handle_pipeline_started()

    @task.event_handler("on_pipeline_finished")
    async def on_pipeline_finished(worker: object, frame: object) -> None:
        LOGGER.info("voice worker: pipeline task finished with %s", type(frame).__name__)

    startup_timing_tracker.mark_event_handlers_registered()
    runner = pipeline_runner_cls()
    startup_timing_tracker.mark_pipeline_runner_created()
    deepgram_startup_controller.note_initial_connection_attempt()
    preconnect_task = asyncio.create_task(
        start_provider_preconnects(
            deepgram_startup_controller=deepgram_startup_controller,
            tts_service=tts,
        ),
        name="provider-startup-preconnects",
    )
    startup_timing_tracker.mark_provider_preconnect_task_scheduled()
    LOGGER.info("voice worker: starting PipelineRunner task")
    startup_timing_tracker.mark_pipeline_run_started()
    await runner.run(task)
    if duration_task is not None:
        duration_task.cancel()
    if preconnect_task is not None:
        await preconnect_task
    await deepgram_startup_controller.wait_for_retry_completion()
    await termination_controller.wait_for_shutdown()
    latency_tracker.reset_session()
    LOGGER.info("voice worker: transport disconnected")
    LOGGER.info("voice worker: cleanup completed")
    LOGGER.info("voice worker: PipelineRunner task exited")
    return llm_context, latency_tracker


async def bot(runner_args: object) -> None:
    LOGGER.info("voice worker: bot callback invoked with %s", type(runner_args).__name__)
    modules = _import_pipecat_dependencies()
    daily_runner_arguments_cls = modules["DailyRunnerArguments"]
    daily_params_cls = modules["DailyParams"]
    daily_transport_cls = modules["DailyTransport"]
    small_webrtc_runner_arguments_cls = modules["SmallWebRTCRunnerArguments"]
    small_webrtc_transport_cls = modules["SmallWebRTCTransport"]
    transport_params_cls = modules["TransportParams"]

    config = load_config()
    # Lifespan normally warms the pool at process start; this is a safe fallback
    # when the runner path did not install/run that hook.
    try:
        await get_or_start_global_deepgram_warm_pool(
            api_key=config.deepgram_api_key,
            model=config.deepgram_model,
            sample_rate=DEEPGRAM_BROWSER_SAMPLE_RATE,
        )
    except Exception:  # noqa: BLE001
        LOGGER.exception("voice worker: Deepgram warm pool ensure failed")

    startup_timing_tracker = VoiceStartupTimingTracker()
    session_body = getattr(runner_args, "body", None)

    try:
        runtime_config = await load_session_runtime_config(config, session_body)
    except RuntimeConfigLoadError as exc:
        LOGGER.warning("voice worker: session runtime configuration could not be loaded")
        if isinstance(runner_args, small_webrtc_runner_arguments_cls):
            await emit_runtime_config_error_and_disconnect(
                runner_args.webrtc_connection,
                str(exc),
            )
        return
    startup_timing_tracker.mark_runtime_config_loaded()

    if isinstance(runner_args, daily_runner_arguments_cls):
        transport = daily_transport_cls(
            runner_args.room_url,
            runner_args.token,
            "Sleek Relay Agent",
            daily_params_cls(
                audio_in_enabled=True,
                audio_out_enabled=True,
            ),
        )
        LOGGER.info(
            "voice worker: Daily transport created room=%s",
            runner_args.room_url,
        )
    elif isinstance(runner_args, small_webrtc_runner_arguments_cls):
        transport = small_webrtc_transport_cls(
            params=transport_params_cls(
                audio_in_enabled=True,
                audio_out_enabled=True,
            ),
            webrtc_connection=runner_args.webrtc_connection,
        )
    else:
        raise ConfigurationError(
            "Unsupported Pipecat runner transport. Expected Daily or SmallWebRTC."
        )

    startup_timing_tracker.mark_transport_created()

    llm_context, latency_tracker = await run_bot(
        transport,
        config=config,
        runtime_config=runtime_config,
        startup_timing_tracker=startup_timing_tracker,
    )

    # Best-effort: persist the completed transcript and latency metrics to Supabase.
    # run_bot returns (llm_context, latency_tracker).
    # This runs after the pipeline has fully stopped so it is safe to read from a thread.
    try:
        context_messages: list[dict[str, object]] = []
        if llm_context is not None:
            raw_messages = getattr(llm_context, "messages", None)
            if isinstance(raw_messages, list):
                context_messages = raw_messages
        await asyncio.to_thread(
            try_persist_session_results,
            context_messages,
            latency_tracker,
            runtime_config,
            config,
        )
    except Exception:  # noqa: BLE001
        LOGGER.exception("voice worker: unexpected error in transcript persistence")


async def emit_runtime_config_error_and_disconnect(
    connection: object,
    error_message: str,
) -> None:
    try:
        if await wait_for_smallwebrtc_connection(connection):
            send_app_message = getattr(connection, "send_app_message", None)
            if callable(send_app_message):
                send_app_message(
                    {
                        "label": RTVI_MESSAGE_LABEL,
                        "type": "error",
                        "data": {
                            "error": error_message,
                            "fatal": True,
                        },
                    }
                )
                await asyncio.sleep(0)
    finally:
        disconnect = getattr(connection, "disconnect", None)
        if callable(disconnect):
            result = disconnect()
            if asyncio.iscoroutine(result):
                await result


async def wait_for_smallwebrtc_connection(
    connection: object,
    *,
    timeout_secs: float = RUNTIME_CONFIG_CONNECTION_WAIT_TIMEOUT_SECS,
) -> bool:
    is_connected = getattr(connection, "is_connected", None)
    if callable(is_connected) and is_connected():
        return True

    add_event_handler = getattr(connection, "add_event_handler", None)
    remove_event_handler = getattr(connection, "remove_event_handler", None)
    if not callable(add_event_handler):
        return False

    event = asyncio.Event()
    handlers: list[tuple[str, object]] = []

    def handle_connection_event(_connection: object, *_args: object) -> None:
        event.set()

    for event_name in ("connected", "closed", "disconnected", "failed"):
        add_event_handler(event_name, handle_connection_event)
        handlers.append((event_name, handle_connection_event))

    try:
        await asyncio.wait_for(event.wait(), timeout=timeout_secs)
    except TimeoutError:
        return callable(is_connected) and is_connected()
    finally:
        if callable(remove_event_handler):
            for event_name, handler in handlers:
                remove_event_handler(event_name, handler)

    return callable(is_connected) and is_connected()
