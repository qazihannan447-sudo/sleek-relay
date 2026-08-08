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

insert into public.conversations (
  id,
  tenant_id,
  agent_id,
  source,
  status,
  started_at,
  ended_at,
  duration_ms,
  summary,
  outcome,
  end_reason,
  runtime_snapshot,
  latency_metrics,
  usage_metrics,
  metadata,
  error_code,
  error_message
)
values
  (
    'aaaaaaaa-2000-4000-8000-000000000001',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'aaaaaaaa-0000-4000-8000-000000000001',
    'browser_test',
    'completed',
    '2026-08-06T14:00:00Z'::timestamptz,
    '2026-08-06T14:04:12Z'::timestamptz,
    252000,
    'The agent explained new-patient availability and captured a callback request.',
    'message_captured',
    'user_finished',
    '{
      "agent_name":"Front Desk Assistant",
      "language":"en",
      "voice_id":"en-CA-friendly-1",
      "knowledge_version":"demo-seed-v1"
    }'::jsonb,
    '{
      "stt_first_partial_ms":380,
      "stt_final_ms":910,
      "llm_first_token_ms":1240,
      "tts_first_byte_ms":690
    }'::jsonb,
    '{
      "version":1,
      "llm":{
        "prompt_tokens":1840,
        "completion_tokens":620,
        "total_tokens":2460,
        "call_count":4,
        "model":"gemini-2.0-flash"
      },
      "tts":{
        "characters":980,
        "call_count":5,
        "model":"sonic-2"
      }
    }'::jsonb,
    '{
      "channel":"browser_test",
      "recording_supported":false,
      "requested_workflow":"new_patient_intake"
    }'::jsonb,
    null,
    null
  ),
  (
    'bbbbbbbb-2000-4000-8000-000000000001',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
    'bbbbbbbb-0000-4000-8000-000000000001',
    'browser_test',
    'failed',
    '2026-08-06T15:10:00Z'::timestamptz,
    '2026-08-06T15:11:27Z'::timestamptz,
    87000,
    'The agent started an intake flow but the session ended after a transient provider timeout.',
    'no_capture',
    'provider_timeout',
    '{
      "agent_name":"Care Intake Assistant",
      "language":"en",
      "voice_id":"en-CA-calm-2",
      "knowledge_version":"demo-seed-v1"
    }'::jsonb,
    '{
      "stt_first_partial_ms":420,
      "stt_final_ms":980,
      "llm_first_token_ms":2100,
      "tts_first_byte_ms":null
    }'::jsonb,
    '{
      "version":1,
      "llm":{
        "prompt_tokens":920,
        "completion_tokens":140,
        "total_tokens":1060,
        "call_count":2,
        "model":"gemini-2.0-flash"
      },
      "tts":{
        "characters":210,
        "call_count":1,
        "model":"sonic-2"
      }
    }'::jsonb,
    '{
      "channel":"browser_test",
      "recording_supported":false,
      "requested_workflow":"care_intake"
    }'::jsonb,
    'provider_timeout',
    'The assistant could not finish the response before the provider timeout window closed.'
  )
on conflict (id) do update
set
  tenant_id = excluded.tenant_id,
  agent_id = excluded.agent_id,
  source = excluded.source,
  status = excluded.status,
  started_at = excluded.started_at,
  ended_at = excluded.ended_at,
  duration_ms = excluded.duration_ms,
  summary = excluded.summary,
  outcome = excluded.outcome,
  end_reason = excluded.end_reason,
  runtime_snapshot = excluded.runtime_snapshot,
  latency_metrics = excluded.latency_metrics,
  usage_metrics = excluded.usage_metrics,
  metadata = excluded.metadata,
  error_code = excluded.error_code,
  error_message = excluded.error_message,
  updated_at = now();

insert into public.conversation_messages (
  id,
  tenant_id,
  conversation_id,
  sequence_number,
  role,
  content,
  is_final,
  interrupted,
  started_at,
  ended_at
)
values
  (
    'aaaaaaaa-3000-4000-8000-000000000001',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'aaaaaaaa-2000-4000-8000-000000000001',
    1,
    'user',
    'Hi, are you taking new dental patients next week?',
    true,
    false,
    '2026-08-06T14:00:07Z'::timestamptz,
    '2026-08-06T14:00:11Z'::timestamptz
  ),
  (
    'aaaaaaaa-3000-4000-8000-000000000002',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'aaaaaaaa-2000-4000-8000-000000000001',
    2,
    'assistant',
    'Yes, Greenleaf Dental is accepting new patients and I can help you request a callback.',
    false,
    true,
    '2026-08-06T14:00:13Z'::timestamptz,
    '2026-08-06T14:00:18Z'::timestamptz
  ),
  (
    'aaaaaaaa-3000-4000-8000-000000000003',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'aaaaaaaa-2000-4000-8000-000000000001',
    3,
    'user',
    'Please have someone call me tomorrow afternoon.',
    true,
    false,
    '2026-08-06T14:00:19Z'::timestamptz,
    '2026-08-06T14:00:22Z'::timestamptz
  ),
  (
    'aaaaaaaa-3000-4000-8000-000000000004',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'aaaaaaaa-2000-4000-8000-000000000001',
    4,
    'assistant',
    'I have noted your callback request for tomorrow afternoon. A team member will follow up during business hours.',
    true,
    false,
    '2026-08-06T14:00:23Z'::timestamptz,
    '2026-08-06T14:00:30Z'::timestamptz
  ),
  (
    'bbbbbbbb-3000-4000-8000-000000000001',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
    'bbbbbbbb-2000-4000-8000-000000000001',
    1,
    'user',
    'I need to arrange a home care intake visit for my father.',
    true,
    false,
    '2026-08-06T15:10:05Z'::timestamptz,
    '2026-08-06T15:10:09Z'::timestamptz
  ),
  (
    'bbbbbbbb-3000-4000-8000-000000000002',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
    'bbbbbbbb-2000-4000-8000-000000000001',
    2,
    'assistant',
    'I am sorry, the intake session could not be completed right now. Please try again or leave a callback request.',
    true,
    false,
    '2026-08-06T15:11:18Z'::timestamptz,
    '2026-08-06T15:11:25Z'::timestamptz
  )
on conflict (id) do update
set
  tenant_id = excluded.tenant_id,
  conversation_id = excluded.conversation_id,
  sequence_number = excluded.sequence_number,
  role = excluded.role,
  content = excluded.content,
  is_final = excluded.is_final,
  interrupted = excluded.interrupted,
  started_at = excluded.started_at,
  ended_at = excluded.ended_at;

-- Capture / handoff demo configuration (Phase A+)
-- Greenleaf Front Desk is the Finova-style demo agent: leads, messages,
-- appointment requests, and soft handoff are enabled. Other agents keep
-- capability defaults (all off) until an owner turns them on.
update public.business_configurations
set
  appointment_policy = 'We accept appointment requests only. A team member will confirm availability.',
  handoff_destination_type = 'callback',
  handoff_destination_value = '+1-555-0101',
  handoff_script = 'I can have someone from the Greenleaf team call you back. I have noted your request.',
  notification_email = 'owner+greenleaf@sleekrelay.demo',
  notification_whatsapp = '+15550101010',
  updated_at = now()
where tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';

update public.agents
set
  capabilities = '{
    "capture_leads": true,
    "capture_messages": true,
    "capture_appointments": true,
    "offer_handoff": true,
    "lead_fields": ["name", "phone", "email", "notes"],
    "message_fields": ["name", "phone", "email", "message"],
    "appointment_fields": ["name", "phone", "email", "preferred_time", "party", "notes"]
  }'::jsonb,
  updated_at = now()
where id = 'aaaaaaaa-0000-4000-8000-000000000001';

-- Demo close-off notification rows for the Notifications inbox
insert into public.conversation_notifications (
  tenant_id,
  conversation_id,
  agent_id,
  kind,
  channel,
  status,
  destination,
  subject,
  body,
  provider,
  created_at
)
select
  c.tenant_id,
  c.id,
  c.agent_id,
  'close_off',
  'whatsapp',
  'logged',
  '+15550101010',
  null,
  'Sleek Relay — post-call notification' || E'\n\n' ||
    'Outcome: ' || coalesce(c.outcome, 'Completed') || E'\n\n' ||
    'Summary: ' || coalesce(c.summary, 'Seeded demo conversation.') || E'\n\n' ||
    'Review: https://sleek-relay.vercel.app/dashboard/conversations?conversationId=' || c.id::text,
  'demo_log',
  coalesce(c.ended_at, c.started_at, now())
from public.conversations c
where c.tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  and c.status in ('completed', 'failed')
  and not exists (
    select 1
    from public.conversation_notifications n
    where n.conversation_id = c.id
      and n.kind = 'close_off'
  )
order by c.started_at desc
limit 3;
