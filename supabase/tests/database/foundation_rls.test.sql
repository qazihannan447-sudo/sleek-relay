begin;

create extension if not exists pgtap with schema extensions;

select plan(35);

\ir ../../seed/demo_tenants.sql

insert into auth.users (id, email, raw_user_meta_data)
values
  (
    '44444444-4444-4444-8444-444444444444',
    'member+greenleaf@sleekrelay.demo',
    '{"full_name":"Mia Member"}'::jsonb
  ),
  (
    '55555555-5555-4555-8555-555555555555',
    'admin+greenleaf@sleekrelay.demo',
    '{"full_name":"Noah Admin"}'::jsonb
  );

insert into public.tenant_memberships (tenant_id, user_id, role)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', '44444444-4444-4444-8444-444444444444', 'member'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', '55555555-5555-4555-8555-555555555555', 'admin');

select has_table('public', 'user_profiles', 'migration created user_profiles');
select has_table('public', 'tenants', 'migration created tenants');
select has_table('public', 'tenant_memberships', 'migration created tenant_memberships');
select has_table('public', 'business_knowledge', 'migration created business_knowledge');
select has_table('public', 'conversations', 'migration created conversations');
select has_table('public', 'conversation_messages', 'migration created conversation_messages');
select has_function('private', 'is_tenant_member', array['uuid'], 'membership helper function exists');
select has_function('private', 'is_tenant_manager', array['uuid'], 'manager helper function exists');
select has_trigger('auth', 'users', 'on_auth_user_created', 'auth trigger exists');

select is(
  (
    select count(*)
    from public.user_profiles profile
    left join auth.users auth_user
      on auth_user.id = profile.id
    where auth_user.id is null
  ),
  0::bigint,
  'all profiles remain linked to auth.users rows'
);

set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';

select lives_ok(
  $$ select count(*) from public.tenant_memberships $$,
  'tenant membership select does not recurse under RLS'
);

select results_eq(
  $$ select slug from public.tenants order by slug $$,
  $$ values ('greenleaf-dental') $$,
  'tenant A owner can only read tenant A'
);

update public.business_configurations
set business_phone = '+1-555-0199'
where tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';

select results_eq(
  $$ select business_phone from public.business_configurations where tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1' $$,
  $$ values ('+1-555-0199') $$,
  'owner can modify own tenant business configuration'
);

update public.business_configurations
set business_phone = '+1-555-9999'
where tenant_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';

select results_eq(
  $$ select count(*)::bigint from public.business_configurations where tenant_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2' $$,
  $$ values (0::bigint) $$,
  'tenant A owner cannot read tenant B business configuration'
);

reset role;

select results_eq(
  $$ select business_phone from public.business_configurations where tenant_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2' $$,
  $$ values ('+1-555-0102') $$,
  'tenant B business configuration remains unchanged after foreign update attempt'
);

set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '44444444-4444-4444-8444-444444444444';

select lives_ok(
  $$ select count(*) from public.agents $$,
  'member agent select does not recurse under RLS'
);

select results_eq(
  $$ select count(*)::bigint from public.agents where tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1' $$,
  $$ values (2::bigint) $$,
  'member can read own tenant agents'
);

select results_eq(
  $$ select count(*)::bigint from public.business_knowledge where tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1' $$,
  $$ values (2::bigint) $$,
  'member can read own tenant knowledge'
);

select results_eq(
  $$ select count(*)::bigint from public.agents where tenant_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2' $$,
  $$ values (0::bigint) $$,
  'member cannot read tenant B agents'
);

select results_eq(
  $$ select count(*)::bigint from public.business_knowledge where tenant_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2' $$,
  $$ values (0::bigint) $$,
  'member cannot read tenant B knowledge'
);

select results_eq(
  $$ select count(*)::bigint from public.conversations where tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1' $$,
  $$ values (1::bigint) $$,
  'member can read own tenant conversations'
);

select results_eq(
  $$ select count(*)::bigint from public.conversation_messages where tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1' $$,
  $$ values (4::bigint) $$,
  'member can read own tenant conversation messages'
);

select results_eq(
  $$ select count(*)::bigint from public.conversations where tenant_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2' $$,
  $$ values (0::bigint) $$,
  'member cannot read tenant B conversations'
);

select results_eq(
  $$ select count(*)::bigint from public.conversation_messages where tenant_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2' $$,
  $$ values (0::bigint) $$,
  'member cannot read tenant B conversation messages'
);

select throws_ok(
  $sql$
    insert into public.agents (id, tenant_id, name, role, language, status)
    values (
      'dddddddd-0000-4000-8000-000000000001',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      'Unauthorized Agent',
      'Support',
      'en',
      'draft'
    )
  $sql$,
  '42501',
  'member cannot create agents reserved for managers'
);

select throws_ok(
  $sql$
    update public.tenant_memberships
    set role = 'admin'
    where tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
      and user_id = '44444444-4444-4444-8444-444444444444'
  $sql$,
  '42501',
  'member cannot mutate memberships'
);

select throws_ok(
  $sql$
    insert into public.business_knowledge (id, tenant_id, kind, title, content, status)
    values (
      'dddddddd-1000-4000-8000-000000000001',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      'faq',
      'Unauthorized Knowledge',
      'Members should not be allowed to create this record.',
      'draft'
    )
  $sql$,
  '42501',
  'member cannot create business knowledge reserved for managers'
);

set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = '55555555-5555-4555-8555-555555555555';

insert into public.agents (id, tenant_id, name, role, language, status)
values (
  'eeeeeeee-0000-4000-8000-000000000001',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  'Admin Added Agent',
  'Support',
  'en',
  'draft'
);

select results_eq(
  $$ select count(*)::bigint from public.agents where tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1' $$,
  $$ values (3::bigint) $$,
  'admin can add agents within own tenant'
);

insert into public.business_knowledge (id, tenant_id, kind, title, content, status)
values (
  'eeeeeeee-1000-4000-8000-000000000001',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  'service_information',
  'Admin Added Knowledge',
  'This record was added by an admin within the same tenant.',
  'approved'
);

select results_eq(
  $$ select count(*)::bigint from public.business_knowledge where tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1' $$,
  $$ values (3::bigint) $$,
  'admin can add business knowledge within own tenant'
);

select results_eq(
  $$ select count(*)::bigint from public.agents where tenant_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2' $$,
  $$ values (0::bigint) $$,
  'admin cannot access another tenant agents'
);

select results_eq(
  $$ select count(*)::bigint from public.business_knowledge where tenant_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2' $$,
  $$ values (0::bigint) $$,
  'admin cannot access another tenant knowledge'
);

reset role;

select throws_ok(
  $sql$
    insert into public.conversations (
      id,
      tenant_id,
      agent_id,
      source,
      status,
      started_at
    )
    values (
      'dddddddd-2000-4000-8000-000000000001',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      'bbbbbbbb-0000-4000-8000-000000000001',
      'browser_test',
      'starting',
      '2026-08-06T16:00:00Z'::timestamptz
    )
  $sql$,
  '23503',
  'agent tenant must match conversation tenant'
);

insert into public.conversations (
  id,
  tenant_id,
  agent_id,
  source,
  status,
  started_at
)
values (
  'dddddddd-2000-4000-8000-000000000002',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  'aaaaaaaa-0000-4000-8000-000000000001',
  'browser_test',
  'active',
  '2026-08-06T16:05:00Z'::timestamptz
);

select throws_ok(
  $sql$
    insert into public.conversation_messages (
      id,
      tenant_id,
      conversation_id,
      sequence_number,
      role,
      content
    )
    values (
      'dddddddd-3000-4000-8000-000000000001',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
      'dddddddd-2000-4000-8000-000000000002',
      1,
      'user',
      'This should fail because the tenant does not match the conversation.'
    )
  $sql$,
  '23503',
  'message tenant must match conversation tenant'
);

insert into public.conversation_messages (
  id,
  tenant_id,
  conversation_id,
  sequence_number,
  role,
  content
)
values (
  'dddddddd-3000-4000-8000-000000000002',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  'dddddddd-2000-4000-8000-000000000002',
  1,
  'user',
  'First test message'
);

select throws_ok(
  $sql$
    insert into public.conversation_messages (
      id,
      tenant_id,
      conversation_id,
      sequence_number,
      role,
      content
    )
    values (
      'dddddddd-3000-4000-8000-000000000003',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      'dddddddd-2000-4000-8000-000000000002',
      1,
      'assistant',
      'This should fail because sequence 1 already exists.'
    )
  $sql$,
  '23505',
  'duplicate message sequence numbers are rejected'
);

select throws_ok(
  $sql$
    insert into public.conversations (
      id,
      tenant_id,
      agent_id,
      source,
      status,
      started_at
    )
    values (
      'dddddddd-2000-4000-8000-000000000003',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      'aaaaaaaa-0000-4000-8000-000000000001',
      'browser_test',
      'draft',
      '2026-08-06T16:15:00Z'::timestamptz
    )
  $sql$,
  '23514',
  'invalid statuses are rejected'
);

select throws_ok(
  $sql$
    insert into public.conversations (
      id,
      tenant_id,
      agent_id,
      source,
      status,
      started_at,
      ended_at,
      duration_ms
    )
    values (
      'dddddddd-2000-4000-8000-000000000004',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      'aaaaaaaa-0000-4000-8000-000000000001',
      'browser_test',
      'failed',
      '2026-08-06T16:20:00Z'::timestamptz,
      '2026-08-06T16:20:10Z'::timestamptz,
      -100
    )
  $sql$,
  '23514',
  'negative durations are rejected'
);

select * from finish();
rollback;
