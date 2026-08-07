from __future__ import annotations

import asyncio
import json
import os
import re
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Mapping
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from uuid import UUID

from app.config import ConfigurationError, VoiceWorkerConfig
from app.prompt import SYSTEM_PROMPT


DEFAULT_SESSION_SILENCE_TIMEOUT_SECONDS = 6
FORBIDDEN_FIELD_PATTERN = re.compile(
    r"(?:api[_-]?key|token|secret|authorization|cookie|service[_-]?role|password)",
    re.IGNORECASE,
)
SUPPORTED_LANGUAGE_VALUES = {"en", "en-us", "en-gb"}
SAFE_VOICE_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
PACKAGE_VERSION_PATTERN = re.compile(r"^[A-Za-z0-9._:-]{1,32}$")
GREETING_MAX_LENGTH = 500
PROMPT_TEXT_MAX_LENGTH = 20_000
KNOWLEDGE_ITEM_CONTENT_MAX_LENGTH = 4_000
KNOWLEDGE_TOTAL_CONTENT_MAX_LENGTH = 16_000
GROUNDING_RULE_MAX_LENGTH = 500
TEXT_FIELD_MAX_LENGTH = 2_000
MAX_KNOWLEDGE_ITEMS = 100
MAX_SESSION_DURATION_SECONDS = 7_200
MIN_SESSION_DURATION_SECONDS = 60
MAX_SILENCE_TIMEOUT_SECONDS = 120
MIN_SILENCE_TIMEOUT_SECONDS = 3
DEFAULT_PROVIDER_ERROR_MESSAGE = (
    "Deepgram transcription could not connect. Please disconnect and connect again."
)
SAFE_RUNTIME_CONFIG_UNAVAILABLE_MESSAGE = "Voice session setup is unavailable right now."
SAFE_RUNTIME_SESSION_UNAVAILABLE_MESSAGE = "The requested voice session is unavailable."
ENV_FALLBACK_RUNTIME_PACKAGE_VERSION = "env-fallback-v1"
ENV_FALLBACK_TENANT_ID = "00000000-0000-0000-0000-000000000001"
ENV_FALLBACK_AGENT_ID = "00000000-0000-0000-0000-000000000002"
PORTAL_RUNTIME_CONFIG_PATH = "/api/voice/runtime-config"
VOICE_SESSION_TOKEN_KEYS = ("voiceSessionToken", "voice_session_token")
VOICE_SESSION_TOKEN_CONTAINER_KEYS = (
    "metadata",
    "connectionMetadata",
    "connection_metadata",
)


class RuntimeConfigValidationError(ConfigurationError):
    """Raised when a portal runtime package is missing required safe fields."""


class RuntimeConfigLoadError(ConfigurationError):
    """Raised when the worker cannot safely load a session runtime package."""


@dataclass(frozen=True)
class RuntimeKnowledgeItem:
    content: str
    id: str
    kind: str
    title: str


@dataclass(frozen=True)
class RuntimeTenant:
    id: str
    name: str
    slug: str


@dataclass(frozen=True)
class RuntimeBusinessHoursDay:
    close: str | None
    closed: bool
    open: str | None


@dataclass(frozen=True)
class RuntimeBusinessHours:
    fri: RuntimeBusinessHoursDay
    mon: RuntimeBusinessHoursDay
    sat: RuntimeBusinessHoursDay
    sun: RuntimeBusinessHoursDay
    thu: RuntimeBusinessHoursDay
    tue: RuntimeBusinessHoursDay
    wed: RuntimeBusinessHoursDay


@dataclass(frozen=True)
class RuntimeBusiness:
    businessHours: RuntimeBusinessHours
    businessName: str
    businessPhone: str
    category: str
    contactEmail: str
    contactName: str
    timezone: str
    website: str


@dataclass(frozen=True)
class RuntimeAgent:
    fallbackMessage: str
    greeting: str
    id: str
    interruptionEnabled: bool
    language: str
    maximumSessionDurationSeconds: int | None
    name: str
    role: str
    silenceTimeoutSeconds: int
    specialInstructions: str
    status: str
    tone: str
    voiceId: str


@dataclass(frozen=True)
class VoiceSessionRuntimeConfig:
    agent: RuntimeAgent
    business: RuntimeBusiness
    generatedAt: str
    groundingRules: tuple[str, ...]
    knowledge: tuple[RuntimeKnowledgeItem, ...]
    llmModel: str
    llmProvider: str
    promptText: str
    runtimePackageVersion: str | None
    source: str
    sttModel: str
    sttProvider: str
    tenant: RuntimeTenant
    transportProvider: str
    ttsLanguage: str
    ttsModel: str
    ttsProvider: str

    @property
    def knowledgeItemCount(self) -> int:
        return len(self.knowledge)

    def to_runtime_snapshot(self) -> dict[str, object]:
        snapshot: dict[str, object] = {
            "agent_id": self.agent.id,
            "agent_name": self.agent.name,
            "business_name": self.business.businessName,
            "interruption_enabled": self.agent.interruptionEnabled,
            "knowledge_item_count": self.knowledgeItemCount,
            "language": self.agent.language,
            "llm_model": self.llmModel,
            "maximum_session_duration_seconds": self.agent.maximumSessionDurationSeconds,
            "role": self.agent.role,
            "silence_timeout_seconds": self.agent.silenceTimeoutSeconds,
            "stt_model": self.sttModel,
            "tts_model": self.ttsModel,
            "voice_id": self.agent.voiceId,
        }

        if self.runtimePackageVersion is not None:
            snapshot["runtime_package_version"] = self.runtimePackageVersion

        return {key: value for key, value in snapshot.items() if value is not None}


def build_runtime_config(
    worker_config: VoiceWorkerConfig,
    runtime_package: Mapping[str, object] | None = None,
) -> VoiceSessionRuntimeConfig:
    if runtime_package is None:
        return build_env_fallback_runtime_config(worker_config)

    return parse_portal_runtime_package(runtime_package, worker_config=worker_config)


def extract_voice_session_token(request_data: object) -> str | None:
    for candidate in _iter_token_mappings(request_data):
        for key in VOICE_SESSION_TOKEN_KEYS:
            value = candidate.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()

    return None


async def load_session_runtime_config(
    worker_config: VoiceWorkerConfig,
    request_data: object,
    *,
    portal_base_url: str | None = None,
    fetch_runtime_package: Any | None = None,
) -> VoiceSessionRuntimeConfig:
    token = extract_voice_session_token(request_data)
    if not token:
        return build_env_fallback_runtime_config(worker_config)

    resolved_portal_base_url = _normalize_portal_base_url(
        portal_base_url or os.environ.get("PORTAL_BASE_URL")
    )
    if not resolved_portal_base_url:
        raise RuntimeConfigLoadError(SAFE_RUNTIME_CONFIG_UNAVAILABLE_MESSAGE)

    response_data = await asyncio.to_thread(
        fetch_runtime_package or _fetch_runtime_package_from_portal,
        _build_runtime_config_url(resolved_portal_base_url),
        token,
    )
    if not isinstance(response_data, Mapping):
        raise RuntimeConfigLoadError(SAFE_RUNTIME_CONFIG_UNAVAILABLE_MESSAGE)

    try:
        return parse_portal_runtime_package_response(
            response_data,
            worker_config=worker_config,
        )
    except RuntimeConfigValidationError as exc:
        raise RuntimeConfigLoadError(SAFE_RUNTIME_CONFIG_UNAVAILABLE_MESSAGE) from exc


def build_env_fallback_runtime_config(
    worker_config: VoiceWorkerConfig,
) -> VoiceSessionRuntimeConfig:
    generated_at = datetime.now(UTC).isoformat()

    return VoiceSessionRuntimeConfig(
        agent=RuntimeAgent(
            fallbackMessage="",
            greeting="",
            id=ENV_FALLBACK_AGENT_ID,
            interruptionEnabled=True,
            language="en",
            maximumSessionDurationSeconds=None,
            name="Sleek Relay local voice demo assistant",
            role="assistant",
            silenceTimeoutSeconds=DEFAULT_SESSION_SILENCE_TIMEOUT_SECONDS,
            specialInstructions="",
            status="active",
            tone="",
            voiceId=_validate_voice_id(
                worker_config.cartesia_voice_id,
                field_name="agent.voiceId",
            ),
        ),
        business=RuntimeBusiness(
            businessHours=_empty_business_hours(),
            businessName="Sleek Relay",
            businessPhone="",
            category="",
            contactEmail="",
            contactName="",
            timezone="",
            website="",
        ),
        generatedAt=generated_at,
        groundingRules=(),
        knowledge=(),
        llmModel=worker_config.google_model,
        llmProvider="Gemini",
        promptText=SYSTEM_PROMPT,
        runtimePackageVersion=ENV_FALLBACK_RUNTIME_PACKAGE_VERSION,
        source="env-fallback",
        sttModel=worker_config.deepgram_model,
        sttProvider="Deepgram Flux",
        tenant=RuntimeTenant(
            id=ENV_FALLBACK_TENANT_ID,
            name="Sleek Relay",
            slug="sleek-relay-local-demo",
        ),
        transportProvider="SmallWebRTC",
        ttsLanguage="en",
        ttsModel=worker_config.cartesia_model,
        ttsProvider="Cartesia",
    )


def parse_portal_runtime_package(
    runtime_package: Mapping[str, object],
    *,
    worker_config: VoiceWorkerConfig,
) -> VoiceSessionRuntimeConfig:
    _ensure_no_forbidden_fields(runtime_package)

    agent_data = _read_mapping(runtime_package, "agent")
    business_data = _read_mapping(runtime_package, "business")
    tenant_data = _read_mapping(runtime_package, "tenant")
    knowledge_data = _read_sequence(runtime_package.get("knowledge"), "knowledge")
    grounding_rules_data = _read_sequence(
        runtime_package.get("groundingRules"),
        "groundingRules",
    )
    prompt_text = _read_required_text(
        runtime_package,
        "promptText",
        max_length=PROMPT_TEXT_MAX_LENGTH,
    )

    runtime_package_version = _read_optional_package_version(runtime_package)
    generated_at = _read_optional_text(runtime_package.get("generatedAt"))
    if generated_at:
        _validate_iso8601(generated_at, field_name="generatedAt")
    else:
        generated_at = datetime.now(UTC).isoformat()

    knowledge = tuple(_parse_knowledge_item(item, index) for index, item in enumerate(knowledge_data))
    if len(knowledge) > MAX_KNOWLEDGE_ITEMS:
        raise RuntimeConfigValidationError(
            f"knowledge must contain at most {MAX_KNOWLEDGE_ITEMS} approved items."
        )

    total_knowledge_content = sum(len(item.content) for item in knowledge)
    if total_knowledge_content > KNOWLEDGE_TOTAL_CONTENT_MAX_LENGTH:
        raise RuntimeConfigValidationError("knowledge content is too large for one session runtime.")

    grounding_rules = tuple(
        _read_nonblank_text(
            item,
            f"groundingRules[{index}]",
            max_length=GROUNDING_RULE_MAX_LENGTH,
        )
        for index, item in enumerate(grounding_rules_data)
    )
    for index, rule in enumerate(grounding_rules):
        _validate_text_length(
            rule,
            field_name=f"groundingRules[{index}]",
            max_length=GROUNDING_RULE_MAX_LENGTH,
        )

    language = _normalize_supported_language(_read_required_text(agent_data, "language"))
    silence_timeout_seconds = _read_timeout_seconds(
        agent_data,
        "silenceTimeoutSeconds",
        minimum=MIN_SILENCE_TIMEOUT_SECONDS,
        maximum=MAX_SILENCE_TIMEOUT_SECONDS,
    )
    maximum_session_duration_seconds = _read_timeout_seconds(
        agent_data,
        "maximumSessionDurationSeconds",
        minimum=MIN_SESSION_DURATION_SECONDS,
        maximum=MAX_SESSION_DURATION_SECONDS,
    )
    greeting = _read_optional_text(agent_data.get("greeting"))
    if greeting:
        _validate_text_length(
            greeting,
            field_name="agent.greeting",
            max_length=GREETING_MAX_LENGTH,
        )

    fallback_message = _read_optional_text(agent_data.get("fallbackMessage"))
    if fallback_message:
        _validate_text_length(
            fallback_message,
            field_name="agent.fallbackMessage",
            max_length=TEXT_FIELD_MAX_LENGTH,
        )

    special_instructions = _read_optional_text(agent_data.get("specialInstructions"))
    if special_instructions:
        _validate_text_length(
            special_instructions,
            field_name="agent.specialInstructions",
            max_length=TEXT_FIELD_MAX_LENGTH,
        )

    tone = _read_optional_text(agent_data.get("tone"))
    if tone:
        _validate_text_length(tone, field_name="agent.tone", max_length=TEXT_FIELD_MAX_LENGTH)

    voice_id = _read_optional_text(agent_data.get("voiceId")) or worker_config.cartesia_voice_id
    voice_id = _validate_voice_id(voice_id, field_name="agent.voiceId")

    business = RuntimeBusiness(
        businessHours=_parse_business_hours(business_data.get("businessHours")),
        businessName=_read_optional_text(business_data.get("businessName")),
        businessPhone=_read_optional_text(business_data.get("businessPhone")),
        category=_read_optional_text(business_data.get("category")),
        contactEmail=_read_optional_text(business_data.get("contactEmail")),
        contactName=_read_optional_text(business_data.get("contactName")),
        timezone=_read_optional_text(business_data.get("timezone")),
        website=_read_optional_text(business_data.get("website")),
    )

    return VoiceSessionRuntimeConfig(
        agent=RuntimeAgent(
            fallbackMessage=fallback_message,
            greeting=greeting,
            id=_validate_uuid(_read_required_text(agent_data, "id"), field_name="agent.id"),
            interruptionEnabled=_read_boolean(agent_data, "interruptionEnabled"),
            language=language,
            maximumSessionDurationSeconds=maximum_session_duration_seconds,
            name=_read_required_text(agent_data, "name"),
            role=_read_required_text(agent_data, "role"),
            silenceTimeoutSeconds=silence_timeout_seconds,
            specialInstructions=special_instructions,
            status=_read_required_text(agent_data, "status"),
            tone=tone,
            voiceId=voice_id,
        ),
        business=business,
        generatedAt=generated_at,
        groundingRules=grounding_rules,
        knowledge=knowledge,
        llmModel=worker_config.google_model,
        llmProvider="Gemini",
        promptText=prompt_text,
        runtimePackageVersion=runtime_package_version,
        source="portal-runtime-package",
        sttModel=worker_config.deepgram_model,
        sttProvider="Deepgram Flux",
        tenant=RuntimeTenant(
            id=_validate_uuid(_read_required_text(tenant_data, "id"), field_name="tenant.id"),
            name=_read_required_text(tenant_data, "name"),
            slug=_read_required_text(tenant_data, "slug"),
        ),
        transportProvider="SmallWebRTC",
        ttsLanguage=_language_to_tts_label(language),
        ttsModel=worker_config.cartesia_model,
        ttsProvider="Cartesia",
    )


def parse_portal_runtime_package_response(
    response_data: Mapping[str, object],
    *,
    worker_config: VoiceWorkerConfig,
) -> VoiceSessionRuntimeConfig:
    runtime_package = _read_mapping(response_data, "runtimePackage")
    return parse_portal_runtime_package(runtime_package, worker_config=worker_config)


def _ensure_no_forbidden_fields(value: object, *, field_path: str = "$") -> None:
    if isinstance(value, Mapping):
        for key, nested_value in value.items():
            if not isinstance(key, str):
                continue
            if FORBIDDEN_FIELD_PATTERN.search(key):
                raise RuntimeConfigValidationError(
                    "Runtime config contains forbidden secret-like fields."
                )
            _ensure_no_forbidden_fields(nested_value, field_path=f"{field_path}.{key}")
        return

    if isinstance(value, list):
        for index, nested_value in enumerate(value):
            _ensure_no_forbidden_fields(nested_value, field_path=f"{field_path}[{index}]")


def _read_mapping(source: Mapping[str, object], key: str) -> Mapping[str, object]:
    value = source.get(key)
    if not isinstance(value, Mapping):
        raise RuntimeConfigValidationError(f"{key} must be an object.")
    return value


def _read_sequence(value: object, field_name: str) -> list[object]:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    raise RuntimeConfigValidationError(f"{field_name} must be an array.")


def _read_boolean(source: Mapping[str, object], key: str) -> bool:
    value = source.get(key)
    if isinstance(value, bool):
        return value
    raise RuntimeConfigValidationError(f"{key} must be a boolean.")


def _read_required_text(
    source: Mapping[str, object],
    key: str,
    *,
    max_length: int = TEXT_FIELD_MAX_LENGTH,
) -> str:
    return _read_nonblank_text(source.get(key), key, max_length=max_length)


def _read_nonblank_text(value: object, field_name: str, *, max_length: int) -> str:
    if not isinstance(value, str) or not value.strip():
        raise RuntimeConfigValidationError(f"{field_name} is required.")
    normalized = value.strip()
    _validate_text_length(normalized, field_name=field_name, max_length=max_length)
    return normalized


def _read_optional_text(value: object) -> str:
    if not isinstance(value, str):
        return ""
    return value.strip()


def _validate_text_length(value: str, *, field_name: str, max_length: int) -> None:
    if len(value) > max_length:
        raise RuntimeConfigValidationError(f"{field_name} is too large.")


def _validate_uuid(value: str, *, field_name: str) -> str:
    try:
        UUID(value)
    except ValueError as exc:
        raise RuntimeConfigValidationError(f"{field_name} must be a valid UUID.") from exc
    return value


def _normalize_supported_language(value: str) -> str:
    normalized = value.strip().lower()
    if normalized not in SUPPORTED_LANGUAGE_VALUES:
        raise RuntimeConfigValidationError("agent.language is not supported by the current worker.")
    return normalized


def _read_timeout_seconds(
    source: Mapping[str, object],
    key: str,
    *,
    minimum: int,
    maximum: int,
) -> int:
    value = source.get(key)
    if not isinstance(value, int):
        raise RuntimeConfigValidationError(f"{key} must be an integer number of seconds.")
    if value < minimum or value > maximum:
        raise RuntimeConfigValidationError(
            f"{key} must be between {minimum} and {maximum} seconds."
        )
    return value


def _validate_voice_id(value: str, *, field_name: str) -> str:
    normalized = value.strip()
    if not normalized:
        raise RuntimeConfigValidationError(f"{field_name} is required.")
    if not SAFE_VOICE_ID_PATTERN.fullmatch(normalized):
        raise RuntimeConfigValidationError(f"{field_name} is not a supported voice identifier.")
    return normalized


def _read_optional_package_version(source: Mapping[str, object]) -> str | None:
    for key in ("runtimePackageVersion", "version"):
        value = source.get(key)
        if value is None:
            continue
        if not isinstance(value, str) or not value.strip():
            raise RuntimeConfigValidationError(f"{key} must be a nonblank string.")
        normalized = value.strip()
        if not PACKAGE_VERSION_PATTERN.fullmatch(normalized):
            raise RuntimeConfigValidationError(f"{key} is not a supported runtime package version.")
        return normalized
    return None


def _validate_iso8601(value: str, *, field_name: str) -> None:
    try:
        datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise RuntimeConfigValidationError(f"{field_name} must be a valid ISO-8601 timestamp.") from exc


def _parse_knowledge_item(value: object, index: int) -> RuntimeKnowledgeItem:
    if not isinstance(value, Mapping):
        raise RuntimeConfigValidationError(f"knowledge[{index}] must be an object.")

    content = _read_required_text(
        value,
        "content",
        max_length=KNOWLEDGE_ITEM_CONTENT_MAX_LENGTH,
    )

    return RuntimeKnowledgeItem(
        content=content,
        id=_read_required_text(value, "id"),
        kind=_read_required_text(value, "kind"),
        title=_read_required_text(value, "title"),
    )


def _parse_business_hours(value: object) -> RuntimeBusinessHours:
    if not isinstance(value, Mapping):
        return _empty_business_hours()

    return RuntimeBusinessHours(
        fri=_parse_business_hours_day(value.get("fri")),
        mon=_parse_business_hours_day(value.get("mon")),
        sat=_parse_business_hours_day(value.get("sat")),
        sun=_parse_business_hours_day(value.get("sun")),
        thu=_parse_business_hours_day(value.get("thu")),
        tue=_parse_business_hours_day(value.get("tue")),
        wed=_parse_business_hours_day(value.get("wed")),
    )


def _parse_business_hours_day(value: object) -> RuntimeBusinessHoursDay:
    if not isinstance(value, Mapping):
        return RuntimeBusinessHoursDay(close=None, closed=True, open=None)

    open_value = _read_nullable_time_text(value.get("open"))
    close_value = _read_nullable_time_text(value.get("close"))
    closed = bool(value.get("closed"))
    if closed:
        return RuntimeBusinessHoursDay(close=None, closed=True, open=None)

    return RuntimeBusinessHoursDay(close=close_value, closed=False, open=open_value)


def _read_nullable_time_text(value: object) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise RuntimeConfigValidationError("businessHours entries must use string time values.")
    normalized = value.strip()
    return normalized or None


def _empty_business_hours() -> RuntimeBusinessHours:
    closed_day = RuntimeBusinessHoursDay(close=None, closed=True, open=None)
    return RuntimeBusinessHours(
        fri=closed_day,
        mon=closed_day,
        sat=closed_day,
        sun=closed_day,
        thu=closed_day,
        tue=closed_day,
        wed=closed_day,
    )


def _language_to_tts_label(language: str) -> str:
    return "en"


def _iter_token_mappings(value: object) -> tuple[Mapping[str, object], ...]:
    if not isinstance(value, Mapping):
        return ()

    mappings: list[Mapping[str, object]] = [value]
    for key in VOICE_SESSION_TOKEN_CONTAINER_KEYS:
        nested_value = value.get(key)
        if isinstance(nested_value, Mapping):
            mappings.append(nested_value)

    return tuple(mappings)


def _normalize_portal_base_url(value: str | None) -> str | None:
    if not isinstance(value, str):
        return None

    normalized = value.strip().rstrip("/")
    return normalized or None


def _build_runtime_config_url(portal_base_url: str) -> str:
    return f"{portal_base_url}{PORTAL_RUNTIME_CONFIG_PATH}"


def _fetch_runtime_package_from_portal(
    runtime_config_url: str,
    token: str,
) -> Mapping[str, object]:
    request = Request(
        runtime_config_url,
        data=b"",
        headers={
            "Accept": "application/json",
            "Authorization": f"Bearer {token}",
        },
        method="POST",
    )

    try:
        with urlopen(request, timeout=10) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        if exc.code in {401, 404, 409}:
            raise RuntimeConfigLoadError(
                SAFE_RUNTIME_SESSION_UNAVAILABLE_MESSAGE
            ) from exc
        raise RuntimeConfigLoadError(SAFE_RUNTIME_CONFIG_UNAVAILABLE_MESSAGE) from exc
    except (OSError, URLError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise RuntimeConfigLoadError(SAFE_RUNTIME_CONFIG_UNAVAILABLE_MESSAGE) from exc

    if not isinstance(payload, Mapping):
        raise RuntimeConfigLoadError(SAFE_RUNTIME_CONFIG_UNAVAILABLE_MESSAGE)

    return payload
