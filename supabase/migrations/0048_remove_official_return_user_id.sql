-- ============================================================================
-- Migration 0048: remove_official returns revoked user_id
-- ============================================================================
--
-- SEC-07-rest (optional follow-up from the 2026-08-28 SEC-07 plan, flagged
-- non-blocking): remove_official (migration 0025) revokes the official's
-- 'official' user_roles row but never returned who that was. The
-- role_revoked audit_events write in
-- src/app/api/officials/[id]/route.ts has no real target_id as a result —
-- it hardcodes targetId: null and stuffs the officialId into detail jsonb
-- instead, so the audit trail can't be joined back to the affected user.
--
-- This adds the captured user_id (read before the UPDATE nulls the
-- officials row's own copy) to the RPC's returned jsonb, so the caller can
-- pass it through as targetId.
--
-- Forward-fix: replace
--   Rollback: restore 0025's original body (returns jsonb_build_object('ok',
--             true) only, no user_id key).
--   Data:     no data loss — this only changes what the function returns,
--             not what it writes.
--   Blast:    this PR's companion route change makes officials/[id]/route.ts
--             read the new key, so a rollback to 0025's body isn't blast-free
--             once both land. If the function reverts to the old body while
--             the new route code is still deployed, user_id is absent from
--             the jsonb response, revokedUserId is undefined, and
--             logAuditEvent's `input.targetId ?? null` writes target_id:
--             null. Degraded audit attribution, no error, no failed request
--             — same silent-gap class as the 0043->0045 role_granted
--             regression that motivated the shape-contract rule.
--   Window:   compatible. Old code ignores the new key; new code (this
--             migration's companion route-handler change) can start
--             consuming it once deployed.
-- ============================================================================

create or replace function public.remove_official(
  p_official_id uuid,
  p_tenant_id   uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_official officials%rowtype;
begin
  select * into v_official
  from officials
  where id = p_official_id
    and tenant_id = p_tenant_id;

  if v_official.id is null then
    raise exception 'not_found' using errcode = 'P0001';
  end if;

  delete from assignments
  where official_id = p_official_id
    and tenant_id = p_tenant_id;

  update officials
  set
    invite_status = 'removed',
    user_id = null,
    invite_token = null,
    invite_token_expires_at = null
  where id = p_official_id
    and tenant_id = p_tenant_id;

  -- Scoped to role = 'official' deliberately: user_roles is unique per
  -- (user_id, tenant_id), not per (user_id, tenant_id, role), so a
  -- tenant_admin who also has an officials row holds a single tenant_admin
  -- row here. An unscoped delete would revoke their admin access. Gated by
  -- migration 0024's tenant_admin_revoke_official_role policy — the caller
  -- must already have tenant_admin/system_admin access to p_tenant_id, same
  -- as every other statement in this function, since this runs as invoker.
  if v_official.user_id is not null then
    delete from user_roles
    where user_id = v_official.user_id
      and tenant_id = p_tenant_id
      and role = 'official';
  end if;

  return jsonb_build_object('ok', true, 'user_id', v_official.user_id);
end;
$$;

comment on function public.remove_official is
  'F-SEC-03/F-REL-04: atomically removes an official — frees their '
  'assignments, soft-deletes the officials row, and revokes their '
  '''official'' user_roles row, all in one transaction. SECURITY INVOKER: '
  'relies on the caller''s own RLS grants (tenant_admin_manage_officials, '
  'tenant_admin_manage_assignments, tenant_admin_revoke_official_role from '
  'migration 0024), not on bypassing them. Raises not_found (errcode '
  'P0001) if no matching official exists for (p_official_id, p_tenant_id). '
  'Returns the revoked official''s user_id (null if they had never '
  'accepted their invite) so callers can attribute the role_revoked audit '
  'event to a real target_id (SEC-07-rest, migration 0048).';

-- Function signature is unchanged (same args, same SECURITY INVOKER), so
-- the existing grants from 0025 remain valid — no grant/revoke needed here.

-- ============================================================================
-- DONE
-- ============================================================================
-- Verify with:
--   select proname, prosecdef from pg_proc where proname = 'remove_official';
