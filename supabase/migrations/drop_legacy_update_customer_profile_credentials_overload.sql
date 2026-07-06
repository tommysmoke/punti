-- Remove legacy 5-arg overload that conflicts with the 6-arg function (p_notes).
-- This prevents ambiguous RPC resolution when callers omit p_notes.

drop function if exists public.update_customer_profile_credentials(
  bigint,
  text,
  text,
  text,
  text
);

grant execute on function public.update_customer_profile_credentials(
  bigint,
  text,
  text,
  text,
  text,
  text
) to authenticated;
