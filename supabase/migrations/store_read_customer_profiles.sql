-- RPC: store owners can fetch usernames for all customers (bypasses RLS)
create or replace function public.get_customer_usernames(p_customer_ids bigint[])
returns table(customer_id bigint, username text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'store'
  ) then
    return;
  end if;

  return query
  select p.customer_id, p.username
  from public.profiles p
  where p.customer_id = any(p_customer_ids);
end;
$$;
