-- ============================================================================
-- Migration 20261028095705: events.status gains 'archived' (N23)
-- ============================================================================
--
-- N23 makes a tenant an organizer with several events. An archived event is
-- locked for editing and does not count against the tier's event cap
-- (MAX_ACTIVE_EVENTS in src/lib/tiers/features.ts), which is how a tenant
-- frees a slot. Un-archiving is allowed only while a slot is free.
--
-- This only widens the CHECK so the value can be stored. Nothing writes it
-- yet: the archive/unarchive RPCs, the cap enforcement and the TEN-01
-- dashboard come in later N23 PRs. 'draft' and 'published' keep their current
-- meaning (0003, and 0058's Race-stage rule for published).
--
-- Forward-fix: replace (widens events_status_check; no data change)
--   Rollback: the CHECK can only be narrowed back while no row uses the new
--             value:
--               select count(*) from public.events where status = 'archived';
--             If zero:
--               alter table public.events drop constraint if exists events_status_check;
--               alter table public.events add constraint events_status_check
--                 check (status in ('draft', 'published'));
--             If non-zero, leave the wider constraint in place rather than
--             changing event statuses to make a rollback possible.
--   Data:     prod snapshot 20261028095200_pre-migration_2026-10-29T12-48-16Z.tar.gz (N23 release).
--             no data loss. Writes no rows.
--   Blast:    none on apply. Widening a CHECK cannot reject an existing write.
--   Window:   compatible. Deployed code never writes 'archived', and every
--             reader compares status to 'published', so an archived event
--             would read as not published.
-- ============================================================================

alter table public.events
  drop constraint if exists events_status_check;

alter table public.events
  add constraint events_status_check
  check (status in ('draft', 'published', 'archived'));

comment on column public.events.status is
  'draft = visible to admins only; published = visible to officials and '
  'participants per role; archived (N23) = locked for editing and not counted '
  'against the tier''s event cap.';

-- ============================================================================
-- DONE
-- ============================================================================
-- Verify with:
--   select pg_get_constraintdef(oid) from pg_constraint
--   where conname = 'events_status_check';
