-- ============================================================================
-- Migration 0056: create_workstation validates event_id/stage_id tenant match
-- ============================================================================
--
-- SEC-01 follow-up: create_workstation (migration 0031) checks that the
-- caller has tenant_admin/system_admin access to p_tenant_id (via RLS on the
-- workstations INSERT, since the function runs as invoker), but never
-- checks that p_event_id or p_stage_id actually belong to p_tenant_id.
--
-- workstations.event_id and workstations.stage_id are plain foreign keys
-- (0003_phase6_schema.sql) with no cross-tenant constraint, so a
-- tenant_admin for tenant A can create a workstation with an honest
-- tenant_id = A but an event_id/stage_id belonging to tenant B. Both a
-- direct table INSERT and the RPC allow this — RLS on workstations only
-- checks the tenant_id column being written, not the tenant of the rows the
-- foreign keys point at. Confirmed by a live attack against local Postgres
-- (three probes: foreign event_id via direct insert, foreign event_id via
-- RPC, foreign stage_id via RPC — all three succeeded before this fix).
--
-- Same defect class as the workstation_id/official_id gap in
-- save_assignments_batch (migration 0033, lines documenting "cross-tenant
-- scheduling denial of service with no RLS violation anywhere in it") —
-- that RPC was given an explicit tenant-consistency check for both
-- foreign keys it accepts. create_workstation never got the equivalent for
-- event_id/stage_id. This migration closes that gap the same way: a
-- `not exists` check before the insert, raising a clear error instead of
-- silently writing a row whose event_id/stage_id disagrees with its own
-- tenant_id.
--
-- Practical impact of the gap: the resulting row doesn't surface directly
-- in the wrong tenant's UI today (list queries filter on event_id AND
-- tenant_id together), but it leaves an inconsistent row in the database —
-- a workstation "owned" by tenant A logically attached to tenant B's event —
-- and is exactly the kind of silent cross-tenant linkage a future query
-- that joins workstations to events without also filtering on
-- events.tenant_id could leak through.
--
-- Forward-fix: replace
--   Rollback: re-apply migration 0031's create_workstation body verbatim
--             in a new numbered migration (create or replace, so this is
--             the cheap case — see the 0033/0025 precedent).
--   Data:     no data loss. This only tightens what the function will
--             accept going forward; it doesn't touch existing rows. (Any
--             already-inconsistent rows created via the pre-fix window are
--             not retroactively cleaned up here — that would be a separate,
--             deliberate decision, not implied by this migration.)
--   Blast:    scoped to the admin workstation-creation path (WS-01/WS-02).
--             While reverted, create_workstation silently accepts a
--             mismatched event_id/stage_id again — same as before this
--             migration, not a new failure mode.
--   Window:   compatible. The function signature is unchanged (same
--             params, same return type), so old and new app code both
--             continue to call it the same way. The added checks only
--             reject a payload that was already invalid in intent (a
--             cross-tenant event_id/stage_id); no legitimate existing
--             caller sends that.
-- ============================================================================

create or replace function public.create_workstation(
  p_tenant_id        uuid,
  p_event_id         uuid,
  p_stage_id         uuid default null,
  p_name             text default '',
  p_description      text default null,
  p_capacity_ceiling integer default 0,
  p_recurring        boolean default false,
  p_windows          jsonb default '[]'::jsonb,
  p_todos            jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
as $$
declare
  v_workstation_id uuid;
begin
  if not exists (
    select 1 from events e
    where e.id = p_event_id
      and e.tenant_id = p_tenant_id
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

  insert into workstations (
    tenant_id, event_id, stage_id, name, description, capacity_ceiling, recurring
  )
  values (
    p_tenant_id, p_event_id, p_stage_id, p_name, p_description, p_capacity_ceiling, p_recurring
  )
  returning id into v_workstation_id;

  if jsonb_array_length(p_windows) > 0 then
    insert into workstation_operating_windows (workstation_id, window_start, window_end)
    select
      v_workstation_id,
      (w->>'window_start')::timestamptz,
      (w->>'window_end')::timestamptz
    from jsonb_array_elements(p_windows) as w;
  end if;

  if jsonb_array_length(p_todos) > 0 then
    insert into workstation_todos (workstation_id, instruction_text, position)
    select
      v_workstation_id,
      (t->>'instruction_text')::text,
      (t->>'position')::integer
    from jsonb_array_elements(p_todos) as t;
  end if;

  return v_workstation_id;
end;
$$;

comment on function public.create_workstation is
  'Atomically creates a workstation with its operating windows and todos in one transaction. '
  'Caller must be authenticated with tenant_admin or system_admin role (enforced by app layer + RLS). '
  'Raises "Invalid workstation payload" (errcode WSTN1) if p_event_id, or a non-null p_stage_id, '
  'does not belong to p_tenant_id (SEC-01, migration 0056) — the same tenant-consistency guard '
  'save_assignments_batch (migration 0033) already applies to its own foreign-key parameters.';

-- Function signature is unchanged (same args, same default SECURITY
-- INVOKER), so the existing PUBLIC execute grant from 0031 remains valid —
-- no grant/revoke needed here.

-- ============================================================================
-- DONE
-- ============================================================================
-- Verify with:
--   select proname, prosecdef from pg_proc where proname = 'create_workstation';
