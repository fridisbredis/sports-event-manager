-- ============================================================================
-- Migration 0049: cache_rpc_reader role (PERF-06 / F-PERF-04, Phase 0)
-- ============================================================================
--
-- Phase 0 of the ADR-0003 caching design (docs/adr/0003-caching-position-for
-- -read-heavy-pages.md, PR #129 — still Proposed, not Accepted, at time of
-- writing). The ADR's Group 1 caching mechanism (unstable_cache wrapping a
-- SECURITY DEFINER RPC, called via the service-role client) only stays
-- fail-closed if that RPC's owner cannot bypass RLS. service_role and
-- postgres both have rolbypassrls = true in this Supabase setup (empirically
-- confirmed, see the ADR's verification section) — owning the RPC by either
-- reproduces the exact cross-tenant leak the design exists to close.
--
-- This migration only creates the role. It grants no table access and owns
-- no function yet — each Group 1 RPC (Phase 1 onward, starting with the
-- HOME-01 pilot) adds its own per-table SELECT grant and takes ownership of
-- its own function. NOBYPASSRLS is Postgres's default for a new role; it is
-- stated explicitly here anyway because the ADR's reviewable check is a
-- direct query (`select rolbypassrls from pg_roles where rolname = ...`),
-- not an inference from omission — the migration should read the same way
-- the check does. NOLOGIN because nothing ever connects as this role
-- directly; it is only ever assumed via SECURITY DEFINER. NOINHERIT so it
-- never gains privileges through role membership by accident.
--
-- Forward-fix: additive
--   Rollback: drop role if exists cache_rpc_reader;
--             (Only safe once no function/grant depends on it — none do as
--             of this migration.)
--   Data:     No data loss — no table or row is touched.
--   Blast:    None. No existing function, grant, or policy references this
--             role yet; creating it changes no runtime behavior.
--   Window:   Compatible. Old and new code are both unaffected — nothing
--             calls this role until Phase 1's RPC migration lands.
-- ============================================================================

do $$
begin
  if not exists (select from pg_roles where rolname = 'cache_rpc_reader') then
    create role cache_rpc_reader nologin noinherit nobypassrls;
  end if;
end
$$;
