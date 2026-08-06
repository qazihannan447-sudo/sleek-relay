alter table public.agents
  add column voice_id text,
  add column tone text,
  add column special_instructions text,
  add column fallback_message text,
  add column interruption_enabled boolean not null default true,
  add column silence_timeout_seconds integer not null default 8
    check (silence_timeout_seconds between 3 and 120),
  add column maximum_session_duration_seconds integer not null default 900
    check (maximum_session_duration_seconds between 60 and 7200);
