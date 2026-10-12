-- Fase 2 (restrittiva) del cascade server-side.
-- Eseguire solo dopo add_server_cross_cascade.sql, dopo il rilascio del frontend che usa
-- create_cross_request e dopo la ricarica dei dispositivi che eseguivano il vecchio frontend:
-- da questo momento i client non possono più scrivere lo stato attivo né avanzare il cascade.

drop policy if exists "active_cross_requests_store_insert" on public.active_cross_requests;
drop policy if exists "active_cross_requests_store_update" on public.active_cross_requests;
drop policy if exists "active_cross_requests_store_delete" on public.active_cross_requests;
revoke insert, update, delete on public.active_cross_requests from anon, authenticated;

do $$
begin
  if to_regprocedure('public.advance_cross_request(integer,integer,text)') is not null then
    revoke all on function public.advance_cross_request(int, int, text) from public, anon, authenticated;
  end if;
end;
$$;

-- Rollback: ricreare le policy di add_active_cross_requests.sql, poi
--   grant insert, update, delete on public.active_cross_requests to authenticated;
--   grant execute on function public.advance_cross_request(int, int, text) to authenticated;
