-- Close-off notifications are email-only via Resend.
-- Remove legacy inbox close-off rows and tighten the channel check.

delete from public.conversation_notifications
where kind = 'close_off'
  and channel = 'inbox';

alter table public.conversation_notifications
  drop constraint if exists conversation_notifications_channel_check;

alter table public.conversation_notifications
  add constraint conversation_notifications_channel_check
  check (channel in ('email', 'whatsapp'));
