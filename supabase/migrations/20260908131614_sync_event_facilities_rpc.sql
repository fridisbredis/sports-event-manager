-- ============================================================================
-- Migration 20260908131614: sync_event_facilities RPC
-- ============================================================================
--
-- REL-01: saveEvent() in src/app/(tenant)/[tenantSlug]/admin/event/actions.ts
-- replaces event_facilities via two separate statements with no surrounding
-- transaction: delete all existing facilities for the event, then insert the
-- new set. A failure on the insert (e.g. a malformed row) left the delete
-- already committed — the event silently ends up with zero facilities
-- instead of either its old set or its new one. Same defect class already
-- fixed for event_stages via sync_event_stages (migration 0005).
--
-- This RPC wraps both statements in one transaction, same pattern as
-- sync_event_stages: a failure on the insert rolls back the delete too. See
-- docs/patterns/atomic-multi-table-writes.md for when this pattern applies
-- generally.
--
-- Runs as SECURITY INVOKER (default) so the caller's RLS context applies.
-- The application layer (saveEvent server action) verifies tenant_admin
-- role before calling this function; RLS on event_facilities
-- (tenant_admin_manage_event_facilities, migration 0005) provides a second
-- layer.
--
-- Parameters:
--   p_event_id   — the event whose facilities are being replaced
--   p_tenant_id  — used in the DELETE filter and INSERT rows
--   p_facilities — JSON array: [{label, position}, ...]. Rows with a blank
--                  or missing label are silently skipped, matching
--                  sync_event_stages' handling of a blank name.
--
-- Forward-fix: additive
--   Rollback: drop function if exists public.sync_event_facilities(uuid, uuid, jsonb);
--   Data:     no data loss — this only adds a new function, no existing
--             table or row is touched.
--   Blast:    none until the app is changed to call it; the old two-step
--             delete+insert code path in saveEvent() keeps working
--             unmodified until that follow-up change lands.
--   Window:   compatible — additive, no schema old code depends on changes.
-- ============================================================================

create or replace function public.sync_event_facilities(
  p_event_id   uuid,
  p_tenant_id  uuid,
  p_facilities jsonb
)
returns void
language plpgsql
as $$
begin
  delete from event_facilities
  where event_id = p_event_id and tenant_id = p_tenant_id;

  insert into event_facilities (event_id, tenant_id, label, position)
  select
    p_event_id,
    p_tenant_id,
    (f->>'label')::text,
    coalesce((f->>'position')::integer, 0)
  from jsonb_array_elements(p_facilities) as f
  where trim((f->>'label')::text) <> '' and (f->>'label') is not null;
end;
$$;

comment on function public.sync_event_facilities is
  'REL-01: atomically replaces all facilities for p_event_id within one '
  'transaction (delete + insert), same pattern as sync_event_stages '
  '(migration 0005). Caller must be authenticated with tenant_admin or '
  'system_admin role (enforced by app layer + RLS).';

-- SECURITY INVOKER (default) function relying on RLS, same as
-- sync_event_stages — no explicit grant/revoke needed beyond the default
-- PUBLIC execute grant, matching that function's precedent.

-- ============================================================================
-- DONE
-- ============================================================================
-- Verify with:
--   select proname from pg_proc where proname = 'sync_event_facilities';
