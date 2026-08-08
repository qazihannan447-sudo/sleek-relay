"""Accumulate Pipecat LLM/TTS usage metrics for conversation persistence."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


USAGE_METRICS_VERSION = 1


@dataclass
class UsageMetricsAccumulator:
    """Running totals for LLM tokens and TTS characters during a session."""

    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    llm_call_count: int = 0
    llm_model: str | None = None
    tts_characters: int = 0
    tts_call_count: int = 0
    tts_model: str | None = None
    _seen_metric_ids: set[int] = field(default_factory=set)

    def observe_metrics_frame(self, frame: object) -> None:
        """Ingest a Pipecat MetricsFrame (or duck-typed equivalent)."""
        frame_id = getattr(frame, "id", None)
        if isinstance(frame_id, int):
            if frame_id in self._seen_metric_ids:
                return
            self._seen_metric_ids.add(frame_id)

        data = getattr(frame, "data", None)
        if not isinstance(data, (list, tuple)):
            return

        for item in data:
            self._observe_metric_item(item)

    def _observe_metric_item(self, item: object) -> None:
        type_name = type(item).__name__
        value = getattr(item, "value", None)
        model = getattr(item, "model", None)
        model_name = model.strip() if isinstance(model, str) and model.strip() else None

        if type_name == "LLMUsageMetricsData":
            prompt = _as_non_negative_int(getattr(value, "prompt_tokens", None))
            completion = _as_non_negative_int(getattr(value, "completion_tokens", None))
            total = _as_non_negative_int(getattr(value, "total_tokens", None))
            if total is None and (prompt is not None or completion is not None):
                total = (prompt or 0) + (completion or 0)

            # Ignore empty bootstrap MetricsFrames.
            if (prompt or 0) == 0 and (completion or 0) == 0 and (total or 0) == 0:
                return

            self.prompt_tokens += prompt or 0
            self.completion_tokens += completion or 0
            self.total_tokens += total or ((prompt or 0) + (completion or 0))
            self.llm_call_count += 1
            if model_name:
                self.llm_model = model_name
            return

        if type_name == "TTSUsageMetricsData":
            # TTSUsageMetricsData.value is character count.
            characters = _as_non_negative_int(value)
            if characters is None or characters == 0:
                return

            self.tts_characters += characters
            self.tts_call_count += 1
            if model_name:
                self.tts_model = model_name

    def has_recorded_usage(self) -> bool:
        return (
            self.llm_call_count > 0
            or self.tts_call_count > 0
            or self.total_tokens > 0
            or self.tts_characters > 0
        )

    def to_snapshot(self) -> dict[str, Any]:
        """Build the conversations.usage_metrics JSON payload."""
        if not self.has_recorded_usage():
            return {}

        snapshot: dict[str, Any] = {"version": USAGE_METRICS_VERSION}

        if self.llm_call_count > 0 or self.total_tokens > 0:
            llm: dict[str, Any] = {
                "prompt_tokens": self.prompt_tokens,
                "completion_tokens": self.completion_tokens,
                "total_tokens": self.total_tokens,
                "call_count": self.llm_call_count,
            }
            if self.llm_model:
                llm["model"] = self.llm_model
            snapshot["llm"] = llm

        if self.tts_call_count > 0 or self.tts_characters > 0:
            tts: dict[str, Any] = {
                "characters": self.tts_characters,
                "call_count": self.tts_call_count,
            }
            if self.tts_model:
                tts["model"] = self.tts_model
            snapshot["tts"] = tts

        return snapshot


def build_usage_metrics_snapshot(accumulator: UsageMetricsAccumulator | None) -> dict[str, Any]:
    if accumulator is None:
        return {}
    return accumulator.to_snapshot()


def _as_non_negative_int(value: object) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int) and value >= 0:
        return value
    if isinstance(value, float) and value >= 0 and value.is_integer():
        return int(value)
    return None
