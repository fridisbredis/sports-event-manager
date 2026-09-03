-- ============================================================================
-- Migration 0045: mandatory privacy consent on phone-fallback invite confirm
-- ============================================================================
--
-- SEC-09/F-SEC-10 gap, flagged by Eduardo in PR #117 review (2026-09-03).
-- Migration 0028 added mandatory privacy consent to confirm_official_invite
-- (the /invite/[token] link flow) but never touched
-- confirm_official_invite_by_phone (migration 0018) — the second, independent
-- call site used when a user completes OTP login for a phone number an admin
-- already entered as an official, without ever visiting an invite link (see
-- confirmOfficialInvite in src/lib/auth/tenant.ts, called from
-- src/app/page.tsx on post-login redirect). That path auto-confirmed the
-- official and granted the 'official' role with no consent shown and no
-- privacy_accepted_at ever written.
--
-- This mirrors 0028's fix exactly for the phone-fallback RPC: a new mandatory
-- p_privacy_accepted parameter, rejected with 'privacy_not_accepted' if not
-- true, and privacy_accepted_at = now() recorded on confirmation. No column
-- changes needed — officials.privacy_accepted_at already exists (0028).
--
-- The application-layer half of this fix (a new /confirm-invite interstitial
-- page presenting the consent checkbox before this RPC is called, since the
-- phone-fallback path has no pre-existing UI step between OTP verification
-- and redirect) ships in the same PR as this migration.
--
-- Forward-fix: replace
--   Rollback: restore the 2-arg definition from migration 0018
--     (confirm_official_invite_by_phone(uuid, text), no consent check, no
--     privacy_accepted_at write).
--   Data:     no data loss. privacy_accepted_at stays null on rows already
--             confirmed by the old signature — same "no retroactive consent
--             record" gap 0028 left for officials confirmed before it shipped.
--   Blast:    none — old code path (confirmOfficialInvite in tenant.ts) is
--             updated in the same PR to call the RPC with the new parameter.
--   Window:   compatible. This is additive-shaped (new required parameter on
--             a service-role-only RPC with exactly one caller, updated in the
--             same deploy) rather than a true 2-release expand/contract split
--             — service_role is the only grantee (see REVOKE below), so no
--             other caller can be mid-flight against the old signature during
--             the deploy window.
-- ============================================================================

-- Signature changes (new p_privacy_accepted param) so the old 2-arg version
-- is dropped explicitly rather than left as dead overload.
drop function if exists public.confirm_official_invite_by_phone(uuid, text);

create or replace function public.confirm_official_invite_by_phone(
  p_user_id           uuid,
  p_user_phone        text,
  p_privacy_accepted  boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_official officials%rowtype;
  v_updated  integer;
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

  insert into user_roles (user_id, tenant_id, role)
  values (p_user_id, v_official.tenant_id, 'official')
  on conflict (user_id, tenant_id) do nothing;

  return jsonb_build_object('tenant_id', v_official.tenant_id);
end;
$$;

comment on function public.confirm_official_invite_by_phone is
  'SEC-04/F-SEC-11/SEC-09: atomically confirms an official invite found by '
  'phone (the post-login fallback path with no invite_token in play). '
  'Requires p_privacy_accepted = true. Locks the official row '
  '(SELECT ... FOR UPDATE) and re-checks invite_status in the UPDATE WHERE '
  'clause so concurrent callers cannot both succeed. Raises not_found / '
  'already_confirmed / privacy_not_accepted (errcode P0001) on failure.';

-- Only the confirmOfficialInvite fallback path (via the service-role
-- client) should ever call this function directly — it bypasses RLS by
-- design (SECURITY DEFINER).
revoke all on function public.confirm_official_invite_by_phone(uuid, text, boolean) from public;
grant execute on function public.confirm_official_invite_by_phone(uuid, text, boolean) to service_role;

-- ============================================================================
-- DONE
-- ============================================================================
-- Verify with:
--   select proname, pronargs from pg_proc where proname = 'confirm_official_invite_by_phone';
