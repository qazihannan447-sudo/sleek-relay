-- Phase A: business handoff/appointment settings, agent capabilities,
-- and conversation_captures foundation (persistence used from Phase B).

alter table public.business_configurations
  add column appointment_policy text,
  add column handoff_destination_type text not null default 'none',
  add column handoff_destination_value text,
  add column handoff_script text,
  add column notification_email text;

alter table public.business_configurations
  add constraint business_configurations_handoff_destination_type_check
  check (
    handoff_destination_type in ('none', 'callback', 'phone_info', 'email_info')
  );

alter table public.agents
  add column capabilities jsonb not null default '{
    "capture_leads": false,
    "capture_messages": false,
    "capture_appointments": false,
    "offer_handoff": false,
    "lead_fields": ["name", "phone", "email", "notes"],
    "message_fields": ["name", "phone", "email", "message"],
    "appointment_fields": ["name", "phone", "email", "preferred_time", "party", "notes"]
  }'::jsonb;

alter table public.agents
  add constraint agents_capabilities_object_check
  check (jsonb_typeof(capabilities) = 'object');

create table public.conversation_captures (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  conversation_id uuid not null,
  agent_id uuid not null,
  capture_type text not null check (
    capture_type in (
      'lead',
      'message',
      'appointment_request',
      'handoff_request'
    )
  ),
  status text not null check (status in ('captured', 'requested')),
  payload jsonb not null default '{}'::jsonb,
  idempotency_key text,
  created_at timestamptz not null default now(),
  constraint conversation_captures_tenant_id_fkey
    foreign key (tenant_id) references public.tenants(id) on delete cascade,
  constraint conversation_captures_conversation_same_tenant_fkey
    foreign key (tenant_id, conversation_id)
    references public.conversations(tenant_id, id)
    on delete cascade,
  constraint conversation_captures_agent_same_tenant_fkey
    foreign key (tenant_id, agent_id)
    references public.agents(tenant_id, id),
  constraint conversation_captures_status_matches_type_check check (
    (
      capture_type in ('lead', 'message')
      and status = 'captured'
    )
    or (
      capture_type in ('appointment_request', 'handoff_request')
      and status = 'requested'
    )
  ),
  constraint conversation_captures_payload_object_check
    check (jsonb_typeof(payload) = 'object')
);

create unique index conversation_captures_conversation_idempotency_uidx
  on public.conversation_captures (conversation_id, idempotency_key)
  where idempotency_key is not null;

create index conversation_captures_tenant_created_at_desc_idx
  on public.conversation_captures (tenant_id, created_at desc);

create index conversation_captures_conversation_created_at_idx
  on public.conversation_captures (conversation_id, created_at);

grant select on public.conversation_captures to authenticated;
grant all privileges on public.conversation_captures to service_role;

alter table public.conversation_captures enable row level security;

create policy "conversation_captures_select_for_members"
  on public.conversation_captures
  for select
  to authenticated
  using (private.is_tenant_member(tenant_id));
