"""Tests for call timeline / latency_metrics v2 builders."""

from __future__ import annotations

import unittest
from unittest.mock import MagicMock

from app.call_timeline import (
    CallTimelineRecorder,
    build_latency_metrics_v2,
    build_rich_aggregates,
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

    def test_stage_rows_split_user_and_assistant_ownership(self) -> None:
        tracker = MagicMock()
        turn = MagicMock()
        turn.turn_id = "s1-t1"
        turn.provider_error = False
        turn.final_transcript_text = "Book me"
        tracker.completed_turns = [turn]
        tracker.summarize_turn.return_value = {
            "turn_id": "s1-t1",
            "status": "completed",
            "speech_stop_to_stt_final_ms": 42,
            "stt_final_to_llm_first_token_ms": 520,
            "llm_first_token_to_first_tts_audio_ms": 133,
            "tts_first_audio_to_bot_speaking_ms": 40,
            "speech_stop_to_bot_speaking_ms": 2210,
            "tool_execution_ms": 1380,
            "tool_name": "create_appointment_request",
            "tool_call_count": 1,
            "bot_speaking_duration_ms": 7600,
            "total_turn_duration_ms": 9800,
        }

        turns = build_turn_diagnostics(tracker)
        stages = turns[0]["stages"]
        labels = [stage["label"] for stage in stages]
        self.assertEqual(labels[0], "speech stop → STT final")
        self.assertEqual(stages[0]["side"], "stt")
        self.assertIn("STT final → LLM first token", labels)
        self.assertIn("LLM first token → TTS first audio", labels)
        self.assertIn("TTS first audio → bot speaking", labels)
        self.assertIn("Response total · speech stop → bot speaking", labels)
        self.assertIn("Appointment tool (nested; do not add)", labels)
        self.assertIn("Bot speaking duration (after response start)", labels)
        self.assertTrue(all(stage["side"] == "assistant" for stage in stages[1:]))

    def test_incomplete_metrics_status_is_not_mapped_to_ok(self) -> None:
        tracker = MagicMock()
        turn = MagicMock()
        turn.turn_id = "s1-t4"
        turn.provider_error = False
        turn.final_transcript_text = "Hello"
        tracker.completed_turns = [turn]
        tracker.summarize_turn.return_value = {
            "turn_id": "s1-t4",
            "status": "incomplete-metrics",
            "speech_stop_to_stt_final_ms": None,
            "stt_final_to_llm_first_token_ms": None,
            "llm_first_token_to_first_tts_audio_ms": None,
            "speech_stop_to_bot_speaking_ms": 9000,
            "bot_speaking_duration_ms": None,
            "total_turn_duration_ms": 1200,
            "tool_execution_ms": None,
        }

        turns = build_turn_diagnostics(tracker)
        self.assertEqual(turns[0]["status"], "incomplete")
        aggregates = build_rich_aggregates(tracker)
        self.assertNotIn("speech_stop_to_bot_speaking_ms", aggregates)
        self.assertNotIn("median_response_latency_ms", aggregates)

    def test_end_session_stage_uses_goodbye_label(self) -> None:
        tracker = MagicMock()
        turn = MagicMock()
        turn.turn_id = "s1-t9"
        turn.provider_error = False
        turn.final_transcript_text = "Goodbye"
        tracker.completed_turns = [turn]
        tracker.summarize_turn.return_value = {
            "turn_id": "s1-t9",
            "status": "end-session",
            "speech_stop_to_stt_final_ms": None,
            "stt_final_to_llm_first_token_ms": None,
            "llm_first_token_to_first_tts_audio_ms": None,
            "speech_stop_to_bot_speaking_ms": None,
            "bot_speaking_duration_ms": 975,
            "total_turn_duration_ms": 1200,
        }

        turns = build_turn_diagnostics(tracker)
        self.assertEqual(turns[0]["status"], "end_session")
        self.assertEqual(len(turns[0]["stages"]), 1)
        self.assertEqual(turns[0]["stages"][0]["label"], "End session · Goodbye played")

    def test_rich_aggregates_include_median_and_extremes(self) -> None:
        tracker = MagicMock()
        turns = []
        for index, response_ms in enumerate((500, 700, 2000), start=1):
            turn = MagicMock()
            turn.turn_id = f"s1-t{index}"
            turns.append(turn)
        tracker.completed_turns = turns
        tracker.summarize_turn.side_effect = [
            {
                "turn_id": "s1-t1",
                "status": "completed",
                "speech_stop_to_stt_final_ms": 40,
                "stt_final_to_llm_first_token_ms": 200,
                "llm_first_token_to_first_tts_audio_ms": 80,
                "speech_stop_to_bot_speaking_ms": 500,
                "bot_speaking_duration_ms": 1000,
                "total_turn_duration_ms": 1500,
                "tool_execution_ms": None,
            },
            {
                "turn_id": "s1-t2",
                "status": "completed",
                "speech_stop_to_stt_final_ms": 50,
                "stt_final_to_llm_first_token_ms": 300,
                "llm_first_token_to_first_tts_audio_ms": 90,
                "speech_stop_to_bot_speaking_ms": 700,
                "bot_speaking_duration_ms": 1100,
                "total_turn_duration_ms": 1800,
                "tool_execution_ms": 1200,
            },
            {
                "turn_id": "s1-t3",
                "status": "completed",
                "speech_stop_to_stt_final_ms": 60,
                "stt_final_to_llm_first_token_ms": 400,
                "llm_first_token_to_first_tts_audio_ms": 100,
                "speech_stop_to_bot_speaking_ms": 2000,
                "bot_speaking_duration_ms": 1200,
                "total_turn_duration_ms": 2500,
                "tool_execution_ms": None,
            },
        ]

        aggregates = build_rich_aggregates(tracker)
        self.assertEqual(aggregates["median_response_latency_ms"], 700)
        self.assertEqual(aggregates["fastest_response_latency_ms"], 500)
        self.assertEqual(aggregates["slowest_response_latency_ms"], 2000)
        self.assertEqual(aggregates["slow_response_count"], 1)
        self.assertEqual(aggregates["total_tool_calls"], 1)

    def test_rich_aggregates_exclude_interrupted_and_error_turns(self) -> None:
        tracker = MagicMock()
        ok_turn = MagicMock()
        ok_turn.turn_id = "s1-t1"
        ok_turn.provider_error = False
        interrupted_turn = MagicMock()
        interrupted_turn.turn_id = "s1-t2"
        interrupted_turn.provider_error = False
        error_turn = MagicMock()
        error_turn.turn_id = "s1-t3"
        error_turn.provider_error = True
        tracker.completed_turns = [ok_turn, interrupted_turn, error_turn]
        tracker.summarize_turn.side_effect = [
            {
                "turn_id": "s1-t1",
                "status": "completed",
                "speech_stop_to_stt_final_ms": 45,
                "speech_stop_to_bot_speaking_ms": 650,
            },
            {
                "turn_id": "s1-t2",
                "status": "interrupted",
                "speech_stop_to_stt_final_ms": 400,
                "speech_stop_to_bot_speaking_ms": 5200,
            },
            {
                "turn_id": "s1-t3",
                "status": "provider-error",
                "speech_stop_to_stt_final_ms": 900,
                "speech_stop_to_bot_speaking_ms": 8100,
            },
        ]

        aggregates = build_rich_aggregates(tracker)
        self.assertEqual(aggregates["average_response_latency_ms"], 650)
        self.assertEqual(aggregates["median_response_latency_ms"], 650)
        self.assertEqual(aggregates["response_sample_count"], 1)
        self.assertEqual(aggregates["speech_stop_to_stt_final_ms"], 45)


if __name__ == "__main__":
    unittest.main()
