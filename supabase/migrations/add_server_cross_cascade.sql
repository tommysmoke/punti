-- Fase 1 (additiva): RPC e colonne del cascade server-side. Compatibile con i client precedenti.
-- Le revoche ai client sono in restrict_cross_request_client_writes.sql (fase 2).

-- Colonne introdotte da add_cross_request_response_id.sql: la migration non dipende dall'ordine di applicazione.
alter table public.store_notifications
  add column if not exists response_to_request_id bigint,
  add column if not exists closed_at timestamptz;

alter table public.active_cross_requests
  add column if not exists current_request_notification_id bigint,
  add column if not exists attempts int not null default 0,
  add column if not exists last_error text;

drop function if exists public.create_cross_request(text, jsonb, jsonb, text, text);

create or replace function public.create_cross_request(
  p_requesting_store text,
  p_items jsonb,
  p_ranking jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_items jsonb;
  v_request_body text;
  v_summary_body text;
  v_request_id int;
  v_request_notification_id bigint;
  v_summary_notification_id bigint;
  v_first_store text;
begin
  select p.store_id into v_store_id
  from public.profiles p
  where p.id = auth.uid() and p.role = 'store';

  if v_store_id is null then
    raise exception 'Permesso negato';
  end if;

  if p_requesting_store not in ('Quarto', 'Castenaso', 'Bologna', 'San Lazzaro') then
    raise exception 'Negozio richiedente non valido';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La richiesta deve contenere almeno un prodotto';
  end if;

  if jsonb_array_length(p_items) > 200 then
    raise exception 'Elenco prodotti troppo lungo';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) as item(value)
    where jsonb_typeof(item.value) is distinct from 'object'
       or jsonb_typeof(item.value -> 'name') is distinct from 'string'
       or char_length(btrim(item.value ->> 'name')) not between 1 and 200
       or (item.value ->> 'name') ~ '[[:cntrl:]]'
       or jsonb_typeof(item.value -> 'quantity') is distinct from 'number'
       or (item.value ->> 'quantity') !~ '^[1-9][0-9]{0,5}$'
       or coalesce(jsonb_typeof(item.value -> 'barcode'), 'null') not in ('string', 'null')
       or (
         jsonb_typeof(item.value -> 'barcode') = 'string'
         and btrim(item.value ->> 'barcode') <> ''
         and btrim(item.value ->> 'barcode') !~ '^[^[:space:]()]{1,64}$'
       )
       or (
         item.value ? 'visibleQuantities'
         and jsonb_typeof(item.value -> 'visibleQuantities') <> 'object'
       )
       or exists (
         select 1
         from jsonb_each(coalesce(item.value -> 'visibleQuantities', '{}'::jsonb)) as visible(store_name, store_quantity)
         where visible.store_name not in ('Quarto', 'Castenaso', 'Bologna', 'San Lazzaro')
            or jsonb_typeof(visible.store_quantity) <> 'number'
            or visible.store_quantity::text !~ '^[0-9]+$'
       )
  ) then
    raise exception 'Elenco prodotti non valido';
  end if;

  select jsonb_agg(
           jsonb_build_object(
             'name', btrim(item.value ->> 'name'),
             'quantity', (item.value ->> 'quantity')::int,
             'barcode', nullif(btrim(item.value ->> 'barcode'), '')
           ) || case
             when item.value ? 'visibleQuantities'
             then jsonb_build_object('visibleQuantities', item.value -> 'visibleQuantities')
             else '{}'::jsonb
           end order by item.ord
         )
  into v_items
  from jsonb_array_elements(p_items) with ordinality as item(value, ord);

  if p_ranking is null or jsonb_typeof(p_ranking) <> 'array' or jsonb_array_length(p_ranking) = 0 then
    raise exception 'Classifica negozi non valida';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_ranking) as ranked(value)
    where jsonb_typeof(ranked.value) is distinct from 'string'
       or ranked.value #>> '{}' not in ('Quarto', 'Castenaso', 'Bologna', 'San Lazzaro')
       or ranked.value #>> '{}' = p_requesting_store
  ) or exists (
    select 1
    from jsonb_array_elements_text(p_ranking) as ranked(store_name)
    group by ranked.store_name
    having count(*) > 1
  ) then
    raise exception 'Classifica negozi non valida';
  end if;

  v_first_store := p_ranking ->> 0;

  -- Stesso formato di buildCrossRequestBody / del riepilogo iniziale lato client.
  select 'Chiede:' || coalesce(E'\n' || string_agg(
           least(
             (item.value ->> 'quantity')::int,
             coalesce(nullif(item.value -> 'visibleQuantities' ->> v_first_store, '')::int, (item.value ->> 'quantity')::int)
           ) || ' ' || (item.value ->> 'name')
             || coalesce(' (' || (item.value ->> 'barcode') || ')', ''),
           E'\n' order by item.ord
         ) filter (where coalesce(nullif(item.value -> 'visibleQuantities' ->> v_first_store, '')::int, (item.value ->> 'quantity')::int) > 0), '')
  into v_request_body
  from jsonb_array_elements(v_items) with ordinality as item(value, ord);

  select 'Richiesta a ' || string_agg(ranked.store_name, ', ' order by ranked.ord)
         || E'\n\nIn attesa di risposta da ' || v_first_store || '...'
  into v_summary_body
  from jsonb_array_elements_text(p_ranking) with ordinality as ranked(store_name, ord);

  insert into public.store_notifications (store_id, kind, target_store, title, body, created_by)
  values (
    v_store_id,
    'cross_request',
    v_first_store,
    'Richiesta da ' || p_requesting_store,
    v_request_body,
    auth.uid()
  )
  returning id into v_request_notification_id;

  insert into public.store_notifications (store_id, kind, target_store, title, body, created_by)
  values (
    v_store_id,
    'cross_request',
    p_requesting_store,
    'Riepilogo richiesta',
    v_summary_body,
    auth.uid()
  )
  returning id into v_summary_notification_id;

  insert into public.active_cross_requests (
    requesting_store,
    requesting_store_id,
    created_by,
    items,
    remaining,
    confirmed,
    ranking,
    current_index,
    timer_started,
    status,
    aggregate_notification_id,
    current_request_notification_id
  )
  values (
    p_requesting_store,
    v_store_id::text,
    auth.uid(),
    v_items,
    v_items,
    '[]'::jsonb,
    p_ranking,
    0,
    now(),
    'active',
    v_summary_notification_id,
    v_request_notification_id
  )
  returning id into v_request_id;

  return jsonb_build_object(
    'request_id', v_request_id,
    'first_store', v_first_store,
    'request_notification_id', v_request_notification_id,
    'summary_notification_id', v_summary_notification_id
  );
end;
$$;

revoke all on function public.create_cross_request(text, jsonb, jsonb) from public, anon;
grant execute on function public.create_cross_request(text, jsonb, jsonb) to authenticated;

create or replace function public.transition_cross_request_server(
  p_request_id int,
  p_expected_current_index int,
  p_expected_notification_id bigint,
  p_event text,
  p_confirmed jsonb,
  p_remaining jsonb,
  p_aggregate_body text,
  p_next_request_body text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.active_cross_requests%rowtype;
  v_current_store text;
  v_next_index int;
  v_next_store text;
  v_next_notification_id bigint;
  v_complete boolean;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Permesso negato';
  end if;

  if p_event is null or p_event not in ('response', 'timeout', 'complete', 'skip') then
    raise exception 'Evento cascade non valido';
  end if;

  if jsonb_typeof(p_confirmed) is distinct from 'array'
     or jsonb_typeof(p_remaining) is distinct from 'array'
     or p_aggregate_body is null then
    raise exception 'Dati cascade non validi';
  end if;

  select * into v_req
  from public.active_cross_requests
  where id = p_request_id
  for update;

  if not found
     or v_req.status <> 'active'
     or v_req.current_index <> p_expected_current_index
     or v_req.current_request_notification_id is distinct from p_expected_notification_id then
    return false;
  end if;

  v_current_store := v_req.ranking ->> v_req.current_index;

  if p_event = 'timeout' then
    if v_current_store is null then
      raise exception 'Negozio corrente non valido';
    end if;

    insert into public.store_notifications (store_id, kind, target_store, title, body, created_by)
    values (
      v_req.requesting_store_id::uuid,
      'cross_request',
      v_current_store,
      'Non hai fatto in tempo',
      'Non hai risposto in tempo alla richiesta da ' || v_req.requesting_store || '.',
      v_req.created_by
    );
  end if;

  v_next_index := v_req.current_index + 1;
  v_complete := p_event = 'complete'
    or jsonb_array_length(p_remaining) = 0
    or v_next_index >= jsonb_array_length(v_req.ranking);

  -- La richiesta corrente non è più rispondibile: la UI disattiva "Rispondi".
  update public.store_notifications
  set closed_at = now()
  where id = v_req.current_request_notification_id
    and closed_at is null;

  -- Un riepilogo mancante non deve bloccare l'avanzamento della richiesta.
  update public.store_notifications
  set body = p_aggregate_body
  where id = v_req.aggregate_notification_id;

  if v_complete then
    update public.active_cross_requests
    set confirmed = p_confirmed,
        remaining = p_remaining,
        status = 'completed',
        attempts = 0,
        last_error = null
    where id = v_req.id;

    return true;
  end if;

  v_next_store := v_req.ranking ->> v_next_index;
  if v_next_store is null then
    raise exception 'Prossimo negozio non valido';
  end if;

  if p_next_request_body is null then
    update public.active_cross_requests
    set confirmed = p_confirmed,
        remaining = p_remaining,
        current_index = v_next_index,
        timer_started = now(),
        current_request_notification_id = null,
        attempts = 0,
        last_error = null
    where id = v_req.id;

    return true;
  end if;

  insert into public.store_notifications (store_id, kind, target_store, title, body, created_by)
  values (
    v_req.requesting_store_id::uuid,
    'cross_request',
    v_next_store,
    'Richiesta da ' || v_req.requesting_store,
    p_next_request_body,
    v_req.created_by
  )
  returning id into v_next_notification_id;

  update public.active_cross_requests
  set confirmed = p_confirmed,
      remaining = p_remaining,
      current_index = v_next_index,
      timer_started = now(),
      current_request_notification_id = v_next_notification_id,
      attempts = 0,
      last_error = null
  where id = v_req.id;

  return true;
end;
$$;

revoke all on function public.transition_cross_request_server(int, int, bigint, text, jsonb, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.transition_cross_request_server(int, int, bigint, text, jsonb, jsonb, text, text) to service_role;

-- Registra l'errore di un tick; chiamata solo dal worker.
create or replace function public.record_cross_request_error(
  p_request_id int,
  p_error text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Permesso negato';
  end if;

  update public.active_cross_requests
  set attempts = attempts + 1,
      last_error = left(p_error, 500)
  where id = p_request_id
    and status = 'active';
end;
$$;

revoke all on function public.record_cross_request_error(int, text) from public, anon, authenticated;
grant execute on function public.record_cross_request_error(int, text) to service_role;
