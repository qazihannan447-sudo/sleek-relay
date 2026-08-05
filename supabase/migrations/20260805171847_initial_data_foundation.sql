create extension if not exists pgcrypto;

create schema if not exists private;

revoke all on schema private from public;
revoke all on schema private from anon;

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = statement_timestamp();
  return new;
end;
$$;

create or replace function private.is_tenant_member(target_tenant_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null then
    return false;
  end if;

  return exists (
    select 1
    from public.tenant_memberships membership
    where membership.tenant_id = target_tenant_id
      and membership.user_id = current_user_id
  );
end;
$$;

create or replace function private.is_tenant_manager(target_tenant_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null then
    return false;
  end if;

  return exists (
    select 1
    from public.tenant_memberships membership
    where membership.tenant_id = target_tenant_id
      and membership.user_id = current_user_id
      and membership.role in ('owner', 'admin')
  );
end;
$$;

create or replace function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.user_profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      split_part(coalesce(new.email, ''), '@', 1),
      ''
    )
  )
  on conflict (id) do update
  set
    email = excluded.email,
    full_name = coalesce(public.user_profiles.full_name, excluded.full_name),
    updated_at = statement_timestamp();

  return new;
end;
$$;

revoke all on all functions in schema private from public;
revoke all on all functions in schema private from anon;
revoke all on function private.set_updated_at() from authenticated;
revoke all on function private.handle_new_auth_user() from authenticated;
grant usage on schema private to authenticated;
grant execute on function private.is_tenant_member(uuid) to authenticated;
grant execute on function private.is_tenant_manager(uuid) to authenticated;

create table public.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique,
  full_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_user_profiles_updated_at
  before update on public.user_profiles
  for each row execute function private.set_updated_at();

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_auth_user();

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_tenants_updated_at
  before update on public.tenants
  for each row execute function private.set_updated_at();

create table public.tenant_memberships (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);

create index tenant_memberships_user_id_idx
  on public.tenant_memberships (user_id);

create trigger set_tenant_memberships_updated_at
  before update on public.tenant_memberships
  for each row execute function private.set_updated_at();

create table public.business_configurations (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  business_name text not null,
  website text,
  business_phone text,
  category text,
  contact_name text,
  contact_email text,
  timezone text,
  business_hours jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_business_configurations_updated_at
  before update on public.business_configurations
  for each row execute function private.set_updated_at();

create table public.agents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  role text not null,
  language text not null default 'en',
  greeting text,
  status text not null default 'draft' check (status in ('draft', 'active', 'paused')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index agents_tenant_id_idx
  on public.agents (tenant_id);

create trigger set_agents_updated_at
  before update on public.agents
  for each row execute function private.set_updated_at();

grant select on public.user_profiles to authenticated;
grant update (full_name) on public.user_profiles to authenticated;
grant select on public.tenants to authenticated;
grant select on public.tenant_memberships to authenticated;
grant select, update on public.business_configurations to authenticated;
grant select, insert, update, delete on public.agents to authenticated;

grant all privileges on public.user_profiles to service_role;
grant all privileges on public.tenants to service_role;
grant all privileges on public.tenant_memberships to service_role;
grant all privileges on public.business_configurations to service_role;
grant all privileges on public.agents to service_role;

alter table public.user_profiles enable row level security;
alter table public.tenants enable row level security;
alter table public.tenant_memberships enable row level security;
alter table public.business_configurations enable row level security;
alter table public.agents enable row level security;

create policy "user_profiles_select_self"
  on public.user_profiles
  for select
  to authenticated
  using ((select auth.uid()) = id);

create policy "user_profiles_update_self"
  on public.user_profiles
  for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create policy "tenants_select_for_members"
  on public.tenants
  for select
  to authenticated
  using (private.is_tenant_member(id));

create policy "tenant_memberships_select_for_members"
  on public.tenant_memberships
  for select
  to authenticated
  using (private.is_tenant_member(tenant_id));

create policy "business_configurations_select_for_members"
  on public.business_configurations
  for select
  to authenticated
  using (private.is_tenant_member(tenant_id));

create policy "business_configurations_update_for_managers"
  on public.business_configurations
  for update
  to authenticated
  using (private.is_tenant_manager(tenant_id))
  with check (private.is_tenant_manager(tenant_id));

create policy "agents_select_for_members"
  on public.agents
  for select
  to authenticated
  using (private.is_tenant_member(tenant_id));

create policy "agents_insert_for_managers"
  on public.agents
  for insert
  to authenticated
  with check (private.is_tenant_manager(tenant_id));

create policy "agents_update_for_managers"
  on public.agents
  for update
  to authenticated
  using (private.is_tenant_manager(tenant_id))
  with check (private.is_tenant_manager(tenant_id));

create policy "agents_delete_for_managers"
  on public.agents
  for delete
  to authenticated
  using (private.is_tenant_manager(tenant_id));
