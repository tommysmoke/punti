-- Allow store owners to read customer profiles for their store
drop policy if exists "profiles_store_read_customer" on public.profiles;
create policy "profiles_store_read_customer" on public.profiles
for select using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'store'
      and p.store_id = profiles.store_id
  )
  or
  exists (
    select 1 from public.customers c
    join public.profiles sp on sp.id = auth.uid() and sp.role = 'store'
    where c.id = profiles.customer_id
      and c.store_id = sp.store_id
  )
);
