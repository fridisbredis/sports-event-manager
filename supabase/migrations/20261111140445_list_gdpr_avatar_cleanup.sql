-- ============================================================================
-- Migration 20261111140445: list profile photos due for GDPR removal (B18)
-- ============================================================================
--
-- SEC-09 anonymizes officials and participants after 24 months of inactivity
-- (anonymize_inactive_users, latest body in 20260911145759), but that body
-- predates both avatar_url columns (officials: 20260929094440, participants:
-- 20261110130000 / N40) and never touches them. An anonymized row keeps
-- pointing at the person's photo, and the file stays in the PUBLIC 'avatars'
-- bucket. A face is personal data, so the retention decision is not met for
-- anyone who uploaded one. No prod row is 24 months inactive yet, so nothing
-- has been kept too long today.
--
-- WHY NOT EXTEND anonymize_inactive_users(). Two reasons:
--   1. SQL cannot delete the files. Deleting from storage.objects leaves the
--      object in the storage backend, so the removal has to go through the
--      Storage API from the app. If the anonymizer nulled avatar_url first,
--      the app would lose the pointer to the file.
--   2. The anonymizer still fails on its first real official (NOT NULL on
--      officials.name/phone, documented in 20260911145759, awaiting a policy
--      decision). Anything added to it rolls back with it. Same reasoning as
--      20261030073124 (push subscriptions) and 20261109142553 (ICE contacts).
--
-- SHAPE. This function only LISTS the rows; it writes nothing. The daily
-- /api/cron/gdpr-warning route (already triggered by pg_cron on dev and prod,
-- migration 0029) removes each row's folder in the bucket and then nulls
-- avatar_url. A non-null avatar_url on a row that matches below therefore
-- means "photo not yet removed", and a failed removal is retried on the next
-- run without any extra bookkeeping.
--
-- A row matches when it has a photo and either
--   - its user is 24+ months inactive — same test and same admin exclusion as
--     anonymize_inactive_users(), so a photo goes exactly when the name would.
--     A current admin keeps their roster row (F-MNT-20) and so their photo.
--   - or it is already anonymized (user_id and name both null). Catches a row
--     the anonymizer reached first, which then no longer has a user_id to
--     measure inactivity on. Only participants can be in this state today;
--     officials join once their NOT NULL is resolved.
--
-- Forward-fix: additive
--   Rollback: in a new timestamped migration,
--             drop function if exists public.list_gdpr_avatar_cleanup();
--             and deploy an app version whose gdpr-warning route does not
--             call it (it logs the RPC failure and carries on otherwise).
--   Data:     none. Read-only function; the deletions happen in the app.
--   Blast:    if the predicate were too wide, active users would lose their
--             profile photo (the file and avatar_url) and see the initials
--             fallback until they upload a new one. Names, phones and every
--             other column are untouched.
--   Window:   compatible — a new function nothing deployed calls yet. The
--             route that calls it is shipped in the same PR, after this.
-- ============================================================================

create or replace function public.list_gdpr_avatar_cleanup()
returns table (row_kind text, row_id uuid, row_tenant_id uuid, avatar_url text)
language sql
stable
security definer
set search_path = public, auth
as $$
  select 'official'::text, o.id, o.tenant_id, o.avatar_url
  from public.officials o
  where o.avatar_url is not null
    and (
      (o.user_id is null and o.name is null)
      or (
        o.user_id is not null
        and public.get_last_sign_in_at(o.user_id) <= now() - interval '24 months'
        and not exists (
          select 1 from public.user_roles ur
          where ur.user_id = o.user_id
            and (
              (ur.role = 'tenant_admin' and ur.tenant_id = o.tenant_id)
              or ur.role = 'system_admin'
            )
        )
      )
    )
  union all
  select 'participant'::text, p.id, p.tenant_id, p.avatar_url
  from public.participants p
  where p.avatar_url is not null
    and (
      (p.user_id is null and p.name is null)
      or (
        p.user_id is not null
        and public.get_last_sign_in_at(p.user_id) <= now() - interval '24 months'
        and not exists (
          select 1 from public.user_roles ur
          where ur.user_id = p.user_id
            and (
              (ur.role = 'tenant_admin' and ur.tenant_id = p.tenant_id)
              or ur.role = 'system_admin'
            )
        )
      )
    );
$$;

comment on function public.list_gdpr_avatar_cleanup is
  'B18/SEC-09: officials and participants whose profile photo is due for '
  'removal — user 24+ months inactive (same test and admin exclusion as '
  'anonymize_inactive_users) or row already anonymized. Read-only; the '
  'gdpr-warning cron route deletes the files via the Storage API and then '
  'nulls avatar_url. Separate from the anonymizer so its known NOT NULL '
  'failure cannot block this, and so the file pointer survives until the '
  'file is gone.';

revoke all on function public.list_gdpr_avatar_cleanup() from public, anon, authenticated;
grant execute on function public.list_gdpr_avatar_cleanup() to service_role, postgres;

-- ============================================================================
-- DONE
-- ============================================================================
-- Verify with:
--   select proname from pg_proc where proname = 'list_gdpr_avatar_cleanup';
--   select * from public.list_gdpr_avatar_cleanup();  -- expect 0 rows on prod
