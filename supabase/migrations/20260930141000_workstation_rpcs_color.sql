-- ============================================================================
-- Migration 20260930141000: create/update_workstation carry color
-- ============================================================================
--
-- Follows 20260930140000, which added workstations.color. Both workstation
-- writes go through these RPCs (REL-01 — the workstation and its windows and
-- todos are replaced in one transaction), so without this the colour picker
-- has nowhere to save to. Same-PR change: the column is unreachable from the
-- app without it.
--
-- WHY update_workstation TAKES TWO PARAMETERS FOR ONE COLUMN.
-- `p_color text default null` alone cannot express the update, because null is
-- itself a meaningful value here: "no colour chosen, fall back to hashing the
-- id". A caller that omits the parameter and a caller that clears the colour
-- would send the same thing, so one of the two operations becomes impossible.
-- `p_set_color boolean default false` disambiguates: false means leave the
-- column alone (what a pre-this-migration client does, since it sends neither
-- parameter), true means write p_color, null included. The alternative — a
-- sentinel string like '' for "clear it" — would put a value in the column
-- that the CHECK constraint has to special-case, and would silently corrupt
-- the row if a caller ever sent an empty string by accident.
--
-- create_workstation needs no such flag: an absent colour on an insert is
-- unambiguously "no colour", which is exactly the column's default.
--
-- Validation is left to the CHECK constraint from 20260930140000 rather than
-- re-listing the 30 names here. A bad name raises 23514, which the app's
-- translateDbError surfaces as a save error — the palette is a UI concern and
-- the picker can only emit valid names, so this guards against a malformed
-- direct call, not against ordinary use.
--
-- WHY THIS DROPS BEFORE IT CREATES.
-- Adding a trailing DEFAULTed parameter does not replace a function — it
-- creates an OVERLOAD, because the parameter list is part of the identity.
-- Both arities would then exist, and every existing 9-argument call would
-- fail with "function name is not unique" rather than resolving to either.
-- (This is not theoretical: writing this migration with create-or-replace
-- alone failed exactly that way on the next statement.) So each old signature
-- is dropped by its full argument list first. The drop and create are in the
-- same migration, hence the same transaction, so there is no window where the
-- function is missing.
--
-- Forward-fix: replace
--   Rollback: drop the two new signatures by their full argument lists (as
--             below, with the trailing text/boolean parameters included) and
--             re-apply 20260930085253's two function bodies verbatim in a new
--             timestamped migration. Same drop-then-create shape as here, and
--             for the same reason — create or replace cannot narrow a
--             parameter list any more than it can widen one.
--   Data:     No data loss from the replace itself. While reverted, saving a
--             work area silently leaves its colour unchanged (the reverted
--             body does not touch the column) — the picker appears to save
--             but the colour reverts on reload. Existing colours are
--             untouched; nothing needs recovering.
--   Blast:    Scoped to the two admin workstation save paths (WS-01/WS-02).
--             No other caller touches these functions.
--   Window:   Schema first, then code — and unusually for this codebase, NOT
--             compatible in both orders. The drop above removes the 9-argument
--             signature, so between this migration and the new app deploy the
--             currently deployed client is calling a function that no longer
--             exists under that argument list. PostgREST resolves an RPC by
--             the argument NAMES in the request body, so the old client's call
--             still binds to the new function (every added parameter is
--             defaulted and the names it sends are unchanged) — the hole is
--             narrower than the drop suggests, but it depends on PostgREST's
--             named-argument resolution rather than on the two signatures
--             coexisting. Deploy the migration and the code together; do not
--             leave a long gap, and do not roll back the code alone.
-- ============================================================================

-- ============================================================================
-- create_workstation
-- ============================================================================
-- Body identical to 20260930085253 except for the added p_color parameter and
-- the two column/value slots it fills in the insert.

drop function if exists public.create_workstation(
  uuid, uuid, uuid, text, text, integer, boolean, jsonb, jsonb
);

create function public.create_workstation(
  p_tenant_id        uuid,
  p_event_id         uuid,
  p_stage_id         uuid default null,
  p_name             text default '',
  p_description      text default null,
  p_capacity_ceiling integer default 0,
  p_recurring        boolean default false,
  p_windows          jsonb default '[]'::jsonb,
  p_todos            jsonb default '[]'::jsonb,
  p_color            text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
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
    tenant_id, event_id, stage_id, name, description, capacity_ceiling, recurring, color
  )
  values (
    p_tenant_id, p_event_id, p_stage_id, p_name, p_description, p_capacity_ceiling, p_recurring,
    p_color
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
  'comes from array order. p_color is a WORK_AREA_COLORS palette name (validated by the column''s '
  'check constraint); null means no colour was chosen and the app hashes the id instead.';


-- ============================================================================
-- update_workstation
-- ============================================================================
-- Body identical to 20260930085253 except for the two added parameters and the
-- one conditional assignment in the UPDATE.

drop function if exists public.update_workstation(
  uuid, uuid, text, integer, boolean, uuid, text, jsonb, jsonb
);

create function public.update_workstation(
  p_workstation_id   uuid,
  p_tenant_id        uuid,
  p_name             text,
  p_capacity_ceiling integer,
  p_recurring        boolean,
  p_stage_id         uuid default null,
  p_description      text default null,
  p_windows          jsonb default '[]'::jsonb,
  p_todos            jsonb default '[]'::jsonb,
  p_color            text default null,
  p_set_color        boolean default false
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
    recurring = p_recurring,
    -- Untouched unless the caller opted in, so a client that predates this
    -- migration (sending neither parameter) cannot blank an existing colour.
    color = case when p_set_color then p_color else color end
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
  -- for the feature that migration serves: replacing a todo row drops both
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
      -- JSON string (what a pre-20260930085253 client still sends).
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
  'keeps working. Position comes from array order. p_color is written only '
  'when p_set_color is true, so a caller that sends neither leaves the '
  'column untouched; with p_set_color true, a null p_color clears the '
  'colour. SECURITY INVOKER: relies on the caller''s own RLS grants '
  '(tenant_admin_manage_workstations / _workstation_op_windows / '
  '_workstation_todos, migration 0004), not on bypassing them. Raises '
  '"Invalid workstation payload" (errcode WSTN1) if p_workstation_id does '
  'not belong to p_tenant_id, or a non-null p_stage_id does not belong to '
  'p_tenant_id.';

-- Both functions gain only defaulted trailing parameters, so PostgreSQL keeps
-- the same function identity and the execute grants from 0031 and
-- 20260908130927 remain valid — no grant/revoke needed here.

-- ============================================================================
-- DONE
-- ============================================================================
-- Verify with:
--   select proname, pronargs, prosecdef from pg_proc
--    where proname in ('create_workstation', 'update_workstation');
