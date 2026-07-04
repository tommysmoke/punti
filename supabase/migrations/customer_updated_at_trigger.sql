-- Add updated_at to customers and populate it for existing rows.
alter table public.customers
  add column if not exists updated_at timestamptz not null default now();

update public.customers
  set updated_at = created_at
  where updated_at is null;

-- Trigger to keep updated_at fresh
create or replace function public.update_customer_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_customer_updated_at on public.customers;
create trigger trg_customer_updated_at
  before update on public.customers
  for each row execute function public.update_customer_updated_at();
