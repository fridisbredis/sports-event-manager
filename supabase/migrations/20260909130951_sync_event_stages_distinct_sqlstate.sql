-- ============================================================================
-- Migration 20260909130951: sync_event_stages — distinct SQLSTATE for the
-- Race-stage-removal guard, separate from event_stages_times_order_check
-- ============================================================================
--
-- F-REL-22 (PR #147 review). sync_event_stages can raise ERRCODE 23514 from
-- two different places in the same statement: the times-order CHECK
-- constraint (event_stages_times_order_check, migration 0007) on the
-- INSERT ... ON CONFLICT UPDATE, and the Race-stage invariant RAISE
-- EXCEPTION added by migration 0058. The app layer needs to show a
-- different translated message for each, and matching on ERRCODE alone
-- cannot tell them apart — both are 23514. Matching on message text
-- instead would couple the app to exact RAISE wording, which is not a
-- contract this function's COMMENT promises to keep stable.
--
-- This migration gives the Race-stage guard its own custom SQLSTATE,
-- P0003, following the P0002 ("not found") convention already established
-- in this function and in publish_event (migration 20260908143523). The
-- CHECK constraint continues to raise plain 23514, unchanged. The app can
-- now match P0003 exactly for the Race-stage message and treat any other
-- 23514 as the times-order violation.
--
-- Forward-fix: replace
--   Rollback: restore the prior function body from migration
--             20260908143523_publish_event_rpc.sql verbatim (ERRCODE
--             '23514' on the Race-stage RAISE instead of 'P0003'). No other
--             change in that migration is touched.
--   Data:     no data loss. This migration only changes which SQLSTATE one
--             RAISE EXCEPTION uses; no column, table, or constraint changes.
--   Blast:    if reverted, the app-layer discrimination added alongside
--             this migration (matching P0003) stops matching and that one
--             case falls back to the generic error message — not a new
--             failure mode, just the pre-fix ambiguity (both cases showed
--             the same generic message before F-REL-22).
--   Window:   compatible. Old app code (pre-F-REL-22, matching on 23514 +
--             message text or not discriminating at all) still receives a
--             23514-family error it already handles as "some check
--             failed" — P0003 is a more specific code, not a removed one,
--             so nothing that worked before stops working during the
--             deploy window.
-- ============================================================================

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
      -- F-REL-22: custom SQLSTATE (not 23514) so the app can tell this
      -- apart from event_stages_times_order_check, which also raises
      -- 23514 from the INSERT above in the same function call.
      RAISE EXCEPTION 'Cannot remove the last Race stage from a published event.'
        USING ERRCODE = 'P0003';
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
  '(P0003, "Cannot remove the last Race stage from a published event.") when '
  'the resulting stage set has zero stage_type = ''race'' rows (migration 0058, '
  'SQLSTATE changed to P0003 by migration 20260909130951 — F-REL-22 — so it '
  'is distinguishable from event_stages_times_order_check''s plain 23514) — '
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
--   SELECT proname, prosrc FROM pg_proc WHERE proname = 'sync_event_stages';
--
--   -- Manually confirm the two 23514-family sources are now distinguishable:
--   -- 1. Publish an event with exactly one Race stage.
--   -- 2. Call sync_event_stages for that event with p_stages containing the
--   --    same stage but stage_type = 'non_race' (or with p_stages = '[]').
--   -- 3. Expect SQLSTATE P0003 (not 23514).
--   -- 4. Separately, call sync_event_stages with a stage whose end_time is
--   --    before its start_time. Expect SQLSTATE 23514 (unchanged).
-- ============================================================================
