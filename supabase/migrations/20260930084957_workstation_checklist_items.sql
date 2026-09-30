-- ============================================================================
-- Migration 20260930084957: checklist items + per-shift check-off state
-- ============================================================================
--
-- WS-02 / MYSCH-01. Splits workstation_todos into two kinds of row and adds
-- the state an official's check-off produces, plus its audit trail.
--
-- Three parts:
--   1. workstation_todos.item_type — 'info' (today's behaviour, informational
--      only) or 'checkbox' (an official can tick it off).
--   2. checklist_item_checks — the CURRENT state, one row per item per shift.
--   3. checklist_item_events — the write-once audit trail (who, when, which
--      direction). Never updated, never deleted.
--
-- Why two tables rather than deriving state from the latest event: the
-- schedule screen reads "is this ticked" for every item on every render, and
-- deriving it means a correlated "latest event per item" subquery on a table
-- that only grows. The state table keeps that read a plain indexed lookup,
-- and a unique constraint on it is what makes the check-off idempotent under
-- two colleagues tapping the same box at once. The event table is the audit
-- record and is never the source of truth for display.
--
-- WHAT A CHECK IS SCOPED TO — the decision this migration encodes.
-- A checklist item belongs to a workstation, but a check does NOT: it is
-- scoped to (item, workstation, timeslot_start, timeslot_end). "Everyone on
-- the same shift" is the literal reading — colleagues working the same
-- workstation over the same slot see each other's ticks, and the next shift
-- on that workstation starts with an empty list. Scoping to the item alone
-- would mean the morning crew's ticks are still ticked for the evening crew;
-- scoping to the assignment row would mean two colleagues on one shift each
-- tick their own private copy, which is the opposite of what was asked.
--
-- The timeslot pair is stored denormalised rather than pointing at one
-- assignment row precisely BECAUSE the check is shared. There is no single
-- assignment that owns a shared check — there are N assignments, one per
-- colleague — so the FK would have to pick one arbitrarily, and deleting
-- that official's assignment would take the whole shift's check with it.
--
-- Forward-fix: additive
--   Rollback: alter table public.workstation_todos drop column if exists item_type;
--             drop table if exists public.checklist_item_events;
--             drop table if exists public.checklist_item_checks;
--   Data:     Dropping item_type loses the info/checkbox distinction and every
--             item reverts to informational — recoverable only from a backup.
--             Dropping the two new tables loses check state and its audit
--             trail outright. Nothing pre-existing is read or rewritten, so
--             no data that exists before this migration is at risk.
--   Blast:    None on deploy. item_type defaults to 'info', so every existing
--             row keeps rendering exactly as it does today and currently
--             deployed code (which neither selects nor writes the column)
--             cannot tell the difference. The two new tables start empty and
--             are unreferenced until this PR's app code ships.
--   Window:   Compatible in both directions. Schema-before-code leaves the
--             new column at its default and the new tables unused;
--             code-before-schema would fail the check-off write closed
--             without touching the schedule read, which does not depend on
--             either new table to render.
-- ============================================================================


-- ============================================================================
-- 1. workstation_todos.item_type
-- ============================================================================
-- Default 'info' is what keeps this migration invisible to existing rows and
-- to the currently deployed admin editor, which sends no item_type at all.

alter table public.workstation_todos
  add column if not exists item_type text not null default 'info'
    check (item_type in ('info', 'checkbox'));


-- ============================================================================
-- 2. checklist_item_checks — current state, one row per item per shift
-- ============================================================================
-- tenant_id is carried directly rather than reached through
-- workstation_todos -> workstations, so every RLS policy below is a plain
-- get_user_role(tenant_id) call like the rest of the schema, with no join to
-- evaluate per row. The FK to workstations is what keeps that copy honest:
-- see the tenant-consistency trigger further down.

create table if not exists public.checklist_item_checks (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  todo_id          uuid not null references public.workstation_todos(id) on delete cascade,
  workstation_id   uuid not null references public.workstations(id) on delete cascade,
  timeslot_start   timestamptz not null,
  timeslot_end     timestamptz not null,
  -- Who ticked it and when. Overwritten on re-check (the audit trail in
  -- checklist_item_events keeps the full history; this is only "who last
  -- left it in this state", which is what the shift screen shows).
  checked_by       uuid references auth.users(id) on delete set null,
  checked_at       timestamptz not null default now(),
  created_at       timestamptz not null default now()
);

-- The idempotency guarantee. Two colleagues tapping the same box in the same
-- second produce one row, not two: the second insert conflicts and the app's
-- upsert turns it into a no-op rather than a duplicate. Unchecking DELETEs
-- the row, so presence of a row IS the checked state — there is no boolean
-- column to get out of sync with it.
create unique index if not exists checklist_item_checks_unique_per_shift
  on public.checklist_item_checks (todo_id, workstation_id, timeslot_start, timeslot_end);

-- The schedule screen's read shape: every check for one workstation's shift.
create index if not exists checklist_item_checks_shift_idx
  on public.checklist_item_checks (workstation_id, timeslot_start, timeslot_end);

create index if not exists checklist_item_checks_tenant_idx
  on public.checklist_item_checks (tenant_id);


-- ============================================================================
-- 3. checklist_item_events — write-once audit trail
-- ============================================================================
-- Deliberately NOT public.audit_events. That table's actor_role check
-- constraint admits only 'system_admin' and 'tenant_admin' (migration 0037),
-- and its SELECT policies grant reads to admins only. Both are wrong here:
-- the actor is an official, and the whole point of "who and when" on this
-- screen is that fellow officials on the shift can see it. Widening 0037's
-- constraint would also mix high-frequency operational data into the
-- security log SEC-07 built it to be. Separate table, separate RLS.
--
-- actor_user_id is nullable with on delete set null, following 0037's
-- reasoning exactly: keep the audit row, forget the actor, rather than
-- having Postgres abort an auth.users delete with 23502.

create table if not exists public.checklist_item_events (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  todo_id          uuid not null references public.workstation_todos(id) on delete cascade,
  workstation_id   uuid not null references public.workstations(id) on delete cascade,
  timeslot_start   timestamptz not null,
  timeslot_end     timestamptz not null,
  actor_user_id    uuid references auth.users(id) on delete set null,
  -- Denormalised at write time so the trail survives the actor's auth.users
  -- row being deleted (which nulls actor_user_id above) and stays readable
  -- without a join to officials on every row.
  actor_name       text,
  action           text not null check (action in ('checked', 'unchecked')),
  created_at       timestamptz not null default now()
);

create index if not exists checklist_item_events_shift_idx
  on public.checklist_item_events (workstation_id, timeslot_start, timeslot_end, created_at desc);

create index if not exists checklist_item_events_tenant_created_idx
  on public.checklist_item_events (tenant_id, created_at desc);


-- ============================================================================
-- 4. Tenant-consistency trigger
-- ============================================================================
-- tenant_id is denormalised onto both new tables (see the note above) purely
-- so the RLS policies stay single-table lookups. That copy has to be true:
-- a row claiming tenant A while its workstation belongs to tenant B would be
-- visible to the wrong tenant's officials, since the policies trust the
-- column. A check constraint can't express this (it can't subquery), so the
-- invariant is enforced here, mirroring the pattern migration 0059 uses for
-- workstations -> event_stages.
--
-- Also verifies the item actually belongs to the named workstation: without
-- it, an official on workstation X could tick an item belonging to
-- workstation Y within the same tenant, and the shift read (which filters by
-- workstation) would silently never show the result.

create or replace function public.validate_checklist_row_tenant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ws_tenant uuid;
  v_todo_ws   uuid;
begin
  select tenant_id into v_ws_tenant
  from public.workstations
  where id = new.workstation_id;

  if v_ws_tenant is null then
    raise exception 'Workstation % not found', new.workstation_id
      using errcode = '23503';
  end if;

  if v_ws_tenant <> new.tenant_id then
    raise exception 'Workstation % does not belong to tenant %',
      new.workstation_id, new.tenant_id
      using errcode = '23514';
  end if;

  select workstation_id into v_todo_ws
  from public.workstation_todos
  where id = new.todo_id;

  if v_todo_ws is null then
    raise exception 'Checklist item % not found', new.todo_id
      using errcode = '23503';
  end if;

  if v_todo_ws <> new.workstation_id then
    raise exception 'Checklist item % does not belong to workstation %',
      new.todo_id, new.workstation_id
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_tenant on public.checklist_item_checks;
create trigger validate_tenant
  before insert or update on public.checklist_item_checks
  for each row execute function public.validate_checklist_row_tenant();

drop trigger if exists validate_tenant on public.checklist_item_events;
create trigger validate_tenant
  before insert on public.checklist_item_events
  for each row execute function public.validate_checklist_row_tenant();


-- ============================================================================
-- 5. "Is the caller on this shift?" helper
-- ============================================================================
-- The authorisation rule for every official write below: you may tick an item
-- only on a shift you are actually assigned to. Without this an official
-- could tick any item in their tenant, on any workstation, at any time.
--
-- security definer because it reads `assignments` and `officials`, and the
-- caller is an official whose own RLS on those tables is narrower than this
-- question needs — it must be answerable about a shift generally, not only
-- about rows the caller can already see.
--
-- Admins short-circuit to true: a tenant_admin administering the event is
-- not on the roster for a shift but must still be able to correct a tick.

create or replace function public.is_on_workstation_shift(
  p_workstation_id uuid,
  p_timeslot_start timestamptz,
  p_timeslot_end   timestamptz
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_system_admin()
    or exists (
      select 1
      from public.workstations w
      where w.id = p_workstation_id
        and public.get_user_role(w.tenant_id) = 'tenant_admin'
    )
    or exists (
      select 1
      from public.assignments a
      join public.officials o on o.id = a.official_id
      where a.workstation_id = p_workstation_id
        and a.timeslot_start = p_timeslot_start
        and a.timeslot_end   = p_timeslot_end
        and a.status = 'assigned'
        and o.user_id = auth.uid()
        -- An invited-but-unconfirmed official is not schedulable and must not
        -- be able to write, matching canViewOfficialSurfaces in the app.
        and o.invite_status = 'confirmed'
    );
$$;

comment on function public.is_on_workstation_shift is
  'True when the calling user is a confirmed official assigned to the given '
  'workstation over exactly the given timeslot, or is an admin of that '
  'workstation''s tenant. Gates every checklist check-off write.';


-- ============================================================================
-- 6. RLS — checklist_item_checks
-- ============================================================================
-- These deliberately do NOT follow the tenant_admin_manage_* /
-- tenant_member_read_* pair from migration 0004. That convention is for
-- admin-managed tenant data, where members read and only admins write. Check
-- state is the inverse: officials are the intended writers. The convention's
-- read half is kept as-is (any member of the tenant may read), and the write
-- half is replaced by the shift test above, with admins still covered via
-- is_on_workstation_shift's own admin short-circuit.

alter table public.checklist_item_checks enable row level security;

-- Same grant reasoning as 0037: a table created by a migration has no base
-- grants for `authenticated` locally, and a missing grant fails with 42501
-- before RLS is ever evaluated. UPDATE is granted here (unlike 0037) because
-- re-checking an already-checked item upserts checked_by/checked_at; DELETE
-- is granted because unchecking removes the row.
grant select, insert, update, delete on public.checklist_item_checks to authenticated;
revoke insert, update, delete on public.checklist_item_checks from anon;

-- READ: every member of the tenant. This is the "visible to everyone on the
-- same shift" requirement — deliberately broader than the shift itself, since
-- an official checking tomorrow's station, or an admin reviewing readiness,
-- both have a legitimate read.
drop policy if exists tenant_member_read_checklist_item_checks on public.checklist_item_checks;
create policy tenant_member_read_checklist_item_checks
  on public.checklist_item_checks for select
  using (
    public.get_user_role(tenant_id) is not null
    or public.is_system_admin()
  );

drop policy if exists shift_member_insert_checklist_item_checks on public.checklist_item_checks;
create policy shift_member_insert_checklist_item_checks
  on public.checklist_item_checks for insert
  with check (
    checked_by = auth.uid()
    and public.is_on_workstation_shift(workstation_id, timeslot_start, timeslot_end)
  );

-- UPDATE needs both halves: USING gates which existing rows are updatable,
-- WITH CHECK gates what they may become. Without WITH CHECK an official could
-- move a row onto a shift they are not on.
drop policy if exists shift_member_update_checklist_item_checks on public.checklist_item_checks;
create policy shift_member_update_checklist_item_checks
  on public.checklist_item_checks for update
  using (public.is_on_workstation_shift(workstation_id, timeslot_start, timeslot_end))
  with check (
    checked_by = auth.uid()
    and public.is_on_workstation_shift(workstation_id, timeslot_start, timeslot_end)
  );

-- Unchecking. The SELECT policy above is what makes the row visible to the
-- DELETE in the first place — a DELETE policy alone silently deletes zero
-- rows if nothing can see the row (the lesson from migration 0024).
drop policy if exists shift_member_delete_checklist_item_checks on public.checklist_item_checks;
create policy shift_member_delete_checklist_item_checks
  on public.checklist_item_checks for delete
  using (public.is_on_workstation_shift(workstation_id, timeslot_start, timeslot_end));


-- ============================================================================
-- 7. RLS — checklist_item_events (write-once)
-- ============================================================================

alter table public.checklist_item_events enable row level security;

-- No update/delete grant at all, matching 0037: write-once is enforced at the
-- grant layer as well as by the absence of a policy, so neither an official
-- nor a tenant_admin can rewrite the trail.
grant select, insert on public.checklist_item_events to authenticated;
revoke update, delete on public.checklist_item_events from authenticated;
revoke insert, update, delete on public.checklist_item_events from anon;

-- READ: every member of the tenant, so "who ticked this and when" renders for
-- the colleagues on the shift — the requirement that ruled out audit_events,
-- whose SELECT policies admit admins only.
drop policy if exists tenant_member_read_checklist_item_events on public.checklist_item_events;
create policy tenant_member_read_checklist_item_events
  on public.checklist_item_events for select
  using (
    public.get_user_role(tenant_id) is not null
    or public.is_system_admin()
  );

-- INSERT: the actor must be the caller, on the shift. Same gate as the state
-- table, so an event can never be recorded for a write that would itself have
-- been refused.
drop policy if exists shift_member_insert_checklist_item_events on public.checklist_item_events;
create policy shift_member_insert_checklist_item_events
  on public.checklist_item_events for insert
  with check (
    actor_user_id = auth.uid()
    and public.is_on_workstation_shift(workstation_id, timeslot_start, timeslot_end)
  );


-- ============================================================================
-- DONE
-- ============================================================================
-- Verify with:
--   SELECT tablename, policyname, cmd FROM pg_policies
--    WHERE tablename IN ('checklist_item_checks', 'checklist_item_events')
--    ORDER BY tablename, policyname;
--   SELECT column_name, column_default FROM information_schema.columns
--    WHERE table_name = 'workstation_todos' AND column_name = 'item_type';
