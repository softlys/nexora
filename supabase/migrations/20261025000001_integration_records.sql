-- What external services already delivered (calls, emails, chat messages, payments) and sync cursors,
-- so retried webhooks and re-read mailboxes never create records twice. Server (service role) only.

create table public.integration_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  source text not null check (char_length(source) between 1 and 40),
  external_id text not null check (char_length(external_id) between 1 and 255),
  entity_type text check (char_length(entity_type) <= 40),
  entity_id uuid,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, source, external_id)
);
create index integration_records_entity_idx on public.integration_records (organization_id, entity_type, entity_id);

alter table public.integration_records enable row level security;
revoke all on public.integration_records from authenticated, anon;

-- Chat messages (WhatsApp, Telegram) are a new activity type.
alter table public.activities drop constraint if exists activities_type_check;
alter table public.activities add constraint activities_type_check check (type in ('call', 'meeting', 'email', 'note', 'follow_up', 'message', 'system'));

-- Payments confirmed by YooKassa or Stripe are real (is_simulated = false).
alter table public.payments drop constraint if exists payments_is_simulated_check;
