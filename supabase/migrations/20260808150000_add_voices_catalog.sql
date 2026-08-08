-- Shared TTS voice catalog (Cartesia). Not tenant-scoped: every tenant's
-- agents pick from the same shared list. Refreshed by
-- supabase/scripts/fetch-cartesia-voices.mjs, which writes a follow-up
-- migration with the actual rows -- this migration only creates the table.

create table public.voices (
  id text primary key,
  name text not null,
  gender text check (gender in ('masculine', 'feminine', 'gender_neutral')),
  tagline text,
  language text not null default 'en',
  preview_url text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index voices_enabled_idx on public.voices (enabled);

create trigger set_voices_updated_at
  before update on public.voices
  for each row execute function private.set_updated_at();

grant select on public.voices to authenticated;
grant all privileges on public.voices to service_role;

alter table public.voices enable row level security;

create policy "voices_select_enabled_for_authenticated"
  on public.voices
  for select
  to authenticated
  using (enabled = true);
