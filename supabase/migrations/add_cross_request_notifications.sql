-- Add kind and target_store to store_notifications for cross-inventory requests
alter table public.store_notifications
  add column if not exists kind text not null default 'broadcast';

alter table public.store_notifications
  add column if not exists target_store text;

create index if not exists store_notifications_target_store_idx
  on public.store_notifications(target_store)
  where target_store is not null;
