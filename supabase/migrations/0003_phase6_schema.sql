-- ============================================================================
-- Migration 0003: Phase 6 schema additions
-- ============================================================================
--
-- Adds:
--   - events.status (draft / published) and scheduling_granularity_min
--   - event_stages (multi-day events like Viadal)
--   - workstations (staffed posts with capacity ceiling)
--   - workstation_operating_windows (one or more open windows per station)
--   - workstation_todos (checklists, informational in v1)
--   - assignments rework: FK to workstation, FK to todo, status enum
--
-- Defensive: uses IF NOT EXISTS / IF EXISTS / DO $$ blocks so this can be
-- re-run safely on a partially-applied database.
--
-- Decisions reflected here (see docs/flows/*.md):
--   - Capacity is an "up to X" ceiling, not a per-timeslot minimum
--     (workstation-checklist-config.md)
--   - A workstation can have multiple discrete operating windows per day
--   - Allocation outside an operating window is hard-blocked (enforced in
--     app logic; DB allows it but UI prevents it)
--   - Allocation above capacity ceiling is warned but allowed (also app-level)
--   - Person-timeslot status: assigned | available | on_break | blocked
--   - Checklist completion tracking is NOT in v1 (informational only)
-- ============================================================================


-- ============================================================================
-- 1. EVENTS: add status and scheduling_granularity_min
-- ============================================================================

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published'));

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS scheduling_granularity_min integer NOT NULL DEFAULT 60
    CHECK (scheduling_granularity_min > 0);

COMMENT ON COLUMN events.status IS
  'draft = visible to admins only; published = visible to officials and participants per role';
COMMENT ON COLUMN events.scheduling_granularity_min IS
  'Length of one timeslot in minutes (e.g. 60 = 1 hour, the Viadal default)';


-- ============================================================================
-- 2. EVENT_STAGES: Event → Stage/Day → Venue structure
-- ============================================================================
-- For multi-day events: each stage/day has its own date and venue.
-- Viadal has 6 stages (one per day).

CREATE TABLE IF NOT EXISTS event_stages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_id    uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name        text NOT NULL,
  stage_date  date NOT NULL,
  venue       text,
  position    integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS event_stages_event_id_idx ON event_stages(event_id);
CREATE INDEX IF NOT EXISTS event_stages_tenant_id_idx ON event_stages(tenant_id);

ALTER TABLE event_stages ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'event_stages'
      AND policyname = 'event_stages_tenant_isolation'
  ) THEN
    CREATE POLICY event_stages_tenant_isolation ON event_stages
      FOR ALL
      USING (
        tenant_id IN (
          SELECT tenant_id FROM user_roles WHERE user_id = auth.uid()
        )
      );
  END IF;
END $$;


-- ============================================================================
-- 3. WORKSTATIONS: staffed posts (timing point, depå, finish line, etc.)
-- ============================================================================

CREATE TABLE IF NOT EXISTS workstations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_id          uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name              text NOT NULL,
  description       text,
  capacity_ceiling  integer NOT NULL CHECK (capacity_ceiling > 0),
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workstations_event_id_idx ON workstations(event_id);
CREATE INDEX IF NOT EXISTS workstations_tenant_id_idx ON workstations(tenant_id);

COMMENT ON COLUMN workstations.capacity_ceiling IS
  '"Up to X" headcount ceiling. Staffing below is normal; exceeding warns (app-level)';

ALTER TABLE workstations ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'workstations'
      AND policyname = 'workstations_tenant_isolation'
  ) THEN
    CREATE POLICY workstations_tenant_isolation ON workstations
      FOR ALL
      USING (
        tenant_id IN (
          SELECT tenant_id FROM user_roles WHERE user_id = auth.uid()
        )
      );
  END IF;
END $$;


-- ============================================================================
-- 4. WORKSTATION_OPERATING_WINDOWS: when each station is open
-- ============================================================================
-- A station can have multiple discrete windows per day (e.g. Toa-området
-- checked at 07:00, 12:00, 18:00, each as its own window). Timeslots outside
-- ALL of a station's windows are not allocable (enforced at UI level).
--
-- No tenant_id directly here — inherits via workstation, RLS policy checks
-- through the workstation table.

CREATE TABLE IF NOT EXISTS workstation_operating_windows (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workstation_id  uuid NOT NULL REFERENCES workstations(id) ON DELETE CASCADE,
  window_start    timestamptz NOT NULL,
  window_end      timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (window_end > window_start)
);

CREATE INDEX IF NOT EXISTS workstation_op_windows_ws_idx
  ON workstation_operating_windows(workstation_id);

ALTER TABLE workstation_operating_windows ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'workstation_operating_windows'
      AND policyname = 'workstation_op_windows_tenant_isolation'
  ) THEN
    CREATE POLICY workstation_op_windows_tenant_isolation
      ON workstation_operating_windows
      FOR ALL
      USING (
        workstation_id IN (
          SELECT id FROM workstations
          WHERE tenant_id IN (
            SELECT tenant_id FROM user_roles WHERE user_id = auth.uid()
          )
        )
      );
  END IF;
END $$;


-- ============================================================================
-- 5. WORKSTATION_TODOS: checklist items per workstation
-- ============================================================================
-- V1 semantics: informational only. No stored completion, no admin readiness
-- view. A later version may add mandatory-checkoff toggle + completion tracking
-- behind the feature-toggle layer.

CREATE TABLE IF NOT EXISTS workstation_todos (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workstation_id    uuid NOT NULL REFERENCES workstations(id) ON DELETE CASCADE,
  instruction_text  text NOT NULL,
  position          integer NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workstation_todos_ws_idx
  ON workstation_todos(workstation_id);

ALTER TABLE workstation_todos ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'workstation_todos'
      AND policyname = 'workstation_todos_tenant_isolation'
  ) THEN
    CREATE POLICY workstation_todos_tenant_isolation ON workstation_todos
      FOR ALL
      USING (
        workstation_id IN (
          SELECT id FROM workstations
          WHERE tenant_id IN (
            SELECT tenant_id FROM user_roles WHERE user_id = auth.uid()
          )
        )
      );
  END IF;
END $$;


-- ============================================================================
-- 6. ASSIGNMENTS: rework to use FK references and add status
-- ============================================================================
-- Old schema (migration 0001):
--   assignments(id, tenant_id, official_id, workstation TEXT, timeslot_start,
--               timeslot_end, todo TEXT, created_at)
--
-- New schema:
--   - workstation_id FK (nullable, so non-work statuses can exist)
--   - todo_id FK (nullable, optional even when assigned)
--   - status enum: assigned | available | on_break | blocked
--   - CHECK: status='assigned' requires workstation_id NOT NULL
--
-- The legacy TEXT columns (workstation, todo) are dropped since the scheduling
-- UI hasn't been built yet — no production data is lost.

-- Drop old text columns (defensive: only if they exist)
ALTER TABLE assignments DROP COLUMN IF EXISTS workstation;
ALTER TABLE assignments DROP COLUMN IF EXISTS todo;

-- Add new FK + status columns
ALTER TABLE assignments
  ADD COLUMN IF NOT EXISTS workstation_id uuid
    REFERENCES workstations(id) ON DELETE SET NULL;

ALTER TABLE assignments
  ADD COLUMN IF NOT EXISTS todo_id uuid
    REFERENCES workstation_todos(id) ON DELETE SET NULL;

ALTER TABLE assignments
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'assigned'
    CHECK (status IN ('assigned', 'available', 'on_break', 'blocked'));

COMMENT ON COLUMN assignments.status IS
  'assigned = working at a workstation (requires workstation_id); '
  'available = free / on call; '
  'on_break = scheduled break; '
  'blocked = unavailable (e.g. worked night before)';

-- CHECK: status='assigned' requires workstation_id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'assignments_status_workstation_check'
  ) THEN
    ALTER TABLE assignments
      ADD CONSTRAINT assignments_status_workstation_check
      CHECK (
        (status = 'assigned' AND workstation_id IS NOT NULL)
        OR
        (status <> 'assigned')
      );
  END IF;
END $$;

-- Indexes for the queries the scheduling views will run
CREATE INDEX IF NOT EXISTS assignments_workstation_id_idx
  ON assignments(workstation_id);
CREATE INDEX IF NOT EXISTS assignments_official_id_idx
  ON assignments(official_id);
CREATE INDEX IF NOT EXISTS assignments_timeslot_idx
  ON assignments(timeslot_start, timeslot_end);


-- ============================================================================
-- DONE
-- ============================================================================
-- Verify with:
--   SELECT table_name, column_name, data_type
--   FROM information_schema.columns
--   WHERE table_schema = 'public'
--     AND table_name IN ('events', 'event_stages', 'workstations',
--                        'workstation_operating_windows', 'workstation_todos',
--                        'assignments')
--   ORDER BY table_name, ordinal_position;
