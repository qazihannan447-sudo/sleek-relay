from __future__ import annotations

import os
import sys
from dataclasses import dataclass
from pathlib import Path

PACKAGES_DIR = Path(__file__).resolve().parents[1] / ".packages"
REPO_ROOT_ENV_FILENAME = ".env.voice"
WORKER_LOCAL_ENV_FILENAME = ".env"
if PACKAGES_DIR.is_dir():
    sys.path.insert(0, str(PACKAGES_DIR))

try:
    from dotenv import load_dotenv
except ImportError:  # pragma: no cover - exercised implicitly in bare environments
    def load_dotenv(*args: object, **kwargs: object) -> bool:
        return False


DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8000
DEFAULT_RUNNER_HOST = "127.0.0.1"
DEFAULT_RUNNER_PORT = 7860
DEFAULT_RUNNER_TRANSPORT = "webrtc"

REQUIRED_PROVIDER_VARS = (
    "DEEPGRAM_API_KEY",
    "DEEPGRAM_MODEL",
    "GOOGLE_API_KEY",
    "GOOGLE_MODEL",
    "CARTESIA_API_KEY",
    "CARTESIA_MODEL",
    "CARTESIA_VOICE_ID",
)


class ConfigurationError(RuntimeError):
    """Raised when required local worker configuration is missing or invalid."""


@dataclass(frozen=True)
class VoiceWorkerConfig:
    host: str
    port: int
    runner_host: str
    runner_port: int
    runner_transport: str
    deepgram_api_key: str
    deepgram_model: str
    google_api_key: str
    google_model: str
    cartesia_api_key: str
    cartesia_model: str
    cartesia_voice_id: str

    @property
    def runner_base_url(self) -> str:
        return f"http://{self.runner_host}:{self.runner_port}"

    @property
    def client_url(self) -> str:
        return f"{self.runner_base_url}/client"


def bootstrap_packages() -> None:
    if PACKAGES_DIR.is_dir():
        sys.path.insert(0, str(PACKAGES_DIR))


def resolve_worker_env_path(start_path: Path | None = None) -> Path:
    anchor = (start_path or Path(__file__).resolve()).resolve()
    search_root = anchor if anchor.is_dir() else anchor.parent

    for candidate_root in (search_root, *search_root.parents):
        repo_root_env_path = candidate_root / REPO_ROOT_ENV_FILENAME
        if repo_root_env_path.is_file():
            return repo_root_env_path

    return search_root.parent / WORKER_LOCAL_ENV_FILENAME


def load_worker_env(start_path: Path | None = None) -> Path:
    bootstrap_packages()
    env_path = resolve_worker_env_path(start_path)
    load_dotenv(env_path, override=False)
    return env_path


def _read_required(env: dict[str, str], key: str) -> str:
    value = env.get(key, "").strip()
    if not value:
        raise ConfigurationError(
            "Missing required environment variable(s): "
            + ", ".join(get_missing_provider_vars(env))
        )
    return value


def _read_port(raw_value: str | None, default: int, env_name: str) -> int:
    value = (raw_value or "").strip()
    if not value:
        return default

    try:
        port = int(value)
    except ValueError as exc:
        raise ConfigurationError(f"{env_name} must be a valid integer port.") from exc

    if port < 1 or port > 65535:
        raise ConfigurationError(f"{env_name} must be between 1 and 65535.")

    return port


def get_missing_provider_vars(env: dict[str, str] | None = None) -> list[str]:
    source = env if env is not None else os.environ
    return [name for name in REQUIRED_PROVIDER_VARS if not source.get(name, "").strip()]


def load_config(env: dict[str, str] | None = None) -> VoiceWorkerConfig:
    source = env if env is not None else os.environ
    missing = get_missing_provider_vars(source)
    if missing:
        raise ConfigurationError(
            "Missing required environment variable(s): " + ", ".join(missing)
        )

    return VoiceWorkerConfig(
        host=source.get("VOICE_WORKER_HOST", DEFAULT_HOST).strip() or DEFAULT_HOST,
        port=_read_port(source.get("VOICE_WORKER_PORT"), DEFAULT_PORT, "VOICE_WORKER_PORT"),
        runner_host=source.get("VOICE_WORKER_RUNNER_HOST", DEFAULT_RUNNER_HOST).strip()
        or DEFAULT_RUNNER_HOST,
        runner_port=_read_port(
            source.get("VOICE_WORKER_RUNNER_PORT"),
            DEFAULT_RUNNER_PORT,
            "VOICE_WORKER_RUNNER_PORT",
        ),
        runner_transport=(
            source.get("VOICE_WORKER_RUNNER_TRANSPORT", DEFAULT_RUNNER_TRANSPORT).strip()
            or DEFAULT_RUNNER_TRANSPORT
        ),
        deepgram_api_key=_read_required(source, "DEEPGRAM_API_KEY"),
        deepgram_model=_read_required(source, "DEEPGRAM_MODEL"),
        google_api_key=_read_required(source, "GOOGLE_API_KEY"),
        google_model=_read_required(source, "GOOGLE_MODEL"),
        cartesia_api_key=_read_required(source, "CARTESIA_API_KEY"),
        cartesia_model=_read_required(source, "CARTESIA_MODEL"),
        cartesia_voice_id=_read_required(source, "CARTESIA_VOICE_ID"),
    )


def get_public_config_status(env: dict[str, str] | None = None) -> dict[str, object]:
    source = env if env is not None else os.environ
    missing = get_missing_provider_vars(source)
    host = source.get("VOICE_WORKER_RUNNER_HOST", DEFAULT_RUNNER_HOST).strip() or DEFAULT_RUNNER_HOST
    port = _read_port(
        source.get("VOICE_WORKER_RUNNER_PORT"),
        DEFAULT_RUNNER_PORT,
        "VOICE_WORKER_RUNNER_PORT",
    )

    return {
        "ok": not missing,
        "runnerBaseUrl": f"http://{host}:{port}",
        "clientUrl": f"http://{host}:{port}/client",
        "missing": missing,
    }
