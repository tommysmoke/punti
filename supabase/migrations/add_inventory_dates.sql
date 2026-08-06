-- Add last_carico and last_scarico columns per store to shared_inventory
alter table public.shared_inventory
  add column if not exists last_carico_quarto text,
  add column if not exists last_carico_castenaso text,
  add column if not exists last_carico_bologna text,
  add column if not exists last_carico_san_lazzaro text,
  add column if not exists last_scarico_quarto text,
  add column if not exists last_scarico_castenaso text,
  add column if not exists last_scarico_bologna text,
  add column if not exists last_scarico_san_lazzaro text;
