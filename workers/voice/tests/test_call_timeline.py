"""Tests for call timeline / latency_metrics v2 builders."""

from __future__ import annotations

import unittest
from unittest.mock import MagicMock

from app.call_timeline import (
    CallTimelineRecorder,
    build_latency_metrics_v2,
    build_turn_diagnostics,
)


class TestCallTimelineRecorder(unittest.TestCase):
    def test_records_session_rails_and_failure(self) -> None:
        timeline = CallTimelineRecorder()
        timeline.session_started(at="2026-08-08T07:01:03+00:00")
        timeline.greeting_played(at="2026-08-08T07:01:04+00:00")
        timeline.provider_retry(retry_count=2)
        timeline.session_failed(
            stage="stt",
            error_code="deepgram_startup_exhausted",
            caller_heard="I am having trouble hearing you.",
            turn_id="s1-t1",
            at="2026-08-08T07:01:22+00:00",
        )
        timeline.session_ended(end_reason="provider_error")

        events = timeline.events()
        self.assertEqual(
            [event["type"] for event in events],
            [
                "session_started",
                "greeting_played",
                "provider_retry",
                "session_failed",
                "session_ended",
            ],
        )
        self.assertEqual(timeline.failure["stage"], "stt")
        self.assertEqual(timeline.failure["turnId"], "s1-t1")


class TestTurnDiagnostics(unittest.TestCase):
    def test_links_user_and_assistant_sequences(self) -> None:
        tracker = MagicMock()
        turn = MagicMock()
        turn.turn_id = "s1-t1"
        turn.provider_error = False
        turn.final_transcript_text = "What are your hours?"
        tracker.completed_turns = [turn]
        tracker.summarize_turn.return_value = {
            "turn_id": "s1-t1",
            "status": "completed",
            "speech_stop_to_stt_final_ms": 410,
            "stt_final_to_llm_first_token_ms": 40,
            "llm_first_token_to_first_tts_audio_ms": 90,
            "speech_stop_to_bot_speaking_ms": 1050,
            "bot_speaking_duration_ms": 1400,
            "total_turn_duration_ms": 2100,
        }

        turns = build_turn_diagnostics(
            tracker,
            message_rows=[
                {"sequence_number": 1, "role": "assistant", "content": "Hello"},
                {
                    "sequence_number": 2,
                    "role": "user",
                    "content": "What are your hours?",
                },
                {
                    "sequence_number": 3,
                    "role": "assistant",
                    "content": "We are open Saturday 9 to 2.",
                },
            ],
        )

        self.assertEqual(len(turns), 1)
        self.assertEqual(turns[0]["userMessageSeq"], 2)
        self.assertEqual(turns[0]["assistantMessageSeq"], 3)
        self.assertEqual(turns[0]["metrics"]["speechStopToSttFinalMs"], 410)

    def test_provider_error_turn_marks_stt_failure(self) -> None:
        tracker = MagicMock()
        turn = MagicMock()
        turn.turn_id = "s1-t3"
        turn.provider_error = True
        turn.final_transcript_text = None
        tracker.completed_turns = [turn]
        tracker.summarize_turn.return_value = {
            "turn_id": "s1-t3",
            "status": "provider-error",
            "speech_stop_to_stt_final_ms": None,
            "stt_final_to_llm_first_token_ms": None,
            "llm_first_token_to_first_tts_audio_ms": None,
            "speech_stop_to_bot_speaking_ms": None,
            "bot_speaking_duration_ms": None,
            "total_turn_duration_ms": 1200,
        }

        timeline = CallTimelineRecorder()
        timeline.session_failed(
            stage="stt",
            error_code="deepgram_startup_exhausted",
            turn_id="s1-t3",
        )
        payload = build_latency_metrics_v2(tracker, timeline=timeline)
        self.assertEqual(payload["turns"][0]["status"], "error")
        self.assertEqual(payload["turns"][0]["failureStage"], "stt")
        self.assertEqual(payload["failure"]["stage"], "stt")

    def test_does_not_invent_top_level_failure_from_turns_alone(self) -> None:
        tracker = MagicMock()
        turn = MagicMock()
        turn.turn_id = "s1-t3"
        turn.provider_error = True
        turn.final_transcript_text = None
        tracker.completed_turns = [turn]
        tracker.summarize_turn.return_value = {
            "turn_id": "s1-t3",
            "status": "provider-error",
            "speech_stop_to_stt_final_ms": None,
            "stt_final_to_llm_first_token_ms": None,
            "llm_first_token_to_first_tts_audio_ms": None,
            "speech_stop_to_bot_speaking_ms": None,
            "bot_speaking_duration_ms": None,
            "total_turn_duration_ms": 1200,
        }

        payload = build_latency_metrics_v2(tracker)
        self.assertEqual(payload["turns"][0]["failureStage"], "stt")
        self.assertIsNone(payload["failure"])

    def test_user_link_requires_exact_transcript_match(self) -> None:
        tracker = MagicMock()
        turn = MagicMock()
        turn.turn_id = "s1-t1"
        turn.provider_error = False
        turn.final_transcript_text = "What are your hours?"
        tracker.completed_turns = [turn]
        tracker.summarize_turn.return_value = {
            "turn_id": "s1-t1",
            "status": "completed",
            "speech_stop_to_stt_final_ms": 410,
            "stt_final_to_llm_first_token_ms": 40,
            "llm_first_token_to_first_tts_audio_ms": 90,
            "speech_stop_to_bot_speaking_ms": 1050,
            "bot_speaking_duration_ms": 1400,
            "total_turn_duration_ms": 2100,
        }

        turns = build_turn_diagnostics(
            tracker,
            message_rows=[
                {
                    "sequence_number": 1,
                    "role": "user",
                    "content": "Something else entirely",
                },
                {
                    "sequence_number": 2,
                    "role": "assistant",
                    "content": "We are open Saturday 9 to 2.",
                },
            ],
        )
        self.assertNotIn("userMessageSeq", turns[0])
        self.assertNotIn("assistantMessageSeq", turns[0])
        self.assertEqual(turns[0]["userTranscript"], "What are your hours?")

if __name__ == "__main__":
    unittest.main()
