-- Demo-stage notifications are inbox-only for now.
-- Outbound WhatsApp / email delivery will be added later.

alter table public.conversation_notifications
  drop constraint if exists conversation_notifications_channel_check;

alter table public.conversation_notifications
  add constraint conversation_notifications_channel_check
  check (channel in ('inbox', 'whatsapp', 'email'));

alter table public.conversation_notifications
  alter column destination drop not null;

update public.conversation_notifications
set
  channel = 'inbox',
  destination = 'Business inbox',
  status = 'logged',
  provider = 'demo_log',
  subject = null,
  error_message = null,
  provider_message_id = null
where kind = 'close_off';
