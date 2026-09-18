-- Riepilogo utilizzi premi per il profilo store.
-- Conta le redenzioni (kind='redeem') di ogni cliente del negozio,
-- raggruppate per valore punti (che corrisponde a un premio specifico).

create or replace function public.get_store_redeem_summary(p_store_id uuid)
returns table(points_cost integer, total_count bigint, month_count bigint)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'store'
      and p.store_id = p_store_id
  ) then
    raise exception 'Permesso negato';
  end if;

  return query
  select
    abs(t.points)::integer as points_cost,
    count(*)::bigint as total_count,
    count(*) filter (where date_trunc('month', t.created_at) = date_trunc('month', now()))::bigint as month_count
  from public.point_transactions t
  join public.customers c on c.id = t.customer_id
  where c.store_id = p_store_id
    and t.kind = 'redeem'
  group by abs(t.points)::integer
  order by points_cost;
end;
$$;

grant execute on function public.get_store_redeem_summary(uuid) to authenticated;
