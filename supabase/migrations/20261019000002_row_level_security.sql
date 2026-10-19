-- NEXORA row-level security.
--
-- Mirrors src/domain/permissions.ts:
--   sales_rep  sees and edits records they own
--   manager    sees and edits their own records and those of profiles that report to them
--   admin      sees and edits everything in the organization
-- Every policy is also scoped to the caller's organization. Helper functions live in the
-- `private` schema, which is not exposed through the Data API.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function private.current_org_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select organization_id from public.profiles where id = (select auth.uid()) and is_active and archived_at is null
$$;

create or replace function private.user_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.profiles where id = (select auth.uid()) and is_active and archived_at is null
$$;

-- Ids whose records the caller may see: everyone (null = no restriction) for admin,
-- self + direct reports for manager, self for sales rep.
create or replace function private.visible_owner_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select case private.user_role()
    when 'admin' then null
    when 'manager' then array(
      select id from public.profiles
      where organization_id = private.current_org_id() and (id = (select auth.uid()) or manager_id = (select auth.uid()))
    )
    when 'sales_rep' then array[(select auth.uid())]
    else array[]::uuid[]
  end
$$;

create or replace function private.can_see_owner(owner uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when private.user_role() = 'admin' then true
    when owner is null then false
    else owner = any (private.visible_owner_ids())
  end
$$;

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.user_role() = 'admin', false)
$$;

create or replace function private.is_manager_or_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.user_role() in ('admin', 'manager'), false)
$$;

-- Visibility of a polymorphic record (used by comments).
create or replace function private.can_see_entity(kind text, entity uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case kind
    when 'company' then exists (select 1 from public.companies c where c.id = entity and c.organization_id = private.current_org_id() and private.can_see_owner(c.owner_id))
    when 'contact' then exists (select 1 from public.contacts c where c.id = entity and c.organization_id = private.current_org_id() and private.can_see_owner(c.owner_id))
    when 'lead' then exists (select 1 from public.leads l where l.id = entity and l.organization_id = private.current_org_id() and private.can_see_owner(l.owner_id))
    when 'deal' then exists (select 1 from public.deals d where d.id = entity and d.organization_id = private.current_org_id() and private.can_see_owner(d.owner_id))
    when 'order' then exists (select 1 from public.orders o where o.id = entity and o.organization_id = private.current_org_id() and private.can_see_owner(o.owner_id))
    when 'task' then exists (select 1 from public.tasks t where t.id = entity and t.organization_id = private.current_org_id() and private.can_see_owner(t.assignee_id))
    else false
  end
$$;

revoke all on schema private from public;
grant usage on schema private to authenticated;
grant execute on all functions in schema private to authenticated;

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere. Tables without a policy for an operation deny it.
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'organizations', 'profiles', 'companies', 'contacts', 'leads', 'pipeline_stages', 'deals', 'deal_stage_history',
    'products', 'orders', 'order_items', 'payments', 'tasks', 'activities', 'comments', 'notifications',
    'automation_workflows', 'automation_executions', 'integration_settings', 'webhook_deliveries', 'api_keys', 'audit_logs'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Organization and profiles
-- ---------------------------------------------------------------------------

create policy "members read their organization" on public.organizations
  for select to authenticated using (id = private.current_org_id());
create policy "admins update their organization" on public.organizations
  for update to authenticated using (id = private.current_org_id() and private.is_admin())
  with check (id = private.current_org_id());

create policy "members read profiles in their organization" on public.profiles
  for select to authenticated using (organization_id = private.current_org_id());
create policy "users update their own profile" on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
-- Only name and title are writable directly. Role changes go through change_profile_role().
revoke update on public.profiles from authenticated;
grant update (full_name, title) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- Owned CRM records: companies, contacts, leads, deals, orders, tasks
-- ---------------------------------------------------------------------------

do $$
declare
  spec text[];
  t text;
  owner_col text;
begin
  foreach spec slice 1 in array array[
    array['companies', 'owner_id'],
    array['contacts', 'owner_id'],
    array['leads', 'owner_id'],
    array['deals', 'owner_id'],
    array['orders', 'owner_id'],
    array['tasks', 'assignee_id']
  ]
  loop
    t := spec[1];
    owner_col := spec[2];
    execute format(
      'create policy "read owned records in scope" on public.%I for select to authenticated
         using (organization_id = private.current_org_id() and private.can_see_owner(%I))',
      t, owner_col);
    execute format(
      'create policy "create owned records in scope" on public.%I for insert to authenticated
         with check (organization_id = private.current_org_id() and private.can_see_owner(%I))',
      t, owner_col);
    execute format(
      'create policy "update owned records in scope" on public.%I for update to authenticated
         using (organization_id = private.current_org_id() and private.can_see_owner(%I))
         with check (organization_id = private.current_org_id() and private.can_see_owner(%I))',
      t, owner_col, owner_col);
    execute format(
      'create policy "admins hard delete" on public.%I for delete to authenticated
         using (organization_id = private.current_org_id() and private.is_admin())',
      t);
  end loop;
end;
$$;

-- Unassigned leads (owner_id is null) are visible to managers and admins so they can be routed.
create policy "managers read unassigned leads" on public.leads
  for select to authenticated using (organization_id = private.current_org_id() and owner_id is null and private.is_manager_or_admin());

-- ---------------------------------------------------------------------------
-- Records visible through a parent
-- ---------------------------------------------------------------------------

create policy "read history of visible deals" on public.deal_stage_history
  for select to authenticated using (
    organization_id = private.current_org_id()
    and exists (select 1 from public.deals d where d.id = deal_id and private.can_see_owner(d.owner_id))
  );
create policy "record history on visible deals" on public.deal_stage_history
  for insert to authenticated with check (
    organization_id = private.current_org_id()
    and changed_by = (select auth.uid())
    and exists (select 1 from public.deals d where d.id = deal_id and private.can_see_owner(d.owner_id))
  );

create policy "read items of visible orders" on public.order_items
  for select to authenticated using (
    organization_id = private.current_org_id()
    and exists (select 1 from public.orders o where o.id = order_id and private.can_see_owner(o.owner_id))
  );
create policy "write items of visible orders" on public.order_items
  for all to authenticated
  using (organization_id = private.current_org_id() and exists (select 1 from public.orders o where o.id = order_id and private.can_see_owner(o.owner_id)))
  with check (organization_id = private.current_org_id() and exists (select 1 from public.orders o where o.id = order_id and private.can_see_owner(o.owner_id)));

create policy "read payments of visible orders" on public.payments
  for select to authenticated using (
    organization_id = private.current_org_id()
    and exists (select 1 from public.orders o where o.id = order_id and private.can_see_owner(o.owner_id))
  );
-- Simulated payments are append-only for non-admins.
create policy "record payments on visible orders" on public.payments
  for insert to authenticated with check (
    organization_id = private.current_org_id()
    and recorded_by = (select auth.uid())
    and exists (select 1 from public.orders o where o.id = order_id and private.can_see_owner(o.owner_id))
  );

create policy "read activities in scope" on public.activities
  for select to authenticated using (
    organization_id = private.current_org_id()
    and (
      private.can_see_owner(actor_id)
      or (deal_id is not null and private.can_see_entity('deal', deal_id))
      or (company_id is not null and private.can_see_entity('company', company_id))
      or (order_id is not null and private.can_see_entity('order', order_id))
      or (lead_id is not null and private.can_see_entity('lead', lead_id))
    )
  );
create policy "log own activities" on public.activities
  for insert to authenticated with check (organization_id = private.current_org_id() and actor_id = (select auth.uid()));

create policy "read comments on visible records" on public.comments
  for select to authenticated using (
    organization_id = private.current_org_id()
    and (author_id = (select auth.uid()) or private.can_see_entity(entity_type, entity_id))
  );
create policy "comment on visible records" on public.comments
  for insert to authenticated with check (
    organization_id = private.current_org_id() and author_id = (select auth.uid()) and private.can_see_entity(entity_type, entity_id)
  );
create policy "edit own comments" on public.comments
  for update to authenticated using (author_id = (select auth.uid())) with check (author_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Organization-wide reference data
-- ---------------------------------------------------------------------------

create policy "members read pipeline stages" on public.pipeline_stages
  for select to authenticated using (organization_id = private.current_org_id());
-- Stage writes go through the admin-only functions in the next migration.

create policy "members read products" on public.products
  for select to authenticated using (organization_id = private.current_org_id());
create policy "managers manage products" on public.products
  for all to authenticated
  using (organization_id = private.current_org_id() and private.is_manager_or_admin())
  with check (organization_id = private.current_org_id() and private.is_manager_or_admin());

-- ---------------------------------------------------------------------------
-- Personal notifications
-- ---------------------------------------------------------------------------

create policy "users read their notifications" on public.notifications
  for select to authenticated using (recipient_id = (select auth.uid()));
create policy "users mark their notifications read" on public.notifications
  for update to authenticated using (recipient_id = (select auth.uid())) with check (recipient_id = (select auth.uid()));
revoke update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;

-- ---------------------------------------------------------------------------
-- Automation and integrations (managers read, admins configure integrations)
-- ---------------------------------------------------------------------------

create policy "managers read workflows" on public.automation_workflows
  for select to authenticated using (organization_id = private.current_org_id() and private.is_manager_or_admin());
create policy "managers manage workflows" on public.automation_workflows
  for all to authenticated
  using (organization_id = private.current_org_id() and private.is_manager_or_admin())
  with check (organization_id = private.current_org_id() and private.is_manager_or_admin());

create policy "managers read executions" on public.automation_executions
  for select to authenticated using (organization_id = private.current_org_id() and private.is_manager_or_admin());

create policy "managers read integrations" on public.integration_settings
  for select to authenticated using (organization_id = private.current_org_id() and private.is_manager_or_admin());
create policy "admins manage integrations" on public.integration_settings
  for all to authenticated
  using (organization_id = private.current_org_id() and private.is_admin())
  with check (organization_id = private.current_org_id() and private.is_admin());
-- The secret hash never needs to leave the server: column-level grants exclude it.
revoke select on public.integration_settings from authenticated;
grant select (id, organization_id, provider, name, config, subscribed_events, enabled, last_tested_at, last_test_ok, last_error, created_at, updated_at)
  on public.integration_settings to authenticated;

create policy "managers read deliveries" on public.webhook_deliveries
  for select to authenticated using (organization_id = private.current_org_id() and private.is_manager_or_admin());

create policy "admins read api keys" on public.api_keys
  for select to authenticated using (organization_id = private.current_org_id() and private.is_admin());
create policy "admins manage api keys" on public.api_keys
  for all to authenticated
  using (organization_id = private.current_org_id() and private.is_admin())
  with check (organization_id = private.current_org_id() and private.is_admin());
-- Key hashes are only compared on the server.
revoke select on public.api_keys from authenticated;
grant select (id, organization_id, name, kind, prefix, scopes, created_by, last_used_at, revoked_at, created_at, updated_at)
  on public.api_keys to authenticated;

-- ---------------------------------------------------------------------------
-- Audit log: append-only for the application, readable by admins
-- ---------------------------------------------------------------------------

create policy "users append their own audit entries" on public.audit_logs
  for insert to authenticated with check (organization_id = private.current_org_id() and actor_id = (select auth.uid()));
create policy "admins read audit log" on public.audit_logs
  for select to authenticated using (organization_id = private.current_org_id() and private.is_admin());
revoke update, delete on public.audit_logs from authenticated, anon;

-- The anon role reads nothing.
revoke all on all tables in schema public from anon;
