-- ============================================================================
-- Migration 20260908143523: publish_event RPC + lock sync_event_stages
-- against it (closes EVT-02 TOCTOU race documented in migration 0058)
-- ============================================================================
--
-- Migration 0058 added a Race-stage invariant guard inside
-- sync_event_stages, and its header documented (deliberately deferred) a
-- race: publishEvent (src/lib/actions/publish-event.ts) was two separate
-- PostgREST calls -- a SELECT that counts Race stages, then an UPDATE that
-- sets events.status = 'published' -- with no lock held across the two.
-- Under READ COMMITTED, a concurrent sync_event_stages call could remove
-- the last Race stage, read events.status as still 'draft' (publish not
-- yet committed), skip its own guard, and commit -- while publishEvent's
-- earlier count still saw the stage and proceeded to set 'published'.
-- Both commit; invariant (published => >=1 Race stage) violated, no error
-- raised on either side.
--
-- This migration closes that gap with the same pattern already used
-- elsewhere in this codebase for check-then-write races (see
-- confirm_official_invite, migration 0017): SELECT ... FOR UPDATE on the
-- row first, so the two functions serialize against each other instead of
-- racing.
--
-- Two changes:
--   1. New function publish_event(p_event_id, p_tenant_id) -- moves
--      publishEvent's count-then-write into a single plpgsql function so a
--      lock can be held across both steps (not possible across two
--      separate PostgREST requests from the Server Action).
--   2. sync_event_stages (0058) is replaced to add FOR UPDATE to its
--      existing events.status read. Both functions now lock the same
--      events row before reading status, so one blocks until the other's
--      transaction commits -- no more stale-read window.
--
-- Gap #2 from migration 0058's header (direct DELETE on event_stages
-- bypassing the RPC guard via tenant_admin_manage_event_stages having no
-- WITH CHECK) is unrelated to this fix and remains open.
--
-- Forward-fix: additive (new function) + replace (sync_event_stages body)
--   Rollback: DROP FUNCTION IF EXISTS public.publish_event; restore
--             sync_event_stages' prior body verbatim from migration
--             0058_sync_event_stages_require_race_stage_when_published.sql
--             (i.e. without FOR UPDATE on the status read). Also revert
--             src/lib/actions/publish-event.ts to its pre-fix two-call
--             version in the same release as any such rollback, since the
--             new function is the only thing that implements the
--             already-published no-op and the name/Race-stage checks.
--   Data:     no data loss. No column, table, or constraint changes --
--             this migration adds one function and replaces another's
--             body only.
--   Blast:    if reverted, the TOCTOU gap reopens (pre-fix behavior,
--             already documented and accepted as non-blocking in PR #147)
--             -- not a new failure mode.
--   Window:   compatible. publish_event is a new RPC; old app code that
--             doesn't call it yet is unaffected. sync_event_stages' RPC
--             signature (p_event_id, p_tenant_id, p_stages) and accepted
--             p_stages shape are unchanged -- adding FOR UPDATE to an
--             internal read does not change any caller-visible contract.
--             Old callers see identical behavior except for a lock wait
--             that resolves as soon as any concurrent publish_event /
--             sync_event_stages call on the same event commits.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.publish_event(
  p_event_id  uuid,
  p_tenant_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  v_event_name    text;
  v_event_status  text;
  v_race_stage_ct integer;
BEGIN
  -- Lock the events row first. This is the half of the fix that lives on
  -- the publish side: sync_event_stages (see below) takes the same lock
  -- before it reads events.status, so the two are now serializable
  -- against each other instead of racing.
  SELECT name, status INTO v_event_name, v_event_status
  FROM events
  WHERE id = p_event_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event % not found for tenant %', p_event_id, p_tenant_id
      USING ERRCODE = 'P0002';
  END IF;

  IF v_event_status = 'published' THEN
    RETURN false; -- already published: no-op, matches prior publishEvent behavior
  END IF;

  IF v_event_name IS NULL OR trim(v_event_name) = '' THEN
    RAISE EXCEPTION 'Event name is required before publishing.'
      USING ERRCODE = '23514';
  END IF;

  -- Stage model v0.7: at least one Race stage is required (satisfies the
  -- "at least one date" requirement since a Race stage carries its own
  -- start/end time). Counted under the lock taken above, so no concurrent
  -- sync_event_stages call can remove the last Race stage between this
  -- count and the UPDATE below.
  SELECT count(*) INTO v_race_stage_ct
  FROM event_stages
  WHERE event_id = p_event_id AND tenant_id = p_tenant_id AND stage_type = 'race';

  IF v_race_stage_ct = 0 THEN
    RAISE EXCEPTION 'Add at least one Race stage before publishing.'
      USING ERRCODE = '23514';
  END IF;

  UPDATE events SET status = 'published'
  WHERE id = p_event_id AND tenant_id = p_tenant_id;

  RETURN true; -- actually transitioned draft -> published this call
END;
$$;

COMMENT ON FUNCTION public.publish_event IS
  'Publishes an event. Returns true if this call actually transitioned the '
  'event from draft to published; returns false if it was already published '
  '(no-op, no error) -- callers use this to skip cache revalidation on the '
  'no-op path. Raises P0002 if the events row is not visible for '
  '(p_event_id, p_tenant_id) under caller RLS. Raises 23514 '
  '("Event name is required before publishing.") if the event has a blank '
  'name, or 23514 ("Add at least one Race stage before publishing.") if it '
  'has zero stage_type = ''race'' rows in event_stages. Takes '
  'SELECT ... FOR UPDATE on the events row before checking or writing, '
  'which is what makes this serializable against a concurrent '
  'sync_event_stages call on the same event (EVT-02, migration '
  '20260908143523) -- see that function''s own comment for the other half '
  'of this lock pairing. Caller must be authenticated with tenant_admin or '
  'system_admin role for p_tenant_id (enforced by app layer + RLS).';

-- ----------------------------------------------------------------------------
-- sync_event_stages: add FOR UPDATE to the existing events.status read
-- (all other logic unchanged from migration 0039 / 0058)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.sync_event_stages(
  p_event_id  uuid,
  p_tenant_id uuid,
  p_stages    jsonb
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_event_status  text;
  v_race_stage_ct integer;
BEGIN
  -- Delete stages that are no longer present in p_stages (admin removed
  -- them in the form). This is the only intended cascade to workstations.
  DELETE FROM event_stages
  WHERE event_id = p_event_id
    AND tenant_id = p_tenant_id
    AND id <> ALL (
      SELECT (s->>'id')::uuid
      FROM jsonb_array_elements(p_stages) AS s
      WHERE s->>'id' IS NOT NULL
    );

  -- Upsert stages: update existing rows by id (preserves id, so
  -- workstations.stage_id / assignments stay intact), insert new rows
  -- for stages with no id.
  INSERT INTO event_stages (
    id, event_id, tenant_id,
    name, stage_type, race_type,
    start_time, end_time, venue,
    stage_date,   -- kept nullable; new rows always NULL
    position
  )
  SELECT
    coalesce((s->>'id')::uuid, gen_random_uuid()),
    p_event_id,
    p_tenant_id,
    trim(s->>'name'),
    coalesce(nullif(trim(s->>'stage_type'), ''), 'race'),
    coalesce(nullif(trim(s->>'race_type'),  ''), 'distance'),
    nullif(trim(coalesce(s->>'start_time', '')), '')::timestamptz,
    nullif(trim(coalesce(s->>'end_time',   '')), '')::timestamptz,
    nullif(trim(coalesce(s->>'venue',      '')), ''),
    NULL,
    coalesce((s->>'position')::integer, 0)
  FROM jsonb_array_elements(p_stages) AS s
  WHERE trim(coalesce(s->>'name', '')) <> ''
  ON CONFLICT (id) DO UPDATE SET
    name       = excluded.name,
    stage_type = excluded.stage_type,
    race_type  = excluded.race_type,
    start_time = excluded.start_time,
    end_time   = excluded.end_time,
    venue      = excluded.venue,
    position   = excluded.position;

  -- Distances: still fully replaced per event (no FK from workstations
  -- to event_distances, so no cascade risk here). Matched by the stage's
  -- id now that ids are stable, instead of by name.
  DELETE FROM event_distances
  WHERE event_id = p_event_id AND tenant_id = p_tenant_id;

  INSERT INTO event_distances (event_id, tenant_id, stage_id, label, position)
  SELECT
    p_event_id,
    p_tenant_id,
    es.id,
    trim(d->>'label'),
    coalesce((d->>'position')::integer, 0)
  FROM jsonb_array_elements(p_stages) AS s
  JOIN event_stages es
    ON  es.event_id  = p_event_id
    AND es.tenant_id = p_tenant_id
    AND es.id        = coalesce((s->>'id')::uuid, es.id)
    AND es.name       = trim(s->>'name')
  CROSS JOIN LATERAL jsonb_array_elements(
    coalesce(s->'distances', '[]'::jsonb)
  ) AS d
  WHERE
    coalesce(nullif(trim(s->>'stage_type'), ''), 'race') = 'race'
    AND trim(coalesce(d->>'label', '')) <> '';

  -- Stage model v0.7 invariant, enforced here as the RPC-level backstop: a
  -- published event must keep at least one Race stage. Checked last,
  -- against the table state this same transaction just wrote, so it sees
  -- the final row set regardless of which branch above ran. Fails closed:
  -- if the events row isn't visible under caller RLS, that's treated as
  -- "can't confirm this is safe" rather than silently skipping the check
  -- (mirrors the fail-closed posture of the app-level check in saveEvent).
  --
  -- FOR UPDATE (EVT-02, migration 20260908143523): locks the events row
  -- before reading status, so a concurrent publish_event call on the same
  -- event blocks here until publish_event's transaction commits (or vice
  -- versa) instead of both reading a stale status and committing an
  -- invariant violation. This is the other half of the lock pairing
  -- described in publish_event's own comment.
  SELECT status INTO v_event_status
  FROM events
  WHERE id = p_event_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event % not found for tenant %', p_event_id, p_tenant_id
      USING ERRCODE = 'P0002';
  END IF;

  IF v_event_status = 'published' THEN
    SELECT count(*) INTO v_race_stage_ct
    FROM event_stages
    WHERE event_id = p_event_id
      AND tenant_id = p_tenant_id
      AND stage_type = 'race';

    IF v_race_stage_ct = 0 THEN
      RAISE EXCEPTION 'Cannot remove the last Race stage from a published event.'
        USING ERRCODE = '23514';
    END IF;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.sync_event_stages IS
  'Upserts stages for p_event_id: existing stages (matched by id) keep their '
  'row and id so workstations.stage_id / assignments are not cascade-deleted; '
  'stages removed from p_stages are deleted; new stages (no id) are inserted. '
  'Distances are still fully replaced per call. '
  'Caller must be authenticated with tenant_admin or system_admin role (enforced by app layer + RLS). '
  'Stage model v0.7 + 0008 + 0039. p_stages is a JSON array; per element: '
  'id (uuid, optional — upsert key; omit to insert), '
  'name (text, required; elements with a blank name are skipped — one that '
  'also carries an id is neither updated nor deleted, so its existing row '
  'survives unchanged), '
  'stage_type (''race'' | ''non_race''; defaults to ''race''), '
  'race_type (''distance'' | ''time''; defaults to ''distance''), '
  'start_time / end_time (timestamptz; absent or empty becomes null, but a '
  'non-empty value is cast, not coerced — unparseable raises 22007 and '
  'date-shaped-but-invalid (2026-02-30, month 13, hour 25) raises 22008), '
  'venue (text, optional), '
  'position (integer; defaults to 0), '
  'distances ([{label, position}]; Race stages only — a non_race element''s '
  'distances are silently dropped). '
  'end_time must be >= start_time or the element trips '
  'event_stages_times_order_check (23514). An error raised by any one element '
  'aborts the whole call — the write is all-or-nothing. '
  'The legacy event_stages.stage_date column is written NULL on insert; the '
  'upsert''s UPDATE branch does not set it, so any pre-existing non-null value '
  'survives a resave. '
  'If the parent event''s status is ''published'', the call also aborts '
  '(23514, "Cannot remove the last Race stage from a published event.") when '
  'the resulting stage set has zero stage_type = ''race'' rows (migration 0058) — '
  'this is the same invariant publishEvent enforces before allowing publish, '
  'held afterwards too as an RPC-level backstop. Serializable against a '
  'concurrent publish_event call as of migration 20260908143523 (both take '
  'SELECT ... FOR UPDATE on the events row before reading status) — bypassable '
  'via a direct DELETE on event_stages under tenant_admin_manage_event_stages '
  'is the one gap still open, see migration 0058''s header. '
  'Raises P0002 if the events row itself isn''t visible for (p_event_id, '
  'p_tenant_id) under caller RLS, rather than silently skipping the check. '
  'This contract is mirrored by StageInput in '
  'src/app/(tenant)/[tenantSlug]/admin/event/actions.ts and is NOT enforced by '
  'the generated types (p_stages is Json) — see F-REL-16.';

-- ============================================================================
-- DONE
-- ============================================================================
-- Verify with:
--   SELECT proname, prosrc FROM pg_proc
--   WHERE proname IN ('publish_event', 'sync_event_stages');
--
--   -- Manually confirm the two functions now serialize:
--   -- 1. Open two psql sessions against the local stack.
--   -- 2. Session A: BEGIN; SELECT public.publish_event(<event_id>, <tenant_id>);
--   --    (holds the events row lock, does not COMMIT yet)
--   -- 3. Session B: SELECT public.sync_event_stages(<event_id>, <tenant_id>, '[]');
--   --    Expect session B to BLOCK until session A commits or rolls back.
--   -- 4. Session A: COMMIT;
--   -- 5. Session B unblocks and either succeeds (if publish_event rolled back
--   --    or the event still isn't published) or raises 23514 (if publish_event
--   --    committed and the event is now published with the last Race stage
--   --    being removed) — either outcome is correct; what matters is B never
--   --    silently proceeds against a stale read while A's write is in flight.
-- ============================================================================
