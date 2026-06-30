-- Add birth_day_month column to customers table
alter table public.customers
  add column if not exists birth_day_month text not null default '01/01';

-- Set existing null values to default
update public.customers
  set birth_day_month = '01/01'
  where birth_day_month is null;

-- Update update_customer RPC to accept birth_day_month
create or replace function public.update_customer(
  p_customer_id bigint,
  p_name text,
  p_phone text,
  p_birth_day_month text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_birth text;
begin
  if p_name is null or trim(p_name) = '' then
    raise exception 'Il nome non può essere vuoto';
  end if;

  if p_phone is null or length(regexp_replace(p_phone, '\D', '', 'g')) < 8 then
    raise exception 'Numero di telefono non valido';
  end if;

  v_birth := nullif(trim(coalesce(p_birth_day_month, '')), '');

  if v_birth is not null and v_birth !~ '^\d{2}/\d{2}$' then
    raise exception 'Formato giorno/mese non valido (usa GG/MM)';
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
      phone = p_phone,
      birth_day_month = v_birth
  where id = p_customer_id;
end;
$$;

grant execute on function public.update_customer(bigint, text, text, text) to authenticated;
