-- Allow one close-off notification row per channel (inbox + email).

drop index if exists public.conversation_notifications_close_off_uidx;

create unique index conversation_notifications_close_off_channel_uidx
  on public.conversation_notifications (conversation_id, channel)
  where kind = 'close_off';
