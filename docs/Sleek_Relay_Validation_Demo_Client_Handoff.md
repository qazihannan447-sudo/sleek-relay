# Sleek Relay — Validation Demo Client Handoff

**Document type:** Architecture mapping, setup guide, API/configuration notes, deployment & rollback, test evidence, and operator runbook  
**Audience:** Sleek Relay stakeholders and pilot operators  
**Stage:** Non-production market-validation demo (browser-based voice agents)  
**Date:** August 2026  
**Status:** Delivered against the Validation Release intent of the NPE RFQ, with documented scope substitutions below  

---

## 1. Executive summary

This handoff describes the working **browser-based voice-agent validation demo** built for Sleek Relay pilot use.

Pilot businesses can:

- Sign in to a multi-tenant customer portal  
- Configure shared business information and approved knowledge  
- Create and manage multiple agents  
- Test an agent live in the browser (mic + real-time voice)  
- Capture leads, messages, appointment requests, and soft handoff requests  
- Review transcripts, summaries, outcomes, captures, latency, and usage  

**What this release is**

A complete **browser WebRTC** voice journey for market validation: configure → test → review.

**What this release is not**

It is **not** a PSTN / telephony release. There is **no Telnyx carrier adapter**, **no inbound phone number**, **no SIP**, and **no live human call transfer**. Soft handoff records a callback request only.

---

## 2. RFQ alignment and deliberate substitutions

The NPE Validation Release RFQ describes a long-term Canada-first production direction (Telnyx, Azure Speech, Microsoft Foundry, Azure PostgreSQL, Azure-owned containers).  

This validation demo implements the **application and voice-orchestration intent** of that RFQ while using a leaner stack suitable for rapid pilot demos. Substitutions are intentional and documented here for equivalency review.

| RFQ component | Binding RFQ direction | Validation demo implementation | Notes |
|---|---|---|---|
| Carrier / call ingress | Telnyx Canadian DID + CallRouter | **Not implemented** | Telephony deferred; browser WebRTC replaces PSTN for this stage |
| Voice orchestration | Pipecat in Docker | **Pipecat** voice worker | Same orchestration boundary; hosted on **Render** |
| Speech (STT/TTS) | Azure AI Speech (Canada) | **Deepgram Flux** (STT) + **Cartesia Sonic** (TTS) | Vendor-owned provider keys; portable behind Pipecat adapters |
| LLM | Microsoft Foundry (Canada East) | **Google Gemini** (`gemini-2.5-flash`) | Used for live agent turns and post-call summaries |
| Application | Next.js portal/API | **Next.js 15 portal** | Deployed on **Vercel** |
| Database / auth / storage | Azure PostgreSQL + related Azure services | **Supabase** (Postgres, Auth, RLS, private storage path) | Demo-stage data plane; migration path to Sleek Relay–owned Azure remains open |
| Transport (browser test) | Browser-compatible real-time audio | **Daily** WebRTC (hosted) / SmallWebRTC (local) | Required for remote browser tests |
| Human transfer | Live transfer / fallback route | **Soft handoff request** only | Never claims a live transfer succeeded |
| SMS / email close-off | Transactional SMS or email | **Notifications inbox** + WhatsApp via Green API (demo) / email logged only | Destinations on Business Configuration; see Notifications tab |
| Monitoring | OpenTelemetry + Azure Monitor | Structured logs + conversation diagnostics in portal | Full Azure Monitor package deferred with Azure foundation |

### Architecture boundaries preserved for later scale

Despite provider and hosting substitutions, the following RFQ-aligned boundaries are in place:

- Portal (control plane) separate from voice worker (real-time media plane)  
- Tenant isolation enforced server-side and via database RLS  
- Allowlisted, schema-validated agent tools (no unrestricted LLM DB/shell/network access)  
- Business knowledge separated from agent behaviour settings  
- Runtime agent packages assembled from tenant business data + approved knowledge + agent config  
- Appointment and handoff outcomes remain **requests** until a real system of record confirms them  
- Telephony can be added later behind a carrier adapter without rewriting portal domain logic  

---

## 3. Architecture mapping

### 3.1 Logical architecture

```text
┌─────────────────────────────────────────────────────────────┐
│  Browser (pilot operator)                                   │
│  Dashboard UI · mic · live transcript · Daily WebRTC        │
└───────────────────────────┬─────────────────────────────────┘
                            │ HTTPS + WebRTC
          ┌─────────────────┴─────────────────┐
          ▼                                   ▼
┌──────────────────────────┐     ┌────────────────────────────┐
│  Portal (Vercel)         │     │  Voice worker (Render)     │
│  Next.js app + APIs      │◄───►│  Pipecat orchestration     │
│  Auth · CRUD · session   │     │  STT · LLM · TTS · tools   │
│  runtime package builder │     │  Daily room / RTVI         │
└────────────┬─────────────┘     └─────────────┬──────────────┘
             │                                 │
             └──────────────┬──────────────────┘
                            ▼
                 ┌────────────────────┐
                 │  Supabase          │
                 │  Auth · Postgres   │
                 │  RLS · Storage     │
                 └────────────────────┘
```

### 3.2 Repository layout

| Path | Responsibility |
|---|---|
| `apps/portal` | Customer portal, dashboard, application APIs, session bootstrap, summaries |
| `workers/voice` | Real-time Pipecat voice worker (STT/LLM/TTS, tools, transcript write-back) |
| `supabase/` | Schema migrations, seed data, RLS / pgTAP tests |
| `scraper/` | Optional website extraction for assisted business onboarding drafts |
| `docs/` | Requirements, progress, and this handoff |

### 3.3 Runtime voice path (browser test)

1. Operator opens an agent and starts **Test agent**.  
2. Portal creates (or reuses) a conversation row and issues a short-lived **voice session JWT**.  
3. Browser connects to the voice runner (`NEXT_PUBLIC_VOICE_RUNNER_URL`) over Daily WebRTC.  
4. Worker authenticates with the session token and fetches a **runtime configuration package** from the portal (`POST /api/voice/runtime-config`).  
5. Pipeline runs: Deepgram STT → Gemini LLM (with allowlisted tools) → Cartesia TTS.  
6. Tools call portal capture endpoints for leads / messages / appointment requests / soft handoff.  
7. On completion, conversation status, transcript, outcome, summary, latency, and usage fields are persisted for dashboard review.

### 3.4 Tenancy model

- One **tenant** = one pilot business  
- One shared **business configuration** per tenant  
- Many **agents** per tenant  
- All agents use that tenant’s approved business information and knowledge only  
- Users belong to tenants via **memberships** (`owner` / `admin` / `member`)  
- Cross-tenant access is blocked by Supabase RLS and server-side ownership checks  

---

## 4. Hosted deployment topology (current)

| Service | Platform | Role |
|---|---|---|
| Customer portal | **Vercel** (production) | UI + control-plane APIs |
| Voice worker | **Render** | Pipecat runner + health/helper endpoints |
| Data / auth | **Supabase** | Postgres, Auth, RLS |
| Browser media | **Daily** | WebRTC rooms for remote tests |
| STT | **Deepgram** | Flux speech recognition |
| LLM | **Google Gemini** | Agent turns + summaries |
| TTS | **Cartesia** | Streaming speech synthesis |

CI for the portal: GitHub Actions workflow **Deploy Portal to Vercel** (`.github/workflows/vercel-frontend-deploy.yml`) runs on pushes to `main` and on manual dispatch. It installs dependencies, lints, type-checks, tests, builds, and deploys prebuilt artifacts to Vercel production.

The Render worker is configured in the Render dashboard (environment variables, start command, health check). Keep-alive against `GET /health` is used to reduce free-tier cold starts during active dashboard use.

---

## 5. Setup guide

### 5.1 Prerequisites

- Node.js 22+ (portal)  
- Python 3.12 + `uv` (voice worker; WSL Ubuntu recommended on Windows)  
- Supabase project with migrations applied  
- Provider API keys: Deepgram, Google Gemini, Cartesia, Daily (for hosted/remote tests)  
- Access to Vercel / Render / Supabase projects under Sleek Relay control  

### 5.2 Supabase

1. Link or create the Supabase project.  
2. Apply versioned migrations from `supabase/migrations/` (in order).  
3. Optionally load demo seed data (three pilot-style tenants for validation).  
4. Create operator Auth users and ensure tenant memberships (or use workspace onboarding).  

### 5.3 Portal (local)

1. Copy `.env.portal.example` → `apps/portal/.env.local`.  
2. Set at minimum:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (server-only)
   - `VOICE_SESSION_SIGNING_SECRET` (≥ 32 random bytes)
   - `NEXT_PUBLIC_VOICE_RUNNER_URL` (local runner or Render URL)
   - `GOOGLE_API_KEY` / `GOOGLE_MODEL` (summaries)
3. From `apps/portal`: `npm install` then `npm run dev`.  
4. Verify `http://localhost:3000/api/health`.  
5. Sign in at `/login`.

### 5.4 Voice worker (local)

1. Copy `.env.voice.example` → repo-root `.env.voice`.  
2. Set required keys:
   - `DEEPGRAM_API_KEY`, `DEEPGRAM_MODEL`
   - `GOOGLE_API_KEY`, `GOOGLE_MODEL`
   - `CARTESIA_API_KEY`, `CARTESIA_MODEL`, `CARTESIA_VOICE_ID`
   - `PORTAL_BASE_URL`
   - `DAILY_API_KEY` (required for remote/Daily demos)
   - Optional: `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` for transcript persistence  
3. Preferred on Windows: `.\run-voice-worker.ps1`  
4. Or from `workers/voice`: `uv sync --python 3.12` then `uv run --python 3.12 -m app.bot`  
5. Health: runner `GET /health` (port 7860); helper `GET /health` / `GET /config` (port 8000 when enabled).

### 5.5 Hosted environment checklist

**Vercel (portal)**

- Production env vars matching `.env.portal.example` (no secrets in `NEXT_PUBLIC_*` except intentionally public values)  
- `NEXT_PUBLIC_VOICE_RUNNER_URL` pointing at the Render runner public URL  
- GitHub Actions secrets: `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, `VERCEL_TOKEN`  

**Render (worker)**

- Start command for the Pipecat bot/runner module  
- Env vars matching `.env.voice.example`  
- `PORTAL_BASE_URL` = production Vercel URL  
- Health check path: `/health`  
- Note: free-tier instances may spin down when idle; cold start adds connect latency  

**Daily / providers**

- Valid `DAILY_API_KEY` on the worker  
- Active Deepgram, Gemini, and Cartesia credentials with sufficient quota  

---

## 6. API and configuration notes

### 6.1 Primary portal voice APIs

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/health` | Portal health |
| `POST` | `/api/voice/conversations` | Create browser-test conversation |
| `POST` | `/api/voice/browser-test/bootstrap` | Conversation + session token in one call |
| `POST` | `/api/voice/conversations/[id]/session-token` | Issue short-lived voice JWT |
| `POST` | `/api/voice/runtime-config` | Worker fetches grounded runtime package (Bearer token) |
| `PATCH` | `/api/voice/conversations/[id]/lifecycle` | starting → active / completed / failed |
| `DELETE` | `/api/voice/conversations/[id]` | Discard unused warmup reservation |
| `POST` | `/api/voice/conversations/[id]/captures` | Lead / message / appointment / handoff capture |
| `GET` | `/api/voice/conversations/[id]/summary` | Post-call summary status / generation |

Most dashboard CRUD (business, knowledge, agents) uses authenticated **server actions**, not public REST.

### 6.2 Worker endpoints

| Endpoint | Purpose |
|---|---|
| Runner `GET /health` | Liveness / keep-alive |
| Runner `/start` | Start / adopt Daily session for browser connect |
| Helper `GET /health`, `GET /config` | Local diagnostics (when helper server is running) |

### 6.3 Allowlisted agent tools

| Tool | Behaviour |
|---|---|
| `capture_lead` | Persists lead capture when agent capability enabled |
| `capture_message` | Persists caller message |
| `create_appointment_request` | Stores **request only** — never spoken as a confirmed booking |
| `offer_human_handoff` | Soft handoff / callback request — never claimed as a live transfer |
| `end_session` | Safe conversation completion |

Tool inputs are schema-validated. Success speech is only allowed after the portal confirms persistence.

### 6.4 Critical configuration variables

**Portal**

| Variable | Sensitivity | Use |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Public | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Public | Browser Auth |
| `SUPABASE_SERVICE_ROLE_KEY` | **Secret** | Server-only privileged DB access |
| `VOICE_SESSION_SIGNING_SECRET` | **Secret** | Signs voice session JWTs |
| `NEXT_PUBLIC_VOICE_RUNNER_URL` | Public | Browser → voice runner |
| `GOOGLE_API_KEY` / `GOOGLE_MODEL` | **Secret** | Conversation summaries |

**Voice worker**

| Variable | Sensitivity | Use |
|---|---|---|
| `DEEPGRAM_*` | **Secret** | STT |
| `GOOGLE_*` | **Secret** | Live LLM |
| `CARTESIA_*` | **Secret** | TTS |
| `DAILY_API_KEY` | **Secret** | Hosted WebRTC rooms |
| `PORTAL_BASE_URL` | Internal | Runtime config + captures |
| `SUPABASE_*` | **Secret** | Optional transcript persistence |

Secrets must remain server-side. Never commit `.env.local`, `.env.voice`, or service-role keys.

### 6.5 Runtime package contents (high level)

The portal builds a per-session package including:

- Tenant + agent identity  
- Greeting, tone, language, voice ID  
- Grounded business facts and approved knowledge only  
- Enabled capabilities / tools  
- Safety and fallback instructions  
- Capture / appointment / handoff rules  

Operators do **not** write full technical system prompts; the portal compiles them.

---

## 7. Deployment and rollback

### 7.1 Portal (Vercel)

**Deploy**

1. Merge or push to `main`, **or** run workflow dispatch for **Deploy Portal to Vercel**.  
2. Pipeline runs: `npm ci` → lint → typecheck → test → `vercel pull` → `vercel build --prod` → `vercel deploy --prebuilt --prod`.  
3. Confirm production URL and `/api/health`.  
4. Spot-check login and an agent test against the Render runner URL.

**Rollback**

1. In Vercel → Project → Deployments, promote the last known-good production deployment.  
2. Or redeploy a previous git commit (revert / workflow on stable SHA).  
3. Confirm env vars were not accidentally changed with the bad deploy.  
4. Re-check `/api/health` and one browser voice connect.

### 7.2 Voice worker (Render)

**Deploy**

1. Deploy the `workers/voice` revision via Render (auto-deploy from the connected branch, or manual deploy).  
2. Confirm env vars (especially `PORTAL_BASE_URL`, provider keys, `DAILY_API_KEY`).  
3. Hit `GET /health` until healthy (allow for cold start).  
4. Run one portal Connect test end-to-end.

**Rollback**

1. In Render → service → deploy history, redeploy the previous successful release.  
2. If a bad env change caused the incident, restore prior env values first, then redeploy.  
3. Verify `/health` and a short voice session.

### 7.3 Database migrations

- Migrations are versioned under `supabase/migrations/`.  
- Apply only forward migrations in order.  
- Treat destructive schema changes as a separate change-control item; keep a backup / point-in-time restore plan for the Supabase project before risky applies.  
- Application deploys that depend on a new migration must wait until the migration is applied.

### 7.4 Coordinated change order (recommended)

1. Apply DB migration (if any).  
2. Deploy portal (compatible with new schema).  
3. Deploy worker (compatible with new runtime/API contracts).  
4. Smoke: health → login → Connect → conversation appears with transcript/summary.  
5. If smoke fails: roll back worker, then portal, then investigate DB (restore only if migration is confirmed harmful).

---

## 8. Test evidence

### 8.1 Automated suites (repository)

| Layer | Command / location | Coverage focus |
|---|---|---|
| Portal unit/integration | `npm test` in `apps/portal` | Auth paths, agents, business/knowledge validation, voice session, warm-connect, captures, usage, summaries, onboarding |
| Voice worker | `python -m unittest discover -s workers/voice/tests ...` | Bot/config, runtime config, transcripts, captures, Daily/Deepgram pools, health, no-show timeout |
| Supabase foundation | `tests/test_supabase_foundation.py` | Migration/seed artifacts |
| RLS (pgTAP) | `supabase/tests/database/foundation_rls.test.sql` | Tenant isolation at DB level (requires local Supabase) |
| Scraper | Vitest under `scraper/test/` | Website extraction helpers |
| CI gate | GitHub Actions before Vercel deploy | Lint, typecheck, portal tests |

Representative portal test files include: `voice-session.test.ts`, `warm-connect.test.ts`, `voice-captures.test.ts`, `runtime.builder.test.ts`, `usage.analytics.test.ts`, `conversation-summary.test.ts`, auth and onboarding suites.

Representative worker tests include: `test_bot.py`, `test_runtime_config.py`, `test_captures.py`, `test_transcript.py`, `test_daily_room_pool.py`, `test_deepgram_pool.py`.

### 8.2 Manual acceptance scenarios (validation demo)

| Scenario | Expected result | Telephony required? |
|---|---|---|
| Tenant isolation | User A cannot see tenant B business, agents, conversations, or captures | No |
| FAQ / grounded answer | Agent answers only from approved business knowledge; does not invent hours/prices/policies | No |
| Lead capture | Lead stored; agent confirms only after tool success | No |
| Message capture | Message stored and visible in Captures / conversation detail | No |
| Appointment request | Stored as **request**; agent does not claim a confirmed booking | No |
| Soft handoff | Callback/handoff request stored; agent does not claim live transfer | No |
| Interruption / turn-taking | Barge-in and endpointing behave acceptably in browser | No |
| Safe close-off | Session ends cleanly; conversation marked completed/failed appropriately | No |
| Post-session review | Transcript, summary, outcome, latency/usage visible in dashboard | No |
| Pause agent | Paused agent cannot be used for new tests until resumed | No |

### 8.3 Explicitly out of scope for this evidence package

- Inbound PSTN call to a Telnyx DID  
- Carrier webhook verification / CallRouter  
- Live warm transfer to a human phone leg  
- Canadian-region Azure Speech / Foundry processing attestation  
- Azure Monitor full call-trace package  
- Outbound transactional SMS / Resend email delivery (WhatsApp Green API demo path + notification inbox are wired)  
- Cap enforcement that blocks sessions at a hard minute limit (usage is visible; enforcement is future work)  

---

## 9. Operator runbook

### 9.1 First-time workspace setup

1. Open the portal production URL.  
2. Sign in at **Login** (invited Auth user).  
3. If prompted, complete **workspace onboarding** (creates initial tenant membership).  
4. Confirm the dashboard loads for the correct business.

### 9.2 Configure the business

1. Go to **Business**.  
2. Enter name, category, contact, website, address, hours, services, policies, appointment rules, notification destinations, and soft-handoff callback settings.  
3. Save. This configuration is shared by all agents in the tenant.

### 9.3 Approve knowledge

1. Go to **Knowledge**.  
2. Add FAQs, facts, and policies.  
3. **Approve** items before expecting the live agent to use them.  
4. Unapproved or draft knowledge must not be treated as live facts.

Optional: use website extraction to draft facts, then review and approve before activation.

### 9.4 Create and tune agents

1. Go to **Agents** → create agent.  
2. Set name, role, voice ID, language, greeting, tone, special instructions, information to collect, and capability toggles (lead / message / appointment / handoff).  
3. Activate the agent when ready for testing.  
4. Use **Pause** to stop further tests without deleting configuration.

### 9.5 Run a browser voice test

1. Open the agent and choose **Test agent**.  
2. Allow microphone access when prompted.  
3. Wait for the session to warm (hosted Render may cold-start; keep the Agents page open to help keep-alive).  
4. Click **Connect**.  
5. Speak naturally; interrupt if needed; complete a capture flow if testing tools.  
6. End the session (or let the agent close safely).  
7. Review the result under **Conversations**.

**Connect checklist if audio fails**

- Mic permission granted in the browser  
- `NEXT_PUBLIC_VOICE_RUNNER_URL` points at the live Render runner  
- Render `/health` returns OK (wake the service if spun down)  
- Daily and provider keys valid on the worker  
- Agent is Active, not paused  
- Browser tab is not fully muted; Connect unlocks remote bot audio after muted pre-join  

### 9.6 Review conversations and captures

- **Conversations:** completed and failed sessions only; open a row for transcript, summary, outcome, captures, latency, and estimated usage/cost.  
- **Captures:** leads, messages, appointment requests, soft handoffs across conversations.  
- **Usage:** connected minutes, estimated LLM tokens, outcomes, and latency snapshots aggregated from conversation data.  

Notes for operators:

- Estimated cost uses connected minutes plus recorded TTS characters and LLM tokens when the worker stores `usage_metrics`. STT seconds are not metered yet.  
- Appointment rows are **requests**, not confirmed bookings.  
- Soft handoffs are **callback requests**, not live transfers.  
- Unused warmup sessions are discarded and do not appear as Failed conversations.

### 9.7 Incident triage (quick)

| Symptom | Likely cause | First action |
|---|---|---|
| Portal login fails | Auth/config | Check Supabase Auth and public URL/key |
| Dashboard empty / wrong tenant | Membership | Confirm `tenant_memberships` for the user |
| Connect hangs / worker unreachable | Render cold start or bad runner URL | Hit runner `/health`; verify `NEXT_PUBLIC_VOICE_RUNNER_URL` |
| No bot audio | Autoplay / Daily | Re-click Connect; check browser audio; verify Daily key |
| Hallucinated business facts | Unapproved/empty knowledge | Approve knowledge; retest |
| Tool said success incorrectly | Should not happen | File defect; inspect capture API logs and conversation captures |
| Summary missing | Gemini/portal summary path | Retry summary endpoint; check portal `GOOGLE_API_KEY` |
| Cross-tenant data visible | Critical security incident | Take portal offline if needed; rotate keys; investigate RLS and API auth |

### 9.8 Security operating rules

- Never paste service-role keys, provider keys, or session signing secrets into tickets or chat.  
- Do not disable RLS.  
- Do not grant the LLM direct SQL, shell, or arbitrary network tools.  
- Treat recordings and transcripts as private tenant data.  
- Rotate compromised secrets immediately (Supabase service role, voice signing secret, provider keys, Vercel/Render tokens).  

---

## 10. Known limitations and next-phase options

| Area | Current state | Typical next phase |
|---|---|---|
| Telephony | Not implemented | Telnyx adapter + CallRouter + PSTN ingress |
| Live transfer | Soft handoff request only | Real warm transfer / fallback routing |
| Speech / LLM regions | Deepgram + Gemini + Cartesia | Equivalency-reviewed move to Azure Speech + Foundry if required |
| Data plane | Supabase | Migration to Sleek Relay–owned Azure PostgreSQL / storage / Key Vault |
| Notifications | Inbox + WhatsApp (Green API) / email logged | Resend email + SMS |
| Usage enforcement | Visible analytics; minutes + LLM/TTS metering | Hard caps, STT metering, blocking at limit |
| Observability | Portal diagnostics + logs | OpenTelemetry + Azure Monitor per-call traces |
| Hosting | Vercel + Render | Sleek Relay NPE containers / approved pipeline if required by foundation team |

---

## 11. Ownership and handoff assets

Under Sleek Relay control (or to be transferred as part of acceptance):

- Application source repository  
- Portal deployment (Vercel project + GitHub Actions workflow)  
- Voice worker deployment (Render service)  
- Supabase project (schema, Auth, data)  
- Provider accounts/keys used for the demo (Deepgram, Gemini, Cartesia, Daily)  
- This documentation set under `docs/`  

Knowledge transfer should include a live walkthrough of: workspace setup → business/knowledge/agent config → Connect test → conversation/capture review → deploy/rollback of portal and worker.

---

## 12. Document control

| Field | Value |
|---|---|
| Related RFQ | *Sleek Relay NPE Validation Release – Offshore Engineering RFQ* |
| Related internal docs | `docs/REQUIREMENTS.md`, `docs/SCOPE.md`, `docs/PROGRESS.md` |
| Primary apps | `apps/portal`, `workers/voice`, `supabase/` |
| Demo transport | Browser WebRTC (Daily hosted / SmallWebRTC local) |
| Telephony | **Out of scope for this release** |

For questions during warranty or pilot operations, use the agreed Sleek Relay technical contact channel and include: tenant name, agent name, conversation ID, approximate timestamp, and whether the failure occurred at Connect, mid-call, tool capture, or post-call review.
