# Implementation Plan: Capture, Appointment Request, and Handoff

## Context

The browser agent already runs a natural appointment-style conversation from business config + agent prompt (collect name → contact → preferred time → confirm → “team will confirm”).

What is missing: **nothing is persisted**, there is **no tool confirmation gate**, and the agent can sound like it booked something when it only talked through the steps.

This plan turns that conversational behavior into three allowlisted, schema-validated workflows:

1. Lead / message capture (+ configuration)
2. Appointment request (not live calendar booking)
3. Human handoff / fallback route (browser-safe; no PSTN transfer)

Telephony, real warm transfer, and Google/Outlook calendar sync are out of scope.

---

## Design principles

1. **Business config = shared facts and destinations**  
   Transfer/callback destination, appointment policy text, notification contact.

2. **Agent config = which workflows this agent may run**  
   Capability toggles + fields to collect.

3. **Tools = only path to side effects**  
   Agent may speak success only after a tool returns `ok: true`.

4. **Appointment status is always `requested`**  
   Never `confirmed` / `booked` in MVP.

5. **Reuse one capture model**  
   Leads, messages, appointment requests, and handoff requests share one persistence pattern.

6. **Match the transcript you already like**  
   Keep the collect → confirm → act flow; replace “I’ve noted down your request” with a real tool write, then the same spoken confirmation.

---

## Target conversation behavior (from your sample)

| Step | Today | After this work |
|---|---|---|
| Wrong-business correction | Prompt / knowledge | Unchanged |
| Collect name, phone, time | Prompt only | Prompt + required fields from agent config |
| “Just to confirm…” | Prompt only | Unchanged (required before tool call) |
| “I've noted down your request…” | Spoken with no DB write | `create_appointment_request` succeeds → then speak |
| Portal review | Transcript only | Capture card on conversation detail + outcome label |

---

## Data model

### Migration: extend business configuration

Add to `business_configurations`:

| Column | Type | Purpose |
|---|---|---|
| `appointment_policy` | `text` nullable | e.g. “Requests only; staff confirms later” |
| `handoff_destination_type` | `text` check | `callback` \| `phone_info` \| `email_info` \| `none` |
| `handoff_destination_value` | `text` nullable | Phone or email to use in script |
| `handoff_script` | `text` nullable | What the agent should say after a successful handoff tool |
| `notification_email` | `text` nullable | Stored for later SMS/email; not required to send in MVP |

### Migration: extend agents

Add capability JSON (prefer one jsonb column over many booleans if easier to evolve):

```json
{
  "capture_leads": true,
  "capture_messages": true,
  "capture_appointments": true,
  "offer_handoff": true,
  "lead_fields": ["name", "phone", "email", "notes"],
  "message_fields": ["name", "phone", "email", "message"],
  "appointment_fields": ["name", "phone", "email", "preferred_time", "party", "notes"]
}
```

Defaults: all capture/handoff flags `false` for existing agents until an owner enables them (safe). Seed at least one demo agent with appointments + leads enabled.

### Migration: `conversation_captures`

Single tenant-scoped table:

| Column | Notes |
|---|---|
| `id` | uuid pk |
| `tenant_id` | fk tenants |
| `conversation_id` | fk conversations (composite tenant ownership) |
| `agent_id` | fk agents |
| `capture_type` | `lead` \| `message` \| `appointment_request` \| `handoff_request` |
| `status` | `captured` for lead/message; `requested` for appointment/handoff (never `confirmed`) |
| `payload` | jsonb validated server-side |
| `idempotency_key` | text unique per conversation (optional but recommended) |
| `created_at` | timestamptz |

RLS: members can read own-tenant captures; inserts via service role / portal internal API only (worker must not trust browser-supplied tenant ids).

Composite FK pattern should match existing `conversations` / `agents` tenant ownership style.

### Conversation outcome

On successful capture, portal/worker updates `conversations.outcome` to one of:

- `lead_captured`
- `message_captured`
- `appointment_requested`
- `handoff_requested`

If multiple captures occur, prefer the latest meaningful outcome or a primary outcome field plus capture list (list is source of truth).

---

## Configuration UI

### Business Configuration page

New section **Handoff & appointments**:

- Appointment policy (textarea)
- Handoff destination type + value
- Handoff script
- Notification email (stored only in this phase)

### Agent form

New section **Capabilities**:

- Toggles: leads, messages, appointments, handoff
- Field checklists per enabled capability (defaults sensible)
- Help text: “Appointments are requests only. The agent will never confirm a booking.”

Read-only for members; editable for owners/admins (same as today).

---

## Runtime package changes

Extend `composeAgentRuntimePackage` / prompt builder to include:

1. Enabled capabilities and required fields  
2. Appointment policy from business config  
3. Handoff destination + script (not secrets)  
4. Hard rules:
   - Confirm key details in one sentence before any capture tool
   - Never say booked / transferred / emailed unless tool result is ok
   - Appointment outcomes are requests only
   - If capability disabled, refuse and offer an allowed alternative or fallback message

Also emit structured:

```ts
capabilities: { ... }
enabledTools: ['capture_lead', 'capture_message', 'create_appointment_request', 'offer_human_handoff', 'end_session']
```

Worker registers **only** tools listed in `enabledTools`.

---

## Tool contracts

All tools return a normalized result:

```ts
{ ok: true, captureId: string, captureType: string, status: string }
// or
{ ok: false, error: 'validation_failed' | 'not_allowed' | 'persist_failed', message: string }
```

### `capture_lead`

Input: `{ name, phone?, email?, notes?, idempotencyKey? }`  
Gate: agent `capture_leads`  
Persist: `capture_type = lead`, `status = captured`

### `capture_message`

Input: `{ name?, phone?, email?, message, idempotencyKey? }`  
Gate: agent `capture_messages`  
Persist: `capture_type = message`, `status = captured`

### `create_appointment_request`

Input: `{ name, phone?, email?, preferredTime, party?, notes?, idempotencyKey? }`  
Gate: agent `capture_appointments`  
Persist: `capture_type = appointment_request`, `status = requested`  
Spoken success template: request submitted; team will confirm — **never** “you’re booked”.

### `offer_human_handoff`

Input: `{ reason, callerName?, callbackPhone?, callbackEmail?, idempotencyKey? }`  
Gate: agent `offer_handoff` and business `handoff_destination_type != none`  
Persist: `capture_type = handoff_request`, `status = requested`  
Spoken success: use `handoff_script`, substituting destination value when type is `phone_info` / `email_info`.

### Existing `end_session`

Unchanged; remains available.

---

## Control-plane API

Prefer portal as source of truth for writes (same pattern as conversation start / lifecycle):

`POST /api/voice/conversations/[conversationId]/captures`

- Auth: voice session token (Bearer) verified server-side  
- Body: `{ tool, args, idempotencyKey? }`  
- Server checks: conversation exists, tenant/agent match token, capability allowed, Zod validate args  
- Insert capture; optionally patch conversation outcome  
- Return normalized tool result  

Worker tool handlers are thin HTTP clients to this route (service or session auth). Do not open unrestricted DB access from the LLM path.

Optional later: worker direct PostgREST writes with service role — not preferred for MVP because capability gating and validation belong in one place.

---

## Voice worker changes

1. Build capture tool schemas with Pipecat `FunctionSchema` (mirror `end_session`).  
2. Register tools from runtime `enabledTools`.  
3. Handlers: validate locally → call portal capture API → return result string to LLM.  
4. Timeline/diagnostic event on each tool attempt (`tool_started`, `tool_succeeded`, `tool_failed`) so conversation detail can show failure stage.  
5. On repeated tool failure or missing destination: speak agent `fallback_message` / configured handoff unavailable line; do not invent success.

---

## Portal review UI

On conversation detail / drawer:

- **Captures** section listing type, status, payload fields, timestamp  
- Outcome badge uses new outcome values  
- Empty state when no captures  

No separate “CRM” product in this phase.

---

## Implementation phases

### Phase A — Schema + config (no voice tools yet) ✅

Completed 2026-08-08:

1. Migration `20260808090000_add_capture_handoff_configuration.sql` (business handoff/appointment fields, agent `capabilities` jsonb, `conversation_captures` + RLS)
2. Business form section **Handoff and appointments** + validation
3. Agent form **Capabilities** toggles/fields + validation
4. Runtime package emits `capabilities`, `enabledTools`, and prompt rules (tools not registered in worker yet)
5. Demo seed: Greenleaf Front Desk has leads/messages/appointments/handoff enabled
6. Tests updated for validation, capabilities, runtime prompt, and migration artifacts

**Exit met:** owner can configure capabilities; runtime package reflects them.

### Phase B — Capture API + lead/message tools ✅

Completed 2026-08-08:

1. Capture Zod schemas under `apps/portal/lib/voice/capture-schema.ts`
2. `POST /api/voice/conversations/[conversationId]/captures` with Bearer session-token auth, capability checks, idempotency, outcome updates
3. Worker `capture_lead` / `capture_message` tools call the portal API when enabled in `enabledTools`
4. Conversation detail drawer shows a Captures section
5. Portal + worker tests for auth denial, capability denial, happy path, and idempotency

**Exit met:** browser test can leave a lead/message that appears on the conversation (after migration is applied).

### Phase B — Capture API + lead/message tools — original checklist

1. Capture Zod schemas shared/usable from portal  
2. `POST .../captures` route with session-token auth + capability checks  
3. Worker: `capture_lead`, `capture_message` handlers  
4. Conversation detail shows captures  
5. Tests: auth denial, cross-tenant denial, validation, idempotency, happy path  

**Exit:** browser test can leave a lead/message that appears on the conversation.

### Phase C — Appointment request ✅

1. Enable `create_appointment_request` tool  
2. Prompt rules: confirm → tool → “request submitted / team will confirm”  
3. Outcome `appointment_requested`  
4. Tests: never returns status `confirmed`; success speech contract covered in prompt/unit tests  

**Exit:** the transcript you shared becomes a real persisted appointment request.

### Phase D — Handoff / fallback route ✅

1. `offer_human_handoff` tool + business destination gating  
2. Deterministic fallback when handoff disabled or destination missing  
3. Wire “two failed understandings / tool failure → fallback_message” if not already solid  
4. Tests: callback vs phone_info scripts; disabled handoff refusal  

**Exit:** caller can request a human path; result is stored; no fake live transfer.

### Phase E — Hardening ✅

1. Tenant isolation tests for captures  
2. Tool-not-allowed when capability off  
3. Duplicate idempotency key returns same capture  
4. Update `docs/PROGRESS.md` after verified behavior  
5. Seed demo tenant agent with appointments + leads enabled for Finova-style demos  

---

## Explicit non-goals (this plan)

- Live calendar booking / availability checks  
- PSTN / Telnyx warm transfer  
- Outbound SMS/email sending (store `notification_email` only)  
- Per-tenant provider credentials  
- Usage metering  

---

## Acceptance checklist (maps to your sample)

- [x] Agent still corrects wrong-business requests using business config  
- [x] Agent collects name, contact, preferred time when appointments enabled  
- [x] Agent confirms details before calling the tool  
- [x] Saying “please book” triggers `create_appointment_request` *(tool + prompt contract; live demo after migration)*  
- [x] Portal shows an `appointment_request` row with Habiba / phone / tomorrow 2pm / party *(detail loader + Captures UI; live write after migration)*  
- [x] Spoken line is request-language, not “you’re booked”  
- [x] If appointments disabled, agent does not claim it booked anything  
- [x] Lead/message and handoff work the same confirm → tool → speak pattern  
- [x] Cross-tenant capture reads/writes fail closed  

---

## Suggested file touch list

| Area | Likely files |
|---|---|
| DB | `supabase/migrations/*_conversation_captures.sql`, business/agent alter migrations, seed |
| Portal config | `lib/business-configuration/*`, `lib/agents/*`, business/agent forms |
| Runtime | `lib/runtime/builder.ts`, `lib/runtime/schema.ts` |
| Captures API | `lib/voice/captures/*`, `app/api/voice/conversations/[conversationId]/captures/route.ts` |
| Review UI | conversation detail/drawer components |
| Worker | `workers/voice/app/bot.py` (or new `tools/captures.py`), runtime_config |
| Tests | portal capture/auth tests; worker tool registration tests; SQL/pgTAP isolation |

---

## Open decisions (defaults assumed)

| Decision | Default in this plan |
|---|---|
| Notifications on capture | Store only; no send |
| Transfer UX | Support `callback`, `phone_info`, `email_info` |
| Config home | Business owns destinations/policy; agent owns capability toggles |
| Write path | Portal capture API + session token |
| Calendar | Request capture only |

If any default should change before coding, decide before Phase A migration lands.
