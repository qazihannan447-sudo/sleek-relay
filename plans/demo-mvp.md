# Sleek Relay Browser Demo MVP Plan

## 1. RFQ-Derived Requirements

### Core business and product requirements

- The validation demo must support at least three isolated pilot tenants.
- One tenant represents one pilot business.
- Each tenant has one shared business configuration.
- A tenant may own multiple agents.
- Each agent must use only its tenant's approved business information and approved knowledge.
- Users must be able to configure agents, test them through the browser, and review completed conversations.
- Test sessions must produce a live transcript, persisted transcript, summary, structured outcome, and recording where supported.
- The system must capture leads, messages, and appointment requests.
- Appointment capture must remain a request unless an external system confirms a booking.
- The system must not claim success for transfers, bookings, notifications, or other actions without a confirmed tool result.

### Security and isolation requirements

- Tenant isolation is mandatory across configuration, knowledge, conversations, recordings, usage data, credentials, logs, and storage paths.
- Browser clients must never receive provider secrets, service-role keys, internal prompts, or direct access to unrestricted tools.
- Tool calls must be explicit, allowlisted, schema-validated, and checked before the agent communicates success.
- Server-side authorization must validate tenant ownership for all tenant-owned resources.
- Recordings must remain private and be accessed only through authorized flows or temporary URLs.

### Runtime and operational requirements

- The system must demonstrate a complete browser-based voice-agent journey for market validation.
- The real-time pipeline must support interruption handling, endpointing, timeouts, safe fallback, and safe close-off.
- The system must preserve enough runtime configuration per conversation to explain how the agent behaved.
- The dashboard must expose enough diagnostics to inspect conversations, status, outcomes, usage, and failure stage.
- The architecture must preserve clean boundaries so the long-term RFQ architecture can replace demo-stage components later.

### RFQ constraints that still shape the demo

- Next.js remains the portal and control-plane application.
- Pipecat remains the real-time voice orchestration layer.
- Azure AI Speech remains the STT/TTS provider.
- Microsoft Foundry remains the LLM provider.
- Provider-specific code should be isolated behind clear boundaries.
- The long-term target remains Azure-hosted data, storage, queues, secrets, and monitoring under Sleek Relay control.

## 2. Assumptions and Deviations

### Assumptions

- This validation demo is browser-only and does not need PSTN, SIP, phone numbers, or call transfers through telecom providers.
- Assisted business setup will be manual form entry for the MVP, with optional website-derived drafts deferred unless explicitly requested.
- Post-conversation notifications may be represented as stored requested actions in the MVP unless outbound email or SMS is explicitly added later.
- The operator experience can be implemented inside the same Next.js portal instead of as a separate application.
- The MVP only needs enough usage and latency reporting to support review, debugging, and pilot guardrails, not full billing-grade metering.
- The browser transport may use a single real-time session channel between browser and voice worker, with the Next.js app acting as the control plane rather than the audio path.

### Explicit deviations from the long-term RFQ architecture

- Supabase is a temporary demo-stage deviation from the RFQ target of Azure PostgreSQL, Blob Storage, queues, and related Azure-managed control-plane services.
- The reason for this deviation is speed to validation: Supabase provides a fast, reviewable path for authentication, PostgreSQL, row-level security, and private recording storage while preserving a relational model and migration discipline that can later move to Azure-owned services.
- Telephony-specific components in the RFQ, including carrier adapter, CallRouter, webhook verification for carrier ingress, DID handling, and live human transfer routing, are intentionally out of scope for this browser validation demo.
- The demo will validate the agent workflow, tenant isolation, browser voice UX, transcript flow, and operator review path, not production-intended PSTN behavior.

### Consequences of those deviations

- The plan should keep session orchestration, runtime events, tool execution, and tenant authorization independent from the browser transport so telephony can be added later without reworking core domain logic.
- Storage and database abstractions should be thin and practical, not over-engineered, but they should avoid leaking Supabase-specific assumptions into domain modules.
- Acceptance for this demo should focus on browser end-to-end flows and tenant safety rather than PSTN delivery evidence.

## 3. Proposed Repository Structure

```text
/
  docs/
    PROGRESS.md
    REQUIREMENTS.md
    SCOPE.md
    Sleek_Relay_NPE_Validation_Release_RFQ_Offshore_Teams 2.md
  plans/
    demo-mvp.md
  apps/
    portal/
      app/
      components/
      lib/
      server/
      tests/
  workers/
    voice/
      app/
      domain/
      providers/
      realtime/
      tests/
  packages/
    schemas/
    prompts/
    shared/
  supabase/
    migrations/
    seed/
    policies/
  scripts/
  .github/
    workflows/
```

### Structure rationale

- `apps/portal` contains the Next.js dashboard, authenticated pages, server actions or route handlers, and control-plane APIs.
- `workers/voice` contains the Python Pipecat worker and all real-time runtime logic.
- `packages/schemas` centralizes shared request, event, and tool schemas used by both the portal and worker.
- `packages/prompts` contains deterministic prompt-building logic and templates derived from approved business data and agent configuration.
- `packages/shared` holds small cross-cutting utilities and type definitions that do not justify duplication.
- `supabase/` contains migrations, policy definitions, and seed data for demo tenants.

## 4. Major Modules and Their Responsibilities

### Next.js portal and backend/control plane

- Authentication and session handling for portal users.
- Tenant-aware CRUD for business profiles, approved knowledge, and agent configuration.
- Test-session creation, authorization, expiry, and issuance of short-lived worker connection credentials.
- Conversation review UI for transcripts, summaries, outcomes, recordings, and diagnostics.
- Operator-oriented list and detail views for filtering sessions and inspecting failure stages.
- Usage and status queries for tenant-visible guardrails.
- Secure internal APIs used by the worker for conversation persistence, tool execution, and event publication where direct database access is not appropriate.

### Python Pipecat voice worker

- Accepts authorized browser test sessions.
- Owns the live audio session, STT, LLM, TTS, turn-taking, endpointing, interruption handling, and safe completion.
- Loads the runtime conversation package for the selected agent and tenant.
- Emits transcript segments, agent events, and lifecycle updates.
- Executes only allowlisted tools through validated tool handlers.
- Produces the final structured outcome, summary inputs, usage metrics, and recording metadata.
- Fails safely when provider calls, tool calls, or runtime assumptions break.

### Shared domain and schema packages

- Shared IDs, enums, payload schemas, and event contracts.
- Tool input and output schemas.
- Summary and outcome schemas.
- Runtime instruction assembly inputs and deterministic rendering helpers.

### Supabase data and storage layer

- Stores tenant, user membership, business configuration, approved knowledge, agents, sessions, conversations, messages, outcomes, and usage records.
- Enforces row-level security for portal-facing data access.
- Stores private recordings and optional exported artifacts.
- Supports audit-friendly relational persistence for demo-stage control-plane data.

## 5. Data Ownership and Tenant-Isolation Model

### Tenant model

- `tenant` is the top-level business boundary.
- `tenant_membership` maps authenticated users to one or more tenants with a role.
- `business_profile` is one-to-one with `tenant`.
- `business_knowledge` rows belong to one tenant and require an approval status before runtime use.
- `agent` belongs to exactly one tenant.
- `test_session` belongs to one tenant and one agent and represents a browser authorization envelope.
- `conversation` belongs to one tenant and one agent and is linked back to the originating test session when applicable.
- `conversation_event`, `transcript_segment`, `lead`, `message_capture`, `appointment_request`, `summary`, `outcome`, and `usage_record` all inherit tenant ownership from the parent conversation.

### Isolation enforcement

- Portal reads and writes use authenticated Supabase access with RLS based on tenant membership.
- Sensitive control-plane operations also apply server-side authorization in Next.js before any database mutation or signed URL issuance.
- The browser never supplies authoritative tenant ownership; server-issued session tokens bind tenant, agent, user, and expiration.
- The worker must only accept session tokens minted by the Next.js control plane.
- Worker writes should use either a protected internal API or service access constrained by validated tenant and session claims.
- Recording object paths must include tenant and conversation scoping and should never be directly guessable from the browser.

### Runtime data ownership principle

- Shared business information is tenant-owned.
- Agent persona and behavior are agent-owned within a tenant.
- Runtime instructions are generated artifacts for a specific session and stored as a conversation snapshot rather than mutable source configuration.

## 6. Communication Between the Next.js Application and Voice Worker

### Control-plane flow

1. An authenticated portal user selects an agent and starts a browser test.
2. Next.js verifies the user can access that tenant and agent.
3. Next.js creates a short-lived `test_session` record and a signed worker session token containing tenant, agent, user, session ID, and expiry.
4. Next.js returns browser-safe connection details for the real-time session.
5. The browser connects to the voice worker using the short-lived token.

### Runtime flow

1. The worker validates the signed token and loads the runtime configuration package for the session.
2. The browser streams audio to the worker through the chosen browser-compatible real-time transport.
3. The worker sends audio to Azure Speech STT, sends grounded prompts plus tool results to Foundry, and sends generated responses to Azure TTS.
4. The worker emits transcript and event updates back to the browser for live rendering.
5. The worker persists or forwards key runtime events for durable storage.

### Completion flow

1. On completion or failure, the worker finalizes transcript state, structured outcome, usage data, and recording metadata.
2. Next.js or the worker triggers summary generation using stored transcript and structured artifacts.
3. The conversation becomes available in the portal review UI.

### Recommended boundary choice

- Prefer Next.js as the source of truth for session authorization and control-plane writes.
- Prefer the worker as the source of truth for real-time pipeline state.
- Use a narrow internal contract between them:
  - fetch runtime session package
  - append transcript and event data
  - submit structured captures and final outcome
  - mark session state transitions

## 7. Provider Integration Boundaries

### Azure AI Speech boundary

- A speech provider adapter in the worker owns STT streaming, TTS synthesis, voice selection mapping, and provider error normalization.
- Domain logic should depend on normalized transcript, synthesis, and error events, not Azure SDK types.

### Microsoft Foundry boundary

- An LLM adapter in the worker owns model invocation, tool-call exchange format, retry policy, timeout behavior, and provider response normalization.
- Prompt construction should happen in a dedicated runtime-instruction module, not inline in the provider adapter.

### Supabase boundary

- Portal-facing data access should be encapsulated in repositories or server-side data services, not scattered throughout page components.
- Worker persistence should be encapsulated in a small storage gateway or internal API client.
- Recording storage access should be abstracted behind a recording service that can later move from Supabase storage to Azure Blob without changing conversation logic.

### Real-time transport boundary

- The real-time transport should be isolated behind a session transport module so browser transport can later be swapped or augmented without changing tool logic, transcript persistence, or provider adapters.

## 8. Implementation Phases in Dependency Order

### Phase 0: Architecture and contracts

- Finalize repo structure, schemas, session lifecycle, tenant model, tool contracts, and migration plan.
- Document the Supabase deviation and browser-only scope.

### Phase 1: Data foundation and authentication

- Create Supabase schema, migrations, RLS policies, seeded demo tenants, portal authentication, and tenant membership handling.

### Phase 2: Portal configuration surface

- Build business profile, approved knowledge, and agent configuration flows with server-side authorization and validation.

### Phase 3: Test-session orchestration

- Implement test-session creation, worker token issuance, session expiry, and browser test entry points.

### Phase 4: Voice runtime vertical slice

- Build the Pipecat worker with browser transport, Azure Speech STT/TTS, Foundry integration, live transcript streaming, and safe completion for one agent flow.

### Phase 5: Tooled conversation workflows

- Add grounded knowledge lookup, message capture, lead capture, and appointment-request tools with validated schemas and safe confirmation behavior.

### Phase 6: Persistence, review, and diagnostics

- Persist conversations, transcript segments, outcomes, summaries, recordings, and basic usage or latency metrics.
- Build conversation review and operator inspection views in the portal.

### Phase 7: Guardrails and hardening

- Add usage caps, pause or resume controls, failure-path handling, recording access controls, audit logging, and tenant-isolation verification.

### Phase 8: Deployment and handoff readiness

- Add deployment workflow, environment documentation, rollback notes, seed guidance, and demo runbook.

## 9. Testing Strategy

### Automated tests

- Schema validation tests for shared payloads, tool inputs, tool outputs, summary payloads, and session tokens.
- Repository and authorization tests for tenant isolation, agent ownership, and forbidden cross-tenant access.
- Next.js route or server-action tests for configuration mutations, session issuance, and signed recording access.
- Worker unit tests for prompt assembly, tool gating, provider adapter normalization, and failure fallback behavior.
- Integration tests for browser session lifecycle, conversation persistence, and final artifact creation.

### Targeted end-to-end verification

- Browser-only happy path: start test, speak to agent, receive live transcript, complete call, review saved artifacts.
- Grounded FAQ path using approved business information only.
- Message capture path with confirmed stored result before spoken success.
- Appointment-request path that clearly remains a request.
- Failure path when provider or tool calls fail, including deterministic fallback messaging.
- Cross-tenant access denial tests for portal and session issuance.

### Non-goals for this demo

- No PSTN or SIP end-to-end tests.
- No carrier webhook tests.
- No large-scale load testing beyond basic pilot confidence checks unless explicitly requested later.

## 10. Deployment Approach

### Demo-stage deployment shape

- Deploy the Next.js portal and API as one service.
- Deploy the Python voice worker as a separate service.
- Use Supabase-hosted database, auth, and private storage for the MVP.
- Use environment-driven configuration for all provider credentials and service endpoints.

### Environment model

- Local development environment for fast iteration.
- One shared non-production demo environment for internal validation and pilot demonstrations.

### Operational expectations

- The portal should be the only public control-plane surface.
- The worker should only accept authorized session creation and signed runtime access.
- Secrets remain server-side in deployment environment configuration.
- Deployment steps should be reproducible from the repository without undocumented manual edits.

### Future migration intent

- The deployment plan should leave clear replacement seams for Azure PostgreSQL, Blob Storage, queue-backed jobs, Key Vault, and Azure-native monitoring when the project moves from demo validation to RFQ-aligned infrastructure.

## 11. Risks and Unresolved Decisions

### Primary risks

- Browser real-time transport choice may affect latency, interruption quality, and implementation complexity.
- Pipecat browser-session ergonomics may require a thin session gateway or adaptation layer depending on chosen transport.
- Summary generation timing must balance responsiveness with deterministic completion and cost.
- Recording support may vary based on chosen browser transport and hosting path.
- Supabase is intentionally temporary, so over-coupling application code to Supabase-specific APIs would create migration cost later.

### Unresolved decisions

- Exact browser-compatible transport mechanism between browser and worker.
- Whether summaries are produced inline at session end or asynchronously after session finalization.
- Whether the worker writes directly to Supabase with privileged credentials or uses a narrow internal API exposed by Next.js.
- Whether notifications are included in the MVP or represented as captured follow-up tasks only.
- Whether approved knowledge starts as structured FAQs only or also supports freeform knowledge documents in phase 2.

## 12. Acceptance Criteria for Every Phase

### Phase 0 acceptance

- `plans/demo-mvp.md` documents scope, deviations, module boundaries, phases, and risks.
- Browser-only scope and Supabase deviation are explicitly recorded.
- No telephony implementation work is introduced.

### Phase 1 acceptance

- At least three pilot tenants can exist in seeded data.
- Authentication and tenant membership are functional.
- RLS prevents cross-tenant reads and writes for portal-facing data.
- Migrations create the core tenant, business, agent, and conversation tables.

### Phase 2 acceptance

- Authenticated users can create and update their tenant's business profile.
- Authenticated users can create and manage multiple agents within their tenant.
- Approved knowledge can be created and marked as approved before runtime use.
- Cross-tenant mutation attempts are rejected.

### Phase 3 acceptance

- Authorized users can create a browser test session for an owned agent.
- Session tokens are short-lived and bound to tenant, agent, user, and session ID.
- Expired or tampered session tokens are rejected.
- The browser receives only safe runtime connection details.

### Phase 4 acceptance

- A browser user can complete a live voice session with one configured agent.
- Live transcript updates are visible during the session.
- The worker handles interruption, timeout, and safe close-off for the browser flow.
- Session completion persists a conversation shell and final transcript.

### Phase 5 acceptance

- The agent can answer grounded questions from approved business information.
- Lead capture, message capture, and appointment-request tools use validated schemas.
- The agent never claims confirmed booking success without a confirmed system result.
- Tool failures produce deterministic and safe spoken fallback behavior.

### Phase 6 acceptance

- Completed conversations show transcript, summary, structured outcome, and recording metadata where supported.
- Portal users can review conversation history for their tenant only.
- Operator views expose enough diagnostics to identify major failure stage and basic usage.

### Phase 7 acceptance

- Tenant usage caps, pause or resume controls, and recording access rules are enforced.
- Automated tests cover tenant isolation, authorization, and unsafe success-claim prevention.
- Failure paths for unavailable providers or invalid tool outcomes are observable and safe.

### Phase 8 acceptance

- The portal and worker can be deployed from repository instructions into the chosen demo environment.
- Required environment variables, secrets, and setup steps are documented.
- Rollback notes and demo runbook are documented.
- Remaining gaps between the demo architecture and the RFQ target Azure architecture are explicitly listed for the next stage.
