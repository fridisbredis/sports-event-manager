-- Forward-fix: destructive
--   Rollback: alter table public.officials drop constraint officials_phone_format;
--   Data:     no snapshot required (constraint-only): validates existing rows,
--             writes none
--   Blast:    inserts with a malformed phone start failing
--   Window:   compatible
alter table public.officials
  add constraint officials_phone_format check (phone ~ '^\+[0-9]{8,15}$');
