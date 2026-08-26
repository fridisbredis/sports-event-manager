-- ============================================================================
-- Migration: save_assignments_batch RPC (PERF-02)
-- ============================================================================
--
-- saveAssignments() (src/app/(tenant)/[tenantSlug]/admin/scheduling/actions.ts)
-- ran deletions, status updates, an occupancy re-read, and the insert as a
-- sequence of independent network calls, not one DB transaction. A failure
-- on a later step (e.g. the insert) left earlier steps (deletions, status
-- updates) already committed — a partial, inconsistent write.
--
-- This RPC wraps the whole batch in a single transaction, preserving the
-- exact order of operations and collision semantics of the original TS
-- code:
--   1. delete
--   2. status updates
--   3. build an occupancy map from a SELECT limited to the workstations
--      touched by `additions` (mirrors the original `usedSlots` Map)
--   4. loop over `additions` in array order, mutating that map as we go —
--      an explicit slot_index pick is checked against the running map and
--      rejected with the exact "someone else just took that slot" message
--      if already used; an unspecified slot_index gets the next free slot
--      (mirrors `nextFreeSlot`)
--   5. one bulk insert of all addition rows
--
-- Deliberately NOT changed:
--   - No capacity-ceiling check. Migration 0012's UNIQUE constraint on
--     (workstation_id, timeslot_start, slot_index) only blocks an exact
--     slot_index duplicate, never a ceiling. A slot_index beyond a
--     workstation's capacity is intentionally allowed through as a
--     warned-but-not-blocked overflow row (surfaced in the UI), not a bug.
--   - The occupancy re-read stays scoped to the workstations touched by
--     this batch, taken once before the loop (not per-row), same as today.
--   - The auto-assign branch (an addition with no slot_index takes the next
--     free slot). No app call site reaches it today — all four
--     persistAdditions calls in scheduling-grid.tsx pass an explicit
--     slot_index — but it mirrors intentional pre-migration TS behavior
--     (`nextFreeSlot`), so retiring it is a product decision, not a
--     migration detail. It is kept, and covered by integration tests.
--
-- Occupancy is a jsonb object used as a set ("ws|start|idx" -> true), not a
-- text[]. The array version probed with array_position, an O(k) linear
-- scan, and k grows with both the existing rows on the touched workstations
-- AND every addition appended during the loop. The auto-assign branch
-- probes once per candidate slot_index, so the cheapest hostile payload
-- anyone could write — one workstation, one timeslot, N additions, no
-- slot_index — cost roughly O(N^3) scans inside an open transaction holding
-- the locks taken in steps 1 and 2. jsonb `?` probes a sorted object
-- instead, so the same payload is now O(N^2 log N), and the seed size —
-- which no client-side cap bounds, since it comes from existing rows — no
-- longer multiplies into every probe.
--
-- SECURITY INVOKER (like remove_official, migration 0025): the caller is
-- already an authenticated tenant_admin/system_admin, checked in
-- actions.ts via hasAdminAccessToTenant() before this RPC is ever called.
-- RLS's own tenant_admin_manage_assignments policy (migration 0004) gates
-- every statement here too, since we run as invoker. On top of that, this
-- function repeats the same role check explicitly at the top of its body
-- (get_user_role/is_system_admin, migration 0002) — defense in depth, so a
-- caller who somehow reaches this RPC without admin access gets a clean
-- "Not authorized" instead of silently-empty writes from RLS filtering.
-- Every DML statement below also filters on tenant_id = p_tenant_id
-- explicitly, same as today's per-call .eq('tenant_id', ...).
--
-- The payload guards below (jsonb shape, batch size, tenant-consistency of
-- official_id and workstation_id) are NOT redundant with the zod schemas in
-- actions.ts. This function is granted to `authenticated`, so any logged-in
-- user can POST /rest/v1/rpc/save_assignments_batch directly with their own
-- JWT — the Server Action and every schema in it are bypassed on that path.
-- RLS still confines what such a caller can write to their own tenant; the
-- guards here are what stop a malformed or oversized payload from becoming
-- an internal error the client should never see, or a long transaction
-- sitting on locks.
--
-- A true concurrent race (two requests both pass their own in-function
-- occupancy check before either commits) can still reach the unique
-- constraint from migration 0012 at INSERT time. That's caught below and
-- normalized to the same friendly message/errcode as the in-batch check,
-- rather than bubbling up as a raw Postgres constraint-violation message.
-- ============================================================================

create or replace function public.save_assignments_batch(
  p_tenant_id      uuid,
  p_deletions      uuid[],
  p_status_updates jsonb,
  p_additions      jsonb
)
returns setof assignments
language plpgsql
security invoker
set search_path = public
as $$
declare
  -- Batch ceilings. Not symmetric on purpose — each is derived from what
  -- the grid can actually produce and from what its step costs, not from
  -- one round number applied three times.
  --   additions: drag-to-paint is the only multi-row producer. It maps
  --     generateSlotsForDay() filtered by the workstation's operating
  --     window — one day, one workstation, one slot_index — which is under
  --     100 cells even at 15-minute granularity across a 24h stage. 500 is
  --     roughly 5x headroom.
  --   deletions: every app call site sends exactly one id
  --     (scheduling-grid.tsx:465, :601); no bulk-clear or multi-select
  --     delete path exists yet. Capped loosely because the step is a single
  --     set-based `delete ... where id = any(...)` over the primary key —
  --     linear and cheap — and because rejecting a legitimate future
  --     bulk-clear as invalid is a worse failure than running it slowly.
  --   status_updates: also one element per app call site today
  --     (scheduling-grid.tsx:466), but capped tightly because step 2 issues
  --     one UPDATE statement per element rather than one set-based
  --     statement.
  c_max_additions      constant integer := 500;
  c_max_deletions      constant integer := 5000;
  c_max_status_updates constant integer := 500;

  v_is_authorized boolean;
  v_status_row    record;
  v_ws_ids        uuid[];
  -- Occupancy as a set: jsonb object of "ws|start|idx" -> true. See the
  -- complexity note in the header for why this is not a text[].
  v_occ           jsonb := '{}'::jsonb;
  v_addition      jsonb;
  v_official_id   uuid;
  v_ws_id         uuid;
  v_slot_start    timestamptz;
  v_slot_end      timestamptz;
  v_slot_index    integer;
  v_key_prefix    text;
  v_key           text;
  v_add_official  uuid[] := '{}';
  v_add_ws        uuid[] := '{}';
  v_add_start     timestamptz[] := '{}';
  v_add_end       timestamptz[] := '{}';
  v_add_slot      integer[] := '{}';
  v_inserted_ids  uuid[];
begin
  -- Defense in depth: actions.ts already checks hasAdminAccessToTenant()
  -- before calling this RPC, and RLS gates every statement below since
  -- this function runs as invoker. This repeats the same check so an
  -- unauthorized caller gets an explicit error instead of silently-empty
  -- writes.
  -- coalesce is load-bearing: get_user_role() returns null for a caller with
  -- no role row in p_tenant_id, so the comparison yields null, `null or
  -- false` is null, and a bare `if not v_is_authorized` would NOT fire —
  -- an unauthorized caller would fall through this check entirely. (RLS
  -- still filtered every statement to zero rows in that case, so this was
  -- defense-in-depth failing rather than a data leak, but the caller got a
  -- silent empty success instead of "Not authorized".) is_system_admin()
  -- uses exists() and never returns null, but is wrapped for symmetry.
  select coalesce(public.get_user_role(p_tenant_id) = 'tenant_admin', false)
         or coalesce(public.is_system_admin(), false)
    into v_is_authorized;

  if not v_is_authorized then
    raise exception 'Not authorized' using errcode = 'ASG02';
  end if;

  -- Payload shape. `p_additions is not null` catches SQL NULL but not a
  -- jsonb scalar or object: a direct RPC caller passing
  -- {"p_additions": "x"} would otherwise reach jsonb_array_length() and get
  -- back a raw `cannot get array length of a scalar`, exactly the kind of
  -- internal error this project forbids returning to a client.
  if p_additions is not null and jsonb_typeof(p_additions) <> 'array' then
    raise exception 'Invalid assignment payload' using errcode = 'ASG03';
  end if;

  if p_status_updates is not null and jsonb_typeof(p_status_updates) <> 'array' then
    raise exception 'Invalid assignment payload' using errcode = 'ASG03';
  end if;

  -- Batch size, before any work. A separate errcode from ASG03 on purpose:
  -- a too-large-but-well-formed save and a malformed payload are different
  -- failures with different fixes (split the save vs. fix the caller), and
  -- collapsing them into one message costs whoever debugs it an hour.
  if coalesce(jsonb_array_length(p_additions), 0) > c_max_additions
     or coalesce(array_length(p_deletions, 1), 0) > c_max_deletions
     or coalesce(jsonb_array_length(p_status_updates), 0) > c_max_status_updates then
    raise exception 'Too many assignments in one save. Split the change into smaller saves.'
      using errcode = 'ASG04';
  end if;

  -- 1. Deletions
  if p_deletions is not null and array_length(p_deletions, 1) > 0 then
    delete from assignments
    where id = any(p_deletions)
      and tenant_id = p_tenant_id;
  end if;

  -- 2. Status updates
  if p_status_updates is not null and jsonb_array_length(p_status_updates) > 0 then
    for v_status_row in
      select * from jsonb_to_recordset(p_status_updates) as x(id uuid, status text)
    loop
      update assignments
      set status = v_status_row.status
      where id = v_status_row.id
        and tenant_id = p_tenant_id;
    end loop;
  end if;

  -- 3. + 4. + 5. Additions
  if p_additions is not null and jsonb_array_length(p_additions) > 0 then
    -- Every workstation touched by this save, not just auto-assign
    -- additions — explicit slot_index picks can just as easily collide
    -- with a slot someone else took after this admin's page loaded.
    select array_agg(distinct (elem ->> 'workstation_id')::uuid)
      into v_ws_ids
    from jsonb_array_elements(p_additions) as elem;

    if v_ws_ids is not null then
      -- Occupancy set, built once from a single SELECT scoped to the
      -- touched workstations (mirrors the original `usedSlots` Map).
      -- Runs inside this same transaction, so it already sees this
      -- transaction's own deletions above — no special isolation level
      -- needed.
      -- `slot_index is not null` mirrors the TS this replaced, which did
      -- `if (row.slot_index === null) continue`. assignments.slot_index is
      -- NOT NULL (migration 0012), so no row can actually trip this — it is
      -- defensive only, and kept because the failure mode if that ever
      -- changes is bad out of proportion to the cost of the predicate: a
      -- null slot_index makes the whole concatenated key null, and
      -- jsonb_object_agg raises on a null key, so a single such row would
      -- break every save touching that workstation rather than being
      -- skipped.
      select coalesce(
               jsonb_object_agg(
                 a.workstation_id::text || '|' || a.timeslot_start::text || '|' || a.slot_index::text,
                 true
               ),
               '{}'::jsonb
             )
        into v_occ
      from assignments a
      where a.workstation_id = any(v_ws_ids)
        and a.tenant_id = p_tenant_id
        and a.slot_index is not null;
    end if;

    -- Loop additions in array order, mutating v_occ as we go
    -- (mirrors `nextFreeSlot` mutating `usedSlots` per iteration).
    for v_addition in select * from jsonb_array_elements(p_additions)
    loop
      v_official_id := (v_addition ->> 'official_id')::uuid;
      v_ws_id       := (v_addition ->> 'workstation_id')::uuid;
      v_slot_start  := (v_addition ->> 'timeslot_start')::timestamptz;
      v_slot_end    := (v_addition ->> 'timeslot_end')::timestamptz;
      -- A null workstation_id/timeslot_start/timeslot_end/official_id would
      -- make v_key_prefix (and every derived v_key) null. A null key breaks
      -- every membership test below: `v_occ ? null` is null, never false, so
      -- the auto-assign loop's `exit when not (v_occ ? v_key)` evaluates
      -- `not null` = null and never fires — the loop runs forever inside an
      -- open transaction. jsonb_build_object would raise on the null key
      -- afterwards, but only once the loop had already hung. The status/
      -- workstation CHECK (migration 0003) and the NOT NULL columns would
      -- reject such a row at INSERT too — reject it here, before the loop
      -- can hang. actions.ts also validates the payload with zod before
      -- calling; this is the defense-in-depth layer.
      if v_official_id is null or v_ws_id is null
         or v_slot_start is null or v_slot_end is null then
        raise exception 'Invalid assignment payload' using errcode = 'ASG03';
      end if;

      v_key_prefix  := v_ws_id::text || '|' || v_slot_start::text || '|';

      if (v_addition ? 'slot_index') and v_addition ->> 'slot_index' is not null then
        v_slot_index := (v_addition ->> 'slot_index')::integer;
        v_key := v_key_prefix || v_slot_index::text;

        if v_occ ? v_key then
          raise exception 'Someone else just took that slot. Please reload the schedule and try again.'
            using errcode = 'ASG01';
        end if;
      else
        -- Auto-assign: the first free slot_index for this (workstation,
        -- timeslot), counting both pre-existing rows and additions taken
        -- earlier in this same batch. Bounded by c_max_additions plus the
        -- existing occupancy on this key, so the worst case is a finite
        -- number of O(log n) probes rather than an open-ended loop.
        v_slot_index := 1;
        loop
          v_key := v_key_prefix || v_slot_index::text;
          exit when not (v_occ ? v_key);
          v_slot_index := v_slot_index + 1;
        end loop;
      end if;

      v_occ := v_occ || jsonb_build_object(v_key, true);

      v_add_official := array_append(v_add_official, v_official_id);
      v_add_ws       := array_append(v_add_ws, v_ws_id);
      v_add_start    := array_append(v_add_start, v_slot_start);
      v_add_end      := array_append(v_add_end, v_slot_end);
      v_add_slot     := array_append(v_add_slot, v_slot_index);
    end loop;

    -- assignments.official_id references officials(id) with no
    -- tenant-consistency constraint (0001_initial_schema.sql:66), so an
    -- official_id belonging to another tenant would otherwise be written
    -- into this tenant's rows. One set-based check over the ids collected
    -- above rather than a query per addition. RLS on officials also hides
    -- foreign rows from this caller, so the check fails closed either way.
    if exists (
      select 1
      from unnest(v_add_official) as u(official_id)
      where not exists (
        select 1
        from officials o
        where o.id = u.official_id
          and o.tenant_id = p_tenant_id
      )
    ) then
      raise exception 'Invalid assignment payload' using errcode = 'ASG03';
    end if;

    -- Same defect class as official_id above, and it bites harder.
    -- assignments.workstation_id has no tenant-consistency constraint
    -- either, and uq_assignments_workstation_timeslot_slot (migration 0012)
    -- is UNIQUE (workstation_id, timeslot_start, slot_index) with no
    -- tenant_id column. So an admin of tenant A supplying tenant B's
    -- workstation uuid writes a row owned by A that occupies a slot on B's
    -- workstation: B's admins then get "Someone else just took that slot"
    -- for a slot that reads as free in their own grid, and they can neither
    -- see nor delete the row holding it. Cross-tenant scheduling denial of
    -- service with no RLS violation anywhere in it. RLS on workstations
    -- hides foreign rows from this caller, so this check fails closed too.
    if exists (
      select 1
      from unnest(v_add_ws) as u(workstation_id)
      where not exists (
        select 1
        from workstations w
        where w.id = u.workstation_id
          and w.tenant_id = p_tenant_id
      )
    ) then
      raise exception 'Invalid assignment payload' using errcode = 'ASG03';
    end if;

    -- One bulk insert, mirroring the original single `.insert(rows)` call.
    begin
      with ins as (
        insert into assignments
          (tenant_id, official_id, workstation_id, timeslot_start, timeslot_end, slot_index, status)
        select p_tenant_id, o, w, s, e, sl, 'assigned'
        from unnest(v_add_official, v_add_ws, v_add_start, v_add_end, v_add_slot) as u(o, w, s, e, sl)
        returning id
      )
      select array_agg(id) into v_inserted_ids from ins;
    exception
      when unique_violation then
        -- A true concurrent race: another transaction committed the same
        -- (workstation_id, timeslot_start, slot_index) after our occupancy
        -- read above but before our insert. Normalize to the same friendly
        -- message/errcode as the in-batch check above, rather than bubbling
        -- up a raw constraint-violation message.
        -- Catching unique_violation here rolls back only this inner BEGIN
        -- block's implicit subtransaction, which contains nothing but the
        -- insert — the deletions and status updates from steps 1 and 2 sit
        -- outside it and are untouched by that rollback. What actually
        -- discards them is the ASG01 raised on the next line: nothing
        -- catches it, so it propagates out of the function and aborts the
        -- whole calling transaction.
        raise exception 'Someone else just took that slot. Please reload the schedule and try again.'
          using errcode = 'ASG01';
    end;
  end if;

  if v_inserted_ids is null then
    return;
  end if;

  return query
    select * from assignments
    where id = any(v_inserted_ids);
end;
$$;

comment on function public.save_assignments_batch is
  'PERF-02: atomically runs the scheduling batch save (deletions, status '
  'updates, occupancy check, additions) in one transaction. SECURITY '
  'INVOKER: relies on the caller''s own RLS grants '
  '(tenant_admin_manage_assignments, migration 0004), plus an explicit '
  'get_user_role/is_system_admin check at the top of the function body. '
  'Raises "Someone else just took that slot..." (errcode ASG01) on a '
  'slot_index collision, whether caught by the in-batch occupancy check '
  'or by the migration 0012 unique constraint at insert time. Raises '
  '"Not authorized" (errcode ASG02) if the caller lacks tenant_admin/'
  'system_admin access to p_tenant_id. Raises "Invalid assignment '
  'payload" (errcode ASG03) when p_additions/p_status_updates is a jsonb '
  'non-array, or an addition is missing official_id, workstation_id or '
  'either timeslot bound, or names an official_id or workstation_id that '
  'does not belong to p_tenant_id. Raises "Too many assignments in one '
  'save..." (errcode ASG04) when a payload array exceeds its ceiling '
  '(500 additions / 5000 deletions / 500 status updates) — a distinct '
  'code from ASG03 because the caller''s fix is different. These guards '
  'are repeated here rather than left to actions.ts because this function '
  'is granted to authenticated and is therefore callable directly, '
  'bypassing the Server Action and its zod schemas. No capacity-ceiling '
  'check — over-capacity slot_index values are intentionally allowed '
  'through as overflow rows, same as before this migration.';

-- SECURITY INVOKER function: revoke the default PUBLIC execute grant and
-- grant only to authenticated, so RLS + the explicit role check inside the
-- function body are the gate, not "can call the function at all" (same
-- convention as remove_official, migration 0025).
revoke all on function public.save_assignments_batch(uuid, uuid[], jsonb, jsonb) from public;
grant execute on function public.save_assignments_batch(uuid, uuid[], jsonb, jsonb) to authenticated;

-- ============================================================================
-- DONE
-- ============================================================================
-- Verify with:
--   select proname, prosecdef from pg_proc where proname = 'save_assignments_batch';
