-- Shared inventory for cross-store surplus/excess tracking
-- One row per product, with quantity columns per store

create table if not exists public.shared_inventory (
  id bigint generated always as identity primary key,
  product_name text not null,
  barcode text,
  quantity_quarto integer not null default 0,
  quantity_castenaso integer not null default 0,
  quantity_bologna integer not null default 0,
  quantity_san_lazzaro integer not null default 0,
  category text,
  updated_at timestamptz not null default now()
);

create index if not exists shared_inventory_product_name_idx
  on public.shared_inventory(product_name);

create index if not exists shared_inventory_barcode_idx
  on public.shared_inventory(barcode)
  where barcode is not null and barcode <> '';

alter table public.shared_inventory enable row level security;

-- All authenticated store users can read all inventory entries (cross-store visibility)
drop policy if exists "shared_inventory_all_read" on public.shared_inventory;
create policy "shared_inventory_all_read" on public.shared_inventory
for select using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'store'
  )
);

-- Store users can insert
drop policy if exists "shared_inventory_all_insert" on public.shared_inventory;
create policy "shared_inventory_all_insert" on public.shared_inventory
for insert with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'store'
  )
);

-- Store users can update
drop policy if exists "shared_inventory_all_update" on public.shared_inventory;
create policy "shared_inventory_all_update" on public.shared_inventory
for update using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'store'
  )
);

-- Store users can delete
drop policy if exists "shared_inventory_all_delete" on public.shared_inventory;
create policy "shared_inventory_all_delete" on public.shared_inventory
for delete using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'store'
  )
);

-- Reset a store's quantity column to 0 for all products before re-upload
create or replace function public.reset_inventory_for_store(p_column text)
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

  if p_column not in ('quantity_quarto', 'quantity_castenaso', 'quantity_bologna', 'quantity_san_lazzaro') then
    raise exception 'Colonna non valida';
  end if;

  execute format('update public.shared_inventory set %I = 0', p_column);
end;
$$;

grant execute on function public.reset_inventory_for_store(text) to authenticated;
