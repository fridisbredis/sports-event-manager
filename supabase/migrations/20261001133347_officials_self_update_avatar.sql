-- ============================================================================
-- Migration 20261001133347: let an official update their own avatar
-- ============================================================================
--
-- ACCT-01's profile picture never persisted. uploadAvatar() put the file in
-- the 'avatars' bucket, then wrote officials.avatar_url through the
-- user-scoped client — and that UPDATE matched zero rows, because the only
-- write policy on officials is tenant_admin_manage_officials (FOR ALL,
-- tenant_admin or system_admin). An ordinary official can SELECT their row via
-- tenant_member_read_officials but has no UPDATE policy at all.
--
-- Postgres does not raise on that. An UPDATE whose USING clause matches
-- nothing reports success with zero rows affected, so the action saw no error,
-- returned the public URL, and the client showed the picture. The next render
-- read the unchanged row and the avatar was gone. Same silent-write class as
-- the SELECT-before-DELETE gap found in 0024.
--
-- Not caught earlier because a global system_admin satisfies the is_system_admin()
-- arm of the existing policy, so the write succeeds for that role. It fails
-- only for a plain official — which is every real user of this screen.
--
-- WHY A POLICY RATHER THAN THE SERVICE CLIENT.
--
-- PATCH /api/account writes name and sms_opt_out to this same table with the
-- service client, which bypasses RLS entirely. Routing the avatar the same way
-- would have been a two-line change, but it widens the service-role surface
-- that SEC-03 spent a release narrowing (ADR-0001). The database should be
-- able to express "an official may edit their own profile", and once it can,
-- the account route can move onto the RLS client too rather than the other way
-- round. That migration is left for SEC-03's follow-up; this one only opens
-- the door.
--
-- WHY A TRIGGER GUARDS THE COLUMNS.
--
-- RLS grants or denies a whole row; it cannot say "only these columns". This
-- table carries invite_token, invite_status, phone and tenant_id, so a bare
-- "user_id = auth.uid()" UPDATE policy would let an official confirm their own
-- invitation, move their row to another tenant, take over a pending invite's
-- token, or change the phone that identifies them at login. The policy below
-- is therefore paired with a BEFORE UPDATE trigger that rejects any change to
-- a column the user does not own, so the two together express what the policy
-- alone cannot.
--
-- Columns an official may change about themselves: avatar_url, name,
-- sms_opt_out. The first is what this fix is for; the other two are the fields
-- ACCT-01 already edits through the service client, included so the follow-up
-- can drop that bypass without another migration. Everything else is rejected.
--
-- The trigger is scoped to non-privileged callers: a tenant_admin acting
-- through tenant_admin_manage_officials, and anything running as the service
-- role, must still be able to write invite_status and the rest. It therefore
-- returns early unless the row being touched belongs to the calling user.
--
-- Forward-fix: additive
--   Rollback: drop the policy and the trigger (and its function) in a new
--             timestamped migration. Safe at any point — it restores exactly
--             today's behaviour, in which officials cannot update their own
--             row and the avatar silently fails to persist.
--   Data:     no data loss. Nothing is written or migrated here; this only
--             changes who may write later. Avatars uploaded before this
--             migration are already orphaned in the bucket with no row
--             pointing at them, and are not recovered by it — re-uploading is
--             the fix for those.
--   Blast:    none for the currently deployed code. The old image never
--             performed an UPDATE that this policy newly permits except the
--             avatar write that is currently failing silently, so the worst
--             case is that the picture starts working before the new image
--             ships. If the trigger were to reject a write it should have
--             allowed, the user sees the upload fail loudly rather than
--             silently — strictly better than the current behaviour.
--   Window:   compatible. Nothing the deployed image reads or writes changes
--             shape — no column is added, renamed or dropped, and no
--             existing policy is altered. The old image keeps working
--             unchanged while the new schema is live, and the only
--             behavioural difference is that the avatar UPDATE it already
--             issues starts matching its row instead of silently matching
--             none.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Column guard
-- ---------------------------------------------------------------------------

create or replace function public.officials_self_update_guard()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  -- Only constrain a user editing their OWN row. A tenant_admin, a system_admin
  -- and the service role all legitimately write invite_status, phone and the
  -- invite token; they reach this table through other policies and must pass
  -- through untouched.
  --
  -- auth.uid() is null for the service role, so the null-safe comparison also
  -- covers that path without a separate branch.
  if new.user_id is distinct from auth.uid() or auth.uid() is null then
    return new;
  end if;

  -- A tenant_admin editing their own officials row is still an admin: let the
  -- admin policy's full access stand rather than narrowing it here.
  if public.get_user_role(new.tenant_id) = 'tenant_admin' or public.is_system_admin() then
    return new;
  end if;

  -- Identity and lifecycle columns are not the user's to change. Compared with
  -- "is distinct from" so a null on either side behaves, rather than silently
  -- passing the way "<>" would.
  if new.id is distinct from old.id
     or new.tenant_id is distinct from old.tenant_id
     or new.user_id is distinct from old.user_id
     or new.phone is distinct from old.phone
     or new.invite_status is distinct from old.invite_status
     or new.invite_token is distinct from old.invite_token
     or new.invite_token_expires_at is distinct from old.invite_token_expires_at
     or new.created_at is distinct from old.created_at
     or new.privacy_accepted_at is distinct from old.privacy_accepted_at
     or new.gdpr_warning_sent_at is distinct from old.gdpr_warning_sent_at
  then
    raise exception
      'officials: an official may only change their own name, avatar_url and sms_opt_out'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function public.officials_self_update_guard() is
  'Restricts a self-service UPDATE on officials to name, avatar_url and sms_opt_out. '
  'RLS cannot express column-level permission, so official_update_own_row is paired '
  'with this trigger. Privileged callers (tenant_admin, system_admin, service role) '
  'return early and are unaffected.';

drop trigger if exists officials_self_update_guard on public.officials;

create trigger officials_self_update_guard
  before update on public.officials
  for each row
  execute function public.officials_self_update_guard();

-- ---------------------------------------------------------------------------
-- Policy
-- ---------------------------------------------------------------------------
--
-- Defensive re-run per the project convention: DROP IF EXISTS + CREATE, not a
-- DO $$ IF NOT EXISTS $$ block.
--
-- No SELECT policy is added: tenant_member_read_officials already makes the
-- row visible to its own official, which is the prerequisite an UPDATE needs
-- (the lesson from 0024). WITH CHECK repeats the USING predicate so the row
-- cannot be updated into a state where it no longer belongs to the caller —
-- redundant with the trigger's user_id check, and kept because a policy that
-- relies on a trigger for its own invariant is a policy that breaks when the
-- trigger is dropped.

drop policy if exists official_update_own_row on public.officials;

create policy official_update_own_row
  on public.officials for update
  using (user_id = auth.uid() and invite_status = 'confirmed')
  with check (user_id = auth.uid() and invite_status = 'confirmed');
