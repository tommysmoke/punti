-- Batch update carico/scarico dates per store
create or replace function public.batch_update_store_dates(
  p_carico_col text,
  p_scarico_col text,
  p_updates jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pairs text := '';
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'store'
  ) then
    raise exception 'Permesso negato';
  end if;

  if p_carico_col not in ('last_carico_quarto', 'last_carico_castenaso', 'last_carico_bologna', 'last_carico_san_lazzaro') then
    raise exception 'Colonna carico non valida';
  end if;

  if p_scarico_col not in ('last_scarico_quarto', 'last_scarico_castenaso', 'last_scarico_bologna', 'last_scarico_san_lazzaro') then
    raise exception 'Colonna scarico non valida';
  end if;

  if jsonb_array_length(p_updates) = 0 then
    return;
  end if;

  select string_agg(format('(%s, %L, %L)', (item->>'id'), (item->>'c'), (item->>'s')), ', ')
  into v_pairs
  from jsonb_array_elements(p_updates) as item;

  execute format(
    'update public.shared_inventory si set %I = v.c, %I = v.s from (values %s) as v(id, c, s) where si.id = v.id',
    p_carico_col, p_scarico_col, v_pairs
  );
end;
$$;

grant execute on function public.batch_update_store_dates(text, text, jsonb) to authenticated;
