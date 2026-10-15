-- ============================================================================
-- Migration 20261015122735: audit actions for tenant admin grant/revoke
-- ============================================================================
--
-- N20. SYS-02 can now add and remove tenant admins, and both are exactly the
-- kind of privilege change the audit log exists for: they decide who can
-- administer a tenant. `audit_events_action_check` does not admit them, so
-- logAuditEvent would fail with 23514 and — per F-REL-10's lesson about
-- silently swallowed writes — the grant would appear to succeed with no
-- record of who made it.
--
-- WHY NOT REUSE 'role_revoked'
-- It already exists and is close in meaning, but it is the officials-removal
-- action (0025's remove_official path), and nothing in a row says which
-- surface produced it. Reusing it would make "who was made an admin, and by
-- whom" unanswerable without joining back to a role row that revoke has by
-- then deleted. Two new values keep both questions answerable from the log
-- alone.
--
-- target_type stays 'user_role': the thing being granted or revoked is the
-- role, which is what target_id identifies. No new target type is needed, and
-- 'user' deliberately is not added — the user is the subject of the change,
-- not the object of it.
--
-- Forward-fix: replace (widens an existing CHECK constraint)
--   Rollback: only safe while no row uses a new value. Check first:
--               select count(*) from audit_events
--               where action in ('tenant_admin_granted','tenant_admin_revoked');
--             If zero:
--               alter table public.audit_events
--                 drop constraint audit_events_action_check,
--                 add constraint audit_events_action_check check (action = any (array[
--                   'role_revoked','tenant_created','tenant_activated',
--                   'tenant_deactivated','tenant_tier_changed','official_invited',
--                   'announcement_published']));
--             If non-zero, those rows must be deleted or rewritten first, and
--             deleting audit rows to enable a rollback defeats the point of
--             having them — prefer leaving the wider constraint in place.
--   Data:     no data loss. Widening a CHECK cannot invalidate an existing
--             row, and no row is read or written here.
--   Blast:    none. Old code never emits the new values; new code cannot
--             write them until this lands. Deploy this BEFORE the app change
--             that uses them.
--   Window:   compatible in this direction (widening). The reverse is not —
--             see Rollback.
-- ============================================================================

alter table public.audit_events
  drop constraint if exists audit_events_action_check;

alter table public.audit_events
  add constraint audit_events_action_check check (
    action = any (array[
      'role_revoked'::text,
      'tenant_created'::text,
      'tenant_activated'::text,
      'tenant_deactivated'::text,
      'tenant_tier_changed'::text,
      'official_invited'::text,
      'announcement_published'::text,
      -- N20
      'tenant_admin_granted'::text,
      'tenant_admin_revoked'::text
    ])
  );

-- ============================================================================
-- DONE
-- ============================================================================
-- Verify with:
--   select pg_get_constraintdef(oid) from pg_constraint
--   where conname = 'audit_events_action_check';
