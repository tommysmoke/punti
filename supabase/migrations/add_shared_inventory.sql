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

  execute format('update public.shared_inventory set %I = 0 where true', p_column);
end;
$$;

grant execute on function public.reset_inventory_for_store(text) to authenticated;

-- Batch update store quantities by product IDs (single UPDATE with FROM VALUES)
create or replace function public.batch_update_store_quantities(
  p_column text,
  p_updates jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pairs text := '';
  rec record;
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

  if jsonb_array_length(p_updates) = 0 then
    return;
  end if;

  select string_agg(format('(%s, %s)', (item->>'id'), (item->>'q')), ', ')
  into v_pairs
  from jsonb_array_elements(p_updates) as item;

  execute format(
    'update public.shared_inventory si set %I = v.q from (values %s) as v(id, q) where si.id = v.id',
    p_column, v_pairs
  );
end;
$$;

grant execute on function public.batch_update_store_quantities(text, jsonb) to authenticated;

-- Saved barcode aliases for manual cart item matching
create table if not exists public.cross_inventory_aliases (
  id bigint generated always as identity primary key,
  cart_name text not null,
  barcode text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists cross_inventory_aliases_cart_name_idx
  on public.cross_inventory_aliases(lower(cart_name));

alter table public.cross_inventory_aliases enable row level security;

drop policy if exists "cross_inventory_aliases_all_read" on public.cross_inventory_aliases;
create policy "cross_inventory_aliases_all_read" on public.cross_inventory_aliases
for select using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'store'
  )
);

drop policy if exists "cross_inventory_aliases_all_insert" on public.cross_inventory_aliases;
create policy "cross_inventory_aliases_all_insert" on public.cross_inventory_aliases
for insert with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'store'
  )
);
