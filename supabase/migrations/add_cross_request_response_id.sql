-- Link cross-request replies to the exact request notification they answer.
-- Replaces fragile title-string matching; the title is kept as a fallback.

alter table public.store_notifications
  add column if not exists response_to_request_id bigint;

alter table public.active_cross_requests
  add column if not exists current_request_notification_id bigint;

create index if not exists store_notifications_response_to_request_idx
  on public.store_notifications(response_to_request_id)
  where response_to_request_id is not null;
