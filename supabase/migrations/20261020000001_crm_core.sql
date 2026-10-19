-- Phase 2: CRM core helpers.

-- Order numbers are unique per organization, but RLS hides other users' orders, so the
-- application cannot compute the next number from what it can see. This function looks
-- at every order in the caller's organization. Concurrent inserts can still collide on
-- the unique constraint; the service retries with a fresh number.
create or replace function public.next_order_number(order_year integer)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select 'NX-' || order_year::text || '-' || lpad(
    (coalesce(max(substring(order_number from length('NX-' || order_year::text || '-') + 1)::integer), 0) + 1)::text,
    4,
    '0'
  )
  from public.orders
  where organization_id = private.current_org_id()
    and order_number like 'NX-' || order_year::text || '-%'
$$;

revoke execute on function public.next_order_number(integer) from public, anon;
grant execute on function public.next_order_number(integer) to authenticated;

-- Search and list helpers.
create index if not exists contacts_name_idx on public.contacts (organization_id, lower(last_name), lower(first_name));
create index if not exists deals_name_idx on public.deals (organization_id, lower(name));
create index if not exists orders_number_idx on public.orders (organization_id, order_number);
create index if not exists comments_author_idx on public.comments (author_id);
