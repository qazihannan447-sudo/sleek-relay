insert into auth.users (id, email, raw_user_meta_data)
values
  (
    '11111111-1111-4111-8111-111111111111',
    'owner+greenleaf@sleekrelay.demo',
    '{"full_name":"Ava Green"}'::jsonb
  ),
  (
    '22222222-2222-4222-8222-222222222222',
    'owner+harbor@sleekrelay.demo',
    '{"full_name":"Owen Harbor"}'::jsonb
  ),
  (
    '33333333-3333-4333-8333-333333333333',
    'owner+northstar@sleekrelay.demo',
    '{"full_name":"Mina Northstar"}'::jsonb
  )
on conflict (id) do update
set
  email = excluded.email,
  raw_user_meta_data = excluded.raw_user_meta_data,
  updated_at = now();

insert into public.tenants (id, slug, name)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'greenleaf-dental', 'Greenleaf Dental'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 'harbor-home-care', 'Harbor Home Care'),
  ('cccccccc-cccc-4ccc-8ccc-ccccccccccc3', 'northstar-fitness', 'Northstar Fitness')
on conflict (id) do update
set
  slug = excluded.slug,
  name = excluded.name,
  updated_at = now();

insert into public.tenant_memberships (tenant_id, user_id, role)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', '11111111-1111-4111-8111-111111111111', 'owner'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', '22222222-2222-4222-8222-222222222222', 'owner'),
  ('cccccccc-cccc-4ccc-8ccc-ccccccccccc3', '33333333-3333-4333-8333-333333333333', 'owner')
on conflict (tenant_id, user_id) do update
set
  role = excluded.role,
  updated_at = now();

insert into public.business_configurations (
  tenant_id,
  business_name,
  website,
  business_phone,
  category,
  contact_name,
  contact_email,
  timezone,
  business_hours
)
values
  (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'Greenleaf Dental',
    'https://greenleaf.example.com',
    '+1-555-0101',
    'Dental Clinic',
    'Ava Green',
    'owner+greenleaf@sleekrelay.demo',
    'America/Toronto',
    '{
      "mon":{"closed":false,"open":"09:00","close":"17:00"},
      "tue":{"closed":false,"open":"09:00","close":"17:00"},
      "wed":{"closed":false,"open":"09:00","close":"17:00"},
      "thu":{"closed":false,"open":"09:00","close":"17:00"},
      "fri":{"closed":false,"open":"09:00","close":"17:00"},
      "sat":{"closed":false,"open":"09:00","close":"13:00"},
      "sun":{"closed":true,"open":null,"close":null}
    }'::jsonb
  ),
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
    'Harbor Home Care',
    'https://harbor.example.com',
    '+1-555-0102',
    'Home Care',
    'Owen Harbor',
    'owner+harbor@sleekrelay.demo',
    'America/Toronto',
    '{
      "mon":{"closed":false,"open":"08:00","close":"18:00"},
      "tue":{"closed":false,"open":"08:00","close":"18:00"},
      "wed":{"closed":false,"open":"08:00","close":"18:00"},
      "thu":{"closed":false,"open":"08:00","close":"18:00"},
      "fri":{"closed":false,"open":"08:00","close":"18:00"},
      "sat":{"closed":true,"open":null,"close":null},
      "sun":{"closed":true,"open":null,"close":null}
    }'::jsonb
  ),
  (
    'cccccccc-cccc-4ccc-8ccc-ccccccccccc3',
    'Northstar Fitness',
    'https://northstar.example.com',
    '+1-555-0103',
    'Fitness Studio',
    'Mina Northstar',
    'owner+northstar@sleekrelay.demo',
    'America/Toronto',
    '{
      "mon":{"closed":false,"open":"06:00","close":"21:00"},
      "tue":{"closed":false,"open":"06:00","close":"21:00"},
      "wed":{"closed":false,"open":"06:00","close":"21:00"},
      "thu":{"closed":false,"open":"06:00","close":"21:00"},
      "fri":{"closed":false,"open":"06:00","close":"21:00"},
      "sat":{"closed":false,"open":"08:00","close":"18:00"},
      "sun":{"closed":false,"open":"08:00","close":"18:00"}
    }'::jsonb
  )
on conflict (tenant_id) do update
set
  business_name = excluded.business_name,
  website = excluded.website,
  business_phone = excluded.business_phone,
  category = excluded.category,
  contact_name = excluded.contact_name,
  contact_email = excluded.contact_email,
  timezone = excluded.timezone,
  business_hours = excluded.business_hours,
  updated_at = now();

insert into public.agents (id, tenant_id, name, role, language, greeting, status)
values
  (
    'aaaaaaaa-0000-4000-8000-000000000001',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'Front Desk Assistant',
    'Reception',
    'en',
    'Thank you for calling Greenleaf Dental. How can I help today?',
    'active'
  ),
  (
    'aaaaaaaa-0000-4000-8000-000000000002',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'After Hours Assistant',
    'After Hours',
    'en',
    'You have reached Greenleaf Dental after hours. How can I assist?',
    'draft'
  ),
  (
    'bbbbbbbb-0000-4000-8000-000000000001',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
    'Care Intake Assistant',
    'Intake',
    'en',
    'Welcome to Harbor Home Care. How may I assist you today?',
    'active'
  ),
  (
    'cccccccc-0000-4000-8000-000000000001',
    'cccccccc-cccc-4ccc-8ccc-ccccccccccc3',
    'Member Support Assistant',
    'Support',
    'en',
    'Welcome to Northstar Fitness. How can I help?',
    'active'
  )
on conflict (id) do update
set
  tenant_id = excluded.tenant_id,
  name = excluded.name,
  role = excluded.role,
  language = excluded.language,
  greeting = excluded.greeting,
  status = excluded.status,
  updated_at = now();

insert into public.business_knowledge (
  id,
  tenant_id,
  kind,
  title,
  content,
  status
)
values
  (
    'aaaaaaaa-1000-4000-8000-000000000001',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'faq',
    'Do you accept new patients?',
    'Greenleaf Dental is currently accepting new patients for routine dental care.',
    'approved'
  ),
  (
    'aaaaaaaa-1000-4000-8000-000000000002',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'policy',
    'Appointment cancellation policy',
    'Patients should provide at least 24 hours notice when cancelling an appointment.',
    'approved'
  ),
  (
    'bbbbbbbb-1000-4000-8000-000000000001',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
    'service_information',
    'Home care intake visits',
    'Harbor Home Care offers in-home intake visits for eligible clients in the local coverage area.',
    'approved'
  ),
  (
    'bbbbbbbb-1000-4000-8000-000000000002',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
    'business_fact',
    'Weekend service note',
    'Weekend intake scheduling is handled by callback request only.',
    'draft'
  ),
  (
    'cccccccc-1000-4000-8000-000000000001',
    'cccccccc-cccc-4ccc-8ccc-ccccccccccc3',
    'faq',
    'Do you offer trial classes?',
    'Northstar Fitness offers one introductory class for new members by request.',
    'approved'
  )
on conflict (id) do update
set
  tenant_id = excluded.tenant_id,
  kind = excluded.kind,
  title = excluded.title,
  content = excluded.content,
  status = excluded.status,
  updated_at = now();
