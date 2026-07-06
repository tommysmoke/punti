-- Helper: get authenticated user's store_id (bypasses RLS)
create or replace function public.get_auth_store_id()
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select store_id from public.profiles
  where id = auth.uid() and role = 'store';
$$;

-- Allow store owners to read customer profiles for their store
drop policy if exists "profiles_store_read_customer" on public.profiles;
create policy "profiles_store_read_customer" on public.profiles
for select using (
  public.get_auth_store_id() = profiles.store_id
  or
  exists (
    select 1 from public.customers c
    where c.id = profiles.customer_id
      and c.store_id = public.get_auth_store_id()
  )
);
