-- ============================================================================
-- Migration 0057: Composite tenant-consistency FKs on workstations
-- ============================================================================
--
-- SEC-01 follow-up to migration 0056 (PR #145, review by Eduardo).
--
-- 0056 closed the cross-tenant event_id/stage_id gap inside the
-- create_workstation RPC, but that only covers callers going through the
-- RPC. tenant_admin_manage_workstations (0007_stage_model.sql) is a FOR ALL
-- policy with a USING predicate on workstations.tenant_id alone and no
-- WITH CHECK, so a tenant_admin hitting PostgREST directly (a plain INSERT
-- on the workstations table, bypassing the RPC) can still write a row whose
-- event_id/stage_id belongs to a different tenant than tenant_id. The same
-- gap applies to updateWorkstation's direct .update() on stage_id
-- (src/app/(tenant)/[tenantSlug]/admin/workstations/actions.ts).
--
-- This migration makes the invariant impossible to violate from any write
-- path — present or future — by adding composite foreign keys instead of
-- relying on an RPC-level check. events(id) and event_stages(id) each get a
-- companion UNIQUE(id, tenant_id) (harmless: id is already globally unique,
-- this just gives Postgres a composite target to reference), and
-- workstations gets composite FKs on (event_id, tenant_id) and
-- (stage_id, tenant_id) instead of the old single-column FKs. Any row
-- whose event_id/stage_id tenant disagrees with its own tenant_id is now
-- rejected by Postgres itself, regardless of whether the write came through
-- the RPC, a direct INSERT, or a direct UPDATE.
--
-- The 0056 RPC-level check is left in place — cheap belt-and-braces that
-- also gives a friendlier error (WSTN1) than a raw FK-violation for the
-- one path (create_workstation) that already had it.
--
-- Verified no pre-existing inconsistent rows before writing this migration
-- (both queries returned zero rows, run 2026-09-08):
--   select w.id from workstations w join events e on e.id = w.event_id
--     where e.tenant_id <> w.tenant_id;
--   select w.id from workstations w join event_stages s on s.id = w.stage_id
--     where w.stage_id is not null and s.tenant_id <> w.tenant_id;
--   Dev (lhflutwvwvzawzbcuwup): 0 rows.
--   Prod (rauvaxuypujbeintnnoe): 0 rows.
--
-- Forward-fix: destructive
--   Rollback: a new migration dropping the two composite FKs
--             (workstations_event_tenant_fkey, workstations_stage_tenant_fkey)
--             and the two UNIQUE(id, tenant_id) constraints, then restoring
--             the original single-column FKs from 0003/0014:
--               ALTER TABLE workstations
--                 ADD CONSTRAINT workstations_event_id_fkey
--                   FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
--                 ADD CONSTRAINT workstations_stage_id_fkey
--                   FOREIGN KEY (stage_id) REFERENCES event_stages(id) ON DELETE CASCADE;
--   Data:     no data loss. This migration only adds constraints; it does
--             not modify any row. Verified above that zero existing rows
--             on dev or prod would fail the new FK validation, so the
--             ALTER TABLE ... ADD CONSTRAINT (which validates all existing
--             rows) is expected to succeed without rejecting anything.
--   Blast:    if reverted, the direct-INSERT/UPDATE path becomes exploitable
--              again (pre-0057 behavior) — not a new failure mode.
--   Window:   compatible. No application code reads or writes the new
--             UNIQUE(id, tenant_id) constraints directly — they exist only
--             as the composite FK target. Old and new app code both send
--             the same columns on every INSERT/UPDATE of workstations, so
--             requests that were valid before remain valid; only requests
--             that were already cross-tenant (invalid in intent) start
--             failing, with a standard Postgres FK-violation error instead
--             of silently succeeding.
-- ============================================================================

-- 1. Give Postgres a composite key to reference on each parent table.
--    id is already globally unique (PK), so this adds no new constraint
--    surface beyond what a composite FK requires.
ALTER TABLE events
  ADD CONSTRAINT events_id_tenant_id_key UNIQUE (id, tenant_id);

ALTER TABLE event_stages
  ADD CONSTRAINT event_stages_id_tenant_id_key UNIQUE (id, tenant_id);

-- 2. Replace workstations' single-column FKs with composite ones that also
--    pin tenant_id. Preserves the existing ON DELETE CASCADE behavior from
--    0003 (event_id) and 0014 (stage_id).
ALTER TABLE workstations
  DROP CONSTRAINT workstations_event_id_fkey,
  DROP CONSTRAINT workstations_stage_id_fkey;

ALTER TABLE workstations
  ADD CONSTRAINT workstations_event_tenant_fkey
    FOREIGN KEY (event_id, tenant_id) REFERENCES events(id, tenant_id) ON DELETE CASCADE,
  ADD CONSTRAINT workstations_stage_tenant_fkey
    FOREIGN KEY (stage_id, tenant_id) REFERENCES event_stages(id, tenant_id) ON DELETE CASCADE;

COMMENT ON CONSTRAINT workstations_event_tenant_fkey ON workstations IS
  'SEC-01 (migration 0057): pins event_id to the same tenant_id as the workstation row, '
  'closing the direct-INSERT/UPDATE path that the create_workstation RPC guard (0056) cannot reach.';
COMMENT ON CONSTRAINT workstations_stage_tenant_fkey ON workstations IS
  'SEC-01 (migration 0057): pins stage_id to the same tenant_id as the workstation row, '
  'closing the direct-INSERT/UPDATE path that the create_workstation RPC guard (0056) cannot reach.';

-- ============================================================================
-- DONE
-- ============================================================================
-- Verify with:
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--   WHERE conrelid = 'workstations'::regclass AND contype = 'f';
--
--   SELECT conname FROM pg_constraint
--   WHERE conrelid IN ('events'::regclass, 'event_stages'::regclass) AND contype = 'u';
