-- ============================================================================
-- Migration 0018: confirm_official_invite_by_phone RPC
-- ============================================================================
--
-- SEC-04 (continued — see F-SEC-11 in docs/quality-requirements.md):
-- Invitation confirmation must bind the invitation to the verified phone
-- identity and be single-use under concurrency.
--
-- Migration 0017 fixed this for POST /api/officials/confirm, the primary
-- invite-link flow, which looks the official up by invite_token. This
-- migration fixes the second, independent call site: confirmOfficialInvite
-- (src/lib/auth/tenant.ts), the fallback path called from src/app/page.tsx
-- on every post-login redirect for a user with no user_roles row yet. That
-- path has no token in play — a user can complete OTP login for a phone
-- number an admin already entered as an official, without ever visiting an
-- /invite/[token] link. It looks the official up by phone directly, so the
-- lookup key here is genuinely different from 0017's and needs its own RPC
-- rather than overloading confirm_official_invite with an optional token.
--
-- Old code (read-then-write, no lock, no atomic guard):
--   1. SELECT official WHERE phone = p_phone AND invite_status = 'invited'
--      AND invite_token IS NULL
--   2. UPDATE official SET invite_status = 'confirmed', ... WHERE id = ...
--   3. INSERT user_roles (plain insert, not upsert, error discarded)
-- Two devices completing OTP login for the same invited phone at the same
-- moment could both pass step 1, both attempt step 2, and both attempt step
-- 3 — the second INSERT throws on the unique (user_id, tenant_id)
-- constraint if the two devices belong to two different auth users, since
-- nothing there stops two different users from both claiming one phone
-- number's invite.
--
-- This RPC applies the same fix as 0017:
--   - locks the official row with SELECT ... FOR UPDATE so concurrent
--     callers serialize on the same row instead of racing
--   - re-checks invite_status = 'invited' in the UPDATE's WHERE clause so a
--     loser of the row lock fails cleanly instead of overwriting a
--     confirmation that already happened
--   - inserts the user_roles row in the same transaction, ON CONFLICT DO
--     NOTHING instead of a bare insert
--
-- The phone match itself is still expressed as the lookup predicate
-- (WHERE phone = p_user_phone), matching the existing fallback-path
-- behaviour, rather than as a separate comparison as in 0017 (which looks
-- up by token first and compares phone after) — there is no other lookup
-- key available here, so the two are equivalent in effect.
--
-- SECURITY DEFINER for the same reason as 0017: the caller is a freshly
-- OTP-authenticated user with no tenant_admin/RLS access to officials or
-- user_roles yet.
-- ============================================================================

create or replace function public.confirm_official_invite_by_phone(
  p_user_id    uuid,
  p_user_phone text
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
    invite_token = null
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
  'SEC-04/F-SEC-11: atomically confirms an official invite found by phone '
  '(the post-login fallback path with no invite_token in play). Locks the '
  'official row (SELECT ... FOR UPDATE) and re-checks invite_status in the '
  'UPDATE WHERE clause so concurrent callers cannot both succeed. Raises '
  'not_found / already_confirmed (errcode P0001) on failure.';

-- Only the confirmOfficialInvite fallback path (via the service-role
-- client) should ever call this function directly — it bypasses RLS by
-- design (SECURITY DEFINER).
revoke all on function public.confirm_official_invite_by_phone(uuid, text) from public;
grant execute on function public.confirm_official_invite_by_phone(uuid, text) to service_role;

-- ============================================================================
-- DONE
-- ============================================================================
-- Verify with:
--   select proname, prosecdef from pg_proc where proname = 'confirm_official_invite_by_phone';
