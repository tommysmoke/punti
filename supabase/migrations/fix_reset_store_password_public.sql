create or replace function public.reset_store_password_public(
  p_username text,
  p_new_password text
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_target_id uuid;
  v_target_store_id uuid;
  v_caller_store_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Permesso negato';
  end if;

  select p.id, p.store_id
  into v_target_id, v_target_store_id
  from public.profiles p
  where lower(p.username) = lower(regexp_replace(coalesce(p_username, ''), '[^a-zA-Z0-9]', '', 'g'))
    and p.role = 'store'
  limit 1;

  if v_target_id is null then
    raise exception 'Socio non trovato';
  end if;

  select p.store_id into v_caller_store_id
  from public.profiles p
  where p.id = auth.uid()
    and p.role = 'store';

  if v_caller_store_id is null or v_caller_store_id != v_target_store_id then
    raise exception 'Permesso negato';
  end if;

  update auth.users
  set encrypted_password = crypt(p_new_password, gen_salt('bf'))
  where id = v_target_id;
end;
$$;

grant execute on function public.reset_store_password_public(text, text) to authenticated;
