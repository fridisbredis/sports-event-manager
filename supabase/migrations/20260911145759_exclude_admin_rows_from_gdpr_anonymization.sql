-- ============================================================================
-- Migration 20260911145759: exclude admin-owned rows from GDPR anonymization
-- ============================================================================
--
-- Follow-up to F-MNT-20 (migrations 20260911130436 / 20260911130546), raised
-- by Eduardo in review of PR #187.
--
-- anonymize_inactive_users (migration 0029) nulls name/phone/user_id and sets
-- invite_status = 'removed' on any officials row whose user has not signed in
-- for 24+ months. Its header says "Only officials and participants are in
-- scope — tenant_admin/system_admin are unaffected." That was true only
-- because admins had no officials row to anonymize. F-MNT-20 gives them one,
-- so the statement quietly became false: the WHERE clause filters on name,
-- user_id and inactivity only, and has never had any notion of role.
--
-- Left alone, a tenant_admin inactive for 24+ months would have their roster
-- row anonymized and flipped to 'removed' — silently breaking the "an admin is
-- always schedulable" invariant F-MNT-20 exists to establish, and dropping
-- them off OFF-01 and back into a 404 on ACCT-01. The job is live: pg_cron
-- job 1 ('gdpr-anonymize-inactive-users') runs daily at 03:00 on prod.
--
-- Practical odds today are low — the most inactive admin in prod is 1 month
-- out, and any sign-in resets the clock — but "low odds" is not the same as
-- "cannot happen", and the failure would be silent and data-destroying.
--
-- The same gap applies to the 23-month SMS warning
-- (src/app/api/cron/gdpr-warning/route.ts), which selects officials rows with
-- no role filter either. Fixing it here rather than in the route handler
-- covers both paths at once: the warning job skips rows the anonymizer will
-- not touch, via the same predicate. Without that, an admin would receive an
-- SMS saying their account is about to be deleted, and then nothing would
-- happen — worse than either behaviour on its own.
--
-- Scope of the exclusion: current role holders, not "was ever an admin". An
-- admin who legitimately loses the role becomes an ordinary inactive official
-- and is anonymized on the next pass, so this does not create a permanent
-- retention carve-out that GDPR would not support. system_admin rows carry
-- tenant_id = NULL (migration 0021), so they are matched on user_id alone.
--
-- SEPARATE PRE-EXISTING BUG, found while testing this migration and NOT
-- fixed here: anonymize_inactive_users sets officials.name/phone (and
-- participants.name/phone) to NULL, but all four columns are NOT NULL
-- (migration 0001, confirmed on prod 2026-09-11). The function therefore
-- raises 23502 on its first real candidate row — SEC-09's anonymization has
-- never been able to run. It looks healthy today only because no prod user
-- is 24 months inactive yet: cron job 1 has 17 successful runs, all of which
-- matched zero rows. The oldest sign-in on prod is 2026-07-10, so the first
-- genuine pass is due 2028-07-10, and it would fail.
--
-- Deliberately left alone: fixing it means choosing a redaction scheme for
-- NOT NULL columns (sentinel string, or dropping the constraints), which is
-- a GDPR-policy decision for Peter, not a side effect of a roster-row fix.
-- Filed as a follow-up. This migration narrows which rows the anonymizer
-- targets and does not touch how it redacts them, so it neither causes nor
-- worsens that bug — and once the admin exclusion is in place, the broken
-- path has one fewer row to break on.
--
-- Forward-fix: replace
--   Rollback: restore the function body from migration
--             0029_gdpr_inactivity_cleanup.sql verbatim — it is unchanged
--             apart from the two `not exists` clauses added here.
--   Data:     no data loss. This only ever anonymizes FEWER rows than before;
--             it cannot anonymize a row 0029 would have spared. Nothing is
--             un-anonymized by it either — a row already nulled by an earlier
--             pass stays nulled (name is null excludes it from re-processing,
--             as before).
--   Blast:    if this migration is itself wrong, the worst case is that some
--             rows that should be anonymized are skipped — a retention-policy
--             delay, visible in the next pass once fixed, not a data loss or
--             an exposure. The GDPR warning route needs no deploy to match:
--             it reads the same table and its own filter is unchanged.
--   Window:   compatible — no schema change, and the currently deployed app
--             does not call this function at all (pg_cron does).
-- ============================================================================

create or replace function public.anonymize_inactive_users()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  -- Officials: anonymize personal data, keep the row so historical
  -- assignments (which reference officials.id) don't dangle. Excludes rows
  -- already anonymized (name is null) so re-runs are cheap no-ops.
  --
  -- F-MNT-20: also excludes rows owned by a current tenant_admin of the same
  -- tenant, or by a system_admin (whose user_roles row carries tenant_id =
  -- NULL per migration 0021). Their roster row is what makes them schedulable;
  -- anonymizing it would break that invariant silently.
  update public.officials o
  set
    name = null,
    phone = null,
    user_id = null,
    invite_status = 'removed',
    gdpr_warning_sent_at = null
  where o.name is not null
    and o.user_id is not null
    and public.get_last_sign_in_at(o.user_id) is not null
    and public.get_last_sign_in_at(o.user_id) <= now() - interval '24 months'
    and not exists (
      select 1 from public.user_roles ur
      where ur.user_id = o.user_id
        and (
          (ur.role = 'tenant_admin' and ur.tenant_id = o.tenant_id)
          or ur.role = 'system_admin'
        )
    );

  update public.participants p
  set
    name = null,
    phone = null,
    user_id = null,
    gdpr_warning_sent_at = null
  where p.name is not null
    and p.user_id is not null
    and public.get_last_sign_in_at(p.user_id) is not null
    and public.get_last_sign_in_at(p.user_id) <= now() - interval '24 months'
    and not exists (
      select 1 from public.user_roles ur
      where ur.user_id = p.user_id
        and (
          (ur.role = 'tenant_admin' and ur.tenant_id = p.tenant_id)
          or ur.role = 'system_admin'
        )
    );
end;
$$;

comment on function public.anonymize_inactive_users is
  'SEC-09: nulls name/phone/user_id for officials and participants inactive '
  '(auth.users.last_sign_in_at) for 24+ months. Officials also get '
  'invite_status = ''removed''. Rows are kept (not deleted) so historical '
  'assignments/announcements referencing them by id remain intact. '
  'F-MNT-20 (20260911145759): rows owned by a current tenant_admin of the '
  'same tenant, or by a system_admin, are excluded — an admin''s roster row '
  'is what makes them schedulable, and 0029''s claim that admins were '
  'unaffected held only while they had no roster row. Losing the role makes '
  'the row eligible again on the next pass.';

-- Unchanged from 0029, restated so a future reader of this file sees the
-- whole grant picture rather than half of it.
revoke all on function public.anonymize_inactive_users() from public, anon, authenticated;
grant execute on function public.anonymize_inactive_users() to service_role, postgres;

-- ============================================================================
-- DONE
-- ============================================================================
-- Verify with — expect zero rows (no current admin is anonymization-eligible):
--   select o.id from officials o
--   join user_roles ur on ur.user_id = o.user_id
--    and (ur.role = 'system_admin' or (ur.role = 'tenant_admin' and ur.tenant_id = o.tenant_id))
--   where o.name is null;
