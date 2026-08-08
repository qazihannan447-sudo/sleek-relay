"""Voice worker: post-session transcript persistence.

Writes completed conversation message rows to Supabase via the PostgREST API
after a voice session finishes.  Uses only stdlib :mod:`urllib.request` so no
additional SDK dependency is needed.

All persistence operations are **best-effort**: failures are logged and
swallowed; the voice session is never affected.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any
from urllib.error import URLError
from urllib.request import Request, urlopen

from app.call_timeline import CallTimelineRecorder, build_latency_metrics_v2
from app.usage_metrics import UsageMetricsAccumulator, build_usage_metrics_snapshot

if TYPE_CHECKING:
    from app.config import VoiceWorkerConfig
    from app.runtime_config import VoiceSessionRuntimeConfig

LOGGER = logging.getLogger("sleek_relay.voice.transcript")

# Roles that produce transcript rows.
_TRANSCRIPT_ROLES = frozenset({"user", "assistant"})
# Content length guard — Supabase column is TEXT NOT NULL; avoid absurdly large rows.
_MAX_CONTENT_LENGTH = 32_000
# Supabase PostgREST endpoint path for conversation_messages.
_POSTGREST_MESSAGES_PATH = "/rest/v1/conversation_messages"
# Supabase PostgREST endpoint path for conversations table update.
_POSTGREST_CONVERSATIONS_PATH = "/rest/v1/conversations"


def build_message_rows(
    context_messages: list[dict[str, object]],
    *,
    tenant_id: str,
    conversation_id: str,
) -> list[dict[str, object]]:
    """Build a list of row dicts suitable for insertion into conversation_messages.

    Args:
        context_messages: Raw list from ``LLMContext.messages`` (dicts with at
            least ``role`` and ``content`` keys).
        tenant_id: UUID string for the owning tenant.
        conversation_id: UUID string for the conversation row.

    Returns:
        Ordered list of validated row dicts, skipping blank / non-transcript
        roles and content that exceeds the column safety limit.
    """
    rows: list[dict[str, object]] = []
    sequence = 0
    previous_role: object | None = None
    previous_content: str | None = None

    for msg in context_messages:
        if not isinstance(msg, dict):
            continue

        role = msg.get("role")
        if role not in _TRANSCRIPT_ROLES:
            continue

        raw_content = msg.get("content")
        content = _extract_content_text(raw_content)
        if not content:
            continue

        if len(content) > _MAX_CONTENT_LENGTH:
            LOGGER.warning(
                "transcript: message content exceeds %d chars (len=%d); truncating",
                _MAX_CONTENT_LENGTH,
                len(content),
            )
            content = content[:_MAX_CONTENT_LENGTH]

        # Collapse consecutive identical assistant/user rows (e.g. opening
        # greeting appended to LLM context more than once).
        if role == previous_role and content == previous_content:
            continue

        sequence += 1
        rows.append(
            {
                "tenant_id": tenant_id,
                "conversation_id": conversation_id,
                "sequence_number": sequence,
                "role": role,
                "content": content,
                "is_final": True,
                "interrupted": False,
            }
        )
        previous_role = role
        previous_content = content

    return rows


def persist_transcript(
    rows: list[dict[str, object]],
    *,
    supabase_url: str,
    service_role_key: str,
) -> None:
    """POST *rows* to the Supabase PostgREST API as a batch insert.

    Logs and swallows any error — callers should treat this as best-effort.
    """
    if not rows:
        LOGGER.debug("transcript: no rows to persist")
        return

    url = supabase_url.rstrip("/") + _POSTGREST_MESSAGES_PATH
    body = json.dumps(rows).encode("utf-8")
    req = Request(
        url,
        data=body,
        headers={
            "Accept": "application/json",
            "Content-Type": "application/json",
            "Authorization": f"Bearer {service_role_key}",
            "apikey": service_role_key,
            "Prefer": "return=minimal",
        },
        method="POST",
    )

    try:
        with urlopen(req, timeout=15) as response:
            status = response.status
    except URLError as exc:
        LOGGER.error(
            "transcript: network error while persisting %d rows: %s",
            len(rows),
            exc,
        )
        return
    except Exception as exc:  # noqa: BLE001
        LOGGER.error(
            "transcript: unexpected error while persisting %d rows: %s",
            len(rows),
            exc,
        )
        return

    if 200 <= status < 300:  # noqa: PLR2004
        LOGGER.info(
            "transcript: persisted %d message row(s) status=%d",
            len(rows),
            status,
        )
    else:
        LOGGER.error(
            "transcript: persistence returned unexpected status=%d for %d rows",
            status,
            len(rows),
        )


def build_latency_metrics(
    latency_tracker: object | None,
    *,
    message_rows: list[dict[str, object]] | None = None,
    timeline: CallTimelineRecorder | None = None,
    end_reason: str | None = None,
) -> dict[str, Any]:
    """Build latency_metrics v2 for conversation persistence.

    Includes:
      * flat aggregate averages (portal ``getAllowedLatencyMetrics`` compatibility)
      * ``session_events``, ``turns``, ``failure``, and ``aggregates``
    """
    return build_latency_metrics_v2(
        latency_tracker,
        message_rows=message_rows,
        timeline=timeline,
        end_reason=end_reason,
    )


def _patch_conversation(
    *,
    conversation_id: str,
    tenant_id: str,
    payload: dict[str, object],
    supabase_url: str,
    service_role_key: str,
    query_extra: str = "",
    operation: str,
) -> None:
    """PATCH a conversation row via PostgREST. Logs and swallows errors."""
    url = (
        f"{supabase_url.rstrip('/')}{_POSTGREST_CONVERSATIONS_PATH}"
        f"?id=eq.{conversation_id}&tenant_id=eq.{tenant_id}{query_extra}"
    )
    body = json.dumps(payload).encode("utf-8")
    req = Request(
        url,
        data=body,
        headers={
            "Accept": "application/json",
            "Content-Type": "application/json",
            "Authorization": f"Bearer {service_role_key}",
            "apikey": service_role_key,
            "Prefer": "return=minimal",
        },
        method="PATCH",
    )

    try:
        with urlopen(req, timeout=15) as response:
            status = response.status
    except URLError as exc:
        LOGGER.error(
            "transcript: network error during %s: %s",
            operation,
            exc,
        )
        return
    except Exception as exc:  # noqa: BLE001
        LOGGER.error(
            "transcript: unexpected error during %s: %s",
            operation,
            exc,
        )
        return

    if 200 <= status < 300:  # noqa: PLR2004
        LOGGER.info(
            "transcript: %s succeeded status=%d conversation_id=%s",
            operation,
            status,
            conversation_id,
        )
    else:
        LOGGER.error(
            "transcript: %s returned unexpected status=%d conversation_id=%s",
            operation,
            status,
            conversation_id,
        )


def _read_conversation_started_at(
    *,
    conversation_id: str,
    tenant_id: str,
    supabase_url: str,
    service_role_key: str,
) -> str | None:
    """Best-effort read of started_at for duration calculation."""
    url = (
        f"{supabase_url.rstrip('/')}{_POSTGREST_CONVERSATIONS_PATH}"
        f"?id=eq.{conversation_id}&tenant_id=eq.{tenant_id}"
        "&select=started_at"
    )
    req = Request(
        url,
        headers={
            "Accept": "application/json",
            "Authorization": f"Bearer {service_role_key}",
            "apikey": service_role_key,
        },
        method="GET",
    )

    try:
        with urlopen(req, timeout=15) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except Exception as exc:  # noqa: BLE001
        LOGGER.warning(
            "transcript: unable to read started_at for duration conversation_id=%s error=%s",
            conversation_id,
            exc,
        )
        return None

    if not isinstance(payload, list) or not payload:
        return None

    started_at = payload[0].get("started_at") if isinstance(payload[0], dict) else None
    return started_at if isinstance(started_at, str) and started_at.strip() else None


def persist_conversation_metadata(
    *,
    conversation_id: str,
    tenant_id: str,
    latency_metrics: dict[str, Any],
    runtime_snapshot: dict[str, object],
    supabase_url: str,
    service_role_key: str,
    usage_metrics: dict[str, Any] | None = None,
) -> None:
    """PATCH the conversation row with latency/usage metrics and runtime_snapshot.

    Logs and swallows any error — callers should treat this as best-effort.
    """
    payload: dict[str, object] = {
        "latency_metrics": latency_metrics,
        "runtime_snapshot": runtime_snapshot,
    }
    if usage_metrics:
        payload["usage_metrics"] = usage_metrics

    _patch_conversation(
        conversation_id=conversation_id,
        tenant_id=tenant_id,
        payload=payload,
        supabase_url=supabase_url,
        service_role_key=service_role_key,
        operation="conversation metadata update",
    )


def finalize_conversation_status(
    *,
    conversation_id: str,
    tenant_id: str,
    supabase_url: str,
    service_role_key: str,
    end_reason: str = "worker_session_end",
    ended_at: str | None = None,
    failure: dict[str, object] | None = None,
) -> None:
    """Mark an open conversation completed (or failed) after the worker session ends.

    Only updates rows still in ``starting`` or ``active`` so a browser
    lifecycle finalize that already ran remains authoritative.
    """
    resolved_ended_at = ended_at or datetime.now(timezone.utc).isoformat()
    if failure and isinstance(failure.get("stage"), str):
        stage = str(failure["stage"])
        error_code = failure.get("errorCode")
        payload = {
            "status": "failed",
            "ended_at": resolved_ended_at,
            "end_reason": end_reason or f"provider_error:{stage}",
            "error_code": (
                error_code
                if isinstance(error_code, str) and error_code.strip()
                else f"provider_{stage}_failed"
            ),
            "error_message": (
                failure.get("callerHeard")
                if isinstance(failure.get("callerHeard"), str)
                else f"Voice session failed during the {stage} stage."
            ),
            "outcome": f"Failed · {stage.upper()}",
        }
    else:
        payload = {
            "status": "completed",
            "ended_at": resolved_ended_at,
            "end_reason": end_reason,
            "error_code": None,
            "error_message": None,
        }

    started_at = _read_conversation_started_at(
        conversation_id=conversation_id,
        tenant_id=tenant_id,
        supabase_url=supabase_url,
        service_role_key=service_role_key,
    )
    if started_at:
        try:
            started = datetime.fromisoformat(started_at.replace("Z", "+00:00"))
            ended = datetime.fromisoformat(resolved_ended_at.replace("Z", "+00:00"))
            payload["duration_ms"] = max(
                0, int(round((ended - started).total_seconds() * 1000))
            )
        except ValueError:
            LOGGER.warning(
                "transcript: unable to parse timestamps for duration conversation_id=%s",
                conversation_id,
            )

    _patch_conversation(
        conversation_id=conversation_id,
        tenant_id=tenant_id,
        payload=payload,
        supabase_url=supabase_url,
        service_role_key=service_role_key,
        query_extra="&status=in.(starting,active)",
        operation="conversation status finalize",
    )


def try_persist_session_results(
    context_messages: list[dict[str, object]],
    latency_tracker_or_runtime_config: object | None,
    runtime_config_or_worker_config: VoiceSessionRuntimeConfig | VoiceWorkerConfig | None = None,
    worker_config: VoiceWorkerConfig | None = None,
    *,
    timeline: CallTimelineRecorder | None = None,
    end_reason: str | None = None,
    usage_metrics: UsageMetricsAccumulator | None = None,
) -> None:
    """Top-level convenience: persist transcript rows and conversation metadata.

    Supports both 3-arg (messages, runtime_config, worker_config) and
    4-arg (messages, latency_tracker, runtime_config, worker_config) forms.

    Silently skips when:

    * ``runtime_config.conversation_id`` is ``None`` (env-fallback sessions).
    * ``worker_config.supabase_url`` or ``worker_config.supabase_service_role_key``
      is not configured.

    All Supabase errors are logged and swallowed.
    """
    if worker_config is not None:
        # 4-arg call
        latency_tracker = latency_tracker_or_runtime_config
        runtime_config = runtime_config_or_worker_config  # type: ignore[assignment]
    else:
        # 3-arg call
        latency_tracker = None
        runtime_config = latency_tracker_or_runtime_config  # type: ignore[assignment]
        worker_config = runtime_config_or_worker_config  # type: ignore[assignment]

    if runtime_config is None or worker_config is None:
        return
    conversation_id = runtime_config.conversation_id
    if not conversation_id:
        LOGGER.debug("transcript: skipping persistence — no conversation_id")
        return

    supabase_url = worker_config.supabase_url
    service_role_key = worker_config.supabase_service_role_key
    if not supabase_url or not service_role_key:
        LOGGER.debug("transcript: skipping persistence — Supabase credentials not configured")
        return

    tenant_id = runtime_config.tenant.id
    resolved_end_reason = end_reason or "worker_session_end"

    # 1. Persist transcript messages
    rows = build_message_rows(
        context_messages,
        tenant_id=tenant_id,
        conversation_id=conversation_id,
    )
    LOGGER.info(
        "transcript: persisting %d message row(s) conversation_id=%s tenant_id=%s",
        len(rows),
        conversation_id,
        tenant_id,
    )
    persist_transcript(rows, supabase_url=supabase_url, service_role_key=service_role_key)

    # 2. Persist latency metrics and runtime snapshot to conversations table
    latency_metrics = build_latency_metrics(
        latency_tracker,
        message_rows=rows,
        timeline=timeline,
        end_reason=resolved_end_reason,
    )
    usage_metrics_snapshot = build_usage_metrics_snapshot(usage_metrics)
    runtime_snapshot = (
        runtime_config.to_runtime_snapshot()
        if hasattr(runtime_config, "to_runtime_snapshot")
        else {}
    )
    turn_count = len(latency_metrics.get("turns") or []) if isinstance(latency_metrics, dict) else 0
    LOGGER.info(
        "transcript: updating conversation metadata turns=%d total_tokens=%s conversation_id=%s",
        turn_count,
        (
            usage_metrics_snapshot.get("llm", {}).get("total_tokens")
            if isinstance(usage_metrics_snapshot.get("llm"), dict)
            else None
        ),
        conversation_id,
    )
    persist_conversation_metadata(
        conversation_id=conversation_id,
        tenant_id=tenant_id,
        latency_metrics=latency_metrics,
        runtime_snapshot=runtime_snapshot,
        usage_metrics=usage_metrics_snapshot or None,
        supabase_url=supabase_url,
        service_role_key=service_role_key,
    )
    failure = latency_metrics.get("failure") if isinstance(latency_metrics, dict) else None
    finalize_conversation_status(
        conversation_id=conversation_id,
        tenant_id=tenant_id,
        supabase_url=supabase_url,
        service_role_key=service_role_key,
        end_reason=resolved_end_reason,
        failure=failure if isinstance(failure, dict) else None,
    )


# Alias for backward compatibility
try_persist_transcript = try_persist_session_results


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _extract_content_text(content: object) -> str:
    """Extract plain-text content from an LLM message content field.

    The Pipecat / Google LLM context stores ``content`` as either a plain string
    or a list of content-part dicts (``{"type": "text", "text": "..."}``)
    when multi-modal messages are involved.  We flatten to a single string.
    """
    if isinstance(content, str):
        return content.strip()

    if isinstance(content, list):
        parts: list[str] = []
        for part in content:
            if isinstance(part, str):
                parts.append(part.strip())
            elif isinstance(part, dict):
                text = part.get("text")
                if isinstance(text, str) and text.strip():
                    parts.append(text.strip())
        return " ".join(parts).strip()

    return ""
