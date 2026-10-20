-- Phase 4: outbound webhooks, public API keys and idempotency.

-- ---------------------------------------------------------------------------
-- Integrations: encrypted signing secret, one integration per provider
-- ---------------------------------------------------------------------------

-- HMAC signing needs the secret itself, so it is stored encrypted (AES-256-GCM with
-- NEXORA_ENCRYPTION_KEY, which lives only in the server environment). The hash stays for
-- recognition; the preview is the last four characters for the masked display.
alter table public.integration_settings
  add column secret_ciphertext text,
  add column secret_preview text check (secret_preview is null or char_length(secret_preview) <= 8);

create unique index integration_settings_provider_idx on public.integration_settings (organization_id, provider);

-- Neither the hash nor the ciphertext is readable by the client role.
revoke select on public.integration_settings from authenticated;
grant select (id, organization_id, provider, name, config, subscribed_events, enabled, last_tested_at, last_test_ok, last_error, secret_preview, created_at, updated_at)
  on public.integration_settings to authenticated;

-- ---------------------------------------------------------------------------
-- Webhook deliveries: why each attempt was made
-- ---------------------------------------------------------------------------

alter table public.webhook_deliveries
  add column reason text not null default 'event' check (reason in ('event', 'test', 'retry', 'redeliver'));
create index webhook_deliveries_retry_idx on public.webhook_deliveries (next_retry_at) where next_retry_at is not null;
create index webhook_deliveries_integration_event_idx on public.webhook_deliveries (integration_id, event_id);

-- Deliveries are written by the server (service role) only.
revoke insert, update, delete on public.webhook_deliveries from authenticated, anon;

-- ---------------------------------------------------------------------------
-- API keys: lookup by prefix for logging, hash for authentication
-- ---------------------------------------------------------------------------

create index api_keys_prefix_idx on public.api_keys (prefix);

-- ---------------------------------------------------------------------------
-- Idempotency-Key storage for POST requests to /api/v1 (24 hours)
-- ---------------------------------------------------------------------------

create table public.api_idempotency_keys (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  api_key_id uuid not null references public.api_keys (id) on delete cascade,
  key text not null check (char_length(key) between 1 and 200),
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  status_code integer not null,
  response_body jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  unique (api_key_id, key)
);
create index api_idempotency_keys_expiry_idx on public.api_idempotency_keys (expires_at);

-- Server-only table: RLS on, no policies for the client roles.
alter table public.api_idempotency_keys enable row level security;
revoke all on public.api_idempotency_keys from authenticated, anon;
