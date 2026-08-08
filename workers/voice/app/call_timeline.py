"""Session call-timeline recorder and latency_metrics v2 builders.

Produces the operator-facing diagnostics blob persisted on
``conversations.latency_metrics``:

* flat aggregate averages (backward compatible with the portal)
* ``session_events`` — thin rails (start / greeting / fail / end)
* ``turns`` — per-turn metrics linked to transcript sequence numbers
* ``failure`` — failed stage summary for list badges + drawer banner
* richer ``aggregates`` — median / p95 / fastest / slowest response latency
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any


FAILURE_STAGES = frozenset(
    {"connect", "stt", "llm", "tts", "tool", "persist", "unknown"}
)

SESSION_EVENT_TYPES = frozenset(
    {
        "session_started",
        "greeting_played",
        "provider_retry",
        "session_failed",
        "session_ended",
    }
)

# Responses slower than this count toward the "slow responses" aggregate.
SLOW_RESPONSE_THRESHOLD_MS = 1800

TOOL_STAGE_LABELS = {
    "capture_lead": "Lead capture tool",
    "capture_message": "Message capture tool",
    "create_appointment_request": "Appointment tool",
    "offer_human_handoff": "Handoff tool",
}


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _positive_int(value: object) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int) and value >= 0:
        return value
    if isinstance(value, float) and value >= 0 and value == int(value):
        return int(value)
    return None


def _positive_latency_ms(value: object) -> int | None:
    """Omit manufactured 0 ms latency gaps."""
    parsed = _positive_int(value)
    if parsed is None or parsed <= 0:
        return None
    return parsed


def _percentile_nearest_rank(sorted_values: list[int], percentile: float) -> int:
    if not sorted_values:
        return 0
    if len(sorted_values) == 1:
        return sorted_values[0]
    rank = int(round((percentile / 100) * (len(sorted_values) - 1)))
    rank = max(0, min(len(sorted_values) - 1, rank))
    return sorted_values[rank]


def _tool_stage_label(tool_name: str | None) -> str:
    if not tool_name:
        return "Tool execution"
    return TOOL_STAGE_LABELS.get(tool_name, f"Tool {tool_name}")


@dataclass
class CallTimelineRecorder:
    """In-session recorder for operator timeline rails."""

    _events: list[dict[str, object]] = field(default_factory=list)
    _event_index: int = 0
    _failure: dict[str, object] | None = None
    _ended: bool = False

    def session_started(self, *, at: str | None = None) -> None:
        self._append(
            event_type="session_started",
            status="info",
            label="Session started",
            at=at,
        )

    def greeting_played(
        self,
        *,
        duration_ms: int | None = None,
        provider: str | None = "cartesia",
        at: str | None = None,
    ) -> None:
        detail: dict[str, object] = {}
        if provider:
            detail["provider"] = provider
        self._append(
            event_type="greeting_played",
            status="ok",
            label="Greeting played",
            at=at,
            duration_ms=duration_ms,
            detail=detail or None,
        )

    def provider_retry(
        self,
        *,
        stage: str = "stt",
        provider: str = "deepgram",
        retry_count: int | None = None,
        at: str | None = None,
    ) -> None:
        detail: dict[str, object] = {"provider": provider}
        if retry_count is not None:
            detail["retryCount"] = retry_count
        self._append(
            event_type="provider_retry",
            status="retry",
            label=f"{provider} retry",
            at=at,
            stage=stage if stage in FAILURE_STAGES else "unknown",
            detail=detail,
        )

    def session_failed(
        self,
        *,
        stage: str,
        error_code: str | None = None,
        caller_heard: str | None = None,
        turn_id: str | None = None,
        provider: str | None = None,
        retry_count: int | None = None,
        at: str | None = None,
    ) -> None:
        resolved_stage = stage if stage in FAILURE_STAGES else "unknown"
        detail: dict[str, object] = {}
        if error_code:
            detail["errorCode"] = error_code
        if caller_heard:
            detail["callerHeard"] = caller_heard
        if provider:
            detail["provider"] = provider
        if retry_count is not None:
            detail["retryCount"] = retry_count

        event_at = at or _utc_now_iso()
        self._append(
            event_type="session_failed",
            status="error",
            label=f"Failed at {resolved_stage.upper()}",
            at=event_at,
            stage=resolved_stage,
            turn_id=turn_id,
            detail=detail or None,
        )
        self._failure = {
            "stage": resolved_stage,
            "turnId": turn_id,
            "at": event_at,
            "callerHeard": caller_heard,
            "errorCode": error_code,
        }

    def session_ended(
        self,
        *,
        end_reason: str | None = None,
        at: str | None = None,
    ) -> None:
        if self._ended:
            return
        self._ended = True
        detail: dict[str, object] = {}
        if end_reason:
            detail["endReason"] = end_reason
        self._append(
            event_type="session_ended",
            status="ok" if self._failure is None else "error",
            label="Session ended",
            at=at,
            detail=detail or None,
        )

    @property
    def failure(self) -> dict[str, object] | None:
        return dict(self._failure) if self._failure else None

    def events(self) -> list[dict[str, object]]:
        return [dict(event) for event in self._events]

    def _append(
        self,
        *,
        event_type: str,
        status: str,
        label: str,
        at: str | None = None,
        stage: str | None = None,
        turn_id: str | None = None,
        duration_ms: int | None = None,
        detail: dict[str, object] | None = None,
    ) -> None:
        if event_type not in SESSION_EVENT_TYPES:
            return

        self._event_index += 1
        event: dict[str, object] = {
            "id": f"sev_{self._event_index}",
            "at": at or _utc_now_iso(),
            "type": event_type,
            "status": status,
            "label": label,
        }
        if stage:
            event["stage"] = stage
        if turn_id:
            event["turnId"] = turn_id
        if duration_ms is not None:
            event["durationMs"] = duration_ms
        if detail:
            event["detail"] = detail
        self._events.append(event)


def map_turn_status(raw_status: object, *, provider_error: bool = False) -> str:
    if provider_error or raw_status == "provider-error":
        return "error"
    if raw_status == "interrupted":
        return "interrupted"
    if raw_status == "end-session":
        return "end_session"
    return "ok"


def infer_failure_stage_from_turn(summary: dict[str, object], turn: object) -> str | None:
    if getattr(turn, "provider_error", False) or summary.get("status") == "provider-error":
        # Current worker provider-error path is Deepgram/STT dominated.
        if summary.get("speech_stop_to_stt_final_ms") is None:
            return "stt"
        if summary.get("stt_final_to_llm_first_token_ms") is None:
            return "llm"
        if summary.get("llm_first_token_to_first_tts_audio_ms") is None:
            return "tts"
        return "stt"
    return None


def build_turn_diagnostics(
    latency_tracker: object | None,
    message_rows: list[dict[str, object]] | None = None,
) -> list[dict[str, object]]:
    """Build per-turn diagnostics linked to transcript sequence numbers."""
    if latency_tracker is None:
        return []

    completed_turns = list(getattr(latency_tracker, "completed_turns", []) or [])
    summarize_turn = getattr(latency_tracker, "summarize_turn", None)
    if not completed_turns or not callable(summarize_turn):
        return []

    user_rows = [
        row
        for row in (message_rows or [])
        if isinstance(row, dict) and row.get("role") == "user"
    ]
    assistant_rows = [
        row
        for row in (message_rows or [])
        if isinstance(row, dict) and row.get("role") == "assistant"
    ]
    used_user_seqs: set[int] = set()
    used_assistant_seqs: set[int] = set()

    turns: list[dict[str, object]] = []
    for index, turn in enumerate(completed_turns, start=1):
        summary = summarize_turn(turn)
        if not isinstance(summary, dict):
            continue

        turn_id = str(summary.get("turn_id") or getattr(turn, "turn_id", f"t{index}"))
        status = map_turn_status(
            summary.get("status"),
            provider_error=bool(getattr(turn, "provider_error", False)),
        )
        metrics = {
            "speechStopToSttFinalMs": _positive_latency_ms(
                summary.get("speech_stop_to_stt_final_ms")
            ),
            "sttFinalToLlmFirstTokenMs": _positive_int(
                summary.get("stt_final_to_llm_first_token_ms")
            ),
            "llmFirstTokenToTtsFirstAudioMs": _positive_int(
                summary.get("llm_first_token_to_first_tts_audio_ms")
            ),
            "ttsFirstAudioToBotSpeakingMs": _positive_int(
                summary.get("tts_first_audio_to_bot_speaking_ms")
            ),
            "speechStopToBotSpeakingMs": _positive_int(
                summary.get("speech_stop_to_bot_speaking_ms")
            ),
            "toolExecutionMs": _positive_latency_ms(summary.get("tool_execution_ms")),
            "botSpeakingDurationMs": _positive_int(
                summary.get("bot_speaking_duration_ms")
            ),
            "bargeInToBotSilenceMs": _positive_int(
                summary.get("barge_in_to_bot_silence_ms")
            ),
            "totalTurnDurationMs": _positive_int(summary.get("total_turn_duration_ms")),
        }
        tool_name = summary.get("tool_name")
        if isinstance(tool_name, str) and tool_name.strip():
            metrics["toolName"] = tool_name.strip()
        tool_call_count = _positive_int(summary.get("tool_call_count"))
        if tool_call_count is not None and tool_call_count > 0:
            metrics["toolCallCount"] = tool_call_count

        # Drop null metrics for a smaller payload.
        metrics = {key: value for key, value in metrics.items() if value is not None}

        stages = _build_stage_rows(metrics, status=status, turn=turn, summary=summary)
        failure_stage = infer_failure_stage_from_turn(summary, turn)

        user_seq = _match_user_sequence(
            turn=turn,
            user_rows=user_rows,
            used_seqs=used_user_seqs,
        )
        assistant_seq = None
        # Only completed agent replies get an assistant bubble link.
        # Interrupted / error turns must not steal the next assistant message.
        if (
            user_seq is not None
            and status in {"ok", "end_session"}
            and (
                metrics.get("sttFinalToLlmFirstTokenMs") is not None
                or metrics.get("llmFirstTokenToTtsFirstAudioMs") is not None
                or metrics.get("botSpeakingDurationMs") is not None
                or metrics.get("speechStopToBotSpeakingMs") is not None
            )
        ):
            assistant_seq = _next_assistant_sequence(
                assistant_rows=assistant_rows,
                used_seqs=used_assistant_seqs,
                after_user_seq=user_seq,
            )

        turn_payload: dict[str, object] = {
            "turnId": turn_id,
            "index": index,
            "status": status,
            "metrics": metrics,
            "stages": stages,
        }
        transcript = getattr(turn, "final_transcript_text", None)
        if isinstance(transcript, str) and transcript.strip():
            turn_payload["userTranscript"] = transcript.strip()
        if user_seq is not None:
            turn_payload["userMessageSeq"] = user_seq
        if assistant_seq is not None:
            turn_payload["assistantMessageSeq"] = assistant_seq
        if failure_stage:
            turn_payload["failureStage"] = failure_stage
        turns.append(turn_payload)

    return turns


def build_aggregate_metrics(latency_tracker: object | None) -> dict[str, int]:
    """Average positive per-turn metrics (portal flat-key compatibility)."""
    samples = _collect_metric_samples(latency_tracker)
    aggregated: dict[str, int] = {}
    for key, values in samples.items():
        if values:
            aggregated[key] = int(round(sum(values) / len(values)))
    return aggregated


def build_rich_aggregates(latency_tracker: object | None) -> dict[str, Any]:
    """Conversation-level latency KPIs (median / p95 / extremes)."""
    samples = _collect_metric_samples(latency_tracker)
    averages = {
        key: int(round(sum(values) / len(values)))
        for key, values in samples.items()
        if values
    }

    response_samples = sorted(samples.get("speech_stop_to_bot_speaking_ms", []))
    rich: dict[str, Any] = {**averages}

    if response_samples:
        rich["median_response_latency_ms"] = _percentile_nearest_rank(
            response_samples, 50
        )
        rich["p95_response_latency_ms"] = _percentile_nearest_rank(
            response_samples, 95
        )
        rich["fastest_response_latency_ms"] = response_samples[0]
        rich["slowest_response_latency_ms"] = response_samples[-1]
        rich["average_response_latency_ms"] = averages.get(
            "speech_stop_to_bot_speaking_ms",
            int(round(sum(response_samples) / len(response_samples))),
        )
        rich["slow_response_count"] = sum(
            1 for value in response_samples if value > SLOW_RESPONSE_THRESHOLD_MS
        )
        rich["response_sample_count"] = len(response_samples)

    tool_samples = samples.get("tool_execution_ms", [])
    if tool_samples:
        rich["average_tool_execution_ms"] = int(
            round(sum(tool_samples) / len(tool_samples))
        )
        rich["total_tool_calls"] = len(tool_samples)

    return rich


def build_latency_metrics_v2(
    latency_tracker: object | None,
    *,
    message_rows: list[dict[str, object]] | None = None,
    timeline: CallTimelineRecorder | None = None,
    end_reason: str | None = None,
) -> dict[str, Any]:
    """Build the full latency_metrics v2 blob for conversation persistence."""
    aggregates = build_rich_aggregates(latency_tracker)
    # Keep legacy flat averages at the top level for older portal readers.
    flat_averages = build_aggregate_metrics(latency_tracker)
    turns = build_turn_diagnostics(latency_tracker, message_rows=message_rows)

    if latency_tracker is None and timeline is None and not aggregates and not turns:
        return {}

    recorder = timeline or CallTimelineRecorder()
    if not any(event.get("type") == "session_ended" for event in recorder.events()):
        recorder.session_ended(end_reason=end_reason)

    failure = recorder.failure
    # Only persist a top-level failure summary when the session timeline recorded
    # a hard failure. Do not invent one from an intermediate turn — that can
    # disagree with a browser finalize that already marked the call completed.
    payload: dict[str, Any] = {
        "version": 2,
        **flat_averages,
        "aggregates": aggregates,
        "session_events": recorder.events(),
        "turns": turns,
        "failure": failure,
    }
    return payload


def _collect_metric_samples(
    latency_tracker: object | None,
) -> dict[str, list[int]]:
    if latency_tracker is None:
        return {}

    completed_turns = list(getattr(latency_tracker, "completed_turns", []) or [])
    summarize_turn = getattr(latency_tracker, "summarize_turn", None)
    if not completed_turns or not callable(summarize_turn):
        return {}

    metric_key_mapping = {
        "speech_stop_to_stt_final_ms": ("speech_stop_to_stt_final_ms", True),
        "stt_final_to_llm_first_token_ms": (
            "stt_final_to_llm_first_token_ms",
            False,
        ),
        "llm_first_token_to_first_tts_audio_ms": (
            "llm_first_token_to_tts_first_audio_ms",
            False,
        ),
        "tts_first_audio_to_bot_speaking_ms": (
            "tts_first_audio_to_bot_speaking_ms",
            False,
        ),
        "speech_stop_to_bot_speaking_ms": (
            "speech_stop_to_bot_speaking_ms",
            False,
        ),
        "bot_speaking_duration_ms": ("bot_speaking_duration_ms", False),
        "total_turn_duration_ms": ("total_turn_duration_ms", False),
        "tool_execution_ms": ("tool_execution_ms", True),
    }
    values_by_key: dict[str, list[int]] = {
        target: [] for target, _ in metric_key_mapping.values()
    }

    for turn in completed_turns:
        summary = summarize_turn(turn)
        if not isinstance(summary, dict):
            continue
        for source_key, (target_key, require_positive) in metric_key_mapping.items():
            raw = summary.get(source_key)
            value = (
                _positive_latency_ms(raw) if require_positive else _positive_int(raw)
            )
            if value is not None:
                values_by_key[target_key].append(value)

    return values_by_key


def _build_stage_rows(
    metrics: dict[str, object],
    *,
    status: str,
    turn: object,
    summary: dict[str, object] | None = None,
) -> list[dict[str, object]]:
    stages: list[dict[str, object]] = []
    summary = summary or {}

    stt_ms = metrics.get("speechStopToSttFinalMs")
    llm_gap_ms = metrics.get("sttFinalToLlmFirstTokenMs")
    tts_gap_ms = metrics.get("llmFirstTokenToTtsFirstAudioMs")
    playback_overhead_ms = metrics.get("ttsFirstAudioToBotSpeakingMs")
    response_ms = metrics.get("speechStopToBotSpeakingMs")
    spoke_ms = metrics.get("botSpeakingDurationMs")
    tool_ms = metrics.get("toolExecutionMs")
    tool_name = metrics.get("toolName")
    if not isinstance(tool_name, str):
        tool_name = summary.get("tool_name") if isinstance(summary.get("tool_name"), str) else None

    if stt_ms is not None:
        stages.append(
            {
                "stage": "stt",
                "status": "ok",
                "durationMs": stt_ms,
                "provider": "deepgram",
                "label": "speech stop → STT final",
                "side": "stt",
            }
        )
    elif status == "error" and getattr(turn, "provider_error", False):
        stages.append(
            {
                "stage": "stt",
                "status": "error",
                "provider": "deepgram",
                "label": "STT failed",
                "side": "stt",
            }
        )

    if status == "end_session" and llm_gap_ms is None and tts_gap_ms is None:
        if spoke_ms is not None:
            stages.append(
                {
                    "stage": "tts",
                    "status": "ok",
                    "durationMs": spoke_ms,
                    "provider": "cartesia",
                    "label": "End session · Goodbye played",
                    "side": "assistant",
                }
            )
        return stages

    has_tool = tool_ms is not None
    if llm_gap_ms is not None:
        stages.append(
            {
                "stage": "llm",
                "status": "ok",
                "durationMs": llm_gap_ms,
                "provider": "gemini",
                "label": (
                    "LLM / agent processing"
                    if has_tool
                    else "STT final → LLM first token"
                ),
                "side": "assistant",
            }
        )

    if has_tool:
        stage_row: dict[str, object] = {
            "stage": "tool",
            "status": "ok",
            "durationMs": tool_ms,
            "label": _tool_stage_label(
                tool_name if isinstance(tool_name, str) else None
            ),
            "side": "assistant",
        }
        if isinstance(tool_name, str) and tool_name.strip():
            stage_row["toolName"] = tool_name.strip()
        stages.append(stage_row)

    if tts_gap_ms is not None:
        stages.append(
            {
                "stage": "tts",
                "status": "ok",
                "durationMs": tts_gap_ms,
                "provider": "cartesia",
                "label": "LLM first token → TTS first audio",
                "side": "assistant",
            }
        )

    if playback_overhead_ms is not None:
        stages.append(
            {
                "stage": "tts",
                "status": "ok",
                "durationMs": playback_overhead_ms,
                "provider": "cartesia",
                "label": "Playback overhead",
                "side": "assistant",
            }
        )

    if response_ms is not None:
        stages.append(
            {
                "stage": "tts",
                "status": "ok",
                "durationMs": response_ms,
                "provider": "cartesia",
                "label": "End speech → first audio",
                "side": "assistant",
            }
        )

    if spoke_ms is not None:
        stages.append(
            {
                "stage": "tts",
                "status": "ok",
                "durationMs": spoke_ms,
                "provider": "cartesia",
                "label": "Speaking duration",
                "side": "assistant",
            }
        )

    return stages


def _match_user_sequence(
    *,
    turn: object,
    user_rows: list[dict[str, object]],
    used_seqs: set[int],
) -> int | None:
    """Link only on exact normalized transcript text — never by order fallback."""
    transcript = getattr(turn, "final_transcript_text", None)
    if not isinstance(transcript, str) or not transcript.strip():
        return None

    normalized = " ".join(transcript.split()).casefold()
    for row in user_rows:
        seq = row.get("sequence_number")
        if not isinstance(seq, int) or seq in used_seqs:
            continue
        content = row.get("content")
        if not isinstance(content, str):
            continue
        if " ".join(content.split()).casefold() == normalized:
            used_seqs.add(seq)
            return seq
    return None


def _next_assistant_sequence(
    *,
    assistant_rows: list[dict[str, object]],
    used_seqs: set[int],
    after_user_seq: int | None,
) -> int | None:
    if after_user_seq is None:
        return None
    for row in assistant_rows:
        seq = row.get("sequence_number")
        if not isinstance(seq, int) or seq in used_seqs:
            continue
        if seq <= after_user_seq:
            continue
        used_seqs.add(seq)
        return seq
    return None
