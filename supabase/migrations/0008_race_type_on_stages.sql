-- ============================================================================
-- Migration 0008: race_type moves from events to event_stages
-- ============================================================================
--
-- Scope v0.7 clarification: whether a Race stage measures its distances in
-- time (e.g. "60 min") or distance (e.g. "42 km") is a per-stage property,
-- not an event-level property.
--
-- Changes:
--   - event_stages:  add race_type ('distance' | 'time'); default 'distance'
--   - events:        copy category_type → existing race stages, then drop column
--   - sync_event_stages RPC: updated to accept race_type per stage element
--
-- race_type is only meaningful for Race stages (stage_type = 'race').
-- Non-race stages get the default value and the app ignores it.
-- ============================================================================


-- ============================================================================
-- 1. EVENT_STAGES — add race_type
-- ============================================================================

ALTER TABLE event_stages
  ADD COLUMN IF NOT EXISTS race_type text NOT NULL DEFAULT 'distance'
    CONSTRAINT event_stages_race_type_check CHECK (race_type IN ('distance', 'time'));

COMMENT ON COLUMN event_stages.race_type IS
  'Whether this Race stage measures distances in time or length. '
  'distance = km/m/miles; time = hh:mm. Only meaningful when stage_type = ''race''.';


-- ============================================================================
-- 2. DATA MIGRATION — copy events.category_type to existing race stages
-- ============================================================================
-- For any event that already has a non-default category_type, push that value
-- down to all its existing race stages so no data is lost on drop.

UPDATE event_stages es
SET    race_type = e.category_type
FROM   events e
WHERE  es.event_id  = e.id
AND    es.stage_type = 'race'
AND    e.category_type IS NOT NULL;


-- ============================================================================
-- 3. EVENTS — drop category_type (superseded by event_stages.race_type)
-- ============================================================================

ALTER TABLE events DROP COLUMN IF EXISTS category_type;


-- ============================================================================
-- 4. sync_event_stages RPC — add race_type to accepted stage shape
-- ============================================================================
-- New p_stages JSON shape per element (additions marked with +):
--   {
--     name:       string  (required)
--     stage_type: string  ('race' | 'non_race'; defaults to 'race')
--   + race_type:  string  ('distance' | 'time'; defaults to 'distance')
--     start_time: string  (ISO 8601 timestamptz or null)
--     end_time:   string  (ISO 8601 timestamptz or null)
--     venue:      string  (optional)
--     position:   integer (defaults to 0)
--     distances:  [{ label: string, position: integer }]  (Race stages only)
--   }

CREATE OR REPLACE FUNCTION public.sync_event_stages(
  p_event_id  uuid,
  p_tenant_id uuid,
  p_stages    jsonb
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  -- Delete existing stages and distances for this event atomically.
  DELETE FROM event_stages
  WHERE event_id = p_event_id AND tenant_id = p_tenant_id;

  DELETE FROM event_distances
  WHERE event_id = p_event_id AND tenant_id = p_tenant_id;

  -- Insert new stages (skip rows with missing / empty name).
  INSERT INTO event_stages (
    event_id, tenant_id,
    name, stage_type, race_type,
    start_time, end_time, venue,
    stage_date,   -- kept nullable; new rows always NULL
    position
  )
  SELECT
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
  WHERE trim(coalesce(s->>'name', '')) <> '';

  -- Insert distances for Race stages, matched by name within the same event.
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
    AND es.name      = trim(s->>'name')
  CROSS JOIN LATERAL jsonb_array_elements(
    coalesce(s->'distances', '[]'::jsonb)
  ) AS d
  WHERE
    coalesce(nullif(trim(s->>'stage_type'), ''), 'race') = 'race'
    AND trim(coalesce(d->>'label', '')) <> '';

END;
$$;

COMMENT ON FUNCTION public.sync_event_stages IS
  'Atomically replaces all stages and their distances for p_event_id. '
  'Caller must be authenticated with tenant_admin or system_admin role (enforced by app layer + RLS). '
  'Stage model v0.7 + 0008: accepts stage_type, race_type, start_time, end_time, distances per Race stage.';


-- ============================================================================
-- DONE
-- ============================================================================
-- Verify with:
--   SELECT column_name, data_type, is_nullable, column_default
--   FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'event_stages'
--   ORDER BY ordinal_position;
--
--   SELECT column_name FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'events' AND column_name = 'category_type';
--   -- should return 0 rows
