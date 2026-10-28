-- End-to-end analytics (сквозная аналитика): UTM tags on leads and deals, and advertising spend per
-- channel and month for cost per lead and ROI.

alter table public.leads add column utm jsonb check (utm is null or jsonb_typeof(utm) = 'object');
alter table public.deals add column utm jsonb check (utm is null or jsonb_typeof(utm) = 'object');
create index leads_utm_source_idx on public.leads ((utm ->> 'source'));

create table public.ad_spend (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  period text not null check (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  channel text not null check (char_length(channel) between 1 and 200),
  amount numeric(14, 2) not null check (amount >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, period, channel)
);

alter table public.ad_spend enable row level security;
create policy "members read ad spend" on public.ad_spend
  for select to authenticated using (organization_id = private.current_org_id());
create policy "admins and managers record ad spend" on public.ad_spend
  for all to authenticated
  using (organization_id = private.current_org_id() and private.user_role() in ('admin', 'manager'))
  with check (organization_id = private.current_org_id() and private.user_role() in ('admin', 'manager'));
