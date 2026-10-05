-- Forward-fix: destructive
--   Rollback: alter table public.officials add column legacy_note text;
--   Data:     no snapshot required (constraint-only)
--   Blast:    deployed code selecting legacy_note breaks
--   Window:   compatible
alter table public.officials DROP COLUMN legacy_note;
