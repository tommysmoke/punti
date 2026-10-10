-- Promo Instagram: marca se il cliente ha usato la promo (cerchio rosso).
alter table public.customers
  add column if not exists ig_promo boolean not null default false;
