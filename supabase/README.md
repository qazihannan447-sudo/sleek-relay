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
