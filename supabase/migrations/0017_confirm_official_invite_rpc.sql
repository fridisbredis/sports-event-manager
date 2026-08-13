-- ============================================================================
-- Migration 0017: confirm_official_invite RPC
-- ============================================================================
--
-- SEC-04: Invitation confirmation must bind the invitation to the verified
-- phone identity and be single-use under concurrency.
--
-- Problem being fixed (see docs/quality-requirements.md F-SEC-01):
-- POST /api/officials/confirm previously did a plain read-then-write in JS:
--   1. SELECT official by invite_token
--   2. UPDATE official SET invite_status = 'confirmed', ... WHERE id = ...
--   3. UPSERT user_roles
-- Neither the phone on the official row nor the authenticated user's
-- verified phone were compared, and step 2 had no WHERE guard on the
-- current invite_status/token — two concurrent requests (or two different
-- users who both know the invite link) could both "succeed".
--
-- This RPC replaces steps 1-3 with a single SECURITY DEFINER function that:
--   - locks the official row with SELECT ... FOR UPDATE so concurrent
--     callers serialize on the same row instead of racing
--   - requires p_user_phone (the caller's Supabase-Auth-verified phone) to
--     match officials.phone before confirming
--   - re-checks invite_status = 'invited' in the UPDATE's WHERE clause so a
--     loser of the row lock still fails cleanly instead of overwriting a
--     confirmation that already happened
--   - inserts the user_roles row in the same transaction
--
-- SECURITY DEFINER is required (unlike sync_event_stages in 0005, which is
-- SECURITY INVOKER under an already-authorized tenant_admin): the caller
-- here is a newly OTP-authenticated user with no tenant_admin/RLS access to
-- officials or user_roles yet. search_path is pinned per Postgres function
-- security guidance for SECURITY DEFINER functions.
-- ============================================================================

create or replace function public.confirm_official_invite(
  p_token      uuid,
  p_user_id    uuid,
  p_user_phone text,
  p_name       text
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
    name = p_name
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

comment on function public.confirm_official_invite is
  'SEC-04: atomically confirms an official invite. Requires p_user_phone to '
  'match officials.phone. Locks the official row (SELECT ... FOR UPDATE) and '
  're-checks invite_status in the UPDATE WHERE clause so concurrent callers '
  'cannot both succeed. Raises not_found / already_confirmed / expired / '
  'phone_mismatch (errcode P0001) on failure.';

-- Only the confirm route (via the service-role client) should ever call
-- this function directly — it bypasses RLS by design (SECURITY DEFINER).
revoke all on function public.confirm_official_invite(uuid, uuid, text, text) from public;
grant execute on function public.confirm_official_invite(uuid, uuid, text, text) to service_role;

-- ============================================================================
-- DONE
-- ============================================================================
-- Verify with:
--   select proname, prosecdef from pg_proc where proname = 'confirm_official_invite';
