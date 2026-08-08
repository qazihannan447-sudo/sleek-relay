-- Shared Cartesia voice preview audio files live in Supabase Storage so the
-- portal does not depend on Cartesia's temporary preview_file_url links at
-- play time. These samples are public vendor demos, not tenant secrets.

alter table public.voices
  add column if not exists preview_storage_path text;

comment on column public.voices.preview_storage_path is
  'Object path inside the voice-previews storage bucket (e.g. {voice_id}.mp3).';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'voice-previews',
  'voice-previews',
  true,
  5242880,
  array['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/ogg', 'application/octet-stream']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Public read: preview samples are Cartesia's shared demos.
drop policy if exists "voice_previews_public_read" on storage.objects;
create policy "voice_previews_public_read"
  on storage.objects
  for select
  to public
  using (bucket_id = 'voice-previews');

-- Writes/updates/deletes stay service-role only (no authenticated insert policy).
drop policy if exists "voice_previews_service_role_write" on storage.objects;
create policy "voice_previews_service_role_write"
  on storage.objects
  for all
  to service_role
  using (bucket_id = 'voice-previews')
  with check (bucket_id = 'voice-previews');
