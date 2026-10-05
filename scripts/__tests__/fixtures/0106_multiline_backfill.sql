-- Forward-fix: destructive
--   Rollback: none
--   Data:     no snapshot required (constraint-only)
--   Blast:    rows silently rewritten
--   Window:   compatible
alter table public.officials add column locale text;
UPDATE
  public.officials
SET
  locale = 'en'
WHERE locale is null;
