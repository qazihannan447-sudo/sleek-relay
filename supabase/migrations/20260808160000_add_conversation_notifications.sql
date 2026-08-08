-- Demo-stage post-call notification log (WhatsApp / email close-off).
-- Outbound WhatsApp uses Green API when configured; rows are always tenant-scoped.

alter table public.business_configurations
  add column notification_whatsapp text;

create table public.conversation_notifications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  conversation_id uuid not null,
  agent_id uuid not null,
  kind text not null check (kind in ('close_off')),
  channel text not null check (channel in ('whatsapp', 'email')),
  status text not null check (status in ('sent', 'failed', 'logged')),
  destination text not null,
  subject text,
  body text not null,
  provider text,
  provider_message_id text,
  error_message text,
  created_at timestamptz not null default now(),
  constraint conversation_notifications_tenant_id_fkey
    foreign key (tenant_id) references public.tenants(id) on delete cascade,
  constraint conversation_notifications_conversation_same_tenant_fkey
    foreign key (tenant_id, conversation_id)
    references public.conversations(tenant_id, id)
    on delete cascade,
  constraint conversation_notifications_agent_same_tenant_fkey
    foreign key (tenant_id, agent_id)
    references public.agents(tenant_id, id)
);

create unique index conversation_notifications_close_off_uidx
  on public.conversation_notifications (conversation_id)
  where kind = 'close_off';

create index conversation_notifications_tenant_created_at_desc_idx
  on public.conversation_notifications (tenant_id, created_at desc);

create index conversation_notifications_conversation_created_at_idx
  on public.conversation_notifications (conversation_id, created_at);

grant select on public.conversation_notifications to authenticated;
grant all privileges on public.conversation_notifications to service_role;

alter table public.conversation_notifications enable row level security;

create policy "conversation_notifications_select_for_members"
  on public.conversation_notifications
  for select
  to authenticated
  using (private.is_tenant_member(tenant_id));
