-- Enable Supabase Realtime on store_notifications for instant cross-request delivery
alter publication supabase_realtime add table public.store_notifications;
