# Supabase Data Foundation

This folder now contains the minimal data foundation for the Sleek Relay demo-stage Supabase layer.

Included in this phase:

- a migration for `user_profiles`, `tenants`, `tenant_memberships`, `business_configurations`, and `agents`
- row-level security policies for authenticated tenant access
- helper functions in a private schema to avoid recursive RLS checks on `tenant_memberships`
- a trigger that creates a minimal `user_profiles` row for new `auth.users` records
- reusable `updated_at` triggers for mutable tables
- explicit table grants for `authenticated` and `service_role`
- demo seed data for three pilot tenants backed by matching `auth.users` records
- pgTAP database tests under `supabase/tests/database`

Provisioning note:

- Initial tenant creation and the first owner membership are intended to be created by privileged server-side code or seed/migration operations, not by browser-accessible bootstrap policies.

Deferred for later phases:

- approved knowledge
- conversations and voice sessions
- recordings and storage paths
- provider credentials and integrations
- tool execution state
- dashboard pages and API handlers

## Voice catalog (`public.voices`)

A shared, non-tenant-scoped table of Cartesia TTS voices used by the Agents
"Configure voice" drawer. Only voices with a preview sample are kept in the
table. Readable by any authenticated user (`enabled = true` rows only);
writes are service-role only.

### Catalog metadata

Populate/refresh voice metadata with `supabase/scripts/fetch-cartesia-voices.mjs`:

```
CARTESIA_API_KEY=sk_car_... node supabase/scripts/fetch-cartesia-voices.mjs \
  --write-migration supabase/migrations/<timestamp>_seed_cartesia_voices.sql
```

### Durable preview audio (recommended)

Cartesia `preview_file_url` links can expire. Sync durable copies into the
public `voice-previews` Storage bucket:

1. Apply migrations (includes the `voice-previews` bucket + `preview_storage_path` column).
2. Ensure env has:
   - `CARTESIA_API_KEY`
   - `NEXT_PUBLIC_SUPABASE_URL` (or `SUPABASE_URL`)
   - `SUPABASE_SERVICE_ROLE_KEY`
3. Run:

```
# From the repo root
node --env-file=apps/portal/.env.local --env-file=.env.voice \
  supabase/scripts/sync-voice-previews.mjs
```

Useful flags:

```
# Re-upload everything
node --env-file=apps/portal/.env.local --env-file=.env.voice \
  supabase/scripts/sync-voice-previews.mjs --force

# Smoke-test a few voices first
node --env-file=apps/portal/.env.local --env-file=.env.voice \
  supabase/scripts/sync-voice-previews.mjs --limit 10
```

After sync, the portal Configure Voice drawer plays from Supabase Storage
(public object URLs). The `/api/voices/[id]/preview` route still falls back to
Cartesia for any voice that has not been synced yet.
