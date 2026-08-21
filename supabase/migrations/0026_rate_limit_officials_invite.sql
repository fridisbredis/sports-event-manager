-- ============================================================================
-- Migration 0026: rate limiting for officials invite endpoints
-- ============================================================================
--
-- F-SEC-08: Postgres-based rate limiting for officials invite endpoints
-- (POST /api/officials, POST /api/officials/[id]/resend).
--
-- Admin-keyed rows (invite:admin:<userId>) are bounded by tenant-admin
-- headcount. Phone-keyed rows (invite:phone:<tenantId>:<phone>) are the
-- only unbounded growth dimension in this table — that's why cleanup
-- below only needs to run opportunistically (probabilistic, inline with
-- normal traffic), not via a scheduled pg_cron job.
-- ============================================================================

create table if not exists public.rate_limit_hits (
  key    text primary key,
  points int not null,
  expire timestamptz not null
);

create index if not exists rate_limit_hits_expire_idx on public.rate_limit_hits (expire);

revoke all on public.rate_limit_hits from anon, authenticated;

-- Deny-all: not tenant-scoped, so the 0004 tenant_admin/tenant_member policy pattern doesn't apply. Layered on top of the REVOKE above as a backstop against a future accidental re-grant.
alter table public.rate_limit_hits enable row level security;

create or replace function public.check_rate_limit(
  p_key text, p_limit int, p_duration_seconds int
) returns table (allowed boolean, retry_after_ms bigint)
language sql
security definer
set search_path = public
as $$
  with hit as (
    insert into public.rate_limit_hits as r (key, points, expire)
    values (p_key, 1, now() + make_interval(secs => p_duration_seconds))
    on conflict (key) do update
      set points = case when r.expire <= now() then 1 else r.points + 1 end,
          expire = case when r.expire <= now()
                        then now() + make_interval(secs => p_duration_seconds)
                        else r.expire end
    returning r.points, r.expire
  ),
  cleanup as (
    delete from public.rate_limit_hits
    where expire <= now() and key <> p_key and random() < 0.05
  )
  select hit.points <= p_limit,
         greatest(0, extract(epoch from (hit.expire - now())) * 1000)::bigint
  from hit;
$$;

create or replace function public.release_rate_limit(p_key text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.rate_limit_hits
  set points = greatest(points - 1, 0)
  where key = p_key and expire > now();
$$;

revoke all on function public.check_rate_limit(text, int, int) from public, anon, authenticated;
grant execute on function public.check_rate_limit(text, int, int) to service_role;

revoke all on function public.release_rate_limit(text) from public, anon, authenticated;
grant execute on function public.release_rate_limit(text) to service_role;

-- ============================================================================
-- DONE
-- ============================================================================
-- Verify with:
--   select proname, prosecdef, proconfig, proacl
--   from pg_proc where proname in ('check_rate_limit', 'release_rate_limit');
