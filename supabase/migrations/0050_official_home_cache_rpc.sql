-- ============================================================================
-- Migration 0050: get_official_home_cached RPC (PERF-06 / F-PERF-04, Phase 1)
-- ============================================================================
--
-- Phase 1 pilot of the ADR-0003 caching design (docs/adr/0003-caching-
-- position-for-read-heavy-pages.md, PR #129 — still Proposed at time of
-- writing) on HOME-01 (src/app/(official)/[tenantSlug]/home/page.tsx). Group
-- 1 in the ADR (event-info, admin/event, admin/workstations) is tenant-scoped
-- only. HOME-01 is narrower: an official's own officials row, filtered by
-- (tenant_id, user_id) both — the "own-row filter" shape the ADR itself
-- flagged as untested, since it needs a second session variable
-- (app.user_id) to reach RLS the same fail-closed way app.tenant_id does.
--
-- Same fail-closed reasoning as the ADR's tenant-only case: the cached
-- function can't use the session-cookie client (unstable_cache can't read
-- cookies()), so it has to call this RPC through the service-role client —
-- and service_role has rolbypassrls = true in this Supabase setup, so a
-- plain RPC would skip RLS entirely. This RPC is SECURITY DEFINER, owned by
-- cache_rpc_reader (migration 0049, rolbypassrls = false, empirically
-- verified against this exact leak in the ADR's local-stack testing), so RLS
-- is evaluated against that low-privilege owner regardless of which client
-- calls it.
--
-- search_path = '' (not the `public` this project's other SECURITY DEFINER
-- functions pin — 0017, 0018, 0022, 0026-0030, 0043, 0045, 0046 all use
-- `set search_path = public`, not `''`; the ADR cites 0040 as the precedent
-- for `''` but 0040 is SECURITY INVOKER, not DEFINER, so that citation
-- doesn't actually support the claim). `''` is the stricter, Postgres-
-- recommended hardening for a SECURITY DEFINER function and is what this
-- migration uses, with every object reference schema-qualified below
-- (pg_catalog.set_config; current_setting and jsonb_build_object are
-- pg_catalog too and resolve regardless, since pg_catalog is always
-- implicitly searched first). This is a deliberate deviation from this
-- project's existing SECURITY DEFINER precedent, not an oversight — flagged
-- here so a reviewer doesn't "fix" it back to `public` assuming consistency
-- was the goal.
--
-- Per this project's RPC guard convention (grants control callability, not
-- Zod): EXECUTE excludes anon/authenticated, matching migration 0026's
-- two-statement form (revoke from public+anon+authenticated, then grant to
-- service_role) — a bare `revoke ... from public` alone would leave
-- Supabase's automatic per-role grants in place, the exact gap that
-- silently re-exposed check_rate_limit, get_last_sign_in_at,
-- anonymize_inactive_users, and claim_sms_queue_batch previously.
--
-- invite_status = 'confirmed' is a business-logic filter inside the RPC body
-- (matching home/page.tsx's existing query), not a security boundary — the
-- RLS policy below is purely about tenant/user isolation.
--
-- Forward-fix: additive
--   Rollback: drop function if exists public.get_official_home_cached(uuid, uuid);
--             drop policy if exists "cache_rpc_reader_read_own_officials" on public.officials;
--             alter table public.officials no force row level security;
--             (leaves cache_rpc_reader itself, and its membership grant to
--             postgres, in place — 0049 owns the role's own rollback, and
--             the membership grant is inert with no function left owned by
--             cache_rpc_reader to act through)
--   Data:     No data loss — read-only function, no table contents change.
--   Blast:    None until the app code in this same PR switches home/page.tsx
--             to call this RPC. Existing officials RLS policies (0002/0004)
--             are untouched; this adds one new additive policy scoped
--             `to cache_rpc_reader` only, which no other role has ever been
--             evaluated against.
--   Window:   Compatible. Old code (still doing the direct .from('officials')
--             read) is unaffected — this migration adds new objects it
--             doesn't touch. FORCE ROW LEVEL SECURITY on officials is a
--             backstop against a future ownership mistake (per the ADR), not
--             load-bearing today: officials' owner is the migration-running
--             role, which has BYPASSRLS in this setup, so this flag changes
--             no behavior for any role until that invariant is ever broken.
-- ============================================================================

drop policy if exists "cache_rpc_reader_read_own_officials" on public.officials;
create policy "cache_rpc_reader_read_own_officials"
  on public.officials for select
  to cache_rpc_reader
  using (
    current_setting('app.tenant_id', true) = tenant_id::text
    and current_setting('app.user_id', true) = user_id::text
  );

alter table public.officials force row level security;

create or replace function public.get_official_home_cached(p_tenant_id uuid, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  perform pg_catalog.set_config('app.tenant_id', p_tenant_id::text, true);
  perform pg_catalog.set_config('app.user_id', p_user_id::text, true);

  select o.name into v_name
  from public.officials o
  where o.tenant_id = p_tenant_id
    and o.user_id = p_user_id
    and o.invite_status = 'confirmed'
  order by o.created_at desc
  limit 1;

  -- Reset both GUCs before returning, matching 0051-0055. Not load-bearing on
  -- its own: set_config(..., true) is transaction-local and each PostgREST
  -- call is its own transaction, and a stale app.user_id would narrow a later
  -- read rather than widen it (0055's policy treats a set app.user_id as the
  -- own-row case). Done anyway so every cache RPC states its scope on entry
  -- and leaves none behind, instead of this one function being the exception.
  perform pg_catalog.set_config('app.user_id', '', true);
  perform pg_catalog.set_config('app.tenant_id', '', true);

  return jsonb_build_object('name', v_name);
end;
$$;

revoke all on function public.get_official_home_cached(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_official_home_cached(uuid, uuid) to service_role;

grant select on public.officials to cache_rpc_reader;

-- Reassigning ownership requires the migration-running role to be a member
-- of the target role first (plain Postgres rule: ALTER ... OWNER TO needs
-- SET ROLE on the new owner, and Supabase's local/hosted `postgres` role is
-- not a superuser, unlike a vanilla local Postgres install). Documented
-- Supabase pattern for a custom function-owner role — see
-- https://supabase.com/docs/guides/database/postgres/roles. Left in place
-- deliberately, not revoked after: postgres already has BYPASSRLS and
-- superuser-adjacent privileges independent of this membership, so it grants
-- no additional reach, and revoking it would break any future migration
-- that needs to alter this function again.
grant cache_rpc_reader to postgres;
-- Postgres (since the CVE-2018-1058-era hardening) also requires the new
-- owner to hold CREATE on the containing schema before ALTER ... OWNER TO
-- will reassign an object to it — ownership reassignment is treated as
-- equivalent to being able to (re)create the object there. This does not
-- let cache_rpc_reader create arbitrary objects in practice: it is NOLOGIN
-- and only ever runs inside a SECURITY DEFINER call, never connected to
-- directly.
grant create on schema public to cache_rpc_reader;
alter function public.get_official_home_cached(uuid, uuid) owner to cache_rpc_reader;
