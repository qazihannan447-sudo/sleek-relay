alter table public.agents
  add column idle_timeout_enabled boolean not null default true,
  add column idle_check_in_seconds integer not null default 30
    check (idle_check_in_seconds between 15 and 300),
  add column idle_end_seconds integer not null default 60
    check (idle_end_seconds between 16 and 300),
  add constraint agents_idle_check_in_before_end
    check (idle_check_in_seconds < idle_end_seconds),
  add column idle_check_in_message text not null default 'Hello, are you there?'
    check (char_length(idle_check_in_message) between 1 and 200);
