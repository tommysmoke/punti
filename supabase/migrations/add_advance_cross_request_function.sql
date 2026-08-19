-- Atomic chain advancement for cross-requests.
-- Moves an active request from p_current_index to the next store in its ranking
-- and inserts the outgoing notification in a single transaction. Concurrent
-- callers are serialized with FOR UPDATE, so the same step can never advance
-- twice (no duplicate notifications).

create or replace function public.advance_cross_request(
  p_request_id int,
  p_current_index int,
  p_body text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.active_cross_requests%rowtype;
  v_next_index int;
  v_next_store text;
  v_notif_id bigint;
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'store'
  ) then
    raise exception 'Permesso negato';
  end if;

  select * into v_req
  from public.active_cross_requests
  where id = p_request_id
  for update;

  if not found then
    return false;
  end if;

  if v_req.status <> 'active' then
    return false;
  end if;

  if v_req.current_index <> p_current_index then
    return false;  -- another caller already advanced this step
  end if;

  v_next_index := p_current_index + 1;

  if v_next_index >= jsonb_array_length(v_req.ranking) then
    return false;
  end if;

  v_next_store := v_req.ranking ->> v_next_index;

  insert into public.store_notifications (store_id, kind, target_store, title, body, created_by)
  values (
    v_req.requesting_store_id::uuid,
    'cross_request',
    v_next_store,
    'Richiesta da ' || v_req.requesting_store,
    p_body,
    v_req.created_by
  )
  returning id into v_notif_id;

  update public.active_cross_requests
  set current_index = v_next_index,
      timer_started = now(),
      current_request_notification_id = v_notif_id
  where id = p_request_id;

  return true;
end;
$$;

grant execute on function public.advance_cross_request(int, int, text) to authenticated;
