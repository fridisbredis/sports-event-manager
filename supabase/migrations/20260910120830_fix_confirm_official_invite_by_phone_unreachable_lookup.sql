-- ============================================================================
-- Migration 20260910120830: fix confirm_official_invite_by_phone unreachable lookup
-- ============================================================================
--
-- confirm_official_invite_by_phone (0018, carried forward unchanged through
-- 0043/0045/0046/0047) looks up the official row with `invite_status =
-- 'invited' AND invite_token IS NULL`. No code path ever produces that
-- combination: officials.invite_token defaults to gen_random_uuid() at
-- creation (migration 0010) and every insert (src/app/api/officials/route.ts)
-- relies on that default, so a real token exists from the moment an official
-- is created. The only statements that ever null the token are this RPC's
-- own UPDATE and confirm_official_invite's UPDATE (both migration 0047) —
-- both run strictly after the lookup already succeeded. The lookup therefore
-- always raised not_found for a real official row, and an official who
-- logged in via OTP without visiting their /invite/[token] link could never
-- be confirmed.
--
-- The same dead condition is duplicated in hasPendingOfficialInviteByPhone
-- (src/lib/auth/tenant.ts), which gates whether page.tsx even redirects to
-- /confirm-invite — fixed in the same change as this migration so the
-- interstitial is actually reachable, not just the RPC underneath it.
--
-- Fix: drop the invite_token IS NULL clause. The caller has already been
-- OTP-verified against p_user_phone before this RPC runs (see
-- confirmOfficialInvite in src/lib/auth/tenant.ts), so the phone match is
-- the real security boundary here — the token clause was never doing
-- security work, just encoding a state nothing else establishes.
--
-- Forward-fix: replace
--   Rollback: restore the function body from migration 0047 verbatim
--             (create or replace function, re-adds `and invite_token is
--             null` to the SELECT).
--   Data:     No data loss — this only changes which rows the lookup can
--             match, not any table's contents.
--   Blast:    Purely additive in effect: previously this path raised
--             not_found for every real official (100% of rows, since
--             invite_token is never null pre-confirm), so no existing
--             successful confirmation becomes unreachable. The new
--             behavior only lets previously-impossible confirmations start
--             succeeding.
--   Window:   Compatible. Same signature (uuid, text, boolean default
--             false), same return shape (tenant_id, role_granted) as 0047
--             — create or replace function takes effect atomically, no
--             column or type changes.
-- ============================================================================

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
  'found by phone (the post-login fallback path with no invite_token '
  'required). Requires p_privacy_accepted = true. Locks the official row '
  '(SELECT ... FOR UPDATE) and re-checks invite_status in the UPDATE WHERE '
  'clause so concurrent callers cannot both succeed. Matches by phone + '
  'invite_status only (20260910120830) — invite_token IS NULL was dropped from '
  'the lookup since no code path ever produced that state. Grants the '
  'official role via an atomic upsert that also catches a user who already '
  'held ''participant'' in this tenant (migration 0047) but never overwrites '
  'any OTHER existing role (tenant_admin) — those are left untouched and '
  'role_granted is false. Raises not_found / already_confirmed / '
  'privacy_not_accepted (errcode P0001) on failure.';

-- ============================================================================
-- DONE
-- ============================================================================
-- Verify with:
--   select prosrc from pg_proc where proname = 'confirm_official_invite_by_phone';
--   -- should NOT contain 'invite_token is null' or 'invite_token IS NULL'
-- ============================================================================
