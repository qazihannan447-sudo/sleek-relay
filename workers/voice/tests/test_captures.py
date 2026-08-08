from __future__ import annotations

import unittest
from unittest import mock

from app.captures import (
    CaptureToolController,
    build_capture_tool_schemas,
    build_capture_url,
    post_conversation_capture,
)
from app.runtime_config import parse_portal_runtime_package
from tests.test_runtime_config import RuntimeConfigFixtureMixin


class CaptureClientTests(unittest.TestCase):
    def test_build_capture_url(self) -> None:
        self.assertEqual(
            build_capture_url(
                "http://localhost:3000/",
                "aaaaaaaa-5000-4000-8000-000000000001",
            ),
            "http://localhost:3000/api/voice/conversations/aaaaaaaa-5000-4000-8000-000000000001/captures",
        )

    def test_post_conversation_capture_returns_tool_result(self) -> None:
        class FakeResponse:
            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

            def read(self) -> bytes:
                return b'{"result":{"ok":true,"captureId":"cap-1","captureType":"lead","status":"captured"}}'

        with mock.patch("urllib.request.urlopen", return_value=FakeResponse()):
            result = post_conversation_capture(
                portal_base_url="http://localhost:3000",
                conversation_id="aaaaaaaa-5000-4000-8000-000000000001",
                session_token="token",
                tool="capture_lead",
                args={"name": "Habiba"},
                idempotency_key="lead-1",
            )

        self.assertEqual(result["ok"], True)
        self.assertEqual(result["captureId"], "cap-1")


class CaptureToolRegistrationTests(RuntimeConfigFixtureMixin, unittest.IsolatedAsyncioTestCase):
    def test_parse_enabled_tools_includes_capture_tools(self) -> None:
        package = self._runtime_package()
        package["enabledTools"] = ["capture_lead", "capture_message", "end_session"]
        runtime_config = parse_portal_runtime_package(
            package,
            worker_config=self._worker_config(),
        )
        self.assertEqual(
            runtime_config.enabledTools,
            ("capture_lead", "capture_message", "end_session"),
        )

    def test_build_capture_tool_schemas_registers_enabled_tools_only(self) -> None:
        modules = {
            "FunctionSchema": lambda **kwargs: kwargs,
            "FunctionCallResultProperties": object,
        }
        controller = CaptureToolController(
            modules,
            conversation_id="aaaaaaaa-5000-4000-8000-000000000001",
            portal_base_url="http://localhost:3000",
            session_token="token",
        )
        tools = build_capture_tool_schemas(
            modules,
            controller,
            ("capture_lead", "end_session"),
        )
        self.assertEqual(len(tools), 1)
        self.assertEqual(tools[0]["name"], "capture_lead")

    def test_build_capture_tool_schemas_marks_configured_fields_required(self) -> None:
        modules = {
            "FunctionSchema": lambda **kwargs: kwargs,
            "FunctionCallResultProperties": object,
        }
        controller = CaptureToolController(
            modules,
            conversation_id="aaaaaaaa-5000-4000-8000-000000000001",
            portal_base_url="http://localhost:3000",
            session_token="token",
        )
        tools = build_capture_tool_schemas(
            modules,
            controller,
            ("capture_lead",),
            lead_fields=("name", "phone", "notes"),
        )
        self.assertEqual(tools[0]["required"], ["name", "phone"])

    def test_build_capture_tool_schemas_registers_appointment_request(self) -> None:
        modules = {
            "FunctionSchema": lambda **kwargs: kwargs,
            "FunctionCallResultProperties": object,
        }
        controller = CaptureToolController(
            modules,
            conversation_id="aaaaaaaa-5000-4000-8000-000000000001",
            portal_base_url="http://localhost:3000",
            session_token="token",
        )
        tools = build_capture_tool_schemas(
            modules,
            controller,
            ("create_appointment_request", "end_session"),
        )
        self.assertEqual(len(tools), 1)
        self.assertEqual(tools[0]["name"], "create_appointment_request")
        self.assertEqual(
            tools[0]["required"],
            ["name", "preferredTime"],
        )
        self.assertIn("Never say they are booked", tools[0]["description"])

    def test_build_capture_tool_schemas_registers_human_handoff(self) -> None:
        modules = {
            "FunctionSchema": lambda **kwargs: kwargs,
            "FunctionCallResultProperties": object,
        }
        controller = CaptureToolController(
            modules,
            conversation_id="aaaaaaaa-5000-4000-8000-000000000001",
            portal_base_url="http://localhost:3000",
            session_token="token",
        )
        tools = build_capture_tool_schemas(
            modules,
            controller,
            ("offer_human_handoff", "end_session"),
        )
        self.assertEqual(len(tools), 1)
        self.assertEqual(tools[0]["name"], "offer_human_handoff")
        self.assertEqual(tools[0]["required"], ["reason"])
        self.assertIn("Never claim a live transfer", tools[0]["description"])

    async def test_capture_tool_handler_posts_to_portal(self) -> None:
        posted: dict[str, object] = {}

        def fake_post(**kwargs):
            posted.update(kwargs)
            return {
                "ok": True,
                "captureId": "cap-1",
                "captureType": "lead",
                "status": "captured",
            }

        class FakeProperties:
            def __init__(self, **kwargs):
                self.kwargs = kwargs

        modules = {"FunctionCallResultProperties": FakeProperties}
        controller = CaptureToolController(
            modules,
            conversation_id="aaaaaaaa-5000-4000-8000-000000000001",
            portal_base_url="http://localhost:3000",
            session_token="token",
            post_capture=fake_post,
        )

        callback_payload: dict[str, object] = {}

        async def result_callback(result, properties=None):
            callback_payload["result"] = result
            callback_payload["properties"] = properties

        params = mock.Mock()
        params.arguments = {"name": "Habiba", "phone": "03055780214"}
        params.result_callback = result_callback

        await controller.handle_capture_tool_call(params, tool="capture_lead")

        self.assertEqual(posted["tool"], "capture_lead")
        self.assertEqual(posted["args"]["name"], "Habiba")
        self.assertEqual(callback_payload["result"]["ok"], True)


if __name__ == "__main__":
    unittest.main()
