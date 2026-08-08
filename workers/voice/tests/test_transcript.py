"""Tests for app.transcript persistence module."""

from __future__ import annotations

import json
from http import HTTPStatus
from io import BytesIO
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from app.transcript import (
    _extract_content_text,
    build_latency_metrics,
    build_message_rows,
    finalize_conversation_status,
    persist_conversation_metadata,
    persist_transcript,
    try_persist_session_results,
    try_persist_transcript,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_runtime_config(
    *,
    conversation_id: str | None = "aaaaaaaa-0000-0000-0000-000000000001",
    tenant_id: str = "bbbbbbbb-0000-0000-0000-000000000001",
) -> Any:
    config = MagicMock()
    config.conversation_id = conversation_id
    config.tenant.id = tenant_id
    return config


def _make_worker_config(
    *,
    supabase_url: str | None = "https://example.supabase.co",
    supabase_service_role_key: str | None = "service-role-key-abc",
) -> Any:
    config = MagicMock()
    config.supabase_url = supabase_url
    config.supabase_service_role_key = supabase_service_role_key
    return config


def _fake_urlopen_success(request: Any, timeout: int = 15) -> Any:
    """Simulate a successful 201 response from urlopen."""
    response = MagicMock()
    response.status = 201
    response.__enter__ = lambda s: s
    response.__exit__ = MagicMock(return_value=False)
    return response


def _fake_urlopen_error(request: Any, timeout: int = 15) -> Any:
    """Simulate a 500 response from urlopen."""
    response = MagicMock()
    response.status = 500
    response.__enter__ = lambda s: s
    response.__exit__ = MagicMock(return_value=False)
    return response


# ---------------------------------------------------------------------------
# _extract_content_text
# ---------------------------------------------------------------------------


class TestExtractContentText:
    def test_plain_string(self) -> None:
        assert _extract_content_text("  hello  ") == "hello"

    def test_empty_string(self) -> None:
        assert _extract_content_text("") == ""

    def test_whitespace_string(self) -> None:
        assert _extract_content_text("   ") == ""

    def test_list_of_strings(self) -> None:
        result = _extract_content_text(["hello", "world"])
        assert result == "hello world"

    def test_list_of_text_dicts(self) -> None:
        parts = [{"type": "text", "text": "hello"}, {"type": "text", "text": "world"}]
        result = _extract_content_text(parts)
        assert result == "hello world"

    def test_list_mixed(self) -> None:
        parts = ["hello", {"type": "text", "text": "world"}, {"type": "image"}]
        result = _extract_content_text(parts)
        assert result == "hello world"

    def test_none_returns_empty(self) -> None:
        assert _extract_content_text(None) == ""

    def test_int_returns_empty(self) -> None:
        assert _extract_content_text(42) == ""  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# build_message_rows
# ---------------------------------------------------------------------------


class TestBuildMessageRows:
    TENANT_ID = "bbbbbbbb-0000-0000-0000-000000000001"
    CONV_ID = "aaaaaaaa-0000-0000-0000-000000000001"

    def _build(self, messages: list[dict]) -> list[dict]:
        return build_message_rows(
            messages,
            tenant_id=self.TENANT_ID,
            conversation_id=self.CONV_ID,
        )

    def test_empty_input(self) -> None:
        assert self._build([]) == []

    def test_filters_system_role(self) -> None:
        msgs = [{"role": "system", "content": "You are an assistant."}]
        assert self._build(msgs) == []

    def test_filters_tool_role(self) -> None:
        msgs = [{"role": "tool", "content": "tool result"}]
        assert self._build(msgs) == []

    def test_filters_blank_content(self) -> None:
        msgs = [{"role": "user", "content": "   "}]
        assert self._build(msgs) == []

    def test_user_and_assistant_rows(self) -> None:
        msgs = [
            {"role": "user", "content": "Hello"},
            {"role": "assistant", "content": "Hi there!"},
        ]
        rows = self._build(msgs)
        assert len(rows) == 2
        assert rows[0]["role"] == "user"
        assert rows[0]["content"] == "Hello"
        assert rows[0]["sequence_number"] == 1
        assert rows[1]["role"] == "assistant"
        assert rows[1]["content"] == "Hi there!"
        assert rows[1]["sequence_number"] == 2

    def test_sequence_numbers_skip_filtered(self) -> None:
        msgs = [
            {"role": "user", "content": "Hello"},
            {"role": "system", "content": "context"},
            {"role": "assistant", "content": "Hi!"},
        ]
        rows = self._build(msgs)
        assert [r["sequence_number"] for r in rows] == [1, 2]

    def test_tenant_and_conversation_id_set(self) -> None:
        msgs = [{"role": "user", "content": "Hi"}]
        rows = self._build(msgs)
        assert rows[0]["tenant_id"] == self.TENANT_ID
        assert rows[0]["conversation_id"] == self.CONV_ID

    def test_is_final_and_interrupted_defaults(self) -> None:
        msgs = [{"role": "user", "content": "Hi"}]
        rows = self._build(msgs)
        assert rows[0]["is_final"] is True
        assert rows[0]["interrupted"] is False

    def test_content_list_flattened(self) -> None:
        msgs = [{"role": "user", "content": [{"type": "text", "text": "Hello"}]}]
        rows = self._build(msgs)
        assert rows[0]["content"] == "Hello"

    def test_collapses_consecutive_duplicate_assistant_messages(self) -> None:
        greeting = "hello my name is habiba, what do you wanna know?"
        msgs = [
            {"role": "assistant", "content": greeting},
            {"role": "assistant", "content": greeting},
            {"role": "assistant", "content": greeting},
            {"role": "user", "content": "What services do you offer?"},
            {"role": "assistant", "content": "We build AI solutions."},
            {"role": "assistant", "content": "We build AI solutions."},
        ]
        rows = self._build(msgs)
        assert [r["content"] for r in rows] == [
            greeting,
            "What services do you offer?",
            "We build AI solutions.",
        ]
        assert [r["sequence_number"] for r in rows] == [1, 2, 3]

    def test_long_content_truncated(self) -> None:
        long_text = "x" * 40_000
        msgs = [{"role": "user", "content": long_text}]
        rows = self._build(msgs)
        assert len(rows[0]["content"]) == 32_000

    def test_non_dict_items_skipped(self) -> None:
        msgs: list[Any] = [None, "bad", {"role": "user", "content": "Hi"}]
        rows = self._build(msgs)
        assert len(rows) == 1
        assert rows[0]["content"] == "Hi"


# ---------------------------------------------------------------------------
# persist_transcript
# ---------------------------------------------------------------------------


class TestPersistTranscript:
    ROWS = [
        {
            "tenant_id": "t1",
            "conversation_id": "c1",
            "sequence_number": 1,
            "role": "user",
            "content": "Hello",
            "is_final": True,
            "interrupted": False,
        }
    ]

    def test_empty_rows_skips_http(self) -> None:
        with patch("app.transcript.urlopen") as mock_urlopen:
            persist_transcript([], supabase_url="https://x.co", service_role_key="key")
            mock_urlopen.assert_not_called()

    def test_success_logs_count(self, caplog: pytest.LogCaptureFixture) -> None:
        with patch("app.transcript.urlopen", side_effect=_fake_urlopen_success):
            with caplog.at_level("INFO"):
                persist_transcript(
                    self.ROWS, supabase_url="https://x.co", service_role_key="key"
                )
        assert "1 message row" in caplog.text

    def test_request_body_is_json(self) -> None:
        captured_requests: list[Any] = []

        def fake_urlopen(req: Any, timeout: int = 15) -> Any:
            captured_requests.append(req)
            return _fake_urlopen_success(req, timeout)

        with patch("app.transcript.urlopen", side_effect=fake_urlopen):
            persist_transcript(
                self.ROWS, supabase_url="https://x.co", service_role_key="mykey"
            )

        assert len(captured_requests) == 1
        req = captured_requests[0]
        parsed = json.loads(req.data.decode("utf-8"))
        assert parsed[0]["role"] == "user"
        assert req.get_header("Authorization") == "Bearer mykey"
        assert req.get_header("Apikey") == "mykey"

    def test_url_error_logged_not_raised(self, caplog: pytest.LogCaptureFixture) -> None:
        from urllib.error import URLError

        with patch("app.transcript.urlopen", side_effect=URLError("connection refused")):
            with caplog.at_level("ERROR"):
                persist_transcript(
                    self.ROWS, supabase_url="https://x.co", service_role_key="key"
                )
        assert "network error" in caplog.text

    def test_bad_http_status_logged_not_raised(self, caplog: pytest.LogCaptureFixture) -> None:
        with patch("app.transcript.urlopen", side_effect=_fake_urlopen_error):
            with caplog.at_level("ERROR"):
                persist_transcript(
                    self.ROWS, supabase_url="https://x.co", service_role_key="key"
                )
        assert "unexpected status=500" in caplog.text

    def test_unexpected_exception_logged_not_raised(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        with patch("app.transcript.urlopen", side_effect=RuntimeError("boom")):
            with caplog.at_level("ERROR"):
                persist_transcript(
                    self.ROWS, supabase_url="https://x.co", service_role_key="key"
                )
        assert "unexpected error" in caplog.text


# ---------------------------------------------------------------------------
# try_persist_transcript
# ---------------------------------------------------------------------------


class TestTryPersistTranscript:
    MESSAGES = [
        {"role": "user", "content": "Hello"},
        {"role": "assistant", "content": "Hi!"},
    ]

    def test_skips_when_no_conversation_id(self, caplog: pytest.LogCaptureFixture) -> None:
        rc = _make_runtime_config(conversation_id=None)
        wc = _make_worker_config()
        with patch("app.transcript.persist_transcript") as mock_persist:
            with caplog.at_level("DEBUG"):
                try_persist_transcript(self.MESSAGES, rc, wc)
            mock_persist.assert_not_called()
        assert "no conversation_id" in caplog.text

    def test_skips_when_no_supabase_url(self, caplog: pytest.LogCaptureFixture) -> None:
        rc = _make_runtime_config()
        wc = _make_worker_config(supabase_url=None)
        with patch("app.transcript.persist_transcript") as mock_persist:
            with caplog.at_level("DEBUG"):
                try_persist_transcript(self.MESSAGES, rc, wc)
            mock_persist.assert_not_called()
        assert "not configured" in caplog.text

    def test_skips_when_no_service_role_key(self, caplog: pytest.LogCaptureFixture) -> None:
        rc = _make_runtime_config()
        wc = _make_worker_config(supabase_service_role_key=None)
        with patch("app.transcript.persist_transcript") as mock_persist:
            with caplog.at_level("DEBUG"):
                try_persist_transcript(self.MESSAGES, rc, wc)
            mock_persist.assert_not_called()
        assert "not configured" in caplog.text

    def test_calls_persist_when_configured(self) -> None:
        rc = _make_runtime_config()
        wc = _make_worker_config()
        with patch("app.transcript.persist_transcript") as mock_persist, patch(
            "app.transcript.persist_conversation_metadata"
        ) as mock_metadata, patch(
            "app.transcript.finalize_conversation_status"
        ) as mock_finalize:
            try_persist_session_results(self.MESSAGES, None, rc, wc)

        mock_persist.assert_called_once()
        mock_metadata.assert_called_once()
        mock_finalize.assert_called_once()
        _rows, kwargs = mock_persist.call_args.args[0], mock_persist.call_args.kwargs
        assert isinstance(_rows, list)
        assert len(_rows) == 2
        assert kwargs["supabase_url"] == "https://example.supabase.co"
        assert kwargs["service_role_key"] == "service-role-key-abc"

    def test_empty_messages_still_calls_persist(self) -> None:
        rc = _make_runtime_config()
        wc = _make_worker_config()
        with patch("app.transcript.persist_transcript") as mock_persist, patch(
            "app.transcript.persist_conversation_metadata"
        ) as mock_metadata, patch(
            "app.transcript.finalize_conversation_status"
        ) as mock_finalize:
            try_persist_session_results([], None, rc, wc)
        mock_persist.assert_called_once()
        mock_metadata.assert_called_once()
        mock_finalize.assert_called_once()


# ---------------------------------------------------------------------------
# build_latency_metrics & persist_conversation_metadata
# ---------------------------------------------------------------------------


class TestLatencyMetricsAndMetadata:
    def test_build_latency_metrics_returns_empty_when_none(self) -> None:
        assert build_latency_metrics(None) == {}

    def test_build_latency_metrics_aggregates_completed_turns(self) -> None:
        tracker = MagicMock()
        turn1 = MagicMock()
        turn1.turn_id = "s1-t1"
        turn1.provider_error = False
        turn1.final_transcript_text = "hello"
        turn2 = MagicMock()
        turn2.turn_id = "s1-t2"
        turn2.provider_error = False
        turn2.final_transcript_text = "again"
        tracker.completed_turns = [turn1, turn2]
        tracker.summarize_turn.side_effect = [
            {
                "turn_id": "s1-t1",
                "status": "completed",
                "speech_stop_to_stt_final_ms": 200,
                "stt_final_to_llm_first_token_ms": 300,
                "llm_first_token_to_first_tts_audio_ms": 150,
                "speech_stop_to_bot_speaking_ms": 650,
                "bot_speaking_duration_ms": 2000,
                "total_turn_duration_ms": 2650,
            },
            {
                "turn_id": "s1-t2",
                "status": "completed",
                "speech_stop_to_stt_final_ms": 300,
                "stt_final_to_llm_first_token_ms": 400,
                "llm_first_token_to_first_tts_audio_ms": 250,
                "speech_stop_to_bot_speaking_ms": 950,
                "bot_speaking_duration_ms": 3000,
                "total_turn_duration_ms": 3950,
            },
        ]

        metrics = build_latency_metrics(
            tracker,
            message_rows=[
                {
                    "sequence_number": 1,
                    "role": "user",
                    "content": "hello",
                },
                {
                    "sequence_number": 2,
                    "role": "assistant",
                    "content": "hi there",
                },
                {
                    "sequence_number": 3,
                    "role": "user",
                    "content": "again",
                },
                {
                    "sequence_number": 4,
                    "role": "assistant",
                    "content": "ok",
                },
            ],
        )
        assert metrics["version"] == 2
        assert metrics["speech_stop_to_stt_final_ms"] == 250
        assert metrics["stt_final_to_llm_first_token_ms"] == 350
        assert metrics["llm_first_token_to_tts_first_audio_ms"] == 200
        assert metrics["speech_stop_to_bot_speaking_ms"] == 800
        assert metrics["bot_speaking_duration_ms"] == 2500
        assert metrics["total_turn_duration_ms"] == 3300
        assert len(metrics["turns"]) == 2
        assert metrics["turns"][0]["userMessageSeq"] == 1
        assert metrics["turns"][0]["assistantMessageSeq"] == 2
        assert metrics["turns"][1]["userMessageSeq"] == 3
        assert any(event["type"] == "session_ended" for event in metrics["session_events"])

    def test_persist_conversation_metadata_sends_patch_request(self) -> None:
        captured_requests: list[Any] = []

        def fake_urlopen(req: Any, timeout: int = 15) -> Any:
            captured_requests.append(req)
            resp = MagicMock()
            resp.status = 200
            resp.__enter__ = lambda s: s
            resp.__exit__ = MagicMock(return_value=False)
            return resp

        with patch("app.transcript.urlopen", side_effect=fake_urlopen):
            persist_conversation_metadata(
                conversation_id="conv-123",
                tenant_id="tenant-456",
                latency_metrics={"speech_stop_to_stt_final_ms": 250},
                runtime_snapshot={"language": "en"},
                usage_metrics={
                    "version": 1,
                    "llm": {
                        "prompt_tokens": 10,
                        "completion_tokens": 5,
                        "total_tokens": 15,
                        "call_count": 1,
                    },
                },
                supabase_url="https://example.supabase.co",
                service_role_key="service-role-key-abc",
            )

        assert len(captured_requests) == 1
        req = captured_requests[0]
        assert req.method == "PATCH"
        assert "conv-123" in req.full_url
        assert "tenant-456" in req.full_url
        payload = json.loads(req.data.decode("utf-8"))
        assert payload["latency_metrics"]["speech_stop_to_stt_final_ms"] == 250
        assert payload["runtime_snapshot"]["language"] == "en"
        assert payload["usage_metrics"]["llm"]["total_tokens"] == 15

    def test_finalize_conversation_status_filters_open_statuses(self) -> None:
        captured_requests: list[Any] = []

        def fake_urlopen(req: Any, timeout: int = 15) -> Any:
            captured_requests.append(req)
            resp = MagicMock()
            resp.status = 200
            if req.method == "GET":
                resp.read = MagicMock(
                    return_value=json.dumps(
                        [{"started_at": "2026-08-08T11:59:00+00:00"}]
                    ).encode("utf-8")
                )
            resp.__enter__ = lambda s: s
            resp.__exit__ = MagicMock(return_value=False)
            return resp

        with patch("app.transcript.urlopen", side_effect=fake_urlopen):
            finalize_conversation_status(
                conversation_id="conv-123",
                tenant_id="tenant-456",
                supabase_url="https://example.supabase.co",
                service_role_key="service-role-key-abc",
                ended_at="2026-08-08T12:00:00+00:00",
            )

        assert len(captured_requests) == 2
        get_req, patch_req = captured_requests
        assert get_req.method == "GET"
        assert patch_req.method == "PATCH"
        assert "status=in.(starting,active)" in patch_req.full_url
        payload = json.loads(patch_req.data.decode("utf-8"))
        assert payload["status"] == "completed"
        assert payload["end_reason"] == "worker_session_end"
        assert payload["ended_at"] == "2026-08-08T12:00:00+00:00"
        assert payload["error_code"] is None
        assert payload["error_message"] is None
        assert payload["duration_ms"] == 60_000

