-- Replace "togli punti" with "sovrascrittura punti"
create or replace function public.set_customer_points(
  p_customer_id bigint,
  p_new_points integer,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_old_points integer;
  v_diff integer;
begin
  if p_new_points is null or p_new_points < 0 then
    raise exception 'Valore punti non valido';
  end if;

  select c.store_id, c.points into v_store_id, v_old_points
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

  v_diff := p_new_points - v_old_points;

  insert into public.point_transactions (customer_id, kind, points, note)
  values (
    p_customer_id,
    'adjust',
    v_diff,
    coalesce(p_note, 'Sovrascrittura: ' || v_old_points || ' → ' || p_new_points)
  );

  update public.customers
  set points = p_new_points
  where id = p_customer_id;
end;
$$;

grant execute on function public.set_customer_points(bigint, integer, text) to authenticated;
