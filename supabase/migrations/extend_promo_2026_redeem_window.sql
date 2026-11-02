-- Estende la finestra promozionale fino al 31/10/2026 alle 23:00, fuso Europe/Rome.
-- Il blocco per chi ha gia redento resta attivo fino al 01/11/2026 alle 00:01.

create or replace function public.record_earn(
  p_customer_id bigint,
  p_amount_eur numeric,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_points integer;
begin
  if p_amount_eur is null or p_amount_eur <= 0 then
    raise exception 'Importo non valido';
  end if;

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

  if now() < ('2026-11-01 00:01:00'::timestamp at time zone 'Europe/Rome')
     and exists (
       select 1 from public.point_transactions t
       where t.customer_id = p_customer_id
         and t.kind = 'redeem'
         and t.created_at >= ('2026-10-02 10:00:00'::timestamp at time zone 'Europe/Rome')
         and t.created_at <= ('2026-10-31 23:00:00'::timestamp at time zone 'Europe/Rome')
     ) then
    raise exception 'Non puoi aggiungere punti fino al 01/11/2026';
  end if;

  v_points := floor(p_amount_eur / 1);
  if v_points <= 0 then
    raise exception 'Spesa troppo bassa per assegnare punti';
  end if;

  insert into public.point_transactions (customer_id, kind, points, note)
  values (p_customer_id, 'earn', v_points, coalesce(p_note, 'Assegnazione punti'));

  update public.customers
  set points = points + v_points
  where id = p_customer_id;
end;
$$;

grant execute on function public.record_earn(bigint, numeric, text) to authenticated;

create or replace function public.record_redeem(
  p_customer_id bigint,
  p_points integer,
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
  v_remaining integer;
begin
  if p_points is null or p_points <= 0 then
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

  if now() < ('2026-11-01 00:01:00'::timestamp at time zone 'Europe/Rome')
     and exists (
       select 1 from public.point_transactions t
       where t.customer_id = p_customer_id
         and t.kind = 'redeem'
         and t.created_at >= ('2026-10-02 10:00:00'::timestamp at time zone 'Europe/Rome')
         and t.created_at <= ('2026-10-31 23:00:00'::timestamp at time zone 'Europe/Rome')
     ) then
    raise exception 'Non puoi scaricare punti fino al 01/11/2026';
  end if;

  if v_current_points < p_points then
    raise exception 'Saldo punti insufficiente';
  end if;

  insert into public.point_transactions (customer_id, kind, points, note)
  values (p_customer_id, 'redeem', p_points, coalesce(p_note, 'Redemption'));

  update public.customers
  set points = points - p_points
  where id = p_customer_id;

  if now() between
       ('2026-10-02 10:00:00'::timestamp at time zone 'Europe/Rome')
       and ('2026-10-31 23:00:00'::timestamp at time zone 'Europe/Rome') then
    v_remaining := v_current_points - p_points;
    if v_remaining > 0 then
      insert into public.point_transactions (customer_id, kind, points, note)
      values (p_customer_id, 'adjust', -v_remaining, 'Azzeramento totale');
      update public.customers
      set points = 0
      where id = p_customer_id;
    end if;
  end if;
end;
$$;

grant execute on function public.record_redeem(bigint, integer, text) to authenticated;

create or replace function public.record_earn(
  p_customer_id bigint,
  p_amount_eur numeric,
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
  v_points integer;
begin
  if p_amount_eur is null or p_amount_eur <= 0 then
    raise exception 'Importo non valido';
  end if;

  if p_store_location is not null and p_store_location not in ('Quarto Inferiore', 'Castenaso', 'Bologna', 'San Lazzaro') then
    raise exception 'Sede non valida';
  end if;

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

  if now() < ('2026-11-01 00:01:00'::timestamp at time zone 'Europe/Rome')
     and exists (
       select 1 from public.point_transactions t
       where t.customer_id = p_customer_id
         and t.kind = 'redeem'
         and t.created_at >= ('2026-10-02 10:00:00'::timestamp at time zone 'Europe/Rome')
         and t.created_at <= ('2026-10-31 23:00:00'::timestamp at time zone 'Europe/Rome')
     ) then
    raise exception 'Non puoi aggiungere punti fino al 01/11/2026';
  end if;

  v_points := floor(p_amount_eur / 1);
  if v_points <= 0 then
    raise exception 'Spesa troppo bassa per assegnare punti';
  end if;

  insert into public.point_transactions (customer_id, kind, points, note, store_location)
  values (p_customer_id, 'earn', v_points, coalesce(p_note, 'Assegnazione punti'), p_store_location);

  update public.customers
  set points = points + v_points
  where id = p_customer_id;
end;
$$;

grant execute on function public.record_earn(bigint, numeric, text, text) to authenticated;

create or replace function public.record_redeem(
  p_customer_id bigint,
  p_points integer,
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
  v_remaining integer;
begin
  if p_points is null or p_points <= 0 then
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

  if now() < ('2026-11-01 00:01:00'::timestamp at time zone 'Europe/Rome')
     and exists (
       select 1 from public.point_transactions t
       where t.customer_id = p_customer_id
         and t.kind = 'redeem'
         and t.created_at >= ('2026-10-02 10:00:00'::timestamp at time zone 'Europe/Rome')
         and t.created_at <= ('2026-10-31 23:00:00'::timestamp at time zone 'Europe/Rome')
     ) then
    raise exception 'Non puoi scaricare punti fino al 01/11/2026';
  end if;

  if v_current_points < p_points then
    raise exception 'Saldo punti insufficiente';
  end if;

  insert into public.point_transactions (customer_id, kind, points, note, store_location)
  values (p_customer_id, 'redeem', p_points, coalesce(p_note, 'Redemption'), p_store_location);

  update public.customers
  set points = points - p_points
  where id = p_customer_id;

  if now() between
       ('2026-10-02 10:00:00'::timestamp at time zone 'Europe/Rome')
       and ('2026-10-31 23:00:00'::timestamp at time zone 'Europe/Rome') then
    v_remaining := v_current_points - p_points;
    if v_remaining > 0 then
      insert into public.point_transactions (customer_id, kind, points, note, store_location)
      values (p_customer_id, 'adjust', -v_remaining, 'Azzeramento totale', p_store_location);
      update public.customers
      set points = 0
      where id = p_customer_id;
    end if;
  end if;
end;
$$;

grant execute on function public.record_redeem(bigint, integer, text, text) to authenticated;
