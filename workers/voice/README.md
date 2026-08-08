# Local Pipecat Voice Worker

Browser voice-agent worker for the Sleek Relay portal dashboard test flow.

Implemented scope:

- Daily (and SmallWebRTC) browser transport via Pipecat runner
- Portal runtime-package loading (tenant/agent config, tools, prompt)
- Deepgram Flux STT with warm-pool preconnect
- Google Gemini LLM
- Cartesia Sonic streaming TTS
- Capture tools, end-session, conversation timeline/usage hooks
- Opening greeting with optional barge-in when interruptions are enabled

Primary integration surface is the portal Agents → Test drawer, not the stock
Pipecat `/client` page alone.

## Environment

The canonical provider configuration file for the local worker is the repo-root
`.env.voice`.

1. Copy `.env.voice.example` to `.env.voice` at the repository root (if present),
   or create `.env.voice` with the keys below.
2. Fill in:
   - `DEEPGRAM_API_KEY`
   - `DEEPGRAM_MODEL`
   - `GOOGLE_API_KEY`
   - `GOOGLE_MODEL`
   - `CARTESIA_API_KEY`
   - `CARTESIA_MODEL`
   - `CARTESIA_VOICE_ID`
   - `VOICE_SESSION_SIGNING_SECRET` (shared with the portal)
   - `PORTAL_BASE_URL` (for runtime-config / capture callbacks)
   - `DAILY_API_KEY` (Daily transport / room pool)

Recommended initial values:

- `DEEPGRAM_MODEL=flux-general-en`
- `GOOGLE_MODEL=gemini-2.5-flash`
- `CARTESIA_MODEL=sonic-3.5`

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

### Cartesia voices and Sonic 3.5 humanization baseline

Recommended Cartesia voices for this worker follow Cartesia's **stable
production-agent** shortlist (previewable in the portal catalog):

| Voice | Style | Voice ID |
| --- | --- | --- |
| Katie | Friendly support (suggested A/B starting point) | `f786b574-daa5-4673-aa0c-cbe3e8534c02` |
| Skylar | Approachable customer care | `db6b0ed5-d5d3-463d-ae85-518a07d3c2b4` |
| Jacqueline | Reassuring agent | `9626c31c-bec5-4cca-baa8-f8ba9e84c8bc` |
| Jameson | Easygoing support | `a5136bf9-224c-4d76-b823-52bd5efcffcc` |
| Ronald | Measured / natural | `5ee9feff-1265-424a-9d7f-8e4d431a12c7` |
| Gemma | Decisive agent | `62ae83ad-4f6a-430b-af41-a9bede9286ca` |
| Archie | Approachable mate | `ef191366-f52f-447a-a398-ed8c0f2943a1` |
| Cathy | Coworker | `e8e5fffb-252c-436d-b842-8879b84445b6` |
| Caroline | Southern guide | `f9836c6e-a0bd-460e-9d3c-f7299fa60f94` |

Do **not** treat Maya (or other highly emotive/character voices) as the
production receptionist default. Emotive voices remain available under
**More voices** in Configure Voice after listening tests.

Suggested local env starting point for A/B listening (not a declared winner):

```
CARTESIA_VOICE_ID=f786b574-daa5-4673-aa0c-cbe3e8534c02
```

For `CARTESIA_MODEL=sonic-3.5` (and dated `sonic-3.5-*` snapshots), the worker uses the
humanization baseline: TOKEN aggregation with Cartesia managed buffering (no
`max_buffer_delay_ms` override) and no global emotion/speed/volume
`generation_config`. Agent tone remains an LLM persona instruction only.
Legacy/non-3.5 models still apply emotion-from-tone, `speed=0.9`, `volume=1.0`,
and `max_buffer_delay_ms=1000`.
If an agent has its own Voice ID in the dashboard, that overrides `CARTESIA_VOICE_ID`.
Carson has multiple provider variants — do not hard-code one until it is auditioned.
Daniel is on Cartesia's stable list but currently lacks a preview sample, so it is
not featured under the preview-required catalog policy.

Turn ownership uses Deepgram Flux + `ExternalUserTurnStrategies`. Silero VAD
remains attached for speech-stop metrics. `interruptionEnabled` maps to Flux
`should_interrupt` and also controls greeting barge-in after a short grace
window.

Each session logs a secret-free `humanization_baseline` line (model, voice id,
buffer mode, turn owner, interruption flags) for A/B listening notes. See
`docs/HUMANIZATION_AB_TEST.md` and `docs/CARTESIA_HUMANIZATION_RESEARCH_AUDITED.md`.

### Session prestart, Daily pre-join, and the client no-show guard

The dashboard starts the bot as early as practical:

1. Agent page open → conversation/token prebootstrap + runner `/health` keep-alive
2. Test-agent intent (hover / focus / press) → runner `/start` so the bot enters
   the Daily room before the drawer finishes opening
3. Test drawer open → muted browser Daily join (WebRTC + RTVI / BotReady)

Runner wake (`/health`) is awaited before `/start` so a spun-down hosted
runner is not hit cold by the heavier start call.

Connect only:

1. Enables the microphone (`setLocalAudio` / `enableMic`)
2. Sends an RTVI `session_armed` client message
3. Explicitly unlocks remote bot audio playback (`audio.play()`), because
   muted Daily pre-join can attach the bot track before Connect and leave
   browser autoplay paused (transcript text still works without sound)
4. Marks the conversation lifecycle connected

`PipecatClient.connect()` resolves on BotReady (after WebRTC is up), so the
browser join wait covers both Daily and the worker RTVI handshake.

The worker holds the opening greeting until **pipeline started + client
connected + RTVI client-ready + session armed**, so pre-join never speaks
before the user clicks Connect. Maximum session duration also starts on arm,
not on the earlier Daily pre-join.

If no client ever joins a (pre)started session, the worker cancels it:

- `VOICE_CLIENT_NO_SHOW_TIMEOUT_SECS=120` (default)

The dashboard reuses a prestarted / pre-joined session for at most 60 seconds,
which must stay below this timeout. Leaving the agent page abandons the
reserved conversation; closing only the drawer keeps a fresh prestart for
quick reopen while the agent page is still mounted. Panel remounts (including
React Strict Mode) reclaim an in-flight Daily join instead of disconnecting
and starting over.

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

Keep `pipecat-ai==1.7.0` pinned. Do not upgrade Pipecat while comparing
humanization A/B configurations.

## Run

Normal startup uses one command from the repository root on Windows:

```powershell
cd C:\sleek-relay
.\run-voice-worker.ps1
```

Then use the portal dashboard Agents → Test drawer (with portal + worker running).

Optional local Pipecat client surface:

```text
http://127.0.0.1:7860/client
```

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
- Browser connection issues: confirm the portal Test drawer can Connect, or that `http://127.0.0.1:7860/client` loads and the Pipecat runner process started without provider or import errors.
- Robotic / unnatural speech: confirm `CARTESIA_MODEL=sonic-3.5`, pick a recommended stable voice, and check the worker log for `humanization_baseline` / `cartesia tts baseline=sonic-3.5-humanization`.
