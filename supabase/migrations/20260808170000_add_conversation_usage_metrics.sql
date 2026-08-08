-- Provider usage metering for conversation cost / analytics (LLM tokens, TTS chars).
alter table public.conversations
  add column if not exists usage_metrics jsonb not null default '{}'::jsonb;

comment on column public.conversations.usage_metrics is
  'Session usage metering snapshot (LLM tokens, TTS characters). Empty until the voice worker records MetricsFrame totals.';
