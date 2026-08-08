-- Reinterpret idle_end_seconds as total call-ending silence timeout
-- (was previously "additional wait after check-in").
-- Convert rows that are invalid under the new rule ask-at < ending timeout.
update public.agents
set idle_end_seconds = idle_check_in_seconds + idle_end_seconds
where idle_end_seconds <= idle_check_in_seconds;

alter table public.agents
  alter column idle_end_seconds set default 60;

alter table public.agents
  drop constraint if exists agents_idle_end_seconds_check;

alter table public.agents
  add constraint agents_idle_end_seconds_check
    check (idle_end_seconds between 16 and 300);

alter table public.agents
  drop constraint if exists agents_idle_check_in_before_end;

alter table public.agents
  add constraint agents_idle_check_in_before_end
    check (idle_check_in_seconds < idle_end_seconds);
