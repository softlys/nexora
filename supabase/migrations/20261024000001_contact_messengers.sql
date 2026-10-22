-- Messenger and social handles on contacts (Telegram, WhatsApp, Viber, Instagram, Facebook, VK,
-- LinkedIn, WeChat). Validated and normalized by the application (src/lib/messengers.ts);
-- the database keeps it an object of short strings.

alter table public.contacts
  add column messengers jsonb not null default '{}'::jsonb
  check (jsonb_typeof(messengers) = 'object' and pg_column_size(messengers) < 4096);
