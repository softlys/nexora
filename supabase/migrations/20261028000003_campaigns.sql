-- Mass mailings (рассылки) by e-mail or SMS to a segment of contacts. Admins and managers create and
-- send them; everyone in the organization can read the results.

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  channel text not null check (channel in ('email', 'sms')),
  subject text not null default '' check (char_length(subject) <= 200),
  body text not null check (char_length(body) between 1 and 10000),
  segment jsonb not null default '{}'::jsonb check (jsonb_typeof(segment) = 'object'),
  status text not null default 'draft' check (status in ('draft', 'sent')),
  total integer not null default 0,
  sent integer not null default 0,
  failed integer not null default 0,
  skipped integer not null default 0,
  simulated boolean not null default false,
  created_by uuid references public.profiles (id),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.campaigns enable row level security;
create policy "members read campaigns" on public.campaigns
  for select to authenticated using (organization_id = private.current_org_id());
create policy "admins and managers run campaigns" on public.campaigns
  for all to authenticated
  using (organization_id = private.current_org_id() and private.user_role() in ('admin', 'manager'))
  with check (organization_id = private.current_org_id() and private.user_role() in ('admin', 'manager'));
