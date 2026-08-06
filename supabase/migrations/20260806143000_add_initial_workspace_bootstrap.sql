create or replace function private.slugify_workspace_name(source text)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    nullif(
      trim(both '-' from regexp_replace(lower(coalesce(source, '')), '[^a-z0-9]+', '-', 'g')),
      ''
    ),
    'workspace'
  );
$$;

create or replace function public.create_initial_workspace(
  workspace_name text,
  business_name text,
  category_name text default null,
  timezone_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  normalized_workspace_name text := trim(coalesce(workspace_name, ''));
  normalized_business_name text := trim(coalesce(business_name, ''));
  normalized_category text := nullif(trim(coalesce(category_name, '')), '');
  normalized_timezone text := nullif(trim(coalesce(timezone_name, '')), '');
  new_tenant_id uuid := gen_random_uuid();
  base_slug text;
  candidate_slug text;
  suffix integer := 0;
begin
  if current_user_id is null then
    raise exception 'authenticated user required';
  end if;

  if normalized_workspace_name = '' then
    raise exception 'workspace name is required';
  end if;

  if normalized_business_name = '' then
    raise exception 'business name is required';
  end if;

  if exists (
    select 1
    from public.tenant_memberships membership
    where membership.user_id = current_user_id
  ) then
    raise exception 'workspace already exists for current user';
  end if;

  insert into public.user_profiles (id, email, full_name)
  select
    auth_user.id,
    auth_user.email,
    coalesce(
      nullif(trim(coalesce(auth_user.raw_user_meta_data ->> 'full_name', '')), ''),
      nullif(trim(coalesce(auth_user.raw_user_meta_data ->> 'name', '')), ''),
      split_part(coalesce(auth_user.email, ''), '@', 1),
      ''
    )
  from auth.users auth_user
  where auth_user.id = current_user_id
  on conflict (id) do nothing;

  if not exists (
    select 1
    from public.user_profiles profile
    where profile.id = current_user_id
  ) then
    raise exception 'user profile not available';
  end if;

  base_slug := private.slugify_workspace_name(normalized_workspace_name);
  candidate_slug := base_slug;

  while exists (
    select 1
    from public.tenants tenant
    where tenant.slug = candidate_slug
  ) loop
    suffix := suffix + 1;
    candidate_slug := base_slug || '-' || suffix::text;
  end loop;

  insert into public.tenants (id, slug, name)
  values (new_tenant_id, candidate_slug, normalized_workspace_name);

  insert into public.tenant_memberships (tenant_id, user_id, role)
  values (new_tenant_id, current_user_id, 'owner');

  insert into public.business_configurations (
    tenant_id,
    business_name,
    category,
    timezone,
    business_hours
  )
  values (
    new_tenant_id,
    normalized_business_name,
    normalized_category,
    normalized_timezone,
    '{"mon":{"open":null,"close":null,"closed":true},"tue":{"open":null,"close":null,"closed":true},"wed":{"open":null,"close":null,"closed":true},"thu":{"open":null,"close":null,"closed":true},"fri":{"open":null,"close":null,"closed":true},"sat":{"open":null,"close":null,"closed":true},"sun":{"open":null,"close":null,"closed":true}}'::jsonb
  );

  return new_tenant_id;
end;
$$;

revoke all on function public.create_initial_workspace(text, text, text, text) from public;
revoke all on function public.create_initial_workspace(text, text, text, text) from anon;
grant execute on function public.create_initial_workspace(text, text, text, text) to authenticated;
