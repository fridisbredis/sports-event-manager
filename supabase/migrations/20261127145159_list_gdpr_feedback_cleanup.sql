-- ============================================================================
-- Migration 20261127145159: list feedback due for GDPR removal (N80)
-- ============================================================================
--
-- N71 (migration 20261127094110) stores feedback — title, body, page, sender,
-- role and one optional image — until the sender's auth user is deleted, and
-- nothing deletes inactive auth users. A bug report can name a colleague and a
-- screenshot can show other people's names and phone numbers, so this is
-- personal data under the SEC-09 retention decision (24 months of inactivity,
-- measured by auth.users.last_sign_in_at).
--
-- DECIDED (Peter, 2026-11-27, board card N80):
--   - Retention: same as other personal data. After 24 months of inactivity
--     the sender's feedback rows AND images are deleted (option a). Not
--     anonymized: old reports are not kept for their content.
--   - A sender cannot delete their own feedback. Nothing to build for that:
--     authenticated has no DELETE grant or policy on public.feedback, and the
--     storage delete policy only covers an upload no row references yet.
--
-- SAME SHAPE AS 20261111140445_list_gdpr_avatar_cleanup.sql, for the same
-- reason: SQL cannot delete the image (deleting from storage.objects leaves
-- the file in the storage backend), so the removal goes through the Storage
-- API from the app. This function only LISTS the rows; it writes nothing. The
-- daily /api/cron/gdpr-warning route removes each row's image and then deletes
-- the row. The row itself is the retry queue: if the image removal fails, the
-- row stays and is listed again on the next run, with its image_path intact.
-- Deleting the row in SQL first would lose the only pointer to the file.
--
-- NOT PART OF anonymize_inactive_users(), which still fails on its first real
-- official (NOT NULL on officials.name/phone, documented in 20260911145759).
-- Anything added to it would roll back with it.
--
-- NO ADMIN EXCLUSION. anonymize_inactive_users() spares a current admin's
-- roster row because it is what makes them schedulable (F-MNT-20). Feedback
-- carries no such duty — same reasoning as 20261109142553 (ICE contacts).
--
-- A NULL last_sign_in_at fails the comparison, so a user who never signed in
-- is not listed — they cannot have written a row anyway (insert needs a
-- session).
--
-- Forward-fix: additive
--   Rollback: in a new timestamped migration,
--             drop function if exists public.list_gdpr_feedback_cleanup();
--             and deploy an app version whose gdpr-warning route does not
--             call it (it logs the RPC failure and carries on otherwise).
--   Data:     none. Read-only function; the deletions happen in the app.
--   Blast:    if the predicate were too wide, active users' feedback rows and
--             images would be deleted by the next daily run — not recoverable
--             outside a backup. No other table is touched.
--   Window:   compatible — a new function nothing deployed calls yet. The
--             route that calls it is shipped in the same PR, after this.
-- ============================================================================

create or replace function public.list_gdpr_feedback_cleanup()
returns table (feedback_id uuid, feedback_tenant_id uuid, image_path text)
language sql
stable
security definer
set search_path = public, auth
as $$
  select f.id, f.tenant_id, f.image_path
  from public.feedback f
  where public.get_last_sign_in_at(f.user_id) <= now() - interval '24 months';
$$;

comment on function public.list_gdpr_feedback_cleanup is
  'N80/SEC-09: feedback whose sender has been inactive '
  '(auth.users.last_sign_in_at) for 24+ months. Read-only; the gdpr-warning '
  'cron route deletes the image via the Storage API and then the row. '
  'Separate from anonymize_inactive_users so its known NOT NULL failure '
  'cannot block this, and so image_path survives until the file is gone. '
  'No admin exclusion.';

revoke all on function public.list_gdpr_feedback_cleanup() from public, anon, authenticated;
grant execute on function public.list_gdpr_feedback_cleanup() to service_role, postgres;

-- ============================================================================
-- DONE
-- ============================================================================
-- Verify with:
--   select proname from pg_proc where proname = 'list_gdpr_feedback_cleanup';
--   select * from public.list_gdpr_feedback_cleanup();  -- expect 0 rows on prod
