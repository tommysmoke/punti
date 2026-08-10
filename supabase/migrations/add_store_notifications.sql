-- Add store_notifications table for broadcast communications

create table if not exists public.store_notifications (
  id bigint generated always as identity primary key,
  store_id uuid not null,
  title text not null,
  body text not null,
  created_by uuid not null references auth.users(id) on delete cascade,
  sent_count integer default 0,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

-- Create index for faster queries
create index if not exists store_notifications_store_id_idx
  on public.store_notifications(store_id);

create index if not exists store_notifications_created_at_idx
  on public.store_notifications(created_at desc);

-- Enable RLS
alter table public.store_notifications enable row level security;

-- Only stores can read their own notifications
drop policy if exists "store_notifications_store_read" on public.store_notifications;
create policy "store_notifications_store_read" on public.store_notifications
for select using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'store'
      and p.store_id = store_notifications.store_id
  )
);

-- Only stores can insert their own notifications
drop policy if exists "store_notifications_store_insert" on public.store_notifications;
create policy "store_notifications_store_insert" on public.store_notifications
for insert with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'store'
      and p.store_id = store_notifications.store_id
  )
  and created_by = auth.uid()
);

-- Stores can update their own notifications (needed for aggregated cross-request responses)
DROP POLICY IF EXISTS "store_notifications_store_update" ON public.store_notifications;
CREATE POLICY "store_notifications_store_update" ON public.store_notifications
FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role = 'store'
      AND p.store_id = store_notifications.store_id
  )
);
