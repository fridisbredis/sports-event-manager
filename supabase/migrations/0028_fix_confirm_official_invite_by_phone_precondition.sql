-- ============================================================================
-- Migration 0028: fix confirm_official_invite_by_phone unreachable lookup
-- ============================================================================
--
-- 0018's confirm_official_invite_by_phone looked up the official row with
-- `invite_status = 'invited' AND invite_token IS NULL`. No code path ever
-- produces that combination: officials are always created and re-invited
-- with a real token, and the only statement that ever nulls the token is
-- this RPC's own UPDATE, which runs strictly after the lookup already
-- succeeded. The lookup therefore always raised not_found, and an official
-- who logged in via OTP without visiting their /invite/[token] link could
-- never be confirmed — see BUG.md.
--
-- Fix: drop the invite_token IS NULL clause. The caller has already been
-- OTP-verified against p_user_phone before this RPC runs (see
-- confirmOfficialInvite in src/lib/auth/tenant.ts), so the phone match is
-- the real security boundary here, same as 0018's own reasoning — the
-- token clause was never doing security work, just encoding a state
-- nothing else establishes.
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
  'UPDATE WHERE clause so concurrent callers cannot both succeed. Matches by '
  'phone + invite_status only (0028) — invite_token IS NULL was dropped '
  'from the lookup since no code path ever produced that state. Raises '
  'not_found / already_confirmed (errcode P0001) on failure.';

revoke all on function public.confirm_official_invite_by_phone(uuid, text) from public;
grant execute on function public.confirm_official_invite_by_phone(uuid, text) to service_role;

-- ============================================================================
-- DONE
-- ============================================================================
-- Verify with:
--   select proname, prosecdef from pg_proc where proname = 'confirm_official_invite_by_phone';
