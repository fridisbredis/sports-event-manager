-- ============================================================================
-- Migration 0043: confirm invite RPCs report whether a role was granted
-- ============================================================================
--
-- SEC-07 gap found while adversarially testing 0042's audit write: both
-- confirm_official_invite (0017, current signature from 0028 with
-- p_privacy_accepted) and confirm_official_invite_by_phone (0018) do
-- `insert into user_roles (...) on conflict (user_id, tenant_id) do
-- nothing` and return { tenant_id } unconditionally — success even when the
-- conflict branch fired and no row was actually inserted. The caller
-- (src/app/api/officials/confirm/route.ts, src/lib/auth/tenant.ts) had no
-- way to distinguish "granted" from "already had this role", so the
-- role_granted_via_invite_confirmation audit write (0042) was a false
-- positive by construction: it fired on every RPC success, whether or not a
-- grant actually happened. See tenant.test.ts / confirm/route.test.ts
-- "KNOWN GAP" tests added alongside this migration, now fixed to assert the
-- corrected behavior instead.
--
-- Fix: both functions now check `get diagnostics .. row_count` on the
-- user_roles insert (the same technique already used on the officials
-- UPDATE two lines above it in both functions) and return that as
-- `role_granted` in the response jsonb. The caller can now log the audit
-- event only when role_granted is true.
--
-- Forward-fix: replace
--   Rollback: restore the previous definitions from migrations 0017 and
--             0018 (drop the role_granted key from the returned jsonb and
--             the row_count check around the insert). Both are `create or
--             replace function`, so re-running those two files' bodies
--             verbatim is a complete rollback.
--   Data:     No data loss — this only changes what the functions return,
--             not any table's contents. Existing officials/user_roles rows
--             are untouched.
--   Blast:    Old application code (pre-this-PR) ignores unknown keys in the
--             returned jsonb, so it keeps working unchanged against the new
--             function body. New application code added in this same PR
--             reads `role_granted` from the response — see Window below for
--             why that ordering is safe.
--   Window:   Compatible. `create or replace function` takes effect
--             immediately and atomically; there is no intermediate state
--             where only one of the two functions is updated (both are in
--             this single migration file, applied in one transaction by
--             supabase db push). The new `role_granted` field is additive to
--             the response shape, so even if the new function definition
--             somehow became live before the new route/tenant.ts code
--             deployed, old code reading only `data.tenant_id` is
--             unaffected. New code reading `data.role_granted` cannot run
--             before this migration, since schema-first deploy order
--             applies migrations before the new image ships.
-- ============================================================================

-- Signature matches 0028's current version (p_token, p_user_id,
-- p_user_phone, p_name, p_privacy_accepted) — 0028 already dropped the
-- older 4-arg overload explicitly, so `create or replace` here targets the
-- one function that exists today. No `drop function` needed: the argument
-- list is unchanged from 0028, only the body and return value change.
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

  insert into user_roles (user_id, tenant_id, role)
  values (p_user_id, v_official.tenant_id, 'official')
  on conflict (user_id, tenant_id) do nothing;

  get diagnostics v_updated = row_count;
  v_role_granted := v_updated > 0;

  return jsonb_build_object('tenant_id', v_official.tenant_id, 'role_granted', v_role_granted);
end;
$$;

comment on function public.confirm_official_invite(uuid, uuid, text, text, boolean) is
  'SEC-04/SEC-09/SEC-07: atomically confirms an official invite. Requires '
  'p_user_phone to match officials.phone and p_privacy_accepted = true. '
  'Locks the official row (SELECT ... FOR UPDATE) and re-checks '
  'invite_status in the UPDATE WHERE clause so concurrent callers cannot '
  'both succeed. Returns role_granted so the caller can tell a real '
  'user_roles insert apart from an on-conflict-do-nothing no-op before '
  'writing an audit event. Raises not_found / already_confirmed / expired '
  '/ phone_mismatch / privacy_not_accepted (errcode P0001) on failure.';

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
  v_official     officials%rowtype;
  v_updated      integer;
  v_role_granted boolean;
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

  get diagnostics v_updated = row_count;
  v_role_granted := v_updated > 0;

  return jsonb_build_object('tenant_id', v_official.tenant_id, 'role_granted', v_role_granted);
end;
$$;

comment on function public.confirm_official_invite_by_phone(uuid, text) is
  'SEC-04/F-SEC-11/SEC-07: atomically confirms an official invite found by '
  'phone (the post-login fallback path with no invite_token in play). Locks '
  'the official row (SELECT ... FOR UPDATE) and re-checks invite_status in '
  'the UPDATE WHERE clause so concurrent callers cannot both succeed. '
  'Returns role_granted so the caller can tell a real user_roles insert '
  'apart from an on-conflict-do-nothing no-op before writing an audit '
  'event. Raises not_found / already_confirmed (errcode P0001) on failure.';

-- ============================================================================
-- DONE
-- ============================================================================
-- Verify with:
--   select proname, prosrc from pg_proc
--   where proname in ('confirm_official_invite', 'confirm_official_invite_by_phone');
