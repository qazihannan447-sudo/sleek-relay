"""Tests for usage metrics accumulator."""

from __future__ import annotations

from types import SimpleNamespace

from app.usage_metrics import UsageMetricsAccumulator, build_usage_metrics_snapshot


class _LLMUsage:
    def __init__(self, prompt: int, completion: int, total: int | None = None) -> None:
        self.prompt_tokens = prompt
        self.completion_tokens = completion
        self.total_tokens = total if total is not None else prompt + completion


class _STTUsage:
    def __init__(self, audio_seconds: float) -> None:
        self.audio_seconds = audio_seconds


class LLMUsageMetricsData:
    def __init__(self, *, value: _LLMUsage, model: str | None = None) -> None:
        self.value = value
        self.model = model
        self.processor = "GoogleLLMService#0"


class TTSUsageMetricsData:
    def __init__(self, *, value: int, model: str | None = None) -> None:
        self.value = value
        self.model = model
        self.processor = "CartesiaTTSService#0"


class STTUsageMetricsData:
    def __init__(self, *, value: _STTUsage, model: str | None = None) -> None:
        self.value = value
        self.model = model
        self.processor = "DeepgramFluxSTTService#0"


class TTFBMetricsData:
    def __init__(self, *, value: float) -> None:
        self.value = value
        self.processor = "GoogleLLMService#0"


def test_accumulator_sums_llm_tts_and_stt_usage() -> None:
    accumulator = UsageMetricsAccumulator()
    frame = SimpleNamespace(
        id=1,
        data=[
            LLMUsageMetricsData(value=_LLMUsage(100, 40), model="gemini-2.0-flash"),
            TTSUsageMetricsData(value=65, model="sonic-2"),
            STTUsageMetricsData(value=_STTUsage(2.5), model="nova-3"),
            TTFBMetricsData(value=0.2),
        ],
    )
    accumulator.observe_metrics_frame(frame)
    accumulator.observe_metrics_frame(
        SimpleNamespace(
            id=2,
            data=[LLMUsageMetricsData(value=_LLMUsage(80, 20))],
        )
    )
    # Duplicate frame id is ignored.
    accumulator.observe_metrics_frame(frame)

    snapshot = accumulator.to_snapshot()
    assert snapshot["version"] == 1
    assert snapshot["llm"]["prompt_tokens"] == 180
    assert snapshot["llm"]["completion_tokens"] == 60
    assert snapshot["llm"]["total_tokens"] == 240
    assert snapshot["llm"]["call_count"] == 2
    assert snapshot["llm"]["model"] == "gemini-2.0-flash"
    assert snapshot["tts"]["characters"] == 65
    assert snapshot["tts"]["call_count"] == 1
    assert snapshot["stt"]["audio_seconds"] == 2.5
    assert snapshot["stt"]["source"] == "metrics"
    assert snapshot["stt"]["model"] == "nova-3"


def test_accumulator_falls_back_to_input_audio_seconds() -> None:
    accumulator = UsageMetricsAccumulator()
    # 16000 Hz mono 16-bit: 32000 bytes = 1.0 second
    accumulator.observe_input_audio(
        SimpleNamespace(audio=b"\x00\x00" * 16000, sample_rate=16000, num_channels=1)
    )
    accumulator.observe_input_audio(
        SimpleNamespace(audio=b"\x00\x00" * 8000, sample_rate=16000, num_channels=1)
    )

    snapshot = accumulator.to_snapshot()
    assert snapshot["stt"]["audio_seconds"] == 1.5
    assert snapshot["stt"]["source"] == "input_audio"


def test_stt_metrics_override_input_audio_fallback() -> None:
    accumulator = UsageMetricsAccumulator()
    accumulator.observe_input_audio(
        SimpleNamespace(audio=b"\x00\x00" * 16000, sample_rate=16000, num_channels=1)
    )
    accumulator.observe_metrics_frame(
        SimpleNamespace(
            id=9,
            data=[STTUsageMetricsData(value=_STTUsage(0.4))],
        )
    )

    snapshot = accumulator.to_snapshot()
    assert snapshot["stt"]["audio_seconds"] == 0.4
    assert snapshot["stt"]["source"] == "metrics"


def test_accumulator_ignores_empty_bootstrap_metrics() -> None:
    accumulator = UsageMetricsAccumulator()
    accumulator.observe_metrics_frame(
        SimpleNamespace(
            id=3,
            data=[LLMUsageMetricsData(value=_LLMUsage(0, 0, 0))],
        )
    )
    assert accumulator.has_recorded_usage() is False
    assert build_usage_metrics_snapshot(accumulator) == {}
