-- Run this in Supabase SQL editor

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('store', 'customer')),
  store_id uuid,
  customer_id bigint
);

alter table public.profiles
  add column if not exists username text;

create unique index if not exists profiles_username_unique_ci
  on public.profiles (lower(username))
  where username is not null;

create table if not exists public.customers (
  id bigint generated always as identity primary key,
  store_id uuid not null,
  name text not null,
  phone text not null unique,
  points integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.point_transactions (
  id bigint generated always as identity primary key,
  customer_id bigint not null references public.customers(id) on delete cascade,
  kind text not null check (kind in ('earn', 'redeem')),
  points integer not null check (points > 0),
  note text,
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_customer_fk'
  ) then
    alter table public.profiles
      add constraint profiles_customer_fk
      foreign key (customer_id) references public.customers(id)
      on delete set null;
  end if;
end
$$;

alter table public.profiles enable row level security;
alter table public.customers enable row level security;
alter table public.point_transactions enable row level security;

drop policy if exists "profile_read_own" on public.profiles;
create policy "profile_read_own" on public.profiles
for select using (auth.uid() = id);

drop policy if exists "customers_store_read" on public.customers;
create policy "customers_store_read" on public.customers
for select using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'store'
      and p.store_id = customers.store_id
  )
);

drop policy if exists "customers_store_insert" on public.customers;
create policy "customers_store_insert" on public.customers
for insert with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'store'
      and p.store_id = customers.store_id
  )
);

drop policy if exists "customers_customer_read_self" on public.customers;
create policy "customers_customer_read_self" on public.customers
for select using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'customer'
      and p.customer_id = customers.id
  )
);

drop policy if exists "tx_store_read" on public.point_transactions;
create policy "tx_store_read" on public.point_transactions
for select using (
  exists (
    select 1
    from public.customers c
    join public.profiles p on p.store_id = c.store_id
    where p.id = auth.uid()
      and p.role = 'store'
      and c.id = point_transactions.customer_id
  )
);

drop policy if exists "tx_customer_read_self" on public.point_transactions;
create policy "tx_customer_read_self" on public.point_transactions
for select using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'customer'
      and p.customer_id = point_transactions.customer_id
  )
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_store_id uuid;
  v_customer_id bigint;
  v_name text;
  v_phone text;
  v_username text;
begin
  v_role := coalesce(new.raw_user_meta_data ->> 'role', '');

  if v_role = 'customer' then
    if coalesce(new.raw_user_meta_data ->> 'store_id', '') <> '' then
      begin
        v_store_id := (new.raw_user_meta_data ->> 'store_id')::uuid;
      exception when others then
        raise exception 'Codice negozio non valido';
      end;
    else
      select p.store_id
      into v_store_id
      from public.profiles p
      where p.role = 'store'
        and p.store_id is not null
      order by p.id
      limit 1;
    end if;

    if v_store_id is null then
      raise exception 'Nessun negozio disponibile per la registrazione';
    end if;

    if not exists (
      select 1
      from public.profiles p
      where p.role = 'store'
        and p.store_id = v_store_id
    ) then
      raise exception 'Codice negozio non trovato';
    end if;

    v_name := coalesce(nullif(new.raw_user_meta_data ->> 'name', ''), 'Nuovo cliente');
    v_phone := coalesce(nullif(new.raw_user_meta_data ->> 'phone', ''), new.email);
    v_username := lower(regexp_replace(coalesce(new.raw_user_meta_data ->> 'username', ''), '[^a-zA-Z0-9]', '', 'g'));

    if v_username = '' then
      raise exception 'Username mancante';
    end if;

    insert into public.customers (store_id, name, phone, points)
    values (v_store_id, v_name, v_phone, 0)
    returning id into v_customer_id;

    insert into public.profiles (id, role, store_id, customer_id, username)
    values (new.id, 'customer', null, v_customer_id, v_username)
    on conflict (id) do update
      set role = excluded.role,
          store_id = excluded.store_id,
          customer_id = excluded.customer_id,
          username = excluded.username;
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.is_username_available(p_username text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_username text;
begin
  v_username := lower(regexp_replace(coalesce(p_username, ''), '[^a-zA-Z0-9]', '', 'g'));

  if v_username = '' then
    return false;
  end if;

  return not exists (
    select 1
    from public.profiles p
    where lower(p.username) = v_username
  );
end;
$$;

grant execute on function public.is_username_available(text) to anon, authenticated;

create or replace function public.resolve_login_email(p_identifier text)
returns text
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_identifier text;
  v_username text;
  v_email text;
begin
  v_identifier := lower(trim(coalesce(p_identifier, '')));

  if v_identifier = '' then
    return null;
  end if;

  if position('@' in v_identifier) > 0 then
    return v_identifier;
  end if;

  v_username := lower(regexp_replace(v_identifier, '[^a-zA-Z0-9]', '', 'g'));

  select u.email
  into v_email
  from public.profiles p
  join auth.users u on u.id = p.id
  where lower(p.username) = v_username
  limit 1;

  if v_email is not null then
    return v_email;
  end if;

  select u.email
  into v_email
  from public.customers c
  join public.profiles p on p.customer_id = c.id
  join auth.users u on u.id = p.id
  where c.phone = regexp_replace(v_identifier, '\\D', '', 'g')
  limit 1;

  return v_email;
end;
$$;

grant execute on function public.resolve_login_email(text) to anon, authenticated;

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
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'store'
      and p.store_id = v_store_id
  ) then
    raise exception 'Permesso negato';
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
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'store'
      and p.store_id = v_store_id
  ) then
    raise exception 'Permesso negato';
  end if;

  if v_current_points < p_points then
    raise exception 'Saldo punti insufficiente';
  end if;

  insert into public.point_transactions (customer_id, kind, points, note)
  values (p_customer_id, 'redeem', p_points, coalesce(p_note, 'Redemption'));

  update public.customers
  set points = points - p_points
  where id = p_customer_id;
end;
$$;

grant execute on function public.record_redeem(bigint, integer, text) to authenticated;

create or replace function public.delete_point_transaction(
  p_transaction_id bigint
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer_id bigint;
  v_store_id uuid;
  v_kind text;
  v_points integer;
  v_current_points integer;
begin
  select pt.customer_id, pt.kind, pt.points, c.store_id, c.points
  into v_customer_id, v_kind, v_points, v_store_id, v_current_points
  from public.point_transactions pt
  join public.customers c on c.id = pt.customer_id
  where pt.id = p_transaction_id;

  if v_customer_id is null then
    raise exception 'Movimento non trovato';
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

  if v_kind = 'earn' then
    if v_current_points < v_points then
      raise exception 'Impossibile eliminare il movimento: il saldo attuale diventerebbe negativo';
    end if;

    update public.customers
    set points = points - v_points
    where id = v_customer_id;
  elsif v_kind = 'redeem' then
    update public.customers
    set points = points + v_points
    where id = v_customer_id;
  else
    raise exception 'Tipo movimento non valido';
  end if;

  delete from public.point_transactions
  where id = p_transaction_id;
end;
$$;

grant execute on function public.delete_point_transaction(bigint) to authenticated;

create or replace function public.delete_customer_account(
  p_customer_id bigint
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_store_id uuid;
  v_user_id uuid;
begin
  select c.store_id
  into v_store_id
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

  if v_user_id is not null then
    delete from auth.identities
    where user_id = v_user_id;

    delete from auth.users
    where id = v_user_id;
  end if;

  delete from public.customers
  where id = p_customer_id;
end;
$$;

grant execute on function public.delete_customer_account(bigint) to authenticated;

create or replace function public.admin_reset_customer_password(
  p_customer_id bigint,
  p_new_password text
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_store_id uuid;
  v_user_id uuid;
begin
  select c.store_id into v_store_id
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

  select p.id into v_user_id
  from public.profiles p
  where p.customer_id = p_customer_id
  limit 1;

  if v_user_id is null then
    raise exception 'Account cliente non trovato';
  end if;

  update auth.users
  set encrypted_password = crypt(p_new_password, gen_salt('bf'))
  where id = v_user_id;
end;
$$;

grant execute on function public.admin_reset_customer_password(bigint, text) to authenticated;

create or replace function public.create_customer_account(
  p_name text,
  p_phone text,
  p_username text,
  p_password text
)
returns json
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_store_id uuid;
  v_user_id uuid;
  v_email text;
  v_username text;
  v_phone text;
  v_existing_customer_name text;
  v_instance_id uuid;
begin
  -- Verifica che chi chiama sia uno store
  select p.store_id into v_store_id
  from public.profiles p
  where p.id = auth.uid() and p.role = 'store';

  select u.instance_id into v_instance_id
  from auth.users u
  where u.id = auth.uid();

  if v_store_id is null then
    raise exception 'Permesso negato';
  end if;

  if v_instance_id is null then
    raise exception 'Impossibile determinare instance_id auth';
  end if;

  v_username := lower(regexp_replace(coalesce(p_username, ''), '[^a-zA-Z0-9]', '', 'g'));
  v_phone := regexp_replace(coalesce(p_phone, ''), '\\D', '', 'g');

  if v_username = '' then
    raise exception 'Username non valido';
  end if;

  if v_phone = '' then
    raise exception 'Telefono non valido';
  end if;

  -- Controlla username duplicato
  if exists (
    select 1 from public.profiles p
    where lower(p.username) = v_username
  ) then
    raise exception 'Username già in uso: %', v_username;
  end if;

  -- Controlla telefono duplicato
  select c.name
  into v_existing_customer_name
  from public.customers c
  where c.phone = v_phone
  limit 1;

  if v_existing_customer_name is not null then
    raise exception 'Telefono già registrato: % (cliente: %)', v_phone, v_existing_customer_name;
  end if;

  v_email := v_username || '@emailnonesiste.it';
  v_user_id := gen_random_uuid();

  -- Crea utente in auth.users (il trigger handle_new_user crea customers e profiles)
  insert into auth.users (
    id, instance_id, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, role, aud,
    confirmation_token, recovery_token,
    email_change_token_new, email_change_token_current, phone
  ) values (
    v_user_id,
    v_instance_id,
    v_email,
    crypt(p_password, gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('role', 'customer', 'name', p_name, 'phone', v_phone, 'username', v_username, 'store_id', v_store_id),
    now(), now(), 'authenticated', 'authenticated',
    '', '', '', '', ''
  );

  -- Force auto-confirm for synthetic emails used by this app.
  update auth.users
  set email_confirmed_at = now(),
      updated_at = now()
  where id = v_user_id;

  -- Some Supabase versions also track a generic confirmed_at / tokens.
  begin
    execute 'update auth.users set confirmed_at = now() where id = $1'
      using v_user_id;
  exception
    when undefined_column then
      null;
    when sqlstate '428C9' then
      null;
  end;

  begin
    execute 'update auth.users set confirmation_token = '''' where id = $1'
      using v_user_id;
  exception
    when undefined_column then
      null;
  end;

  -- Necessario per il login: crea l'identity email
  insert into auth.identities (
    id, user_id, provider_id, identity_data, provider,
    last_sign_in_at, created_at, updated_at
  ) values (
    v_user_id,
    v_user_id,
    v_email,
    jsonb_build_object('sub', v_user_id::text, 'email', v_email),
    'email',
    now(), now(), now()
  );

  -- Ensure dashboard filters can match by email on identity metadata.
  update auth.identities
  set provider_id = v_email,
      identity_data = coalesce(identity_data, '{}'::jsonb) || jsonb_build_object(
        'sub', v_user_id::text,
        'email', v_email,
        'email_verified', true
      )
  where user_id = v_user_id
    and provider = 'email';

  -- Some Supabase versions expose a physical email column on auth.identities.
  begin
    execute 'update auth.identities set email = $1 where user_id = $2 and provider = ''email'''
      using v_email, v_user_id;
  exception
    when undefined_column then
      null;
    when sqlstate '428C9' then
      null;
  end;

  return json_build_object('username', v_username);
end;
$$;

grant execute on function public.create_customer_account(text, text, text, text) to authenticated;

create or replace function public.admin_reset_store_password(
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

grant execute on function public.admin_reset_store_password(text, text) to authenticated;

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
  v_hashed_password text;
begin
  select p.id
  into v_target_id
  from public.profiles p
  where lower(p.username) = lower(regexp_replace(coalesce(p_username, ''), '[^a-zA-Z0-9]', '', 'g'))
    and p.role = 'store'
  limit 1;

  if v_target_id is null then
    raise exception 'Socio non trovato';
  end if;

  -- Use Supabase's built-in hashing
  update auth.users
  set encrypted_password = crypt(p_new_password, crypt(p_new_password, gen_salt('bf')))
  where id = v_target_id;
end;
$$;

grant execute on function public.reset_store_password_public(text, text) to anon, authenticated;
