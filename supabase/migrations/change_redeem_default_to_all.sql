-- La redemption senza quantità azzera il saldo.
-- Una quantità esplicita rimuove solo quella quantità; il residuo viene comunque azzerato.

alter table public.point_transactions
  add column if not exists store_location text;

do $$
declare
  v_constraint record;
begin
  for v_constraint in
    select conname
    from pg_constraint
    where conrelid = 'public.point_transactions'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ~* 'points\s*>\s*0'
  loop
    execute format('alter table public.point_transactions drop constraint %I', v_constraint.conname);
  end loop;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'point_transactions_points_check'
      and conrelid = 'public.point_transactions'::regclass
  ) then
    alter table public.point_transactions
      add constraint point_transactions_points_check
      check (
        (kind in ('earn', 'redeem') and points > 0)
        or (kind = 'adjust' and points <> 0)
      );
  end if;
end;
$$;

create or replace function public.record_redeem(
  p_customer_id bigint,
  p_points integer default null,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_current_points integer;
  v_redeem_points integer;
  v_remaining integer;
begin
  if p_points is not null and p_points <= 0 then
    raise exception 'Punti non validi';
  end if;

  select c.store_id, c.points into v_store_id, v_current_points
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

  v_redeem_points := coalesce(p_points, v_current_points);
  if v_redeem_points <= 0 then
    raise exception 'Saldo punti insufficiente';
  end if;

  if v_current_points < v_redeem_points then
    raise exception 'Saldo punti insufficiente';
  end if;

  insert into public.point_transactions (customer_id, kind, points, note)
  values (p_customer_id, 'redeem', v_redeem_points, coalesce(p_note, 'Redemption'));

  update public.customers
  set points = points - v_redeem_points
  where id = p_customer_id;

  v_remaining := v_current_points - v_redeem_points;
  if v_remaining > 0 then
    insert into public.point_transactions (customer_id, kind, points, note)
    values (p_customer_id, 'adjust', -v_remaining, 'Azzeramento totale');
    update public.customers
    set points = 0
    where id = p_customer_id;
  end if;
end;
$$;

grant execute on function public.record_redeem(bigint, integer, text) to authenticated;

create or replace function public.record_redeem(
  p_customer_id bigint,
  p_points integer default null,
  p_note text default null,
  p_store_location text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_current_points integer;
  v_redeem_points integer;
  v_remaining integer;
begin
  if p_points is not null and p_points <= 0 then
    raise exception 'Punti non validi';
  end if;

  if p_store_location is not null and p_store_location not in ('Quarto Inferiore', 'Castenaso', 'Bologna', 'San Lazzaro') then
    raise exception 'Sede non valida';
  end if;

  select c.store_id, c.points into v_store_id, v_current_points
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

  v_redeem_points := coalesce(p_points, v_current_points);
  if v_redeem_points <= 0 then
    raise exception 'Saldo punti insufficiente';
  end if;

  if v_current_points < v_redeem_points then
    raise exception 'Saldo punti insufficiente';
  end if;

  insert into public.point_transactions (customer_id, kind, points, note, store_location)
  values (p_customer_id, 'redeem', v_redeem_points, coalesce(p_note, 'Redemption'), p_store_location);

  update public.customers
  set points = points - v_redeem_points
  where id = p_customer_id;

  v_remaining := v_current_points - v_redeem_points;
  if v_remaining > 0 then
    insert into public.point_transactions (customer_id, kind, points, note, store_location)
    values (p_customer_id, 'adjust', -v_remaining, 'Azzeramento totale', p_store_location);
    update public.customers
    set points = 0
    where id = p_customer_id;
  end if;
end;
$$;

grant execute on function public.record_redeem(bigint, integer, text, text) to authenticated;
