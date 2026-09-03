-- ============================================================================
-- Migration 0046: restore role_granted on confirm_official_invite_by_phone
-- ============================================================================
--
-- Regression introduced by 0045: when it rewrote
-- confirm_official_invite_by_phone to add the mandatory p_privacy_accepted
-- parameter, it based the new body on 0018's original (pre-0043) shape and
-- dropped the `role_granted` key that 0043 had added to the returned jsonb.
--
-- Both call sites still expect it: src/lib/auth/tenant.ts's
-- confirmOfficialInvite (line ~104) and src/app/api/officials/confirm/
-- route.ts (line ~89) destructure `role_granted` from the RPC response to
-- decide whether to write the SEC-07 role_granted_via_invite_confirmation
-- audit event (0042). Since 0045 shipped, `data.role_granted` is `undefined`
-- there — falsy, so `if (roleGranted)` never fires and the audit event
-- silently stops being written for the phone-fallback confirm path. No
-- error, no failed request; the confirm/login flow itself is unaffected.
-- The unit tests didn't catch it because they mock the RPC's return value
-- directly (asserting `role_granted: true` in the mock) rather than
-- exercising the real SQL body.
--
-- Fix: same `get diagnostics .. row_count` technique 0043 introduced,
-- reapplied on top of 0045's current (3-arg, consent-checked) function body.
-- Nothing else about 0045's behavior changes.
--
-- Forward-fix: replace
--   Rollback: restore the 3-arg definition from migration 0045 verbatim
--             (drop the role_granted key and the row_count check around the
--             user_roles insert). `create or replace function`, so re-running
--             0045's body is a complete rollback.
--   Data:     No data loss — this only changes what the function returns,
--             not any table's contents.
--   Blast:    Fully additive to the response shape. Old code (the currently
--             broken 0045-era code, still deployed until this PR's app code
--             also ships) ignores the new key exactly as it already ignores
--             a missing one — no behavior change for it either way.
--   Window:   Compatible. `create or replace function` takes effect
--             atomically. Old code reading only `data.tenant_id` is
--             unaffected; the app code in this same PR that reads
--             `data.role_granted` cannot run before this migration, since
--             schema-first deploy order applies migrations before the new
--             image ships.
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

  get diagnostics v_updated = row_count;
  v_role_granted := v_updated > 0;

  return jsonb_build_object('tenant_id', v_official.tenant_id, 'role_granted', v_role_granted);
end;
$$;

comment on function public.confirm_official_invite_by_phone is
  'SEC-04/F-SEC-11/SEC-09/SEC-07: atomically confirms an official invite '
  'found by phone (the post-login fallback path with no invite_token in '
  'play). Requires p_privacy_accepted = true. Locks the official row '
  '(SELECT ... FOR UPDATE) and re-checks invite_status in the UPDATE WHERE '
  'clause so concurrent callers cannot both succeed. Returns role_granted '
  'so the caller can tell a real user_roles insert apart from an '
  'on-conflict-do-nothing no-op before writing an audit event. Raises '
  'not_found / already_confirmed / privacy_not_accepted (errcode P0001) on '
  'failure.';

-- ============================================================================
-- DONE
-- ============================================================================
-- Verify with:
--   select prosrc from pg_proc where proname = 'confirm_official_invite_by_phone';
--   -- should contain 'role_granted' in the returned jsonb_build_object call
