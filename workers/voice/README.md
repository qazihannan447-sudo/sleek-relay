# Local Pipecat Voice Worker POC

This worker now contains a local-only Pipecat proof of concept for browser voice testing.

Implemented scope:

- SmallWebRTC local browser transport
- Deepgram Flux STT
- Google Gemini LLM
- Cartesia streaming TTS
- One fixed English system prompt in code
- Health and configuration helper endpoints

Still out of scope in this worker slice:

- Supabase
- portal agent loading
- runtime package loading
- conversations, recordings, and tools
- dashboard integration

## Environment

The canonical provider configuration file for the local worker is the repo-root
`.env.voice`.

1. Copy `.env.voice.example` to `.env.voice` at the repository root.
2. Fill in:
   - `DEEPGRAM_API_KEY`
   - `DEEPGRAM_MODEL`
   - `GOOGLE_API_KEY`
   - `GOOGLE_MODEL`
   - `CARTESIA_API_KEY`
   - `CARTESIA_MODEL`
   - `CARTESIA_VOICE_ID`

Recommended initial values:

- `DEEPGRAM_MODEL=flux-general-en`
- `GOOGLE_MODEL=gemini-2.5-flash`

### Deepgram warm pool

On worker boot the process opens a ready Deepgram Flux WebSocket (default pool
size 1) and keeps it alive so Connect does not pay cold DNS/TLS/Flux handshake
latency on the critical path. Optional overrides in `.env.voice`:

- `DEEPGRAM_WARM_POOL_ENABLED=1`
- `DEEPGRAM_WARM_POOL_SIZE=1`
- `DEEPGRAM_WARM_SAMPLE_RATE=16000`
- `DEEPGRAM_WARM_KEEPALIVE_SECS=10`

Pipeline StartFrame no longer waits for Deepgram; the opening greeting can play
while STT finishes adopting the warm socket in the background.

### Daily room pool

On worker boot the process pre-creates Daily rooms (default pool size 1) so
Connect `/start` does not wait on `POST /rooms`. A fresh meeting token is minted
when a room is adopted. Optional overrides in `.env.voice`:

- `DAILY_ROOM_POOL_ENABLED=1`
- `DAILY_ROOM_POOL_SIZE=1`
- `DAILY_ROOM_POOL_TTL_HOURS=1`
- `DAILY_ROOM_POOL_MIN_REMAINING_SECS=300`

Requires `DAILY_API_KEY`. If the pool is empty or disabled, `/start` falls back
to Pipecat's normal cold room create path.
- `CARTESIA_MODEL=sonic-3.5`

### Runner /health endpoint

The runner exposes `GET /health` (installed onto the Pipecat runner app at
boot). It returns `{"status": "ok"}` plus Daily room pool availability. The
portal pings it on the agents pages to wake and keep-warm a hosted runner.

When the runner is deployed on a host that spins idle services down (for
example the Render free tier), the dashboard keep-alive only helps while a
user has an agents page open. To remove cold starts entirely, point an
external uptime pinger at `/health` on an interval below the host's idle
window, or use an always-on instance type.

## Install

From `workers/voice` inside Ubuntu-24.04 WSL:

```powershell
$env:UV_CACHE_DIR = "C:\tmp\uv-cache"
uv python find 3.12
uv sync --python 3.12
```

If Python 3.12 is not already installed on your machine, install it first:

```powershell
$env:UV_CACHE_DIR = "C:\tmp\uv-cache"
uv python install 3.12
```

The worker now loads the repo-root `.env.voice` automatically. You do not need
to manually run `set -a`, `source .env.voice`, or `set +a`.

## Run

Normal startup uses one command from the repository root on Windows:

```powershell
cd C:\sleek-relay
.\run-voice-worker.ps1
```

Then open:

```text
http://127.0.0.1:7860/client
```

The Pipecat client page is the intended local browser surface for this POC. It should provide the browser mic connection, live transcripts, speaking-state updates, interruption handling, and session disconnect behavior when the runtime dependencies are installed successfully.

## Optional helper server

For configuration and health debugging only, you can still run the helper
server from `workers/voice` inside WSL:

```powershell
$env:UV_CACHE_DIR = "C:\tmp\uv-cache"
uv run --python 3.12 -m app.server
```

Useful local helper URLs:

- `http://127.0.0.1:8000/health`
- `http://127.0.0.1:8000/config`

## Troubleshooting

- Missing or invalid environment variables: the worker exits with a clear configuration error and `/config` returns the missing variable names. The repo-root `.env.voice` is the expected local config file.
- Dependency import failures: `uv run --python 3.12 -m app.bot` exits with a message telling you that Pipecat worker dependencies are not installed.
- `uv` cache issues on Windows: if `uv` fails to initialize its default cache under your user profile, set `$env:UV_CACHE_DIR = "C:\tmp\uv-cache"` before running `uv` commands.
- Native dependency policy blocks: on this machine, a full Pipecat dependency import under the synced Python 3.12 environment still hit a Windows Application Control block on a SciPy DLL during runtime import, even though `uv sync`, worker module imports, tests, and compilation all succeeded.
- Browser connection issues: confirm `http://127.0.0.1:7860/client` loads and that the Pipecat runner process started without provider or import errors.
