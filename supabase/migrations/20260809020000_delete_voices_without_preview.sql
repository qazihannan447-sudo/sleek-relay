-- Drop catalog voices that have no preview sample. Configure Voice only offers
-- voices with audio, and Cartesia does not provide previews for every English
-- voice. agents.voice_id is plain text (no FK), so this delete is safe.

delete from public.voices
where (preview_url is null or btrim(preview_url) = '')
  and (preview_storage_path is null or btrim(preview_storage_path) = '');
