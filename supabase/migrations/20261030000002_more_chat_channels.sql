-- Inbox: Avito Messenger and Instagram Direct conversations.

alter table public.conversations drop constraint conversations_channel_check;
alter table public.conversations add constraint conversations_channel_check
  check (channel in ('telegram', 'whatsapp', 'vk', 'avito', 'instagram', 'site'));
