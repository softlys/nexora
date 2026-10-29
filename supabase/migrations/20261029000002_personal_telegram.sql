-- Personal Telegram notifications: the chat a team member linked with the CRM's bot, and when each
-- notification was sent there. Both are written by the server (webhook and scheduler), not by users.

alter table public.profiles add column telegram_chat_id text check (telegram_chat_id ~ '^-?[0-9]{1,20}$');
alter table public.notifications add column pushed_at timestamptz;

create index notifications_unpushed_idx on public.notifications (organization_id, created_at) where pushed_at is null;
