-- Allow stores to update their customers' anagrafica (name, phone)
drop policy if exists "customers_store_update" on public.customers;
create policy "customers_store_update" on public.customers
for update using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'store'
      and p.store_id = customers.store_id
  )
);

-- RPC to update customer name/phone with validation and permission check
create or replace function public.update_customer(
  p_customer_id bigint,
  p_name text,
  p_phone text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
begin
  if p_name is null or trim(p_name) = '' then
    raise exception 'Il nome non può essere vuoto';
  end if;

  if p_phone is null or length(regexp_replace(p_phone, '\D', '', 'g')) < 8 then
    raise exception 'Numero di telefono non valido';
  end if;

  select c.store_id into v_store_id
  from public.customers c
  where c.id = p_customer_id;

  if v_store_id is null then
    raise exception 'Cliente non trovato';
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'store'
      and p.store_id = v_store_id
  ) then
    raise exception 'Permesso negato';
  end if;

  update public.customers
  set name = trim(p_name),
      phone = p_phone
  where id = p_customer_id;
end;
$$;

grant execute on function public.update_customer(bigint, text, text) to authenticated;
