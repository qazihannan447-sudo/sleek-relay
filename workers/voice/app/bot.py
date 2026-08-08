from __future__ import annotations

import asyncio
import logging
import os
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
from app.call_timeline import CallTimelineRecorder
from app.captures import CaptureToolController, build_capture_tool_schemas
from app.transcript import try_persist_session_results
from app.tts_markup import (
    TtsMarkupStream,
    apply_allowlisted_tts_markup,
    build_tts_name_allowlist,
)
from app.usage_metrics import UsageMetricsAccumulator


LOGGER = logging.getLogger("sleek_relay.voice.bot")
_PIPECAT_DEPENDENCIES_CACHE: dict[str, object] | None = None
FINAL_GOODBYE_TEXT = "Goodbye."
FINAL_GOODBYE_TIMEOUT_SECS = 15.0
LOCAL_FALLBACK_GREETING = "Hello, how can I help you today?"
RUNTIME_CONFIG_CONNECTION_WAIT_TIMEOUT_SECS = 5.0
# Sessions can be prestarted by the dashboard before the user clicks Connect.
# If no client ever joins the Daily room, cancel the session instead of
# leaving an orphaned bot running. The browser-side prestart reuse window
# (60s) must stay below this timeout.
DEFAULT_CLIENT_NO_SHOW_TIMEOUT_SECS = 120.0
RTVI_MESSAGE_LABEL = "rtvi-ai"
DEEPGRAM_STARTUP_MAX_ATTEMPTS = 3
DEEPGRAM_STARTUP_BACKOFF_SECS = (1.0, 2.0)
DEEPGRAM_STARTUP_JITTER_SECS = 0.25
# Match browser SmallWebRTC / warm-pool Flux sockets so preconnect URLs align.
DEEPGRAM_BROWSER_SAMPLE_RATE = 16000
SESSION_ENDING_SERVER_MESSAGE_TYPE = "session-ending"
# Browser Daily pre-join may complete RTVI before the user clicks Connect.
# Greeting waits for this client message so the agent does not speak early.
SESSION_ARMED_CLIENT_MESSAGE_TYPE = "session_armed"
DEEPGRAM_PROVIDER_ERROR_SERVER_MESSAGE_TYPE = "provider-error"
SILERO_VAD_CONFIDENCE = 0.75
SILERO_VAD_START_SECS = 0.15
SILERO_VAD_STOP_SECS = 0.25
SILERO_VAD_MIN_VOLUME = 0.65
# After greeting TTS starts, wait briefly before unmuting so AEC can settle and
# greeting loopback is less likely to fake a barge-in.
GREETING_BARGE_IN_GRACE_SECS = 0.35
# If Flux interrupts greeting TTS but BotStoppedSpeaking never arrives, open the
# turn gate after this fallback so the caller is not stuck behind the mute/gate.
GREETING_BARGE_IN_PLAYBACK_FALLBACK_SECS = 2.0
# Slightly higher temperature keeps spoken wording less template-like.
LLM_RESPONSE_TEMPERATURE = 0.65
# Legacy Cartesia generation overrides (non-Sonic-3.5 models only).
# Sonic 3.5 humanization baseline omits emotion/speed/volume and managed-buffer
# overrides so transcript context and Cartesia defaults drive delivery.
CARTESIA_DEFAULT_EMOTION = "calm"
CARTESIA_DEFAULT_SPEED = 0.9
CARTESIA_DEFAULT_VOLUME = 1.0
CARTESIA_MAX_BUFFER_DELAY_MS = 1000
_CARTESIA_EMOTION_BY_TONE = {
    "calm": "calm",
    "conversational": "curious",
    "energetic": "enthusiastic",
    "friendly": "curious",
    "professional": "neutral",
}
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
_ACCEPTED_WRAP_UP_DECLINE_PATTERNS = (
    re.compile(r"^(?:no|nope)(?: thanks| thank you)?$"),
    re.compile(r"^(?:no|nope)(?: thanks| thank you)?[,.]?(?: that(?:'s| is) (?:all|it)| nothing else)?$"),
    re.compile(r"^nothing(?: else)?(?: thanks| thank you)?$"),
    re.compile(r"^(?:that(?:'s| is) it)(?: thanks| thank you)?$"),
    re.compile(r"^(?:no )?(?:i(?:'m| am) )?(?:all )?(?:set|good)(?: thanks| thank you)?$"),
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
            MetricsFrame,
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
        from pipecat.services.cartesia.tts import CartesiaTTSService, GenerationConfig
        from pipecat.services.deepgram.flux.stt import DeepgramFluxSTTService
        from pipecat.services.google.llm import GoogleLLMService
        from pipecat.services.tts_service import TextAggregationMode
        from pipecat.transports.base_transport import BaseTransport, TransportParams
        from pipecat.transports.daily.transport import DailyParams, DailyTransport
        from pipecat.transports.smallwebrtc.transport import SmallWebRTCTransport
        from pipecat.turns.user_turn_strategies import (
            ExternalUserTurnStrategies,
            UserTurnStrategies,
        )
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
        "MetricsFrame": MetricsFrame,
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
        "CartesiaGenerationConfig": GenerationConfig,
        "DeepgramFluxSTTService": DeepgramFluxSTTService,
        "GoogleLLMService": GoogleLLMService,
        "TextAggregationMode": TextAggregationMode,
        "BaseTransport": BaseTransport,
        "DailyParams": DailyParams,
        "DailyTransport": DailyTransport,
        "TransportParams": TransportParams,
        "SmallWebRTCTransport": SmallWebRTCTransport,
        "ExternalUserTurnStrategies": ExternalUserTurnStrategies,
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


def is_wrap_up_decline_request(value: str) -> bool:
    """True for short post-capture declines like "no" / "nothing else".

    Only safe to use while a post-capture wrap-up window is active.
    """
    normalized = normalize_end_session_text(value)
    if not normalized or is_rejected_end_session_request(normalized):
        return False

    if is_deterministic_end_session_request(normalized):
        return True

    candidate = strip_leading_end_session_fillers(normalized)
    return any(
        pattern.fullmatch(candidate) or pattern.fullmatch(normalized)
        for pattern in _ACCEPTED_WRAP_UP_DECLINE_PATTERNS
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
    vad_speech_stopped_at: float | None = None
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
    tool_execution_started_at: float | None = None
    tool_execution_finished_at: float | None = None
    tool_execution_total_ms: int = 0
    tool_name: str | None = None
    tool_call_count: int = 0
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

    def handle_vad_user_stopped_speaking(self) -> VoiceTurnLatencyRecord | None:
        """Stamp speech-stop from Silero VAD (preferred over Flux EOT)."""
        current_turn = self._current_turn
        if current_turn is None or current_turn.is_terminal:
            return None

        now = self._now()
        if current_turn.vad_speech_stopped_at is None:
            current_turn.vad_speech_stopped_at = now
        self._apply_speech_stopped_at(current_turn, current_turn.vad_speech_stopped_at)
        return current_turn

    def handle_user_stopped_speaking(self) -> VoiceTurnLatencyRecord | None:
        current_turn = self._current_turn
        if current_turn is None or current_turn.is_terminal:
            return None

        # Flux ExternalUserTurnStop often fires with the final transcript. If the
        # final is already accepted, ignore this late stop so STT latency is not
        # manufactured as 0 ms. VAD stops are handled separately and preferred.
        if current_turn.accepted_final_transcript_at is not None:
            return current_turn

        self._apply_speech_stopped_at(current_turn, self._now())
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

    def handle_tool_execution_started(self, tool_name: str) -> VoiceTurnLatencyRecord | None:
        current_turn = self._current_turn
        if current_turn is None or current_turn.is_terminal:
            return None

        now = self._now()
        current_turn.tool_call_count += 1
        current_turn.tool_name = tool_name
        if current_turn.tool_execution_started_at is None:
            current_turn.tool_execution_started_at = now
        # Nested / sequential tools: track open interval from latest start.
        current_turn.tool_execution_finished_at = None
        setattr(current_turn, "_open_tool_started_at", now)
        return current_turn

    def handle_tool_execution_finished(self) -> VoiceTurnLatencyRecord | None:
        current_turn = self._current_turn
        if current_turn is None or current_turn.is_terminal:
            return None

        now = self._now()
        open_started = getattr(current_turn, "_open_tool_started_at", None)
        if isinstance(open_started, (int, float)):
            elapsed_ms = self._duration_ms(float(open_started), now)
            if elapsed_ms is not None:
                current_turn.tool_execution_total_ms += elapsed_ms
            setattr(current_turn, "_open_tool_started_at", None)
        current_turn.tool_execution_finished_at = now
        return current_turn

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
        speech_stop_to_stt = self._latency_interval_ms(
            turn.user_speech_stopped_at,
            turn.accepted_final_transcript_at,
        )
        tool_execution_ms = turn.tool_execution_total_ms or None
        if tool_execution_ms is None or tool_execution_ms <= 0:
            tool_execution_ms = self._duration_ms(
                turn.tool_execution_started_at,
                turn.tool_execution_finished_at,
            )

        return {
            "turn_id": turn.turn_id,
            "status": turn.status,
            "speech_stop_to_stt_final_ms": speech_stop_to_stt,
            "stt_final_to_llm_first_token_ms": self._duration_ms(
                turn.accepted_final_transcript_at,
                turn.llm_first_token_at,
            ),
            "llm_first_token_to_first_tts_audio_ms": self._duration_ms(
                turn.llm_first_token_at,
                turn.first_tts_audio_at,
            ),
            "tts_first_audio_to_bot_speaking_ms": self._duration_ms(
                turn.first_tts_audio_at,
                turn.bot_speaking_started_at,
            ),
            "final_transcript_to_bot_speaking_ms": self._duration_ms(
                turn.accepted_final_transcript_at,
                turn.bot_speaking_started_at,
            ),
            "speech_stop_to_bot_speaking_ms": self._duration_ms(
                turn.user_speech_stopped_at,
                turn.bot_speaking_started_at,
            ),
            "tool_execution_ms": tool_execution_ms,
            "tool_name": turn.tool_name,
            "tool_call_count": turn.tool_call_count or None,
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
            "tts_first_audio_to_bot_speaking_ms=%s\n"
            "final_transcript_to_bot_speaking_ms=%s\n"
            "speech_stop_to_bot_speaking_ms=%s\n"
            "tool_execution_ms=%s\n"
            "barge_in_to_bot_silence_ms=%s\n"
            "bot_speaking_duration_ms=%s\n"
            "total_turn_duration_ms=%s",
            summary["turn_id"],
            summary["status"],
            summary["speech_stop_to_stt_final_ms"],
            summary["stt_final_to_llm_first_token_ms"],
            summary["llm_first_token_to_first_tts_audio_ms"],
            summary["tts_first_audio_to_bot_speaking_ms"],
            summary["final_transcript_to_bot_speaking_ms"],
            summary["speech_stop_to_bot_speaking_ms"],
            summary["tool_execution_ms"],
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

    def _apply_speech_stopped_at(
        self,
        turn: VoiceTurnLatencyRecord,
        stopped_at: float,
    ) -> None:
        if turn.user_speech_stopped_at is None or stopped_at < turn.user_speech_stopped_at:
            turn.user_speech_stopped_at = stopped_at

    def _duration_ms(self, start: float | None, end: float | None) -> int | None:
        if start is None or end is None or end < start:
            return None
        return int(round((end - start) * 1000))

    def _latency_interval_ms(self, start: float | None, end: float | None) -> int | None:
        """Latency gaps must be a real positive interval — never manufacture 0 ms."""
        duration_ms = self._duration_ms(start, end)
        if duration_ms is None or duration_ms <= 0:
            return None
        return duration_ms

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
        self._end_reason: str | None = None
        self._wrap_up_active = False
        self._wrap_up_pending = False

    @property
    def shutdown_task(self) -> asyncio.Task[None] | None:
        return self._shutdown_task

    def attach_task(self, task: object) -> None:
        self._task = task

    @property
    def is_ending(self) -> bool:
        return self._end_session_requested

    @property
    def end_reason(self) -> str | None:
        return self._end_reason

    @property
    def is_wrap_up_active(self) -> bool:
        return self._wrap_up_active

    def mark_wrap_up_pending(self) -> None:
        """Open wrap-up after the post-capture confirmation/ask turn finishes."""
        self._wrap_up_pending = True
        LOGGER.info("voice worker: post-capture wrap-up pending until bot finishes speaking")

    def mark_wrap_up_active(self) -> None:
        self._wrap_up_pending = False
        self._wrap_up_active = True
        LOGGER.info("voice worker: post-capture wrap-up window opened")

    def clear_wrap_up(self) -> None:
        self._wrap_up_pending = False
        if self._wrap_up_active:
            self._wrap_up_active = False
            LOGGER.info("voice worker: post-capture wrap-up window cleared")

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
        resolved_end_reason = map_termination_source_to_end_reason(source)

        async with self._shutdown_lock:
            if self._end_session_requested:
                already_ending = True
            else:
                self._end_session_requested = True
                self._end_reason = resolved_end_reason
                self._final_goodbye_completed.clear()
                schedule_shutdown = True

        if schedule_shutdown and self._latency_tracker is not None:
            self._latency_tracker.mark_end_session_turn()

        LOGGER.info("%s source=%s end_reason=%s", log_message, source, resolved_end_reason)
        if schedule_shutdown:
            note_pipeline_end_reason(self._task, resolved_end_reason)
            self._shutdown_task = asyncio.create_task(self._perform_shutdown())

        return already_ending

    def handle_bot_stopped_speaking(self) -> None:
        if self._end_session_requested and not self._final_goodbye_completed.is_set():
            self._final_goodbye_completed.set()
            return
        if self._wrap_up_pending and not self._end_session_requested:
            self.mark_wrap_up_active()

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

        await rtvi.send_server_message(
            {
                "type": SESSION_ENDING_SERVER_MESSAGE_TYPE,
                "reason": self._end_reason or "agent_end_session",
            }
        )

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
        await self._task.queue_frame(
            self._end_frame_cls(reason=self._end_reason or "agent_end_session")
        )


class IdleSessionController:
    """Mutual-silence idle: ask at ask-at, end at ending timeout.

    Silence only accumulates while neither the bot nor the user is speaking.
    The watchdog arms after the opening greeting finishes, not at Connect.
    """

    def __init__(
        self,
        modules: dict[str, object],
        termination_controller: SessionTerminationController,
        *,
        enabled: bool,
        check_in_seconds: float,
        end_seconds: float,
        check_in_message: str,
        poll_interval_seconds: float = 0.5,
        check_in_speech_timeout_seconds: float = 20.0,
        monotonic_clock: Any | None = None,
        sleep: Any | None = None,
    ) -> None:
        self._task: object | None = None
        self._tts_speak_frame_cls = modules["TTSSpeakFrame"]
        self._termination_controller = termination_controller
        self._enabled = enabled
        self._check_in_seconds = float(check_in_seconds)
        # Total mutual-silence budget before hangup (not an additional wait).
        self._ending_timeout_seconds = float(end_seconds)
        self._check_in_message = check_in_message.strip() or "Hello, are you there?"
        self._poll_interval_seconds = float(poll_interval_seconds)
        self._check_in_speech_timeout_seconds = float(check_in_speech_timeout_seconds)
        self._monotonic_clock = monotonic_clock or time.monotonic
        self._sleep = sleep or asyncio.sleep
        self._armed = False
        self._finished = False
        self._phase = "pre_check_in"
        self._check_in_sent = False
        self._ignoring_check_in_speech = False
        self._bot_speaking = False
        self._user_speaking = False
        self._silence_elapsed = 0.0
        self._last_silence_tick_at: float | None = None
        self._check_in_started_at: float | None = None
        self._monitor_task: asyncio.Task[None] | None = None

    def attach_task(self, task: object) -> None:
        self._task = task

    @property
    def is_armed(self) -> bool:
        return self._armed

    @property
    def phase(self) -> str:
        return self._phase

    @property
    def silence_elapsed(self) -> float:
        return self._silence_elapsed

    def arm(self) -> None:
        if not self._enabled or self._armed or self._finished:
            return
        self._armed = True
        self._reset_silence_accumulator()
        self._monitor_task = asyncio.create_task(self._monitor())
        LOGGER.info(
            "voice worker: idle watchdog armed ask_at_seconds=%.1f ending_timeout_seconds=%.1f",
            self._check_in_seconds,
            self._ending_timeout_seconds,
        )

    def cancel(self) -> None:
        if self._monitor_task is not None:
            self._monitor_task.cancel()
            self._monitor_task = None
        self._finished = True

    def _reset_silence_accumulator(self) -> None:
        self._silence_elapsed = 0.0
        self._last_silence_tick_at = None

    def _is_mutual_silence(self) -> bool:
        return (
            not self._bot_speaking
            and not self._user_speaking
            and not self._ignoring_check_in_speech
        )

    def _reset_idle_episode(self, *, source: str) -> None:
        if not self._armed or self._finished or self._termination_controller.is_ending:
            return
        self._phase = "pre_check_in"
        self._check_in_sent = False
        self._check_in_started_at = None
        self._ignoring_check_in_speech = False
        self._reset_silence_accumulator()
        LOGGER.debug("voice worker: idle episode reset source=%s", source)

    def handle_bot_started_speaking(self) -> None:
        if not self._armed or self._finished:
            return
        if self._ignoring_check_in_speech:
            self._bot_speaking = True
            return
        self._bot_speaking = True
        self._reset_idle_episode(source="bot-started")

    def handle_bot_stopped_speaking(self) -> None:
        if not self._armed or self._finished:
            return
        self._bot_speaking = False
        if self._ignoring_check_in_speech:
            self._ignoring_check_in_speech = False
            self._phase = "post_check_in"
            self._check_in_started_at = None
            self._last_silence_tick_at = None
            LOGGER.info("voice worker: idle check-in playback finished")
            return
        self._last_silence_tick_at = None

    def handle_user_started_speaking(self) -> None:
        if not self._armed or self._finished:
            return
        self._user_speaking = True
        self._reset_idle_episode(source="user-started")

    def handle_user_stopped_speaking(self) -> None:
        if not self._armed or self._finished:
            return
        self._user_speaking = False
        self._last_silence_tick_at = None

    def _now(self) -> float:
        return float(self._monotonic_clock())

    async def _speak_check_in(self) -> None:
        if self._task is None or self._check_in_sent or self._termination_controller.is_ending:
            return

        self._check_in_sent = True
        self._ignoring_check_in_speech = True
        self._bot_speaking = True
        self._phase = "check_in_speaking"
        self._check_in_started_at = self._now()
        self._last_silence_tick_at = None
        LOGGER.info("voice worker: idle check-in queued text=%r", self._check_in_message)
        await self._task.queue_frame(
            self._tts_speak_frame_cls(
                text=self._check_in_message,
                append_to_context=False,
            )
        )

    async def _monitor(self) -> None:
        try:
            while not self._finished:
                await self._sleep(self._poll_interval_seconds)
                if self._termination_controller.is_ending:
                    self._finished = True
                    return
                if not self._armed:
                    continue

                now = self._now()

                if self._phase == "check_in_speaking":
                    started_at = self._check_in_started_at or now
                    if now - started_at >= self._check_in_speech_timeout_seconds:
                        LOGGER.warning(
                            "voice worker: idle check-in playback timed out; "
                            "continuing toward ending timeout"
                        )
                        self._ignoring_check_in_speech = False
                        self._bot_speaking = False
                        self._phase = "post_check_in"
                        self._check_in_started_at = None
                        self._last_silence_tick_at = None
                    continue

                if not self._is_mutual_silence():
                    self._last_silence_tick_at = None
                    continue

                if self._last_silence_tick_at is None:
                    self._last_silence_tick_at = now
                    continue

                self._silence_elapsed += now - self._last_silence_tick_at
                self._last_silence_tick_at = now

                if self._silence_elapsed >= self._ending_timeout_seconds:
                    self._finished = True
                    await self._termination_controller.request_end_session(
                        source="idle-timeout",
                        log_message=(
                            "voice worker: idle call ending timeout reached "
                            "with no response"
                        ),
                    )
                    return

                if (
                    not self._check_in_sent
                    and self._silence_elapsed >= self._check_in_seconds
                ):
                    await self._speak_check_in()
        except asyncio.CancelledError:
            return


def map_termination_source_to_end_reason(source: str) -> str:
    normalized = source.strip().lower()
    if normalized == "maximum-session-duration":
        return "maximum_session_duration"
    # Idle hangup is an agent-initiated close; surface as agent_end_session
    # so the conversations page shows "Agent ended session" + completed.
    if normalized == "idle-timeout":
        return "agent_end_session"
    if normalized in {
        "llm-tool",
        "deterministic-final-transcript",
        "deterministic-repeat",
        "deterministic-wrap-up-decline",
    }:
        return "agent_end_session"
    if normalized == "client-no-show":
        return "client_no_show"
    if normalized == "client-disconnected":
        return "client_disconnected"
    if normalized.startswith("provider"):
        return "provider_error"
    return "agent_end_session"


def map_cancel_reason_to_end_reason(reason: str | None) -> str | None:
    if not reason or not isinstance(reason, str):
        return None
    normalized = reason.strip().lower()
    if not normalized:
        return None
    if normalized == "client-no-show":
        return "client_no_show"
    if normalized == "client-disconnected":
        return "client_disconnected"
    if normalized in {"user-requested-end-session", "user-requested"}:
        return "agent_end_session"
    if normalized == "maximum-session-duration":
        return "maximum_session_duration"
    if normalized == "idle-timeout":
        return "agent_end_session"
    if normalized.replace("-", "_") in {
        "agent_end_session",
        "maximum_session_duration",
        "idle_timeout",
        "client_no_show",
        "client_disconnected",
        "provider_error",
        "worker_session_end",
    }:
        mapped = normalized.replace("-", "_")
        if mapped == "idle_timeout":
            return "agent_end_session"
        return mapped
    return normalized.replace("-", "_")


def note_pipeline_end_reason(task: object | None, end_reason: str | None) -> None:
    if task is None or not end_reason:
        return
    try:
        setattr(task, "_sleek_relay_end_reason", end_reason)
    except Exception:  # noqa: BLE001
        return


def resolve_worker_session_end_reason(
    *,
    timeline: CallTimelineRecorder | None,
    termination_controller: SessionTerminationController | None,
    task: object | None,
) -> str:
    if timeline is not None and timeline.failure is not None:
        return "provider_error"

    controller_reason = (
        termination_controller.end_reason if termination_controller is not None else None
    )
    if isinstance(controller_reason, str) and controller_reason.strip():
        return controller_reason.strip()

    task_reason = getattr(task, "_sleek_relay_end_reason", None)
    mapped = map_cancel_reason_to_end_reason(
        task_reason if isinstance(task_reason, str) else None
    )
    if mapped:
        return mapped

    return "worker_session_end"

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
        timeline: CallTimelineRecorder | None = None,
        fallback_message: str = DEFAULT_PROVIDER_ERROR_MESSAGE,
        max_attempts: int = DEEPGRAM_STARTUP_MAX_ATTEMPTS,
        backoff_delays: tuple[float, ...] = DEEPGRAM_STARTUP_BACKOFF_SECS,
        jitter_max: float = DEEPGRAM_STARTUP_JITTER_SECS,
    ) -> None:
        self._stt_service = stt_service
        self._latency_tracker = latency_tracker
        self._timeline = timeline
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
                if self._timeline is not None:
                    self._timeline.provider_retry(
                        stage="stt",
                        provider="deepgram",
                        retry_count=self._attempt_count,
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
        error_turn = None
        if self._latency_tracker is not None:
            error_turn = self._latency_tracker.mark_provider_error_turn()
        if self._timeline is not None:
            turn_id = getattr(error_turn, "turn_id", None) if error_turn else None
            self._timeline.session_failed(
                stage="stt",
                error_code="deepgram_startup_exhausted",
                caller_heard=self._fallback_message,
                turn_id=str(turn_id) if turn_id else None,
                provider="deepgram",
                retry_count=max(self._attempt_count, 1),
            )
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


def create_tts_markup_processor(
    modules: dict[str, object],
    *,
    names: tuple[str, ...],
) -> object:
    """Pass LLM tokens through with allowlisted acronym ``<spell>`` markup only."""
    frame_direction_cls = modules["FrameDirection"]
    frame_processor_cls = modules["FrameProcessor"]
    llm_text_frame_cls = modules["LLMTextFrame"]
    tts_speak_frame_cls = modules["TTSSpeakFrame"]
    stream = TtsMarkupStream(names)

    class TtsMarkupProcessor(frame_processor_cls):
        async def process_frame(self, frame: object, direction: object) -> None:
            await super().process_frame(frame, direction)

            if direction is not frame_direction_cls.DOWNSTREAM:
                await self.push_frame(frame, direction)
                return

            if isinstance(frame, llm_text_frame_cls):
                text = getattr(frame, "text", "")
                if not isinstance(text, str):
                    await self.push_frame(frame, direction)
                    return
                piece = stream.feed(text)
                if piece:
                    await self.push_frame(llm_text_frame_cls(piece), direction)
                return

            if isinstance(frame, tts_speak_frame_cls):
                pending = stream.flush()
                if pending:
                    await self.push_frame(llm_text_frame_cls(pending), direction)
                text = getattr(frame, "text", "")
                if isinstance(text, str) and text:
                    marked = apply_allowlisted_tts_markup(text, names)
                    append_to_context = getattr(frame, "append_to_context", True)
                    await self.push_frame(
                        tts_speak_frame_cls(marked, append_to_context=append_to_context),
                        direction,
                    )
                    return
                await self.push_frame(frame, direction)
                return

            pending = stream.flush()
            if pending:
                await self.push_frame(llm_text_frame_cls(pending), direction)

            await self.push_frame(frame, direction)

    return TtsMarkupProcessor(name="TtsMarkupProcessor")


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

                if (
                    termination_controller.is_wrap_up_active
                    and is_wrap_up_decline_request(frame.text)
                ):
                    LOGGER.info(
                        "voice worker: wrap-up decline accepted normalized=%r",
                        normalized_text,
                    )
                    await termination_controller.request_end_session(
                        source="deterministic-wrap-up-decline",
                        log_message="voice worker: wrap-up decline accepted",
                    )
                    return

                if termination_controller.is_wrap_up_active:
                    termination_controller.clear_wrap_up()

                LOGGER.info(
                    "voice worker: deterministic end intent rejected normalized=%r",
                    normalized_text,
                )

            await self.push_frame(frame, direction)

    return DeterministicEndSessionProcessor(name="DeterministicEndSessionProcessor")


def create_vad_user_stop_adapter_processor(modules: dict[str, object]) -> object:
    """Legacy adapter kept for unit coverage only.

    Phase 4 turn ownership uses Flux + ExternalUserTurnStrategies. Silero remains
    on the user aggregator for metrics, so aggregator-generated VAD stop frames
    never flow through this upstream adapter. It is intentionally not wired into
    the live pipeline.
    """
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


def _normalize_spoken_compare_text(text: str) -> str:
    normalized = re.sub(r"[^a-z0-9\s]+", " ", text.casefold())
    return re.sub(r"\s+", " ", normalized).strip()


def looks_like_greeting_echo(transcript: str, greeting: str) -> bool:
    """Return True when a startup transcript is likely greeting loopback."""
    spoken = _normalize_spoken_compare_text(transcript)
    expected = _normalize_spoken_compare_text(greeting)
    if not spoken:
        return True
    if not expected:
        return False
    if spoken == expected:
        return True
    if spoken in expected or expected in spoken:
        return True
    spoken_tokens = set(spoken.split())
    expected_tokens = set(expected.split())
    if not spoken_tokens or not expected_tokens:
        return False
    overlap = len(spoken_tokens & expected_tokens) / len(spoken_tokens)
    return overlap >= 0.8


def create_startup_turn_gate_processor(
    modules: dict[str, object],
    *,
    greeting_barge_in_enabled: bool = False,
    barge_in_grace_secs: float = GREETING_BARGE_IN_GRACE_SECS,
    barge_in_playback_fallback_secs: float = GREETING_BARGE_IN_PLAYBACK_FALLBACK_SECS,
    monotonic_clock: Any = time.monotonic,
) -> object:
    """Block user-turn frames until opening greeting finished and Deepgram is ready.

    Lets the greeting play immediately (no Deepgram wait) without mic-echo / early
    VAD events re-triggering the LLM and repeating the intro.

    When ``greeting_barge_in_enabled`` is true, Flux ``UserStartedSpeakingFrame``
    after the post-start grace window is forwarded so Flux can interrupt TTS, but
    transcription/LLM turns stay closed until greeting audio actually stops
    (``BotStoppedSpeaking`` → ``mark_greeting_playback_done``). Buffered caller
    transcripts are flushed on open; greeting-echo transcripts are dropped.

    Pair with ``create_startup_mic_mute_processor`` before STT so loopback audio is
    not transcribed before barge-in listening is armed.
    """
    frame_direction_cls = modules["FrameDirection"]
    frame_processor_cls = modules["FrameProcessor"]
    interim_transcription_frame_cls = modules["InterimTranscriptionFrame"]
    transcription_frame_cls = modules["TranscriptionFrame"]
    user_started_speaking_frame_cls = modules["UserStartedSpeakingFrame"]
    user_stopped_speaking_frame_cls = modules["UserStoppedSpeakingFrame"]
    vad_user_stopped_speaking_frame_cls = modules["VADUserStoppedSpeakingFrame"]

    speaking_types = (
        user_started_speaking_frame_cls,
        user_stopped_speaking_frame_cls,
        vad_user_stopped_speaking_frame_cls,
    )
    transcription_types = (
        interim_transcription_frame_cls,
        transcription_frame_cls,
    )
    blocked_types = speaking_types + transcription_types

    class StartupTurnGateProcessor(frame_processor_cls):
        def __init__(self) -> None:
            super().__init__(name="StartupTurnGateProcessor")
            self._deepgram_ready = False
            self._greeting_playback_started = False
            self._greeting_playback_started_at: float | None = None
            self._greeting_playback_done = False
            self._greeting_barge_in = False
            self._allow_user_turns = False
            self._blocked_frame_count = 0
            self._greeting_barge_in_enabled = bool(greeting_barge_in_enabled)
            self._barge_in_grace_secs = max(0.0, float(barge_in_grace_secs))
            self._barge_in_playback_fallback_secs = max(
                0.0, float(barge_in_playback_fallback_secs)
            )
            self._monotonic_clock = monotonic_clock
            self._greeting_text = ""
            self._pending_transcriptions: list[tuple[object, object]] = []
            self._barge_in_fallback_handle: asyncio.TimerHandle | None = None
            self._flush_scheduled = False

        @property
        def allow_user_turns(self) -> bool:
            return self._allow_user_turns

        @property
        def greeting_playback_started(self) -> bool:
            return self._greeting_playback_started

        @property
        def greeting_playback_done(self) -> bool:
            return self._greeting_playback_done

        @property
        def greeting_barge_in(self) -> bool:
            return self._greeting_barge_in

        @property
        def greeting_barge_in_enabled(self) -> bool:
            return self._greeting_barge_in_enabled

        def set_greeting_text(self, greeting: str | None) -> None:
            self._greeting_text = (greeting or "").strip()

        def mark_deepgram_ready(self) -> None:
            self._deepgram_ready = True
            self._maybe_open()

        def mark_greeting_playback_started(self) -> None:
            if self._greeting_playback_started or self._greeting_playback_done:
                return
            self._greeting_playback_started = True
            self._greeting_playback_started_at = float(self._monotonic_clock())
            LOGGER.info(
                "voice worker: opening greeting playback started barge_in_enabled=%s grace_secs=%s",
                self._greeting_barge_in_enabled,
                self._barge_in_grace_secs,
            )

        def mark_greeting_playback_done(self) -> None:
            if self._greeting_playback_done:
                return
            self._greeting_playback_done = True
            self._cancel_barge_in_fallback()
            self._maybe_open()

        def mark_greeting_barge_in(self) -> None:
            """Record caller barge-in without opening transcription yet.

            Flux may already have interrupted TTS upstream. LLM/transcript turns
            stay closed until greeting playback actually stops so greeting
            loopback cannot become a user turn while audio is still audible.
            """
            if self._greeting_playback_done or self._greeting_barge_in:
                return
            self._greeting_barge_in = True
            LOGGER.info(
                "voice worker: opening greeting barged in by caller; "
                "waiting for greeting playback to stop before opening turns"
            )
            self._arm_barge_in_playback_fallback()

        def _barge_in_grace_elapsed(self) -> bool:
            if self._greeting_playback_started_at is None:
                return False
            elapsed = float(self._monotonic_clock()) - self._greeting_playback_started_at
            return elapsed >= self._barge_in_grace_secs

        def _cancel_barge_in_fallback(self) -> None:
            handle = self._barge_in_fallback_handle
            self._barge_in_fallback_handle = None
            if handle is not None:
                handle.cancel()

        def _arm_barge_in_playback_fallback(self) -> None:
            if self._greeting_playback_done or self._barge_in_playback_fallback_secs <= 0:
                return
            if self._barge_in_fallback_handle is not None:
                return
            try:
                loop = asyncio.get_running_loop()
            except RuntimeError:
                return

            def _fallback() -> None:
                self._barge_in_fallback_handle = None
                if self._greeting_playback_done:
                    return
                LOGGER.warning(
                    "voice worker: greeting barge-in playback fallback "
                    "opening gate without BotStoppedSpeaking after %.2fs",
                    self._barge_in_playback_fallback_secs,
                )
                self.mark_greeting_playback_done()

            self._barge_in_fallback_handle = loop.call_later(
                self._barge_in_playback_fallback_secs,
                _fallback,
            )

        def _schedule_pending_flush(self) -> None:
            if self._flush_scheduled or not self._pending_transcriptions:
                return
            try:
                loop = asyncio.get_running_loop()
            except RuntimeError:
                return
            self._flush_scheduled = True
            loop.create_task(self._flush_pending_transcriptions())

        async def _flush_pending_transcriptions(self) -> None:
            pending = self._pending_transcriptions
            self._pending_transcriptions = []
            self._flush_scheduled = False
            dropped = 0
            for frame, direction in pending:
                text = str(getattr(frame, "text", "") or "")
                if looks_like_greeting_echo(text, self._greeting_text):
                    dropped += 1
                    continue
                await self.push_frame(frame, direction)
            if dropped:
                LOGGER.info(
                    "voice worker: dropped %s greeting-echo transcript frame(s) at gate open",
                    dropped,
                )

        def _maybe_open(self) -> None:
            if self._allow_user_turns:
                return
            if self._deepgram_ready and self._greeting_playback_done:
                self._allow_user_turns = True
                LOGGER.info(
                    "voice worker: startup turn gate opened blocked_frames=%s barge_in=%s",
                    self._blocked_frame_count,
                    self._greeting_barge_in,
                )
                self._schedule_pending_flush()

        async def process_frame(self, frame: object, direction: object) -> None:
            await super().process_frame(frame, direction)

            if (
                direction is frame_direction_cls.DOWNSTREAM
                and self._greeting_barge_in_enabled
                and not self._greeting_playback_done
                and self._greeting_playback_started
                and self._barge_in_grace_elapsed()
                and isinstance(frame, user_started_speaking_frame_cls)
            ):
                self.mark_greeting_barge_in()
                await self.push_frame(frame, direction)
                return

            if (
                direction is frame_direction_cls.DOWNSTREAM
                and not self._allow_user_turns
                and isinstance(frame, blocked_types)
            ):
                # After barge-in, keep speaking lifecycle frames flowing so the
                # aggregator tracks the interrupter, but hold transcripts until
                # greeting audio has stopped and Deepgram is ready.
                if self._greeting_barge_in and isinstance(frame, speaking_types):
                    await self.push_frame(frame, direction)
                    return
                if self._greeting_barge_in and isinstance(frame, transcription_types):
                    self._pending_transcriptions.append((frame, direction))
                    self._blocked_frame_count += 1
                    return
                self._blocked_frame_count += 1
                return

            await self.push_frame(frame, direction)

    return StartupTurnGateProcessor()


def create_startup_mic_mute_processor(
    modules: dict[str, object],
    startup_turn_gate: object,
) -> object:
    """Drop mic audio into STT until greeting listening is armed.

    StartupTurnGate blocks echo from reaching the LLM, but RTVI still observes
    TranscriptionFrames emitted by STT. Muting InputAudioRawFrame before STT
    prevents greeting loopback from appearing as repeated user transcripts.

    When greeting barge-in is enabled, mic audio is restored after greeting TTS
    has started and the grace window elapsed. Otherwise mic audio waits until
    greeting playback completes. The turn gate may still wait on Deepgram before
    allowing LLM turns.
    """
    frame_direction_cls = modules["FrameDirection"]
    frame_processor_cls = modules["FrameProcessor"]
    input_audio_raw_frame_cls = modules["InputAudioRawFrame"]

    class StartupMicMuteProcessor(frame_processor_cls):
        def __init__(self) -> None:
            super().__init__(name="StartupMicMuteProcessor")
            self._startup_turn_gate = startup_turn_gate
            self._muted_frame_count = 0
            self._logged_unmute = False

        def _mic_audio_allowed(self) -> bool:
            if bool(getattr(self._startup_turn_gate, "greeting_playback_done", False)):
                return True

            barge_in_enabled = bool(
                getattr(self._startup_turn_gate, "greeting_barge_in_enabled", False)
            )
            if not barge_in_enabled:
                return False

            if not bool(getattr(self._startup_turn_gate, "greeting_playback_started", False)):
                return False

            grace_elapsed = getattr(self._startup_turn_gate, "_barge_in_grace_elapsed", None)
            if callable(grace_elapsed):
                return bool(grace_elapsed())
            # Missing grace helper: keep muted rather than open early.
            return False

        async def process_frame(self, frame: object, direction: object) -> None:
            await super().process_frame(frame, direction)

            allow_mic_audio = self._mic_audio_allowed()
            if (
                direction is frame_direction_cls.DOWNSTREAM
                and not allow_mic_audio
                and isinstance(frame, input_audio_raw_frame_cls)
            ):
                self._muted_frame_count += 1
                return

            if allow_mic_audio and not self._logged_unmute and self._muted_frame_count:
                self._logged_unmute = True
                LOGGER.info(
                    "voice worker: startup mic mute opened muted_frames=%s",
                    self._muted_frame_count,
                )

            await self.push_frame(frame, direction)

    return StartupMicMuteProcessor()


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
    usage_metrics: UsageMetricsAccumulator,
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
    metrics_frame_cls = modules.get("MetricsFrame")
    transcription_frame_cls = modules["TranscriptionFrame"]
    tts_audio_raw_frame_cls = modules["TTSAudioRawFrame"]
    tts_started_frame_cls = modules["TTSStartedFrame"]
    user_started_speaking_frame_cls = modules["UserStartedSpeakingFrame"]
    user_stopped_speaking_frame_cls = modules["UserStoppedSpeakingFrame"]
    vad_user_stopped_speaking_frame_cls = modules.get("VADUserStoppedSpeakingFrame")
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
            ):
                usage_metrics.observe_input_audio(frame)
                if not self._logged_first_audio:
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
            elif (
                vad_user_stopped_speaking_frame_cls is not None
                and isinstance(frame, vad_user_stopped_speaking_frame_cls)
            ):
                latency_tracker.handle_vad_user_stopped_speaking()
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
            elif (
                metrics_frame_cls is not None and isinstance(frame, metrics_frame_cls)
            ) or type(frame).__name__ == "MetricsFrame":
                usage_metrics.observe_metrics_frame(frame)

    return VoiceDiagnosticsObserver()


def build_deepgram_flux_settings_kwargs(config: object) -> dict[str, object]:
    return {
        "model": config.deepgram_model,
    }


def build_user_turn_detection(modules: dict[str, object]) -> tuple[object, object]:
    """Configure Flux as conversational turn owner; keep Silero for metrics.

    Deepgram Flux emits UserStartedSpeakingFrame / UserStoppedSpeakingFrame and
    Pipecat's ExternalUserTurnStrategies defer turn ownership to that path.
    Silero remains attached on the user aggregator for physical speech-stop
    timing metrics only — it does not own conversational start/stop.
    """
    external_user_turn_strategies_cls = modules["ExternalUserTurnStrategies"]
    silero_vad_analyzer_cls = modules["SileroVADAnalyzer"]
    vad_params_cls = modules["VADParams"]

    return (
        external_user_turn_strategies_cls(),
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
    mapped_reason = map_cancel_reason_to_end_reason(reason)
    if mapped_reason:
        note_pipeline_end_reason(task, mapped_reason)

    cancel = getattr(task, "cancel", None)
    if not callable(cancel):
        return

    result = cancel(reason=reason)
    if asyncio.iscoroutine(result):
        await result


def apply_agent_behavior_templates(
    text: str,
    *,
    business_name: str | None = None,
    agent_name: str | None = None,
    caller_name: str | None = None,
) -> str:
    if not text:
        return ""

    replacements = {
        "{Business Name}": (business_name or "").strip(),
        "{Agent Name}": (agent_name or "").strip(),
        "{Caller Name}": (caller_name or "").strip(),
    }
    next_text = text
    for token, value in replacements.items():
        next_text = next_text.replace(token, value)

    next_text = re.sub(r"[ \t]{2,}", " ", next_text)
    next_text = re.sub(r" +\n", "\n", next_text)
    next_text = re.sub(r"\n +", "\n", next_text)
    next_text = re.sub(r" +([,.;!?])", r"\1", next_text)
    return next_text


def ensure_terminal_punctuation(text: str) -> str:
    """Ensure spoken greeting text ends with ., ?, or ! for natural TTS cadence."""
    trimmed = text.strip()
    if not trimmed:
        return trimmed
    if trimmed[-1] in ".?!":
        return trimmed
    return f"{trimmed}."


def describe_cartesia_tts_baseline(model: str | None) -> str:
    return "sonic-3.5-humanization" if is_sonic_3_5_model(model) else "legacy-overrides"


def log_humanization_session_baseline(
    *,
    cartesia_model: str | None,
    voice_id: str | None,
    interruption_enabled: bool,
    silence_timeout_seconds: float | int | None,
    greeting_barge_in_enabled: bool,
    source: str | None = None,
) -> None:
    """Log safe, secret-free experiment metadata for listening A/B comparisons."""
    sonic_baseline = is_sonic_3_5_model(cartesia_model)
    LOGGER.info(
        "voice worker: humanization_baseline "
        "source=%s cartesia_model=%s voice_id=%s aggregation=TOKEN "
        "buffer_mode=%s generation_overrides=%s turn_owner=flux_external "
        "interruption_enabled=%s greeting_barge_in_enabled=%s "
        "silence_timeout_seconds=%s llm_temperature=%s pipecat=1.7.0",
        source or "unknown",
        cartesia_model or "",
        voice_id or "",
        "cartesia_managed" if sonic_baseline else f"max_buffer_delay_ms={CARTESIA_MAX_BUFFER_DELAY_MS}",
        "none" if sonic_baseline else "emotion+speed+volume",
        bool(interruption_enabled),
        bool(greeting_barge_in_enabled),
        silence_timeout_seconds,
        LLM_RESPONSE_TEMPERATURE,
    )


def resolve_opening_greeting(runtime_config: VoiceSessionRuntimeConfig) -> str:
    greeting = apply_agent_behavior_templates(
        runtime_config.agent.greeting,
        business_name=getattr(getattr(runtime_config, "business", None), "businessName", None),
        agent_name=getattr(runtime_config.agent, "name", None),
    ).strip()
    if greeting:
        return ensure_terminal_punctuation(greeting)

    return LOCAL_FALLBACK_GREETING


def resolve_cartesia_emotion_for_tone(tone: str | None) -> str:
    """Map configured agent tone labels to a Cartesia emotion guidance value.

    Used only for legacy (non-Sonic-3.5) TTS construction. Sonic 3.5 baseline
    omits emotion overrides; tone remains an LLM persona instruction.
    """
    parts = [part.strip().lower() for part in (tone or "").split(",") if part.strip()]
    for part in parts:
        emotion = _CARTESIA_EMOTION_BY_TONE.get(part)
        if emotion:
            return emotion
    return CARTESIA_DEFAULT_EMOTION


def is_sonic_3_5_model(model: str | None) -> bool:
    """Return True for sonic-3.5 aliases and dated Sonic 3.5 snapshots."""
    normalized = (model or "").strip().lower()
    return normalized == "sonic-3.5" or normalized.startswith("sonic-3.5-")


def build_cartesia_tts_kwargs(
    *,
    cartesia_tts_service_cls: object,
    cartesia_generation_config_cls: object,
    text_aggregation_mode_cls: object,
    api_key: str,
    model: str,
    voice_id: str,
    language: str,
    tone: str | None,
) -> dict[str, object]:
    """Build CartesiaTTSService constructor kwargs for the active model baseline.

    Sonic 3.5: TOKEN mode with Cartesia managed buffering; no global emotion,
    speed, or volume overrides.
    Legacy models: preserve prior emotion/speed/volume and 1000 ms buffer cap.
    """
    settings_kwargs: dict[str, object] = {
        "model": model,
        "voice": voice_id,
        "language": language,
    }
    service_kwargs: dict[str, object] = {
        "api_key": api_key,
        "text_aggregation_mode": text_aggregation_mode_cls.TOKEN,
    }

    if is_sonic_3_5_model(model):
        service_kwargs["settings"] = cartesia_tts_service_cls.Settings(**settings_kwargs)
        LOGGER.info(
            "voice worker: cartesia tts baseline=sonic-3.5-humanization "
            "model=%s voice_id=%s language=%s aggregation=TOKEN "
            "max_buffer_delay_ms=unset generation_config=unset",
            model,
            voice_id,
            language,
        )
        return service_kwargs

    settings_kwargs["generation_config"] = cartesia_generation_config_cls(
        emotion=resolve_cartesia_emotion_for_tone(tone),
        speed=CARTESIA_DEFAULT_SPEED,
        volume=CARTESIA_DEFAULT_VOLUME,
    )
    service_kwargs["max_buffer_delay_ms"] = CARTESIA_MAX_BUFFER_DELAY_MS
    service_kwargs["settings"] = cartesia_tts_service_cls.Settings(**settings_kwargs)
    LOGGER.info(
        "voice worker: cartesia tts baseline=legacy-overrides "
        "model=%s voice_id=%s language=%s aggregation=TOKEN "
        "max_buffer_delay_ms=%s emotion=%s speed=%s volume=%s",
        model,
        voice_id,
        language,
        CARTESIA_MAX_BUFFER_DELAY_MS,
        resolve_cartesia_emotion_for_tone(tone),
        CARTESIA_DEFAULT_SPEED,
        CARTESIA_DEFAULT_VOLUME,
    )
    return service_kwargs


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
        *,
        startup_turn_gate: object | None = None,
        timeline: CallTimelineRecorder | None = None,
    ) -> None:
        self._client_connected = False
        self._greeting_queued = False
        self._greeting_playback_started = False
        self._greeting_playback_done = False
        self._modules = modules
        self._pipeline_started = False
        # Wait for RTVI client-ready before speaking. Queuing TTSSpeakFrame on
        # Daily connect alone races the client protocol handshake; early
        # BotOutput events are parsed as legacy and the greeting is split into
        # many duplicate transcript messages.
        self._rtvi_client_ready = False
        # Daily pre-join can make the browser a room participant (and RTVI-ready)
        # before Connect. Require an explicit arm so the greeting waits for intent.
        self._session_armed = False
        self._runtime_config = runtime_config
        self._startup_turn_gate = startup_turn_gate
        self._timeline = timeline
        self._task = task
        self._lock = asyncio.Lock()

    @property
    def client_connected(self) -> bool:
        return self._client_connected

    @property
    def session_armed(self) -> bool:
        return self._session_armed

    @property
    def greeting_playback_started(self) -> bool:
        return self._greeting_playback_started

    @property
    def greeting_playback_done(self) -> bool:
        return self._greeting_playback_done

    async def handle_client_connected(self) -> None:
        self._client_connected = True
        if self._timeline is not None:
            self._timeline.session_started()
        await self._maybe_queue_greeting()

    async def handle_pipeline_started(self) -> None:
        self._pipeline_started = True
        await self._maybe_queue_greeting()

    async def handle_rtvi_client_ready(self) -> None:
        self._rtvi_client_ready = True
        await self._maybe_queue_greeting()

    async def handle_session_armed(self) -> None:
        self._session_armed = True
        await self._maybe_queue_greeting()

    def handle_greeting_playback_started(self) -> None:
        """First BotStartedSpeaking after the queued greeting arms barge-in listening."""
        if not self._greeting_queued or self._greeting_playback_started or self._greeting_playback_done:
            return
        self._greeting_playback_started = True
        mark_started = getattr(self._startup_turn_gate, "mark_greeting_playback_started", None)
        if callable(mark_started):
            mark_started()

    def handle_greeting_playback_finished(self) -> None:
        """First BotStoppedSpeaking after the queued greeting opens the turn gate."""
        if not self._greeting_queued or self._greeting_playback_done:
            return
        self._greeting_playback_done = True
        mark_done = getattr(self._startup_turn_gate, "mark_greeting_playback_done", None)
        if callable(mark_done):
            mark_done()
        if self._timeline is not None:
            self._timeline.greeting_played(provider="cartesia")
        LOGGER.info("voice worker: opening greeting playback finished")

    async def _maybe_queue_greeting(self) -> None:
        async with self._lock:
            if self._greeting_queued:
                return

            if (
                not self._client_connected
                or not self._pipeline_started
                or not self._rtvi_client_ready
                or not self._session_armed
            ):
                return

            # Claim the slot before awaiting so concurrent Daily/client events
            # cannot enqueue duplicate greetings.
            self._greeting_queued = True

        greeting = resolve_opening_greeting(self._runtime_config)
        set_greeting_text = getattr(self._startup_turn_gate, "set_greeting_text", None)
        if callable(set_greeting_text):
            set_greeting_text(greeting)

        await queue_opening_greeting(
            self._task,
            self._modules,
            self._runtime_config,
        )


def resolve_client_no_show_timeout_secs() -> float:
    raw = os.environ.get("VOICE_CLIENT_NO_SHOW_TIMEOUT_SECS", "").strip()
    if not raw:
        return DEFAULT_CLIENT_NO_SHOW_TIMEOUT_SECS
    try:
        value = float(raw)
    except ValueError:
        return DEFAULT_CLIENT_NO_SHOW_TIMEOUT_SECS
    if value <= 0:
        return DEFAULT_CLIENT_NO_SHOW_TIMEOUT_SECS
    return value


async def enforce_client_no_show_timeout(
    task: object,
    *,
    timeout_secs: float,
    client_connected: Any,
) -> None:
    """Cancel a (pre)started session whose client never joined the room."""
    await asyncio.sleep(timeout_secs)
    if client_connected():
        return
    LOGGER.warning(
        "voice worker: no client joined within %.0fs; cancelling session (client no-show)",
        timeout_secs,
    )
    await cancel_pipeline_task(task, reason="client-no-show")


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
    timeline: CallTimelineRecorder | None = None,
) -> object:
    runtime_config = runtime_config or build_runtime_config(config)
    startup_timing_tracker = startup_timing_tracker or VoiceStartupTimingTracker()
    timeline = timeline or CallTimelineRecorder()
    llm_context_cls = modules["LLMContext"]
    llm_context_aggregator_pair_cls = modules["LLMContextAggregatorPair"]
    llm_user_aggregator_params_cls = modules["LLMUserAggregatorParams"]
    pipeline_cls = modules["Pipeline"]
    pipeline_params_cls = modules["PipelineParams"]
    pipeline_task_cls = modules["PipelineTask"]
    deepgram_flux_stt_service_cls = modules["DeepgramFluxSTTService"]
    google_llm_service_cls = modules["GoogleLLMService"]
    cartesia_tts_service_cls = modules["CartesiaTTSService"]
    cartesia_generation_config_cls = modules["CartesiaGenerationConfig"]
    text_aggregation_mode_cls = modules["TextAggregationMode"]
    latency_tracker = VoiceTurnLatencyTracker()
    termination_controller = SessionTerminationController(
        modules,
        latency_tracker=latency_tracker,
    )
    deepgram_startup_controller: DeepgramStartupController | None = None
    end_session_tool = build_end_session_tool_schema(modules, termination_controller)
    capture_controller = CaptureToolController(
        modules,
        conversation_id=getattr(runtime_config, "conversation_id", None),
        portal_base_url=getattr(runtime_config, "portalBaseUrl", None),
        session_token=getattr(runtime_config, "sessionToken", None),
        timeline=timeline,
        latency_tracker=latency_tracker,
        on_capture_success=termination_controller.mark_wrap_up_pending,
    )
    idle_controller = IdleSessionController(
        modules,
        termination_controller,
        enabled=bool(getattr(runtime_config.agent, "idleTimeoutEnabled", True)),
        check_in_seconds=float(
            getattr(runtime_config.agent, "idleCheckInSeconds", 30)
        ),
        end_seconds=float(getattr(runtime_config.agent, "idleEndSeconds", 30)),
        check_in_message=str(
            getattr(
                runtime_config.agent,
                "idleCheckInMessage",
                "Hello, are you there?",
            )
        ),
    )
    capture_tools = build_capture_tool_schemas(
        modules,
        capture_controller,
        getattr(runtime_config, "enabledTools", ("end_session",)),
        lead_fields=getattr(runtime_config, "leadFields", None),
        message_fields=getattr(runtime_config, "messageFields", None),
        appointment_fields=getattr(runtime_config, "appointmentFields", None),
    )
    llm_tools = [*capture_tools, end_session_tool]

    LOGGER.info("voice worker: constructing provider services")

    interruption_enabled = bool(
        getattr(runtime_config.agent, "interruptionEnabled", True)
    )
    stt = deepgram_flux_stt_service_cls(
        api_key=config.deepgram_api_key,
        sample_rate=DEEPGRAM_BROWSER_SAMPLE_RATE,
        should_interrupt=interruption_enabled,
        settings=deepgram_flux_stt_service_cls.Settings(
            **build_deepgram_flux_settings_kwargs(config)
        ),
    )
    LOGGER.info(
        "voice worker: deepgram flux turn_owner=external "
        "should_interrupt=%s silence_timeout_seconds=%s",
        interruption_enabled,
        runtime_config.agent.silenceTimeoutSeconds,
    )
    startup_timing_tracker.mark_stt_created()
    deepgram_startup_controller = DeepgramStartupController(
        stt,
        latency_tracker=latency_tracker,
        timeline=timeline,
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
            temperature=LLM_RESPONSE_TEMPERATURE,
        ),
    )
    startup_timing_tracker.mark_llm_created()
    tts = cartesia_tts_service_cls(
        **build_cartesia_tts_kwargs(
            cartesia_tts_service_cls=cartesia_tts_service_cls,
            cartesia_generation_config_cls=cartesia_generation_config_cls,
            text_aggregation_mode_cls=text_aggregation_mode_cls,
            api_key=config.cartesia_api_key,
            model=config.cartesia_model,
            voice_id=runtime_config.agent.voiceId,
            language=runtime_config.ttsLanguage,
            tone=runtime_config.agent.tone,
        )
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
    greeting_barge_in_enabled = bool(
        getattr(runtime_config.agent, "interruptionEnabled", True)
    )
    startup_turn_gate_processor = create_startup_turn_gate_processor(
        modules,
        greeting_barge_in_enabled=greeting_barge_in_enabled,
    )
    startup_mic_mute_processor = create_startup_mic_mute_processor(
        modules,
        startup_turn_gate_processor,
    )
    LOGGER.info(
        "voice worker: greeting barge_in_enabled=%s grace_secs=%s",
        greeting_barge_in_enabled,
        GREETING_BARGE_IN_GRACE_SECS,
    )
    tts_name_allowlist = build_tts_name_allowlist(
        business_name=getattr(getattr(runtime_config, "business", None), "businessName", None),
        agent_name=getattr(runtime_config.agent, "name", None),
    )
    tts_markup_processor = create_tts_markup_processor(
        modules,
        names=tts_name_allowlist,
    )

    context = llm_context_cls(tools=llm_tools)
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
        ("startup_mic_mute", startup_mic_mute_processor),
        ("stt", stt),
        ("deterministic_end_session", deterministic_end_session_processor),
        ("startup_turn_gate", startup_turn_gate_processor),
        ("user_aggregator", user_aggregator),
        ("llm", llm),
        ("tts_markup", tts_markup_processor),
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
            startup_mic_mute_processor,
            stt,
            deterministic_end_session_processor,
            startup_turn_gate_processor,
            user_aggregator,
            llm,
            tts_markup_processor,
            tts,
            transport_output,
            assistant_aggregator,
        ]
    )
    startup_timing_tracker.mark_pipeline_constructed()
    usage_metrics = UsageMetricsAccumulator()
    task = pipeline_task_cls(
        pipeline,
        observers=[
            _build_diagnostics_observer(
                modules,
                latency_tracker,
                startup_timing_tracker,
                usage_metrics,
            )
        ],
        params=pipeline_params_cls(
            enable_metrics=True,
            enable_usage_metrics=True,
        ),
    )
    startup_timing_tracker.mark_task_constructed()
    termination_controller.attach_task(task)
    idle_controller.attach_task(task)
    deepgram_startup_controller.attach_task(task)
    task._sleek_relay_latency_tracker = latency_tracker
    task._sleek_relay_llm_context = context
    task._sleek_relay_runtime_config = runtime_config
    task._sleek_relay_startup_timing_tracker = startup_timing_tracker
    task._sleek_relay_stt = stt
    task._sleek_relay_tts = tts
    task._sleek_relay_deepgram_startup_controller = deepgram_startup_controller
    task._sleek_relay_termination_controller = termination_controller
    task._sleek_relay_idle_controller = idle_controller
    task._sleek_relay_startup_turn_gate = startup_turn_gate_processor
    task._sleek_relay_timeline = timeline
    task._sleek_relay_usage_metrics = usage_metrics
    return task


async def run_bot(
    transport: object,
    *,
    config: object | None = None,
    runtime_package: Mapping[str, object] | None = None,
    runtime_config: VoiceSessionRuntimeConfig | None = None,
    startup_timing_tracker: VoiceStartupTimingTracker | None = None,
) -> tuple[
    object | None,
    VoiceTurnLatencyTracker | None,
    CallTimelineRecorder | None,
    UsageMetricsAccumulator | None,
    str | None,
]:
    """Run the voice pipeline and return context, trackers, timeline, and end reason.

    Returns the ``LLMContext``, ``VoiceTurnLatencyTracker``,
    ``CallTimelineRecorder``, ``UsageMetricsAccumulator``, and resolved session
    ``end_reason`` so callers can persist transcript, diagnostics, and provider usage.
    Returns ``(None, None, None, None, None)`` on early exit.
    """
    config = config or load_config()
    runtime_config = runtime_config or build_runtime_config(
        config,
        runtime_package=runtime_package,
    )
    startup_timing_tracker = startup_timing_tracker or VoiceStartupTimingTracker()
    startup_timing_tracker.mark_runtime_config_loaded()
    timeline = CallTimelineRecorder()
    modules = _import_pipecat_dependencies()
    bot_started_speaking_frame_cls = modules["BotStartedSpeakingFrame"]
    bot_stopped_speaking_frame_cls = modules["BotStoppedSpeakingFrame"]
    user_started_speaking_frame_cls = modules["UserStartedSpeakingFrame"]
    user_stopped_speaking_frame_cls = modules["UserStoppedSpeakingFrame"]
    error_frame_cls = modules["ErrorFrame"]
    pipeline_runner_cls = modules["PipelineRunner"]

    task = build_pipeline_task(
        transport,
        modules,
        config,
        runtime_config,
        startup_timing_tracker=startup_timing_tracker,
        timeline=timeline,
    )
    deepgram_startup_controller = getattr(task, "_sleek_relay_deepgram_startup_controller")
    startup_turn_gate = getattr(task, "_sleek_relay_startup_turn_gate", None)
    greeting_controller = OpeningGreetingController(
        task,
        modules,
        runtime_config,
        startup_turn_gate=startup_turn_gate,
        timeline=timeline,
    )
    latency_tracker = getattr(task, "_sleek_relay_latency_tracker")
    llm_context = getattr(task, "_sleek_relay_llm_context", None)
    usage_metrics = getattr(task, "_sleek_relay_usage_metrics", None)
    stt = getattr(task, "_sleek_relay_stt")
    tts = getattr(task, "_sleek_relay_tts")
    termination_controller = getattr(task, "_sleek_relay_termination_controller")
    idle_controller = getattr(task, "_sleek_relay_idle_controller")
    task.add_reached_downstream_filter(
        (
            bot_started_speaking_frame_cls,
            bot_stopped_speaking_frame_cls,
            user_started_speaking_frame_cls,
            user_stopped_speaking_frame_cls,
        )
    )
    duration_task: asyncio.Task[None] | None = None
    no_show_task: asyncio.Task[None] | None = None
    preconnect_task: asyncio.Task[None] | None = None

    LOGGER.info(
        "voice worker: runtime configuration ready source=%s tenant_id=%s agent_id=%s language=%s voice_id=%s",
        runtime_config.source,
        runtime_config.tenant.id,
        runtime_config.agent.id,
        runtime_config.agent.language,
        runtime_config.agent.voiceId,
    )
    log_humanization_session_baseline(
        cartesia_model=getattr(config, "cartesia_model", None),
        voice_id=runtime_config.agent.voiceId,
        interruption_enabled=bool(runtime_config.agent.interruptionEnabled),
        silence_timeout_seconds=runtime_config.agent.silenceTimeoutSeconds,
        greeting_barge_in_enabled=bool(
            getattr(startup_turn_gate, "greeting_barge_in_enabled", False)
        ),
        source=runtime_config.source,
    )

    @stt.event_handler("on_connected")
    async def on_stt_connected(service: object) -> None:
        deepgram_startup_controller.handle_connected()
        startup_timing_tracker.mark_deepgram_connect_completed()
        mark_ready = getattr(startup_turn_gate, "mark_deepgram_ready", None)
        if callable(mark_ready):
            mark_ready()

    @stt.event_handler("on_connection_error")
    async def on_stt_connection_error(service: object, error: str) -> None:
        await deepgram_startup_controller.handle_connection_error(
            error,
            source="stt-event",
        )

    @transport.event_handler("on_client_connected")
    async def on_client_connected(transport_instance: object, client: object) -> None:
        nonlocal no_show_task
        LOGGER.info("WebRTC client connected: %s", client)
        if no_show_task is not None:
            no_show_task.cancel()
            no_show_task = None
        await greeting_controller.handle_client_connected()
        # Max-session duration starts on session_armed (Connect), not on Daily
        # pre-join, so idle drawer time does not burn the session budget.

    rtvi = getattr(task, "rtvi", None)
    if rtvi is not None:
        @rtvi.event_handler("on_client_ready")
        async def on_rtvi_client_ready(rtvi_processor: object) -> None:
            set_bot_ready = getattr(rtvi_processor, "set_bot_ready", None)
            if callable(set_bot_ready):
                await set_bot_ready()
            LOGGER.info(
                "voice worker: RTVI client ready; waiting for session arm before greeting"
            )
            await greeting_controller.handle_rtvi_client_ready()

        @rtvi.event_handler("on_client_message")
        async def on_rtvi_client_message(rtvi_processor: object, message: object) -> None:
            nonlocal duration_task
            message_type = getattr(message, "type", None)
            if message_type != SESSION_ARMED_CLIENT_MESSAGE_TYPE:
                return

            LOGGER.info("voice worker: session armed by client; opening greeting may proceed")
            await greeting_controller.handle_session_armed()
            if (
                duration_task is None
                and runtime_config.agent.maximumSessionDurationSeconds is not None
            ):
                duration_task = asyncio.create_task(
                    enforce_maximum_session_duration(
                        termination_controller,
                        runtime_config,
                    )
                )

    @transport.event_handler("on_client_disconnected")
    async def on_client_disconnected(transport_instance: object, client: object) -> None:
        nonlocal duration_task
        LOGGER.info("WebRTC client disconnected: %s", client)
        if duration_task is not None:
            duration_task.cancel()
            duration_task = None
        idle_controller.cancel()
        await deepgram_startup_controller.handle_client_disconnected()
        await cancel_pipeline_task(task, reason="client-disconnected")

    @task.event_handler("on_frame_reached_downstream")
    async def on_frame_reached_downstream(worker: object, frame: object) -> None:
        if isinstance(frame, user_started_speaking_frame_cls):
            idle_controller.handle_user_started_speaking()
            return
        if isinstance(frame, user_stopped_speaking_frame_cls):
            idle_controller.handle_user_stopped_speaking()
            return
        if isinstance(frame, bot_started_speaking_frame_cls):
            greeting_controller.handle_greeting_playback_started()
            idle_controller.handle_bot_started_speaking()
            return
        if isinstance(frame, bot_stopped_speaking_frame_cls):
            was_greeting_done = greeting_controller.greeting_playback_done
            greeting_controller.handle_greeting_playback_finished()
            if (
                not was_greeting_done
                and greeting_controller.greeting_playback_done
                and not idle_controller.is_armed
            ):
                idle_controller.arm()
            termination_controller.handle_bot_stopped_speaking()
            idle_controller.handle_bot_stopped_speaking()

    @task.event_handler("on_pipeline_error")
    async def on_pipeline_error(worker: object, frame: object) -> None:
        if isinstance(frame, error_frame_cls) and getattr(frame, "processor", None) is stt:
            await deepgram_startup_controller.handle_connection_error(
                frame.error,
                source="pipeline-error",
            )
            if not is_deepgram_handshake_error_message(frame.error):
                error_turn = latency_tracker.mark_provider_error_turn()
                if timeline.failure is None:
                    turn_id = getattr(error_turn, "turn_id", None) if error_turn else None
                    timeline.session_failed(
                        stage="stt",
                        error_code="deepgram_pipeline_error",
                        caller_heard=runtime_config.agent.fallbackMessage,
                        turn_id=str(turn_id) if turn_id else None,
                        provider="deepgram",
                    )

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
    no_show_task = asyncio.create_task(
        enforce_client_no_show_timeout(
            task,
            timeout_secs=resolve_client_no_show_timeout_secs(),
            client_connected=lambda: greeting_controller.client_connected,
        ),
        name="client-no-show-guard",
    )
    LOGGER.info("voice worker: starting PipelineRunner task")
    startup_timing_tracker.mark_pipeline_run_started()
    await runner.run(task)
    if no_show_task is not None:
        no_show_task.cancel()
        no_show_task = None
    if duration_task is not None:
        duration_task.cancel()
    idle_controller.cancel()
    if preconnect_task is not None:
        await preconnect_task
    await deepgram_startup_controller.wait_for_retry_completion()
    await termination_controller.wait_for_shutdown()
    end_reason = resolve_worker_session_end_reason(
        timeline=timeline,
        termination_controller=termination_controller,
        task=task,
    )
    timeline.session_ended(end_reason=end_reason)
    LOGGER.info(
        "voice worker: transport disconnected end_reason=%s",
        end_reason,
    )
    LOGGER.info("voice worker: cleanup completed")
    LOGGER.info("voice worker: PipelineRunner task exited")
    return llm_context, latency_tracker, timeline, usage_metrics, end_reason


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

    llm_context, latency_tracker, timeline, usage_metrics, end_reason = await run_bot(
        transport,
        config=config,
        runtime_config=runtime_config,
        startup_timing_tracker=startup_timing_tracker,
    )

    # Best-effort: persist the completed transcript and latency metrics to Supabase.
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
            timeline=timeline,
            end_reason=end_reason or "worker_session_end",
            usage_metrics=usage_metrics,
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
