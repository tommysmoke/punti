-- Allow NULL fcm_token for customers without service worker support
-- This enables fallback registration when Firebase service worker fails

ALTER TABLE public.push_subscriptions
ALTER COLUMN fcm_token DROP NOT NULL;
