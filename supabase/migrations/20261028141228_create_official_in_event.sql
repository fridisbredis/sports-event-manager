-- ============================================================================
-- Migration 20261028141228: create_official_in_event — invite an official
-- into one event, atomically (N23)
-- ============================================================================
--
-- OFF-01's invite (POST /api/officials) inserted an officials row and relied
-- on officials_join_sole_event (20261028104200) to put the new official into
-- the tenant's event. That trigger only acts when the tenant has exactly one
-- non-archived event; with several, the official would be invited into no
-- event at all and never show on the list they were invited from.
--
-- The route now names the event (it is in the URL since N23's routing PR),
-- and this function writes the official and the membership in one
-- transaction. Two separate calls from the route would be the partial-write
-- shape docs/patterns/atomic-multi-table-writes.md (REL-01) rules out: an
-- official row with no membership is invisible in OFF-01 but still holds the
-- phone number, so a retry hits duplicate_phone.
--
-- SECURITY INVOKER: the caller's RLS decides, the same policies the route's
-- direct insert relied on (tenant_admin_manage_officials and
-- tenant_admin_manage_official_events). The composite FK on official_events
-- refuses an event from another tenant. A duplicate phone still raises 23505
-- from officials' unique index, which the route already maps to 409.
--
-- Returns the inserted officials row as jsonb, as the route's
-- insert().select().single() did: it reads id and invite_token, and sends the
-- rest (minus the token fields) back to OFF-01. Asserted in tests/integration.
--
-- Forward-fix: additive (new function)
--   Rollback: drop function if exists public.create_official_in_event(uuid, uuid, uuid, text, text, timestamptz);
--   Data:     no data loss.
--   Blast:    if the function were wrong, inviting an official fails with a
--             500 and nothing is written (one transaction).
--   Window:   compatible. Deployed code does not call it.
-- ============================================================================

create or replace function public.create_official_in_event(
  p_tenant_id               uuid,
  p_event_id                uuid,
  p_user_id                 uuid,
  p_name                    text,
  p_phone                   text,
  p_invite_token_expires_at timestamptz
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_official public.officials;
begin
  if p_tenant_id is null or p_event_id is null then
    raise exception 'create_official_in_event requires a tenant and an event'
      using errcode = '22023';
  end if;

  insert into public.officials (
    tenant_id, user_id, name, phone, invite_status, invite_token_expires_at
  )
  values (
    p_tenant_id, p_user_id, p_name, p_phone, 'invited', p_invite_token_expires_at
  )
  returning * into v_official;

  -- officials_join_sole_event may already have added this membership.
  insert into public.official_events (official_id, event_id, tenant_id)
  values (v_official.id, p_event_id, p_tenant_id)
  on conflict (official_id, event_id) do nothing;

  return to_jsonb(v_official);
end;
$$;

comment on function public.create_official_in_event(uuid, uuid, uuid, text, text, timestamptz) is
  'N23: inserts an invited official and their membership in one event, in '
  'one transaction. SECURITY INVOKER. Returns the officials row as jsonb.';

revoke all on function public.create_official_in_event(uuid, uuid, uuid, text, text, timestamptz)
  from public, anon;
grant execute on function public.create_official_in_event(uuid, uuid, uuid, text, text, timestamptz)
  to authenticated;

-- ============================================================================
-- DONE
-- ============================================================================
-- Verify with:
--   select p.oid::regprocedure from pg_proc p where p.proname = 'create_official_in_event';
