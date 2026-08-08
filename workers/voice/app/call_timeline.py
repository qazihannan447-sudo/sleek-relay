"""Session call-timeline recorder and latency_metrics v2 builders.

Produces the operator-facing diagnostics blob persisted on
``conversations.latency_metrics``:

* flat aggregate averages (backward compatible with the portal)
* ``session_events`` — thin rails (start / greeting / fail / end)
* ``turns`` — per-turn metrics linked to transcript sequence numbers
* ``failure`` — failed stage summary for list badges + drawer banner
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
            "speechStopToSttFinalMs": _positive_int(
                summary.get("speech_stop_to_stt_final_ms")
            ),
            "sttFinalToLlmFirstTokenMs": _positive_int(
                summary.get("stt_final_to_llm_first_token_ms")
            ),
            "llmFirstTokenToTtsFirstAudioMs": _positive_int(
                summary.get("llm_first_token_to_first_tts_audio_ms")
            ),
            "speechStopToBotSpeakingMs": _positive_int(
                summary.get("speech_stop_to_bot_speaking_ms")
            ),
            "botSpeakingDurationMs": _positive_int(
                summary.get("bot_speaking_duration_ms")
            ),
            "bargeInToBotSilenceMs": _positive_int(
                summary.get("barge_in_to_bot_silence_ms")
            ),
            "totalTurnDurationMs": _positive_int(summary.get("total_turn_duration_ms")),
        }
        # Drop null metrics for a smaller payload.
        metrics = {key: value for key, value in metrics.items() if value is not None}

        stages = _build_stage_rows(metrics, status=status, turn=turn)
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
    if latency_tracker is None:
        return {}

    completed_turns = list(getattr(latency_tracker, "completed_turns", []) or [])
    summarize_turn = getattr(latency_tracker, "summarize_turn", None)
    if not completed_turns or not callable(summarize_turn):
        return {}

    metric_key_mapping = {
        "speech_stop_to_stt_final_ms": "speech_stop_to_stt_final_ms",
        "stt_final_to_llm_first_token_ms": "stt_final_to_llm_first_token_ms",
        "llm_first_token_to_first_tts_audio_ms": "llm_first_token_to_tts_first_audio_ms",
        "speech_stop_to_bot_speaking_ms": "speech_stop_to_bot_speaking_ms",
        "bot_speaking_duration_ms": "bot_speaking_duration_ms",
        "total_turn_duration_ms": "total_turn_duration_ms",
    }
    values_by_key: dict[str, list[int]] = {
        target: [] for target in metric_key_mapping.values()
    }

    for turn in completed_turns:
        summary = summarize_turn(turn)
        if not isinstance(summary, dict):
            continue
        for source_key, target_key in metric_key_mapping.items():
            value = _positive_int(summary.get(source_key))
            if value is not None:
                values_by_key[target_key].append(value)

    aggregated: dict[str, int] = {}
    for key, values in values_by_key.items():
        if values:
            aggregated[key] = int(round(sum(values) / len(values)))
    return aggregated


def build_latency_metrics_v2(
    latency_tracker: object | None,
    *,
    message_rows: list[dict[str, object]] | None = None,
    timeline: CallTimelineRecorder | None = None,
    end_reason: str | None = None,
) -> dict[str, Any]:
    """Build the full latency_metrics v2 blob for conversation persistence."""
    aggregates = build_aggregate_metrics(latency_tracker)
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
        **aggregates,
        "aggregates": aggregates,
        "session_events": recorder.events(),
        "turns": turns,
        "failure": failure,
    }
    return payload


def _build_stage_rows(
    metrics: dict[str, int],
    *,
    status: str,
    turn: object,
) -> list[dict[str, object]]:
    stages: list[dict[str, object]] = []

    stt_ms = metrics.get("speechStopToSttFinalMs")
    llm_gap_ms = metrics.get("sttFinalToLlmFirstTokenMs")
    tts_gap_ms = metrics.get("llmFirstTokenToTtsFirstAudioMs")
    spoke_ms = metrics.get("botSpeakingDurationMs")

    if stt_ms is not None:
        stages.append(
            {
                "stage": "stt",
                "status": "ok",
                "durationMs": stt_ms,
                "provider": "deepgram",
                "label": "speech stop → STT final",
            }
        )
    elif status == "error" and getattr(turn, "provider_error", False):
        stages.append(
            {
                "stage": "stt",
                "status": "error",
                "provider": "deepgram",
                "label": "STT failed",
            }
        )

    if llm_gap_ms is not None:
        stages.append(
            {
                "stage": "llm",
                "status": "ok",
                "durationMs": llm_gap_ms,
                "provider": "gemini",
                "label": "STT final → LLM first token",
            }
        )

    if tts_gap_ms is not None:
        stages.append(
            {
                "stage": "tts",
                "status": "ok",
                "durationMs": tts_gap_ms,
                "provider": "cartesia",
                "label": "LLM first token → TTS first audio",
            }
        )

    if spoke_ms is not None:
        stages.append(
            {
                "stage": "tts",
                "status": "ok",
                "durationMs": spoke_ms,
                "provider": "cartesia",
                "label": "bot speaking duration",
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