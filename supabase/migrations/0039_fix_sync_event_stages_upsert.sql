-- ============================================================================
-- Migration 0039: Fix sync_event_stages to upsert instead of delete-all/insert-all
-- ============================================================================
--
-- Bug: sync_event_stages (last redefined in 0007, extended in 0008) always
-- deleted every event_stages row for the event and re-inserted brand new
-- rows, even though the caller (saveEvent action) already sends the
-- existing stage `id` when one exists. New rows got new auto-generated
-- ids. Because workstations.stage_id has ON DELETE CASCADE to
-- event_stages(id) (added in 0014), every save of the Event form (EVT-02)
-- cascade-deleted all work areas (and their assignments / operating
-- windows / todos) tied to the old stage ids — silently, on every save,
-- not just once.
--
-- Confirmed in prod (rauvaxuypujbeintnnoe) via pg_stat_user_tables:
-- workstations had 11 deletes vs 2 inserts total; assignments had 1695
-- deletes vs 1730 inserts — a repeated churn pattern, not a one-time
-- migration incident.
--
-- Fix: sync_event_stages now upserts on id when the caller supplies one
-- (existing stage, keep its id — no cascade to workstations) and only
-- inserts fresh rows for stages with no id (newly added in the form). Any
-- existing stage row NOT present in p_stages (i.e. the admin removed it
-- in the form) is still deleted, which is the one case a cascade to
-- workstations is actually intended.
--
-- Forward-fix: replace
--   Rollback: restore the prior definition from migration 0008
--     (supabase/migrations/0008_race_type_on_stages.sql, the
--     CREATE OR REPLACE FUNCTION public.sync_event_stages block).
--   Data:     no data loss from this migration itself — it only changes
--             function behavior going forward. It does NOT recover
--             work areas already lost to the pre-fix delete-all behavior;
--             no audit table exists to reconstruct those rows.
--   Blast:    none — old code path (delete-all/insert-all) is fully
--             replaced; no other caller of sync_event_stages exists
--             besides the saveEvent Server Action, which already sends
--             `id` for existing stages.
--   Window:   compatible. The RPC signature (p_event_id, p_tenant_id,
--             p_stages) is unchanged; only the function body's behavior
--             changes. Old and new app code call it identically.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.sync_event_stages(
  p_event_id  uuid,
  p_tenant_id uuid,
  p_stages    jsonb
)
RETURNS void
LANGUAGE plpgsql
AS $$
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

END;
$$;

COMMENT ON FUNCTION public.sync_event_stages IS
  'Upserts stages for p_event_id: existing stages (matched by id) keep their '
  'row and id so workstations.stage_id / assignments are not cascade-deleted; '
  'stages removed from p_stages are deleted; new stages (no id) are inserted. '
  'Distances are still fully replaced per call. '
  'Caller must be authenticated with tenant_admin or system_admin role (enforced by app layer + RLS).';

-- ============================================================================
-- DONE
-- ============================================================================
-- Verify with:
--   SELECT proname, prosrc FROM pg_proc WHERE proname = 'sync_event_stages';
--
--   -- Manually confirm existing stage ids survive a resave:
--   -- 1. Note event_stages.id and workstations.stage_id for a test event.
--   -- 2. Call saveEvent / sync_event_stages again with the same stage ids.
--   -- 3. Confirm event_stages.id and workstations.stage_id are unchanged.
-- ============================================================================
