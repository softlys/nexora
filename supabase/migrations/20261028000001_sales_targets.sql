-- Sales plan (план продаж): a monthly won-deal target per user. Everyone in the organization reads
-- targets (the KPI page shows a ranking); admins set any target, managers those of their team.

create table public.sales_targets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  period text not null check (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  amount numeric(14, 2) not null check (amount >= 0),
  deals integer check (deals >= 0),
  set_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, profile_id, period)
);

alter table public.sales_targets enable row level security;
create policy "members read sales targets" on public.sales_targets
  for select to authenticated using (organization_id = private.current_org_id());
create policy "managers set targets in scope" on public.sales_targets
  for all to authenticated
  using (organization_id = private.current_org_id() and private.user_role() in ('admin', 'manager') and private.can_see_owner(profile_id))
  with check (organization_id = private.current_org_id() and private.user_role() in ('admin', 'manager') and private.can_see_owner(profile_id));
