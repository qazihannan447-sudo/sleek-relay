# Progress

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
