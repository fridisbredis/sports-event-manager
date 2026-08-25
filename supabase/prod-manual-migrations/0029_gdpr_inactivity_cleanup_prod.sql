-- ============================================================================
-- Migration 0029 (prod variant): GDPR inactivity cleanup (SEC-09/F-SEC-10)
-- ============================================================================
--
-- Identical to 0029_gdpr_inactivity_cleanup.sql (dev), except the
-- gdpr-warning-sms-trigger cron job points at the prod app URL instead of
-- dev's. This file lives in supabase/prod-manual-migrations/ (NOT
-- supabase/migrations/) so it is never auto-applied by `supabase db reset`
-- or CI's "Start local Supabase stack" step — both files sharing version
-- 0029 caused a schema_migrations_pkey collision when this lived alongside
-- the dev migration. The two Supabase projects (sports-event-manager dev vs
-- sports-event-manager-prod) are entirely separate databases with no shared
-- migration history — see CLAUDE.md's "run the migration on both dev and
-- prod" instruction. Apply this to the PROD project only, via the Supabase
-- SQL editor or MCP, after 0028 has also been applied there.
--
-- Before running this file:
--   1. Generate a NEW random value for prod — do not reuse dev's CRON_SECRET.
--        openssl rand -hex 32
--   2. Set it in Supabase Vault on the PROD project:
--        select vault.create_secret('<new-value>', 'cron_secret');
--   3. Set the same value as PROD_CRON_SECRET in GitHub Secrets, and confirm
--      deploy-prod.yml passes it through (already done as of this writing).
--   4. Deploy prod at least once so the running Container App actually has
--      CRON_SECRET in its environment before the first cron fire — otherwise
--      the warning job will 401 against a stale/missing value until the next
--      deploy.
-- ============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

alter table public.officials
  add column if not exists gdpr_warning_sent_at timestamptz;

alter table public.participants
  add column if not exists gdpr_warning_sent_at timestamptz;

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

create or replace function public.anonymize_inactive_users()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
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

select cron.schedule(
  'gdpr-anonymize-inactive-users',
  '0 3 * * *',
  $$select public.anonymize_inactive_users();$$
);

-- Prod app URL per CLAUDE.md: custom domain is primary, Azure-generated URL
-- is documented as fallback. Using the custom domain here.
select cron.schedule(
  'gdpr-warning-sms-trigger',
  '0 4 * * *',
  $$
  select net.http_post(
    url := 'https://app.viadalevent.se/api/cron/gdpr-warning',
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
