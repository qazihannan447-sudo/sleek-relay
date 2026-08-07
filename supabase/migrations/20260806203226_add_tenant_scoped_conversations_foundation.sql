alter table public.agents
  add constraint agents_tenant_id_id_key unique (tenant_id, id);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  agent_id uuid not null,
  source text not null default 'browser_test' check (btrim(source) <> ''),
  status text not null check (
    status in ('starting', 'active', 'completed', 'failed', 'cancelled')
  ),
  started_at timestamptz not null,
  ended_at timestamptz,
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  summary text,
  outcome text,
  end_reason text,
  runtime_snapshot jsonb not null default '{}'::jsonb,
  latency_metrics jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint conversations_tenant_id_fkey
    foreign key (tenant_id) references public.tenants(id) on delete cascade,
  constraint conversations_agent_same_tenant_fkey
    foreign key (tenant_id, agent_id) references public.agents(tenant_id, id),
  constraint conversations_tenant_id_id_key unique (tenant_id, id),
  constraint conversations_ended_after_started_check check (
    ended_at is null or ended_at >= started_at
  )
);

create index conversations_tenant_started_at_desc_idx
  on public.conversations (tenant_id, started_at desc);

create index conversations_tenant_agent_idx
  on public.conversations (tenant_id, agent_id);

create index conversations_tenant_status_idx
  on public.conversations (tenant_id, status);

create trigger set_conversations_updated_at
  before update on public.conversations
  for each row execute function private.set_updated_at();

create table public.conversation_messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  conversation_id uuid not null,
  sequence_number integer not null check (sequence_number > 0),
  role text not null check (role in ('user', 'assistant', 'system', 'tool')),
  content text not null check (btrim(content) <> ''),
  is_final boolean not null default true,
  interrupted boolean not null default false,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  constraint conversation_messages_tenant_id_fkey
    foreign key (tenant_id) references public.tenants(id) on delete cascade,
  constraint conversation_messages_conversation_same_tenant_fkey
    foreign key (tenant_id, conversation_id)
    references public.conversations(tenant_id, id)
    on delete cascade,
  constraint conversation_messages_ended_after_started_check check (
    started_at is null or ended_at is null or ended_at >= started_at
  )
);

create unique index conversation_messages_conversation_sequence_idx
  on public.conversation_messages (conversation_id, sequence_number);

grant select on public.conversations to authenticated;
grant select on public.conversation_messages to authenticated;

grant all privileges on public.conversations to service_role;
grant all privileges on public.conversation_messages to service_role;

alter table public.conversations enable row level security;
alter table public.conversation_messages enable row level security;

create policy "conversations_select_for_members"
  on public.conversations
  for select
  to authenticated
  using (private.is_tenant_member(tenant_id));

create policy "conversation_messages_select_for_members"
  on public.conversation_messages
  for select
  to authenticated
  using (private.is_tenant_member(tenant_id));
