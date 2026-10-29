-- CRM forms for websites: each submission becomes a lead. Admins manage them; everyone in the
-- organization can read them. Submissions come in through the server (service role).

create table public.web_forms (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  title text not null check (char_length(title) between 1 and 160),
  button_text text not null check (char_length(button_text) between 1 and 60),
  success_text text not null check (char_length(success_text) between 1 and 500),
  fields jsonb not null default '{}'::jsonb check (jsonb_typeof(fields) = 'object'),
  owner_id uuid references public.profiles (id) on delete set null,
  is_active boolean not null default true,
  submissions integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index web_forms_org_idx on public.web_forms (organization_id);

alter table public.web_forms enable row level security;
create policy "members read web forms" on public.web_forms
  for select to authenticated using (organization_id = private.current_org_id());
create policy "admins manage web forms" on public.web_forms
  for all to authenticated
  using (organization_id = private.current_org_id() and private.user_role() = 'admin')
  with check (organization_id = private.current_org_id() and private.user_role() = 'admin');
