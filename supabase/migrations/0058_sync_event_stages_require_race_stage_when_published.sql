-- ============================================================================
-- Migration 0058: sync_event_stages rejects removing the last Race stage
-- from a published event
-- ============================================================================
--
-- SEC-01 branch follow-up. publishEvent (src/lib/actions/publish-event.ts)
-- requires at least one 'race' event_stages row before it will flip
-- events.status to 'published'. Nothing enforced that invariant afterwards:
-- editing an event's stages via saveEvent -> sync_event_stages could retype
-- the only Race stage to 'non_race', or drop it entirely, on an already
-- published event. Manually confirmed on dev: doing exactly that succeeded
-- with no error.
--
-- saveEvent (src/app/(tenant)/[tenantSlug]/admin/event/actions.ts) now
-- checks events.status before calling this RPC and rejects the save at the
-- application layer with a friendly error. That check runs in a separate
-- statement from the RPC call, with no lock held in between, so two
-- concurrent saves (or a save racing a publish) can each read 'draft' and
-- both proceed — a TOCTOU window the app layer alone cannot close. This
-- migration adds the same invariant inside sync_event_stages itself, as the
-- last statement of the function body, so it runs in the same transaction
-- as the upsert/delete and sees the final row state under normal Postgres
-- read-committed visibility rules for a single transaction. It is
-- defense-in-depth alongside the app check, not a replacement for it (the
-- app check gives a caller-friendly `{ error: '...' }` before ever hitting
-- the network round-trip for the RPC; this is the backstop for every other
-- write path, present or future, direct SQL included).
--
-- Forward-fix: replace
--   Rollback: restore the prior function body from migration
--             0039_fix_sync_event_stages_upsert.sql verbatim (the COMMENT
--             from 0041_sync_event_stages_shape_contract.sql stays valid
--             either way — this migration only appends behavior, it does
--             not change accepted p_stages shape).
--   Data:     no data loss. This migration adds a validation check only; it
--             does not alter any existing row, column, or constraint.
--   Blast:    if reverted, a published event can again lose its last Race
--             stage via this RPC with no error (pre-0058 behavior, and the
--             exact bug this migration exists to close) — not a new
--             failure mode.
--   Window:   compatible. The RPC signature (p_event_id, p_tenant_id,
--             p_stages) is unchanged. Old app code (pre-saveEvent-guard)
--             calling this RPC to legitimately save a draft event, or a
--             published event that still keeps a Race stage, is unaffected
--             — the new RAISE EXCEPTION only fires for a call that would
--             have left a published event with zero Race stages, which was
--             already the invalid state this whole change is about.
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

  -- Stage model v0.7 invariant, enforced here as the backstop: a published
  -- event must keep at least one Race stage. Checked last, against the
  -- table state this same transaction just wrote, so it sees the final
  -- row set regardless of which branch above ran.
  SELECT status INTO v_event_status
  FROM events
  WHERE id = p_event_id AND tenant_id = p_tenant_id;

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
  'held afterwards too. '
  'This contract is mirrored by StageInput in '
  'src/app/(tenant)/[tenantSlug]/admin/event/actions.ts and is NOT enforced by '
  'the generated types (p_stages is Json) — see F-REL-16.';

-- ============================================================================
-- DONE
-- ============================================================================
-- Verify with:
--   SELECT proname, prosrc FROM pg_proc WHERE proname = 'sync_event_stages';
--
--   -- Manually confirm the guard fires:
--   -- 1. Publish an event with exactly one Race stage.
--   -- 2. Call sync_event_stages for that event with p_stages containing the
--   --    same stage but stage_type = 'non_race' (or with p_stages = '[]').
--   -- 3. Expect a 23514 error: "Cannot remove the last Race stage from a
--   --    published event." and confirm event_stages / event_distances are
--   --    unchanged (the whole call rolled back).
-- ============================================================================
