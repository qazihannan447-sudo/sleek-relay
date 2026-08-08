-- Phase 3 humanization: richer Cartesia voice metadata + curated agent shortlist.
-- Recommended IDs follow Cartesia's current stable production-agent guidance for
-- previewable catalog rows. Carson is intentionally omitted until a single variant
-- is auditioned. Daniel is omitted until a preview sample exists.

alter table public.voices
  add column if not exists description text,
  add column if not exists country text,
  add column if not exists accent text,
  add column if not exists recommended_for_agent boolean not null default false,
  add column if not exists featured_rank integer,
  add column if not exists last_seen_at timestamptz;

create index if not exists voices_recommended_for_agent_idx
  on public.voices (recommended_for_agent, featured_rank, name);

-- Clear previous curation, then seed the stable shortlist.
update public.voices
set
  recommended_for_agent = false,
  featured_rank = null,
  updated_at = now();

update public.voices as voices
set
  recommended_for_agent = true,
  featured_rank = shortlist.featured_rank,
  updated_at = now()
from (
  values
    ('f786b574-daa5-4673-aa0c-cbe3e8534c02', 1), -- Katie
    ('db6b0ed5-d5d3-463d-ae85-518a07d3c2b4', 2), -- Skylar
    ('9626c31c-bec5-4cca-baa8-f8ba9e84c8bc', 3), -- Jacqueline
    ('a5136bf9-224c-4d76-b823-52bd5efcffcc', 4), -- Jameson
    ('5ee9feff-1265-424a-9d7f-8e4d431a12c7', 5), -- Ronald
    ('62ae83ad-4f6a-430b-af41-a9bede9286ca', 6), -- Gemma
    ('ef191366-f52f-447a-a398-ed8c0f2943a1', 7), -- Archie
    ('e8e5fffb-252c-436d-b842-8879b84445b6', 8), -- Cathy
    ('f9836c6e-a0bd-460e-9d3c-f7299fa60f94', 9)  -- Caroline
) as shortlist(id, featured_rank)
where voices.id = shortlist.id;
