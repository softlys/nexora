-- Custom fields (свои поля) on companies, contacts, leads and deals: definitions per organization,
-- values on each record in a "custom" jsonb object keyed by the field key.

create table public.custom_fields (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  entity text not null check (entity in ('company', 'contact', 'lead', 'deal')),
  key text not null check (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  label text not null check (char_length(label) between 1 and 60),
  type text not null check (type in ('text', 'number', 'date', 'select', 'checkbox', 'url')),
  options jsonb not null default '[]'::jsonb check (jsonb_typeof(options) = 'array'),
  required boolean not null default false,
  position integer not null default 0 check (position between 0 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (organization_id, entity, key)
);

alter table public.custom_fields enable row level security;
create policy "members read custom fields" on public.custom_fields
  for select to authenticated using (organization_id = private.current_org_id());
create policy "admins manage custom fields" on public.custom_fields
  for all to authenticated
  using (organization_id = private.current_org_id() and private.is_admin())
  with check (organization_id = private.current_org_id() and private.is_admin());

alter table public.companies add column custom jsonb not null default '{}'::jsonb check (jsonb_typeof(custom) = 'object');
alter table public.contacts add column custom jsonb not null default '{}'::jsonb check (jsonb_typeof(custom) = 'object');
alter table public.leads add column custom jsonb not null default '{}'::jsonb check (jsonb_typeof(custom) = 'object');
alter table public.deals add column custom jsonb not null default '{}'::jsonb check (jsonb_typeof(custom) = 'object');
