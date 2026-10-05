-- Forward-fix: destructive
--   Rollback: alter table public.officials add column legacy_note text;
--   Blast:    deployed code selecting legacy_note breaks
--   Window:   compatible
alter table public.officials drop column legacy_note;
