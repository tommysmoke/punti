-- Conversione punti del 01/11/2026 alle 00:01 Europe/Rome.
-- Il job controlla l'orario locale ogni minuto, esegue una sola volta e poi si rimuove.

alter table public.point_transactions
  add column if not exists store_location text;

do $$
declare
  v_constraint record;
begin
  for v_constraint in
    select conname
    from pg_constraint
    where conrelid = 'public.point_transactions'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ~* 'points\s*>\s*0'
  loop
    execute format('alter table public.point_transactions drop constraint %I', v_constraint.conname);
  end loop;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'point_transactions_points_check'
      and conrelid = 'public.point_transactions'::regclass
  ) then
    alter table public.point_transactions
      add constraint point_transactions_points_check
      check (
        (kind in ('earn', 'redeem') and points > 0)
        or (kind = 'adjust' and points <> 0)
      );
  end if;
end;
$$;

create table if not exists public.points_tier_migration_runs (
  migration_key text primary key,
  status text not null check (status in ('running', 'completed', 'failed', 'failed_permanent')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  attempts integer not null default 0,
  next_retry_at timestamptz,
  changed_customers integer not null default 0,
  total_points_before bigint not null default 0,
  total_points_after bigint not null default 0,
  error_message text
);

alter table public.points_tier_migration_runs
  add column if not exists attempts integer not null default 0,
  add column if not exists next_retry_at timestamptz;

do $$
declare
  v_constraint record;
begin
  for v_constraint in
    select conname
    from pg_constraint
    where conrelid = 'public.points_tier_migration_runs'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%status%'
  loop
    execute format('alter table public.points_tier_migration_runs drop constraint %I', v_constraint.conname);
  end loop;

  alter table public.points_tier_migration_runs
    add constraint points_tier_migration_runs_status_check
    check (status in ('running', 'completed', 'failed', 'failed_permanent'));
end;
$$;

revoke all on table public.points_tier_migration_runs from public, anon, authenticated;

create or replace function public.apply_points_tier_migration()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_key constant text := 'points-tier-migration-2026-11-01';
  v_now_local timestamp := now() at time zone 'Europe/Rome';
  v_status text;
  v_error text;
  v_detail text;
  v_hint text;
  v_attempts integer := 0;
  v_next_retry_at timestamptz;
  v_delay interval;
  v_new_status text;
  v_changed integer := 0;
  v_before bigint := 0;
  v_after bigint := 0;
begin
  if v_now_local < timestamp '2026-11-01 00:01:00' then
    return jsonb_build_object('status', 'waiting', 'local_time', v_now_local);
  end if;

  if not pg_try_advisory_xact_lock(hashtext(v_key)) then
    return jsonb_build_object('status', 'already_running');
  end if;

  insert into public.points_tier_migration_runs (migration_key, status)
  values (v_key, 'running')
  on conflict (migration_key) do nothing;

  select status, attempts, next_retry_at
  into v_status, v_attempts, v_next_retry_at
  from public.points_tier_migration_runs
  where migration_key = v_key
  for update;

  if v_status = 'completed' then
    return jsonb_build_object('status', 'already_completed');
  end if;

  if v_status = 'failed_permanent' then
    return jsonb_build_object('status', 'failed_permanent', 'attempts', v_attempts);
  end if;

  if v_status = 'failed'
     and v_next_retry_at is not null
     and now() < v_next_retry_at then
    return jsonb_build_object('status', 'retry_scheduled', 'attempts', v_attempts, 'next_retry_at', v_next_retry_at);
  end if;

  update public.points_tier_migration_runs
  set status = 'running',
      started_at = now(),
      completed_at = null,
      next_retry_at = null,
      error_message = null
  where migration_key = v_key;

  begin
    create temporary table points_tier_changes (
      customer_id bigint primary key,
      old_points integer not null,
      new_points integer not null,
      delta integer not null
    ) on commit drop;

    insert into points_tier_changes (customer_id, old_points, new_points, delta)
    select
      id,
      points,
      case
        when points = 0 then 0
        when points between 1 and 20 then 10
        when points between 21 and 50 then 25
        else 40
      end,
      case
        when points = 0 then 0
        when points between 1 and 20 then 10 - points
        when points between 21 and 50 then 25 - points
        else 40 - points
      end
    from public.customers
    where points is not null;

    select count(*) filter (where delta <> 0),
           coalesce(sum(old_points), 0),
           coalesce(sum(new_points), 0)
    into v_changed, v_before, v_after
    from points_tier_changes;

    insert into public.point_transactions (
      customer_id,
      kind,
      points,
      note,
      store_location
    )
    select
      customer_id,
      'adjust',
      delta,
      'Conversione punti nuovo metodo 01/11/2026',
      null
    from points_tier_changes
    where delta <> 0;

    update public.customers c
    set points = changes.new_points
    from points_tier_changes changes
    where c.id = changes.customer_id
      and changes.delta <> 0;

    update public.points_tier_migration_runs
    set status = 'completed',
        completed_at = now(),
      next_retry_at = null,
        changed_customers = v_changed,
        total_points_before = v_before,
        total_points_after = v_after,
        error_message = null
    where migration_key = v_key;

    if exists (select 1 from cron.job where jobname = 'points-tier-migration-2026-11-01') then
      perform cron.unschedule('points-tier-migration-2026-11-01');
    end if;

    return jsonb_build_object(
      'status', 'completed',
      'changed_customers', v_changed,
      'total_points_before', v_before,
      'total_points_after', v_after
    );
  exception when others then
    get stacked diagnostics
      v_error = message_text,
      v_detail = pg_exception_detail,
      v_hint = pg_exception_hint;

    v_attempts := coalesce(v_attempts, 0) + 1;
    if v_attempts >= 5 then
      v_new_status := 'failed_permanent';
      v_next_retry_at := null;
    else
      v_new_status := 'failed';
      v_delay := case v_attempts
        when 1 then interval '1 minute'
        when 2 then interval '2 minutes'
        when 3 then interval '5 minutes'
        else interval '15 minutes'
      end;
      v_next_retry_at := now() + v_delay;
    end if;

    update public.points_tier_migration_runs
    set status = v_new_status,
        completed_at = now(),
        attempts = v_attempts,
        next_retry_at = v_next_retry_at,
        changed_customers = 0,
        total_points_before = 0,
        total_points_after = 0,
        error_message = left(concat_ws(' | ', v_error, v_detail, v_hint), 2000)
    where migration_key = v_key;

    if v_new_status = 'failed_permanent'
       and exists (select 1 from cron.job where jobname = 'points-tier-migration-2026-11-01') then
      perform cron.unschedule('points-tier-migration-2026-11-01');
    end if;

    return jsonb_build_object(
      'status', v_new_status,
      'attempts', v_attempts,
      'next_retry_at', v_next_retry_at,
      'error', left(concat_ws(' | ', v_error, v_detail, v_hint), 2000)
    );
  end;
end;
$$;

revoke all on function public.apply_points_tier_migration() from public, anon, authenticated;
grant execute on function public.apply_points_tier_migration() to postgres;

do $outer$
declare
  v_job_id bigint;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise exception 'pg_cron deve essere abilitato prima di questa migration';
  end if;

  for v_job_id in
    select jobid from cron.job where jobname = 'points-tier-migration-2026-11-01'
  loop
    perform cron.unschedule(v_job_id);
  end loop;

  perform cron.schedule(
    'points-tier-migration-2026-11-01',
    '* * * * *',
    $job$select public.apply_points_tier_migration();$job$
  );
end;
$outer$;
