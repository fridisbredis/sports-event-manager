-- ============================================================================
-- Migration 0031: create_workstation RPC
-- ============================================================================
--
-- Adds:
--   - create_workstation RPC: atomically inserts a workstation together with
--     its operating windows and todos in a single transaction
--
-- Problem: the application layer (createWorkstation server action) previously
-- performed three sequential inserts (workstations, then
-- workstation_operating_windows, then workstation_todos). If the second or
-- third insert failed, the workstation row from the first insert was left
-- behind with no windows and/or no todos — see docs/quality-requirements.md
-- F-REL-04.
--
-- Fix: wrap all three inserts in one plpgsql function so Postgres's implicit
-- function transaction rolls back everything on any failure. Same pattern as
-- sync_event_stages (migration 0005).
--
-- Runs as SECURITY INVOKER (default) so the caller's RLS context applies.
-- The application layer (createWorkstation server action) verifies
-- tenant_admin role before calling this function; RLS on workstations,
-- workstation_operating_windows, and workstation_todos provides a second
-- layer (defense in depth — see CLAUDE.md).
--
-- Parameters:
--   p_tenant_id         — tenant the workstation belongs to
--   p_event_id          — event the workstation belongs to
--   p_stage_id          — optional event stage (nullable)
--   p_name              — workstation name
--   p_description       — optional description (nullable)
--   p_capacity_ceiling  — "up to X" capacity ceiling
--   p_recurring         — whether the workstation recurs across stage days
--   p_windows           — JSON array: [{window_start, window_end}, ...]
--   p_todos             — JSON array: [{instruction_text, position}, ...]
--
-- Returns: the new workstation's id.
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
  'Caller must be authenticated with tenant_admin or system_admin role (enforced by app layer + RLS).';


-- ============================================================================
-- DONE
-- ============================================================================
-- Verify RPC with:
--   select proname from pg_proc where proname = 'create_workstation';
