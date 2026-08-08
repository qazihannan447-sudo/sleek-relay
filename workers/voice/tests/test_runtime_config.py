from __future__ import annotations

import copy
import os
import unittest
from unittest import mock

from app.config import VoiceWorkerConfig
from app.prompt import SYSTEM_PROMPT
from app.runtime_config import (
    ENV_FALLBACK_AGENT_ID,
    ENV_FALLBACK_RUNTIME_PACKAGE_VERSION,
    RuntimeConfigLoadError,
    RuntimeConfigValidationError,
    build_env_fallback_runtime_config,
    build_runtime_config,
    extract_voice_session_token,
    load_session_runtime_config,
    parse_portal_runtime_package,
    parse_portal_runtime_package_response,
)


class RuntimeConfigFixtureMixin:
    def _worker_config(self) -> VoiceWorkerConfig:
        return VoiceWorkerConfig(
            host="127.0.0.1",
            port=8000,
            runner_host="127.0.0.1",
            runner_port=7860,
            runner_transport="webrtc",
            deepgram_api_key="dg-key",
            deepgram_model="flux-general-en",
            google_api_key="google-key",
            google_model="gemini-2.5-flash",
            cartesia_api_key="cartesia-key",
            cartesia_model="sonic-3.5",
            cartesia_voice_id="voice-default",
        )

    def _runtime_package(self) -> dict[str, object]:
        return copy.deepcopy(
            {
                "agent": {
                    "fallbackMessage": "Please leave a message after the tone.",
                    "greeting": "Thanks for calling Greenleaf Dental.",
                    "id": "22222222-2222-2222-2222-222222222222",
                    "interruptionEnabled": True,
                    "language": "en",
                    "maximumSessionDurationSeconds": 900,
                    "name": "Front Desk Assistant",
                    "role": "Reception",
                    "silenceTimeoutSeconds": 8,
                    "specialInstructions": "Keep answers concise.",
                    "status": "active",
                    "tone": "Warm",
                    "voiceId": "voice-alpha",
                },
                "business": {
                    "businessHours": {
                        "fri": {"close": "17:00", "closed": False, "open": "09:00"},
                        "mon": {"close": "17:00", "closed": False, "open": "09:00"},
                        "sat": {"close": None, "closed": True, "open": None},
                        "sun": {"close": None, "closed": True, "open": None},
                        "thu": {"close": "17:00", "closed": False, "open": "09:00"},
                        "tue": {"close": "17:00", "closed": False, "open": "09:00"},
                        "wed": {"close": "17:00", "closed": False, "open": "09:00"},
                    },
                    "businessName": "Greenleaf Dental",
                    "businessPhone": "+1-555-0101",
                    "category": "Dental Clinic",
                    "contactEmail": "frontdesk@greenleaf.example.com",
                    "contactName": "Alex",
                    "timezone": "America/Chicago",
                    "website": "https://greenleaf.example.com",
                },
                "generatedAt": "2026-08-06T12:00:00.000Z",
                "groundingRules": [
                    "Use only approved tenant business information.",
                    "Do not invent unavailable facts.",
                ],
                "knowledge": [
                    {
                        "content": "Greenleaf Dental accepts new patients.",
                        "id": "knowledge-1",
                        "kind": "faq",
                        "title": "New patient policy",
                    },
                    {
                        "content": "Saturday appointments are not available.",
                        "id": "knowledge-2",
                        "kind": "policy",
                        "title": "Weekend hours",
                    },
                ],
                "promptText": (
                    "Tenant: Greenleaf Dental\n"
                    "Agent name: Front Desk Assistant\n"
                    "Approved tenant knowledge:\n"
                    "- [faq] New patient policy: Greenleaf Dental accepts new patients."
                ),
                "tenant": {
                    "id": "11111111-1111-1111-1111-111111111111",
                    "name": "Greenleaf Dental",
                    "slug": "greenleaf-dental",
                },
            }
        )


class RuntimeConfigTests(RuntimeConfigFixtureMixin, unittest.TestCase):
    def test_parse_portal_runtime_package_accepts_valid_runtime_shape(self) -> None:
        runtime_config = parse_portal_runtime_package(
            self._runtime_package(),
            worker_config=self._worker_config(),
        )

        self.assertEqual(runtime_config.tenant.id, "11111111-1111-1111-1111-111111111111")
        self.assertEqual(runtime_config.agent.id, "22222222-2222-2222-2222-222222222222")
        self.assertEqual(runtime_config.agent.name, "Front Desk Assistant")
        self.assertEqual(runtime_config.agent.language, "en")
        self.assertEqual(runtime_config.agent.voiceId, "voice-alpha")
        self.assertEqual(runtime_config.agent.idleTimeoutEnabled, True)
        self.assertEqual(runtime_config.agent.idleCheckInSeconds, 30)
        self.assertEqual(runtime_config.agent.idleEndSeconds, 60)
        self.assertEqual(runtime_config.business.businessName, "Greenleaf Dental")
        self.assertEqual(runtime_config.knowledgeItemCount, 2)
        self.assertEqual(runtime_config.promptText.startswith("Tenant: Greenleaf"), True)
        self.assertEqual(runtime_config.runtimePackageVersion, None)

    def test_env_fallback_configuration_preserves_current_local_defaults(self) -> None:
        runtime_config = build_env_fallback_runtime_config(self._worker_config())

        self.assertEqual(runtime_config.source, "env-fallback")
        self.assertEqual(runtime_config.agent.id, ENV_FALLBACK_AGENT_ID)
        self.assertEqual(runtime_config.agent.language, "en")
        self.assertEqual(runtime_config.agent.greeting, "")
        self.assertEqual(runtime_config.agent.voiceId, "voice-default")
        self.assertEqual(runtime_config.agent.silenceTimeoutSeconds, 0.25)
        self.assertEqual(runtime_config.agent.maximumSessionDurationSeconds, None)
        self.assertEqual(runtime_config.agent.idleTimeoutEnabled, True)
        self.assertEqual(runtime_config.agent.idleCheckInSeconds, 30)
        self.assertEqual(runtime_config.agent.idleEndSeconds, 60)
        self.assertEqual(
            runtime_config.agent.idleCheckInMessage,
            "Hello, are you there?",
        )
        self.assertEqual(runtime_config.promptText, SYSTEM_PROMPT)
        self.assertEqual(runtime_config.runtimePackageVersion, ENV_FALLBACK_RUNTIME_PACKAGE_VERSION)
        self.assertEqual(runtime_config.knowledgeItemCount, 0)

    def test_invalid_uuids_are_rejected(self) -> None:
        runtime_package = self._runtime_package()
        runtime_package["tenant"]["id"] = "not-a-uuid"

        with self.assertRaisesRegex(
            RuntimeConfigValidationError,
            "tenant.id must be a valid UUID.",
        ):
            parse_portal_runtime_package(runtime_package, worker_config=self._worker_config())

    def test_blank_required_fields_are_rejected(self) -> None:
        runtime_package = self._runtime_package()
        runtime_package["agent"]["name"] = "   "

        with self.assertRaisesRegex(RuntimeConfigValidationError, "name is required."):
            parse_portal_runtime_package(runtime_package, worker_config=self._worker_config())

    def test_unsupported_language_is_rejected(self) -> None:
        runtime_package = self._runtime_package()
        runtime_package["agent"]["language"] = "ur"

        with self.assertRaisesRegex(
            RuntimeConfigValidationError,
            "agent.language is not supported by the current worker.",
        ):
            parse_portal_runtime_package(runtime_package, worker_config=self._worker_config())

    def test_timeout_boundaries_are_enforced(self) -> None:
        runtime_package = self._runtime_package()
        runtime_package["agent"]["silenceTimeoutSeconds"] = 0.19

        with self.assertRaisesRegex(
            RuntimeConfigValidationError,
            "silenceTimeoutSeconds must be between 0.2 and 120 seconds.",
        ):
            parse_portal_runtime_package(runtime_package, worker_config=self._worker_config())

        runtime_package = self._runtime_package()
        runtime_package["agent"]["maximumSessionDurationSeconds"] = 7_201

        with self.assertRaisesRegex(
            RuntimeConfigValidationError,
            "maximumSessionDurationSeconds must be between 60 and 7200 seconds.",
        ):
            parse_portal_runtime_package(runtime_package, worker_config=self._worker_config())

    def test_fractional_silence_timeout_override_is_preserved(self) -> None:
        runtime_package = self._runtime_package()
        runtime_package["agent"]["silenceTimeoutSeconds"] = 0.22

        runtime_config = parse_portal_runtime_package(
            runtime_package,
            worker_config=self._worker_config(),
        )

        self.assertEqual(runtime_config.agent.silenceTimeoutSeconds, 0.22)

    def test_prompt_and_knowledge_size_limits_are_enforced(self) -> None:
        runtime_package = self._runtime_package()
        runtime_package["promptText"] = "A" * 20_001

        with self.assertRaisesRegex(RuntimeConfigValidationError, "promptText is too large."):
            parse_portal_runtime_package(runtime_package, worker_config=self._worker_config())

        runtime_package = self._runtime_package()
        runtime_package["knowledge"] = [
            {
                "content": "K" * 3_500,
                "id": f"knowledge-{index}",
                "kind": "faq",
                "title": f"Knowledge {index}",
            }
            for index in range(1, 6)
        ]

        with self.assertRaisesRegex(RuntimeConfigValidationError, "knowledge content is too large"):
            parse_portal_runtime_package(runtime_package, worker_config=self._worker_config())

    def test_secret_like_fields_are_rejected(self) -> None:
        runtime_package = self._runtime_package()
        runtime_package["agent"]["apiKey"] = "should-not-be-accepted"

        with self.assertRaisesRegex(
            RuntimeConfigValidationError,
            "forbidden secret-like fields",
        ):
            parse_portal_runtime_package(runtime_package, worker_config=self._worker_config())

    def test_runtime_snapshot_is_allowlisted(self) -> None:
        runtime_config = parse_portal_runtime_package(
            self._runtime_package(),
            worker_config=self._worker_config(),
        )

        snapshot = runtime_config.to_runtime_snapshot()

        self.assertEqual(
            set(snapshot),
            {
                "agent_id",
                "agent_name",
                "business_name",
                "enabled_tools",
                "interruption_enabled",
                "knowledge_item_count",
                "language",
                "llm_model",
                "maximum_session_duration_seconds",
                "role",
                "silence_timeout_seconds",
                "stt_model",
                "tts_model",
                "voice_id",
            },
        )
        self.assertEqual(snapshot["voice_id"], "voice-alpha")
        self.assertEqual(snapshot["enabled_tools"], ["end_session"])

    def test_full_prompt_is_excluded_from_runtime_snapshot(self) -> None:
        runtime_config = parse_portal_runtime_package(
            self._runtime_package(),
            worker_config=self._worker_config(),
        )

        snapshot = runtime_config.to_runtime_snapshot()

        self.assertNotIn("promptText", snapshot)
        self.assertNotIn("prompt_text", snapshot)
        self.assertNotIn("knowledge", snapshot)
        self.assertNotIn("groundingRules", snapshot)

    def test_two_simultaneous_runtime_configurations_remain_isolated(self) -> None:
        runtime_package_a = self._runtime_package()
        runtime_package_b = self._runtime_package()
        runtime_package_b["agent"]["voiceId"] = "voice-bravo"
        runtime_package_b["promptText"] = "Tenant: Greenleaf\nAgent name: Backup Assistant"

        runtime_config_a = parse_portal_runtime_package(
            runtime_package_a,
            worker_config=self._worker_config(),
        )
        runtime_config_b = parse_portal_runtime_package(
            runtime_package_b,
            worker_config=self._worker_config(),
        )

        self.assertEqual(runtime_config_a.agent.voiceId, "voice-alpha")
        self.assertEqual(runtime_config_b.agent.voiceId, "voice-bravo")
        self.assertNotEqual(runtime_config_a.promptText, runtime_config_b.promptText)

    def test_reconnect_creates_fresh_configuration_state(self) -> None:
        runtime_config_a = build_runtime_config(self._worker_config())
        runtime_config_b = build_runtime_config(self._worker_config())

        self.assertIsNot(runtime_config_a, runtime_config_b)
        snapshot_a = runtime_config_a.to_runtime_snapshot()
        snapshot_b = runtime_config_b.to_runtime_snapshot()
        snapshot_a["voice_id"] = "mutated"

        self.assertEqual(runtime_config_a.agent.voiceId, "voice-default")
        self.assertEqual(snapshot_b["voice_id"], "voice-default")

    def test_source_runtime_package_mutation_does_not_leak_into_parsed_session(self) -> None:
        runtime_package = self._runtime_package()
        runtime_config = parse_portal_runtime_package(
            runtime_package,
            worker_config=self._worker_config(),
        )

        runtime_package["agent"]["voiceId"] = "voice-mutated"
        runtime_package["promptText"] = "changed"

        self.assertEqual(runtime_config.agent.voiceId, "voice-alpha")
        self.assertNotEqual(runtime_config.promptText, "changed")

    def test_blank_voice_id_uses_env_fallback_voice(self) -> None:
        runtime_package = self._runtime_package()
        runtime_package["agent"]["voiceId"] = ""

        runtime_config = parse_portal_runtime_package(
            runtime_package,
            worker_config=self._worker_config(),
        )

        self.assertEqual(runtime_config.agent.voiceId, "voice-default")

    def test_unknown_fields_are_ignored_when_safe(self) -> None:
        runtime_package = self._runtime_package()
        runtime_package["debugLabel"] = "local-only"
        runtime_package["agent"]["safeExtra"] = "ignored"

        runtime_config = parse_portal_runtime_package(
            runtime_package,
            worker_config=self._worker_config(),
        )

        self.assertEqual(runtime_config.agent.name, "Front Desk Assistant")

    def test_extract_voice_session_token_reads_top_level_and_metadata_fields(self) -> None:
        self.assertEqual(
            extract_voice_session_token({"voiceSessionToken": "token-top-level"}),
            "token-top-level",
        )
        self.assertEqual(
            extract_voice_session_token(
                {"metadata": {"voice_session_token": "token-in-metadata"}}
            ),
            "token-in-metadata",
        )
        self.assertEqual(
            extract_voice_session_token(
                {"body": {"voiceSessionToken": "token-in-nested-body"}}
            ),
            "token-in-nested-body",
        )
        self.assertIsNone(extract_voice_session_token({"metadata": {"voiceSessionToken": "   "}}))

    def test_parse_portal_runtime_package_response_requires_runtime_package(self) -> None:
        with self.assertRaisesRegex(
            RuntimeConfigValidationError,
            "runtimePackage must be an object.",
        ):
            parse_portal_runtime_package_response(
                {"conversationId": "11111111-1111-1111-1111-111111111111"},
                worker_config=self._worker_config(),
            )


class RuntimeConfigLoadingTests(RuntimeConfigFixtureMixin, unittest.IsolatedAsyncioTestCase):
    async def test_load_session_runtime_config_uses_env_fallback_when_no_token_is_present(self) -> None:
        with mock.patch.dict(os.environ, {"VOICE_ALLOW_ENV_FALLBACK": "1"}, clear=False):
            runtime_config = await load_session_runtime_config(
                self._worker_config(),
                {"enableMic": True},
                portal_base_url="https://portal.example",
                fetch_runtime_package=mock.Mock(side_effect=AssertionError("should not fetch")),
            )

        self.assertEqual(runtime_config.source, "env-fallback")
        self.assertEqual(runtime_config.promptText, SYSTEM_PROMPT)

    async def test_load_session_runtime_config_refuses_env_fallback_without_opt_in(self) -> None:
        with mock.patch.dict(os.environ, {"VOICE_ALLOW_ENV_FALLBACK": ""}, clear=False):
            with self.assertRaisesRegex(
                RuntimeConfigLoadError,
                "Voice session setup is unavailable right now.",
            ):
                await load_session_runtime_config(
                    self._worker_config(),
                    {"enableMic": True},
                    portal_base_url="https://portal.example",
                    fetch_runtime_package=mock.Mock(
                        side_effect=AssertionError("should not fetch")
                    ),
                )

    async def test_load_session_runtime_config_fetches_and_parses_portal_runtime_package(self) -> None:
        fetch_calls: list[tuple[str, str]] = []

        def fetch_runtime_package(url: str, token: str) -> dict[str, object]:
            fetch_calls.append((url, token))
            return {
                "conversationId": "33333333-3333-3333-3333-333333333333",
                "runtimePackage": self._runtime_package(),
            }

        runtime_config = await load_session_runtime_config(
            self._worker_config(),
            {"metadata": {"voiceSessionToken": "token-123"}},
            portal_base_url="https://portal.example/",
            fetch_runtime_package=fetch_runtime_package,
        )

        self.assertEqual(
            fetch_calls,
            [("https://portal.example/api/voice/runtime-config", "token-123")],
        )
        self.assertEqual(runtime_config.source, "portal-runtime-package")
        self.assertEqual(runtime_config.agent.voiceId, "voice-alpha")
        self.assertTrue(runtime_config.promptText.startswith("Tenant: Greenleaf"))

    async def test_load_session_runtime_config_requires_portal_base_url_when_token_is_present(self) -> None:
        with self.assertRaisesRegex(
            RuntimeConfigLoadError,
            "Voice session setup is unavailable right now.",
        ):
            await load_session_runtime_config(
                self._worker_config(),
                {"voiceSessionToken": "token-123"},
                portal_base_url="   ",
            )

    async def test_load_session_runtime_config_returns_safe_error_when_portal_fetch_fails(self) -> None:
        with self.assertRaisesRegex(
            RuntimeConfigLoadError,
            "The requested voice session is unavailable.",
        ):
            await load_session_runtime_config(
                self._worker_config(),
                {"voiceSessionToken": "token-123"},
                portal_base_url="https://portal.example",
                fetch_runtime_package=mock.Mock(
                    side_effect=RuntimeConfigLoadError(
                        "The requested voice session is unavailable."
                    )
                ),
            )

    async def test_load_session_runtime_config_uses_embedded_package_without_portal_fetch(
        self,
    ) -> None:
        conversation_id = "33333333-3333-3333-3333-333333333333"
        token = (
            "x."
            "eyJzdWIiOiAiMzMzMzMzMzMtMzMzMy0zMzMzLTMzMzMtMzMzMzMzMzMzMzMzIiwgImNvbnZlcnNhdGlvbklkIjogIjMzMzMzMzMzLTMzMzMtMzMzMy0zMzMzLTMzMzMzMzMzMzMzMyJ9"
            ".y"
        )

        runtime_config = await load_session_runtime_config(
            self._worker_config(),
            {
                "voiceSessionToken": token,
                "conversationId": conversation_id,
                "runtimePackage": self._runtime_package(),
            },
            portal_base_url="https://portal.example",
            fetch_runtime_package=mock.Mock(
                side_effect=AssertionError("should not fetch")
            ),
        )

        self.assertEqual(runtime_config.source, "portal-runtime-package")
        self.assertEqual(runtime_config.conversation_id, conversation_id)
        self.assertEqual(runtime_config.agent.greeting, "Thanks for calling Greenleaf Dental.")

    async def test_load_session_runtime_config_unwraps_nested_start_body_payload(
        self,
    ) -> None:
        conversation_id = "33333333-3333-3333-3333-333333333333"
        token = (
            "x."
            "eyJzdWIiOiAiMzMzMzMzMzMtMzMzMy0zMzMzLTMzMzMtMzMzMzMzMzMzMzMzIiwgImNvbnZlcnNhdGlvbklkIjogIjMzMzMzMzMzLTMzMzMtMzMzMy0zMzMzLTMzMzMzMzMzMzMzMyJ9"
            ".y"
        )

        runtime_config = await load_session_runtime_config(
            self._worker_config(),
            {
                "body": {
                    "voiceSessionToken": token,
                    "conversationId": conversation_id,
                    "runtimePackage": self._runtime_package(),
                }
            },
            portal_base_url="https://portal.example",
            fetch_runtime_package=mock.Mock(
                side_effect=AssertionError("should not fetch")
            ),
        )

        self.assertEqual(runtime_config.source, "portal-runtime-package")
        self.assertEqual(runtime_config.conversation_id, conversation_id)
        self.assertEqual(runtime_config.agent.name, "Front Desk Assistant")

    async def test_load_session_runtime_config_uses_embedded_package_when_jwt_decode_fails(
        self,
    ) -> None:
        conversation_id = "33333333-3333-3333-3333-333333333333"

        runtime_config = await load_session_runtime_config(
            self._worker_config(),
            {
                "voiceSessionToken": "not-a-jwt",
                "conversationId": conversation_id,
                "runtimePackage": self._runtime_package(),
            },
            portal_base_url="https://portal.example",
            fetch_runtime_package=mock.Mock(
                side_effect=AssertionError("should not fetch")
            ),
        )

        self.assertEqual(runtime_config.source, "portal-runtime-package")
        self.assertEqual(runtime_config.conversation_id, conversation_id)
        self.assertEqual(runtime_config.agent.name, "Front Desk Assistant")


if __name__ == "__main__":
    unittest.main()
