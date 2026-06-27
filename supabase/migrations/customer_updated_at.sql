-- Add updated_at to customers for ordering by most recent activity
alter table public.customers add column if not exists updated_at timestamptz;

-- Backfill existing rows: use most recent transaction date, fallback to creation date
update public.customers
set updated_at = coalesce(
  (select max(created_at) from public.point_transactions where customer_id = customers.id),
  created_at
);

-- Trigger: update customer timestamp on new point_transaction
create or replace function public.update_customer_timestamp()
returns trigger
language plpgsql
as $$
begin
  update public.customers set updated_at = now() where id = new.customer_id;
  return new;
end;
$$;

drop trigger if exists trg_customer_points_updated on public.point_transactions;
create trigger trg_customer_points_updated
after insert on public.point_transactions
for each row execute function public.update_customer_timestamp();

-- Trigger: set initial updated_at on customer creation
create or replace function public.set_customer_initial_timestamp()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_customer_created on public.customers;
create trigger trg_customer_created
before insert on public.customers
for each row execute function public.set_customer_initial_timestamp();
