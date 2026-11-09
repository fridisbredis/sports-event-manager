-- ============================================================================
-- Migration 20261109142553: delete ICE contacts of inactive users
-- ============================================================================
--
-- N37 follow-up, closing the GDPR gap named in the header of
-- 20261109141949_user_ice_contacts.sql. An ICE row holds a THIRD person's
-- name and phone number — someone who never signed up and never consented to
-- the app themselves — so it is personal data under the SEC-09 retention
-- decision (24 months of inactivity, measured by auth.users.last_sign_in_at).
-- Rows only went away with the auth user (on delete cascade), and nothing
-- deletes inactive auth users, so without this they would be kept forever.
--
-- SAME SHAPE AS 20261030073124_delete_inactive_push_subscriptions.sql, for the
-- same reason: a separate function and cron job, not an extension of
-- anonymize_inactive_users(). That function still fails on its first real
-- official candidate (NOT NULL on officials.name/phone, documented in
-- 20260911145759), and a delete added to it would roll back with it.
--
-- NO ADMIN EXCLUSION. anonymize_inactive_users() spares a current admin's
-- roster row because it is what makes them schedulable (F-MNT-20). An ICE
-- contact carries no such duty; an admin inactive for 24 months who signs in
-- again re-enters it on My account.
--
-- Hard delete, not anonymization: an ICE row with its fields nulled is
-- worthless, and nothing references it.
--
-- Forward-fix: additive
--   Rollback: in a new timestamped migration,
--             select cron.unschedule('gdpr-delete-inactive-ice-contacts');
--             drop function if exists public.delete_inactive_ice_contacts();
--   Data:     deletes user_ice_contacts rows of users inactive 24+ months on
--             each daily run; not recoverable, by design (retention policy).
--             The table is created in the previous migration and is empty,
--             so the first runs delete nothing.
--   Blast:    if the predicate were wrong, the worst case is active users
--             losing their ICE contact and admins seeing "No ICE contact
--             given" until it is re-entered; no other table is touched.
--   Window:   compatible — a new function and job nothing deployed calls.
-- ============================================================================

create or replace function public.delete_inactive_ice_contacts()
returns integer
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_deleted integer;
begin
  -- Same inactivity test as anonymize_inactive_users() and
  -- delete_inactive_push_subscriptions(). A NULL last_sign_in_at fails the
  -- comparison, so a user who never signed in is not touched — they cannot
  -- have written a row anyway (writing needs a session).
  delete from public.user_ice_contacts ice
  where public.get_last_sign_in_at(ice.user_id) <= now() - interval '24 months';

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

comment on function public.delete_inactive_ice_contacts is
  'N37/SEC-09: deletes ICE contacts of users inactive '
  '(auth.users.last_sign_in_at) for 24+ months. Separate from '
  'anonymize_inactive_users so its known NOT NULL failure cannot roll this '
  'back. No admin exclusion. Returns the number of rows deleted.';

revoke all on function public.delete_inactive_ice_contacts() from public, anon, authenticated;
grant execute on function public.delete_inactive_ice_contacts() to service_role, postgres;

-- Daily, alongside the other gdpr-* jobs. cron.schedule upserts on the job
-- name, so a re-run replaces the job instead of adding a second one.
select cron.schedule(
  'gdpr-delete-inactive-ice-contacts',
  '0 3 * * *',
  $$select public.delete_inactive_ice_contacts();$$
);

-- ============================================================================
-- DONE
-- ============================================================================
-- Verify with:
--   select jobname, schedule, active from cron.job where jobname like 'gdpr-%';
--   -- expect gdpr-delete-inactive-ice-contacts, '0 3 * * *', true
