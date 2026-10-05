-- Forward-fix: destructive
--   Rollback: drop function public.purge_stale_otps();
--   Data:     no snapshot required (constraint-only): defines a function,
--             does not call it
--   Blast:    none until the function is scheduled
--   Window:   compatible
create or replace function public.purge_stale_otps()
returns void
language plpgsql
security definer
as $$
begin
  DELETE FROM public.otp_attempts WHERE created_at < now() - interval '24 hours';
end;
$$;
