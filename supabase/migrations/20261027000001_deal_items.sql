-- Products in deals (товары в сделке): lines with quantity, price, discount and tax. When a deal has
-- lines, its amount is their total (kept by the application), and the order made from the won deal
-- copies them.

create table public.deal_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  deal_id uuid not null,
  product_id uuid,
  description text not null check (char_length(description) between 1 and 255),
  quantity numeric(14, 3) not null check (quantity > 0),
  unit_price numeric(14, 2) not null check (unit_price >= 0),
  discount_pct numeric(5, 2) not null default 0 check (discount_pct between 0 and 100),
  tax_rate numeric(5, 2) not null default 0 check (tax_rate between 0 and 100),
  line_total numeric(14, 2) not null check (line_total >= 0),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (deal_id, organization_id) references public.deals (id, organization_id) on delete cascade,
  foreign key (product_id, organization_id) references public.products (id, organization_id) on delete set null (product_id)
);
create index deal_items_deal_idx on public.deal_items (deal_id, position);

alter table public.deal_items enable row level security;
create policy "read items of visible deals" on public.deal_items
  for select to authenticated using (
    organization_id = private.current_org_id()
    and exists (select 1 from public.deals d where d.id = deal_id and private.can_see_owner(d.owner_id))
  );
create policy "write items of visible deals" on public.deal_items
  for all to authenticated
  using (organization_id = private.current_org_id() and exists (select 1 from public.deals d where d.id = deal_id and private.can_see_owner(d.owner_id)))
  with check (organization_id = private.current_org_id() and exists (select 1 from public.deals d where d.id = deal_id and private.can_see_owner(d.owner_id)));
