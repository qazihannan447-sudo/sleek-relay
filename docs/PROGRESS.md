# Progress

## 2026-08-08

Fixed duplicate Conversations rows after a single browser voice test.

Completed:

- Stopped auto-prejoin from creating a second conversation after an armed session ends in the same drawer mount
- Unused warmup discard now deletes the reserved row even if the worker already finalized it (no longer no-ops on non-`starting` status)

Verified:

- `npm test -- tests/warm-connect.test.ts tests/voice-session.test.ts tests/portal-performance.test.ts` passed
- ESLint on touched files passed

Not yet verified:

- Live single Connect ? Conversations navigation against a deployed portal build

## 2026-08-08

Conversations tab limited to completed/failed sessions only.

Completed:

- Status filter options reduced to Completed and Failed
- Conversations list query always excludes in-progress statuses (`starting`, `active`, `cancelled`)
- Unused warmup/prestart reservations are deleted via `DELETE /api/voice/conversations/[id]` instead of becoming Failed rows
- Stale reconciler deletes never-connected `starting` rows; orphaned `active` rows still finalize to Completed

Verified:

- `npm test -- tests/warm-connect.test.ts tests/portal-performance.test.ts tests/voice-session.test.ts` passed
- ESLint on touched conversation status files passed

Not yet verified:

- Live dashboard review against an existing tenant that still has old `starting` rows (they disappear after reconcile on Conversations load)

## 2026-08-08

Conversation list Est. cost column and drawer Usage & cost breakdown added.


Completed:

- Added minutes-only CAD cost estimate helper (`$0.07/min`) with STT/TTS/LLM lines marked unavailable until metering exists
- Conversations table now shows an **Est. cost** column from connected duration
- Conversation detail drawer now has a **Usage & cost** section with connected minutes, per-line breakdown, and est. total
- Estimates are labeled as minutes-only so they are not mistaken for full provider cost

Verified:

- `npx tsx --test tests/usage-cost.test.ts` passed
- Relevant `voice-session` conversation detail assertions passed under `NODE_ENV=test`
- `npx tsc --noEmit -p tsconfig.typecheck.json` passed
- ESLint on touched conversation usage files passed

Not yet verified:

- Live browser review of the new column/drawer section
- Real STT/TTS/token metering and full cost breakdown remain future work

## 2026-08-08

Usage analytics wired to real tenant conversation data.

Completed:

- Replaced Usage preview sample data with tenant-scoped aggregation from `conversations` via RLS
- Connected minutes prefer `duration_ms`, then `ended_at - started_at`, then live elapsed for open sessions
- Period chips filter by calendar month, last 7 days, or last 30 days
- Charts now show real minutes-over-time, minutes-by-agent, outcomes, and latency p50/p95 from stored turn metrics when available
- Est. tokens remains `` until token metering is persisted
- Default monthly cap remains 180 connected minutes until tenant caps are stored
- Removed the preview-only banner; empty periods show a clear zero state

Verified:

- `npx tsx --test tests/usage.analytics.test.ts` passed (7 tests)
- `npx tsc --noEmit -p tsconfig.typecheck.json` from `apps/portal` passed
- ESLint on Usage-related files passed

Not yet verified:

- Live browser review against a tenant with real conversations
- Token metering and configurable tenant caps remain future work
- Cap enforcement (blocking new sessions at limit) is not implemented yet

## 2026-08-08

Usage & Analytics dashboard tab UI added (charts-only; metering not wired yet).

Completed:

- Added a Usage sidebar item and protected `/dashboard/usage` route under `apps/portal`
- Built a charts-focused Usage page with period chips (This month / Last 7 days / Last 30 days), KPI cards, minutes-over-time line chart, minutes-by-agent bars, cap-remaining donut, outcomes bars, latency snapshot, and a View conversations CTA
- Kept session tables off this page; Conversations remains the detail destination
- Added SVG chart components without a new charting dependency
- Preview analytics data powers the layout until connected-minute metering and tenant caps are persisted
- Added focused tests for period parsing and preview analytics shaping

Verified:

- `npx tsc --noEmit -p tsconfig.typecheck.json` from `apps/portal` passed
- `npx tsx --test tests/usage.preview.test.ts` passed
- ESLint on Usage-related files passed

Not yet verified:

- Live browser review of the Usage page against an authenticated session
- Full `npm run lint` still reports pre-existing unused-symbol errors in unrelated agent/conversation files
- Real connected-minute metering, tenant caps, token tracking, and enforcement are still unimplemented

## 2026-08-08

Capture, appointment-request, and soft handoff workflows implemented end-to-end for the browser voice demo (Phases AE).

Completed:

- Added migration `supabase/migrations/20260808090000_add_capture_handoff_configuration.sql` for business handoff/appointment fields, agent `capabilities` jsonb, and tenant-scoped `conversation_captures` with member SELECT RLS
- Extended business and agent forms so owners configure shared destinations/policy and per-agent capability toggles without writing system prompts
- Runtime packages now emit `capabilities`, gated `enabledTools`, and prompt rules for confirm ? tool ? speak-success-only behavior
- Added portal capture API `POST /api/voice/conversations/[conversationId]/captures` with voice session-token auth, capability checks, business handoff destination gating, Zod validation, idempotency, and conversation outcome updates
- Worker registers allowlisted tools from `enabledTools`: `capture_lead`, `capture_message`, `create_appointment_request`, `offer_human_handoff` (plus existing `end_session`)
- Appointment and handoff statuses remain `requested` only; appointment success speech never claims a booking; handoff success uses the configured script and never claims a live transfer
- Conversation detail drawer shows a Captures section; detail loader scopes captures by tenant and conversation
- Demo seed enables Finova-style capture + appointment + soft handoff on Greenleaf Front Desk with callback handoff settings

Verified:

- `npm test` from `apps/portal` passed (includes capture, handoff, runtime, and conversation-detail isolation coverage)
- `npx tsc --noEmit -p tsconfig.typecheck.json` from `apps/portal` passed
- `python -m unittest tests.test_captures tests.test_runtime_config` from `workers/voice` passed
- `python -m unittest tests.test_supabase_foundation` from repo root passed for migration/seed artifacts

Not yet verified:

- Live browser appointment/handoff capture against a Supabase project still requires applying migration `20260808090000_add_capture_handoff_configuration.sql` (and re-seeding if demo capabilities are needed)
- Outbound notification email/SMS sending remains intentionally deferred; `notification_email` is stored only
- PSTN / Telnyx warm transfer remains out of scope

## 2026-08-06

Agent browser-test bootstrap now creates a conversation, issues a session token, and passes it into SmallWebRTC before connect.

Completed:

- Updated the protected agent test page under `apps/portal/app/dashboard/agents/[agentId]/test` so the browser connect flow now waits for two server-side bootstrap calls before contacting the local SmallWebRTC runner
- Added a focused browser bootstrap helper under `apps/portal/lib/voice/browser-test.ts` that:
  - `POST`s `/api/voice/conversations` with the selected agent ID
  - `POST`s `/api/voice/conversations/{conversationId}/session-token`
  - validates the returned success payloads
  - builds the exact SmallWebRTC `requestData` shape with both top-level `voiceSessionToken` and nested `metadata.voiceSessionToken`
- Wired the test panel so the local Pipecat client now connects only after both bootstrap requests succeed and shows a safe visible error if either bootstrap step fails
- Added a single-flight guard in the test panel so repeated Connect clicks during startup are ignored while the current bootstrap is in progress
- Preserved the existing local worker fallback behavior on the worker side by reusing the already-supported token extraction fields instead of changing worker code
- Updated the test-page copy so it no longer claims browser tests avoid conversation creation, while still noting that transcript ingestion, finalization, recordings, and usage events remain future worker-integrated phases
- Expanded the portal test suite with focused coverage for browser bootstrap request ordering, safe bootstrap failures, malformed payload rejection, and the exact token placement expected by the worker-side SmallWebRTC request data

Verified:

- `npm run lint` from `apps/portal` passed
- `npm run typecheck` from `apps/portal` passed
- `npm test` from `apps/portal` passed with 99 passing tests
- `npm run build` from `apps/portal` passed

Observed warnings:

- `next build` still warns that the Next.js ESLint plugin is not explicitly configured in the current flat ESLint setup
- The installed `@supabase/supabase-js` dependency still warns that Node.js 20 and below are deprecated and Node.js 22+ will be required in a future release

Not yet verified:

- A live browser connect against the local SmallWebRTC runner was not manually exercised here after the new two-step bootstrap flow was added
- The worker handoff is still limited to passing the signed token in request metadata; no worker startup, ingestion, or finalization behavior was changed in this task

## 2026-08-06

Conversation-scoped voice session token issuance implemented in the portal.

Completed:

- Added a protected `POST /api/voice/conversations/[conversationId]/session-token` route under `apps/portal` for short-lived conversation-scoped browser voice session tokens
- Added a server-only voice session token module under `apps/portal/lib/voice/session-token.ts` using the existing `jose` library with an explicit `HS256` allowlist, a 30-minute server-controlled lifetime, a 30-second verification clock-skew tolerance, and strict claim validation for version, purpose, subject, conversation ID, agent ID, issuer, audience, source, `iat`, and `exp`
- Added a separate server-only issuance service under `apps/portal/lib/voice/issue-session-token.ts` that authenticates through the Supabase SSR session, resolves the current workspace through the shared workspace loader, loads the conversation through tenant-scoped SSR reads, enforces `browser_test` plus `starting` or `active` eligibility, re-validates tenant ownership of the linked agent, and returns safe JSON error responses
- Added a focused route-mapping helper under `apps/portal/lib/voice/issue-session-token-route.ts` so the App Router entry remains minimal while response mapping and no-store headers stay directly testable
- Added a server-only Bearer authorization parsing helper for future worker handoff without exposing any public verification endpoint in this task
- Updated `.env.example` and `.env.portal.example` with a server-only `VOICE_SESSION_SIGNING_SECRET` placeholder plus generation guidance, while keeping the secret out of `NEXT_PUBLIC` variables and committed values
- Added focused portal tests covering valid signing and verification, expiry rejection, invalid signature rejection, malformed token rejection, wrong issuer, wrong audience, wrong purpose, unsupported version, unsupported algorithm, subject mismatch, invalid UUID claims, safe secret validation errors, Bearer parsing, unauthenticated and missing-workspace issuance, own-tenant `starting` and `active` issuance, completed or failed or cancelled rejection, cross-tenant safe not-found behavior, non-browser source rejection, no-store response headers, ignored browser body injection, and absence of full-token console logging

Verified:

- `npm run lint` from `apps/portal` passed
- `npm run typecheck` from `apps/portal` passed
- `npm test` from `apps/portal` passed with 89 passing tests
- `npm run build` from `apps/portal` passed

Observed warnings:

- `next build` still warns that the Next.js ESLint plugin is not explicitly configured in the current flat ESLint setup
- The installed `@supabase/supabase-js` dependency still warns that Node.js 20 and below are deprecated and Node.js 22+ will be required in a future release

Not yet verified:

- No live browser flow has yet requested a conversation-scoped session token against a real authenticated Supabase tenant session
- The token is not yet handed off to the voice worker and no worker-side consumption path was implemented in this task
- No one-time-use or revocation behavior exists yet because this task intentionally did not add token persistence or worker session state

## 2026-08-06

Worker reliability and session-lifecycle coverage expanded for the local Pipecat worker.

Completed:

- Added focused worker reliability coverage for ten sequential completed turns in one session, asserting unique turn IDs, exactly one latency summary per turn, no state leakage, and no duplicate provider lifecycle markers at the latency-tracker boundary
- Added focused interruption coverage for five sequential barge-ins, asserting one interrupted summary per interrupted turn, correct `barge_in_to_bot_silence_ms` ownership, no ghost turns, and valid follow-up user turns after each interruption
- Added reconnect-lifecycle coverage for fresh controller and tracker state across new sessions, including end-session reconnect behavior, Deepgram retry-state isolation after reconnect, and concurrent session-state object isolation
- Added provider-error lifecycle coverage asserting one provider-error summary, one pipeline cancellation, one provider-error client message, one cleanup path, and no fake completed turn
- Added deeper Deepgram retry coverage asserting disconnect during retry backoff clears the retry task and prevents stale reconnect attempts from continuing
- Added summary-capturing tracker helpers in the worker test suite so reliability assertions can verify exact one-summary-per-turn behavior without changing the production voice pipeline
- Fixed one real lifecycle defect in `workers/voice/app/bot.py`: `VoiceTurnLatencyTracker.reset_session()` now clears prior completed-turn state so old latency records cannot leak into a future session if the tracker is reused

Verified with the Ubuntu-24.04 WSL `uv` Python 3.12 worker runtime:

- `uv run --python 3.12 -m unittest discover -v -s tests -t . -p "test_*.py"` from `workers/voice` passed
- The current worker suite contains 42 focused test cases in `workers/voice/tests/test_bot.py`
- `uv run --python 3.12 -m compileall app bot.py tests` from `workers/voice` passed
- Pipecat dependency import checks passed for `DeepgramFluxSTTService`, `GoogleLLMService`, `CartesiaTTSService`, `SmallWebRTCTransport`, and `ErrorFrame`

Not yet verified:

- Real browser stress runs with many consecutive turns, rapid repeated interruptions, and reconnects still need to be exercised manually against the live portal plus worker session
- Transport-disconnect behavior during active bot speech is now covered at the worker lifecycle boundary by controller and latency tests, but full browser-triggered disconnect timing still needs manual verification against a live WebRTC session

## 2026-08-06

Server-side browser conversation start API implemented in the portal.

Completed:

- Added a protected `POST /api/voice/conversations` route under `apps/portal` that accepts only `{ agentId, source }` JSON and returns safe JSON responses
- Added a focused server-only Supabase admin helper under `apps/portal/lib/supabase/admin.ts` for service-role conversation writes, while preserving the existing authenticated SSR client for workspace resolution and tenant-scoped reads
- Added a dedicated start-conversation service under `apps/portal/lib/voice/start-conversation.ts` that separates request parsing, tenant and agent authorization, server-generated insert construction, and safe success and failure response mapping
- Kept tenant ownership server-derived by resolving the authenticated workspace through the shared workspace loader and checking the selected agent through the authenticated SSR client before any service-role write occurs
- Limited inserts to the existing `public.conversations` table with server-controlled values for `tenant_id`, `agent_id`, `source`, `status`, `started_at`, `runtime_snapshot`, `latency_metrics`, and safe initial `metadata`
- Updated `.env.example` and `.env.portal.example` so `SUPABASE_SERVICE_ROLE_KEY` is documented as server-only and explicitly prohibited from any browser or `NEXT_PUBLIC` exposure
- Expanded the existing portal test suite with focused coverage for valid and invalid request parsing, unsupported source rejection, unauthenticated and missing-workspace flows, active-agent success, inactive and cross-tenant agent rejection, server-owned insert fields, safe database failures, service-role environment validation, and the server-only admin module boundary

Verified:

- `npm run lint` from `apps/portal` passed
- `npm run typecheck` from `apps/portal` passed
- `npm test` from `apps/portal` passed with 72 passing tests

Build status:

- `npm run build` from `apps/portal` did not pass in this environment on Thursday, August 6, 2026
- The build failed with `EPERM: operation not permitted, open 'C:\sleek-relay\apps\portal\.next\trace'`

Not yet verified:

- End-to-end browser-triggered conversation creation against a real authenticated Supabase tenant session and a live voice-worker startup path was not exercised here
- The new route currently creates only the initial conversation record and intentionally does not cover worker startup, transcript ingestion, conversation finalization, recordings, or summaries

## 2026-08-06

Tenant-scoped Conversation detail page implemented in the portal.

Completed:

- Added the protected `/dashboard/conversations/[conversationId]` route in `apps/portal` using the existing shared workspace loader and authenticated Supabase SSR client
- Added a dedicated conversation detail loader with UUID validation, tenant-scoped conversation and transcript queries, safe cross-tenant not-found handling, and safe back-link preservation through an allowlisted `returnTo` parameter
- Reused and extended shared conversation helpers for UUID validation, safe JSON normalization, latency metric formatting, runtime snapshot allowlisting, metadata allowlisting, message role labels, interrupted and interim presentation, transcript-state selection, and message timestamp ordering
- Added a tenant-scoped transcript view ordered by `sequence_number`, with role-specific presentation, plain-text rendering, preserved line breaks, interrupted markers, and an empty transcript state
- Added restrained summary, outcome, error-detail, latency-metric, runtime-snapshot, and metadata sections that only render stored safe fields and ignore secret or unsupported values
- Updated the conversations list links so detail navigation can safely return to the current filtered list state
- Added a route-level loading skeleton and focused dashboard styling for the conversation detail cards, transcript rows, and runtime diagnostics
- Expanded the existing portal test suite with focused coverage for UUID handling, safe cross-tenant not-found behavior at the loader boundary, transcript ordering, role labels, interrupted message state, null summary and outcome handling, latency allowlisting, runtime-snapshot secret exclusion, metadata secret exclusion, safe stored error handling, and empty transcript state selection

Verified:

- `npm run lint` from `apps/portal` passed
- `npm run typecheck` from `apps/portal` passed
- `npm test` from `apps/portal` passed with 58 passing tests

Build status:

- `npm run build` from `apps/portal` did not pass in this environment on Thursday, August 6, 2026
- The build failed with `EPERM: operation not permitted, open 'C:\sleek-relay\apps\portal\.next\trace'`

Not yet verified:

- Live browser rendering of the new conversation detail page against a real authenticated Supabase tenant session was not manually exercised here
- End-to-end navigation from the filtered list into the detail page and back through a real browser session remains a manual verification step
- The production build remains unverified in this environment because the local Next.js build still fails before completion with the Windows `.next\trace` lock error

## 2026-08-06

Per-turn latency instrumentation and diagnostic cleanup implemented for the local Pipecat worker.

Completed:

- Added a session-scoped `VoiceTurnLatencyTracker` under `workers/voice/app/bot.py` that assigns one unique turn ID per user turn and records monotonic timestamps for user speech start and stop, first interim transcript, accepted final transcript, LLM request start, LLM first token, LLM response completion, TTS request start, first TTS audio frame, bot speaking start, and bot speaking stop
- Added per-turn latency calculations for speech-stop to final-transcript, final-transcript to LLM first token, LLM first token to first TTS audio, final-transcript to bot speaking, speech-stop to bot speaking, bot-speaking duration, and total turn duration
- Added `barge_in_to_bot_silence_ms` for interrupted turns so the worker now measures how quickly bot audio actually stops after a live barge-in
- Added structured turn completion summaries that log one concise `voice latency` block when a turn finishes with status `completed`, `interrupted`, `end-session`, `provider-error`, or truthful `incomplete-metrics` classification where required timestamps are genuinely missing
- Tightened turn state isolation so transcript and bot-stop paths no longer synthesize ghost turns, interruptions keep the prior assistant turn pending until the real bot-stop arrives, and trailing bot-stop events from interrupted audio no longer contaminate the next user turn
- Wired end-session and provider-error paths into the latency tracker without changing Deepgram settings, Gemini settings, Cartesia settings, pipeline order, retry policy, or portal code
- Removed the old per-event `user-started-speaking` and `user-stopped-speaking` diagnostic log lines from the observer so duplicate lifecycle logs no longer add noise while turn metrics are active
- Preserved the existing Pipecat metrics collection path and left provider configuration unchanged
- Added focused worker tests for timestamp ordering, duration calculations, no ghost completed turn during interruption, interrupted-turn plus next-turn isolation, truthful incomplete-metrics classification, barge-in silence timing, duplicate bot-stop suppression, provider-error turns, end-session turns, and session reset behavior

Verified with the Ubuntu-24.04 WSL `uv` Python 3.12 worker runtime:

- `uv run --python 3.12 -m unittest discover -v -s tests -t . -p "test_*.py"` from `workers/voice` passed with 46 tests
- `uv run --python 3.12 -m compileall app bot.py tests` from `workers/voice` passed
- `uv run --python 3.12 python /mnt/c/tmp/voice_import_check.py` from `workers/voice` passed and confirmed `DeepgramFluxSTTService`, `GoogleLLMService`, `CartesiaTTSService`, `SmallWebRTCTransport`, and `ErrorFrame`

Not yet verified:

- Five real browser turn samples with the new `voice latency` summaries still need to be collected manually from a live portal plus worker session
- The observed latency values for interruption-heavy conversations, including the new `barge_in_to_bot_silence_ms` measurement, have not yet been manually reviewed in a running browser session here
- The structured latency summaries are source-verified and unit-tested, but their exact live timing distribution across Deepgram, Gemini, and Cartesia remains a runtime measurement task rather than an automated proof

## 2026-08-06

Tenant-scoped Conversations list page implemented in the portal.

Completed:

- Replaced the placeholder `/dashboard/conversations` route in `apps/portal` with a protected server-rendered conversations page that resolves the current workspace through the shared workspace loader and never trusts tenant identifiers from the browser
- Added a tenant-scoped conversations loader that reads through the authenticated Supabase SSR client, applies server-side filter normalization, and still relies on row-level security for the final data boundary
- Added reusable conversation helpers for status parsing, date-range normalization, pagination, duration formatting, filter URL generation, and empty-state selection
- Added server-driven URL filters for `status`, `agent`, `source`, `from`, `to`, and `page`, with tenant-owned agent validation and invalid-query normalization
- Added server-side pagination with preserved filters, previous and next controls, visible-range reporting, and fallback agent text when a conversation references an unavailable tenant agent
- Updated the dashboard loading skeleton and portal styling so the conversations page uses the existing shell, cards, tables, badges, and responsive mobile table behavior
- Added focused portal tests covering conversation status parsing, date filters, pagination normalization, duration formatting, filter URL preservation, tenant agent-filter validation, and empty versus filtered-empty state selection

Verified:

- `npm run lint` from `apps/portal` passed
- `npm run typecheck` from `apps/portal` passed
- `npm test` from `apps/portal` passed with 45 passing tests

Build status:

- `npm run build` from `apps/portal` did not pass in this environment on August 6, 2026
- The direct build failed with `EPERM: operation not permitted, open 'C:\sleek-relay\apps\portal\.next\trace'`
- A follow-up `npm run build:clean` check also failed in this environment before the app build began with `EPERM: operation not permitted, lstat 'C:\Users\habib'`

Not yet verified:

- Live browser rendering and interaction for the new conversations list against a real authenticated Supabase tenant session were not manually exercised here
- The conversation detail route remains intentionally unimplemented in this task, so row links are present but the destination page still needs a future implementation
- A completed post-change production build remains unverified in this environment because both available local build paths failed with Windows permission errors unrelated to TypeScript or test failures

## 2026-08-06

Local Deepgram Flux startup and handshake-failure handling hardened for the Pipecat browser worker.

Completed:

- Added a session-scoped `DeepgramStartupController` under `workers/voice/app/bot.py` that uses the installed Pipecat 1.7.0 Flux lifecycle hooks `on_connected`, `on_connection_error`, `PipelineTask.cancel(...)`, and the worker `on_pipeline_error` event to manage startup failures without changing the working processor order
- Added explicit handshake-error detection for opening-handshake failures so startup connection errors are handled separately from ordinary transcription or downstream runtime errors
- Added a bounded pre-first-final-transcript retry policy of at most 3 total Deepgram connection attempts with short exponential backoff plus jitter, while reusing the same Flux service instance rather than creating duplicate processors
- Stopped retry scheduling once the first final user transcript is accepted, preserving normal post-startup conversation behavior
- Added disconnect-aware retry cancellation so browser disconnect or refresh stops any pending backoff or reconnect work immediately
- Added exhausted-retry handling that sends a safe Deepgram-specific RTVI error to the browser, cancels the pipeline cleanly, and relies on Pipecat shutdown to disconnect SmallWebRTC plus close provider resources
- Added safe worker logs for Deepgram attempt count, handshake timeout detection, retry delay, recovery on retry, retry exhaustion, retry cancellation after disconnect, and provider cleanup completion
- Added focused worker tests for handshake detection, first-attempt readiness, timeout then retry success, exhausted retries, disconnect during backoff, duplicate retry suppression, fresh retry state on a new session, and blocking startup retries after the first accepted user turn

Verified with the Ubuntu-24.04 WSL `uv` Python 3.12 worker runtime:

- `uv run --python 3.12 -m unittest discover -v -s tests -t . -p "test_*.py"` from `workers/voice` passed with 34 tests
- `uv run --python 3.12 -m compileall app bot.py tests` from `workers/voice` passed
- `uv run --python 3.12 python /mnt/c/tmp/voice_import_check.py` from `workers/voice` passed and confirmed `DeepgramFluxSTTService`, `GoogleLLMService`, `CartesiaTTSService`, `SmallWebRTCTransport`, and `ErrorFrame`

Not yet verified:

- A real browser reconnect path where Deepgram fails its opening handshake, the worker retries in the same live session, and the session either recovers or disconnects cleanly still requires manual verification
- Portal-visible wording and timing for the worker-emitted Deepgram provider error has not been manually reviewed in a running browser session here
- A forced rapid-refresh loop confirming there are no orphaned provider sockets beyond Pipecat's source-verified cleanup behavior remains a manual runtime check

## 2026-08-06

Deterministic local voice-worker end-of-session handling implemented for explicit user hang-up requests.

Completed:

- Added a deterministic pre-LLM end-intent processor under `workers/voice/app/bot.py` that intercepts downstream final `TranscriptionFrame` instances after Deepgram Flux STT and before the Pipecat user context aggregator
- Kept the worker-side `end_session` tool as a fallback path for indirect or semantically complex end requests, using Pipecat 1.7.0 advertised `FunctionSchema` support
- Added deterministic end-intent normalization and explicit-phrase matching so clear end-of-session requests such as `bye`, `goodbye`, `hello bye`, `please end this call now`, `hang up`, `stop this conversation`, `I think I am done here`, and `no, that is all, goodbye` are accepted before Gemini runs
- Added false-positive protection so incidental mentions such as `goodbye package` or discussion about the phrase `hang up` do not trigger teardown
- Added a guarded session-termination controller that sends one final short goodbye, waits for bot speaking completion, then queues a clean `EndFrame` shutdown exactly once
- Added safe worker logs for final-user-text evaluation, deterministic accept or reject, final goodbye queueing, final goodbye playback completion, `EndFrame` queueing, transport disconnect, and cleanup completion
- Reused the existing Pipecat task RTVI support to send a `session-ending` server message before transport shutdown where supported
- Added focused worker tests for explicit end-call requests, deterministic accepted and rejected phrase variants, repeated `bye` suppression, accepted-end-turn LLM bypass, final goodbye before disconnect, duplicate end-session prevention, and disconnect-time task cancellation

Verified with the Ubuntu-24.04 WSL `uv` Python 3.12 worker runtime:

- `uv run --python 3.12 -m unittest discover -v -s tests -t . -p "test_*.py"` from `workers/voice` passed with 25 tests
- `uv run --python 3.12 -m compileall app bot.py tests` from `workers/voice` passed
- `uv run --python 3.12 python -c "from app.bot import _import_pipecat_dependencies; print(sorted(k for k in _import_pipecat_dependencies() if k in {'DeepgramFluxSTTService', 'GoogleLLMService', 'CartesiaTTSService', 'SmallWebRTCTransport', 'FunctionSchema'}))"` from `workers/voice` passed

Not yet verified:

- A real browser session where the user says an explicit hang-up phrase and hears the final goodbye before the WebRTC session disconnects still requires manual verification
- Client-visible handling of the optional `session-ending` RTVI server message is not asserted in the current portal UI
- Provider-side close timing for live Deepgram and Cartesia sessions is source-verified through Pipecat shutdown behavior rather than manually traced in a live browser run here

## 2026-08-06

Portal Vercel production build command made Linux-compatible.

Completed:

- Updated `apps/portal/package.json` so the default `npm run build` command now executes `next build` directly instead of invoking PowerShell
- Kept the Windows-specific cleanup wrapper available as `npm run build:clean` for local cases where a stale `.next` lock needs to be cleared before building
- Updated `README.md` so local build guidance distinguishes the normal cross-platform build command from the Windows cleanup fallback

Verified:

- `npm run lint` from `apps/portal` passed
- `npm run typecheck` from `apps/portal` passed
- `npm test` from `apps/portal` passed

Not yet verified:

- A fresh `npm run build` result from this machine remains unverified because direct Next.js execution in this environment still fails before the app build starts with `EPERM: operation not permitted, lstat 'C:\Users\habib'`
- The repaired build command has not yet been re-run inside a live Vercel deployment from this environment

## 2026-08-06

Local voice-worker startup and environment loading contract unified for the WSL demo path.

Completed:

- Updated `workers/voice/app/config.py` so the worker automatically resolves and loads the repo-root `.env.voice` when running from this repository
- Kept process environment variables higher priority than `.env.voice` values by continuing to load the file with `override=False`
- Reworked `run-voice-worker.ps1` into a one-command WSL launcher for `Ubuntu-24.04` that validates `wsl.exe`, the worker project directory, the repo-root `.env.voice`, the expected Linux uv environment, and Python 3.12 before running `uv run --python 3.12 -m app.bot`
- Removed the launcher-side manual `set -a`, `source .env.voice`, and `set +a` flow because the worker now loads the canonical env file itself
- Updated `workers/voice/README.md` so the normal startup flow is now the single Windows command `.\run-voice-worker.ps1`
- Added focused worker tests for repo-root `.env.voice` resolution, environment precedence, missing-variable reporting, Pipecat dependency imports, and launcher startup-contract artifacts

Verified:

- `uv run --python 3.12 -m unittest discover -s tests -t . -p "test_*.py"` from `workers/voice` passed
- `uv run --python 3.12 -m compileall app` from `workers/voice` passed
- `uv run --python 3.12 python -c "import app.bot; app.bot._import_pipecat_dependencies(); print('pipecat-import-ok')"` from `workers/voice` passed
- PowerShell syntax validation for `run-voice-worker.ps1` passed through the PowerShell parser

Not yet verified:

- End-to-end startup through `.\run-voice-worker.ps1` inside a real accessible `Ubuntu-24.04` WSL session was not manually exercised here
- Real browser connection from the portal to the worker at `http://localhost:7860` still requires manual verification
- Live microphone capture, live transcript delivery, interruption behavior, and streamed audio playback remain manual runtime checks rather than automated proof

## 2026-08-06

Workspace onboarding flow implemented for first-time portal users.

Completed:

- Added a protected onboarding route at `apps/portal/app/onboarding/workspace` so authenticated users without a workspace no longer see dashboard skeletons or missing-membership dashboard states
- Added login-time workspace destination resolution so signed-in users without a tenant membership are redirected directly to workspace setup instead of the dashboard
- Added a focused portal onboarding form that collects workspace name, business name, category, and timezone before unlocking the dashboard
- Added server-side onboarding validation under `apps/portal/lib/onboarding`
- Added a new Supabase migration `20260806143000_add_initial_workspace_bootstrap.sql` with a guarded `public.create_initial_workspace(...)` bootstrap function that creates the tenant, owner membership, and initial business configuration in one operation
- Kept workspace creation server-mediated through the portal server action, while preserving tenant-scoped dashboard access after setup
- Updated protected dashboard routes so missing-membership sessions redirect to onboarding rather than rendering tenant-membership error pages
- Added focused portal tests for protected onboarding routing and onboarding form validation
- Added a focused Python artifact test for the new workspace bootstrap migration

Verified:

- `npm run lint` from `apps/portal` passed
- `npm run typecheck` from `apps/portal` passed
- `npm test` from `apps/portal` passed
- `npm run build` from `apps/portal` passed
- `python3.11 -m unittest discover -s tests -p "test_*.py"` passed

Not yet verified:

- End-to-end first-login workspace creation against a live Supabase project was not manually exercised in a running browser session here
- The new bootstrap migration has not been applied against a live or local Supabase/Postgres runtime in this environment
- Real execution of `public.create_initial_workspace(...)` remains pending until a healthy local or remote database target is available

Observed warnings:

- `next build` still warns that the Next.js ESLint plugin is not explicitly configured in the current flat ESLint setup
- The installed `@supabase/supabase-js` version warns that Node.js 20 is deprecated and Node.js 22+ will be required in a future release

## 2026-08-05

Initial project foundation created for the browser-based validation demo.

Completed:

- Added a minimal Next.js portal scaffold under `apps/portal`
- Added a minimal Python voice worker scaffold under `workers/voice`
- Added a placeholder `supabase/` project folder
- Added root environment example files
- Added baseline formatting, linting, and test configuration files
- Added simple health endpoints for the portal and voice worker
- Added minimal local setup instructions in `README.md`

Verified:


- `node --check apps/portal/app/api/health/route.js`
- `node --check apps/portal/lib/health.js`
- `node --check apps/portal/next.config.mjs`
- `node --test apps/portal/tests/health.test.mjs`
- `python3.11 -m compileall workers/voice/app`
- `python3.11 -m unittest discover -s workers/voice/tests -t workers/voice -p "test_*.py"`

Not yet verified:

- Next.js build, dev server, and ESLint execution because dependencies have not been installed yet
- Portal JSX files with a framework-aware compiler or linter
- Git-based diff hygiene checks because the workspace is not currently an initialized Git repository

## 2026-08-05

Minimal Supabase data foundation implemented.

Completed:

- Added a generated migration for the initial data foundation
- Added minimal tables for `user_profiles`, `tenants`, `tenant_memberships`, `business_configurations`, and `agents`
- Added row-level security policies for authenticated self-access, tenant-member reads, and tenant-manager writes
- Added explicit grants for `authenticated` and `service_role`
- Added demo seed data for three pilot tenants
- Added focused tenant-isolation tests that validate the migration and seed artifacts
- Updated `supabase/README.md` to reflect the new scope

Verified:

- `python3.11 -m unittest discover -s tests -p "test_*.py"`
- `python3.11 -m unittest discover -s workers/voice/tests -t workers/voice -p "test_*.py"`
- `npm test` from `apps/portal`
- `npm run lint` from `apps/portal`
- `npm run build` from `apps/portal`
- `node .\node_modules\prettier\bin\prettier.cjs --check package.json supabase\README.md`

Not yet verified:

- Applying the migration and seed files to a running local Supabase/Postgres instance
- Live RLS behavior through actual authenticated database queries, because this environment does not currently have Docker, `psql`, or a working local Supabase database runtime available
- Repo-root `npm run` wrappers remain unreliable in this environment due a Windows home-directory permission issue, so equivalent direct commands were used instead

## 2026-08-05

Supabase data foundation hardened for safe Auth linkage and non-recursive RLS.

Completed:

- Updated the existing initial migration in place instead of creating a repair migration
- Replaced recursive `tenant_memberships` RLS checks with helper functions in a private `private` schema
- Converted helper functions that need elevated access to `security definer` with `set search_path = ''`
- Restricted helper function execution to the minimum needed for authenticated policy evaluation
- Linked `public.user_profiles.id` to `auth.users(id)` with `on delete cascade`
- Added an `auth.users` trigger that creates a minimal linked profile row on user creation
- Added a reusable `updated_at` trigger function and applied it to mutable foundation tables
- Removed authenticated self-bootstrap for tenant creation by leaving tenant creation and first owner assignment to privileged provisioning
- Reworked the demo seed to create matching `auth.users` rows before tenant memberships and tenant-owned data
- Normalized `business_hours` JSON across demo tenant records
- Replaced the old RLS-claiming text tests with downgraded artifact tests and added executable pgTAP tests under `supabase/tests/database`
- Added `supabase/config.toml` so local seed paths are defined for Supabase CLI workflows

Verified:

- `python3.11 -m unittest discover -s tests -p "test_*.py"` passed
- `node .\node_modules\prettier\bin\prettier.cjs --check supabase\README.md docs\PROGRESS.md package.json` passed

Attempted but not executable in this environment:

- `npx supabase test db --local --workdir C:\sleek-relay`
  Result: failed with `LegacyDbConnectError` and `connect ECONNREFUSED 127.0.0.1:54322`
- `npx supabase db reset --local --workdir C:\sleek-relay`
  Result: failed with `LegacyDbBootstrapError` and `failed to inspect service`
- `where.exe docker`
  Result: no Docker executable found on this machine

Not yet verified:

- The new pgTAP suite has been added but could not be executed because there is no reachable local Supabase/Postgres runtime
- The migration and seed files have not been live-applied in this environment
- Live RLS behavior for owner, admin, and member roles remains unverified here until Docker or another Postgres target is available for `supabase db reset` and `supabase test db`

## 2026-08-05

Supabase verification and permission inconsistencies aligned with server-side provisioning.

Completed:

- Removed the migration `\ir` from the pgTAP database test so it now assumes migrations are already applied
- Kept the demo seed as transactional test fixture input for pgTAP
- Removed authenticated tenant update and membership mutation policies from the initial migration
- Kept tenant and membership provisioning server-side only for the MVP
- Restricted authenticated profile updates to the `full_name` column only
- Kept members able to read memberships for their own tenant but unable to mutate memberships
- Kept owner and admin verification focused on own-tenant business configuration and agents only
- Updated the Python artifact test so it no longer expects the pgTAP file to include the migration
- Kept the schema scope unchanged to profiles, tenants, memberships, business configurations, and agents

Verified:

- `python3.11 -m unittest discover -s tests -p "test_*.py"` passed
- `node .\node_modules\prettier\bin\prettier.cjs --check supabase\README.md docs\PROGRESS.md package.json` passed

Pending real database tests:

- `supabase/tests/database/foundation_rls.test.sql` has been updated for executable pgTAP coverage, but it was not runnable here
- Docker is not available on this machine
- The Supabase project is still unhealthy locally, so `supabase db reset --local` and `supabase test db --local` remain pending until a working local database runtime exists

## 2026-08-05

Supabase function execution hardening follow-up added as a repair migration.

Completed:

- Added a new migration that revokes direct execution of `public.rls_auto_enable()` from `PUBLIC`, `anon`, and `authenticated`
- Kept the existing event trigger untouched
- Added a focused Python artifact check that verifies the new migration contains the expected revoke statements

Verified:

- `python3.11 -m unittest discover -s tests -p "test_*.py"` passed
- `node .\node_modules\prettier\bin\prettier.cjs --check docs\PROGRESS.md package.json` passed

Pending real database verification:

- This new migration was not applied against a live or local database in this environment
- Direct runtime verification of `public.rls_auto_enable()` execution privileges remains pending until a healthy Supabase/Postgres runtime is available

## 2026-08-05

Portal authentication foundation implemented with Supabase SSR.

Completed:

- Added Supabase SSR browser and server client helpers under `apps/portal/lib/supabase`
- Added cookie-based session handling with `apps/portal/proxy.ts` and protected `/dashboard` routing
- Added login and logout flows without adding sign-up or any service-role usage
- Added a reusable dashboard shell inspired by the reference image with Sleek Relay navigation for Overview, Business Configuration, Agents, and Conversations
- Implemented a protected Overview page that server-loads the signed-in user session, tenant membership, tenant, business configuration, and agents with the authenticated Supabase client and RLS
- Added explicit handling for unauthenticated users, users with no tenant membership, missing business configuration, and Supabase initialization or query failures
- Added focused portal tests for auth route helpers and proxy matcher configuration
- Updated portal environment examples and local setup instructions for Supabase SSR

Verified:

- `npm run lint` from `apps/portal` passed
- `npm run typecheck` from `apps/portal` passed
- `npm test` from `apps/portal` passed
- `npm run build` from `apps/portal` passed

Not yet verified:

- End-to-end login, logout, and dashboard loading against a real Supabase project and a real tenant-bound Auth user were not exercised in this environment
- Browser rendering of the new dashboard shell was not manually reviewed in a running session here

Observed warnings:

- `next build` warns that the Next.js ESLint plugin is not explicitly configured in the current flat ESLint setup, but the lint and build checks still passed
- The installed `@supabase/supabase-js` version warns that Node.js 20 is deprecated and Node.js 22+ will be required in a future release

## 2026-08-05

Business Configuration section implemented in the portal.

Completed:

- Added a protected `/dashboard/business` page that loads the current tenant context and shared business configuration through the authenticated Supabase SSR client and RLS
- Added a shared workspace-context loader so dashboard pages resolve the signed-in user, membership, tenant, and role consistently without trusting tenant input from the browser
- Added a server action that updates the current tenant business configuration only for owners and admins, with an explicit read-only experience for members
- Added server-side validation for business name, website, contact email, timezone, and structured weekly business hours
- Added loading, success, error, missing-membership, and missing-business-configuration states
- Connected the Business Configuration sidebar item to `/dashboard/business` and added active-section navigation handling
- Kept the implementation aligned to the current database schema: `business_name`, `website`, `business_phone`, `category`, `contact_name`, `contact_email`, `timezone`, and `business_hours`
- Explicitly surfaced that address and notification settings are not yet stored in the current database schema, so they remain out of scope for this phase
- Added focused portal tests for business configuration normalization and validation

Verified:

- `npm run lint` from `apps/portal` passed
- `npm run typecheck` from `apps/portal` passed
- `npm test` from `apps/portal` passed

Build status:

- `npm run build` from `apps/portal` did not pass in this environment
- After clearing orphaned build workers and retrying, the Next.js build worker failed with `Allocation failed - JavaScript heap out of memory`
- Retrying with `NODE_OPTIONS=--max-old-space-size=4096` still failed with the same heap-memory error

Not yet verified:

- End-to-end business configuration editing against a live Supabase project and real tenant memberships was not exercised in this environment
- Browser rendering of the new Business Configuration page was not manually reviewed in a running session here

## 2026-08-06

Agents management section implemented in the portal.

Completed:

- Added a focused Supabase migration `20260806083745_add_agent_runtime_settings.sql` for upcoming voice-demo agent settings: `voice_id`, `tone`, `special_instructions`, `fallback_message`, `interruption_enabled`, `silence_timeout_seconds`, and `maximum_session_duration_seconds`
- Kept business configuration separate from agent-specific settings, with the agent pages explicitly loading the tenant's shared business configuration as context only
- Added a protected `/dashboard/agents` page with a tenant-scoped agent table showing agent name, role, language, status, and last updated
- Added protected `/dashboard/agents/new` and `/dashboard/agents/[agentId]` pages for creating, viewing, and editing tenant-owned agents
- Added server actions that create or update agents and activate or pause them using the authenticated Supabase SSR client plus RLS, without trusting tenant IDs from the browser
- Added shared agent loaders and validation for the current agent schema plus the new focused runtime fields
- Enabled read-only member access while limiting create, edit, activate, and pause controls to owners and admins
- Connected the Agents sidebar item to the new page and updated the Overview scope copy to reflect the active Agents section
- Added focused portal tests for agent validation, agent record mapping, and manager-role authorization rules
- Added a focused Python artifact check that the new migration only extends `public.agents`

Verified:

- `npm run lint` from `apps/portal` passed
- `npm run typecheck` from `apps/portal` passed
- `npm test` from `apps/portal` passed
- `npm run build` from `apps/portal` passed after clearing the previously broken local `.next` output and rerunning the build on a clean tree
- `python3.11 -m unittest discover -s tests -p "test_*.py"` passed

Not yet verified:

- The new agent runtime-fields migration has not been applied against a live or local Supabase/Postgres database in this environment
- Real database execution of the existing pgTAP RLS suite remains pending until a healthy local or remote database runtime is available
- End-to-end agent create, edit, and activate/pause flows against a real Supabase project and authenticated tenant memberships were not manually exercised in a running browser session here

Observed warnings:

- `next build` still warns that the Next.js ESLint plugin is not explicitly configured in the current flat ESLint setup
- The installed `@supabase/supabase-js` version warns that Node.js 20 is deprecated and Node.js 22+ will be required in a future release

## 2026-08-06

Portal navigation performance and dashboard skeleton loading improved.

Completed:

- Added request-scoped memoization for the authenticated Supabase SSR server client in `apps/portal/lib/supabase/server.ts`
- Added request-scoped memoization for tenant workspace resolution in `apps/portal/lib/dashboard/load-workspace-context.ts`
- Added a reusable dashboard skeleton component in `apps/portal/components/dashboard-loading.tsx`
- Reworked the existing section loading routes to use consistent skeleton screens for Agents, Business Configuration, and Business Knowledge
- Added new route-level loading screens for Overview, Agent new/detail/test pages, and Knowledge new/detail pages
- Added explicit prefetching on the dashboard sidebar links plus the main agent and knowledge detail navigation paths
- Added skeleton styling in `apps/portal/app/globals.css` to keep loading states visually aligned with the current dashboard theme

Verified:

- `npm run lint` from `apps/portal` passed
- `npm run typecheck` from `apps/portal` passed
- `npm test` from `apps/portal` passed

Build status:

- `npm run build` from `apps/portal` did not complete within the available timeout window in this environment
- The latest build attempts timed out after approximately 124 seconds and 244 seconds respectively without returning a completed success or failure result

Not yet verified:

- Browser-observed loading behavior, route prefetch responsiveness, and skeleton transitions were not manually exercised in a running local portal session here
- A completed post-change production build result remains unverified in this environment because the build command timed out before completion

## 2026-08-06

Portal Next.js local startup and build reliability improved on Windows.

Completed:

- Added `apps/portal/scripts/run-next.ps1` to start `next dev` and `next build` from a clean app-local state
- Updated `apps/portal/package.json` so `npm run dev` and `npm run build` now use the wrapper script by default
- Kept `dev:raw` and `build:raw` scripts available for direct Next.js execution when needed
- The wrapper now stops only stale `apps/portal` Next.js node processes, retries removal of a broken `.next` directory, and then launches the requested Next.js mode
- Updated `README.md` with the new portal startup behavior and the reason for it

Verified:

- `npm run lint` from `apps/portal` passed
- `npm run typecheck` from `apps/portal` passed
- `npm test` from `apps/portal` passed
- `npm run build` from `apps/portal` passed through the new wrapper script

Not yet verified:

- A full manual dev-server restart loop with repeated browser refreshes was not exercised here over a longer session, so the fix is source-verified plus build-verified rather than soak-tested

Observed warnings:

- `next build` still warns that the Next.js plugin is not explicitly configured in the current flat ESLint setup
- The installed `@supabase/supabase-js` version warns that Node.js 20 is deprecated and Node.js 22+ will be required in a future release

## 2026-08-06

Voice worker development environment made reproducible with `uv` and Python 3.12.

Completed:

- Updated `workers/voice/pyproject.toml` to require `>=3.12,<3.14` and aligned Ruff targeting to Python 3.12
- Added `workers/voice/.python-version` with `3.12`
- Kept the Pipecat dependency scope limited to the extras needed for the local worker proof of concept: `runner`, `webrtc`, `deepgram`, `google`, and `cartesia`
- Generated `workers/voice/uv.lock`
- Recreated the worker virtual environment with `uv sync --python 3.12`
- Updated `workers/voice/README.md` with exact Windows PowerShell commands for `uv` install, sync, and run flows

Verified with the `uv`-managed Python 3.12 environment:

- `uv run --python 3.12 python -c "import app.bot; import app.config; import app.server; import app.prompt; print('app-module-imports-ok')"` passed
- `uv run --python 3.12 -m unittest discover -s tests -t . -p "test_*.py"` passed
- `uv run --python 3.12 -m compileall app` passed

Attempted but still blocked in this environment:

- `uv run --python 3.12 python -c "import app.bot; app.bot._import_pipecat_dependencies(); ..."` did not pass
  Result: a Windows Application Control policy blocked a SciPy DLL import inside the synced Pipecat dependency set

Not yet verified:

- End-to-end execution of `uv run --python 3.12 -m app.bot` through the browser at `http://127.0.0.1:7860/client`
- Live microphone capture, transcripts, streamed audio playback, and interruption behavior under the new `uv` environment

## 2026-08-06

Local Pipecat voice-worker proof of concept implemented for worker-only development.

Completed:

- Added a focused worker configuration module under `workers/voice/app/config.py` for local host, runner host, and provider environment validation
- Added a fixed English system prompt under `workers/voice/app/prompt.py`
- Added a Pipecat worker entrypoint under `workers/voice/app/bot.py` using SmallWebRTC, Deepgram Flux STT, Google Gemini LLM, and Cartesia streaming TTS
- Configured the worker to use `Settings`-based provider configuration instead of deprecated constructor parameters
- Configured the user aggregator to use `ExternalUserTurnStrategies` so Deepgram Flux drives turn management without duplicating turn detection
- Kept the implementation intentionally local-only with no Supabase, runtime package, portal, conversation, recording, or tool integration
- Extended the helper HTTP server so `/config` reports missing environment variables without exposing secrets
- Expanded `.env.voice.example`, `workers/voice/README.md`, and the root `README.md` with exact local run steps for the worker helper and Pipecat runner
- Added focused worker configuration tests under `workers/voice/tests/test_config.py`
- Declared the worker runtime dependencies in `workers/voice/pyproject.toml`

Verified:

- `C:\Users\habib\AppData\Local\Programs\Python\Python314\python.exe -m compileall workers/voice/app` passed
- `C:\Users\habib\AppData\Local\Programs\Python\Python314\python.exe -m unittest discover -s workers/voice/tests -t workers/voice -p "test_*.py"` passed
- `C:\Users\habib\AppData\Local\Programs\Python\Python314\python.exe -c "from app.config import get_public_config_status; print(get_public_config_status())"` from `workers/voice` returned the expected missing-variable status payload

Not yet verified:

- `python3.11 -m pip install -e .` for `workers/voice` did not complete successfully on this machine
- The local Pipecat browser demo at `http://127.0.0.1:7860/client` was not executed end-to-end in this environment
- Live microphone capture, live transcripts, speaking-state updates, interruption behavior, and streamed audio playback remain unverified here until the runtime dependencies can be installed successfully
- The exact runtime import paths for Pipecat 1.7.0 against this machine's installed packages remain unverified because the installation was blocked before a full live run

Observed blockers:

- A Windows Application Control policy blocked `python3.11.exe` commands later in the session, so worker verification had to fall back to `C:\Users\habib\AppData\Local\Programs\Python\Python314\python.exe`
- The dependency install attempt for `pipecat-ai[runner,webrtc,deepgram,google,cartesia]==1.7.0` failed while building `docopt`, which is pulled in via `num2words`

## 2026-08-06

Tenant-approved business knowledge and runtime agent configuration implemented.

Completed:

- Added a focused Supabase migration `20260806090200_add_business_knowledge_and_runtime_support.sql` that creates a tenant-scoped `business_knowledge` table with supported kinds `faq`, `policy`, `business_fact`, and `service_information`
- Added business knowledge approval states `draft`, `approved`, and `disabled`, with row-level security that allows tenant-member reads and manager-only create, update, and delete operations
- Extended demo seed data with tenant-owned knowledge records, including both approved and non-approved examples
- Added a protected `/dashboard/knowledge` page plus `/dashboard/knowledge/new` and `/dashboard/knowledge/[itemId]` detail pages for tenant-scoped knowledge management
- Added server actions for creating, editing, approving, disabling, and deleting knowledge records through the authenticated Supabase SSR client and RLS without trusting tenant IDs from the browser
- Added shared knowledge loaders and validation under `apps/portal/lib/knowledge`
- Added a typed server-side runtime package builder under `apps/portal/lib/runtime` that combines the authenticated tenant's shared business configuration, approved knowledge only, selected agent settings, and fixed grounding or safety rules
- Kept the runtime builder limited to a typed package and deterministic prompt text suitable for a future Pipecat worker, without adding voice sessions, providers, embeddings, or website scraping
- Added focused portal tests for knowledge validation and runtime package composition
- Expanded artifact and pgTAP coverage so the new knowledge table and tenant-isolation rules are represented in repository-level verification

Verified:

- `npm run lint` from `apps/portal` passed
- `npm run typecheck` from `apps/portal` passed
- `npm test` from `apps/portal` passed
- `npm run build` from `apps/portal` passed
- `python3.11 -m unittest discover -s tests -p "test_*.py"` passed

Not yet verified:

- The new business knowledge migration has not been applied against a live or local Supabase/Postgres database in this environment
- Real execution of the updated pgTAP RLS suite remains pending until a healthy Supabase/Postgres runtime is available
- End-to-end browser interaction against a real Supabase project for knowledge create, edit, approve, disable, delete, and runtime package retrieval was not manually exercised here

Observed warnings:

- `next build` still warns that the Next.js ESLint plugin is not explicitly configured in the current flat ESLint setup
- The installed `@supabase/supabase-js` version warns that Node.js 20 is deprecated and Node.js 22+ will be required in a future release

## 2026-08-07 (transcript persistence)

Voice worker transcript persistence implemented.

Completed:

- Added optional SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY fields to VoiceWorkerConfig in workers/voice/app/config.py; both are optional so local dev without Supabase continues to work
- Documented the new optional env vars in .env.voice.example
- Added a conversation_id: str | None field to VoiceSessionRuntimeConfig in workers/voice/app/runtime_config.py
- Added _decode_jwt_conversation_id which base64-decodes the JWT payload without signature verification to extract the sub / conversationId claim (safe because the claim is used only as a DB write key, not for access decisions)
- Wired conversation_id population into load_session_runtime_config; env-fallback sessions carry None and skip persistence silently
- Created workers/voice/app/transcript.py with uild_message_rows, persist_transcript, and 	ry_persist_transcript; uses stdlib urllib.request (PostgREST REST API) with no new dependency
- Updated uild_pipeline_task in ot.py to store the LLMContext object on the task as _sleek_relay_llm_context
- Updated 
un_bot to return the LLMContext object after the pipeline finishes
- Updated the ot() entry point to call 	ry_persist_transcript (in a thread via syncio.to_thread) with the completed context messages after each session; all errors are logged and swallowed
- Added workers/voice/tests/test_transcript.py with 30 focused unit tests covering row building, HTTP persistence success/error paths, and guard conditions

Verified:

- python -m compileall app tests passed (all files compiled cleanly)
- python -m pytest tests/test_transcript.py tests/test_config.py tests/test_runtime_config.py -v  57 passed, 1 pre-existing failure in 	est_load_worker_env_keeps_process_env_higher_priority_than_repo_root_file that is a Windows environment isolation issue unrelated to these changes

Not yet verified:

- End-to-end session with a live Supabase project (requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.voice pointing to a real project)
- Actual transcript rows appearing in the conversation detail drawer after a browser test session

- Added per-turn latency metrics aggregation in 	ranscript.py via uild_latency_metrics(), mapping worker turn metrics to the portal's expected keys (speech_stop_to_stt_final_ms, stt_final_to_llm_first_token_ms, llm_first_token_to_tts_first_audio_ms, speech_stop_to_bot_speaking_ms, ot_speaking_duration_ms, 	otal_turn_duration_ms)
- Added persist_conversation_metadata() in 	ranscript.py which sends a PATCH request to Supabase PostgREST updating latency_metrics and 
untime_snapshot on the conversations table
- Updated 
un_bot() and ot() in ot.py to return the VoiceTurnLatencyTracker and pass it to 	ry_persist_session_results() at session completion
- Updated unit test suite in 	ests/test_transcript.py (33/33 tests passing)

## 2026-08-07 (agent test drawer)

Agent Voice Test UI integrated as a side-drawer overlay on the agent configuration page.

Completed:

- Created AgentTestDrawer (pps/portal/app/dashboard/agents/agent-test-drawer.tsx) which renders the browser voice test panel inside a sliding right panel overlay matching ConversationDetailDrawer design
- Added outside-click backdrop detection and Escape key handling to close the drawer smoothly
- Updated AgentDetailPage (/dashboard/agents/[agentId]/page.tsx) to handle ?test=true URL search parameter, displaying AgentTestDrawer directly on the configuration page without navigating to a separate route
- Updated /dashboard/agents/[agentId]/test route to redirect to /dashboard/agents/[agentId]?test=true
- Updated the "Test agent" header button to trigger ?test=true

Verified:

- 
pm run lint from pps/portal passed
- 
pm run typecheck from pps/portal passed
- 
pm test from pps/portal passed (111/111 tests passed)
