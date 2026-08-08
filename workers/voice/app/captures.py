"""Portal capture API client and Pipecat tool handlers for lead/message/appointment capture."""

from __future__ import annotations

import json
import logging
import urllib.error
import urllib.request
from typing import Any, Mapping
from uuid import uuid4

LOGGER = logging.getLogger(__name__)

CAPTURE_TOOL_NAMES = frozenset(
    {
        "capture_lead",
        "capture_message",
        "create_appointment_request",
        "offer_human_handoff",
    }
)


def build_capture_url(portal_base_url: str, conversation_id: str) -> str:
    base = portal_base_url.rstrip("/")
    return f"{base}/api/voice/conversations/{conversation_id}/captures"


def post_conversation_capture(
    *,
    portal_base_url: str,
    conversation_id: str,
    session_token: str,
    tool: str,
    args: Mapping[str, Any],
    idempotency_key: str | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "tool": tool,
        "args": dict(args),
    }
    if idempotency_key:
        payload["idempotencyKey"] = idempotency_key

    request = urllib.request.Request(
        build_capture_url(portal_base_url, conversation_id),
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Accept": "application/json",
            "Authorization": f"Bearer {session_token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            body = response.read().decode("utf-8")
            parsed = json.loads(body) if body else {}
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8") if exc.fp is not None else ""
        try:
            parsed = json.loads(body) if body else {}
        except json.JSONDecodeError:
            parsed = {}
        result = parsed.get("result")
        if isinstance(result, Mapping):
            return dict(result)
        return {
            "ok": False,
            "error": "persist_failed",
            "message": parsed.get("error")
            if isinstance(parsed.get("error"), str)
            else f"Capture request failed with HTTP {exc.code}.",
        }
    except Exception as exc:  # noqa: BLE001
        LOGGER.warning("voice worker: capture request failed error=%s", exc)
        return {
            "ok": False,
            "error": "persist_failed",
            "message": "Unable to reach the capture service.",
        }

    if not isinstance(parsed, Mapping):
        return {
            "ok": False,
            "error": "persist_failed",
            "message": "Capture service returned an invalid response.",
        }

    result = parsed.get("result")
    if isinstance(result, Mapping):
        return dict(result)

    return {
        "ok": False,
        "error": "persist_failed",
        "message": parsed.get("error")
        if isinstance(parsed.get("error"), str)
        else "Capture service returned an invalid response.",
    }


class CaptureToolController:
    def __init__(
        self,
        modules: Mapping[str, object],
        *,
        conversation_id: str | None,
        portal_base_url: str | None,
        session_token: str | None,
        timeline: object | None = None,
        post_capture: Any | None = None,
    ) -> None:
        self._function_call_result_properties_cls = modules[
            "FunctionCallResultProperties"
        ]
        self._conversation_id = conversation_id
        self._portal_base_url = portal_base_url
        self._session_token = session_token
        self._timeline = timeline
        self._post_capture = post_capture or post_conversation_capture

    def _record_timeline(self, *, tool: str, status: str, detail: str | None = None) -> None:
        if self._timeline is None:
            return
        record = getattr(self._timeline, "record_session_event", None)
        if not callable(record):
            return
        try:
            record(
                event=f"tool_{status}",
                detail=detail or tool,
                stage="tool",
            )
        except Exception:  # noqa: BLE001
            LOGGER.debug("voice worker: capture timeline record failed", exc_info=True)

    async def handle_capture_tool_call(self, params: object, *, tool: str) -> None:
        arguments = getattr(params, "arguments", {}) or {}
        result_callback = getattr(params, "result_callback")
        if not isinstance(arguments, Mapping):
            arguments = {}

        self._record_timeline(tool=tool, status="started")

        if (
            not self._conversation_id
            or not self._portal_base_url
            or not self._session_token
        ):
            result = {
                "ok": False,
                "error": "persist_failed",
                "message": "Capture is unavailable without a portal session.",
            }
            self._record_timeline(tool=tool, status="failed", detail="missing_session")
            await result_callback(
                result,
                properties=self._function_call_result_properties_cls(run_llm=True),
            )
            return

        idempotency_key = arguments.get("idempotency_key") or arguments.get(
            "idempotencyKey"
        )
        if not isinstance(idempotency_key, str) or not idempotency_key.strip():
            idempotency_key = f"{tool}-{uuid4()}"

        clean_args = {
            key: value
            for key, value in arguments.items()
            if key not in {"idempotency_key", "idempotencyKey"}
        }

        result = self._post_capture(
            portal_base_url=self._portal_base_url,
            conversation_id=self._conversation_id,
            session_token=self._session_token,
            tool=tool,
            args=clean_args,
            idempotency_key=str(idempotency_key).strip(),
        )

        if result.get("ok") is True:
            self._record_timeline(tool=tool, status="succeeded")
        else:
            self._record_timeline(
                tool=tool,
                status="failed",
                detail=str(result.get("error") or "failed"),
            )

        await result_callback(
            result,
            properties=self._function_call_result_properties_cls(run_llm=True),
        )


def build_capture_tool_schemas(
    modules: Mapping[str, object],
    capture_controller: CaptureToolController,
    enabled_tools: tuple[str, ...] | list[str] | set[str],
    *,
    lead_fields: tuple[str, ...] | list[str] | None = None,
    message_fields: tuple[str, ...] | list[str] | None = None,
    appointment_fields: tuple[str, ...] | list[str] | None = None,
) -> list[object]:
    function_schema_cls = modules["FunctionSchema"]
    tools: list[object] = []
    enabled = set(enabled_tools)

    def required_from_fields(
        fields: tuple[str, ...] | list[str] | None,
        *,
        defaults: list[str],
        key_map: dict[str, str] | None = None,
    ) -> list[str]:
        mapping = key_map or {}
        selected = list(fields) if fields is not None else list(defaults)
        required: list[str] = []
        for field in selected:
            if field == "notes":
                continue
            key = mapping.get(field, field)
            if key not in required:
                required.append(key)
        return required or list(defaults)

    if "capture_lead" in enabled:

        async def handle_capture_lead(params: object) -> None:
            await capture_controller.handle_capture_tool_call(
                params,
                tool="capture_lead",
            )

        tools.append(
            function_schema_cls(
                name="capture_lead",
                description=(
                    "Persist a lead after confirming the caller's key details. "
                    "Only call this after the caller confirms. Never claim success "
                    "unless this tool returns ok=true."
                ),
                properties={
                    "name": {
                        "description": "Caller's full name.",
                        "type": "string",
                    },
                    "phone": {
                        "description": "Best phone number to reach the caller.",
                        "type": "string",
                    },
                    "email": {
                        "description": "Best email address to reach the caller.",
                        "type": "string",
                    },
                    "notes": {
                        "description": "Short notes about what the caller needs.",
                        "type": "string",
                    },
                },
                required=required_from_fields(
                    lead_fields,
                    defaults=["name"],
                ),
                handler=handle_capture_lead,
            )
        )

    if "capture_message" in enabled:

        async def handle_capture_message(params: object) -> None:
            await capture_controller.handle_capture_tool_call(
                params,
                tool="capture_message",
            )

        tools.append(
            function_schema_cls(
                name="capture_message",
                description=(
                    "Persist a message for the business team after confirming the "
                    "message content. Only call this after the caller confirms. "
                    "Never claim success unless this tool returns ok=true."
                ),
                properties={
                    "message": {
                        "description": "The message the caller wants delivered.",
                        "type": "string",
                    },
                    "name": {
                        "description": "Caller's name, if provided.",
                        "type": "string",
                    },
                    "phone": {
                        "description": "Callback phone number, if provided.",
                        "type": "string",
                    },
                    "email": {
                        "description": "Callback email address, if provided.",
                        "type": "string",
                    },
                },
                required=required_from_fields(
                    message_fields,
                    defaults=["message"],
                ),
                handler=handle_capture_message,
            )
        )

    if "create_appointment_request" in enabled:

        async def handle_create_appointment_request(params: object) -> None:
            await capture_controller.handle_capture_tool_call(
                params,
                tool="create_appointment_request",
            )

        tools.append(
            function_schema_cls(
                name="create_appointment_request",
                description=(
                    "Submit an appointment REQUEST after confirming the caller's "
                    "name, preferred time, and contact details. This never confirms "
                    "a booking. Only call after the caller confirms. If ok=true, tell "
                    "them the request was submitted and the team will confirm. Never "
                    "say they are booked."
                ),
                properties={
                    "name": {
                        "description": "Caller's full name.",
                        "type": "string",
                    },
                    "preferredTime": {
                        "description": (
                            "Preferred day and time for the appointment, "
                            "in the caller's words."
                        ),
                        "type": "string",
                    },
                    "phone": {
                        "description": "Best phone number to reach the caller.",
                        "type": "string",
                    },
                    "email": {
                        "description": "Best email address to reach the caller.",
                        "type": "string",
                    },
                    "party": {
                        "description": (
                            "Who the appointment is with, or service requested."
                        ),
                        "type": "string",
                    },
                    "notes": {
                        "description": "Any extra notes from the caller.",
                        "type": "string",
                    },
                },
                required=required_from_fields(
                    appointment_fields,
                    defaults=["name", "preferredTime"],
                    key_map={"preferred_time": "preferredTime"},
                ),
                handler=handle_create_appointment_request,
            )
        )

    if "offer_human_handoff" in enabled:

        async def handle_offer_human_handoff(params: object) -> None:
            await capture_controller.handle_capture_tool_call(
                params,
                tool="offer_human_handoff",
            )

        tools.append(
            function_schema_cls(
                name="offer_human_handoff",
                description=(
                    "Record a soft human handoff request after confirming why the "
                    "caller wants a person or callback. This never performs a live "
                    "phone transfer. Only call after the caller confirms. If ok=true, "
                    "speak using the returned speakAs / configured handoff script. "
                    "Never claim a live transfer succeeded."
                ),
                properties={
                    "reason": {
                        "description": (
                            "Why the caller wants a human, callback, or transfer."
                        ),
                        "type": "string",
                    },
                    "callerName": {
                        "description": "Caller's name, if provided.",
                        "type": "string",
                    },
                    "callbackPhone": {
                        "description": "Best callback phone number, if provided.",
                        "type": "string",
                    },
                    "callbackEmail": {
                        "description": "Best callback email address, if provided.",
                        "type": "string",
                    },
                },
                required=["reason"],
                handler=handle_offer_human_handoff,
            )
        )

    return tools
