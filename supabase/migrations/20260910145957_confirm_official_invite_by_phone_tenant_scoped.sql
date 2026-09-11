-- ============================================================================
-- Migration 20260910145957: confirm_official_invite_by_phone requires p_tenant_id
-- ============================================================================
--
-- Bug: now that 20260910120830 made this RPC's lookup reachable, a phone
-- number invited by more than one tenant (an official invited by several
-- different sports clubs) hits `where phone = p_user_phone and invite_status
-- = 'invited' order by created_at limit 1` with no tenant filter at all —
-- the RPC silently confirms into whichever invite has the oldest
-- created_at, leaving every other tenant's invite stuck as 'invited'
-- forever. No error, no indication to the official that a choice was made
-- for them.
--
-- Fix: add a required p_tenant_id uuid parameter. The lookup narrows to
-- `and tenant_id = p_tenant_id`, and the caller (confirm-invite UI) makes
-- the tenant choice explicit — either automatically (exactly one pending
-- invite) or via a picker (two or more). No match for that phone+tenant_id
-- combination still raises 'not_found' — this never falls back to picking
-- a different tenant's row.
--
-- The `order by created_at limit 1` from 20260910120830 is dropped, not
-- carried forward: `officials_tenant_phone_active_uniq on (tenant_id,
-- phone) where invite_status <> 'removed'` guarantees at most one
-- non-removed row per (tenant_id, phone) pair, and 'invited' <> 'removed',
-- so once tenant_id is in the WHERE clause the query can match at most one
-- row by construction. The ORDER BY/LIMIT was only ever needed to make an
-- unbounded multi-tenant match deterministic; narrowing by tenant_id
-- removes the multi-row case entirely rather than picking one
-- deterministically, which is the actual fix.
--
-- HARD REQUIREMENT — explicit DROP of the old 3-arg overload:
-- `create or replace function` with a new parameter list does NOT replace
-- the existing 3-arg function — Postgres treats different parameter lists
-- as distinct overloads, so both would otherwise coexist. If they did,
-- PostgREST (or any other direct caller of this SECURITY DEFINER function —
-- a stale deployed instance, an external script, anything that forgets
-- p_tenant_id) could still resolve a 3-arg call to the OLD tenant-blind
-- function, silently reintroducing the exact bug this migration fixes. The
-- DROP below removes that ambiguity: after this migration, exactly one
-- overload of confirm_official_invite_by_phone exists, and any 3-arg call
-- fails loudly (42883, function does not exist) instead of silently
-- resolving to the wrong body.
--
-- Grant: the only existing grant on this function is `execute ... to
-- service_role` (0018, re-stated unchanged on every prior signature change
-- in 0045) — never `authenticated`. tenant.ts's confirmOfficialInvite calls
-- it exclusively via the service-role client. A brand-new parameter list is
-- a brand-new catalog object with no inherited ACL, so the revoke/grant
-- pair below is restated for the new 4-arg signature exactly as before —
-- not broadened to `authenticated`, since nothing needs to call this
-- directly from a signed-in user's own session.
--
-- Forward-fix: replace
--   Rollback: restore the 3-arg function body verbatim from migration
--             20260910120830 (create or replace function
--             public.confirm_official_invite_by_phone(uuid, text,
--             boolean), the order-by-created_at-limit-1 lookup, no tenant
--             filter), restore its revoke/grant pair
--             (revoke all ... from public; grant execute ... to
--             service_role; both on the 3-arg signature), and
--             `drop function public.confirm_official_invite_by_phone(uuid,
--             text, uuid, boolean);` to remove the 4-arg overload this
--             migration adds. This reintroduces the arbitrary-tenant-pick
--             bug being fixed here, so treat it as emergency-only and pair
--             it with an app-code rollback that stops passing p_tenant_id
--             (src/lib/auth/tenant.ts, confirm-invite-by-phone.ts).
--   Data:     No data loss — function-only change, no table rows are read,
--             written, or migrated by this file.
--   Blast:    Any caller still invoking the RPC with only the old 3 named
--             args (p_user_id, p_user_phone, p_privacy_accepted) resolves to
--             THIS new function with p_tenant_id defaulted to null (see
--             Window below) — not to the dropped tenant-blind body, and not
--             to a 42883. `tenant_id = p_tenant_id` with p_tenant_id null
--             can never match a real row (SQL NULL semantics), so the call
--             fails closed to the same 'not_found' every other rejection
--             path in this function already uses. Every phone-fallback
--             confirm attempt fails until the paired app-code deploy (this
--             same change) lands. Once both are live, a phone with invites
--             in N tenants can confirm any one of them explicitly, and a
--             mismatched tenant_id for a given phone correctly raises
--             not_found instead of confirming a different tenant's invite.
--   Window:   Compatible, via a default null on p_tenant_id — the same
--             pattern 0045 used for p_privacy_accepted. p_tenant_id is
--             declared after p_user_phone (Postgres requires defaulted
--             parameters to trail in the declaration; the app always calls
--             by name, so this reordering doesn't affect any caller).
--             Currently-deployed app code (pre-this-PR) calls
--             confirm_official_invite_by_phone with exactly 3 named args
--             and no p_tenant_id; PostgREST resolves that call to this
--             4-arg function with p_tenant_id = null, and the WHERE clause
--             fails closed to 'not_found' (see Blast above) — not a 42883,
--             and not a silent resolve to the dropped tenant-blind body,
--             since that overload no longer exists (HARD REQUIREMENT
--             above). Still deploy schema and app as close together as the
--             pipeline allows — the window only changes the failure mode
--             from "loud error" to "graceful not_found", it doesn't remove
--             the failure.
-- ============================================================================

drop function public.confirm_official_invite_by_phone(uuid, text, boolean);

create or replace function public.confirm_official_invite_by_phone(
  p_user_id           uuid,
  p_user_phone        text,
  p_tenant_id         uuid default null,
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
    and tenant_id = p_tenant_id
  for update;

  if v_official.id is null then
    raise exception 'not_found' using errcode = 'P0001';
  end if;

  -- NULL here is a real legacy state (officials invited before 0010 added
  -- this column, never backfilled) rather than an oversight — intentionally
  -- treated the same as expired since neither can confirm; the fix for
  -- both is the same, an admin resend, which stamps a fresh token + expiry.
  if v_official.invite_token_expires_at is null
     or v_official.invite_token_expires_at <= now() then
    raise exception 'expired' using errcode = 'P0001';
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

comment on function public.confirm_official_invite_by_phone(uuid, text, uuid, boolean) is
  'SEC-04/F-SEC-11/SEC-09/SEC-07: atomically confirms an official invite '
  'found by phone + tenant_id (the post-login fallback path with no '
  'invite_token required). Requires p_privacy_accepted = true and a '
  'p_tenant_id that matches a pending invite for p_user_phone in that '
  'specific tenant (20260910145957) — a phone with pending invites in '
  'several tenants no longer has one picked for it by created_at; the '
  'caller must say which tenant, and a mismatched tenant_id raises '
  'not_found rather than falling back to a different tenant''s row. '
  'p_tenant_id defaults to null (deploy-window compatibility, see Window '
  'in the migration header) — null can never equal a real tenant_id, so '
  'an old caller that omits it still fails closed to not_found rather '
  'than matching any row. Locks '
  'the official row (SELECT ... FOR UPDATE; the (tenant_id, phone) partial '
  'unique index officials_tenant_phone_active_uniq guarantees this matches '
  'at most one row once tenant_id is in the WHERE clause, so no ORDER '
  'BY/LIMIT is needed) and re-checks invite_status in the UPDATE WHERE '
  'clause so concurrent callers cannot both succeed. Enforces the same '
  'invite_token_expires_at deadline as the token-based '
  'confirm_official_invite; a NULL deadline (pre-0010 officials, never '
  'backfilled) is treated as expired on purpose rather than left as an '
  'unreachable edge case — resend is the recovery path either way. '
  'Grants the official role via an atomic upsert '
  'that also catches a user who already held ''participant'' in this '
  'tenant (migration 0047) but never overwrites any OTHER existing role '
  '(tenant_admin) — those are left untouched and role_granted is false. '
  'Raises not_found / expired / already_confirmed / privacy_not_accepted '
  '(errcode P0001) on failure. This is the only overload of this function '
  '— the prior 3-arg (uuid, text, boolean) signature with no tenant_id is '
  'dropped by this same migration (20260910145957) so no caller can ever '
  'resolve to the tenant-blind body.';

-- Only service_role calls this (tenant.ts's confirmOfficialInvite, via the
-- service client) — never authenticated directly. A new parameter list is a
-- new catalog object with no inherited ACL, so both statements are restated
-- for the 4-arg signature exactly as 0018/0045 stated them for the prior
-- signatures — not broadened.
revoke all on function public.confirm_official_invite_by_phone(uuid, text, uuid, boolean) from public;
grant execute on function public.confirm_official_invite_by_phone(uuid, text, uuid, boolean) to service_role;

-- ============================================================================
-- DONE
-- ============================================================================
-- Verify with:
--   select pg_get_function_identity_arguments(p.oid) as args, p.pronargs
--   from pg_proc p
--   join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.proname = 'confirm_official_invite_by_phone';
--   -- must return exactly ONE row (confirms the 3-arg overload is gone):
--   --   pronargs = 4
--   --   args = 'p_user_id uuid, p_user_phone text, p_tenant_id uuid DEFAULT NULL::uuid, p_privacy_accepted boolean DEFAULT false'
--
--   select count(*) from information_schema.routines
--   where routine_schema = 'public' and routine_name = 'confirm_official_invite_by_phone';
--   -- should be 1
--
--   select prosrc from pg_proc where proname = 'confirm_official_invite_by_phone';
--   -- should NOT contain 'order by created_at' or 'limit 1'
--   -- should contain 'and tenant_id = p_tenant_id'
-- ============================================================================
