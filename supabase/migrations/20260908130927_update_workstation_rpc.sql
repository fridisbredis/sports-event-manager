-- ============================================================================
-- Migration 20260908130927: update_workstation RPC
-- ============================================================================
--
-- REL-01: updateWorkstation() in
-- src/app/(tenant)/[tenantSlug]/admin/workstations/actions.ts performed five
-- independent writes with no transaction: update workstations, delete
-- operating windows, insert new windows, delete todos, insert new todos. A
-- failure on any later step (e.g. an invalid replacement window) left the
-- earlier steps committed — in particular, the windows/todos delete already
-- happened even though the replacement insert never landed, silently
-- wiping a workstation's schedule. Same defect class already fixed for
-- createWorkstation (migration 0031) and remove_official (migration 0025).
--
-- This RPC wraps all five steps in one transaction: a failure on any step
-- rolls back the whole update rather than leaving a partial result. See
-- docs/patterns/atomic-multi-table-writes.md for when this pattern applies
-- generally.
--
-- Also closes the same tenant-consistency gap create_workstation had before
-- migration 0059: p_stage_id is checked against p_tenant_id before the
-- update, rather than relying solely on the workstations_stage_tenant_fkey
-- composite FK (migration 0060) to reject it with a raw constraint-violation
-- message.
--
-- SECURITY INVOKER, matching remove_official/create_workstation's
-- reasoning: the caller is already verified as tenant_admin/system_admin
-- for p_tenant_id by hasAdminAccessToTenant() before this RPC is called
-- (session client). RLS on workstations, workstation_operating_windows, and
-- workstation_todos (tenant_admin_manage_* policies, migration 0004) gates
-- every statement in this body for exactly this caller.
--
-- Forward-fix: additive
--   Rollback: drop function if exists public.update_workstation(uuid, uuid, text, integer, boolean, uuid, text, jsonb, jsonb);
--   Data:     no data loss — this only adds a new function, no existing
--             table or row is touched.
--   Blast:    updateWorkstation() in this same PR is the only caller — see
--             src/app/(tenant)/[tenantSlug]/admin/workstations/actions.ts.
--             A rollback of this migration breaks that server action
--             immediately; it must be rolled back together with reverting
--             the actions.ts change, not on its own.
--   Window:   compatible — additive, no schema old code depends on changes.
-- ============================================================================

-- p_name/p_capacity_ceiling/p_recurring have no defaults, unlike
-- create_workstation's INSERT-shaped signature — this is an unconditional
-- UPDATE, so a caller omitting one of these would blank the name or zero
-- the capacity rather than leaving it alone.
create or replace function public.update_workstation(
  p_workstation_id   uuid,
  p_tenant_id        uuid,
  p_name             text,
  p_capacity_ceiling integer,
  p_recurring        boolean,
  p_stage_id         uuid default null,
  p_description      text default null,
  p_windows          jsonb default '[]'::jsonb,
  p_todos            jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not exists (
    select 1 from workstations w
    where w.id = p_workstation_id
      and w.tenant_id = p_tenant_id
  ) then
    raise exception 'Invalid workstation payload' using errcode = 'WSTN1';
  end if;

  if p_stage_id is not null and not exists (
    select 1 from event_stages s
    where s.id = p_stage_id
      and s.tenant_id = p_tenant_id
  ) then
    raise exception 'Invalid workstation payload' using errcode = 'WSTN1';
  end if;

  update workstations
  set
    stage_id = p_stage_id,
    name = p_name,
    description = p_description,
    capacity_ceiling = p_capacity_ceiling,
    recurring = p_recurring
  where id = p_workstation_id
    and tenant_id = p_tenant_id;

  delete from workstation_operating_windows
  where workstation_id = p_workstation_id;

  if jsonb_array_length(p_windows) > 0 then
    insert into workstation_operating_windows (workstation_id, window_start, window_end)
    select
      p_workstation_id,
      (w->>'window_start')::timestamptz,
      (w->>'window_end')::timestamptz
    from jsonb_array_elements(p_windows) as w;
  end if;

  delete from workstation_todos
  where workstation_id = p_workstation_id;

  if jsonb_array_length(p_todos) > 0 then
    insert into workstation_todos (workstation_id, instruction_text, position)
    select
      p_workstation_id,
      t.value #>> '{}',
      t.ordinality - 1
    from jsonb_array_elements(p_todos) with ordinality as t(value, ordinality);
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

comment on function public.update_workstation is
  'REL-01: atomically updates a workstation together with replacing its '
  'operating windows and todos, all in one transaction. p_todos is a plain '
  'JSON array of instruction text strings — position is assigned by array '
  'order, matching the app''s existing plain string[] input, unlike '
  'create_workstation''s {instruction_text, position} object shape. '
  'SECURITY INVOKER: relies on the caller''s own RLS grants '
  '(tenant_admin_manage_workstations / _workstation_op_windows / '
  '_workstation_todos, migration 0004), not on bypassing them. Raises '
  '"Invalid workstation payload" (errcode WSTN1) if p_workstation_id does '
  'not belong to p_tenant_id, or a non-null p_stage_id does not belong to '
  'p_tenant_id — same tenant-consistency guard as create_workstation '
  '(migration 0059).';

-- SECURITY INVOKER function, so no explicit grant to service_role is
-- needed. Revoke the default PUBLIC execute grant and grant to
-- authenticated explicitly, so RLS inside the function body is the only
-- gate, not "can call the function at all".
revoke all on function public.update_workstation(uuid, uuid, text, integer, boolean, uuid, text, jsonb, jsonb) from public;
grant execute on function public.update_workstation(uuid, uuid, text, integer, boolean, uuid, text, jsonb, jsonb) to authenticated;

-- ============================================================================
-- DONE
-- ============================================================================
-- Verify with:
--   select proname, prosecdef from pg_proc where proname = 'update_workstation';
