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
"Configure voice" drawer. Readable by any authenticated user (`enabled = true`
rows only); writes are service-role only.

The table is populated and refreshed with `supabase/scripts/fetch-cartesia-voices.mjs`,
which fetches Cartesia's live English voice catalog and writes a migration
that upserts the rows (safe to re-run; never deletes):

```
CARTESIA_API_KEY=sk_car_... node supabase/scripts/fetch-cartesia-voices.mjs \
  --write-migration supabase/migrations/<timestamp>_seed_cartesia_voices.sql
```

`CARTESIA_API_KEY` already lives in `apps/portal/.env.local`, so you can also run:

```
node --env-file=apps/portal/.env.local supabase/scripts/fetch-cartesia-voices.mjs \
  --write-migration supabase/migrations/<timestamp>_seed_cartesia_voices.sql
```

Re-run it periodically to pick up new Cartesia voices or refresh preview URLs.
