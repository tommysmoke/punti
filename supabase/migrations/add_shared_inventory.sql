-- Shared inventory for cross-store surplus/excess tracking
-- Each store uploads its Easyfatt CSV export manually with a store name

create table if not exists public.shared_inventory (
  id bigint generated always as identity primary key,
  store_name text not null,
  product_name text not null,
  barcode text,
  quantity integer not null default 0,
  category text,
  updated_at timestamptz not null default now()
);

create index if not exists shared_inventory_store_name_idx
  on public.shared_inventory(store_name);

create index if not exists shared_inventory_product_name_idx
  on public.shared_inventory(product_name);

alter table public.shared_inventory enable row level security;

-- All authenticated store users can read all inventory entries (cross-store visibility)
drop policy if exists "shared_inventory_store_read" on public.shared_inventory;
create policy "shared_inventory_store_read" on public.shared_inventory
for select using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'store'
  )
);

-- Store users can insert entries
drop policy if exists "shared_inventory_store_insert" on public.shared_inventory;
create policy "shared_inventory_store_insert" on public.shared_inventory
for insert with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'store'
  )
);

-- Store users can update any entry
drop policy if exists "shared_inventory_store_update" on public.shared_inventory;
create policy "shared_inventory_store_update" on public.shared_inventory
for update using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'store'
  )
);

-- Store users can delete any entry
drop policy if exists "shared_inventory_store_delete" on public.shared_inventory;
create policy "shared_inventory_store_delete" on public.shared_inventory
for delete using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'store'
  )
);

-- Clean stale entries from a store before re-upload
create or replace function public.clear_store_inventory(p_store_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'store'
  ) then
    raise exception 'Permesso negato';
  end if;

  delete from public.shared_inventory
  where store_name = p_store_name;
end;
$$;

grant execute on function public.clear_store_inventory(text) to authenticated;
