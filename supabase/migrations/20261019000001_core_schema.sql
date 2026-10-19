-- NEXORA core schema.
-- Every business table carries organization_id. Core relations use composite foreign keys
-- (id, organization_id) so a row can never point at a record in another organization.
-- Soft delete uses archived_at. updated_at is maintained by a trigger.

-- gen_random_uuid() is built into PostgreSQL 13+, no extension needed.

create schema if not exists private;

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Organizations and people
-- ---------------------------------------------------------------------------

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,60}$'),
  currency char(3) not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  locale text not null default 'en-US',
  timezone text not null default 'UTC',
  settings jsonb not null default '{"order_conversion_mode": "draft"}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  full_name text not null check (char_length(full_name) between 1 and 120),
  email text not null,
  role text not null default 'sales_rep' check (role in ('admin', 'manager', 'sales_rep')),
  title text not null default '',
  manager_id uuid,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (id, organization_id),
  foreign key (manager_id, organization_id) references public.profiles (id, organization_id) on delete set null (manager_id)
);
create index profiles_organization_idx on public.profiles (organization_id);
create index profiles_manager_idx on public.profiles (manager_id);

-- ---------------------------------------------------------------------------
-- CRM
-- ---------------------------------------------------------------------------

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 160),
  website text,
  industry text not null,
  size text not null check (size in ('1-10', '11-50', '51-200', '201-500', '501-1000', '1000+')),
  country char(2) not null check (country ~ '^[A-Z]{2}$'),
  city text not null default '',
  address text not null default '',
  phone text,
  lifecycle_stage text not null default 'prospect' check (lifecycle_stage in ('prospect', 'customer', 'partner', 'churned')),
  owner_id uuid not null,
  notes text not null default '' check (char_length(notes) <= 5000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (id, organization_id),
  foreign key (owner_id, organization_id) references public.profiles (id, organization_id)
);
create index companies_org_owner_idx on public.companies (organization_id, owner_id) where archived_at is null;
create index companies_org_name_idx on public.companies (organization_id, lower(name));

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  company_id uuid,
  first_name text not null,
  last_name text not null,
  email text,
  phone text,
  job_title text not null default '',
  owner_id uuid not null,
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (id, organization_id),
  foreign key (company_id, organization_id) references public.companies (id, organization_id) on delete set null (company_id),
  foreign key (owner_id, organization_id) references public.profiles (id, organization_id)
);
create index contacts_org_owner_idx on public.contacts (organization_id, owner_id) where archived_at is null;
create index contacts_company_idx on public.contacts (company_id);

create table public.pipeline_stages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  position integer not null check (position >= 0),
  probability integer not null check (probability between 0 and 100),
  is_won boolean not null default false,
  is_lost boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  constraint pipeline_stages_position_unique unique (organization_id, position) deferrable initially deferred,
  check (not (is_won and is_lost))
);
create unique index pipeline_stages_name_unique on public.pipeline_stages (organization_id, lower(name));

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  title text not null,
  company_name text not null,
  contact_name text not null,
  email text,
  phone text,
  country char(2),
  source text not null check (source in ('website', 'referral', 'trade_show', 'outbound', 'partner', 'inbound_call', 'api')),
  status text not null default 'new' check (status in ('new', 'contacted', 'qualified', 'unqualified', 'converted')),
  qualification text not null default 'cold' check (qualification in ('cold', 'warm', 'hot')),
  owner_id uuid,
  next_action text not null default '',
  next_action_at timestamptz,
  estimated_value numeric(14, 2) not null default 0 check (estimated_value >= 0),
  currency char(3) not null default 'USD',
  company_id uuid,
  contact_id uuid,
  converted_deal_id uuid unique,
  converted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (id, organization_id),
  foreign key (owner_id, organization_id) references public.profiles (id, organization_id) on delete set null (owner_id),
  foreign key (company_id, organization_id) references public.companies (id, organization_id) on delete set null (company_id),
  foreign key (contact_id, organization_id) references public.contacts (id, organization_id) on delete set null (contact_id),
  check (status <> 'converted' or converted_at is not null)
);
create index leads_org_owner_idx on public.leads (organization_id, owner_id) where archived_at is null;
create index leads_org_status_idx on public.leads (organization_id, status);

create table public.deals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 160),
  company_id uuid not null,
  primary_contact_id uuid,
  amount numeric(14, 2) not null default 0 check (amount >= 0),
  currency char(3) not null default 'USD',
  stage_id uuid not null,
  probability integer not null check (probability between 0 and 100),
  expected_close_date date,
  owner_id uuid not null,
  source text not null check (source in ('website', 'referral', 'trade_show', 'outbound', 'partner', 'inbound_call', 'api')),
  next_activity text not null default '',
  notes text not null default '' check (char_length(notes) <= 5000),
  lost_reason text,
  stage_entered_at timestamptz not null default now(),
  closed_at timestamptz,
  lead_id uuid unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (id, organization_id),
  foreign key (company_id, organization_id) references public.companies (id, organization_id),
  foreign key (primary_contact_id, organization_id) references public.contacts (id, organization_id) on delete set null (primary_contact_id),
  foreign key (stage_id, organization_id) references public.pipeline_stages (id, organization_id),
  foreign key (owner_id, organization_id) references public.profiles (id, organization_id),
  foreign key (lead_id, organization_id) references public.leads (id, organization_id) on delete set null (lead_id)
);
create index deals_org_owner_idx on public.deals (organization_id, owner_id) where archived_at is null;
create index deals_org_stage_idx on public.deals (organization_id, stage_id) where archived_at is null;
create index deals_company_idx on public.deals (company_id);
create index deals_close_date_idx on public.deals (organization_id, expected_close_date);

alter table public.leads
  add foreign key (converted_deal_id, organization_id) references public.deals (id, organization_id) on delete set null (converted_deal_id);

create table public.deal_stage_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  deal_id uuid not null,
  from_stage_id uuid,
  to_stage_id uuid not null,
  changed_by uuid,
  changed_at timestamptz not null default now(),
  foreign key (deal_id, organization_id) references public.deals (id, organization_id) on delete cascade,
  foreign key (from_stage_id, organization_id) references public.pipeline_stages (id, organization_id),
  foreign key (to_stage_id, organization_id) references public.pipeline_stages (id, organization_id),
  foreign key (changed_by, organization_id) references public.profiles (id, organization_id) on delete set null (changed_by)
);
create index deal_stage_history_deal_idx on public.deal_stage_history (deal_id, changed_at);
create index deal_stage_history_org_time_idx on public.deal_stage_history (organization_id, changed_at);

-- ---------------------------------------------------------------------------
-- Commerce
-- ---------------------------------------------------------------------------

create table public.products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  sku text not null check (sku ~ '^[A-Z0-9-]{3,32}$'),
  name text not null,
  category text not null,
  description text not null default '',
  unit_price numeric(14, 2) not null check (unit_price >= 0),
  currency char(3) not null default 'USD',
  tax_rate numeric(5, 2) not null default 0 check (tax_rate between 0 and 100),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (id, organization_id),
  unique (organization_id, sku)
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  order_number text not null check (order_number ~ '^NX-[0-9]{4}-[0-9]{4,}$'),
  company_id uuid not null,
  -- One order per deal: makes deal-to-order conversion idempotent.
  source_deal_id uuid unique,
  status text not null default 'draft' check (status in ('draft', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled')),
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid', 'partially_paid', 'paid', 'overdue')),
  fulfillment_status text not null default 'unfulfilled' check (fulfillment_status in ('unfulfilled', 'partially_fulfilled', 'fulfilled', 'returned')),
  currency char(3) not null default 'USD',
  subtotal numeric(14, 2) not null default 0 check (subtotal >= 0),
  discount_total numeric(14, 2) not null default 0 check (discount_total >= 0),
  tax_total numeric(14, 2) not null default 0 check (tax_total >= 0),
  total numeric(14, 2) not null default 0 check (total >= 0),
  order_date date not null default current_date,
  payment_due_date date,
  expected_delivery_date date,
  delivered_at timestamptz,
  owner_id uuid not null,
  notes text not null default '' check (char_length(notes) <= 5000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (id, organization_id),
  unique (organization_id, order_number),
  foreign key (company_id, organization_id) references public.companies (id, organization_id),
  foreign key (source_deal_id, organization_id) references public.deals (id, organization_id) on delete set null (source_deal_id),
  foreign key (owner_id, organization_id) references public.profiles (id, organization_id)
);
create index orders_org_owner_idx on public.orders (organization_id, owner_id) where archived_at is null;
create index orders_org_status_idx on public.orders (organization_id, status);
create index orders_company_idx on public.orders (company_id);
create index orders_org_date_idx on public.orders (organization_id, order_date);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  order_id uuid not null,
  product_id uuid,
  description text not null,
  quantity numeric(14, 3) not null check (quantity > 0),
  unit_price numeric(14, 2) not null check (unit_price >= 0),
  discount_pct numeric(5, 2) not null default 0 check (discount_pct between 0 and 100),
  tax_rate numeric(5, 2) not null default 0 check (tax_rate between 0 and 100),
  line_total numeric(14, 2) not null check (line_total >= 0),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (order_id, organization_id) references public.orders (id, organization_id) on delete cascade,
  foreign key (product_id, organization_id) references public.products (id, organization_id) on delete set null (product_id)
);
create index order_items_order_idx on public.order_items (order_id, position);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  order_id uuid not null,
  amount numeric(14, 2) not null check (amount > 0),
  currency char(3) not null default 'USD',
  paid_at timestamptz not null default now(),
  method text not null check (method in ('bank_transfer', 'card', 'other')),
  reference text not null default '',
  -- NEXORA never processes real payments.
  is_simulated boolean not null default true check (is_simulated),
  recorded_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (order_id, organization_id) references public.orders (id, organization_id) on delete cascade,
  foreign key (recorded_by, organization_id) references public.profiles (id, organization_id) on delete set null (recorded_by)
);
create index payments_order_idx on public.payments (order_id);
create index payments_org_paid_idx on public.payments (organization_id, paid_at);

-- ---------------------------------------------------------------------------
-- Work management
-- ---------------------------------------------------------------------------

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  description text not null default '' check (char_length(description) <= 5000),
  type text not null default 'todo' check (type in ('follow_up', 'call', 'email', 'meeting', 'todo')),
  assignee_id uuid not null,
  created_by uuid,
  due_at timestamptz,
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high', 'urgent')),
  status text not null default 'todo' check (status in ('todo', 'in_progress', 'done', 'cancelled')),
  completed_at timestamptz,
  company_id uuid,
  contact_id uuid,
  deal_id uuid,
  order_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (id, organization_id),
  foreign key (assignee_id, organization_id) references public.profiles (id, organization_id),
  foreign key (created_by, organization_id) references public.profiles (id, organization_id) on delete set null (created_by),
  foreign key (company_id, organization_id) references public.companies (id, organization_id) on delete set null (company_id),
  foreign key (contact_id, organization_id) references public.contacts (id, organization_id) on delete set null (contact_id),
  foreign key (deal_id, organization_id) references public.deals (id, organization_id) on delete set null (deal_id),
  foreign key (order_id, organization_id) references public.orders (id, organization_id) on delete set null (order_id)
);
create index tasks_org_assignee_idx on public.tasks (organization_id, assignee_id) where archived_at is null;
create index tasks_org_due_idx on public.tasks (organization_id, due_at) where status in ('todo', 'in_progress');
create index tasks_deal_idx on public.tasks (deal_id);

create table public.activities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  type text not null check (type in ('call', 'meeting', 'email', 'note', 'follow_up', 'system')),
  subject text not null,
  body text not null default '' check (char_length(body) <= 5000),
  occurred_at timestamptz not null default now(),
  actor_id uuid,
  company_id uuid,
  contact_id uuid,
  lead_id uuid,
  deal_id uuid,
  order_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (actor_id, organization_id) references public.profiles (id, organization_id) on delete set null (actor_id),
  foreign key (company_id, organization_id) references public.companies (id, organization_id) on delete cascade,
  foreign key (contact_id, organization_id) references public.contacts (id, organization_id) on delete set null (contact_id),
  foreign key (lead_id, organization_id) references public.leads (id, organization_id) on delete cascade,
  foreign key (deal_id, organization_id) references public.deals (id, organization_id) on delete cascade,
  foreign key (order_id, organization_id) references public.orders (id, organization_id) on delete cascade
);
create index activities_org_time_idx on public.activities (organization_id, occurred_at desc);
create index activities_deal_idx on public.activities (deal_id, occurred_at desc);
create index activities_company_idx on public.activities (company_id, occurred_at desc);
create index activities_contact_idx on public.activities (contact_id, occurred_at desc);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  entity_type text not null check (entity_type in ('company', 'contact', 'lead', 'deal', 'order', 'task')),
  entity_id uuid not null,
  author_id uuid not null,
  body text not null check (char_length(body) between 1 and 5000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  foreign key (author_id, organization_id) references public.profiles (id, organization_id)
);
create index comments_entity_idx on public.comments (organization_id, entity_type, entity_id, created_at);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  recipient_id uuid not null,
  type text not null,
  title text not null,
  body text not null default '',
  link text check (link is null or link ~ '^/[A-Za-z0-9/_?=&.-]*$'),
  read_at timestamptz,
  dedupe_key text,
  created_at timestamptz not null default now(),
  foreign key (recipient_id, organization_id) references public.profiles (id, organization_id) on delete cascade,
  unique (organization_id, dedupe_key)
);
create index notifications_recipient_idx on public.notifications (recipient_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Automation, integrations, security
-- ---------------------------------------------------------------------------

create table public.automation_workflows (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  description text not null default '',
  trigger_type text not null,
  definition jsonb not null default '{}'::jsonb,
  enabled boolean not null default false,
  version integer not null default 1 check (version >= 1),
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (id, organization_id),
  foreign key (created_by, organization_id) references public.profiles (id, organization_id) on delete set null (created_by),
  foreign key (updated_by, organization_id) references public.profiles (id, organization_id) on delete set null (updated_by)
);
create index automation_workflows_trigger_idx on public.automation_workflows (organization_id, trigger_type) where enabled;

create table public.automation_executions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  workflow_id uuid not null,
  workflow_version integer not null,
  event_id text not null,
  idempotency_key text not null,
  trigger_payload jsonb not null default '{}'::jsonb,
  status text not null check (status in ('running', 'success', 'failed', 'skipped')),
  steps jsonb not null default '[]'::jsonb,
  causation_depth integer not null default 0,
  retry_of uuid references public.automation_executions (id) on delete set null,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  duration_ms integer,
  created_at timestamptz not null default now(),
  foreign key (workflow_id, organization_id) references public.automation_workflows (id, organization_id) on delete cascade,
  -- A repeated event returns the earlier execution instead of running again.
  unique (organization_id, idempotency_key)
);
create index automation_executions_workflow_idx on public.automation_executions (workflow_id, started_at desc);

create table public.integration_settings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  provider text not null check (provider in ('make', 'n8n', 'generic_webhook', 'email')),
  name text not null,
  config jsonb not null default '{}'::jsonb,
  secret_hash text,
  subscribed_events text[] not null default '{}',
  enabled boolean not null default false,
  last_tested_at timestamptz,
  last_test_ok boolean,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id)
);

create table public.webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  integration_id uuid not null,
  event_id text not null,
  event_type text not null,
  url text not null,
  attempt integer not null default 1 check (attempt between 1 and 10),
  status text not null check (status in ('pending', 'success', 'failed')),
  status_code integer,
  duration_ms integer,
  request_body jsonb not null default '{}'::jsonb,
  response_excerpt text,
  error text,
  next_retry_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (integration_id, organization_id) references public.integration_settings (id, organization_id) on delete cascade
);
create index webhook_deliveries_integration_idx on public.webhook_deliveries (integration_id, created_at desc);
create index webhook_deliveries_event_idx on public.webhook_deliveries (organization_id, event_id);

create table public.api_keys (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  kind text not null default 'integration' check (kind in ('integration', 'siem')),
  prefix text not null,
  -- SHA-256 of the key. The key itself is shown once and never stored.
  key_hash text not null unique check (key_hash ~ '^[a-f0-9]{64}$'),
  scopes text[] not null check (cardinality(scopes) between 1 and 16),
  created_by uuid,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (created_by, organization_id) references public.profiles (id, organization_id) on delete set null (created_by)
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  actor_id uuid,
  actor_role text,
  action text not null,
  target_type text not null,
  target_id text,
  changes jsonb not null default '{}'::jsonb,
  ip text,
  user_agent text,
  request_id text,
  created_at timestamptz not null default now()
);
create index audit_logs_org_time_idx on public.audit_logs (organization_id, created_at desc);
create index audit_logs_target_idx on public.audit_logs (organization_id, target_type, target_id);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'organizations', 'profiles', 'companies', 'contacts', 'leads', 'pipeline_stages', 'deals', 'products',
    'orders', 'order_items', 'payments', 'tasks', 'activities', 'comments', 'automation_workflows',
    'integration_settings', 'api_keys'
  ]
  loop
    execute format(
      'create trigger set_updated_at before update on public.%I for each row execute function private.set_updated_at()',
      t
    );
  end loop;
end;
$$;
