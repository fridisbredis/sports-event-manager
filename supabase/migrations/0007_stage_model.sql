-- ============================================================================
-- Migration 0007: Stage model (scope v0.7)
-- ============================================================================
--
-- Implements the refined Stage model from docs/problem-statement-mvp-scope.md v0.7:
--
--   Structure: Event → Stage → Work area
--
-- Changes:
--   - event_stages:  add stage_type (race | non_race), start_time, end_time;
--                    make stage_date nullable (superseded by start_time/end_time);
--                    replace old RLS policy with 0004-pattern
--   - workstations:  add stage_id FK to event_stages;
--                    replace old RLS policy with 0004-pattern
--   - event_distances: add stage_id FK (distances move to Race-stage level)
--   - events:        make start_date / end_date nullable
--                    (event date range is now derived from stage times in app logic)
--   - sync_event_stages RPC: replace with new signature that accepts stage_type,
--                    start_time, end_time, and per-stage distances
--
-- RLS policy pattern (CLAUDE.md §"When writing new RLS policies"):
--   tenant_admin_manage_<table>: get_user_role(tenant_id) = 'tenant_admin' OR is_system_admin()
--   tenant_member_read_<table>:  get_user_role(tenant_id) IS NOT NULL    OR is_system_admin()
--
-- Defensive: uses DROP POLICY IF EXISTS + CREATE POLICY; all ALTER TABLEs are
-- safe to re-run because they only add or relax constraints, never tighten them.
-- ============================================================================


-- ============================================================================
-- 1. EVENT_STAGES — add stage_type, start_time, end_time; relax stage_date
-- ============================================================================

ALTER TABLE event_stages
  ADD COLUMN IF NOT EXISTS stage_type text NOT NULL DEFAULT 'race'
    CONSTRAINT event_stages_stage_type_check CHECK (stage_type IN ('race', 'non_race'));

COMMENT ON COLUMN event_stages.stage_type IS
  'race = participant-facing competition segment (shown to participants); '
  'non_race = internal operational work such as setup / teardown (not shown to participants)';

ALTER TABLE event_stages
  ADD COLUMN IF NOT EXISTS start_time timestamptz,
  ADD COLUMN IF NOT EXISTS end_time   timestamptz;

-- Soft ordering constraint: end_time must be >= start_time when both are set.
ALTER TABLE event_stages
  ADD CONSTRAINT event_stages_times_order_check
    CHECK (end_time IS NULL OR start_time IS NULL OR end_time >= start_time);

COMMENT ON COLUMN event_stages.start_time IS
  'Stage start (incl. formal race-clock start for Race stages). Replaces stage_date.';
COMMENT ON COLUMN event_stages.end_time IS
  'Stage end (incl. formal race-clock end for Race stages).';

-- stage_date is superseded by start_time/end_time; kept nullable for
-- backward-compatibility with any existing rows.
ALTER TABLE event_stages ALTER COLUMN stage_date DROP NOT NULL;

COMMENT ON COLUMN event_stages.stage_date IS
  'Deprecated — superseded by start_time/end_time. Kept for backward-compatibility; '
  'new rows set this to NULL.';


-- ============================================================================
-- 2. EVENT_STAGES — replace old RLS policy with 0004-pattern
-- ============================================================================

DROP POLICY IF EXISTS "event_stages_tenant_isolation" ON event_stages;

DROP POLICY IF EXISTS "tenant_admin_manage_event_stages" ON event_stages;
CREATE POLICY "tenant_admin_manage_event_stages"
  ON event_stages FOR ALL
  USING (
    public.get_user_role(tenant_id) = 'tenant_admin'
    OR public.is_system_admin()
  );

DROP POLICY IF EXISTS "tenant_member_read_event_stages" ON event_stages;
CREATE POLICY "tenant_member_read_event_stages"
  ON event_stages FOR SELECT
  USING (
    public.get_user_role(tenant_id) IS NOT NULL
    OR public.is_system_admin()
  );


-- ============================================================================
-- 3. WORKSTATIONS — add stage_id FK; replace old RLS policy
-- ============================================================================

ALTER TABLE workstations
  ADD COLUMN IF NOT EXISTS stage_id uuid REFERENCES event_stages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS workstations_stage_id_idx ON workstations(stage_id);

COMMENT ON COLUMN workstations.stage_id IS
  'The stage this work area belongs to. NULL for legacy rows created before 0007. '
  'New work areas must reference a stage (enforced in app logic).';

DROP POLICY IF EXISTS "workstations_tenant_isolation" ON workstations;

DROP POLICY IF EXISTS "tenant_admin_manage_workstations" ON workstations;
CREATE POLICY "tenant_admin_manage_workstations"
  ON workstations FOR ALL
  USING (
    public.get_user_role(tenant_id) = 'tenant_admin'
    OR public.is_system_admin()
  );

DROP POLICY IF EXISTS "tenant_member_read_workstations" ON workstations;
CREATE POLICY "tenant_member_read_workstations"
  ON workstations FOR SELECT
  USING (
    public.get_user_role(tenant_id) IS NOT NULL
    OR public.is_system_admin()
  );


-- ============================================================================
-- 4. EVENT_DISTANCES — add stage_id FK (distances move to Race-stage level)
-- ============================================================================

ALTER TABLE event_distances
  ADD COLUMN IF NOT EXISTS stage_id uuid REFERENCES event_stages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS event_distances_stage_id_idx ON event_distances(stage_id);

COMMENT ON COLUMN event_distances.stage_id IS
  'The Race stage this distance belongs to. NULL for legacy event-level rows. '
  'New distances are always linked to a Race stage via sync_event_stages.';


-- ============================================================================
-- 5. EVENTS — make start_date / end_date nullable
-- ============================================================================
-- Event date range is now derived from stage times in app logic (saveEvent action).
-- Making these nullable avoids a constraint violation when stages have no times yet.

ALTER TABLE events
  ALTER COLUMN start_date DROP NOT NULL,
  ALTER COLUMN end_date   DROP NOT NULL;

COMMENT ON COLUMN events.start_date IS
  'Derived from the min start_time of the event''s Race stages. Set by saveEvent action.';
COMMENT ON COLUMN events.end_date IS
  'Derived from the max end_time of the event''s Race stages. Set by saveEvent action.';


-- ============================================================================
-- 6. sync_event_stages RPC — replace with Stage-model-aware version
-- ============================================================================
-- New p_stages JSON shape per element:
--   {
--     name:       string  (required; rows with empty name are skipped)
--     stage_type: string  ('race' | 'non_race'; defaults to 'race')
--     start_time: string  (ISO 8601 timestamptz or null)
--     end_time:   string  (ISO 8601 timestamptz or null)
--     venue:      string  (optional)
--     position:   integer (defaults to 0)
--     distances:  [{ label: string, position: integer }]  (Race stages only)
--   }
--
-- Atomically within one transaction:
--   1. Deletes all existing event_stages rows for p_event_id / p_tenant_id
--   2. Deletes all existing event_distances rows for p_event_id / p_tenant_id
--   3. Inserts new event_stages rows
--   4. Inserts distance rows linked to newly created stage rows (Race stages only)
--
-- Runs as SECURITY INVOKER so the caller's RLS context applies.
-- The application layer verifies tenant_admin role before calling this function.

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
    name, stage_type, start_time, end_time, venue,
    stage_date,   -- kept nullable; new rows always NULL
    position
  )
  SELECT
    p_event_id,
    p_tenant_id,
    trim(s->>'name'),
    coalesce(nullif(trim(s->>'stage_type'), ''), 'race'),
    nullif(trim(coalesce(s->>'start_time', '')), '')::timestamptz,
    nullif(trim(coalesce(s->>'end_time',   '')), '')::timestamptz,
    nullif(trim(coalesce(s->>'venue',      '')), ''),
    NULL,
    coalesce((s->>'position')::integer, 0)
  FROM jsonb_array_elements(p_stages) AS s
  WHERE trim(coalesce(s->>'name', '')) <> '';

  -- Insert distances for Race stages, matched by name within the same event.
  -- Uses a sub-select so distance rows can reference the freshly-inserted stage ids.
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
  'Stage model v0.7: accepts stage_type, start_time, end_time, distances per Race stage.';


-- ============================================================================
-- DONE
-- ============================================================================
-- Verify with:
--   SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'event_stages'
--   ORDER BY ordinal_position;
--
--   SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'workstations'
--   ORDER BY ordinal_position;
--
--   SELECT policyname, cmd FROM pg_policies
--   WHERE schemaname = 'public'
--     AND tablename IN ('event_stages', 'workstations')
--   ORDER BY tablename, policyname;
