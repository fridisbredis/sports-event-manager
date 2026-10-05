-- Forward-fix: destructive
--   Rollback: restore from the snapshot below
--   Data:     0103_pre-migration_2026-09-11T08:14:02Z.tar.gz
--   Blast:    assignments rewritten against the wrong stage
--   Window:   compatible
UPDATE public.assignments SET stage_id = NULL WHERE stage_id = 0;
