-- ============================================================================
-- Migration 20260930085253: create/update_workstation carry item_type
-- ============================================================================
--
-- Follows 20260930084957, which added workstation_todos.item_type. Both
-- workstation RPCs delete and re-insert the whole todo list on every save, so
-- until they know about the column, saving a workstation silently resets
-- every checkbox item back to the 'info' default. Same-PR change: the column
-- is useless without this.
--
-- Also harmonises the two payload shapes. create_workstation took
-- `{instruction_text, position}` objects while update_workstation took bare
-- strings and derived position from array order (the divergence its own
-- comment called out in 20260908130927). Both now take
-- `{instruction_text, item_type}` objects with position from `with
-- ordinality`, so the app builds one payload shape for both paths.
--
-- BACKWARD COMPATIBILITY — why this is safe to deploy before the app code.
-- The currently deployed app sends bare strings to update_workstation and
-- `{instruction_text, position}` to create_workstation. Both are still
-- accepted: item_type falls back to 'info' when the key is absent, and
-- update_workstation still reads a bare JSON string via `#>> '{}'` when the
-- element is not an object. So an old client keeps working unchanged against
-- the new function, which is what makes the deploy window compatible in both
-- orders rather than requiring schema and code to land together.
--
-- Forward-fix: replace
--   Rollback: re-apply 0059's create_workstation body and 20260908130927's
--             update_workstation body verbatim in a new timestamped
--             migration (create or replace — the cheap case, same as the
--             0059/0033/0025 precedent).
--   Data:     No data loss from the replace itself. While reverted, a
--             workstation save drops every item_type back to 'info' (the
--             reverted bodies do not carry the column through their
--             delete-and-reinsert), so any checkbox items are silently
--             downgraded to informational on the next admin save — recover
--             by re-marking them in the editor, not from a backup.
--   Blast:    Scoped to the two admin workstation save paths (WS-01/WS-02).
--             No other caller touches these functions.
--   Window:   Compatible in both directions, by the argument above — the
--             new bodies accept both the old and the new payload shapes, and
--             both signatures are unchanged (same parameter names, types,
--             defaults and return types), so no call site breaks either way.
-- ============================================================================


-- ============================================================================
-- create_workstation
-- ============================================================================
-- Body identical to 0059 (including both tenant-consistency guards, which are
-- preserved verbatim) except for the todo insert at the end.

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
    insert into workstation_todos (workstation_id, instruction_text, position, item_type)
    select
      v_workstation_id,
      (t.value->>'instruction_text')::text,
      -- Positional, not read from the payload. The old body trusted
      -- (t->>'position'), which lets a caller send duplicate or gapped
      -- positions; array order is the only ordering the editor actually has.
      t.ordinality - 1,
      -- Absent key -> 'info', which is what keeps an old client working.
      -- An unrecognised value is rejected by the column's check constraint
      -- rather than silently coerced.
      coalesce(t.value->>'item_type', 'info')
    from jsonb_array_elements(p_todos) with ordinality as t(value, ordinality);
  end if;

  return v_workstation_id;
end;
$$;

comment on function public.create_workstation is
  'Atomically creates a workstation with its operating windows and todos in one transaction. '
  'Caller must be authenticated with tenant_admin or system_admin role (enforced by app layer + RLS). '
  'Raises "Invalid workstation payload" (errcode WSTN1) if p_event_id, or a non-null p_stage_id, '
  'does not belong to p_tenant_id (SEC-01, migration 0059). p_todos elements are '
  '{instruction_text, item_type} objects; item_type defaults to ''info'' when absent and position '
  'comes from array order.';


-- ============================================================================
-- update_workstation
-- ============================================================================

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

  -- Delete-and-reinsert, unchanged from 20260908130927. Note what this means
  -- for the feature this migration serves: replacing a todo row drops both
  -- its checklist_item_checks and its checklist_item_events children via
  -- ON DELETE CASCADE, so an admin rewriting the checklist mid-event clears
  -- the ticks AND their audit trail for those items. That is a real
  -- limitation of reusing this replace-everything RPC rather than diffing
  -- the list, and it is accepted for v1: the admin has changed what the list
  -- means, so carrying old ticks onto new text would assert something nobody
  -- did. If the trail needs to outlive the item, the fix is to make
  -- checklist_item_events.todo_id `on delete set null` plus a denormalised
  -- instruction_text snapshot — deliberately out of scope here.
  delete from workstation_todos
  where workstation_id = p_workstation_id;

  if jsonb_array_length(p_todos) > 0 then
    insert into workstation_todos (workstation_id, instruction_text, position, item_type)
    select
      p_workstation_id,
      -- Accepts both shapes: an object element (the new payload) and a bare
      -- JSON string (what a pre-this-migration client still sends).
      case
        when jsonb_typeof(t.value) = 'object' then t.value->>'instruction_text'
        else t.value #>> '{}'
      end,
      t.ordinality - 1,
      case
        when jsonb_typeof(t.value) = 'object' then coalesce(t.value->>'item_type', 'info')
        else 'info'
      end
    from jsonb_array_elements(p_todos) with ordinality as t(value, ordinality);
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

comment on function public.update_workstation is
  'REL-01: atomically updates a workstation together with replacing its '
  'operating windows and todos, all in one transaction. p_todos elements are '
  '{instruction_text, item_type} objects; a bare JSON string is still '
  'accepted and treated as item_type ''info'', so a pre-item_type client '
  'keeps working. Position comes from array order. '
  'SECURITY INVOKER: relies on the caller''s own RLS grants '
  '(tenant_admin_manage_workstations / _workstation_op_windows / '
  '_workstation_todos, migration 0004), not on bypassing them. Raises '
  '"Invalid workstation payload" (errcode WSTN1) if p_workstation_id does '
  'not belong to p_tenant_id, or a non-null p_stage_id does not belong to '
  'p_tenant_id.';

-- Both signatures are unchanged, so the existing execute grants from 0031
-- and 20260908130927 remain valid — no grant/revoke needed here.

-- ============================================================================
-- DONE
-- ============================================================================
-- Verify with:
--   select proname, prosecdef from pg_proc
--    where proname in ('create_workstation', 'update_workstation');
