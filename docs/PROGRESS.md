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
