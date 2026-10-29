-- ============================================================================
-- Migration 20261029083242: remove_official_from_event — "Remove" on OFF-01
-- takes an official out of ONE event (N23, 7c)
-- ============================================================================
--
-- OFF-01's Remove called remove_official (0025/0048), which takes the person
-- off the tenant: every assignment freed, the officials row soft-deleted, the
-- 'official' role revoked. With one event per tenant that was the same thing
-- as leaving the event. Since N23 the list is one event's, and removing
-- someone from Viadal 2027 must not also take them out of Viadal 2026.
--
-- This function, in one transaction:
--   - deletes the official's membership of p_event_id (official_events) and
--     their assignments in that event;
--   - if that leaves them in no other event of the tenant, calls
--     remove_official, exactly as before: a person in no event has no reason
--     to keep the role, the login or the invite token.
-- Archived events count as "another event": the membership is history the
-- archive keeps.
--
-- Assignments are matched by event_id, and by their work area's event for
-- any row the event_id fill trigger (20261028100019) left NULL.
--
-- SECURITY INVOKER, like remove_official: the caller's tenant_admin RLS on
-- official_events, assignments, officials and user_roles decides.
--
-- Returns { removed_from_tenant, user_id }. user_id is remove_official's
-- (the revoked user, for the route's cache tag and audit row) when the
-- official left the tenant, and null otherwise. Raises 'not_found' (P0001),
-- as remove_official does, when the official is not a member of the event.
-- Asserted in tests/integration/remove-official-from-event.test.ts.
--
-- Forward-fix: additive (new function)
--   Rollback: drop function if exists public.remove_official_from_event(uuid, uuid, uuid);
--   Data:     no data loss beyond what Remove intends: the membership and
--             that event's assignments are deleted, as remove_official
--             deletes all of them today.
--   Blast:    if the function were wrong, Remove on OFF-01 fails and nothing
--             is written (one transaction). remove_official is unchanged.
--   Window:   compatible. Deployed code calls remove_official, untouched.
-- ============================================================================

create or replace function public.remove_official_from_event(
  p_official_id uuid,
  p_event_id    uuid,
  p_tenant_id   uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_removed integer;
  v_result  jsonb;
begin
  delete from public.official_events
  where official_id = p_official_id
    and event_id = p_event_id
    and tenant_id = p_tenant_id;
  get diagnostics v_removed = row_count;

  if v_removed = 0 then
    raise exception 'not_found' using errcode = 'P0001';
  end if;

  delete from public.assignments a
  where a.official_id = p_official_id
    and a.tenant_id = p_tenant_id
    and (
      a.event_id = p_event_id
      or (a.event_id is null and exists (
        select 1 from public.workstations w
        where w.id = a.workstation_id and w.event_id = p_event_id
      ))
    );

  if exists (
    select 1 from public.official_events
    where official_id = p_official_id
      and tenant_id = p_tenant_id
  ) then
    return jsonb_build_object('removed_from_tenant', false, 'user_id', null);
  end if;

  v_result := public.remove_official(p_official_id, p_tenant_id);
  return jsonb_build_object('removed_from_tenant', true, 'user_id', v_result -> 'user_id');
end;
$$;

comment on function public.remove_official_from_event(uuid, uuid, uuid) is
  'N23: removes an official from one event (membership and that event''s '
  'assignments); calls remove_official when they are left in no event. '
  'SECURITY INVOKER. Returns { removed_from_tenant, user_id }.';

revoke all on function public.remove_official_from_event(uuid, uuid, uuid)
  from public, anon;
grant execute on function public.remove_official_from_event(uuid, uuid, uuid)
  to authenticated;

-- ============================================================================
-- DONE
-- ============================================================================
-- Verify with:
--   select p.oid::regprocedure from pg_proc p where p.proname = 'remove_official_from_event';
