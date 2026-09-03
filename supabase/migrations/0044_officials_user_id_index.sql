-- ============================================================================
-- Migration 0044: officials.user_id index
-- ============================================================================
--
-- officials is filtered by user_id on the request-path auth guard
-- (canViewOfficialSurfaces in src/lib/auth/tenant.ts, and the HOME-01 name
-- lookup) but only has an index on tenant_id (0001) and a partial unique
-- index on (tenant_id, phone) for active rows (0020). No index on user_id.
-- F-PERF-03 originally logged this against officials.phone, which turned
-- out to already be covered — the real gap is user_id.
--
-- Forward-fix: additive
--   Rollback: drop index if exists public.officials_user_id_idx;
--   Data:     no data loss
--   Blast:    none — planner falls back to the existing tenant_id index /
--             seq scan, same behavior as before this migration
--   Window:   compatible
-- ============================================================================

create index if not exists officials_user_id_idx on public.officials (user_id);
