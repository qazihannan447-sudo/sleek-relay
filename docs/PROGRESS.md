# Progress

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
