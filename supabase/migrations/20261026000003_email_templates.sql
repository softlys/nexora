-- E-mail templates for writing to customers from record pages. Members read, admins manage.

create table public.email_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  subject text not null check (char_length(subject) between 1 and 200),
  body text not null check (char_length(body) between 1 and 10000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create index email_templates_org_idx on public.email_templates (organization_id) where archived_at is null;

alter table public.email_templates enable row level security;
create policy "members read email templates" on public.email_templates
  for select to authenticated using (organization_id = private.current_org_id());
create policy "admins manage email templates" on public.email_templates
  for all to authenticated
  using (organization_id = private.current_org_id() and private.is_admin())
  with check (organization_id = private.current_org_id() and private.is_admin());

-- Every existing organization starts with the default templates (as new demo stores do).
insert into public.email_templates (organization_id, name, subject, body)
select o.id, t.name, t.subject, t.body
from public.organizations o
cross join (values
  ('Introduction', '{{company.name}} and {{me.name}}: next steps', E'Hello {{contact.first_name}},\n\nThank you for your time today. As discussed, I am sending a short summary and the next steps.\n\nBest regards,\n{{me.name}}\n{{me.title}}'),
  ('Follow-up', 'Following up: {{deal.name}}', E'Hello {{contact.first_name}},\n\nI wanted to follow up on {{deal.name}}. Do you have any questions, or is there anything I can prepare for you?\n\nBest regards,\n{{me.name}}'),
  ('Commercial offer', 'Commercial offer for {{company.name}}', E'Hello {{contact.first_name}},\n\nPlease find our offer for {{deal.name}} below. The total is {{deal.amount}}.\n\nI am happy to go through it on a call.\n\nBest regards,\n{{me.name}}\n{{me.email}}')
) as t (name, subject, body);
