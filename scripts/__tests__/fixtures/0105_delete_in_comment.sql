-- Forward-fix: destructive
--   Rollback: alter table public.otp_attempts drop constraint otp_attempts_window;
--   Data:     no snapshot required (constraint-only): see note below
--   Blast:    inserts outside the window start failing
--   Window:   compatible
--
-- Note: an earlier draft of this migration did a
-- DELETE FROM public.otp_attempts before adding the constraint. That was
-- dropped in review; the rows are purged by the cron job instead.
/* Also considered: TRUNCATE public.otp_attempts. Rejected. */
alter table public.otp_attempts
  add constraint otp_attempts_window check (created_at <= now());
