-- Unified inbox: customer chats from Telegram, WhatsApp, VK and the website chat, with replies sent
-- from NEXORA. Conversations are visible to whoever can see the linked contact or lead. Incoming
-- messages are written by the server (service role); users add replies to conversations they can see.

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  channel text not null check (channel in ('telegram', 'whatsapp', 'vk', 'site')),
  external_id text not null check (char_length(external_id) between 1 and 255),
  title text not null check (char_length(title) between 1 and 160),
  contact_id uuid references public.contacts (id) on delete set null,
  lead_id uuid references public.leads (id) on delete set null,
  status text not null default 'open' check (status in ('open', 'closed')),
  unread boolean not null default true,
  last_message_at timestamptz not null default now(),
  last_message_preview text not null default '' check (char_length(last_message_preview) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, channel, external_id)
);
create index conversations_recent_idx on public.conversations (organization_id, last_message_at desc);

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  direction text not null check (direction in ('in', 'out')),
  body text not null check (char_length(body) between 1 and 4096),
  author_id uuid references public.profiles (id),
  external_id text check (char_length(external_id) <= 255),
  created_at timestamptz not null default now()
);
create index chat_messages_conversation_idx on public.chat_messages (conversation_id, created_at);

create or replace function private.can_see_conversation(conversation uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.conversations c
    where c.id = conversation
      and c.organization_id = private.current_org_id()
      and (
        private.user_role() = 'admin'
        or (c.contact_id is not null and private.can_see_entity('contact', c.contact_id))
        or (c.lead_id is not null and private.can_see_entity('lead', c.lead_id))
      )
  );
$$;
grant execute on function private.can_see_conversation(uuid) to authenticated;

alter table public.conversations enable row level security;
alter table public.chat_messages enable row level security;

create policy "read visible conversations" on public.conversations
  for select to authenticated using (private.can_see_conversation(id));
create policy "update visible conversations" on public.conversations
  for update to authenticated using (private.can_see_conversation(id)) with check (organization_id = private.current_org_id());

create policy "read messages of visible conversations" on public.chat_messages
  for select to authenticated using (organization_id = private.current_org_id() and private.can_see_conversation(conversation_id));
create policy "reply in visible conversations" on public.chat_messages
  for insert to authenticated with check (
    organization_id = private.current_org_id()
    and direction = 'out'
    and author_id = (select auth.uid())
    and private.can_see_conversation(conversation_id)
  );
