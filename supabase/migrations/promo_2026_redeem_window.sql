-- Promozione ottobre 2026: finestra di "una sola redenzione".
-- Tra 02/10/2026 10:00 e 30/10/2026 23:00 (fuso Roma) ogni cliente può fare
-- UNA sola redenzione; quella redenzione azzera il saldo a 0. Dopo aver redento
-- nella finestra, earn e redeem sono bloccati fino al 01/11/2026 00:01 (Roma).
-- Le date sono fisse al 2026 (non si ripetono negli anni successivi).

-- Riscrittura di record_redeem con il blocco promozionale e l'azzeramento.
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

  -- Blocco promozionale: se ha già redento nella finestra, non può scaricare.
  if now() < ('2026-11-01 00:01:00'::timestamp at time zone 'Europe/Rome')
     and exists (
       select 1 from public.point_transactions t
       where t.customer_id = p_customer_id
         and t.kind = 'redeem'
         and t.created_at >= ('2026-10-02 10:00:00'::timestamp at time zone 'Europe/Rome')
         and t.created_at <= ('2026-10-30 23:00:00'::timestamp at time zone 'Europe/Rome')
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

  -- Azzeramento totale: solo se la redenzione avviene dentro la finestra.
  if now() between
       ('2026-10-02 10:00:00'::timestamp at time zone 'Europe/Rome')
       and ('2026-10-30 23:00:00'::timestamp at time zone 'Europe/Rome') then
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

-- Riscrittura di record_earn con il blocco promozionale (nessun azzeramento).
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

  -- Blocco promozionale: se ha già redento nella finestra, non può aggiungere punti.
  if now() < ('2026-11-01 00:01:00'::timestamp at time zone 'Europe/Rome')
     and exists (
       select 1 from public.point_transactions t
       where t.customer_id = p_customer_id
         and t.kind = 'redeem'
         and t.created_at >= ('2026-10-02 10:00:00'::timestamp at time zone 'Europe/Rome')
         and t.created_at <= ('2026-10-30 23:00:00'::timestamp at time zone 'Europe/Rome')
     ) then
    raise exception 'Non puoi aggiungere punti fino al 01/11/2026';
  end if;

  v_points := floor(p_amount_eur / 7);

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
