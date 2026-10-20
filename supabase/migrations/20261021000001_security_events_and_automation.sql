-- Phase 3: tamper-evident security log and automation scheduling fields.

-- ---------------------------------------------------------------------------
-- security_events: append-only, hash-chained per organization
-- ---------------------------------------------------------------------------

create table public.security_events (
  event_id uuid primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  sequence bigint not null check (sequence >= 1),
  occurred_at timestamptz not null,
  category text not null check (category in ('authentication', 'authorization', 'configuration', 'data_access', 'integration', 'automation', 'system')),
  action text not null,
  outcome text not null check (outcome in ('success', 'failure', 'unknown')),
  severity text not null check (severity in ('info', 'low', 'medium', 'high')),
  actor jsonb not null,
  source jsonb not null,
  target jsonb not null,
  metadata jsonb not null default '{}'::jsonb,
  prev_hash text not null check (prev_hash ~ '^[a-f0-9]{64}$'),
  hash text not null check (hash ~ '^[a-f0-9]{64}$'),
  -- One chain per organization: concurrent writers collide here and retry.
  unique (organization_id, sequence)
);
create index security_events_org_time_idx on public.security_events (organization_id, occurred_at desc);
create index security_events_org_action_idx on public.security_events (organization_id, action);

alter table public.security_events enable row level security;

-- Insert by members of the organization; the application writes through the service role,
-- which bypasses RLS, because some events have no session (failed login, cron).
create policy "members append security events" on public.security_events
  for insert to authenticated with check (organization_id = private.current_org_id());
create policy "admins read security events" on public.security_events
  for select to authenticated using (organization_id = private.current_org_id() and private.is_admin());

-- Append-only: no client role may change or remove events.
revoke update, delete, truncate on public.security_events from authenticated, anon;

-- ---------------------------------------------------------------------------
-- Automation: delayed steps are resumed by the scheduler
-- ---------------------------------------------------------------------------

alter table public.automation_executions
  add column resume_at timestamptz,
  add column resume_step_id text;
create index automation_executions_resume_idx on public.automation_executions (resume_at) where resume_at is not null;

-- ---------------------------------------------------------------------------
-- Team: disable / re-enable members (admin only, never the last active admin)
-- ---------------------------------------------------------------------------

create or replace function public.set_profile_active(target_profile_id uuid, active boolean)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid := private.current_org_id();
  target public.profiles;
begin
  if not private.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into target from public.profiles where id = target_profile_id and organization_id = org and archived_at is null for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if not active and target.role = 'admin'
     and (select count(*) from public.profiles where organization_id = org and role = 'admin' and is_active and archived_at is null and id <> target.id) = 0 then
    raise exception 'last_admin' using errcode = 'P0001';
  end if;
  update public.profiles set is_active = active where id = target.id returning * into target;
  return target;
end;
$$;

revoke execute on function public.set_profile_active(uuid, boolean) from public, anon;
grant execute on function public.set_profile_active(uuid, boolean) to authenticated;
