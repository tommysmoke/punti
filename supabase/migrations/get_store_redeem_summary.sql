-- Riepilogo utilizzi premi per il profilo store.
-- Conta le redenzioni (kind='redeem') di ogni cliente del negozio,
-- raggruppate per valore punti (che corrisponde a un premio specifico).
-- Include anche la proiezione annuale basata sulla media mensile dell'anno corrente.

drop function if exists public.get_store_redeem_summary(uuid);

create function public.get_store_redeem_summary(p_store_id uuid)
returns table(
  points_cost integer,
  total_count bigint,
  month_count bigint,
  year_count bigint,
  year_projection double precision
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_earliest date;
  v_denominator integer;
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'store'
      and p.store_id = p_store_id
  ) then
    raise exception 'Permesso negato';
  end if;

  -- Prima redenzione dell'anno corrente (o inizio anno se nessuna).
  select min(t.created_at)::date
  into v_earliest
  from public.point_transactions t
  join public.customers c on c.id = t.customer_id
  where c.store_id = p_store_id
    and t.kind = 'redeem'
    and t.created_at >= date_trunc('year', now());

  v_earliest := coalesce(v_earliest, date_trunc('year', now())::date);

  -- Mesi disponibili: dal mese corrente indietro fino alla prima redenzione (o gennaio).
  v_denominator := greatest(1,
    (extract(year from now())::int * 12 + extract(month from now())::int)
    - (extract(year from v_earliest)::int * 12 + extract(month from v_earliest)::int)
    + 1
  );

  return query
  select
    abs(t.points)::integer as points_cost,
    count(*)::bigint as total_count,
    count(*) filter (where date_trunc('month', t.created_at) = date_trunc('month', now()))::bigint as month_count,
    count(*) filter (where date_trunc('year', t.created_at) = date_trunc('year', now()))::bigint as year_count,
    round(
      count(*) filter (where date_trunc('year', t.created_at) = date_trunc('year', now()))::numeric
      * 12.0 / v_denominator::numeric,
      1
    )::double precision as year_projection
  from public.point_transactions t
  join public.customers c on c.id = t.customer_id
  where c.store_id = p_store_id
    and t.kind = 'redeem'
  group by abs(t.points)::integer
  order by points_cost;
end;
$$;

grant execute on function public.get_store_redeem_summary(uuid) to authenticated;
