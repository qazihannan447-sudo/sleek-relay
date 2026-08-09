-- Ask message time must sit between half and three-quarters of the
-- call ending timeout. Ending timeout minimum rises to 30s so the band
-- stays usable.

with normalized as (
  select
    id,
    greatest(idle_end_seconds, 30) as ending_seconds
  from public.agents
)
update public.agents as agents
set
  idle_end_seconds = normalized.ending_seconds,
  idle_check_in_seconds = least(
    greatest(
      agents.idle_check_in_seconds,
      ceil(normalized.ending_seconds::numeric / 2)
    ),
    floor(normalized.ending_seconds::numeric * 3 / 4)
  )
from normalized
where agents.id = normalized.id;

alter table public.agents
  drop constraint if exists agents_idle_end_seconds_check;

alter table public.agents
  add constraint agents_idle_end_seconds_check
    check (idle_end_seconds between 30 and 300);

alter table public.agents
  drop constraint if exists agents_idle_check_in_before_end;

alter table public.agents
  drop constraint if exists agents_idle_check_in_seconds_check;

alter table public.agents
  add constraint agents_idle_ask_at_half_to_three_quarters
    check (
      idle_check_in_seconds >= ceil(idle_end_seconds::numeric / 2)
      and idle_check_in_seconds <= floor(idle_end_seconds::numeric * 3 / 4)
    );
