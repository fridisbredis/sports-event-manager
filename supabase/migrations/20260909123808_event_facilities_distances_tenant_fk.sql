-- ============================================================================
-- Migration 20260909123808: Composite tenant-consistency FKs on
-- event_facilities and event_distances
-- ============================================================================
--
-- SEC-01. Same gap as workstations had before migration 0060: event_id (and,
-- for event_distances, stage_id) only had single-column FKs to events(id) /
-- event_stages(id), with no check that the referenced row belongs to the
-- same tenant_id as the child row. A tenant_admin for tenant A could write
-- facility/distance rows attached to tenant B's event or stage — via a
-- direct INSERT (tenant_admin_manage_event_facilities /
-- tenant_admin_manage_event_distances are FOR ALL policies with a USING
-- predicate on tenant_id alone, no WITH CHECK) or via the
-- sync_event_facilities / sync_event_stages RPCs, neither of which verifies
-- that p_event_id (or a stage's tenant) belongs to p_tenant_id.
--
-- Fixed the same way as 0060: composite foreign keys instead of an
-- RPC-level check, so the invariant holds on every write path — present or
-- future — not just the RPCs. events(id, tenant_id) and
-- event_stages(id, tenant_id) already have UNIQUE constraints from 0060, so
-- no new parent constraint is needed here.
--
-- event_distances also gets a stage_id composite FK: it picked up a
-- single-column stage_id FK in migration 0007 (distances moved to
-- Race-stage level) that has the identical unpinned-tenant gap workstations
-- had pre-0060.
--
-- Verified no pre-existing inconsistent rows before writing this migration
-- (all four queries returned zero rows, run 2026-09-09):
--   select f.id from event_facilities f join events e on e.id = f.event_id
--     where e.tenant_id <> f.tenant_id;
--   select d.id from event_distances d join events e on e.id = d.event_id
--     where e.tenant_id <> d.tenant_id;
--   select d.id from event_distances d join event_stages s on s.id = d.stage_id
--     where d.stage_id is not null and s.tenant_id <> d.tenant_id;
--   Dev (lhflutwvwvzawzbcuwup): 0 rows (all three).
--   Prod (rauvaxuypujbeintnnoe): 0 rows (all three).
--
-- Forward-fix: additive
--   Rollback: a new migration dropping the three composite FKs
--             (event_facilities_event_tenant_fkey,
--             event_distances_event_tenant_fkey,
--             event_distances_stage_tenant_fkey) and restoring the original
--             single-column FKs from 0005/0007:
--               ALTER TABLE event_facilities
--                 ADD CONSTRAINT event_facilities_event_id_fkey
--                   FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;
--               ALTER TABLE event_distances
--                 ADD CONSTRAINT event_distances_event_id_fkey
--                   FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
--                 ADD CONSTRAINT event_distances_stage_id_fkey
--                   FOREIGN KEY (stage_id) REFERENCES event_stages(id) ON DELETE SET NULL;
--   Data:     no data loss — this migration only adds constraints and does
--             not modify any row. Verified above that zero existing rows on
--             dev or prod would fail the new FK validation, so the
--             ALTER TABLE ... ADD CONSTRAINT (which validates all existing
--             rows) is expected to succeed without rejecting anything.
--   Blast:    if reverted, the direct-INSERT/UPDATE and RPC paths become
--             exploitable again (pre-migration behavior) — not a new
--             failure mode.
--   Window:   compatible. Old and new app code send the same columns on
--             every INSERT/UPDATE of these tables, so requests that were
--             valid before remain valid; only requests that were already
--             cross-tenant (invalid in intent) start failing, with a
--             standard Postgres FK-violation error instead of silently
--             succeeding.
-- ============================================================================

-- 1. event_facilities: pin event_id to the same tenant as the row.
ALTER TABLE event_facilities
  DROP CONSTRAINT event_facilities_event_id_fkey;

ALTER TABLE event_facilities
  ADD CONSTRAINT event_facilities_event_tenant_fkey
    FOREIGN KEY (event_id, tenant_id) REFERENCES events(id, tenant_id) ON DELETE CASCADE;

COMMENT ON CONSTRAINT event_facilities_event_tenant_fkey ON event_facilities IS
  'SEC-01: pins event_id to the same tenant_id as the event_facilities row, '
  'closing the direct-INSERT/UPDATE and sync_event_facilities RPC paths for '
  'cross-tenant writes.';

-- 2. event_distances: pin both event_id and stage_id to the same tenant.
ALTER TABLE event_distances
  DROP CONSTRAINT event_distances_event_id_fkey,
  DROP CONSTRAINT event_distances_stage_id_fkey;

ALTER TABLE event_distances
  ADD CONSTRAINT event_distances_event_tenant_fkey
    FOREIGN KEY (event_id, tenant_id) REFERENCES events(id, tenant_id) ON DELETE CASCADE,
  ADD CONSTRAINT event_distances_stage_tenant_fkey
    FOREIGN KEY (stage_id, tenant_id) REFERENCES event_stages(id, tenant_id) ON DELETE SET NULL;

COMMENT ON CONSTRAINT event_distances_event_tenant_fkey ON event_distances IS
  'SEC-01: pins event_id to the same tenant_id as the event_distances row, '
  'closing the direct-INSERT/UPDATE and sync_event_stages RPC paths for '
  'cross-tenant writes.';
COMMENT ON CONSTRAINT event_distances_stage_tenant_fkey ON event_distances IS
  'SEC-01: pins stage_id to the same tenant_id as the event_distances row, '
  'same gap workstations had before migration 0060.';

-- ============================================================================
-- DONE
-- ============================================================================
-- Verify with:
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--   WHERE conrelid IN ('event_facilities'::regclass, 'event_distances'::regclass)
--     AND contype = 'f';
