-- Update customer anagrafica and keep profile username/password aligned
-- Rules:
-- - username = lowercase {nomecognome}{giorno}{mese}
-- - ignore parenthesized notes in name for username generation
-- - when phone changes, password becomes the new phone after validating old phone

create or replace function public.update_customer_profile_credentials(
  p_customer_id bigint,
  p_name text,
  p_phone text,
  p_birth_day_month text default null,
  p_old_phone text default null
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_store_id uuid;
  v_user_id uuid;
  v_current_phone text;
  v_new_phone text;
  v_old_phone text;
  v_birth text;
  v_username_base text;
  v_new_username text;
  v_pwd_hash text;
begin
  if p_name is null or trim(p_name) = '' then
    raise exception 'Il nome non può essere vuoto';
  end if;

  v_new_phone := regexp_replace(coalesce(p_phone, ''), '\\D', '', 'g');
  if v_new_phone = '' or length(v_new_phone) < 8 then
    raise exception 'Numero di telefono non valido';
  end if;

  v_birth := nullif(trim(coalesce(p_birth_day_month, '')), '');
  if v_birth is null or v_birth !~ '^\\d{2}/\\d{2}$' then
    raise exception 'Formato giorno/mese non valido (usa GG/MM)';
  end if;

  select c.store_id, c.phone
  into v_store_id, v_current_phone
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

  select p.id
  into v_user_id
  from public.profiles p
  where p.customer_id = p_customer_id
  limit 1;

  if v_user_id is null then
    raise exception 'Account cliente non trovato';
  end if;

  -- Username from cleaned name (without parenthesized notes) + birth day/month suffix.
  v_username_base := lower(
    regexp_replace(
      regexp_replace(trim(p_name), '\\s*\\([^)]*\\)', ' ', 'g'),
      '[^a-zA-Z0-9]',
      '',
      'g'
    )
  );

  if v_username_base = '' then
    raise exception 'Username non valido: nome vuoto dopo la pulizia';
  end if;

  v_new_username := v_username_base || replace(v_birth, '/', '');

  if exists (
    select 1
    from public.profiles p
    where lower(p.username) = v_new_username
      and p.id <> v_user_id
  ) then
    raise exception 'Username già in uso: %', v_new_username;
  end if;

  update public.customers
  set name = trim(p_name),
      phone = v_new_phone,
      birth_day_month = v_birth
  where id = p_customer_id;

  update public.profiles
  set username = v_new_username
  where id = v_user_id;

  -- If phone changes, validate old phone as current password then rotate password to new phone.
  if v_current_phone <> v_new_phone then
    v_old_phone := regexp_replace(coalesce(p_old_phone, ''), '\\D', '', 'g');

    if v_old_phone = '' then
      raise exception 'Per cambiare telefono serve il vecchio numero';
    end if;

    if v_old_phone <> v_current_phone then
      raise exception 'Vecchio numero non corrispondente';
    end if;

    select u.encrypted_password
    into v_pwd_hash
    from auth.users u
    where u.id = v_user_id;

    if v_pwd_hash is null or crypt(v_old_phone, v_pwd_hash) <> v_pwd_hash then
      raise exception 'Validazione vecchia password fallita';
    end if;

    update auth.users
    set encrypted_password = crypt(v_new_phone, gen_salt('bf'))
    where id = v_user_id;
  end if;
end;
$$;

grant execute on function public.update_customer_profile_credentials(bigint, text, text, text, text) to authenticated;
