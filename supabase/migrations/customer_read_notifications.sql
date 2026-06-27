-- Allow customers to read their store's broadcast notifications (last 24h)
drop policy if exists "store_notifications_customer_read" on public.store_notifications;
create policy "store_notifications_customer_read" on public.store_notifications
for select using (
  exists (
    select 1
    from public.profiles p
    join public.customers c on c.id = p.customer_id
    where p.id = auth.uid()
      and p.role = 'customer'
      and c.store_id = store_notifications.store_id
  )
);
