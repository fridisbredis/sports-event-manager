-- ============================================================================
-- Migration 20261030073124: delete push subscriptions of inactive users
-- ============================================================================
--
-- N31 follow-up, closing the GDPR gap documented in the header of
-- 20261029134922_push_subscriptions.sql. A push subscription's endpoint
-- identifies a device at Apple's, Google's or Mozilla's push service, so it is
-- personal data under the SEC-09 retention decision (24 months of inactivity,
-- measured by auth.users.last_sign_in_at). Rows only went away with the auth
-- user (on delete cascade), and nothing ever deletes inactive auth users, so
-- they were kept indefinitely.
--
-- A SEPARATE FUNCTION AND CRON JOB, NOT AN EXTENSION OF
-- anonymize_inactive_users(). The push_subscriptions header planned the
-- latter; it would not work. That function still sets officials.name/phone to
-- NULL while both columns are NOT NULL (the bug documented in
-- 20260911145759, re-checked on dev 2026-10-30), so it raises 23502 on its
-- first real official candidate and its whole call rolls back. A delete added
-- to it would roll back with it, and the subscriptions it exists to remove
-- would be kept by exactly the users it targets. Its own job keeps this
-- deletion independent of that bug and of whatever redaction scheme
-- eventually fixes it.
--
-- NO ADMIN EXCLUSION, unlike anonymize_inactive_users(). That function spares
-- a current admin's roster row because the row is what makes them
-- schedulable (F-MNT-20). A push subscription carries no such duty: deleting
-- one only means the device stops getting push, and the user turns it back on
-- with one tap the next time they sign in — which is the only thing that
-- would make them active again anyway. SMS is unaffected either way.
--
-- Hard delete, not anonymization: a subscription row has no history worth
-- keeping, and nothing references it.
--
-- Forward-fix: additive
--   Rollback: in a new timestamped migration,
--             select cron.unschedule('gdpr-delete-inactive-push-subscriptions');
--             drop function if exists public.delete_inactive_push_subscriptions();
--   Data:     deletes push_subscriptions rows of users inactive 24+ months on
--             each daily run; not recoverable, and not needed — each is one
--             tap to recreate and SMS keeps arriving regardless. Today's
--             subscriptions are all days old, so the first run deletes none.
--   Blast:    if the predicate were wrong, the worst case is devices losing
--             push until their user re-enables it; no other table is touched.
--   Window:   compatible — a new function and job nothing deployed calls.
-- ============================================================================

create or replace function public.delete_inactive_push_subscriptions()
returns integer
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_deleted integer;
begin
  -- Same inactivity test as anonymize_inactive_users(). A user with no
  -- sign-in at all cannot have a subscription (enabling push needs a
  -- session), and a NULL last_sign_in_at fails the comparison, so such rows
  -- are never touched.
  delete from public.push_subscriptions ps
  where public.get_last_sign_in_at(ps.user_id) <= now() - interval '24 months';

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

comment on function public.delete_inactive_push_subscriptions is
  'N31/SEC-09: deletes push subscriptions of users inactive '
  '(auth.users.last_sign_in_at) for 24+ months. Separate from '
  'anonymize_inactive_users so its known NOT NULL failure cannot roll this '
  'back. No admin exclusion: losing a subscription costs one tap to re-enable. '
  'Returns the number of rows deleted.';

revoke all on function public.delete_inactive_push_subscriptions() from public, anon, authenticated;
grant execute on function public.delete_inactive_push_subscriptions() to service_role, postgres;

-- Daily, alongside 'gdpr-anonymize-inactive-users' (0029). cron.schedule
-- upserts on the job name, so a re-run replaces the job instead of adding a
-- second one.
select cron.schedule(
  'gdpr-delete-inactive-push-subscriptions',
  '0 3 * * *',
  $$select public.delete_inactive_push_subscriptions();$$
);

-- ============================================================================
-- DONE
-- ============================================================================
-- Verify with:
--   select jobname, schedule, active from cron.job where jobname like 'gdpr-%';
--   -- expect gdpr-delete-inactive-push-subscriptions, '0 3 * * *', true
