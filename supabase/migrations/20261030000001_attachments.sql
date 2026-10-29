-- Files on record cards and in chats. The bytes are in Supabase Storage (bucket "attachments",
-- created by the server on first upload); this table holds who may see them. A file is visible to
-- whoever can see its record: the subqueries below run under the user's own row level security.

create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  entity text not null check (entity in ('company', 'contact', 'lead', 'deal', 'order', 'conversation')),
  entity_id uuid not null,
  chat_message_id uuid references public.chat_messages (id) on delete set null,
  file_name text not null check (char_length(file_name) between 1 and 255),
  content_type text not null check (char_length(content_type) between 1 and 127),
  size integer not null check (size >= 0),
  storage_key text not null check (char_length(storage_key) between 1 and 512),
  uploaded_by uuid references public.profiles (id) on delete set null,
  archived_at timestamptz,
  created_at timestamptz not null default now()
);

create index attachments_entity_idx on public.attachments (organization_id, entity, entity_id);
create index attachments_message_idx on public.attachments (chat_message_id);

create or replace function private.can_see_attachment_target(kind text, target uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select case kind
    when 'company' then exists (select 1 from public.companies where id = target)
    when 'contact' then exists (select 1 from public.contacts where id = target)
    when 'lead' then exists (select 1 from public.leads where id = target)
    when 'deal' then exists (select 1 from public.deals where id = target)
    when 'order' then exists (select 1 from public.orders where id = target)
    when 'conversation' then private.can_see_conversation(target)
    else false
  end;
$$;
grant execute on function private.can_see_attachment_target(text, uuid) to authenticated;

alter table public.attachments enable row level security;
create policy "read files of visible records" on public.attachments
  for select to authenticated
  using (organization_id = private.current_org_id() and private.can_see_attachment_target(entity, entity_id));
create policy "add files to visible records" on public.attachments
  for insert to authenticated
  with check (organization_id = private.current_org_id() and uploaded_by = (select auth.uid()) and private.can_see_attachment_target(entity, entity_id));
create policy "uploaders and admins archive files" on public.attachments
  for update to authenticated
  using (organization_id = private.current_org_id() and (uploaded_by = (select auth.uid()) or private.user_role() = 'admin'))
  with check (organization_id = private.current_org_id());
revoke update on public.attachments from authenticated;
grant update (archived_at) on public.attachments to authenticated;
