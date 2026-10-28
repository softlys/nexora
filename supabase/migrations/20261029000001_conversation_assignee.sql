-- Inbox: each conversation can be assigned to the manager who answers it. Existing chats go to the
-- owner of their contact or lead.

alter table public.conversations add column assignee_id uuid references public.profiles (id) on delete set null;

update public.conversations c
set assignee_id = coalesce(
  (select owner_id from public.contacts where id = c.contact_id),
  (select owner_id from public.leads where id = c.lead_id)
);

create index conversations_assignee_idx on public.conversations (organization_id, assignee_id);
