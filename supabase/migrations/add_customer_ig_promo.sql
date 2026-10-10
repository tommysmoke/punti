-- Promo Instagram: marca se il cliente ha usato la promo (cerchio rosso).
alter table public.customers
  add column if not exists ig_promo boolean not null default false;

-- RPC sicura per aggiornare il flag (bypassa RLS, come le altre operazioni sui punti).
create or replace function public.set_customer_ig_promo(
  p_customer_id bigint,
  p_value boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
begin
  select c.store_id into v_store_id
  from public.customers c
  where c.id = p_customer_id;

  if v_store_id is null then
    raise exception 'Cliente non trovato';
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'store'
      and p.store_id = v_store_id
  ) then
    raise exception 'Permesso negato';
  end if;

  update public.customers
  set ig_promo = p_value
  where id = p_customer_id;
end;
$$;

grant execute on function public.set_customer_ig_promo(bigint, boolean) to authenticated;
