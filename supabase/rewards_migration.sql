-- Migration: tabella rewards per i premi del negozio
-- Esegui questo nel SQL Editor di Supabase

create table if not exists public.rewards (
  id bigint generated always as identity primary key,
  store_id uuid not null,
  name text not null,
  description text,
  points_cost integer not null check (points_cost > 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.rewards enable row level security;

-- Store: può leggere, creare, aggiornare ed eliminare i propri premi
drop policy if exists "rewards_store_read" on public.rewards;
create policy "rewards_store_read" on public.rewards
for select using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'store'
      and p.store_id = rewards.store_id
  )
);

drop policy if exists "rewards_store_insert" on public.rewards;
create policy "rewards_store_insert" on public.rewards
for insert with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'store'
      and p.store_id = rewards.store_id
  )
);

drop policy if exists "rewards_store_update" on public.rewards;
create policy "rewards_store_update" on public.rewards
for update using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'store'
      and p.store_id = rewards.store_id
  )
);

drop policy if exists "rewards_store_delete" on public.rewards;
create policy "rewards_store_delete" on public.rewards
for delete using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'store'
      and p.store_id = rewards.store_id
  )
);

-- Cliente: può leggere solo i premi attivi del proprio negozio
drop policy if exists "rewards_customer_read" on public.rewards;
create policy "rewards_customer_read" on public.rewards
for select using (
  active = true
  and exists (
    select 1
    from public.profiles p
    join public.customers c on c.id = p.customer_id
    where p.id = auth.uid()
      and p.role = 'customer'
      and c.store_id = rewards.store_id
  )
);
