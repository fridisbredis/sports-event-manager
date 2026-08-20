-- ============================================================================
-- Migration 0025: remove_official RPC
-- ============================================================================
--
-- F-SEC-03 (row #17, docs/security/service-role-audit.md) / F-REL-04:
-- DELETE /api/officials/[id] performed its removal as three independent
-- writes with no transaction: delete assignments, soft-delete the officials
-- row, delete the official's user_roles row. A failure between any two
-- steps left the data in a partial state (e.g. officials marked 'removed'
-- but assignments still held, or the role never revoked).
--
-- This RPC wraps all three in a single transaction, so a failure on any step
-- rolls back the whole removal rather than leaving a partial result.
--
-- Unlike confirm_official_invite (0017) and confirm_official_invite_by_phone
-- (0018), this is SECURITY INVOKER, not SECURITY DEFINER: the caller here is
-- already an authenticated tenant_admin or system_admin (verified by
-- requireTenantAdmin() before this RPC is called), not an anonymous or
-- newly-OTP'd caller with no role yet. RLS on officials/assignments/user_roles
-- (tenant_admin_manage_officials, tenant_admin_manage_assignments,
-- tenant_admin_read_official_role + tenant_admin_revoke_official_role from
-- migration 0024) already gates exactly this operation for exactly this
-- caller, so running as invoker keeps that gate active inside the function
-- body rather than bypassing it. Called via the session client
-- (createSupabaseServerClient), not the service client.
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

  return jsonb_build_object('ok', true);
end;
$$;

comment on function public.remove_official is
  'F-SEC-03/F-REL-04: atomically removes an official — frees their '
  'assignments, soft-deletes the officials row, and revokes their '
  '''official'' user_roles row, all in one transaction. SECURITY INVOKER: '
  'relies on the caller''s own RLS grants (tenant_admin_manage_officials, '
  'tenant_admin_manage_assignments, tenant_admin_revoke_official_role from '
  'migration 0024), not on bypassing them. Raises not_found (errcode '
  'P0001) if no matching official exists for (p_official_id, p_tenant_id).';

-- SECURITY INVOKER function, so no explicit grant to service_role is
-- needed — the calling session's own role and RLS grants apply. Revoke the
-- default PUBLIC execute grant and grant to authenticated explicitly, so
-- the RLS policies inside the function body are the only gate, not "can
-- call the function at all".
revoke all on function public.remove_official(uuid, uuid) from public;
grant execute on function public.remove_official(uuid, uuid) to authenticated;

-- ============================================================================
-- DONE
-- ============================================================================
-- Verify with:
--   select proname, prosecdef from pg_proc where proname = 'remove_official';
