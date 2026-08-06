create table public.business_knowledge (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  kind text not null check (
    kind in ('faq', 'policy', 'business_fact', 'service_information')
  ),
  title text not null,
  content text not null,
  status text not null default 'draft' check (
    status in ('draft', 'approved', 'disabled')
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index business_knowledge_tenant_id_idx
  on public.business_knowledge (tenant_id);

create index business_knowledge_tenant_status_idx
  on public.business_knowledge (tenant_id, status);

create trigger set_business_knowledge_updated_at
  before update on public.business_knowledge
  for each row execute function private.set_updated_at();

grant select, insert, update, delete on public.business_knowledge to authenticated;
grant all privileges on public.business_knowledge to service_role;

alter table public.business_knowledge enable row level security;

create policy "business_knowledge_select_for_members"
  on public.business_knowledge
  for select
  to authenticated
  using (private.is_tenant_member(tenant_id));

create policy "business_knowledge_insert_for_managers"
  on public.business_knowledge
  for insert
  to authenticated
  with check (private.is_tenant_manager(tenant_id));

create policy "business_knowledge_update_for_managers"
  on public.business_knowledge
  for update
  to authenticated
  using (private.is_tenant_manager(tenant_id))
  with check (private.is_tenant_manager(tenant_id));

create policy "business_knowledge_delete_for_managers"
  on public.business_knowledge
  for delete
  to authenticated
  using (private.is_tenant_manager(tenant_id));
