-- 1. Add nullable first so backfill can run before NOT NULL is enforced
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS slot_index integer;

-- 2. Backfill existing rows: stable lane number per (workstation, timeslot),
--    ordered by creation time so existing assignments get a consistent lane.
WITH numbered AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY workstation_id, timeslot_start
      ORDER BY created_at, id
    ) AS rn
  FROM assignments
  WHERE slot_index IS NULL
)
UPDATE assignments
SET slot_index = numbered.rn
FROM numbered
WHERE assignments.id = numbered.id;

-- 3. Enforce NOT NULL going forward
ALTER TABLE assignments ALTER COLUMN slot_index SET NOT NULL;

-- 4. No two assignments can share the same slot in the same workstation + timeslot.
--    Over-capacity (slot_index > capacity_ceiling) is intentionally allowed here —
--    it surfaces as an overflow row in the UI and is warned but not blocked.
ALTER TABLE assignments
  ADD CONSTRAINT uq_assignments_workstation_timeslot_slot
  UNIQUE (workstation_id, timeslot_start, slot_index);
