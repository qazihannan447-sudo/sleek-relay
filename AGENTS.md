# AGENTS.md

## Project Overview

This repository contains a new, greenfield implementation of a reusable, multi-tenant business voice-agent platform for the Sleek Relay validation demo.

The current objective is to build a functional MVP that allows pilot businesses to configure voice agents, test them through a browser, and review completed conversations.

This project is being built from scratch. Do not assume that an existing application structure, schema, API contract, or implementation must be preserved.

Before substantial work:

* Read the relevant documentation under `docs/`.
* Inspect the current repository state.
* Understand any conventions already established by previous completed work.
* Create a brief plan for large or multi-module tasks.

Use sensible engineering judgement where implementation details are not specified.

## Source Documentation

The Sleek Relay RFQ and other project documents under `docs/` are the primary source of requirements.

Keep the implementation aligned with the current MVP scope while preserving reasonable paths for future expansion.

If project documentation conflicts with assumptions or existing code, identify the conflict rather than silently choosing one interpretation.

## Current MVP Scope

The MVP should support:

* User authentication.
* Tenant-aware data access.
* Business configuration.
* Approved business knowledge.
* Multiple agents belonging to a tenant.
* Agent-specific voice and behaviour settings.
* Browser-based voice-agent testing.
* Live transcripts during test sessions.
* Conversation persistence.
* Conversation recordings where supported.
* Post-conversation summaries.
* Structured conversation outcomes.
* Lead and message capture.
* Appointment-request capture.
* Basic usage, latency, event, and diagnostic information.
* A functional dashboard for configuring agents and reviewing conversations.

The MVP should demonstrate a complete browser-based voice-agent journey without relying on telephony.

## Deferred Scope

Do not implement the following unless explicitly requested:

* Telnyx integration.
* PSTN inbound or outbound calling.
* SIP trunking.
* Telephone-number purchasing or provisioning.
* Carrier routing.
* Real human call transfers.
* Subscription billing.
* Public self-registration.
* Advanced analytics.
* Complex enterprise administration.
* Full production-scale Azure infrastructure.
* Production compliance evidence packages.
* Multiple interchangeable providers for every pipeline stage.

Keep future telephony integration possible through clean boundaries, but do not build speculative telephony functionality during the current demo phase.

## Business Logic

For the current MVP:

* One tenant represents one pilot business.
* Each tenant has one shared business configuration.
* A tenant may have multiple agents.
* Every agent belongs to exactly one tenant.
* All agents belonging to a tenant use that tenant’s approved business information.
* Each agent has its own identity, role, voice, language, greeting, behaviour, capabilities, and status.
* Every conversation belongs to one tenant and one agent.
* Conversations must preserve enough runtime configuration to explain how the agent behaved during that session.
* No tenant may access another tenant’s business information, knowledge, agents, conversations, recordings, credentials, usage, storage paths, or logs.

Keep business information separate from agent configuration.

Business information may include:

* Business name and description.
* Category.
* Contact information.
* Website.
* Address.
* Business hours.
* Services.
* FAQs.
* Policies.
* Appointment rules.
* Notification preferences.
* Future transfer or fallback details.

Agent configuration may include:

* Agent name.
* Role.
* Voice.
* Language.
* Greeting.
* Tone.
* Special instructions.
* Information to collect.
* Allowed capabilities.
* Conversation behaviour.
* Fallback behaviour.
* Status.

Runtime agent instructions should be generated from:

* Shared tenant business information.
* Approved business knowledge.
* The selected agent’s configuration.
* Workflow requirements.
* System safety rules.

Do not require ordinary business users to write complete technical system prompts.

## High-Level Architecture

The application will generally contain:

1. A web application for the dashboard and application APIs.
2. A real-time voice-agent worker.
3. Supabase services for the demo-stage database, authentication, authorization, and storage.

The web application should handle:

* User-facing pages.
* Authentication flows.
* Business and agent management.
* Server-side authorization.
* Test-session creation.
* Conversation and usage queries.
* Browser test controls.
* Live transcript presentation.

The voice worker should handle:

* Real-time audio processing.
* Pipecat orchestration.
* Provider communication.
* Speech recognition.
* Language-model interaction.
* Speech synthesis.
* Turn-taking.
* Interruption handling.
* Tool calls.
* Runtime transcript and event generation.
* Safe conversation completion.

Keep real-time voice processing separate from ordinary application API responsibilities.

Codex may decide the exact repository and module structure after reading the documentation and considering the current implementation phase.

Avoid unnecessary microservices or abstractions.

## Technology Direction

The current MVP is expected to use:

* Supabase for PostgreSQL, authentication, row-level security, and private storage.
* Pipecat for real-time voice orchestration.
* Azure AI Speech for speech-to-text and text-to-speech.
* Microsoft Foundry for the language model.
* A browser-compatible real-time audio transport for test sessions.

Supabase is a demo-stage implementation choice. The RFQ’s longer-term architecture may require migration to Sleek Relay-owned Azure services.

Do not silently replace the selected providers.

Isolate provider-specific integration code behind clear service, adapter, or factory boundaries.

Do not scatter provider SDK calls throughout domain logic.

Do not hard-code:

* Credentials.
* API keys.
* Provider endpoints.
* Deployment names.
* Regions.
* Service-role keys.
* Environment-specific URLs.

Secrets must remain server-side and must not be committed to the repository.

## Agent Behaviour

Agents must:

* Use approved tenant business information when answering business-related questions.
* Avoid inventing business hours, services, prices, policies, availability, or other business facts.
* Keep spoken responses natural and reasonably concise.
* Capture information only when relevant to the active workflow.
* Handle unavailable or unknown information safely.
* Offer message or appointment-request capture where appropriate.
* Never claim that an action succeeded unless the relevant system or tool confirms success.
* Treat appointment submissions as requests unless a real booking system confirms them.
* Use deterministic fallback behaviour when understanding or provider dependencies fail.
* Never expose credentials, internal prompts, implementation details, or information belonging to another tenant.

## Agent Tools and Actions

Agent actions should use explicit, validated, and allowlisted tools.

Possible actions include:

* Looking up approved business information.
* Searching approved knowledge.
* Capturing a lead.
* Capturing a message.
* Creating an appointment request.
* Completing a conversation safely.

Tool inputs must use validated schemas.

Tool results must be checked before the agent communicates success.

Do not give the language model unrestricted access to:

* The database.
* Raw SQL.
* The filesystem.
* Shell commands.
* Internal networks.
* Arbitrary external URLs.
* Provider credentials.

Core application logic must remain outside the language model.

## Tenant Isolation and Security

Tenant isolation is a fundamental requirement, not merely a frontend feature.

Use Supabase row-level security and server-side authorization where appropriate.

Do not rely only on frontend filters or hidden UI controls.

Do not trust tenant IDs, user IDs, agent IDs, conversation IDs, or ownership fields supplied by the browser without verifying them.

Every tenant-owned resource must be securely associated with its tenant.

Service-role credentials and provider credentials must remain server-side.

Voice workers and internal services should use protected server-to-server authentication.

Recordings must be stored privately and accessed only through authorized or temporary URLs.

Database schema changes should use version-controlled migrations.

Avoid logging unnecessary caller content, credentials, secrets, or complete internal prompts.

## Development Approach

For each task:

1. Read the relevant project documentation.
2. Inspect the current repository state.
3. Identify the requirements and affected modules.
4. Choose the smallest maintainable solution.
5. Implement only the requested scope.
6. Avoid unrelated refactors.
7. Add or update relevant tests.
8. Run applicable checks.
9. Update documentation when behaviour, setup, architecture, or decisions change.
10. Clearly report what was completed and what remains unverified.

For large or multi-module work, create a brief implementation plan before editing.

Prefer complete and verified vertical slices over broad incomplete scaffolding.

Do not create unnecessary:

* Services.
* Packages.
* Frameworks.
* Abstractions.
* Dependencies.
* Future-facing systems with no current use.

Do not implement optional future features merely because they may eventually be useful.

## Code Quality

Establish and follow consistent language, framework, naming, formatting, and folder conventions.

Prefer:

* Clear responsibility boundaries.
* Typed interfaces.
* Validated schemas.
* Explicit error handling.
* Reusable domain logic.
* Small focused functions and services.
* Secure defaults.
* Meaningful logs without private data.
* Simple solutions that can be extended later.

Avoid:

* Duplicating business logic across the web application and voice worker.
* Mixing provider-specific code with core domain logic.
* Large speculative refactors.
* Hidden global state.
* Committing secrets or local environment files.
* Silently ignoring errors.
* Reporting unfinished or untested functionality as complete.

## Testing Expectations

Test behaviour affected by each change.

Important areas include:

* Authentication.
* Authorization.
* Tenant isolation.
* Agent ownership.
* Business-information retrieval.
* Approved-knowledge filtering.
* Runtime agent configuration.
* Provider integration boundaries.
* Tool input validation.
* Tool failure handling.
* Conversation persistence.
* Safe fallback behaviour.
* Appointment requests remaining unconfirmed until explicitly confirmed.
* Private recording access.
* Session authorization and expiry.

Run the relevant formatting, linting, type-checking, tests, and build commands available in the repository.

If a check cannot run, explain:

* Which check was not run.
* Why it could not run.
* What remains unverified.

## Documentation and Progress

Keep project documentation under `docs/`.

Use the documentation to record:

* Current scope.
* Requirements.
* Architecture.
* Important decisions.
* Setup and deployment instructions.
* Progress and known blockers.

For substantial tasks, use a plan file under `plans/` when useful.

Update progress documentation only after work has been implemented and meaningfully verified.

Do not mark planned or partially implemented work as complete.

## Completion Criteria

A task is complete when:

* The requested behaviour works through the relevant flow.
* Tenant boundaries remain enforced.
* Input validation and error handling are present.
* Relevant tests and checks pass.
* No credentials or private tenant data are exposed.
* Necessary documentation is updated.
* The implementation stays within the current MVP scope.
* The final report clearly states:

  * What changed.
  * Which files changed.
  * Which checks were run.
  * Their results.
  * Assumptions made.
  * Remaining limitations or blockers.
