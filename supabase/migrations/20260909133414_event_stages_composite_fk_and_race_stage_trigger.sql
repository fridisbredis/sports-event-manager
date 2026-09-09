-- ============================================================================
-- Migration 20260909133414: event_stages composite tenant FK (F-REL-17) +
-- deferred constraint trigger enforcing the published-event Race-stage
-- invariant at the table level (F-REL-21)
-- ============================================================================
--
-- PR #147 review. Two residual gaps left open by migration 0058 and its
-- follow-up 20260908143523, bundled here because both touch event_stages
-- in the same migration:
--
-- 1. F-REL-17: event_stages carries independent FKs on tenant_id and
--    event_id with nothing tying them together, so a row's tenant_id can
--    disagree with its own event's tenant_id. Migration 0060 already added
--    events_id_tenant_id_key UNIQUE (id, tenant_id) for exactly this
--    purpose (it was added for workstations' composite FK) — event_stages
--    just never got its own composite FK against it. Fixed here by
--    replacing event_stages_event_id_fkey with a composite FK on
--    (event_id, tenant_id) referencing events(id, tenant_id), the same
--    pattern 0060 used for workstations.
--
-- 2. F-REL-21: tenant_admin_manage_event_stages (migration 0007) is FOR ALL
--    with no WITH CHECK beyond tenant_id, so a tenant_admin can DELETE a
--    published event's last Race stage straight through PostgREST,
--    bypassing sync_event_stages entirely (0058's guard is inside that RPC
--    only). Fixed here with a deferred constraint trigger on event_stages
--    that re-runs the same "published event needs >=1 Race stage" check at
--    commit time, regardless of which write path touched the table.
--
-- Deliberately NOT closed by this migration (residual, accepted as Low —
-- see the Trello F-REL-21 card):
--   The literal race migration 0058's header described ("publishEvent
--   counts Race stages, then updates events.status in a separate
--   statement") is already gone — 20260908143523 made publish_event a
--   single locked RPC (SELECT ... FOR UPDATE on the events row), and
--   src/lib/actions/publish-event.ts calls it that way. What remains is
--   narrower: a direct DELETE on event_stages (the same bypass this
--   migration's trigger targets) takes no lock on the events row, so it is
--   not serialized against a concurrent publish_event call. The trigger
--   below reads events.status with a plain SELECT, not SELECT ... FOR
--   UPDATE, so a DELETE that commits in the gap between publish_event's
--   own count and its UPDATE could still race it. Needs two concurrent
--   admin writes on the same event inside a millisecond window; same
--   recoverable damage (re-add the stage) as gap 1. Closing this fully
--   would need a second trigger on events for the transition into
--   'published', taking the same lock — out of scope here by product
--   decision, not an oversight.
--
-- F-REL-18 (publishEvent's final UPDATE missing an explicit tenant_id
-- filter) is a separate card and not touched here.
--
-- Verified before writing: 0 rows where an event_stages row's tenant_id
-- disagrees with its event's tenant_id (local stack, post `db reset` to
-- 20260908143523, 2026-09-09):
--   select s.id from event_stages s join events e on e.id = s.event_id
--     where e.tenant_id <> s.tenant_id;
-- Same query must be run against dev and prod before pushing there — not
-- yet done as of this file being written (local-only session).
--
-- Forward-fix: destructive
--   Rollback: a new migration that
--     1. drops trigger event_stages_published_race_stage_guard and function
--        public.enforce_published_event_has_race_stage();
--     2. drops constraint event_stages_event_tenant_fkey and restores the
--        original single-column FK:
--          ALTER TABLE event_stages
--            ADD CONSTRAINT event_stages_event_id_fkey
--              FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;
--   Data:     no data loss. This migration adds a constraint and a trigger
--             only; it does not modify any existing row. The composite FK's
--             ADD CONSTRAINT validates all existing rows against the new
--             pairing rule, which is why this is classed destructive rather
--             than additive (same reasoning 0060 used) — verified above
--             that zero local rows would fail it.
--   Blast:    if reverted, both gaps reopen exactly as described above —
--             not a new failure mode.
--   Window:   NOT compatible by default for the trigger half — checked
--             against scripts/seed-dev.ts before writing this: it inserts
--             the seed event with status: 'published' BEFORE inserting its
--             stage rows (two separate PostgREST calls), which would trip
--             a naive "no published event without a Race stage" check if
--             one fired on events or on event_stages INSERT. The trigger
--             below only fires on DELETE OR UPDATE of event_stages, never
--             INSERT, specifically so this seed order keeps working — an
--             INSERT-only path can only ever add a Race stage, never
--             remove the last one, so it cannot violate the invariant.
--             The composite FK half is compatible: old and new app code
--             send the same columns on every event_stages write, so
--             requests valid before remain valid; only a write whose
--             event_id/tenant_id already disagreed (already invalid in
--             intent) starts failing, with a standard FK-violation error
--             instead of silently succeeding.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. F-REL-17: composite (event_id, tenant_id) FK, mirroring migration 0060
-- ----------------------------------------------------------------------------

ALTER TABLE event_stages
  DROP CONSTRAINT event_stages_event_id_fkey;

ALTER TABLE event_stages
  ADD CONSTRAINT event_stages_event_tenant_fkey
    FOREIGN KEY (event_id, tenant_id) REFERENCES events(id, tenant_id) ON DELETE CASCADE;

COMMENT ON CONSTRAINT event_stages_event_tenant_fkey ON event_stages IS
  'F-REL-17 (migration 20260909133414): pins event_id to the same tenant_id as the '
  'event_stages row, closing the gap where p_event_id/p_tenant_id in sync_event_stages '
  'had nothing tying them together.';

-- ----------------------------------------------------------------------------
-- 2. F-REL-21: deferred constraint trigger re-checking the published-event
--    Race-stage invariant on any DELETE or UPDATE to event_stages, so a
--    direct PostgREST write that bypasses sync_event_stages is still caught.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_published_event_has_race_stage()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_event_id      uuid;
  v_event_status  text;
  v_race_stage_ct integer;
BEGIN
  -- UPDATE ... SET event_id = <other event> moves a row off OLD.event_id and
  -- onto NEW.event_id in the same statement. COALESCE(NEW, OLD) here would
  -- only ever see NEW (never null on UPDATE), so the source event's
  -- now-possibly-zero Race-stage count would never be checked. Check both
  -- endpoints; on DELETE, NEW.event_id is null and the loop only checks OLD.
  FOREACH v_event_id IN ARRAY ARRAY[OLD.event_id, NEW.event_id]::uuid[]
  LOOP
    CONTINUE WHEN v_event_id IS NULL;

    SELECT status INTO v_event_status
    FROM events
    WHERE id = v_event_id;

    IF v_event_status = 'published' THEN
      SELECT count(*) INTO v_race_stage_ct
      FROM event_stages
      WHERE event_id = v_event_id
        AND stage_type = 'race';

      IF v_race_stage_ct = 0 THEN
        RAISE EXCEPTION 'Cannot remove the last Race stage from a published event.'
          USING ERRCODE = '23514';
      END IF;
    END IF;
  END LOOP;

  RETURN NULL; -- ignored for an AFTER trigger
END;
$$;

COMMENT ON FUNCTION public.enforce_published_event_has_race_stage IS
  'F-REL-21 (migration 20260909133414): table-level backstop for the same '
  '"published event keeps >=1 Race stage" invariant sync_event_stages enforces '
  '(migration 0058) — fires on any DELETE or UPDATE to event_stages, including a '
  'direct PostgREST write that bypasses the RPC via tenant_admin_manage_event_stages '
  '(migration 0007) having no WITH CHECK. Deliberately does not fire on INSERT: an '
  'insert-only change can only add a Race stage, never remove the last one, so it '
  'cannot violate the invariant, and firing on INSERT would break '
  'scripts/seed-dev.ts (creates a published event, then inserts its stages in a '
  'separate call). Checks both OLD.event_id and NEW.event_id (not just '
  'COALESCE(NEW, OLD)) so an UPDATE that moves a row to a different event_id also '
  're-validates the event it left behind. Reads events.status with a plain SELECT, not SELECT ... FOR '
  'UPDATE, so this is not serialized against a concurrent publish_event call '
  '(migration 20260908143523) — an accepted residual, see this migration''s header.';

DROP TRIGGER IF EXISTS event_stages_published_race_stage_guard ON event_stages;
CREATE CONSTRAINT TRIGGER event_stages_published_race_stage_guard
  AFTER DELETE OR UPDATE ON event_stages
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_published_event_has_race_stage();

-- ============================================================================
-- DONE
-- ============================================================================
-- Verify with:
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--   WHERE conrelid = 'event_stages'::regclass AND contype = 'f';
--
--   SELECT tgname, tgdeferrable, tginitdeferred FROM pg_trigger
--   WHERE tgrelid = 'event_stages'::regclass AND NOT tgisinternal;
--
--   -- Manually confirm the trigger fires on a direct DELETE:
--   -- 1. Publish an event with exactly one Race stage.
--   -- 2. As the tenant_admin client, DELETE that row directly:
--   --      DELETE FROM event_stages WHERE id = '<stage_id>';
--   -- 3. Expect a 23514 error at COMMIT time (deferred) and the row to
--   --    still exist after rollback.
-- ============================================================================
