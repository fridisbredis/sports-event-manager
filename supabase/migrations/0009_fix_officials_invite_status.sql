-- 0009_fix_officials_invite_status.sql
-- Fix officials invite_status: align DB constraint and default with spec values
-- Old: default 'pending', check in ('pending', 'accepted', 'declined')
-- New: default 'invited', check in ('invited', 'confirmed', 'removed')

ALTER TABLE officials
  DROP CONSTRAINT officials_invite_status_check;

UPDATE officials SET invite_status = 'invited'   WHERE invite_status = 'pending';
UPDATE officials SET invite_status = 'confirmed' WHERE invite_status = 'accepted';
UPDATE officials SET invite_status = 'removed'   WHERE invite_status = 'declined';

ALTER TABLE officials
  ALTER COLUMN invite_status SET DEFAULT 'invited';

ALTER TABLE officials
  ADD CONSTRAINT officials_invite_status_check
    CHECK (invite_status IN ('invited', 'confirmed', 'removed'));
