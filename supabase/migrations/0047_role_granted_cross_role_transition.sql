-- ============================================================================
-- Migration 0047: role_granted must catch a cross-role transition
-- ============================================================================
--
-- confirm_official_invite and confirm_official_invite_by_phone (0043,
-- restored on the phone-fallback path by 0046) compute role_granted from
-- `insert into user_roles ... on conflict (user_id, tenant_id) do nothing`
-- via `get diagnostics row_count`. The conflict target is (user_id,
-- tenant_id) — it does not include `role`. So role_granted really means
-- "a user_roles row for this (user_id, tenant_id) did not exist yet", not
-- "this person did not already hold this role".
--
-- The gap: if a user already has a DIFFERENT role in this tenant (most
-- concretely, they are already a 'participant' and are now confirming an
-- official invite in the same tenant), the insert's ON CONFLICT DO NOTHING
-- fires — a row already exists — so role_granted comes back false. Two
-- things follow from that, both wrong:
--   1. user_roles.role is left at 'participant' forever. The person acts
--      as an official in the app (officials.user_id now points at them),
--      but their role row never says so.
--   2. SEC-07's role_granted_via_invite_confirmation audit event
--      (tenant.ts / route.ts, both `if (roleGranted) { void logAuthEvent
--      (...) }`) is never written for what is a real role grant.
--
-- This was already known and pinned by an integration test (see
-- tests/integration/confirm-official-invite-by-phone.test.ts, "known
-- SEC-07 gap") rather than newly discovered here — this migration is the
-- fix that test was written to eventually require.
--
-- Fix: replace the `insert ... on conflict do nothing` with a single
-- atomic upsert that reports role_granted whenever either (a) the row was
-- newly inserted or (b) an existing row's role was actually changed.
-- Deliberately NOT a separate `select role ...` followed by an
-- `insert`/`update` — two statements would open a TOCTOU window: two
-- concurrent confirms for the same (user_id, tenant_id) could both read
-- the same stale "old role" before either writes, and both report
-- role_granted = true for what should be one grant. A single statement
-- lets Postgres's own row-level locking on the conflicting row serialize
-- concurrent callers, the same guarantee the existing SELECT ... FOR
-- UPDATE on the officials row already relies on elsewhere in these
-- functions.
--
-- The upsert is deliberately narrower than "overwrite whenever the role
-- differs". officials.phone has no uniqueness constraint against
-- user_roles at all (see src/app/api/officials/route.ts — the only
-- duplicate check is against other `officials` rows for the same tenant,
-- never against user_roles). Nothing stops an official invite from being
-- created — deliberately or by roster mixup — for a phone number that
-- currently belongs to a tenant_admin in the same tenant. An upsert that
-- overwrote any differing role would let confirming that invite silently
-- demote a tenant_admin down to 'official' — trading the original
-- SEC-07 audit-log gap for a silent privilege-demotion bug, which is
-- worse than the gap it fixes. So the DO UPDATE only fires when the
-- existing role is 'participant': that is the one transition this
-- migration is actually meant to catch. Any other existing role
-- (tenant_admin, or already 'official') is left untouched — role_granted
-- is then false, and the official row still gets user_id attached via
-- the separate `update officials` above (confirmation and role-grant are
-- decoupled), but no role is granted or changed.
--
-- (system_admin can never be the conflict target here regardless: migration
-- 0021 gives every system_admin row tenant_id = null, and the unique
-- (user_id, tenant_id) constraint never matches null against the concrete
-- tenant_id this upsert inserts.)
--
-- Forward-fix: replace
--   Rollback: restore the function bodies from migration 0043
--             (confirm_official_invite) and migration 0046
--             (confirm_official_invite_by_phone) verbatim — both are
--             `create or replace function`, so re-running those files is
--             a complete rollback of this one.
--   Data:     No unwanted data loss from the migration itself — it only
--             changes what future calls to these functions do. Note this
--             migration does NOT backfill existing rows: any user who
--             already went through this exact bug (silently stuck as
--             'participant' after confirming an official invite) is not
--             corrected by this migration. See docs/quality-requirements.md
--             SEC-07 entry for whether a one-off backfill query is run
--             separately once this ships.
--   Blast:    Fully additive to the response shape (same two keys,
--             `tenant_id` and `role_granted`, as before). Old code reading
--             role_granted is unaffected either way it resolves.
--   Window:   Compatible. `create or replace function` takes effect
--             atomically; no column or table shape changes, so the
--             currently-deployed app code keeps working unchanged through
--             the deploy window.
-- ============================================================================

create or replace function public.confirm_official_invite(
  p_token             uuid,
  p_user_id           uuid,
  p_user_phone        text,
  p_name              text,
  p_privacy_accepted  boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_official     officials%rowtype;
  v_updated      integer;
  v_role_granted boolean;
begin
  if not p_privacy_accepted then
    raise exception 'privacy_not_accepted' using errcode = 'P0001';
  end if;

  select * into v_official
  from officials
  where invite_token = p_token
  for update;

  if v_official.id is null then
    raise exception 'not_found' using errcode = 'P0001';
  end if;

  if v_official.invite_status <> 'invited' then
    raise exception 'already_confirmed' using errcode = 'P0001';
  end if;

  if v_official.invite_token_expires_at is null
     or v_official.invite_token_expires_at <= now() then
    raise exception 'expired' using errcode = 'P0001';
  end if;

  if v_official.phone is distinct from p_user_phone then
    raise exception 'phone_mismatch' using errcode = 'P0001';
  end if;

  update officials
  set
    user_id = p_user_id,
    invite_status = 'confirmed',
    invite_token = null,
    invite_token_expires_at = null,
    name = p_name,
    privacy_accepted_at = now()
  where id = v_official.id
    and invite_status = 'invited';

  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    raise exception 'already_confirmed' using errcode = 'P0001';
  end if;

  with upsert as (
    insert into user_roles (user_id, tenant_id, role)
    values (p_user_id, v_official.tenant_id, 'official')
    on conflict (user_id, tenant_id) do update
      set role = excluded.role
      where user_roles.role = 'participant'
    returning 1
  )
  select exists (select 1 from upsert) into v_role_granted;

  return jsonb_build_object('tenant_id', v_official.tenant_id, 'role_granted', v_role_granted);
end;
$$;

comment on function public.confirm_official_invite is
  'SEC-04/F-SEC-11/SEC-09/SEC-07: atomically confirms an official invite '
  'found by invite_token. Requires p_privacy_accepted = true. Locks the '
  'official row (SELECT ... FOR UPDATE) and re-checks invite_status in the '
  'UPDATE WHERE clause so concurrent callers cannot both succeed. Grants '
  'the official role via an atomic upsert that also catches a user who '
  'already held ''participant'' in this tenant (migration 0047) but never '
  'overwrites any OTHER existing role (tenant_admin) — those are left '
  'untouched and role_granted is false. role_granted is true on fresh '
  'insert or a participant->official transition, false when the role was '
  'already ''official'' (idempotent re-confirm) or belongs to an admin '
  'role this function must never touch. Raises not_found / '
  'already_confirmed / expired / phone_mismatch / privacy_not_accepted '
  '(errcode P0001) on failure.';

create or replace function public.confirm_official_invite_by_phone(
  p_user_id           uuid,
  p_user_phone        text,
  p_privacy_accepted  boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_official     officials%rowtype;
  v_updated      integer;
  v_role_granted boolean;
begin
  if not p_privacy_accepted then
    raise exception 'privacy_not_accepted' using errcode = 'P0001';
  end if;

  select * into v_official
  from officials
  where phone = p_user_phone
    and invite_status = 'invited'
    and invite_token is null
  for update;

  if v_official.id is null then
    raise exception 'not_found' using errcode = 'P0001';
  end if;

  update officials
  set
    user_id = p_user_id,
    invite_status = 'confirmed',
    invite_token = null,
    privacy_accepted_at = now()
  where id = v_official.id
    and invite_status = 'invited';

  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    raise exception 'already_confirmed' using errcode = 'P0001';
  end if;

  with upsert as (
    insert into user_roles (user_id, tenant_id, role)
    values (p_user_id, v_official.tenant_id, 'official')
    on conflict (user_id, tenant_id) do update
      set role = excluded.role
      where user_roles.role = 'participant'
    returning 1
  )
  select exists (select 1 from upsert) into v_role_granted;

  return jsonb_build_object('tenant_id', v_official.tenant_id, 'role_granted', v_role_granted);
end;
$$;

comment on function public.confirm_official_invite_by_phone is
  'SEC-04/F-SEC-11/SEC-09/SEC-07: atomically confirms an official invite '
  'found by phone (the post-login fallback path with no invite_token in '
  'play). Requires p_privacy_accepted = true. Locks the official row '
  '(SELECT ... FOR UPDATE) and re-checks invite_status in the UPDATE WHERE '
  'clause so concurrent callers cannot both succeed. Grants the official '
  'role via an atomic upsert that also catches a user who already held '
  '''participant'' in this tenant (migration 0047) but never overwrites '
  'any OTHER existing role (tenant_admin) — those are left untouched and '
  'role_granted is false. role_granted is true on fresh insert or a '
  'participant->official transition, false when the role was already '
  '''official'' (idempotent re-confirm) or belongs to an admin role this '
  'function must never touch. Raises not_found / already_confirmed / '
  'privacy_not_accepted (errcode P0001) on failure.';

-- ============================================================================
-- DONE
-- ============================================================================
-- Verify with:
--   select prosrc from pg_proc where proname = 'confirm_official_invite';
--   select prosrc from pg_proc where proname = 'confirm_official_invite_by_phone';
--   -- both should contain `where user_roles.role = 'participant'`, not
--   -- `do nothing` and not `is distinct from excluded.role`.
-- ============================================================================
