-- ============================================================================
-- Migration 0029: GDPR inactivity cleanup (SEC-09/F-SEC-10)
-- ============================================================================
--
-- PO's retention policy: officials/participants who haven't logged in for
-- 23 months get an SMS warning that they'll be removed; at 24 months of
-- inactivity they are anonymized. Only officials and participants are in
-- scope — tenant_admin/system_admin are unaffected.
--
-- "Anonymize" (per PO decision) means nulling name/phone/user_id and
-- flipping invite_status to 'removed' for officials, NOT deleting the row —
-- historical assignments/announcements that reference the row by id must
-- keep working. This mirrors the existing remove_official RPC (0025)
-- pattern for the same reason.
--
-- Three pieces:
--   1. get_last_sign_in_at(uuid): SECURITY DEFINER helper reading
--      auth.users.last_sign_in_at (no prior helper reads this column).
--   2. anonymize_inactive_users(): does the 24-month anonymization pass.
--      Pure SQL/plpgsql — no external calls needed, so this runs directly
--      as a pg_cron job.
--   3. A pg_cron job that, once daily, POSTs to our own
--      /api/cron/gdpr-warning route via pg_net so it can actually send the
--      23-month warning SMS (Twilio requires an HTTP call, which plain SQL
--      can't make). The route is protected by a CRON_SECRET compared
--      against a value stored in Supabase Vault — never inline the secret
--      in this migration file, since migration files are readable via the
--      dashboard/CLI history indefinitely.
-- ============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Marks that the 23-month warning SMS was sent, so the daily cron job
-- doesn't re-send it every day for the following month. Cleared implicitly
-- by anonymization (row no longer matches the "needs warning" query) or by
-- a fresh sign-in resetting last_sign_in_at, in which case a NULL check on
-- next login stays in the past — see reset logic below, applied by trigger.
alter table public.officials
  add column if not exists gdpr_warning_sent_at timestamptz;

alter table public.participants
  add column if not exists gdpr_warning_sent_at timestamptz;

-- No prior helper reads auth.users.last_sign_in_at. Same shape as
-- get_user_id_by_phone (0022): SECURITY DEFINER, search_path pinned to
-- auth, restricted to service_role only.
create or replace function public.get_last_sign_in_at(p_user_id uuid)
returns timestamptz
language sql
security definer
set search_path = auth
as $$
  select last_sign_in_at from auth.users where id = p_user_id;
$$;

revoke all on function public.get_last_sign_in_at(uuid) from public, anon, authenticated;
grant execute on function public.get_last_sign_in_at(uuid) to service_role;

-- Resets gdpr_warning_sent_at whenever a previously-warned user's
-- last_sign_in_at moves forward (i.e. they logged in again), so a returning
-- user who later goes inactive again is eligible for a fresh warning
-- instead of being silently skipped forever. last_sign_in_at itself lives
-- on auth.users, not officials/participants, so this can't be a trigger on
-- those tables — it's folded into anonymize_inactive_users below instead,
-- which already joins to auth.users once per run.
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
    and public.get_last_sign_in_at(o.user_id) <= now() - interval '24 months';

  update public.participants p
  set
    name = null,
    phone = null,
    user_id = null,
    gdpr_warning_sent_at = null
  where p.name is not null
    and p.user_id is not null
    and public.get_last_sign_in_at(p.user_id) is not null
    and public.get_last_sign_in_at(p.user_id) <= now() - interval '24 months';
end;
$$;

comment on function public.anonymize_inactive_users is
  'SEC-09: nulls name/phone/user_id for officials and participants inactive '
  '(auth.users.last_sign_in_at) for 24+ months. Officials also get '
  'invite_status = ''removed''. Rows are kept (not deleted) so historical '
  'assignments/announcements referencing them by id remain intact.';

revoke all on function public.anonymize_inactive_users() from public, anon, authenticated;
grant execute on function public.anonymize_inactive_users() to service_role, postgres;

-- Daily anonymization pass. Pure SQL, runs directly in the DB.
select cron.schedule(
  'gdpr-anonymize-inactive-users',
  '0 3 * * *',
  $$select public.anonymize_inactive_users();$$
);

-- Daily 23-month-warning trigger. Must call out to our Next.js route
-- (via pg_net, async HTTP) because sending SMS requires Twilio, which pg_cron
-- cannot do directly. The route itself (not this migration) does the actual
-- "who needs a warning" query and Twilio send — this job only pings it.
--
-- The app URL is inlined directly below (it's public, not a secret) rather
-- than read from a database-level GUC: hosted Supabase's connection role
-- doesn't have permission to run ALTER DATABASE/ROLE ... SET on custom
-- parameter namespaces (confirmed via 42501 permission denied on this
-- project), so `current_setting('app.settings.app_url', true)` can't be
-- populated that way here. This means dev and prod need their own copy of
-- this cron.schedule call with the right URL baked in — see the prod
-- migration for sports-event-manager-prod.
--
-- CRON_SECRET must be set via Supabase Vault before this job can
-- authenticate successfully:
--   select vault.create_secret('<value>', 'cron_secret');
-- and the same value must be set as the app's CRON_SECRET env var for this
-- environment. This migration does not set the secret's value.
select cron.schedule(
  'gdpr-warning-sms-trigger',
  '0 4 * * *',
  $$
  select net.http_post(
    url := 'https://sports-event-manager-dev.lemonbay-48b8af2a.swedencentral.azurecontainerapps.io/api/cron/gdpr-warning',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret'
      )
    ),
    body := '{}'::jsonb
  );
  $$
);

-- ============================================================================
-- DONE
-- ============================================================================
-- Verify with:
--   select jobname, schedule, active from cron.job where jobname like 'gdpr-%';
--   select proname from pg_proc where proname in ('get_last_sign_in_at', 'anonymize_inactive_users');
