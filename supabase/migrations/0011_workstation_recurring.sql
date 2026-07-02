ALTER TABLE workstations
  ADD COLUMN IF NOT EXISTS recurring boolean NOT NULL DEFAULT false;
