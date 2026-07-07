-- Fix FK: workstations → event_stages (SET NULL → CASCADE)
ALTER TABLE workstations
  DROP CONSTRAINT workstations_stage_id_fkey,
  ADD CONSTRAINT workstations_stage_id_fkey
    FOREIGN KEY (stage_id) REFERENCES event_stages(id) ON DELETE CASCADE;

-- Fix FK: assignments → workstations (SET NULL → CASCADE)
ALTER TABLE assignments
  DROP CONSTRAINT assignments_workstation_id_fkey,
  ADD CONSTRAINT assignments_workstation_id_fkey
    FOREIGN KEY (workstation_id) REFERENCES workstations(id) ON DELETE CASCADE;

-- Clean up workstations orphaned by the already-deleted stage
-- (assignments cascade-delete via the new FK above)
DELETE FROM workstations WHERE stage_id IS NULL;
