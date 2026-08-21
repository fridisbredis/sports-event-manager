-- ============================================================================
-- Migration 0027: fix check_rate_limit so release_rate_limit actually works
-- ============================================================================
--
-- F-SEC-08 follow-up. Migration 0026's check_rate_limit incremented `points`
-- on every call, including calls that ended up blocked (points > p_limit).
-- Once a key was over its limit, every further call kept inflating `points`
-- even though it reported allowed=false. That broke release_rate_limit
-- (a plain points = greatest(points-1,0) decrement): one release() call
-- only undoes one increment, but the very next check_rate_limit call would
-- immediately re-increment past the limit before comparing, landing right
-- back at "blocked" even though a point had just been freed.
--
-- Fix: only mutate `points` when a call is actually granted (or when the
-- window has expired and is being reset). A blocked call now leaves
-- `points` untouched, so release_rate_limit's single decrement reliably
-- frees a slot for the next call. This needs plpgsql because the
-- "increment only when granted" decision requires reading the current
-- points/expire and branching before deciding what to write — a single
-- SQL statement's RETURNING can't express that. Row acquisition itself
-- (find-or-create the key's row) is still one atomic INSERT ... ON
-- CONFLICT DO UPDATE ... RETURNING statement, same guarantee the old
-- ON CONFLICT DO UPDATE gave implicitly — see the comment inline below
-- for why a separate INSERT + SELECT ... FOR UPDATE was rejected.
--
-- release_rate_limit itself is unchanged — its behavior was always correct,
-- it was check_rate_limit's over-counting that made it look broken.
-- ============================================================================

create or replace function public.check_rate_limit(
  p_key text, p_limit int, p_duration_seconds int
) returns table (allowed boolean, retry_after_ms bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_points int;
  v_expire timestamptz;
begin
  -- "do update set key = excluded.key" is a no-op write, kept only so the
  -- ON CONFLICT path executes its update-and-lock atomically within this
  -- single statement — RETURNING then always reflects the current row.
  -- A separate INSERT ... DO NOTHING followed by a later SELECT ... FOR
  -- UPDATE would leave a gap where a concurrent call's cleanup delete
  -- (below) could remove this row in between, sending v_points/v_expire
  -- to NULL.
  insert into public.rate_limit_hits as r (key, points, expire)
  values (p_key, 0, now() + make_interval(secs => p_duration_seconds))
  on conflict (key) do update set key = excluded.key
  returning r.points, r.expire into v_points, v_expire;

  if random() < 0.05 then
    delete from public.rate_limit_hits
    where key in (
      select key from public.rate_limit_hits
      where expire <= now() and key <> p_key
      for update skip locked
      limit 100
    );
  end if;

  if v_expire <= now() then
    v_points := 0;
    v_expire := now() + make_interval(secs => p_duration_seconds);
  end if;

  if v_points < p_limit then
    v_points := v_points + 1;
    allowed := true;
    retry_after_ms := 0;
  else
    allowed := false;
    retry_after_ms := greatest(0, extract(epoch from (v_expire - now())) * 1000)::bigint;
  end if;

  update public.rate_limit_hits
  set points = v_points, expire = v_expire
  where key = p_key;

  return next;
end;
$$;

-- Signature is unchanged, but re-assert the grants for clarity/defensiveness.
revoke all on function public.check_rate_limit(text, int, int) from public, anon, authenticated;
grant execute on function public.check_rate_limit(text, int, int) to service_role;

-- ============================================================================
-- DONE
-- ============================================================================
-- Verify with:
--   select prosrc from pg_proc where proname = 'check_rate_limit';
